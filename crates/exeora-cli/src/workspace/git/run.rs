//! The one door to the `git` binary, and what every action does with what
//! comes back out of it.

use super::GitWorkspace;
use crate::error::{ErrorCode, ExeoraError};
#[cfg(windows)]
use process_wrap::tokio::JobObject;
#[cfg(unix)]
use process_wrap::tokio::ProcessGroup;
use process_wrap::tokio::{ChildWrapper, CommandWrap, KillOnDrop};
use serde_json::{Value, json};
use std::{ffi::OsStr, path::Path, process::Stdio, time::Duration};
use tokio::io::{AsyncRead, AsyncReadExt, AsyncWriteExt};
use tokio_util::sync::CancellationToken;

/// The most of one patch or output the dashboard is sent. Under the protocol's
/// result limit with room for the JSON around it.
pub(crate) const MAX_GIT_OUTPUT: usize = 900_000;
const GIT_TIMEOUT: Duration = Duration::from_secs(300);
const GIT_INPUT_TIMEOUT: Duration = Duration::from_secs(30);
const GIT_DRAIN_TIMEOUT: Duration = Duration::from_secs(2);
/// ssh reads host-key and passphrase prompts from the terminal, which
/// `GIT_TERMINAL_PROMPT` does not cover; they would block until the timeout.
pub(crate) const NON_INTERACTIVE_SSH: &str = "ssh -o BatchMode=yes";
#[cfg(windows)]
pub(super) const NULL_DEVICE: &str = "NUL";
#[cfg(not(windows))]
pub(super) const NULL_DEVICE: &str = "/dev/null";

pub(crate) struct GitOutput {
    pub(crate) success: bool,
    pub(crate) code: Option<i32>,
    pub(crate) stdout: Vec<u8>,
    pub(crate) stderr: Vec<u8>,
}

impl GitWorkspace {
    pub(crate) async fn run(
        &self,
        root: &Path,
        args: &[&str],
        stdin: Option<&[u8]>,
        cancel: &CancellationToken,
    ) -> Result<GitOutput, ExeoraError> {
        self.run_with_env(root, args, stdin, &[], cancel).await
    }

    pub(super) async fn run_with_env(
        &self,
        root: &Path,
        args: &[&str],
        stdin: Option<&[u8]>,
        env: &[(&str, &str)],
        cancel: &CancellationToken,
    ) -> Result<GitOutput, ExeoraError> {
        run_git(root, args, stdin, env, GIT_TIMEOUT, cancel).await
    }

    /// Stdout of a command that must succeed, as text.
    pub(super) async fn text(
        &self,
        root: &Path,
        args: &[&str],
        cancel: &CancellationToken,
    ) -> Result<String, ExeoraError> {
        let output = self.run(root, args, None, cancel).await?;
        ensure_success(&output)?;
        Ok(String::from_utf8_lossy(&output.stdout).into_owned())
    }

    pub(super) async fn mutate(
        &self,
        root: &Path,
        prefix: &[&str],
        paths: &[String],
        stdin: Option<&[u8]>,
        cancel: &CancellationToken,
    ) -> Result<Value, ExeoraError> {
        self.mutate_with_env(root, prefix, paths, stdin, &[], cancel)
            .await
    }

    pub(super) async fn mutate_with_env(
        &self,
        root: &Path,
        prefix: &[&str],
        paths: &[String],
        stdin: Option<&[u8]>,
        env: &[(&str, &str)],
        cancel: &CancellationToken,
    ) -> Result<Value, ExeoraError> {
        let mut args = prefix.to_vec();
        args.extend(paths.iter().map(String::as_str));
        let output = self.run_with_env(root, &args, stdin, env, cancel).await?;
        ensure_success(&output)?;
        self.mutation_result(
            root,
            bounded_text(&output.stdout),
            bounded_text(&output.stderr),
            cancel,
        )
        .await
    }

    /// What every mutation answers with: the output, and the status as it is now.
    pub(crate) async fn mutation_result(
        &self,
        root: &Path,
        stdout: String,
        stderr: String,
        cancel: &CancellationToken,
    ) -> Result<Value, ExeoraError> {
        let status = self.status(root, cancel).await?;
        Ok(json!({
            "kind": "mutation",
            "stdout": stdout,
            "stderr": stderr,
            "status": status,
        }))
    }
}

/// Runs git where nobody is there to answer it: no terminal prompt, no
/// optional locks, messages in the one language the callers read. Shared with
/// the clone of a project, which needs the same manners and a longer timeout.
pub(crate) async fn run_git<S: AsRef<std::ffi::OsStr>>(
    cwd: &Path,
    args: &[S],
    stdin: Option<&[u8]>,
    env: &[(&str, &str)],
    timeout: Duration,
    cancel: &CancellationToken,
) -> Result<GitOutput, ExeoraError> {
    let mut wrapped = CommandWrap::with_new(OsStr::new("git"), |command| {
        crate::cgroup::drop_oom_exemption(command);
        command
            .current_dir(cwd)
            .args(args)
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("GIT_OPTIONAL_LOCKS", "0")
            .env("LC_ALL", "C")
            .envs(env.iter().copied())
            .stdin(if stdin.is_some() {
                Stdio::piped()
            } else {
                Stdio::null()
            })
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
    });
    #[cfg(unix)]
    wrapped.wrap(ProcessGroup::leader());
    #[cfg(windows)]
    wrapped.wrap(JobObject);
    wrapped.wrap(KillOnDrop);
    let mut child = wrapped
        .spawn()
        .map_err(|error| ExeoraError::tool(format!("Could not start Git: {error}")))?;
    let stdout = child.stdout().take();
    let stderr = child.stderr().take();
    let mut readers = vec![
        tokio::spawn(read_bounded(stdout, MAX_GIT_OUTPUT)),
        tokio::spawn(read_bounded(stderr, MAX_GIT_OUTPUT)),
    ];
    if let Some(input) = stdin
        && let Some(mut child_stdin) = child.stdin().take()
    {
        // Git may answer before it has read everything, or without reading
        // at all, as `check-ignore` does outside a repository; its exit
        // status says what happened better than the closed pipe does.
        let write = tokio::time::timeout(GIT_INPUT_TIMEOUT, async {
            child_stdin.write_all(input).await
        })
        .await;
        let write = match write {
            Ok(Ok(())) => Ok(()),
            Ok(Err(error)) if error.kind() == std::io::ErrorKind::BrokenPipe => Ok(()),
            Ok(Err(error)) => Err(error),
            Err(_) => Err(std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                "Timed out while writing to Git.",
            )),
        };
        if let Err(error) = write {
            stop_git(child.as_mut()).await;
            abort_readers(&mut readers);
            return Err(ExeoraError::tool(format!(
                "Could not write to Git: {error}"
            )));
        }
    }
    let status = tokio::select! {
        _ = cancel.cancelled() => {
            stop_git(child.as_mut()).await;
            abort_readers(&mut readers);
            return Err(ExeoraError::new(ErrorCode::Cancelled, "Workspace operation cancelled."));
        }
        result = tokio::time::timeout(timeout, child.wait()) => {
            match result {
                Ok(Ok(status)) => status,
                Ok(Err(error)) => {
                    stop_git(child.as_mut()).await;
                    abort_readers(&mut readers);
                    return Err(ExeoraError::tool(format!("Git failed: {error}")));
                }
                Err(_) => {
                    stop_git(child.as_mut()).await;
                    abort_readers(&mut readers);
                    return Err(ExeoraError::new(ErrorCode::ToolTimeout, "Git operation timed out."));
                }
            }
        }
    };
    // `wait` on the process-group/job wrapper already reaps descendants in
    // the group. Do not signal a successfully reaped group id: it could have
    // been recycled before this point.
    let (stdout, stderr) = collect_readers(&mut readers).await?;
    Ok(GitOutput {
        success: status.success(),
        code: status.code(),
        stdout,
        stderr,
    })
}

type Reader = tokio::task::JoinHandle<std::io::Result<Vec<u8>>>;

async fn read_bounded<R: AsyncRead + Unpin>(
    reader: Option<R>,
    limit: usize,
) -> std::io::Result<Vec<u8>> {
    let Some(mut reader) = reader else {
        return Ok(Vec::new());
    };
    let mut output = Vec::with_capacity(limit.min(8192));
    let mut buffer = [0_u8; 8192];
    loop {
        let count = reader.read(&mut buffer).await?;
        if count == 0 {
            break;
        }
        let room = limit.saturating_sub(output.len());
        if room > 0 {
            output.extend_from_slice(&buffer[..count.min(room)]);
        }
    }
    Ok(output)
}

async fn collect_readers(readers: &mut [Reader]) -> Result<(Vec<u8>, Vec<u8>), ExeoraError> {
    let joined = async {
        let stdout = readers
            .get_mut(0)
            .expect("stdout reader")
            .await
            .map_err(|error| ExeoraError::tool(error.to_string()))?
            .map_err(|error| ExeoraError::tool(error.to_string()))?;
        let stderr = readers
            .get_mut(1)
            .expect("stderr reader")
            .await
            .map_err(|error| ExeoraError::tool(error.to_string()))?
            .map_err(|error| ExeoraError::tool(error.to_string()))?;
        Ok::<_, ExeoraError>((stdout, stderr))
    };
    match tokio::time::timeout(GIT_DRAIN_TIMEOUT, joined).await {
        Ok(result) => result,
        Err(_) => {
            abort_readers(readers);
            Ok((Vec::new(), Vec::new()))
        }
    }
}

fn abort_readers(readers: &mut [Reader]) {
    for reader in readers {
        reader.abort();
    }
}

async fn stop_git(child: &mut dyn ChildWrapper) {
    let _ = child.start_kill();
    let _ = tokio::time::timeout(GIT_DRAIN_TIMEOUT, child.wait()).await;
}

pub(super) fn ensure_success(output: &GitOutput) -> Result<(), ExeoraError> {
    if output.success {
        Ok(())
    } else {
        let stderr = bounded_text(&output.stderr);
        Err(ExeoraError::tool(if stderr.trim().is_empty() {
            "Git operation failed.".to_owned()
        } else {
            stderr
        }))
    }
}

pub(crate) fn bounded_text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(&bytes[..bytes.len().min(MAX_GIT_OUTPUT)]).into_owned()
}

/// A patch cut to `limit` bytes, and whether it was cut.
pub(super) fn bounded_patch(bytes: &[u8], limit: usize) -> (String, bool) {
    let truncated = bytes.len() > limit;
    let patch = String::from_utf8_lossy(&bytes[..bytes.len().min(limit)]).into_owned();
    (patch, truncated)
}

pub(super) fn is_binary_patch(patch: &str) -> bool {
    patch.contains("Binary files ") || patch.contains("GIT binary patch")
}

pub(crate) fn invalid(message: impl Into<String>) -> ExeoraError {
    ExeoraError::new(ErrorCode::InvalidArguments, message)
}

pub(crate) fn required_string<'a>(value: &'a Value, key: &str) -> Result<&'a str, ExeoraError> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| invalid(format!("'{key}' is required.")))
}

pub(super) fn validate_ref(value: &str) -> Result<(), ExeoraError> {
    if value.is_empty()
        || value.len() > 512
        || value.starts_with('-')
        || value.chars().any(|character| character.is_control())
    {
        return Err(invalid("Invalid Git reference."));
    }
    Ok(())
}

/// A commit hash as the protocol admits it: hex, so it can never read as an option.
pub(super) fn validate_oid(value: &str) -> Result<(), ExeoraError> {
    if (4..=64).contains(&value.len()) && value.chars().all(|c| c.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err(invalid("Invalid commit hash."))
    }
}

#[cfg(test)]
mod tests {
    use super::read_bounded;
    use tokio::io::AsyncWriteExt;

    #[tokio::test]
    async fn git_output_reader_keeps_a_fixed_prefix_and_discards_the_rest() {
        let (mut writer, reader) = tokio::io::duplex(32);
        let writer = tokio::spawn(async move {
            writer.write_all(&[b'x'; 128]).await.unwrap();
            writer.shutdown().await.unwrap();
        });

        let output = read_bounded(Some(reader), 16).await.unwrap();

        writer.await.unwrap();
        assert_eq!(output, vec![b'x'; 16]);
    }
}
