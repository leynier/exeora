//! Talking to a remote: fetch, pull, push, and the two together.

use super::{
    GitWorkspace, NON_INTERACTIVE_SSH,
    run::{bounded_text, ensure_success, invalid, validate_ref},
};
use crate::error::ExeoraError;
use serde_json::Value;
use std::path::Path;
use tokio_util::sync::CancellationToken;

impl GitWorkspace {
    pub(super) async fn fetch(
        &self,
        root: &Path,
        action: &Value,
        cancel: &CancellationToken,
    ) -> Result<Value, ExeoraError> {
        let mut args = vec!["fetch", "--prune"];
        if action.get("all").and_then(Value::as_bool).unwrap_or(false) {
            args.push("--all");
        } else if let Some(remote) = action.get("remote").and_then(Value::as_str) {
            validate_ref(remote)?;
            args.push(remote);
        }
        self.network(root, &args, cancel).await
    }

    pub(super) async fn pull(
        &self,
        root: &Path,
        action: &Value,
        cancel: &CancellationToken,
    ) -> Result<Value, ExeoraError> {
        let mut args = vec!["pull"];
        if let Some(remote) = action.get("remote").and_then(Value::as_str) {
            validate_ref(remote)?;
            args.push(remote);
        }
        if let Some(branch) = action.get("branch").and_then(Value::as_str) {
            if args.len() == 1 {
                return Err(invalid(
                    "A remote is required when a pull branch is provided.",
                ));
            }
            validate_ref(branch)?;
            args.push(branch);
        }
        self.network(root, &args, cancel).await
    }

    pub(super) async fn push(
        &self,
        root: &Path,
        action: &Value,
        cancel: &CancellationToken,
    ) -> Result<Value, ExeoraError> {
        let mut args = vec!["push"];
        let remote = action.get("remote").and_then(Value::as_str);
        if action
            .get("setUpstream")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            let remote = remote
                .ok_or_else(|| invalid("A remote is required when setting the upstream branch."))?;
            validate_ref(remote)?;
            args.extend(["--set-upstream", remote, "HEAD"]);
        } else if let Some(remote) = remote {
            validate_ref(remote)?;
            args.push(remote);
        }
        self.network(root, &args, cancel).await
    }

    /// Pull, then push, without letting go of the lock in between. The
    /// output of both is answered together; a pull that fails stops there.
    pub(super) async fn sync(
        &self,
        root: &Path,
        action: &Value,
        cancel: &CancellationToken,
    ) -> Result<Value, ExeoraError> {
        let remote = action.get("remote").and_then(Value::as_str);
        if let Some(remote) = remote {
            validate_ref(remote)?;
        }
        let env = self.ssh_env(root, cancel).await?;
        let mut pull = vec!["pull"];
        pull.extend(remote);
        let pulled = self.run_with_env(root, &pull, None, &env, cancel).await?;
        ensure_success(&pulled)?;
        let mut push = vec!["push"];
        push.extend(remote);
        let pushed = self.run_with_env(root, &push, None, &env, cancel).await?;
        let stdout = joined(&pulled.stdout, &pushed.stdout);
        let stderr = joined(&pulled.stderr, &pushed.stderr);
        if !pushed.success {
            return Err(ExeoraError::tool(if stderr.trim().is_empty() {
                "Git push failed.".to_owned()
            } else {
                stderr
            }));
        }
        self.mutation_result(root, stdout, stderr, cancel).await
    }

    /// Fetch, pull and push, with ssh unable to stop and ask for input.
    async fn network(
        &self,
        root: &Path,
        args: &[&str],
        cancel: &CancellationToken,
    ) -> Result<Value, ExeoraError> {
        let env = self.ssh_env(root, cancel).await?;
        self.mutate_with_env(root, args, &[], None, &env, cancel)
            .await
    }

    /// Only when the user has not chosen an ssh command: setting
    /// GIT_SSH_COMMAND would override theirs.
    async fn ssh_env(
        &self,
        root: &Path,
        cancel: &CancellationToken,
    ) -> Result<Vec<(&'static str, &'static str)>, ExeoraError> {
        let configured = std::env::var_os("GIT_SSH_COMMAND").is_some()
            || self
                .run(root, &["config", "--get", "core.sshCommand"], None, cancel)
                .await?
                .success;
        Ok(if configured {
            vec![]
        } else {
            vec![("GIT_SSH_COMMAND", NON_INTERACTIVE_SSH)]
        })
    }
}

fn joined(first: &[u8], second: &[u8]) -> String {
    let mut text = bounded_text(first);
    let rest = bounded_text(second);
    if !text.is_empty() && !rest.is_empty() && !text.ends_with('\n') {
        text.push('\n');
    }
    text.push_str(&rest);
    text
}
