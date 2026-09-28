//! The `git` binary, driven for the dashboard's Source Control tab.
//!
//! This file holds the struct, the lock and the dispatch; each family of
//! actions has a module of its own. `run.rs` is the one door to the binary.

mod branch;
mod commit;
mod context;
mod diff;
mod log;
mod paths;
mod remote;
mod run;
mod stash;
mod status;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_v2;

pub(crate) use run::{GitOutput, NON_INTERACTIVE_SSH, invalid, required_string, run_git};

use crate::error::ExeoraError;
use serde_json::Value;
use std::path::Path;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

/// Actions that read and never take the lock (nor any optional index lock),
/// so the dashboard's status poll never queues behind a slow push or pull.
const READS: &[&str] = &[
    "status",
    "diff",
    "unpublished",
    "log",
    "commit_detail",
    "commit_diff",
    "diff_all",
    "range_diff",
    "staged_context",
    "range_context",
    "stash_list",
];

pub struct GitWorkspace {
    /// Held by every mutation of the checkout, including the Explorer's.
    pub(crate) operation: Mutex<()>,
}

impl GitWorkspace {
    pub fn new() -> Self {
        Self {
            operation: Mutex::new(()),
        }
    }

    pub fn is_read(name: &str) -> bool {
        READS.contains(&name)
    }

    pub async fn execute(
        &self,
        root: &Path,
        action: Value,
        cancel: CancellationToken,
    ) -> Result<Value, ExeoraError> {
        let name = action
            .get("action")
            .and_then(Value::as_str)
            .ok_or_else(|| invalid("A workspace action is required."))?;
        let _guard = if Self::is_read(name) {
            None
        } else {
            Some(self.operation.lock().await)
        };
        match name {
            "status" => self.status(root, &cancel).await,
            "unpublished" => self.unpublished(root, &cancel).await,
            "diff" => {
                let path = required_string(&action, "path")?;
                let area = required_string(&action, "area")?;
                self.diff(root, path, area, &cancel).await
            }
            "diff_all" => {
                let area = required_string(&action, "area")?;
                self.diff_all(root, area, &cancel).await
            }
            "log" => self.log(root, &action, &cancel).await,
            "commit_detail" => self.commit_detail(root, &action, &cancel).await,
            "commit_diff" => self.commit_diff(root, &action, &cancel).await,
            "range_diff" => {
                let base = required_string(&action, "base")?;
                self.range_diff(root, base, &cancel).await
            }
            "staged_context" => self.staged_context(root, &cancel).await,
            "range_context" => {
                let base = required_string(&action, "base")?;
                self.range_context(root, base, &cancel).await
            }
            "stash_list" => self.stash_list(root, &cancel).await,
            "stage" => self.stage(root, &action, &cancel).await,
            "unstage" => self.unstage(root, &action, &cancel).await,
            "discard" => self.discard(root, &action, &cancel).await,
            "discard_all" => self.discard_all(root, &cancel).await,
            "delete_untracked" => self.delete_untracked(root, &action, &cancel).await,
            "commit" => self.commit(root, &action, &cancel).await,
            "amend" => self.amend(root, &action, &cancel).await,
            "stash_push" => self.stash_push(root, &action, &cancel).await,
            "stash_pop" => self.stash_pop(root, &action, &cancel).await,
            "stash_drop" => self.stash_drop(root, &action, &cancel).await,
            "fetch" => self.fetch(root, &action, &cancel).await,
            "pull" => self.pull(root, &action, &cancel).await,
            "push" => self.push(root, &action, &cancel).await,
            "sync" => self.sync(root, &action, &cancel).await,
            "branch_create" => self.branch_create(root, &action, &cancel).await,
            "branch_switch" => self.branch_switch(root, &action, &cancel).await,
            "branch_track" => self.branch_track(root, &action, &cancel).await,
            "branch_delete" => self.branch_delete(root, &action, &cancel).await,
            _ => Err(invalid("Unsupported workspace action.")),
        }
    }
}

impl Default for GitWorkspace {
    fn default() -> Self {
        Self::new()
    }
}
