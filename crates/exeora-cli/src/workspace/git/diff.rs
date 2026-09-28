//! Patches: one file, the whole tree, a commit, a range; and the list of
//! files a diff touches, which the history and the assistant context share.

use super::{
    GitWorkspace,
    run::{
        MAX_GIT_OUTPUT, NULL_DEVICE, bounded_patch, ensure_success, invalid, is_binary_patch,
        required_string, validate_oid,
    },
};
use crate::{
    error::ExeoraError,
    tools::path::{relative_string, resolve_in_project},
};
use serde_json::{Value, json};
use std::{collections::HashMap, path::Path};
use tokio_util::sync::CancellationToken;

/// Same flags for every patch: no external tools, no colour, three lines of
/// context, renames, and paths relative to the project root.
pub(super) const PATCH_FLAGS: &[&str] = &[
    "--no-ext-diff",
    "--no-textconv",
    "--no-color",
    "--unified=3",
    "-M",
    "--relative",
];

impl GitWorkspace {
    pub(super) async fn diff(
        &self,
        root: &Path,
        path: &str,
        area: &str,
        cancel: &CancellationToken,
    ) -> Result<Value, ExeoraError> {
        let (_, relative) = resolve_in_project(root, path)?;
        let relative = relative_string(&relative);
        let mut args = vec!["diff"];
        args.extend(PATCH_FLAGS);
        match area {
            "working" => {}
            "staged" => args.push("--cached"),
            _ => return Err(invalid("Diff area must be working or staged.")),
        }
        args.extend(["--", relative.as_str()]);
        let mut output = self.run(root, &args, None, cancel).await?;
        ensure_success(&output)?;
        if area == "working"
            && output.stdout.is_empty()
            && self.is_untracked(root, &relative, cancel).await?
        {
            output = self.untracked_patch(root, &relative, cancel).await?;
        }
        let (patch, truncated) = bounded_patch(&output.stdout, MAX_GIT_OUTPUT);
        Ok(json!({
            "kind": "diff",
            "path": relative,
            "area": area,
            "binary": is_binary_patch(&patch),
            "truncated": truncated,
            "patch": patch,
        }))
    }

    /// `git diff` never shows a file the index does not know. Compared with
    /// the null device, a new file reads as all additions.
    async fn untracked_patch(
        &self,
        root: &Path,
        relative: &str,
        cancel: &CancellationToken,
    ) -> Result<super::GitOutput, ExeoraError> {
        let output = self
            .run(
                root,
                &[
                    "diff",
                    "--no-index",
                    "--no-ext-diff",
                    "--no-textconv",
                    "--no-color",
                    "--unified=3",
                    "--",
                    NULL_DEVICE,
                    relative,
                ],
                None,
                cancel,
            )
            .await?;
        // With --no-index, 1 means "the files differ", not a failure.
        if !output.success && output.code != Some(1) {
            ensure_success(&output)?;
        }
        Ok(output)
    }

    async fn is_untracked(
        &self,
        root: &Path,
        relative: &str,
        cancel: &CancellationToken,
    ) -> Result<bool, ExeoraError> {
        let output = self
            .run(
                root,
                &["ls-files", "--others", "--exclude-standard", "--", relative],
                None,
                cancel,
            )
            .await?;
        Ok(output.success && !output.stdout.is_empty())
    }

    /// The whole working tree or index as one patch. Untracked files are
    /// appended one by one, as far as the output cap allows.
    pub(super) async fn diff_all(
        &self,
        root: &Path,
        area: &str,
        cancel: &CancellationToken,
    ) -> Result<Value, ExeoraError> {
        let mut args = vec!["diff"];
        args.extend(PATCH_FLAGS);
        match area {
            "working" => {}
            "staged" => args.push("--cached"),
            _ => return Err(invalid("Diff area must be working or staged.")),
        }
        args.extend(["--", "."]);
        let output = self.run(root, &args, None, cancel).await?;
        ensure_success(&output)?;
        let mut patch = output.stdout;
        let mut untracked_omitted = false;
        if area == "working" {
            let listed = self
                .run(
                    root,
                    &[
                        "ls-files",
                        "--others",
                        "--exclude-standard",
                        "-z",
                        "--",
                        ".",
                    ],
                    None,
                    cancel,
                )
                .await?;
            ensure_success(&listed)?;
            for entry in listed.stdout.split(|byte| *byte == 0) {
                if entry.is_empty() {
                    continue;
                }
                if patch.len() >= MAX_GIT_OUTPUT {
                    untracked_omitted = true;
                    break;
                }
                let relative = String::from_utf8_lossy(entry).into_owned();
                let file = self.untracked_patch(root, &relative, cancel).await?;
                patch.extend_from_slice(&file.stdout);
            }
        }
        let (patch, truncated) = bounded_patch(&patch, MAX_GIT_OUTPUT);
        Ok(json!({
            "kind": "diff_all",
            "area": area,
            "patch": patch,
            "truncated": truncated,
            "untrackedOmitted": untracked_omitted,
        }))
    }

    /// The patch of one commit, or of one of its files.
    pub(super) async fn commit_diff(
        &self,
        root: &Path,
        action: &Value,
        cancel: &CancellationToken,
    ) -> Result<Value, ExeoraError> {
        let oid = required_string(action, "oid")?;
        validate_oid(oid)?;
        let path = match action.get("path").and_then(Value::as_str) {
            Some(path) => Some(relative_string(&resolve_in_project(root, path)?.1)),
            None => None,
        };
        let commit = self.commit_tree(root, oid, cancel).await?;
        let mut args = commit.iter().map(String::as_str).collect::<Vec<_>>();
        args.push("-p");
        args.extend(PATCH_FLAGS);
        if let Some(path) = &path {
            args.extend(["--", path.as_str()]);
        }
        let output = self.run(root, &args, None, cancel).await?;
        ensure_success(&output)?;
        let (patch, truncated) = bounded_patch(&output.stdout, MAX_GIT_OUTPUT);
        Ok(json!({
            "kind": "commit_diff",
            "oid": commit.last().cloned().unwrap_or_default(),
            "path": path,
            "patch": patch,
            "binary": is_binary_patch(&patch),
            "truncated": truncated,
        }))
    }

    /// Everything on HEAD since it parted from `base`.
    pub(super) async fn range_diff(
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
        let range = ["diff", merge_base.as_str(), "HEAD"];
        let mut args = range.to_vec();
        args.extend(PATCH_FLAGS);
        args.extend(["--", "."]);
        let output = self.run(root, &args, None, cancel).await?;
        ensure_success(&output)?;
        let (patch, truncated) = bounded_patch(&output.stdout, MAX_GIT_OUTPUT);
        let files = self.changed_files(root, &range, cancel).await?;
        Ok(json!({
            "kind": "range_diff",
            "base": base,
            "head": head,
            "mergeBase": merge_base,
            "patch": patch,
            "truncated": truncated,
            "files": files,
        }))
    }

    /// The `diff-tree` that shows a commit against its first parent, or the
    /// whole tree for a commit without one. Ends with the commit's full hash.
    pub(super) async fn commit_tree(
        &self,
        root: &Path,
        oid: &str,
        cancel: &CancellationToken,
    ) -> Result<Vec<String>, ExeoraError> {
        let listed = self
            .run(
                root,
                &["rev-list", "--parents", "-n", "1", oid],
                None,
                cancel,
            )
            .await?;
        if !listed.success {
            return Err(ExeoraError::tool(format!("Unknown commit '{oid}'.")));
        }
        let listed = String::from_utf8_lossy(&listed.stdout);
        let mut hashes = listed.split_whitespace().map(str::to_owned);
        let full = hashes
            .next()
            .ok_or_else(|| ExeoraError::tool(format!("Unknown commit '{oid}'.")))?;
        let mut args = vec![
            "diff-tree".to_owned(),
            "-r".to_owned(),
            "--no-commit-id".to_owned(),
        ];
        match hashes.next() {
            Some(parent) => args.extend([parent, full]),
            None => args.extend(["--root".to_owned(), full]),
        }
        Ok(args)
    }

    /// The files a diff touches, with their line counts: `--name-status`
    /// for what happened to each, `--numstat` for how much.
    pub(super) async fn changed_files(
        &self,
        root: &Path,
        diff: &[&str],
        cancel: &CancellationToken,
    ) -> Result<Vec<Value>, ExeoraError> {
        let mut status = diff.to_vec();
        status.extend(["--name-status", "-z", "-M", "--relative"]);
        let mut numbers = diff.to_vec();
        numbers.extend(["--numstat", "-z", "-M", "--relative"]);
        let status = self.run(root, &status, None, cancel).await?;
        ensure_success(&status)?;
        let numbers = self.run(root, &numbers, None, cancel).await?;
        ensure_success(&numbers)?;
        let counts = parse_numstat(&numbers.stdout);
        Ok(parse_name_status(&status.stdout)
            .into_iter()
            .map(|(status, old_path, path)| {
                let (additions, deletions, binary) =
                    counts
                        .get(&path)
                        .copied()
                        .map_or((0, 0, false), |(added, deleted)| match (added, deleted) {
                            (Some(added), Some(deleted)) => (added, deleted, false),
                            _ => (0, 0, true),
                        });
                let mut file = json!({
                    "path": path,
                    "status": status,
                    "additions": additions,
                    "deletions": deletions,
                    "binary": binary,
                });
                if let Some(old) = old_path {
                    file["oldPath"] = json!(old);
                }
                file
            })
            .collect())
    }
}

/// `-z --numstat`: `added\tdeleted\tpath\0`, or for a rename
/// `added\tdeleted\t\0old\0new\0`. A dash for a count is a binary file.
fn parse_numstat(bytes: &[u8]) -> HashMap<String, (Option<u64>, Option<u64>)> {
    let records = bytes
        .split(|byte| *byte == 0)
        .map(|record| String::from_utf8_lossy(record).into_owned())
        .collect::<Vec<_>>();
    let mut counts = HashMap::new();
    let mut index = 0;
    while index < records.len() {
        let mut fields = records[index].splitn(3, '\t');
        let added = fields.next().and_then(|value| value.parse().ok());
        let deleted = fields.next().and_then(|value| value.parse().ok());
        let path = fields.next().unwrap_or_default();
        let path = if path.is_empty() {
            // A rename: the old and the new path follow as records of their own.
            index += 2;
            records.get(index).cloned().unwrap_or_default()
        } else {
            path.to_owned()
        };
        if !path.is_empty() {
            counts.insert(path, (added, deleted));
        }
        index += 1;
    }
    counts
}

/// `-z --name-status`: `M\0path\0`, or `R100\0old\0new\0` for a rename or copy.
fn parse_name_status(bytes: &[u8]) -> Vec<(String, Option<String>, String)> {
    let records = bytes
        .split(|byte| *byte == 0)
        .map(|record| String::from_utf8_lossy(record).into_owned())
        .collect::<Vec<_>>();
    let mut files = Vec::new();
    let mut index = 0;
    while index + 1 < records.len() {
        let status = records[index].chars().next().unwrap_or('M');
        let status = match status {
            'A' | 'M' | 'D' | 'R' | 'C' | 'T' => status,
            _ => 'M',
        };
        if matches!(status, 'R' | 'C') {
            if let (Some(old), Some(new)) = (records.get(index + 1), records.get(index + 2)) {
                files.push((status.to_string(), Some(old.clone()), new.clone()));
            }
            index += 3;
        } else {
            files.push((status.to_string(), None, records[index + 1].clone()));
            index += 2;
        }
    }
    files
}

#[cfg(test)]
mod tests {
    use super::{parse_name_status, parse_numstat};

    #[test]
    fn reads_numstat_and_name_status_including_renames_and_binaries() {
        let counts = parse_numstat(b"3\t1\ta.txt\0-\t-\tlogo.png\x001\t0\t\0old.txt\0new.txt\0");
        assert_eq!(counts["a.txt"], (Some(3), Some(1)));
        assert_eq!(counts["logo.png"], (None, None));
        assert_eq!(counts["new.txt"], (Some(1), Some(0)));

        let files = parse_name_status(b"M\0a.txt\0R100\0old.txt\0new.txt\0A\0logo.png\0");
        assert_eq!(files[0], ("M".to_owned(), None, "a.txt".to_owned()));
        assert_eq!(
            files[1],
            (
                "R".to_owned(),
                Some("old.txt".to_owned()),
                "new.txt".to_owned()
            )
        );
        assert_eq!(files[2].2, "logo.png");
    }
}
