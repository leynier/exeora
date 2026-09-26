use crate::{
    error::{ErrorCode, ExeoraError},
    tools::path::{relative_string, resolve_in_project},
};
use serde_json::{Value, json};
use std::{collections::HashSet, path::Path, process::Stdio, time::Duration};
use tokio::{io::AsyncWriteExt, process::Command, sync::Mutex};
use tokio_util::sync::CancellationToken;

const MAX_GIT_OUTPUT: usize = 900_000;
const GIT_TIMEOUT: Duration = Duration::from_secs(300);
/// ssh reads host-key and passphrase prompts from the terminal, which
/// `GIT_TERMINAL_PROMPT` does not cover; they would block until the timeout.
const NON_INTERACTIVE_SSH: &str = "ssh -o BatchMode=yes";
#[cfg(windows)]
const NULL_DEVICE: &str = "NUL";
#[cfg(not(windows))]
const NULL_DEVICE: &str = "/dev/null";

pub struct GitWorkspace {
    operation: Mutex<()>,
}

struct GitOutput {
    success: bool,
    code: Option<i32>,
    stdout: Vec<u8>,
    stderr: Vec<u8>,
}

impl GitWorkspace {
    pub fn new() -> Self {
        Self {
            operation: Mutex::new(()),
        }
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
        // Reads skip the lock (and take no optional index locks), so the
        // dashboard's status poll never queues behind a slow push or pull.
        let _guard = if matches!(name, "status" | "diff" | "unpublished") {
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
            "stage" => {
                let paths = validated_paths(root, &action)?;
                self.mutate(root, &["add", "--"], &paths, None, &cancel)
                    .await
            }
            "unstage" => {
                let paths = validated_paths(root, &action)?;
                let has_head = self
                    .run(root, &["rev-parse", "--verify", "HEAD"], None, &cancel)
                    .await?
                    .success;
                if has_head {
                    self.mutate(root, &["restore", "--staged", "--"], &paths, None, &cancel)
                        .await
                } else {
                    self.mutate(
                        root,
                        &["rm", "--cached", "--ignore-unmatch", "-r", "--"],
                        &paths,
                        None,
                        &cancel,
                    )
                    .await
                }
            }
            "discard" => {
                let paths = validated_paths(root, &action)?;
                self.mutate(
                    root,
                    &["restore", "--worktree", "--"],
                    &paths,
                    None,
                    &cancel,
                )
                .await
            }
            "delete_untracked" => self.delete_untracked(root, &action, &cancel).await,
            "commit" => {
                let message = required_string(&action, "message")?.trim();
                if message.is_empty() {
                    return Err(invalid("Commit message cannot be empty."));
                }
                self.ensure_staged_within_root(root, &cancel).await?;
                self.mutate(
                    root,
                    &["commit", "--file=-"],
                    &[],
                    Some(message.as_bytes()),
                    &cancel,
                )
                .await
            }
            "fetch" => {
                let mut args = vec!["fetch", "--prune"];
                if action.get("all").and_then(Value::as_bool).unwrap_or(false) {
                    args.push("--all");
                } else if let Some(remote) = action.get("remote").and_then(Value::as_str) {
                    validate_ref(remote)?;
                    args.push(remote);
                }
                self.network(root, &args, &cancel).await
            }
            "pull" => {
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
                self.network(root, &args, &cancel).await
            }
            "push" => {
                let mut args = vec!["push"];
                let remote = action.get("remote").and_then(Value::as_str);
                if action
                    .get("setUpstream")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
                {
                    let remote = remote.ok_or_else(|| {
                        invalid("A remote is required when setting the upstream branch.")
                    })?;
                    validate_ref(remote)?;
                    args.extend(["--set-upstream", remote, "HEAD"]);
                } else if let Some(remote) = remote {
                    validate_ref(remote)?;
                    args.push(remote);
                }
                self.network(root, &args, &cancel).await
            }
            "branch_create" => {
                let name = required_string(&action, "name")?;
                self.validate_branch(root, name, &cancel).await?;
                // Create and check out, the way a git client's branch picker does.
                let mut args = vec!["switch", "-c", name];
                if let Some(start) = action.get("startPoint").and_then(Value::as_str) {
                    validate_ref(start)?;
                    args.push(start);
                }
                self.mutate(root, &args, &[], None, &cancel).await
            }
            "branch_switch" => {
                let name = required_string(&action, "name")?;
                validate_ref(name)?;
                self.mutate(root, &["switch", name], &[], None, &cancel)
                    .await
            }
            "branch_track" => {
                let name = required_string(&action, "name")?;
                let remote = required_string(&action, "remoteBranch")?;
                self.validate_branch(root, name, &cancel).await?;
                validate_ref(remote)?;
                self.mutate(
                    root,
                    &["switch", "--track", "-c", name, remote],
                    &[],
                    None,
                    &cancel,
                )
                .await
            }
            "branch_delete" => {
                let name = required_string(&action, "name")?;
                validate_ref(name)?;
                self.mutate(root, &["branch", "-d", name], &[], None, &cancel)
                    .await
            }
            _ => Err(invalid("Unsupported workspace action.")),
        }
    }

    async fn status(&self, root: &Path, cancel: &CancellationToken) -> Result<Value, ExeoraError> {
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
        let prefix = self
            .run(root, &["rev-parse", "--show-prefix"], None, cancel)
            .await?;
        ensure_success(&prefix)?;
        let prefix = String::from_utf8_lossy(&prefix.stdout).trim().to_owned();
        let mut result = parse_status(&output.stdout, &prefix)?;
        result["branches"] = self.branches(root, cancel).await?;
        result["remotes"] = self.remotes(root, cancel).await?;
        result["operation"] = self.operation_state(root, cancel).await?.into();
        result["gitWorkspaces"] = self.git_worktrees(root, cancel).await?;
        Ok(result)
    }

    async fn diff(
        &self,
        root: &Path,
        path: &str,
        area: &str,
        cancel: &CancellationToken,
    ) -> Result<Value, ExeoraError> {
        let (_, relative) = resolve_in_project(root, path)?;
        let relative = relative_string(&relative);
        let mut args = vec![
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--no-color",
            "--unified=3",
            "--relative",
        ];
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
            // `git diff` never shows a file the index does not know. Compared
            // with the null device, a new file reads as all additions.
            output = self
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
                        relative.as_str(),
                    ],
                    None,
                    cancel,
                )
                .await?;
            // With --no-index, 1 means "the files differ", not a failure.
            if !output.success && output.code != Some(1) {
                ensure_success(&output)?;
            }
        }
        let truncated = output.stdout.len() > MAX_GIT_OUTPUT;
        let bytes = &output.stdout[..output.stdout.len().min(MAX_GIT_OUTPUT)];
        let patch = String::from_utf8_lossy(bytes).into_owned();
        Ok(json!({
            "kind": "diff",
            "path": relative,
            "area": area,
            "binary": patch.contains("Binary files ") || patch.contains("GIT binary patch"),
            "truncated": truncated,
            "patch": patch,
        }))
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

    /// Fetch, pull and push, with ssh unable to stop and ask for input.
    async fn network(
        &self,
        root: &Path,
        args: &[&str],
        cancel: &CancellationToken,
    ) -> Result<Value, ExeoraError> {
        // Only when the user has not chosen an ssh command: setting
        // GIT_SSH_COMMAND would override theirs.
        let configured = std::env::var_os("GIT_SSH_COMMAND").is_some()
            || self
                .run(root, &["config", "--get", "core.sshCommand"], None, cancel)
                .await?
                .success;
        let env: &[(&str, &str)] = if configured {
            &[]
        } else {
            &[("GIT_SSH_COMMAND", NON_INTERACTIVE_SSH)]
        };
        self.mutate_with_env(root, args, &[], None, env, cancel)
            .await
    }

    async fn mutate(
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

    async fn mutate_with_env(
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
        let status = self.status(root, cancel).await?;
        Ok(json!({
            "kind": "mutation",
            "stdout": bounded_text(&output.stdout),
            "stderr": bounded_text(&output.stderr),
            "status": status,
        }))
    }

    async fn delete_untracked(
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
        let status = self.status(root, cancel).await?;
        Ok(json!({ "kind": "mutation", "stdout": "", "stderr": "", "status": status }))
    }

    /// What the remote does not have, named. Fetches first, so every remote
    /// tip is here to compare against, and asks the remote for its tags,
    /// which no tracking ref records. Then a branch or tag never pushed, a
    /// branch with commits past its remote counterpart, and a detached HEAD
    /// with commits on it are each reported; so is anything uncommitted,
    /// stashed, or checked out elsewhere. Conservative on purpose: what
    /// cannot be shown to be on the remote is reported as not there.
    async fn unpublished(
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
            .run(
                root,
                &[
                    "for-each-ref",
                    "--format=%(refname)%09%(objectname)",
                    "refs/heads",
                    "refs/tags",
                ],
                None,
                cancel,
            )
            .await?;
        ensure_success(&local)?;
        let local = String::from_utf8_lossy(&local.stdout).into_owned();
        for line in local.lines() {
            let Some((name, sha)) = line.split_once('\t') else {
                continue;
            };
            if let Some(branch) = name.strip_prefix("refs/heads/") {
                let tracking = format!("refs/remotes/origin/{branch}");
                let known = self
                    .run(
                        root,
                        &["rev-parse", "--verify", "--quiet", &tracking],
                        None,
                        cancel,
                    )
                    .await?;
                if !known.success {
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
        let output = self.run(root, &args, None, cancel).await?;
        ensure_success(&output)?;
        Ok(String::from_utf8_lossy(&output.stdout)
            .trim()
            .parse()
            .unwrap_or(0))
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
        let current = self
            .run(root, &["branch", "--show-current"], None, cancel)
            .await?
            .stdout;
        let current = String::from_utf8_lossy(&current).trim().to_owned();
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
                    "current": !remote && name == current,
                }))
            })
            .collect::<Vec<_>>();
        Ok(json!(values))
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

    async fn ensure_staged_within_root(
        &self,
        root: &Path,
        cancel: &CancellationToken,
    ) -> Result<(), ExeoraError> {
        let prefix = self
            .run(root, &["rev-parse", "--show-prefix"], None, cancel)
            .await?;
        ensure_success(&prefix)?;
        let prefix = String::from_utf8_lossy(&prefix.stdout).trim().to_owned();
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

    async fn run(
        &self,
        root: &Path,
        args: &[&str],
        stdin: Option<&[u8]>,
        cancel: &CancellationToken,
    ) -> Result<GitOutput, ExeoraError> {
        self.run_with_env(root, args, stdin, &[], cancel).await
    }

    async fn run_with_env(
        &self,
        root: &Path,
        args: &[&str],
        stdin: Option<&[u8]>,
        env: &[(&str, &str)],
        cancel: &CancellationToken,
    ) -> Result<GitOutput, ExeoraError> {
        let mut command = Command::new("git");
        crate::cgroup::drop_oom_exemption(&mut command);
        command
            .current_dir(root)
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
            child_stdin
                .write_all(input)
                .await
                .map_err(|error| ExeoraError::tool(format!("Could not write to Git: {error}")))?;
        }
        let output = tokio::select! {
            _ = cancel.cancelled() => return Err(ExeoraError::new(ErrorCode::Cancelled, "Workspace operation cancelled.")),
            result = tokio::time::timeout(GIT_TIMEOUT, child.wait_with_output()) => {
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
}

/// How far a local branch is past its upstream, from `%(upstream:track)`:
/// `[ahead 2]`, `[ahead 2, behind 1]`, `[behind 1]`, `[gone]` or nothing when
/// they are level. Null for `gone`: the remote branch is no longer there, so
/// there is nothing to compare with and the commits are as good as unpushed.
fn ahead_of_upstream(track: &str) -> Value {
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

fn parse_status(bytes: &[u8], prefix: &str) -> Result<Value, ExeoraError> {
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

fn parse_worktree_list(bytes: &[u8]) -> Vec<Value> {
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

fn validated_paths(root: &Path, action: &Value) -> Result<Vec<String>, ExeoraError> {
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

fn required_string<'a>(value: &'a Value, key: &str) -> Result<&'a str, ExeoraError> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| invalid(format!("'{key}' is required.")))
}

fn validate_ref(value: &str) -> Result<(), ExeoraError> {
    if value.is_empty()
        || value.len() > 512
        || value.starts_with('-')
        || value.chars().any(|character| character.is_control())
    {
        return Err(invalid("Invalid Git reference."));
    }
    Ok(())
}

fn ensure_success(output: &GitOutput) -> Result<(), ExeoraError> {
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

fn bounded_text(bytes: &[u8]) -> String {
    String::from_utf8_lossy(&bytes[..bytes.len().min(MAX_GIT_OUTPUT)]).into_owned()
}

fn invalid(message: impl Into<String>) -> ExeoraError {
    ExeoraError::new(ErrorCode::InvalidArguments, message)
}

#[cfg(test)]
mod tests {
    use super::{GitWorkspace, ahead_of_upstream, parse_status, parse_worktree_list};
    use crate::error::ErrorCode;
    use serde_json::{Value, json};
    use std::{fs, process::Command};
    use tempfile::tempdir;
    use tokio_util::sync::CancellationToken;

    #[tokio::test]
    async fn names_what_the_remote_does_not_have() {
        let dir = tempdir().unwrap();
        let origin = dir.path().join("origin.git");
        let seed = dir.path().join("seed");
        let clone = dir.path().join("clone");
        let git = |cwd: &std::path::Path, args: &[&str]| {
            assert!(
                Command::new("git")
                    .current_dir(cwd)
                    .args(["-c", "user.name=t", "-c", "user.email=t@example.test"])
                    .args(args)
                    .status()
                    .unwrap()
                    .success(),
                "git {args:?}"
            );
        };
        git(
            dir.path(),
            &[
                "init",
                "-q",
                "--bare",
                "-b",
                "main",
                origin.to_str().unwrap(),
            ],
        );
        git(
            dir.path(),
            &["init", "-q", "-b", "main", seed.to_str().unwrap()],
        );
        git(&seed, &["commit", "-q", "--allow-empty", "-m", "initial"]);
        git(&seed, &["push", "-q", origin.to_str().unwrap(), "main"]);
        git(
            dir.path(),
            &[
                "clone",
                "-q",
                origin.to_str().unwrap(),
                clone.to_str().unwrap(),
            ],
        );

        let workspace = GitWorkspace::new();
        let cancel = CancellationToken::new();
        let ask = || workspace.execute(&clone, json!({ "action": "unpublished" }), cancel.clone());
        let clean = ask().await.unwrap();
        assert_eq!(clean["clean"], true, "{clean}");

        // A commit on a branch never pushed, a tag on a commit no branch
        // holds, and main checked out clean and level once more.
        git(&clone, &["checkout", "-q", "-b", "side"]);
        git(
            &clone,
            &["commit", "-q", "--allow-empty", "-m", "side work"],
        );
        git(&clone, &["checkout", "-q", "main"]);
        git(&clone, &["commit", "-q", "--allow-empty", "-m", "tagged"]);
        git(&clone, &["tag", "v-local"]);
        git(&clone, &["reset", "-q", "--hard", "origin/main"]);
        let dirty = ask().await.unwrap();
        assert_eq!(dirty["clean"], false);
        let reasons = dirty["reasons"].to_string();
        assert!(reasons.contains("side was never pushed"), "{reasons}");
        assert!(reasons.contains("v-local was never pushed"), "{reasons}");

        git(&clone, &["push", "-q", "origin", "side", "v-local"]);
        assert_eq!(ask().await.unwrap()["clean"], true);

        // The remote moved on without this checkout: nothing here is lost.
        git(&seed, &["pull", "-q", origin.to_str().unwrap(), "main"]);
        git(&seed, &["commit", "-q", "--allow-empty", "-m", "elsewhere"]);
        git(&seed, &["push", "-q", origin.to_str().unwrap(), "main"]);
        assert_eq!(ask().await.unwrap()["clean"], true);

        // A commit on a detached HEAD is on no branch at all.
        git(&clone, &["checkout", "-q", "--detach"]);
        git(
            &clone,
            &["commit", "-q", "--allow-empty", "-m", "detached work"],
        );
        let detached = ask().await.unwrap();
        assert_eq!(detached["clean"], false);
        assert!(
            detached["reasons"]
                .to_string()
                .contains("HEAD has 1 commit"),
            "{}",
            detached["reasons"]
        );

        // A status git cannot produce is not a clean one.
        git(&clone, &["config", "status.relativePaths", "invalid"]);
        assert!(ask().await.is_err());
        git(&clone, &["config", "--unset", "status.relativePaths"]);
    }

    #[test]
    fn reads_the_stash_count_and_each_branch_track_summary() {
        let status =
            parse_status(b"# branch.oid abc123\0# branch.head main\0# stash 3\0", "").unwrap();
        assert_eq!(status["stashes"], 3);
        let none = parse_status(b"# branch.oid abc123\0# branch.head main\0", "").unwrap();
        assert_eq!(none["stashes"], 0);

        assert_eq!(ahead_of_upstream("[ahead 2]"), json!(2));
        assert_eq!(ahead_of_upstream("[ahead 2, behind 1]"), json!(2));
        assert_eq!(ahead_of_upstream("[behind 1]"), json!(0));
        assert_eq!(ahead_of_upstream(""), json!(0));
        assert_eq!(ahead_of_upstream("[gone]"), Value::Null);
    }

    #[test]
    fn parses_porcelain_v2_without_losing_spaces_or_renames() {
        let status = parse_status(
            b"# branch.oid abc123\0# branch.head main\0# branch.upstream origin/main\0# branch.ab +2 -1\x001 M. N... 100644 100644 100644 abc def file with spaces.txt\x002 R. N... 100644 100644 100644 abc def R100 new.txt\0old.txt\0? new file.txt\0",
            "",
        )
        .unwrap();
        assert_eq!(status["head"], "main");
        assert_eq!(status["ahead"], 2);
        assert_eq!(status["behind"], 1);
        assert_eq!(status["files"][0]["path"], "file with spaces.txt");
        assert_eq!(status["files"][1]["originalPath"], "old.txt");
        assert_eq!(status["files"][2]["kind"], "untracked");
        // Absent rather than null: the protocol reads it as an optional string.
        assert!(status["files"][0].get("originalPath").is_none());
        assert!(status["files"][2].get("originalPath").is_none());
    }

    #[test]
    fn parses_porcelain_worktree_list_including_detached_heads() {
        let worktrees = parse_worktree_list(
            b"worktree /repo\nHEAD abc\nbranch refs/heads/develop\n\nworktree /repo/.worktrees/feature\nHEAD def\ndetached\n",
        );
        assert_eq!(worktrees[0]["path"], "/repo");
        assert_eq!(worktrees[0]["branch"], "develop");
        assert_eq!(worktrees[1]["path"], "/repo/.worktrees/feature");
        assert_eq!(worktrees[1]["branch"], Value::Null);
    }

    #[tokio::test]
    async fn stages_commits_and_only_deletes_verified_untracked_files() {
        let directory = tempdir().unwrap();
        for args in [
            vec!["init", "-q"],
            vec!["config", "user.name", "Exeora Test"],
            vec!["config", "user.email", "test@exeora.dev"],
        ] {
            assert!(
                Command::new("git")
                    .current_dir(directory.path())
                    .args(args)
                    .status()
                    .unwrap()
                    .success()
            );
        }
        fs::write(directory.path().join("tracked.txt"), "one\n").unwrap();
        let workspace = GitWorkspace::new();
        let cancel = CancellationToken::new();

        let staged = workspace
            .execute(
                directory.path(),
                json!({ "action": "stage", "paths": ["tracked.txt"] }),
                cancel.clone(),
            )
            .await
            .unwrap();
        assert_eq!(staged["status"]["files"][0]["index"], "A");

        let committed = workspace
            .execute(
                directory.path(),
                json!({ "action": "commit", "message": "initial commit" }),
                cancel.clone(),
            )
            .await
            .unwrap();
        assert_eq!(committed["status"]["files"], json!([]));

        fs::write(directory.path().join("untracked.txt"), "temporary\n").unwrap();
        workspace
            .execute(
                directory.path(),
                json!({ "action": "delete_untracked", "paths": ["untracked.txt"] }),
                cancel.clone(),
            )
            .await
            .unwrap();
        assert!(!directory.path().join("untracked.txt").exists());

        let refused = workspace
            .execute(
                directory.path(),
                json!({ "action": "delete_untracked", "paths": ["tracked.txt"] }),
                cancel,
            )
            .await;
        assert!(refused.is_err());
        assert!(directory.path().join("tracked.txt").exists());
    }

    #[tokio::test]
    async fn diffs_untracked_files_and_switches_to_a_created_branch() {
        let directory = tempdir().unwrap();
        for args in [
            vec!["init", "-q", "-b", "main"],
            vec!["config", "user.name", "Exeora Test"],
            vec!["config", "user.email", "test@exeora.dev"],
            vec!["commit", "-q", "--allow-empty", "-m", "initial"],
        ] {
            assert!(
                Command::new("git")
                    .current_dir(directory.path())
                    .args(args)
                    .status()
                    .unwrap()
                    .success()
            );
        }
        fs::create_dir(directory.path().join("src")).unwrap();
        fs::write(directory.path().join("src/new.txt"), "first line\n").unwrap();
        let workspace = GitWorkspace::new();
        let cancel = CancellationToken::new();

        let diff = workspace
            .execute(
                directory.path(),
                json!({ "action": "diff", "path": "src/new.txt", "area": "working" }),
                cancel.clone(),
            )
            .await
            .unwrap();
        let patch = diff["patch"].as_str().unwrap();
        assert!(patch.contains("+first line"), "{patch}");
        assert_eq!(diff["binary"], false);

        let staged = workspace
            .execute(
                directory.path(),
                json!({ "action": "diff", "path": "src/new.txt", "area": "staged" }),
                cancel.clone(),
            )
            .await
            .unwrap();
        assert_eq!(staged["patch"], "");

        let created = workspace
            .execute(
                directory.path(),
                json!({ "action": "branch_create", "name": "feature", "startPoint": "main" }),
                cancel,
            )
            .await
            .unwrap();
        assert_eq!(created["status"]["head"], "feature");
    }

    #[tokio::test]
    async fn scopes_a_registered_subdirectory_and_refuses_external_staged_files() {
        let directory = tempdir().unwrap();
        let app = directory.path().join("app");
        let other = directory.path().join("other");
        fs::create_dir_all(&app).unwrap();
        fs::create_dir_all(&other).unwrap();
        for args in [
            vec!["init", "-q"],
            vec!["config", "user.name", "Exeora Test"],
            vec!["config", "user.email", "test@exeora.dev"],
        ] {
            assert!(
                Command::new("git")
                    .current_dir(directory.path())
                    .args(args)
                    .status()
                    .unwrap()
                    .success()
            );
        }
        fs::write(app.join("inside.txt"), "one\n").unwrap();
        fs::write(other.join("outside.txt"), "one\n").unwrap();
        assert!(
            Command::new("git")
                .current_dir(directory.path())
                .args(["add", "."])
                .status()
                .unwrap()
                .success()
        );
        assert!(
            Command::new("git")
                .current_dir(directory.path())
                .args(["commit", "-qm", "initial"])
                .status()
                .unwrap()
                .success()
        );

        fs::write(app.join("inside.txt"), "two\n").unwrap();
        fs::write(other.join("outside.txt"), "two\n").unwrap();
        let workspace = GitWorkspace::new();
        let cancel = CancellationToken::new();
        let status = workspace
            .execute(&app, json!({ "action": "status" }), cancel.clone())
            .await
            .unwrap();
        assert_eq!(status["files"].as_array().unwrap().len(), 1);
        assert_eq!(status["files"][0]["path"], "inside.txt");

        let diff = workspace
            .execute(
                &app,
                json!({ "action": "diff", "path": "inside.txt", "area": "working" }),
                cancel.clone(),
            )
            .await
            .unwrap();
        assert!(diff["patch"].as_str().unwrap().contains("a/inside.txt"));
        assert!(
            !diff["patch"]
                .as_str()
                .unwrap()
                .contains("other/outside.txt")
        );

        workspace
            .execute(
                &app,
                json!({ "action": "stage", "paths": ["inside.txt"] }),
                cancel.clone(),
            )
            .await
            .unwrap();
        assert!(
            Command::new("git")
                .current_dir(directory.path())
                .args(["add", "other/outside.txt"])
                .status()
                .unwrap()
                .success()
        );
        let refused = workspace
            .execute(
                &app,
                json!({ "action": "commit", "message": "inside only" }),
                cancel.clone(),
            )
            .await
            .unwrap_err();
        assert_eq!(refused.code, ErrorCode::Forbidden);

        assert!(
            Command::new("git")
                .current_dir(directory.path())
                .args(["restore", "--staged", "--", "other/outside.txt"])
                .status()
                .unwrap()
                .success()
        );
        workspace
            .execute(
                &app,
                json!({ "action": "commit", "message": "inside only" }),
                cancel,
            )
            .await
            .unwrap();
        let committed = Command::new("git")
            .current_dir(directory.path())
            .args(["show", "--pretty=format:", "--name-only", "HEAD"])
            .output()
            .unwrap();
        assert_eq!(
            String::from_utf8_lossy(&committed.stdout).trim(),
            "app/inside.txt"
        );
        assert_eq!(
            fs::read_to_string(other.join("outside.txt")).unwrap(),
            "two\n"
        );
    }

    #[tokio::test]
    async fn keeps_git_worktree_status_diff_and_index_isolated() {
        let directory = tempdir().unwrap();
        let main = directory.path().join("main");
        let feature = directory.path().join("feature");
        fs::create_dir_all(&main).unwrap();
        for args in [
            vec!["init", "-q"],
            vec!["config", "user.name", "Exeora Test"],
            vec!["config", "user.email", "test@exeora.dev"],
        ] {
            assert!(
                Command::new("git")
                    .current_dir(&main)
                    .args(args)
                    .status()
                    .unwrap()
                    .success()
            );
        }
        fs::write(main.join("shared.txt"), "base\n").unwrap();
        assert!(
            Command::new("git")
                .current_dir(&main)
                .args(["add", "shared.txt"])
                .status()
                .unwrap()
                .success()
        );
        assert!(
            Command::new("git")
                .current_dir(&main)
                .args(["commit", "-qm", "initial"])
                .status()
                .unwrap()
                .success()
        );
        assert!(
            Command::new("git")
                .current_dir(&main)
                .args([
                    "worktree",
                    "add",
                    "-qb",
                    "feature",
                    feature.to_str().unwrap()
                ])
                .status()
                .unwrap()
                .success()
        );

        fs::write(main.join("shared.txt"), "main change\n").unwrap();
        fs::write(feature.join("shared.txt"), "feature change\n").unwrap();
        let workspace = GitWorkspace::new();
        let cancel = CancellationToken::new();
        let main_diff = workspace
            .execute(
                &main,
                json!({ "action": "diff", "path": "shared.txt", "area": "working" }),
                cancel.clone(),
            )
            .await
            .unwrap();
        let feature_diff = workspace
            .execute(
                &feature,
                json!({ "action": "diff", "path": "shared.txt", "area": "working" }),
                cancel.clone(),
            )
            .await
            .unwrap();
        assert!(main_diff["patch"].as_str().unwrap().contains("main change"));
        assert!(
            feature_diff["patch"]
                .as_str()
                .unwrap()
                .contains("feature change")
        );

        workspace
            .execute(
                &feature,
                json!({ "action": "stage", "paths": ["shared.txt"] }),
                cancel.clone(),
            )
            .await
            .unwrap();
        let main_status = workspace
            .execute(&main, json!({ "action": "status" }), cancel.clone())
            .await
            .unwrap();
        let feature_status = workspace
            .execute(&feature, json!({ "action": "status" }), cancel)
            .await
            .unwrap();
        assert_eq!(main_status["files"][0]["index"], ".");
        assert_eq!(main_status["files"][0]["worktree"], "M");
        assert_eq!(feature_status["files"][0]["index"], "M");
        assert_eq!(feature_status["files"][0]["worktree"], ".");
        let trees = main_status["gitWorkspaces"]
            .as_array()
            .expect("git workspaces");
        assert_eq!(trees.len(), 2);
        assert!(trees.iter().any(|tree| tree["branch"] == "feature"));
    }
}
