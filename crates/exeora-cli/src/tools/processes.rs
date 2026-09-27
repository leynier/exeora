use super::path::{Access, resolve_path};
use crate::{
    error::{ErrorCode, ExeoraError},
    protocol::{
        DEFAULT_COMMAND_TIMEOUT_MS, MAX_COMMAND_OUTPUT_BYTES, MAX_PROCESS_BUFFER_BYTES,
        MAX_PROCESS_CHUNK_BYTES, MAX_PROCESSES_PER_PROJECT, MAX_PROCESSES_PER_WORKSPACE,
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
    ffi::{OsStr, OsString},
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

use crate::cgroup::{CommandLimits, Leaf, oom_notice};

type SharedChild = Arc<Mutex<Box<dyn ChildWrapper>>>;

struct Running {
    root: PathBuf,
    project_scope: String,
    workspace_key: String,
    owner_client_id: Option<String>,
    child: SharedChild,
    stdin: Arc<Mutex<Option<tokio::process::ChildStdin>>>,
    ring: Arc<Mutex<Ring>>,
    exit_code: Option<i32>,
    running: bool,
    /// The cgroup leaf the tree runs in, when the machine caps memory.
    leaf: Option<Arc<Leaf>>,
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
    limits: Option<Arc<CommandLimits>>,
}

impl Default for ProcessRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl ProcessRegistry {
    pub fn new() -> Self {
        Self::with_limits(None)
    }

    pub fn with_limits(limits: Option<Arc<CommandLimits>>) -> Self {
        Self {
            entries: Mutex::new(HashMap::new()),
            limits,
        }
    }

    /// How many started processes are still running, after a reap.
    pub async fn running_count(&self) -> usize {
        let mut entries = self.entries.lock().await;
        for entry in entries.values_mut() {
            refresh(entry).await;
        }
        entries.values().filter(|entry| entry.running).count()
    }

    /// A leaf for one command tree, or none when the machine sets no cap. A
    /// cap that cannot be applied fails the call: running the command without
    /// it is the outcome the cap exists to prevent.
    fn leaf(&self, prefix: &str) -> Result<Option<Arc<Leaf>>, ExeoraError> {
        match &self.limits {
            Some(limits) => limits
                .leaf(prefix)
                .map(|leaf| Some(Arc::new(leaf)))
                .map_err(|error| {
                    ExeoraError::tool(format!("Could not apply the memory limit: {error}"))
                }),
            None => Ok(None),
        }
    }

    pub async fn run_command(
        &self,
        root: &Path,
        value: Value,
        cancel: CancellationToken,
    ) -> Result<Value, ExeoraError> {
        let args: RunArgs = parse(value)?;
        let cwd = resolve_path(root, args.cwd.as_deref().unwrap_or("."), Access::Cwd)?;
        let timeout_ms = args.timeout_ms.unwrap_or(DEFAULT_COMMAND_TIMEOUT_MS);
        let (program, shell_args) = shell(&args.command);
        let outcome = run_script(
            self.limits.as_deref(),
            ScriptSpec {
                program: OsStr::new(program),
                args: shell_args.into_iter().map(OsString::from).collect(),
                cwd: &cwd.absolute(),
                env: Vec::new(),
                timeout: Duration::from_millis(timeout_ms),
                output_bytes: MAX_COMMAND_OUTPUT_BYTES,
                merged: false,
                settle: None,
                leaf_prefix: "cmd",
            },
            cancel,
        )
        .await?;
        if outcome.cancelled {
            return Err(ExeoraError::new(
                ErrorCode::Cancelled,
                "The call was cancelled while the command was running.",
            ));
        }
        let truncated = outcome.output.truncated;
        let (stdout, stderr) = outcome.output.into_strings();
        let stderr = match outcome.oom_limit {
            Some(limit) => stderr + &oom_notice(limit),
            None => stderr,
        };
        Ok(json!({
            "command": args.command,
            "exitCode": outcome.exit_code,
            "stdout": stdout,
            "stderr": stderr,
            "truncated": truncated,
            "timedOut": outcome.timed_out,
        }))
    }

    pub async fn start_command(
        &self,
        root: &Path,
        project_scope: &str,
        workspace_key: &str,
        owner_client_id: Option<&str>,
        value: Value,
    ) -> Result<Value, ExeoraError> {
        let args: StartArgs = parse(value)?;
        let cwd = resolve_path(root, args.cwd.as_deref().unwrap_or("."), Access::Cwd)?;
        let mut entries = self.entries.lock().await;
        for entry in entries.values_mut() {
            refresh(entry).await;
        }
        let running = |entry: &&Running| entry.running;
        let in_workspace = entries
            .values()
            .filter(|entry| {
                entry.project_scope == project_scope
                    && entry.workspace_key == workspace_key
                    && running(entry)
            })
            .count();
        if in_workspace >= MAX_PROCESSES_PER_WORKSPACE {
            return Err(ExeoraError::tool(format!(
                "This workspace already has {MAX_PROCESSES_PER_WORKSPACE} processes running. Stop one with kill_command before starting another."
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
        let project_root = std::fs::canonicalize(root).unwrap_or_else(|_| root.to_owned());
        let leaf = self.leaf("cmd")?;
        let mut child = spawn_wrapped(&args.command, &cwd.absolute(), true, leaf.as_deref())?;
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
                root: project_root,
                project_scope: project_scope.to_owned(),
                workspace_key: workspace_key.to_owned(),
                owner_client_id: owner_client_id.map(str::to_owned),
                child: Arc::new(Mutex::new(child)),
                stdin,
                ring,
                exit_code: None,
                running: true,
                leaf,
            },
        );
        Ok(json!({ "processId": id, "command": args.command, "pid": pid }))
    }

    pub async fn get_output(
        &self,
        root: &Path,
        project_scope: &str,
        workspace_key: &str,
        owner_client_id: Option<&str>,
        value: Value,
    ) -> Result<Value, ExeoraError> {
        let args: OutputArgs = parse(value)?;
        let mut entries = self.entries.lock().await;
        let entry = find_entry(
            &mut entries,
            root,
            project_scope,
            workspace_key,
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
        workspace_key: &str,
        owner_client_id: Option<&str>,
        value: Value,
    ) -> Result<Value, ExeoraError> {
        let args: InputArgs = parse(value)?;
        let mut entries = self.entries.lock().await;
        let entry = find_entry(
            &mut entries,
            root,
            project_scope,
            workspace_key,
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
        workspace_key: &str,
        owner_client_id: Option<&str>,
        value: Value,
    ) -> Result<Value, ExeoraError> {
        let args: ProcessArgs = parse(value)?;
        let mut entries = self.entries.lock().await;
        let entry = find_entry(
            &mut entries,
            root,
            project_scope,
            workspace_key,
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
        // The leaf goes with the reap below, not with `refresh`: that walks
        // away from an entry already marked stopped, and a leaf left behind
        // on every kill would pile up until the CLI restarts.
        let leaf = entry.leaf.take();
        if let Some(leaf) = &leaf {
            leaf.kill();
        }
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
            drop(child);
            release(leaf);
        });
        Ok(json!({ "processId": args.process_id, "killed": true, "exitCode": entry.exit_code }))
    }

    pub async fn kill_all(&self) {
        let mut entries = self.entries.lock().await;
        for entry in entries.values_mut() {
            if entry.running {
                if let Some(leaf) = &entry.leaf {
                    leaf.kill();
                }
                let mut child = entry.child.lock().await;
                let _ = kill_child(child.as_mut()).await;
            }
        }
        for (_, entry) in entries.drain() {
            release(entry.leaf);
        }
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
            if let Some(mut entry) = entries.remove(&id) {
                if entry.running {
                    if let Some(leaf) = &entry.leaf {
                        leaf.kill();
                    }
                    let mut child = entry.child.lock().await;
                    let _ = kill_child(child.as_mut()).await;
                    entry.running = false;
                }
                release(entry.leaf.take());
            }
        }
    }
}

/// Removes a leaf off the runtime thread: removal waits for the kernel.
fn release(leaf: Option<Arc<Leaf>>) {
    if let Some(leaf) = leaf {
        tokio::task::spawn_blocking(move || leaf.release());
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
    leaf: Option<&Leaf>,
) -> Result<Box<dyn ChildWrapper>, ExeoraError> {
    let (program, shell_args) = shell(command);
    let shell_args: Vec<OsString> = shell_args.into_iter().map(OsString::from).collect();
    spawn_program(
        OsStr::new(program),
        &shell_args,
        cwd,
        &[],
        if input { Stdio::piped() } else { Stdio::null() },
        None,
        leaf,
    )
}

/// Starts a program as the leader of a group of its own, in the leaf when
/// there is one. `output` replaces the two pipes the child would otherwise
/// write to, for a caller that reads both streams from one.
fn spawn_program(
    program: &OsStr,
    args: &[OsString],
    cwd: &Path,
    env: &[(String, String)],
    stdin: Stdio,
    output: Option<(Stdio, Stdio)>,
    leaf: Option<&Leaf>,
) -> Result<Box<dyn ChildWrapper>, ExeoraError> {
    let (stdout, stderr) = output.unwrap_or_else(|| (Stdio::piped(), Stdio::piped()));
    let mut attach_error = None;
    let mut wrapped = CommandWrap::with_new(program, |cmd| {
        cmd.args(args)
            .current_dir(cwd)
            .envs(env.iter().map(|(name, value)| (name, value)))
            .stdout(stdout)
            .stderr(stderr)
            .stdin(stdin);
        if let Some(leaf) = leaf
            && let Err(error) = leaf.attach_pre_exec(cmd)
        {
            attach_error = Some(error);
        }
    });
    if let Some(error) = attach_error {
        return Err(ExeoraError::tool(format!(
            "Could not apply the memory limit: {error}"
        )));
    }
    #[cfg(unix)]
    wrapped.wrap(ProcessGroup::leader());
    #[cfg(windows)]
    wrapped.wrap(JobObject);
    wrapped.wrap(KillOnDrop);
    wrapped
        .spawn()
        .map_err(|error| ExeoraError::tool(error.to_string()))
}

/// One program run to its end, with its output kept: a command an agent
/// asked for, or a script of the project on a cloud machine.
pub(crate) struct ScriptSpec<'a> {
    pub program: &'a OsStr,
    pub args: Vec<OsString>,
    pub cwd: &'a Path,
    /// Added to the environment the CLI itself runs with.
    pub env: Vec<(String, String)>,
    /// Past this the whole process group is killed.
    pub timeout: Duration,
    /// How much output is kept, from its end, both streams together.
    pub output_bytes: usize,
    /// Both streams through one pipe, so what is kept is in the order it was
    /// written. Two pipes read by two tasks only come close to that, and
    /// are what there is where a pipe cannot be shared, which is Windows.
    #[cfg_attr(not(unix), allow(dead_code))]
    pub merged: bool,
    /// None reads until every holder of the pipes has closed them, and then
    /// kills whatever the program left behind, which is what a command does.
    /// Some stops keeping output this long after the program itself is over
    /// and leaves alone what it started: see `run_script`.
    pub settle: Option<Duration>,
    pub leaf_prefix: &'static str,
}

pub(crate) struct ScriptOutcome {
    /// None when the program was killed, by this or by anything else.
    pub exit_code: Option<i32>,
    pub timed_out: bool,
    pub cancelled: bool,
    pub output: CapturedOutput,
    /// The memory limit, when the kernel killed something in the tree for it.
    pub oom_limit: Option<u64>,
    /// The leaf, when the program left something running in it. Whoever
    /// holds it removes it once it is empty.
    pub lingering: Option<Arc<Leaf>>,
}

/// Runs a program until it exits, the timeout passes or the call is
/// cancelled, and answers with what it wrote.
///
/// With `settle`, a program that leaves something running is not waited for
/// and not killed. A script that starts a daemon hands it its own stdout, so
/// the pipe never reaches its end while the daemon lives: waiting for that
/// would hang the caller for as long as the daemon runs. So the output stops
/// being kept a moment after the program itself is over. The pipe goes on
/// being read and thrown away after that, because closing it would end the
/// daemon with a broken pipe the first time it printed anything.
///
/// The leaf is a second thing that could kill the daemon: releasing it writes
/// `cgroup.kill`. With `settle` a leaf is removed only once it is empty, and
/// is handed back while it is not. What stays in it keeps its memory limit,
/// which a daemon moved out of the leaf would lose, and that is why the
/// daemon is left where it is rather than moved.
pub(crate) async fn run_script(
    limits: Option<&CommandLimits>,
    spec: ScriptSpec<'_>,
    cancel: CancellationToken,
) -> Result<ScriptOutcome, ExeoraError> {
    let leaf = match limits {
        Some(limits) => Some(Arc::new(limits.leaf(spec.leaf_prefix).map_err(
            |error| ExeoraError::tool(format!("Could not apply the memory limit: {error}")),
        )?)),
        None => None,
    };
    let captured = Arc::new(Mutex::new(CapturedOutput::with_limit(spec.output_bytes)));
    let (mut child, readers) = match spawn_captured(&spec, leaf.as_deref(), &captured) {
        Ok(spawned) => spawned,
        Err(error) => {
            release(leaf);
            return Err(error);
        }
    };

    let mut timed_out = false;
    let mut cancelled = false;
    let status = {
        let wait = child.wait();
        tokio::pin!(wait);
        tokio::select! {
            status = &mut wait => Some(status.map_err(|error| ExeoraError::tool(error.to_string()))?),
            _ = tokio::time::sleep(spec.timeout) => { timed_out = true; None },
            _ = cancel.cancelled() => { cancelled = true; None },
        }
    };
    if status.is_none() {
        let _ = kill_child(child.as_mut()).await;
    }
    let mut lingering = None;
    match spec.settle {
        None => {
            for reader in readers {
                reader.await.map_err(join_error)??;
            }
        }
        Some(settle) => {
            // A tree that was killed is killed whole, including what left
            // the process group, so nothing is left holding the pipe.
            if status.is_none()
                && let Some(leaf) = &leaf
            {
                leaf.kill();
            }
            let finished = async {
                for reader in readers {
                    let _ = reader.await;
                }
            };
            let _ = tokio::time::timeout(settle, finished).await;
        }
    }
    // Closed as it is taken, so a reader that is still draining the pipe of
    // something left running keeps nothing of what it reads.
    let output = std::mem::replace(&mut *captured.lock().await, CapturedOutput::closed());
    let oom_limit = leaf
        .as_deref()
        .filter(|leaf| leaf.oom_killed())
        .map(Leaf::limit);
    match (spec.settle, status) {
        (Some(_), Some(_)) => {
            if let Some(leaf) = leaf {
                let kept = leaf.clone();
                let empty = tokio::task::spawn_blocking(move || kept.remove_if_empty())
                    .await
                    .unwrap_or(false);
                if !empty {
                    lingering = Some(leaf);
                }
            }
        }
        _ => release(leaf),
    }
    Ok(ScriptOutcome {
        exit_code: status.and_then(|status| status.code()),
        timed_out,
        cancelled,
        output,
        oom_limit,
        lingering,
    })
}

type Reader = tokio::task::JoinHandle<Result<(), ExeoraError>>;

/// Starts the program with its output going where `captured` collects it.
fn spawn_captured(
    spec: &ScriptSpec<'_>,
    leaf: Option<&Leaf>,
    captured: &Arc<Mutex<CapturedOutput>>,
) -> Result<(Box<dyn ChildWrapper>, Vec<Reader>), ExeoraError> {
    #[cfg(unix)]
    if spec.merged {
        let io_error = |error: std::io::Error| ExeoraError::tool(error.to_string());
        let (sender, receiver) = tokio::net::unix::pipe::pipe().map_err(io_error)?;
        // The end the program writes to is an ordinary blocking pipe, as any
        // program expects of its stdout. The two handles are closed here
        // when the command that holds them is dropped, on the way out of
        // `spawn_program`: the pipe ends when its last writer does.
        let stdout = sender.into_blocking_fd().map_err(io_error)?;
        let stderr = stdout.try_clone().map_err(io_error)?;
        let child = spawn_program(
            spec.program,
            &spec.args,
            spec.cwd,
            &spec.env,
            Stdio::null(),
            Some((Stdio::from(stdout), Stdio::from(stderr))),
            leaf,
        )?;
        let reader = tokio::spawn(capture(
            Some(receiver),
            OutputStream::Stdout,
            captured.clone(),
        ));
        return Ok((child, vec![reader]));
    }
    let mut child = spawn_program(
        spec.program,
        &spec.args,
        spec.cwd,
        &spec.env,
        Stdio::null(),
        None,
        leaf,
    )?;
    let stdout = child.stdout().take();
    let stderr = child.stderr().take();
    Ok((
        child,
        vec![
            tokio::spawn(capture(stdout, OutputStream::Stdout, captured.clone())),
            tokio::spawn(capture(stderr, OutputStream::Stderr, captured.clone())),
        ],
    ))
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

pub(crate) struct CapturedOutput {
    chunks: VecDeque<OutputChunk>,
    bytes: usize,
    pub(crate) truncated: bool,
    limit: usize,
    /// Nothing more is kept: whoever wanted the output has taken it.
    closed: bool,
}

impl Default for CapturedOutput {
    fn default() -> Self {
        Self::with_limit(MAX_COMMAND_OUTPUT_BYTES)
    }
}

impl CapturedOutput {
    pub(crate) fn with_limit(limit: usize) -> Self {
        Self {
            chunks: VecDeque::new(),
            bytes: 0,
            truncated: false,
            limit,
            closed: false,
        }
    }

    fn closed() -> Self {
        Self {
            closed: true,
            ..Self::with_limit(0)
        }
    }

    fn append(&mut self, stream: OutputStream, mut bytes: Vec<u8>) {
        if self.closed {
            return;
        }
        if bytes.len() > self.limit {
            self.truncated = true;
            bytes.drain(..bytes.len() - self.limit);
        }
        self.bytes += bytes.len();
        self.chunks.push_back(OutputChunk { stream, bytes });
        while self.bytes > self.limit {
            self.truncated = true;
            let overflow = self.bytes - self.limit;
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

    pub(crate) fn into_strings(self) -> (String, String) {
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

    /// Everything that was kept, in the order it arrived, whichever stream
    /// it came from. What was cut is cut from the start, and never through
    /// the middle of a character.
    pub(crate) fn into_merged(self) -> String {
        let mut merged = Vec::with_capacity(self.bytes);
        for chunk in self.chunks {
            merged.extend(chunk.bytes);
        }
        let mut start = 0;
        if self.truncated {
            while start < merged.len().min(3) && merged[start] & 0b1100_0000 == 0b1000_0000 {
                start += 1;
            }
        }
        String::from_utf8_lossy(&merged[start..]).into_owned()
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
        // The tree is done; say so in its output if memory ended it, then let
        // the leaf go. The entry itself stays for `get_command_output`.
        if let Some(leaf) = entry.leaf.take() {
            if leaf.oom_killed() {
                entry.ring.lock().await.append(oom_notice(leaf.limit()));
            }
            release(Some(leaf));
        }
    }
}

const UNKNOWN_PROCESS: &str = "No such process in this project and workspace.";

fn find_entry<'a>(
    entries: &'a mut HashMap<String, Running>,
    root: &Path,
    project_scope: &str,
    workspace_key: &str,
    owner_client_id: Option<&str>,
    id: &str,
) -> Result<&'a mut Running, ExeoraError> {
    let real_root = std::fs::canonicalize(root).unwrap_or_else(|_| root.to_owned());
    let Some(entry) = entries.get_mut(id) else {
        return Err(ExeoraError::new(ErrorCode::UnknownProcess, UNKNOWN_PROCESS));
    };
    // Same answer for a handle that lives elsewhere, so a caller cannot hunt
    // across workspaces or clients by reading the error.
    if entry.root != real_root
        || entry.project_scope != project_scope
        || entry.workspace_key != workspace_key
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
