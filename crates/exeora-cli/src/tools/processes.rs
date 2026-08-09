use super::path::resolve_in_project;
use crate::{
    error::{ErrorCode, ExeoraError},
    protocol::{
        DEFAULT_COMMAND_TIMEOUT_MS, MAX_COMMAND_OUTPUT_BYTES, MAX_PROCESS_BUFFER_BYTES,
        MAX_PROCESS_CHUNK_BYTES, MAX_PROCESSES_PER_PROJECT,
    },
};
#[cfg(windows)]
use process_wrap::tokio::JobObject;
#[cfg(unix)]
use process_wrap::tokio::ProcessGroup;
use process_wrap::tokio::{ChildWrapper, CommandWrap, KillOnDrop};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::{HashMap, VecDeque},
    path::{Path, PathBuf},
    process::Stdio,
    sync::Arc,
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWriteExt},
    sync::Mutex,
};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

type SharedChild = Arc<Mutex<Box<dyn ChildWrapper>>>;

struct Running {
    root: PathBuf,
    child: SharedChild,
    stdin: Arc<Mutex<Option<tokio::process::ChildStdin>>>,
    ring: Arc<Mutex<Ring>>,
    exit_code: Option<i32>,
    running: bool,
}

/// One read off a pipe, with its length in UTF-16 units measured once.
struct Chunk {
    text: String,
    units: usize,
}

/**
 * Output kept for one process, oldest chunk dropped first.
 *
 * Lengths and cursors count UTF-16 units, because the contract's cursor does
 * and the two have to agree or a reader seeks somewhere it did not mean to.
 * Chunks keep their own length so neither trimming nor reading has to measure
 * the whole buffer: a reader asking for 100,000 units out of a full 256,000
 * should pay for what it asked for, not for what is being held.
 */
#[derive(Default)]
struct Ring {
    chunks: VecDeque<Chunk>,
    units: usize,
    dropped: usize,
}

impl Ring {
    fn append(&mut self, text: String) {
        let units = utf16_len(&text);
        self.units += units;
        self.chunks.push_back(Chunk { text, units });
        while self.units > MAX_PROCESS_BUFFER_BYTES && self.chunks.len() > 1 {
            if let Some(oldest) = self.chunks.pop_front() {
                self.units -= oldest.units;
                self.dropped += oldest.units;
            }
        }
    }

    /// Copies at most `max` units starting `offset` units into what is still held.
    fn slice(&self, offset: usize, max: usize) -> (String, usize) {
        let mut skipped = offset;
        let mut output = String::with_capacity(max);
        let mut written = 0;

        for chunk in &self.chunks {
            if skipped >= chunk.units {
                skipped -= chunk.units;
                continue;
            }
            let budget = max - written;
            let wanted = (chunk.units - skipped).min(budget);
            let taken = append_units(&mut output, &chunk.text, chunk.units, skipped, budget);
            written += taken;
            skipped = 0;
            // Short of what the chunk still held means the budget ran out
            // inside a character rather than at the end of the chunk. The rest
            // of this chunk is the next read's; going on to the following one
            // would splice two ranges that are not adjacent.
            if taken < wanted || written >= max {
                break;
            }
        }
        (output, written)
    }
}

/**
 * Appends up to `max` UTF-16 units of `text`, starting `skip` units in.
 *
 * Resolves the unit range to a byte range and copies it in one go. Pushing
 * character by character would re-encode every one of them, and a reader
 * walking a full buffer takes whole chunks: only the first and the last of them
 * are ever partial, and `units` answers the rest without looking at the text.
 *
 * Returns the units consumed, which is what the caller's cursor advances by.
 * That is the same as the units appended except where `skip` lands inside a
 * surrogate pair: half a character cannot be handed back, so the pair is passed
 * over whole and still counted, or the next cursor would point into it again.
 */
fn append_units(output: &mut String, text: &str, units: usize, skip: usize, max: usize) -> usize {
    if skip == 0 && units <= max {
        output.push_str(text);
        return units;
    }
    if text.is_ascii() {
        let start = skip.min(text.len());
        let end = start.saturating_add(max).min(text.len());
        output.push_str(&text[start..end]);
        return end - start;
    }

    let mut position = 0;
    let mut start = None;
    let mut written = 0;

    for (offset, character) in text.char_indices() {
        let width = character.len_utf16();
        if position < skip {
            position += width;
            written += position.saturating_sub(skip);
            continue;
        }
        let start = *start.get_or_insert(offset);
        if written + width > max {
            output.push_str(&text[start..offset]);
            return written;
        }
        written += width;
    }
    if let Some(start) = start {
        output.push_str(&text[start..]);
    }
    written
}

pub struct ProcessRegistry {
    entries: Mutex<HashMap<String, Running>>,
}

impl Default for ProcessRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl ProcessRegistry {
    pub fn new() -> Self {
        Self {
            entries: Mutex::new(HashMap::new()),
        }
    }

    pub async fn run_command(
        &self,
        root: &Path,
        value: Value,
        cancel: CancellationToken,
    ) -> Result<Value, ExeoraError> {
        let args: RunArgs = parse(value)?;
        let (real_root, cwd) = resolve_in_project(root, args.cwd.as_deref().unwrap_or("."))?;
        let timeout_ms = args.timeout_ms.unwrap_or(DEFAULT_COMMAND_TIMEOUT_MS);
        let mut child = spawn_wrapped(&args.command, &real_root.join(cwd), false)?;
        let stdout = child.stdout().take();
        let stderr = child.stderr().take();
        let stdout_task = tokio::spawn(capture(stdout, MAX_COMMAND_OUTPUT_BYTES));
        let stderr_task = tokio::spawn(capture(stderr, MAX_COMMAND_OUTPUT_BYTES));

        let mut timed_out = false;
        let mut cancelled = false;
        let status = {
            let wait = child.wait();
            tokio::pin!(wait);
            tokio::select! {
                status = &mut wait => Some(status.map_err(|error| ExeoraError::tool(error.to_string()))?),
                _ = tokio::time::sleep(Duration::from_millis(timeout_ms)) => { timed_out = true; None },
                _ = cancel.cancelled() => { cancelled = true; None },
            }
        };
        if status.is_none() {
            let _ = kill_child(child.as_mut()).await;
        }
        let (stdout, stdout_cut) = stdout_task.await.map_err(join_error)??;
        let (stderr, stderr_cut) = stderr_task.await.map_err(join_error)??;
        if cancelled {
            return Err(ExeoraError::new(
                ErrorCode::Cancelled,
                "The call was cancelled while the command was running.",
            ));
        }
        Ok(json!({
            "command": args.command,
            "exitCode": status.and_then(|status| status.code()),
            "stdout": stdout,
            "stderr": stderr,
            "truncated": stdout_cut || stderr_cut,
            "timedOut": timed_out,
        }))
    }

    pub async fn start_command(&self, root: &Path, value: Value) -> Result<Value, ExeoraError> {
        let args: StartArgs = parse(value)?;
        let (real_root, cwd) = resolve_in_project(root, args.cwd.as_deref().unwrap_or("."))?;
        let root_key = real_root.clone();
        let mut entries = self.entries.lock().await;
        if entries
            .values()
            .filter(|entry| entry.root == root_key && entry.running)
            .count()
            >= MAX_PROCESSES_PER_PROJECT
        {
            return Err(ExeoraError::tool(format!(
                "This project already has {MAX_PROCESSES_PER_PROJECT} processes running. Stop one with kill_command before starting another."
            )));
        }
        let mut child = spawn_wrapped(&args.command, &real_root.join(cwd), true)?;
        let pid = child.id();
        let stdin = Arc::new(Mutex::new(child.stdin().take()));
        let stdout = child.stdout().take();
        let stderr = child.stderr().take();
        let ring = Arc::new(Mutex::new(Ring::default()));
        spawn_reader(stdout, ring.clone());
        spawn_reader(stderr, ring.clone());
        let id = format!("proc_{}", Uuid::new_v4().simple());
        entries.insert(
            id.clone(),
            Running {
                root: real_root,
                child: Arc::new(Mutex::new(child)),
                stdin,
                ring,
                exit_code: None,
                running: true,
            },
        );
        Ok(json!({ "processId": id, "command": args.command, "pid": pid }))
    }

    pub async fn get_output(&self, root: &Path, value: Value) -> Result<Value, ExeoraError> {
        let args: OutputArgs = parse(value)?;
        let mut entries = self.entries.lock().await;
        let entry = find_entry(&mut entries, root, &args.process_id)?;
        refresh(entry).await;
        let ring = entry.ring.lock().await;
        let total = ring.dropped + ring.units;
        let from = args.cursor.unwrap_or(0);
        let start = from.max(ring.dropped).min(total);
        let (chunk, read) = ring.slice(start - ring.dropped, MAX_PROCESS_CHUNK_BYTES);
        Ok(json!({
            "processId": args.process_id,
            "chunk": chunk,
            "nextCursor": start + read,
            "skipped": from < ring.dropped,
            "running": entry.running,
            "exitCode": entry.exit_code,
        }))
    }

    pub async fn send_input(&self, root: &Path, value: Value) -> Result<Value, ExeoraError> {
        let args: InputArgs = parse(value)?;
        let mut entries = self.entries.lock().await;
        let entry = find_entry(&mut entries, root, &args.process_id)?;
        if !entry.running {
            return Err(ExeoraError::tool("That process is not accepting input."));
        }
        let payload = if args.newline.unwrap_or(true) {
            format!("{}\n", args.data)
        } else {
            args.data
        };

        // Deliberately not refreshed first. Asking the kernel whether the child
        // is still alive is a syscall on every keystroke to learn what a failed
        // write reports anyway, and the answer would be stale by the time it is
        // used. The exit is confirmed only once writing has actually failed.
        let mut stdin = entry.stdin.lock().await;
        let written = match stdin.as_mut() {
            None => Err(std::io::ErrorKind::BrokenPipe.into()),
            Some(stdin) => match stdin.write_all(payload.as_bytes()).await {
                Ok(()) => stdin.flush().await,
                Err(error) => Err(error),
            },
        };
        drop(stdin);

        if let Err(error) = written {
            refresh(entry).await;
            return Err(if entry.running {
                ExeoraError::tool(error.to_string())
            } else {
                ExeoraError::tool("That process is not accepting input.")
            });
        }
        Ok(json!({ "processId": args.process_id, "bytesWritten": payload.len() }))
    }

    pub async fn kill_command(&self, root: &Path, value: Value) -> Result<Value, ExeoraError> {
        let args: ProcessArgs = parse(value)?;
        let mut entries = self.entries.lock().await;
        let entry = find_entry(&mut entries, root, &args.process_id)?;
        refresh(entry).await;
        if !entry.running {
            return Ok(
                json!({ "processId": args.process_id, "killed": false, "exitCode": entry.exit_code }),
            );
        }
        // Signal the group and answer, rather than waiting for the reap. The
        // status is not in the reply either way: `exit_code` is whatever the
        // refresh above saw, and a process still alive a moment ago has none.
        // Waiting costs the caller a full wait-and-retry loop to learn nothing.
        let mut child = entry.child.lock().await;
        let _ = child.start_kill();
        drop(child);
        entry.running = false;

        // The reap still has to happen somewhere. Nothing else will do it: the
        // entry stays in the map, so its child is never dropped, and `refresh`
        // walks away from an entry already marked stopped. Left alone the
        // killed group is a zombie for the rest of the session.
        let child = entry.child.clone();
        tokio::spawn(async move {
            let mut child = child.lock().await;
            let _ = child.wait().await;
        });
        Ok(json!({ "processId": args.process_id, "killed": true, "exitCode": entry.exit_code }))
    }

    pub async fn kill_all(&self) {
        let mut entries = self.entries.lock().await;
        for entry in entries.values_mut() {
            if entry.running {
                let mut child = entry.child.lock().await;
                let _ = kill_child(child.as_mut()).await;
            }
        }
        entries.clear();
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RunArgs {
    command: String,
    cwd: Option<String>,
    timeout_ms: Option<u64>,
}
#[derive(Deserialize)]
struct StartArgs {
    command: String,
    cwd: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct OutputArgs {
    process_id: String,
    cursor: Option<usize>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InputArgs {
    process_id: String,
    data: String,
    newline: Option<bool>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProcessArgs {
    process_id: String,
}

fn spawn_wrapped(
    command: &str,
    cwd: &Path,
    input: bool,
) -> Result<Box<dyn ChildWrapper>, ExeoraError> {
    let (program, shell_args) = shell(command);
    let mut wrapped = CommandWrap::with_new(program, |cmd| {
        cmd.args(shell_args)
            .current_dir(cwd)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .stdin(if input { Stdio::piped() } else { Stdio::null() });
    });
    #[cfg(unix)]
    wrapped.wrap(ProcessGroup::leader());
    #[cfg(windows)]
    wrapped.wrap(JobObject);
    wrapped.wrap(KillOnDrop);
    wrapped
        .spawn()
        .map_err(|error| ExeoraError::tool(error.to_string()))
}

#[cfg(unix)]
fn shell(command: &str) -> (&'static str, Vec<&str>) {
    ("/bin/sh", vec!["-c", command])
}
#[cfg(windows)]
fn shell(command: &str) -> (&'static str, Vec<&str>) {
    ("cmd.exe", vec!["/d", "/s", "/c", command])
}

fn spawn_reader<R: AsyncRead + Unpin + Send + 'static>(reader: Option<R>, ring: Arc<Mutex<Ring>>) {
    let Some(mut reader) = reader else {
        return;
    };
    tokio::spawn(async move {
        let mut buffer = vec![0; 8192];
        while let Ok(count) = reader.read(&mut buffer).await {
            if count == 0 {
                break;
            }
            let mut guard = ring.lock().await;
            guard.append(String::from_utf8_lossy(&buffer[..count]).into_owned());
        }
    });
}

async fn capture<R: AsyncRead + Unpin>(
    reader: Option<R>,
    max: usize,
) -> Result<(String, bool), ExeoraError> {
    let Some(mut reader) = reader else {
        return Ok((String::new(), false));
    };
    let mut all = Vec::new();
    reader
        .read_to_end(&mut all)
        .await
        .map_err(|error| ExeoraError::tool(error.to_string()))?;
    let cut = all.len() > max;
    let kept = if cut { &all[all.len() - max..] } else { &all };
    Ok((String::from_utf8_lossy(kept).into_owned(), cut))
}

async fn refresh(entry: &mut Running) {
    if !entry.running {
        return;
    }
    if let Ok(Some(status)) = entry.child.lock().await.try_wait() {
        entry.running = false;
        entry.exit_code = status.code();
    }
}

fn find_entry<'a>(
    entries: &'a mut HashMap<String, Running>,
    root: &Path,
    id: &str,
) -> Result<&'a mut Running, ExeoraError> {
    let real_root = std::fs::canonicalize(root).unwrap_or_else(|_| root.to_owned());
    entries
        .get_mut(id)
        .filter(|entry| entry.root == real_root)
        .ok_or_else(|| {
            ExeoraError::tool(
                "No such process. It may have been stopped, or it belongs to another project.",
            )
        })
}

fn utf16_len(text: &str) -> usize {
    if text.is_ascii() {
        text.len()
    } else {
        text.encode_utf16().count()
    }
}
fn parse<T: for<'de> Deserialize<'de>>(value: Value) -> Result<T, ExeoraError> {
    serde_json::from_value(value)
        .map_err(|error| ExeoraError::new(ErrorCode::InvalidArguments, error.to_string()))
}
fn join_error(error: tokio::task::JoinError) -> ExeoraError {
    ExeoraError::tool(error.to_string())
}

async fn kill_child(child: &mut dyn ChildWrapper) -> std::io::Result<()> {
    Box::into_pin(child.kill()).await
}

#[cfg(test)]
mod tests {
    use super::Ring;

    /// A pair the read limit lands inside waits: it cannot be halved, and the
    /// units after it in the chunk are not adjacent to whatever follows.
    #[test]
    fn a_surrogate_pair_at_the_limit_ends_the_read() {
        let mut ring = Ring::default();
        ring.append("a".repeat(9));
        ring.append("\u{1f600}tail".to_owned());
        ring.append("later".to_owned());

        let (head, read) = ring.slice(0, 10);
        assert_eq!(head, "a".repeat(9));
        assert_eq!(read, 9, "the pair is left for the next read");

        let (tail, read) = ring.slice(read, 6);
        assert_eq!(tail, "\u{1f600}tail");
        assert_eq!(read, 6);
    }

    /// A cursor pointing inside a pair passes it whole and still counts it, or
    /// the cursor it hands back would point into the same pair again.
    #[test]
    fn a_cursor_inside_a_pair_advances_past_it() {
        let mut ring = Ring::default();
        ring.append("\u{1f600}tail".to_owned());

        let (chunk, read) = ring.slice(1, 10);
        assert_eq!(chunk, "tail");
        assert_eq!(read, 5, "one unit of the pair and four of the tail");
    }
}
