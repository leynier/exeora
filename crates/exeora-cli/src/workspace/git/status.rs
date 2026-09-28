//! `status`, what it is assembled from, and `unpublished`, which reads it.

use super::{
    GitWorkspace,
    run::{ensure_success, validate_ref},
};
use crate::error::ExeoraError;
use serde_json::{Value, json};
use std::path::Path;
use tokio_util::sync::CancellationToken;

impl GitWorkspace {
    pub(crate) async fn status(
        &self,
        root: &Path,
        cancel: &CancellationToken,
    ) -> Result<Value, ExeoraError> {
        let output = self
            .run(
                root,
                &[
                    "status",
                    "--porcelain=v2",
                    "-z",
                    "--branch",
                    "--show-stash",
                    "--untracked-files=all",
                    "--",
                    ".",
                ],
                None,
                cancel,
            )
            .await?;
        if !output.success {
            return Ok(empty_status());
        }
        let prefix = self.prefix(root, cancel).await?;
        let mut result = parse_status(&output.stdout, &prefix)?;
        result["branches"] = self.branches(root, cancel).await?;
        result["remotes"] = self.remotes(root, cancel).await?;
        result["operation"] = self.operation_state(root, cancel).await?.into();
        result["gitWorkspaces"] = self.git_worktrees(root, cancel).await?;
        Ok(result)
    }

    /// Where the project root is inside the repository, with a trailing slash,
    /// or empty when it is the repository's root.
    pub(super) async fn prefix(
        &self,
        root: &Path,
        cancel: &CancellationToken,
    ) -> Result<String, ExeoraError> {
        Ok(self
            .text(root, &["rev-parse", "--show-prefix"], cancel)
            .await?
            .trim()
            .to_owned())
    }

    async fn branches(
        &self,
        root: &Path,
        cancel: &CancellationToken,
    ) -> Result<Value, ExeoraError> {
        let output = self
            .run(
                root,
                &[
                    "for-each-ref",
                    "--format=%(refname)%09%(objectname:short)%09%(upstream:short)%09%(upstream:track)",
                    "refs/heads",
                    "refs/remotes",
                ],
                None,
                cancel,
            )
            .await?;
        ensure_success(&output)?;
        let current = self.current_branch(root, cancel).await?;
        let values = String::from_utf8_lossy(&output.stdout)
            .lines()
            .filter_map(|line| {
                let mut fields = line.split('\t');
                let full = fields.next()?;
                let short_oid = fields.next().unwrap_or_default();
                let upstream = fields.next().unwrap_or_default();
                let track = fields.next().unwrap_or_default();
                let (name, remote) = if let Some(name) = full.strip_prefix("refs/heads/") {
                    (name, false)
                } else {
                    (full.strip_prefix("refs/remotes/")?, true)
                };
                if name.ends_with("/HEAD") {
                    return None;
                }
                Some(json!({
                    "name": name,
                    "shortOid": short_oid,
                    "upstream": if upstream.is_empty() { Value::Null } else { json!(upstream) },
                    "ahead": if remote || upstream.is_empty() { Value::Null } else { ahead_of_upstream(track) },
                    "remote": remote,
                    "current": !remote && current.as_deref() == Some(name),
                }))
            })
            .collect::<Vec<_>>();
        Ok(json!(values))
    }

    /// The checked-out branch, or none on a detached HEAD.
    pub(super) async fn current_branch(
        &self,
        root: &Path,
        cancel: &CancellationToken,
    ) -> Result<Option<String>, ExeoraError> {
        let current = self
            .run(root, &["branch", "--show-current"], None, cancel)
            .await?
            .stdout;
        let current = String::from_utf8_lossy(&current).trim().to_owned();
        Ok((!current.is_empty()).then_some(current))
    }

    async fn remotes(&self, root: &Path, cancel: &CancellationToken) -> Result<Value, ExeoraError> {
        let output = self.run(root, &["remote"], None, cancel).await?;
        ensure_success(&output)?;
        Ok(json!(
            String::from_utf8_lossy(&output.stdout)
                .lines()
                .filter(|line| !line.is_empty())
                .collect::<Vec<_>>()
        ))
    }

    async fn git_worktrees(
        &self,
        root: &Path,
        cancel: &CancellationToken,
    ) -> Result<Value, ExeoraError> {
        let output = self
            .run(root, &["worktree", "list", "--porcelain"], None, cancel)
            .await?;
        if !output.success {
            return Ok(json!([]));
        }
        Ok(json!(parse_worktree_list(&output.stdout)))
    }

    async fn operation_state(
        &self,
        root: &Path,
        cancel: &CancellationToken,
    ) -> Result<Option<&'static str>, ExeoraError> {
        for (name, marker) in [
            ("merge", "MERGE_HEAD"),
            ("rebase", "rebase-merge"),
            ("rebase", "rebase-apply"),
            ("cherry-pick", "CHERRY_PICK_HEAD"),
            ("revert", "REVERT_HEAD"),
            ("bisect", "BISECT_LOG"),
        ] {
            let output = self
                .run(root, &["rev-parse", "--git-path", marker], None, cancel)
                .await?;
            if output.success {
                let marker_path = String::from_utf8_lossy(&output.stdout).trim().to_owned();
                let marker_path = if Path::new(&marker_path).is_absolute() {
                    marker_path.into()
                } else {
                    root.join(marker_path)
                };
                if marker_path.exists() {
                    return Ok(Some(name));
                }
            }
        }
        Ok(None)
    }

    /// The hash of a revision, or none when it does not resolve.
    pub(super) async fn resolve(
        &self,
        root: &Path,
        revision: &str,
        cancel: &CancellationToken,
    ) -> Result<Option<String>, ExeoraError> {
        let output = self
            .run(
                root,
                &["rev-parse", "--verify", "--quiet", revision],
                None,
                cancel,
            )
            .await?;
        if !output.success {
            return Ok(None);
        }
        Ok(Some(
            String::from_utf8_lossy(&output.stdout).trim().to_owned(),
        ))
    }

    /// Where `base` and HEAD part ways.
    pub(super) async fn merge_base(
        &self,
        root: &Path,
        base: &str,
        cancel: &CancellationToken,
    ) -> Result<String, ExeoraError> {
        validate_ref(base)?;
        let output = self
            .run(root, &["merge-base", base, "HEAD"], None, cancel)
            .await?;
        if !output.success {
            return Err(ExeoraError::tool(format!(
                "No common history between '{base}' and HEAD: {}",
                String::from_utf8_lossy(&output.stderr).trim()
            )));
        }
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_owned())
    }

    /// What the remote does not have, named. Fetches first, so every remote
    /// tip is here to compare against, and asks the remote for its tags,
    /// which no tracking ref records. Then a branch or tag never pushed, a
    /// branch with commits past its remote counterpart, and a detached HEAD
    /// with commits on it are each reported; so is anything uncommitted,
    /// stashed, or checked out elsewhere. Conservative on purpose: what
    /// cannot be shown to be on the remote is reported as not there.
    pub(super) async fn unpublished(
        &self,
        root: &Path,
        cancel: &CancellationToken,
    ) -> Result<Value, ExeoraError> {
        let mut reasons = Vec::new();

        // The remote as it is now: its branches as tracking refs, its tags as
        // a list, since tags have no tracking refs of their own.
        let fetched = self
            .run(
                root,
                &["fetch", "--prune", "--quiet", "origin"],
                None,
                cancel,
            )
            .await?;
        if !fetched.success {
            return Err(ExeoraError::tool(format!(
                "Could not fetch from the remote: {}",
                String::from_utf8_lossy(&fetched.stderr).trim()
            )));
        }
        let remote = self
            .run(root, &["ls-remote", "--tags", "origin"], None, cancel)
            .await?;
        if !remote.success {
            return Err(ExeoraError::tool(format!(
                "Could not ask the remote for its tags: {}",
                String::from_utf8_lossy(&remote.stderr).trim()
            )));
        }

        // The working tree, read after the fetch so the window between the
        // two is as short as it can be. A status that could not be read is an
        // empty one, which reads as clean; for a question whose wrong answer
        // destroys the only copy, that is a refusal, not a pass.
        let status = self.status(root, cancel).await?;
        if status["repository"] != true {
            return Err(ExeoraError::tool(
                "Could not read the working tree's status, so nothing can be said to be safe to remove.",
            ));
        }
        let files = status["files"].as_array().map_or(0, Vec::len);
        if files > 0 {
            reasons.push(format!("{files} uncommitted change(s)"));
        }
        let stashes = status["stashes"].as_u64().unwrap_or(0);
        if stashes > 0 {
            reasons.push(format!(
                "{stashes} stash entr{}",
                if stashes == 1 { "y" } else { "ies" }
            ));
        }
        let checkouts = status["gitWorkspaces"].as_array().map_or(0, Vec::len);
        if checkouts > 1 {
            reasons.push(format!("{} additional checkout(s)", checkouts - 1));
        }

        let remote_tags: std::collections::HashMap<String, String> =
            String::from_utf8_lossy(&remote.stdout)
                .lines()
                .filter_map(|line| {
                    let (sha, name) = line.split_once('\t')?;
                    // Annotated tags list their target too; the tag itself is enough.
                    (!name.ends_with("^{}")).then(|| (name.to_owned(), sha.to_owned()))
                })
                .collect();

        let local = self
            .text(
                root,
                &[
                    "for-each-ref",
                    "--format=%(refname)%09%(objectname)",
                    "refs/heads",
                    "refs/tags",
                ],
                cancel,
            )
            .await?;
        for line in local.lines() {
            let Some((name, sha)) = line.split_once('\t') else {
                continue;
            };
            if let Some(branch) = name.strip_prefix("refs/heads/") {
                let tracking = format!("refs/remotes/origin/{branch}");
                if self.resolve(root, &tracking, cancel).await?.is_none() {
                    reasons.push(format!("{branch} was never pushed"));
                    continue;
                }
                let ahead = self
                    .count_commits(root, &format!("{tracking}..{sha}"), cancel)
                    .await?;
                if ahead > 0 {
                    reasons.push(format!(
                        "{branch} has {ahead} commit(s) the remote does not"
                    ));
                }
            } else if let Some(tag) = name.strip_prefix("refs/tags/") {
                match remote_tags.get(name) {
                    None => reasons.push(format!("{tag} was never pushed")),
                    Some(remote_sha) if remote_sha != sha => {
                        reasons.push(format!("{tag} differs from the remote's"));
                    }
                    Some(_) => {}
                }
            }
        }

        // A detached HEAD is on no branch, and its commits are on none either.
        if status["head"].is_null() && status["oid"].is_string() {
            let ahead = self
                .count_commits(root, "HEAD --not --remotes", cancel)
                .await?;
            if ahead > 0 {
                reasons.push(format!("HEAD has {ahead} commit(s) the remote does not"));
            }
        }
        Ok(json!({ "kind": "unpublished", "clean": reasons.is_empty(), "reasons": reasons }))
    }

    /// `git rev-list --count` over a range or a revision expression.
    async fn count_commits(
        &self,
        root: &Path,
        range: &str,
        cancel: &CancellationToken,
    ) -> Result<u64, ExeoraError> {
        let mut args = vec!["rev-list", "--count"];
        args.extend(range.split_whitespace());
        Ok(self
            .text(root, &args, cancel)
            .await?
            .trim()
            .parse()
            .unwrap_or(0))
    }
}

/// How far a local branch is past its upstream, from `%(upstream:track)`:
/// `[ahead 2]`, `[ahead 2, behind 1]`, `[behind 1]`, `[gone]` or nothing when
/// they are level. Null for `gone`: the remote branch is no longer there, so
/// there is nothing to compare with and the commits are as good as unpushed.
pub(super) fn ahead_of_upstream(track: &str) -> Value {
    let inner = track.trim().trim_start_matches('[').trim_end_matches(']');
    if inner == "gone" {
        return Value::Null;
    }
    let ahead = inner
        .split(',')
        .map(str::trim)
        .find_map(|part| part.strip_prefix("ahead "))
        .and_then(|count| count.trim().parse::<u64>().ok())
        .unwrap_or(0);
    json!(ahead)
}

pub(super) fn parse_status(bytes: &[u8], prefix: &str) -> Result<Value, ExeoraError> {
    let mut head = None;
    let mut oid = None;
    let mut upstream = None;
    let mut ahead = 0;
    let mut behind = 0;
    let mut stashes = 0;
    let mut files = Vec::new();
    let records = bytes.split(|byte| *byte == 0).collect::<Vec<_>>();
    let mut index = 0;
    while index < records.len() {
        let record = String::from_utf8_lossy(records[index]);
        if let Some(value) = record.strip_prefix("# branch.head ") {
            head = (value != "(detached)").then(|| value.to_owned());
        } else if let Some(value) = record.strip_prefix("# branch.oid ") {
            oid = (value != "(initial)").then(|| value.to_owned());
        } else if let Some(value) = record.strip_prefix("# branch.upstream ") {
            upstream = Some(value.to_owned());
        } else if let Some(value) = record.strip_prefix("# stash ") {
            // Printed only with --show-stash, and only when there is one.
            stashes = value.trim().parse().unwrap_or(0);
        } else if let Some(value) = record.strip_prefix("# branch.ab ") {
            for field in value.split_whitespace() {
                if let Some(value) = field.strip_prefix('+') {
                    ahead = value.parse().unwrap_or(0);
                } else if let Some(value) = field.strip_prefix('-') {
                    behind = value.parse().unwrap_or(0);
                }
            }
        } else if record.starts_with("1 ") {
            let fields = record.splitn(9, ' ').collect::<Vec<_>>();
            if fields.len() == 9
                && let Some(file) =
                    file_json(fields[8], fields[1], fields[2], "tracked", None, prefix)
            {
                files.push(file);
            }
        } else if record.starts_with("2 ") {
            let fields = record.splitn(10, ' ').collect::<Vec<_>>();
            if fields.len() == 10 {
                index += 1;
                let original = records
                    .get(index)
                    .map(|value| String::from_utf8_lossy(value));
                if let Some(file) = file_json(
                    fields[9],
                    fields[1],
                    fields[2],
                    "tracked",
                    original.as_deref(),
                    prefix,
                ) {
                    files.push(file);
                }
            }
        } else if record.starts_with("u ") {
            let fields = record.splitn(11, ' ').collect::<Vec<_>>();
            if fields.len() == 11
                && let Some(file) =
                    file_json(fields[10], fields[1], fields[2], "conflict", None, prefix)
            {
                files.push(file);
            }
        } else if let Some(path) = record.strip_prefix("? ")
            && let Some(file) = file_json(path, "??", "N...", "untracked", None, prefix)
        {
            files.push(file);
        }
        index += 1;
    }
    Ok(json!({
        "kind": "status", "repository": true, "head": head, "oid": oid,
        "upstream": upstream, "ahead": ahead, "behind": behind,
        "operation": Value::Null, "files": files, "branches": [], "remotes": [],
        "gitWorkspaces": [], "stashes": stashes,
    }))
}

fn file_json(
    path: &str,
    xy: &str,
    sub: &str,
    kind: &str,
    original: Option<&str>,
    prefix: &str,
) -> Option<Value> {
    let path = project_relative(path, prefix)?;
    let original = original.and_then(|value| project_relative(value, prefix));
    let mut chars = xy.chars();
    let mut file = json!({
        "path": path,
        "index": chars.next().unwrap_or('.').to_string(),
        "worktree": chars.next().unwrap_or('.').to_string(),
        "kind": kind,
        "submodule": sub != "N...",
    });
    if let Some(original) = original {
        file["originalPath"] = json!(original);
    }
    Some(file)
}

fn project_relative(path: &str, prefix: &str) -> Option<String> {
    if prefix.is_empty() {
        return Some(path.to_owned());
    }
    path.strip_prefix(prefix).map(str::to_owned)
}

pub(super) fn parse_worktree_list(bytes: &[u8]) -> Vec<Value> {
    let mut worktrees = Vec::new();
    let mut path = None;
    let mut branch = Value::Null;
    let flush = |worktrees: &mut Vec<Value>, path: &mut Option<String>, branch: &mut Value| {
        if let Some(path) = path.take() {
            worktrees.push(json!({ "path": path, "branch": std::mem::take(branch) }));
        }
    };
    for line in String::from_utf8_lossy(bytes).lines() {
        if let Some(value) = line.strip_prefix("worktree ") {
            flush(&mut worktrees, &mut path, &mut branch);
            path = Some(value.to_owned());
        } else if let Some(value) = line.strip_prefix("branch ") {
            branch = json!(value.strip_prefix("refs/heads/").unwrap_or(value));
        } else if line == "detached" {
            branch = Value::Null;
        } else if line.is_empty() {
            flush(&mut worktrees, &mut path, &mut branch);
        }
    }
    flush(&mut worktrees, &mut path, &mut branch);
    worktrees
}

fn empty_status() -> Value {
    json!({
        "kind": "status", "repository": false, "head": Value::Null, "oid": Value::Null,
        "upstream": Value::Null, "ahead": 0, "behind": 0, "operation": Value::Null,
        "files": [], "branches": [], "remotes": [], "gitWorkspaces": [], "stashes": 0,
    })
}
