//! What an assistant reads before writing a commit message or a pull
//! request: the files, a bounded patch, and for a range its commits.

use super::{
    GitWorkspace,
    diff::PATCH_FLAGS,
    run::{bounded_patch, ensure_success},
};
use crate::error::ExeoraError;
use serde_json::{Value, json};
use std::path::Path;
use tokio_util::sync::CancellationToken;

/// A prompt has less room than a diff viewer.
const CONTEXT_PATCH_LIMIT: usize = 200_000;
const CONTEXT_COMMITS: &str = "--max-count=40";

impl GitWorkspace {
    pub(super) async fn staged_context(
        &self,
        root: &Path,
        cancel: &CancellationToken,
    ) -> Result<Value, ExeoraError> {
        let branch = self.current_branch(root, cancel).await?;
        let staged = ["diff", "--cached"];
        let files = self.changed_files(root, &staged, cancel).await?;
        let mut args = staged.to_vec();
        args.extend(PATCH_FLAGS);
        args.extend(["--", "."]);
        let output = self.run(root, &args, None, cancel).await?;
        ensure_success(&output)?;
        let (patch, truncated) = bounded_patch(&output.stdout, CONTEXT_PATCH_LIMIT);
        Ok(json!({
            "kind": "staged_context",
            "branch": branch,
            "files": files,
            "patch": patch,
            "truncated": truncated,
        }))
    }

    pub(super) async fn range_context(
        &self,
        root: &Path,
        base: &str,
        cancel: &CancellationToken,
    ) -> Result<Value, ExeoraError> {
        let merge_base = self.merge_base(root, base, cancel).await?;
        let head = self
            .resolve(root, "HEAD", cancel)
            .await?
            .ok_or_else(|| ExeoraError::tool("HEAD does not resolve to a commit."))?;
        let span = format!("{merge_base}..HEAD");
        let listed = self
            .text(
                root,
                &[
                    "log",
                    CONTEXT_COMMITS,
                    "--format=%H%x1f%s%x1f%b%x1f%an%x1e",
                    &span,
                ],
                cancel,
            )
            .await?;
        let commits = listed
            .split('\u{1e}')
            .map(str::trim)
            .filter(|record| !record.is_empty())
            .map(|record| {
                let mut fields = record.split('\u{1f}');
                let mut next = || fields.next().unwrap_or_default().trim().to_owned();
                json!({ "oid": next(), "subject": next(), "body": next(), "author": next() })
            })
            .collect::<Vec<_>>();
        let range = ["diff", merge_base.as_str(), "HEAD"];
        let files = self.changed_files(root, &range, cancel).await?;
        let mut args = range.to_vec();
        args.extend(PATCH_FLAGS);
        args.extend(["--", "."]);
        let output = self.run(root, &args, None, cancel).await?;
        ensure_success(&output)?;
        let (patch, truncated) = bounded_patch(&output.stdout, CONTEXT_PATCH_LIMIT);
        Ok(json!({
            "kind": "range_context",
            "base": base,
            "head": head,
            "mergeBase": merge_base,
            "commits": commits,
            "files": files,
            "patch": patch,
            "truncated": truncated,
        }))
    }
}
