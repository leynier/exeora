//! Actions over a list of paths: stage, unstage, discard, delete untracked.
//! A path may name a directory, and git then takes everything under it.

use super::{GitWorkspace, run::invalid};
use crate::{
    error::{ErrorCode, ExeoraError},
    tools::path::{relative_string, resolve_in_project},
};
use serde_json::Value;
use std::{collections::HashSet, path::Path};
use tokio_util::sync::CancellationToken;

impl GitWorkspace {
    pub(super) async fn stage(
        &self,
        root: &Path,
        action: &Value,
        cancel: &CancellationToken,
    ) -> Result<Value, ExeoraError> {
        let paths = validated_paths(root, action)?;
        self.mutate(root, &["add", "--"], &paths, None, cancel)
            .await
    }

    pub(super) async fn unstage(
        &self,
        root: &Path,
        action: &Value,
        cancel: &CancellationToken,
    ) -> Result<Value, ExeoraError> {
        let paths = validated_paths(root, action)?;
        if self.resolve(root, "HEAD", cancel).await?.is_some() {
            self.mutate(root, &["restore", "--staged", "--"], &paths, None, cancel)
                .await
        } else {
            self.mutate(
                root,
                &["rm", "--cached", "--ignore-unmatch", "-r", "--"],
                &paths,
                None,
                cancel,
            )
            .await
        }
    }

    pub(super) async fn discard(
        &self,
        root: &Path,
        action: &Value,
        cancel: &CancellationToken,
    ) -> Result<Value, ExeoraError> {
        let paths = validated_paths(root, action)?;
        self.mutate(root, &["restore", "--worktree", "--"], &paths, None, cancel)
            .await
    }

    /// Every tracked change in the working tree, gone. Untracked files stay.
    pub(super) async fn discard_all(
        &self,
        root: &Path,
        cancel: &CancellationToken,
    ) -> Result<Value, ExeoraError> {
        self.mutate(
            root,
            &["restore", "--worktree", "--", "."],
            &[],
            None,
            cancel,
        )
        .await
    }

    pub(super) async fn delete_untracked(
        &self,
        root: &Path,
        action: &Value,
        cancel: &CancellationToken,
    ) -> Result<Value, ExeoraError> {
        let paths = validated_paths(root, action)?;
        let status = self.status(root, cancel).await?;
        let untracked: HashSet<&str> = status["files"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|file| file["kind"] == "untracked")
            .filter_map(|file| file["path"].as_str())
            .collect();
        for path in &paths {
            if !untracked.contains(path.as_str()) {
                return Err(ExeoraError::new(
                    ErrorCode::Forbidden,
                    format!(
                        "Refusing to delete '{path}' because Git does not report it as an untracked file."
                    ),
                ));
            }
        }
        for path in &paths {
            let (real_root, relative) = resolve_in_project(root, path)?;
            let target = real_root.join(relative);
            let metadata = std::fs::symlink_metadata(&target).map_err(|_| {
                ExeoraError::new(
                    ErrorCode::PathNotFound,
                    format!("'{path}' no longer exists."),
                )
            })?;
            if metadata.file_type().is_dir() {
                return Err(ExeoraError::new(
                    ErrorCode::Forbidden,
                    "Deleting untracked directories is not supported. Select their files instead.",
                ));
            }
            std::fs::remove_file(target).map_err(|error| {
                ExeoraError::tool(format!("Could not delete '{path}': {error}"))
            })?;
        }
        self.mutation_result(root, String::new(), String::new(), cancel)
            .await
    }
}

/// The `paths` of an action, each confined to the project. A directory is
/// admitted as it is: git resolves it to what is under it.
pub(super) fn validated_paths(root: &Path, action: &Value) -> Result<Vec<String>, ExeoraError> {
    let values = action
        .get("paths")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid("At least one path is required."))?;
    if values.is_empty() || values.len() > 1_000 {
        return Err(invalid("Between 1 and 1000 paths are required."));
    }
    values
        .iter()
        .map(|value| {
            let path = value
                .as_str()
                .ok_or_else(|| invalid("Paths must be strings."))?;
            let (_, normalized) = resolve_in_project(root, path)?;
            let normalized = relative_string(&normalized);
            if normalized.is_empty() {
                return Err(invalid("The project root cannot be selected as a file."));
            }
            Ok(normalized)
        })
        .collect()
}
