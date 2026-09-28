//! The stash: push, pop, drop, list.

use super::{GitWorkspace, run::ensure_success};
use crate::error::ExeoraError;
use serde_json::{Value, json};
use std::path::Path;
use tokio_util::sync::CancellationToken;

impl GitWorkspace {
    pub(super) async fn stash_push(
        &self,
        root: &Path,
        action: &Value,
        cancel: &CancellationToken,
    ) -> Result<Value, ExeoraError> {
        let mut args = vec!["stash", "push"];
        if action
            .get("includeUntracked")
            .and_then(Value::as_bool)
            .unwrap_or(true)
        {
            args.push("--include-untracked");
        }
        let message = action
            .get("message")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|message| !message.is_empty());
        if let Some(message) = message {
            args.extend(["-m", message]);
        }
        args.extend(["--", "."]);
        self.mutate(root, &args, &[], None, cancel).await
    }

    pub(super) async fn stash_pop(
        &self,
        root: &Path,
        action: &Value,
        cancel: &CancellationToken,
    ) -> Result<Value, ExeoraError> {
        let entry = stash_ref(action, 0);
        self.mutate(root, &["stash", "pop", &entry], &[], None, cancel)
            .await
    }

    pub(super) async fn stash_drop(
        &self,
        root: &Path,
        action: &Value,
        cancel: &CancellationToken,
    ) -> Result<Value, ExeoraError> {
        let entry = stash_ref(action, 0);
        self.mutate(root, &["stash", "drop", &entry], &[], None, cancel)
            .await
    }

    pub(super) async fn stash_list(
        &self,
        root: &Path,
        cancel: &CancellationToken,
    ) -> Result<Value, ExeoraError> {
        let output = self
            .run(
                root,
                &["stash", "list", "--format=%gd%x1f%gs%x1f%cI"],
                None,
                cancel,
            )
            .await?;
        // Outside a repository there is no stash, rather than an error.
        if !output.success && output.code == Some(128) {
            return Ok(json!({ "kind": "stash_list", "entries": [] }));
        }
        ensure_success(&output)?;
        let entries = String::from_utf8_lossy(&output.stdout)
            .lines()
            .filter_map(|line| {
                let mut fields = line.split('\u{1f}');
                let selector = fields.next()?;
                let index: u64 = selector
                    .strip_prefix("stash@{")?
                    .strip_suffix('}')?
                    .parse()
                    .ok()?;
                let message = fields.next().unwrap_or_default();
                let created_at = fields.next().unwrap_or_default();
                Some(json!({ "index": index, "message": message, "createdAt": created_at }))
            })
            .collect::<Vec<_>>();
        Ok(json!({ "kind": "stash_list", "entries": entries }))
    }
}

fn stash_ref(action: &Value, default: u64) -> String {
    let index = action
        .get("index")
        .and_then(Value::as_u64)
        .unwrap_or(default);
    format!("stash@{{{index}}}")
}
