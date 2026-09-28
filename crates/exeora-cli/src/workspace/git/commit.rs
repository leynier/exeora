//! Making a commit, and remaking the last one.

use super::{
    GitWorkspace,
    run::{ensure_success, invalid, required_string},
};
use crate::error::{ErrorCode, ExeoraError};
use serde_json::Value;
use std::path::Path;
use tokio_util::sync::CancellationToken;

impl GitWorkspace {
    pub(super) async fn commit(
        &self,
        root: &Path,
        action: &Value,
        cancel: &CancellationToken,
    ) -> Result<Value, ExeoraError> {
        let message = required_string(action, "message")?.trim();
        if message.is_empty() {
            return Err(invalid("Commit message cannot be empty."));
        }
        self.ensure_staged_within_root(root, cancel).await?;
        self.mutate(
            root,
            &["commit", "--file=-"],
            &[],
            Some(message.as_bytes()),
            cancel,
        )
        .await
    }

    /// The last commit again, with what is staged and, when given, a new
    /// message. Without one the message stays as it was.
    pub(super) async fn amend(
        &self,
        root: &Path,
        action: &Value,
        cancel: &CancellationToken,
    ) -> Result<Value, ExeoraError> {
        let message = action
            .get("message")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|message| !message.is_empty());
        self.ensure_staged_within_root(root, cancel).await?;
        match message {
            Some(message) => {
                self.mutate(
                    root,
                    &["commit", "--amend", "--file=-"],
                    &[],
                    Some(message.as_bytes()),
                    cancel,
                )
                .await
            }
            None => {
                self.mutate(root, &["commit", "--amend", "--no-edit"], &[], None, cancel)
                    .await
            }
        }
    }

    /// A project that is a directory of a repository must not commit what was
    /// staged outside it, which git would do without asking.
    pub(super) async fn ensure_staged_within_root(
        &self,
        root: &Path,
        cancel: &CancellationToken,
    ) -> Result<(), ExeoraError> {
        let prefix = self.prefix(root, cancel).await?;
        if prefix.is_empty() {
            return Ok(());
        }
        let staged = self
            .run(
                root,
                &["diff", "--cached", "--name-only", "-z"],
                None,
                cancel,
            )
            .await?;
        ensure_success(&staged)?;
        let outside = staged
            .stdout
            .split(|byte| *byte == 0)
            .any(|path| !path.is_empty() && !String::from_utf8_lossy(path).starts_with(&prefix));
        if outside {
            return Err(ExeoraError::new(
                ErrorCode::Forbidden,
                "The Git index contains staged files outside this Exeora project. Commit them separately or unstage them first.",
            ));
        }
        Ok(())
    }
}
