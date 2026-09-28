//! The one door to the `git` binary, and what every action does with what
//! comes back out of it.

use super::GitWorkspace;
use crate::error::{ErrorCode, ExeoraError};
use serde_json::{Value, json};
use std::{path::Path, process::Stdio, time::Duration};
use tokio::{io::AsyncWriteExt, process::Command};
use tokio_util::sync::CancellationToken;

/// The most of one patch or output the dashboard is sent. Under the protocol's
/// result limit with room for the JSON around it.
pub(crate) const MAX_GIT_OUTPUT: usize = 900_000;
const GIT_TIMEOUT: Duration = Duration::from_secs(300);
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
    let mut command = Command::new("git");
    crate::cgroup::drop_oom_exemption(&mut command);
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
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let mut child = command
        .spawn()
        .map_err(|error| ExeoraError::tool(format!("Could not start Git: {error}")))?;
    if let Some(input) = stdin
        && let Some(mut child_stdin) = child.stdin.take()
    {
        // Git may answer before it has read everything, or without reading
        // at all, as `check-ignore` does outside a repository; its exit
        // status says what happened better than the closed pipe does.
        if let Err(error) = child_stdin.write_all(input).await
            && error.kind() != std::io::ErrorKind::BrokenPipe
        {
            return Err(ExeoraError::tool(format!(
                "Could not write to Git: {error}"
            )));
        }
    }
    let output = tokio::select! {
        _ = cancel.cancelled() => return Err(ExeoraError::new(ErrorCode::Cancelled, "Workspace operation cancelled.")),
        result = tokio::time::timeout(timeout, child.wait_with_output()) => {
            result.map_err(|_| ExeoraError::new(ErrorCode::ToolTimeout, "Git operation timed out."))?
                .map_err(|error| ExeoraError::tool(format!("Git failed: {error}")))?
        }
    };
    Ok(GitOutput {
        success: output.status.success(),
        code: output.status.code(),
        stdout: output.stdout,
        stderr: output.stderr,
    })
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
