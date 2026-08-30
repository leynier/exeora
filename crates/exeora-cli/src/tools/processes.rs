use super::path::resolve_in_project;
use crate::{
    error::{ErrorCode, ExeoraError},
    protocol::{
        DEFAULT_COMMAND_TIMEOUT_MS, MAX_COMMAND_OUTPUT_BYTES, MAX_PROCESS_BUFFER_BYTES,
        MAX_PROCESS_CHUNK_BYTES, MAX_PROCESSES_PER_PROJECT, MAX_PROCESSES_PER_WORKTREE,
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
    project_scope: String,
    worktree_key: String,
    owner_client_id: Option<String>,
    child: SharedChild,
    stdin: Arc<Mutex<Option<tokio::process::ChildStdin>>>,
    ring: Arc<Mutex<Ring>>,
    exit_code: Option<i32>,
    running: bool,
}

/// One read off a pipe, with its UTF-8 byte length measured once.
struct Chunk {
    text: String,
    bytes: usize,
}

/**
 * Output kept for one process, oldest chunk dropped first.
 *
 * Lengths and cursors count UTF-8 bytes, matching the shared protocol limits.
 * Chunks keep their own length so neither trimming nor reading has to measure
 * the whole buffer: a reader asking for 100,000 bytes out of a full 256,000
 * should pay for what it asked for, not for what is being held.
 */
#[derive(Default)]
struct Ring {
    chunks: VecDeque<Chunk>,
    bytes: usize,
    dropped: usize,
}

impl Ring {
    fn append(&mut self, text: String) {
        let bytes = text.len();
        self.bytes += bytes;
        self.chunks.push_back(Chunk { text, bytes });
        while self.bytes > MAX_PROCESS_BUFFER_BYTES {
            let overflow = self.bytes - MAX_PROCESS_BUFFER_BYTES;
            let Some(oldest) = self.chunks.front_mut() else {
                break;
            };
            if oldest.bytes <= overflow {
                let oldest = self.chunks.pop_front().expect("front exists");
                self.bytes -= oldest.bytes;
                self.dropped += oldest.bytes;
                continue;
            }

            let mut cut = overflow;
            while !oldest.text.is_char_boundary(cut) {
                cut += 1;
            }
            oldest.text = oldest.text.split_off(cut);
            oldest.bytes -= cut;
            self.bytes -= cut;
            self.dropped += cut;
        }
    }

    /// Copies at most `max` bytes starting `offset` bytes into what is still held.
    fn slice(&self, offset: usize, max: usize) -> (String, usize) {
        let mut skipped = offset;
        let mut output = String::with_capacity(max);
        let mut consumed = 0;

        for chunk in &self.chunks {
            if skipped >= chunk.bytes {
                skipped -= chunk.bytes;
                continue;
            }
            let mut start = skipped;
            while !chunk.text.is_char_boundary(start) {
                start += 1;
            }
            consumed += start - skipped;
            let budget = max.saturating_sub(output.len());
            let mut end = (start + budget).min(chunk.bytes);
            while end > start && !chunk.text.is_char_boundary(end) {
                end -= 1;
            }
            output.push_str(&chunk.text[start..end]);
            consumed += end - start;
            skipped = 0;
            if end < chunk.bytes || output.len() >= max {
                break;
            }
        }
        (output, consumed)
    }
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
        let captured = Arc::new(Mutex::new(CapturedOutput::default()));
        let stdout_task = tokio::spawn(capture(stdout, OutputStream::Stdout, captured.clone()));
        let stderr_task = tokio::spawn(capture(stderr, OutputStream::Stderr, captured.clone()));

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
        stdout_task.await.map_err(join_error)??;
        stderr_task.await.map_err(join_error)??;
        let captured = std::mem::take(&mut *captured.lock().await);
        let truncated = captured.truncated;
        let (stdout, stderr) = captured.into_strings();
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
            "truncated": truncated,
            "timedOut": timed_out,
        }))
    }

    pub async fn start_command(
        &self,
        root: &Path,
        project_scope: &str,
        worktree_key: &str,
        owner_client_id: Option<&str>,
        value: Value,
    ) -> Result<Value, ExeoraError> {
        let args: StartArgs = parse(value)?;
        let (real_root, cwd) = resolve_in_project(root, args.cwd.as_deref().unwrap_or("."))?;
        let mut entries = self.entries.lock().await;
        for entry in entries.values_mut() {
            refresh(entry).await;
        }
        let running = |entry: &&Running| entry.running;
        let in_worktree = entries
            .values()
            .filter(|entry| {
                entry.project_scope == project_scope
                    && entry.worktree_key == worktree_key
                    && running(entry)
            })
            .count();
        if in_worktree >= MAX_PROCESSES_PER_WORKTREE {
            return Err(ExeoraError::tool(format!(
                "This worktree already has {MAX_PROCESSES_PER_WORKTREE} processes running. Stop one with kill_command before starting another."
            )));
        }
        let in_project = entries
            .values()
            .filter(|entry| entry.project_scope == project_scope && running(entry))
            .count();
        if in_project >= MAX_PROCESSES_PER_PROJECT {
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
                project_scope: project_scope.to_owned(),
                worktree_key: worktree_key.to_owned(),
                owner_client_id: owner_client_id.map(str::to_owned),
                child: Arc::new(Mutex::new(child)),
                stdin,
                ring,
                exit_code: None,
                running: true,
            },
        );
        Ok(json!({ "processId": id, "command": args.command, "pid": pid }))
    }

    pub async fn get_output(
        &self,
        root: &Path,
        project_scope: &str,
        worktree_key: &str,
        owner_client_id: Option<&str>,
        value: Value,
    ) -> Result<Value, ExeoraError> {
        let args: OutputArgs = parse(value)?;
        let mut entries = self.entries.lock().await;
        let entry = find_entry(
            &mut entries,
            root,
            project_scope,
            worktree_key,
            owner_client_id,
            &args.process_id,
        )?;
        refresh(entry).await;
        let ring = entry.ring.lock().await;
        let total = ring.dropped + ring.bytes;
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

    pub async fn send_input(
        &self,
        root: &Path,
        project_scope: &str,
        worktree_key: &str,
        owner_client_id: Option<&str>,
        value: Value,
    ) -> Result<Value, ExeoraError> {
        let args: InputArgs = parse(value)?;
        let mut entries = self.entries.lock().await;
        let entry = find_entry(
            &mut entries,
            root,
            project_scope,
            worktree_key,
            owner_client_id,
            &args.process_id,
        )?;
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

    pub async fn kill_command(
        &self,
        root: &Path,
        project_scope: &str,
        worktree_key: &str,
        owner_client_id: Option<&str>,
        value: Value,
    ) -> Result<Value, ExeoraError> {
        let args: ProcessArgs = parse(value)?;
        let mut entries = self.entries.lock().await;
        let entry = find_entry(
            &mut entries,
            root,
            project_scope,
            worktree_key,
            owner_client_id,
            &args.process_id,
        )?;
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

    pub async fn kill_root(&self, root: &Path) {
        let root = std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
        let mut entries = self.entries.lock().await;
        let ids: Vec<_> = entries
            .iter()
            .filter(|(_, entry)| entry.root == root)
            .map(|(id, _)| id.clone())
            .collect();
        for id in ids {
            if let Some(mut entry) = entries.remove(&id)
                && entry.running
            {
                let mut child = entry.child.lock().await;
                let _ = kill_child(child.as_mut()).await;
                entry.running = false;
            }
        }
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

#[derive(Clone, Copy)]
enum OutputStream {
    Stdout,
    Stderr,
}

struct OutputChunk {
    stream: OutputStream,
    bytes: Vec<u8>,
}

#[derive(Default)]
struct CapturedOutput {
    chunks: VecDeque<OutputChunk>,
    bytes: usize,
    truncated: bool,
}

impl CapturedOutput {
    fn append(&mut self, stream: OutputStream, mut bytes: Vec<u8>) {
        if bytes.len() > MAX_COMMAND_OUTPUT_BYTES {
            self.truncated = true;
            bytes.drain(..bytes.len() - MAX_COMMAND_OUTPUT_BYTES);
        }
        self.bytes += bytes.len();
        self.chunks.push_back(OutputChunk { stream, bytes });
        while self.bytes > MAX_COMMAND_OUTPUT_BYTES {
            self.truncated = true;
            let overflow = self.bytes - MAX_COMMAND_OUTPUT_BYTES;
            let Some(oldest) = self.chunks.front_mut() else {
                break;
            };
            if oldest.bytes.len() <= overflow {
                let oldest = self.chunks.pop_front().expect("front exists");
                self.bytes -= oldest.bytes.len();
            } else {
                oldest.bytes.drain(..overflow);
                self.bytes -= overflow;
            }
        }
    }

    fn into_strings(self) -> (String, String) {
        let mut stdout = Vec::new();
        let mut stderr = Vec::new();
        for chunk in self.chunks {
            match chunk.stream {
                OutputStream::Stdout => stdout.extend(chunk.bytes),
                OutputStream::Stderr => stderr.extend(chunk.bytes),
            }
        }
        (
            String::from_utf8_lossy(&stdout).into_owned(),
            String::from_utf8_lossy(&stderr).into_owned(),
        )
    }
}

async fn capture<R: AsyncRead + Unpin>(
    reader: Option<R>,
    stream: OutputStream,
    captured: Arc<Mutex<CapturedOutput>>,
) -> Result<(), ExeoraError> {
    let Some(mut reader) = reader else {
        return Ok(());
    };
    let mut buffer = vec![0; 8192];
    loop {
        let count = reader
            .read(&mut buffer)
            .await
            .map_err(|error| ExeoraError::tool(error.to_string()))?;
        if count == 0 {
            break;
        }
        captured
            .lock()
            .await
            .append(stream, buffer[..count].to_vec());
    }
    Ok(())
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

const UNKNOWN_PROCESS: &str = "No such process in this project and worktree.";

fn find_entry<'a>(
    entries: &'a mut HashMap<String, Running>,
    root: &Path,
    project_scope: &str,
    worktree_key: &str,
    owner_client_id: Option<&str>,
    id: &str,
) -> Result<&'a mut Running, ExeoraError> {
    let real_root = std::fs::canonicalize(root).unwrap_or_else(|_| root.to_owned());
    let Some(entry) = entries.get_mut(id) else {
        return Err(ExeoraError::new(ErrorCode::UnknownProcess, UNKNOWN_PROCESS));
    };
    // Same answer for a handle that lives elsewhere, so a caller cannot hunt
    // across worktrees or clients by reading the error.
    if entry.root != real_root
        || entry.project_scope != project_scope
        || entry.worktree_key != worktree_key
        || !owner_matches(entry.owner_client_id.as_deref(), owner_client_id)
    {
        return Err(ExeoraError::new(ErrorCode::UnknownProcess, UNKNOWN_PROCESS));
    }
    Ok(entry)
}

/// A process started without a client id is unattributed: the handle and tuple
/// are the whole proof. One started with an id stays bound to that id.
fn owner_matches(bound: Option<&str>, caller: Option<&str>) -> bool {
    match bound {
        None => true,
        Some(bound) => caller == Some(bound),
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
    use super::{CapturedOutput, OutputStream, Ring};
    use crate::protocol::{MAX_COMMAND_OUTPUT_BYTES, MAX_PROCESS_BUFFER_BYTES};

    #[test]
    fn a_multibyte_character_at_the_byte_limit_waits_for_the_next_read() {
        let mut ring = Ring::default();
        ring.append("a".repeat(9));
        ring.append("\u{1f600}tail".to_owned());
        ring.append("later".to_owned());

        let (head, read) = ring.slice(0, 10);
        assert_eq!(head, "a".repeat(9));
        assert_eq!(read, 9, "the character is left for the next read");

        let (tail, read) = ring.slice(read, 8);
        assert_eq!(tail, "\u{1f600}tail");
        assert_eq!(read, 8);
    }

    #[test]
    fn a_cursor_inside_a_character_advances_past_it() {
        let mut ring = Ring::default();
        ring.append("\u{1f600}tail".to_owned());

        let (chunk, read) = ring.slice(1, 10);
        assert_eq!(chunk, "tail");
        assert_eq!(read, 7, "three skipped bytes and four bytes of tail");
    }

    #[test]
    fn one_large_chunk_is_trimmed_to_the_process_byte_limit() {
        let mut ring = Ring::default();
        let input = "\u{00e9}".repeat(MAX_PROCESS_BUFFER_BYTES);
        let input_bytes = input.len();
        ring.append(input);

        assert!(ring.bytes <= MAX_PROCESS_BUFFER_BYTES);
        assert_eq!(ring.dropped + ring.bytes, input_bytes);
    }

    #[test]
    fn stdout_and_stderr_share_one_command_output_budget() {
        let mut output = CapturedOutput::default();
        output.append(OutputStream::Stdout, vec![b'o'; 150_000]);
        output.append(OutputStream::Stderr, vec![b'e'; 100_000]);
        assert!(output.truncated);
        assert_eq!(output.bytes, MAX_COMMAND_OUTPUT_BYTES);

        let (stdout, stderr) = output.into_strings();
        assert_eq!(stdout.len() + stderr.len(), MAX_COMMAND_OUTPUT_BYTES);
    }
}
