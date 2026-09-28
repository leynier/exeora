//! Branches: create, switch, track, delete.

use super::{
    GitWorkspace,
    run::{ensure_success, required_string, validate_ref},
};
use crate::error::ExeoraError;
use serde_json::Value;
use std::path::Path;
use tokio_util::sync::CancellationToken;

impl GitWorkspace {
    pub(super) async fn branch_create(
        &self,
        root: &Path,
        action: &Value,
        cancel: &CancellationToken,
    ) -> Result<Value, ExeoraError> {
        let name = required_string(action, "name")?;
        self.validate_branch(root, name, cancel).await?;
        // Create and check out, the way a git client's branch picker does.
        let mut args = vec!["switch", "-c", name];
        if let Some(start) = action.get("startPoint").and_then(Value::as_str) {
            validate_ref(start)?;
            args.push(start);
        }
        self.mutate(root, &args, &[], None, cancel).await
    }

    pub(super) async fn branch_switch(
        &self,
        root: &Path,
        action: &Value,
        cancel: &CancellationToken,
    ) -> Result<Value, ExeoraError> {
        let name = required_string(action, "name")?;
        validate_ref(name)?;
        self.mutate(root, &["switch", name], &[], None, cancel)
            .await
    }

    pub(super) async fn branch_track(
        &self,
        root: &Path,
        action: &Value,
        cancel: &CancellationToken,
    ) -> Result<Value, ExeoraError> {
        let name = required_string(action, "name")?;
        let remote = required_string(action, "remoteBranch")?;
        self.validate_branch(root, name, cancel).await?;
        validate_ref(remote)?;
        self.mutate(
            root,
            &["switch", "--track", "-c", name, remote],
            &[],
            None,
            cancel,
        )
        .await
    }

    pub(super) async fn branch_delete(
        &self,
        root: &Path,
        action: &Value,
        cancel: &CancellationToken,
    ) -> Result<Value, ExeoraError> {
        let name = required_string(action, "name")?;
        validate_ref(name)?;
        self.mutate(root, &["branch", "-d", name], &[], None, cancel)
            .await
    }

    async fn validate_branch(
        &self,
        root: &Path,
        branch: &str,
        cancel: &CancellationToken,
    ) -> Result<(), ExeoraError> {
        validate_ref(branch)?;
        let output = self
            .run(
                root,
                &["check-ref-format", "--branch", branch],
                None,
                cancel,
            )
            .await?;
        ensure_success(&output)
    }
}
