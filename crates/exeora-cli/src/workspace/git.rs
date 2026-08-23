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

pub struct GitWorkspace {
    operation: Mutex<()>,
}

struct GitOutput {
    success: bool,
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
        let _guard = self.operation.lock().await;
        let name = action
            .get("action")
            .and_then(Value::as_str)
            .ok_or_else(|| invalid("A workspace action is required."))?;
        match name {
            "status" => self.status(root, &cancel).await,
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
                self.mutate(root, &args, &[], None, &cancel).await
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
                self.mutate(root, &args, &[], None, &cancel).await
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
                self.mutate(root, &args, &[], None, &cancel).await
            }
            "branch_create" => {
                let name = required_string(&action, "name")?;
                self.validate_branch(root, name, &cancel).await?;
                let mut args = vec!["branch", name];
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
        result["gitWorktrees"] = self.git_worktrees(root, cancel).await?;
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
        let output = self.run(root, &args, None, cancel).await?;
        ensure_success(&output)?;
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

    async fn mutate(
        &self,
        root: &Path,
        prefix: &[&str],
        paths: &[String],
        stdin: Option<&[u8]>,
        cancel: &CancellationToken,
    ) -> Result<Value, ExeoraError> {
        let mut args = prefix.to_vec();
        args.extend(paths.iter().map(String::as_str));
        let output = self.run(root, &args, stdin, cancel).await?;
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
                    "--format=%(refname)%09%(objectname:short)%09%(upstream:short)",
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
        let mut command = Command::new("git");
        command
            .current_dir(root)
            .args(args)
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("LC_ALL", "C")
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
            stdout: output.stdout,
            stderr: output.stderr,
        })
    }
}

fn parse_status(bytes: &[u8], prefix: &str) -> Result<Value, ExeoraError> {
    let mut head = None;
    let mut oid = None;
    let mut upstream = None;
    let mut ahead = 0;
    let mut behind = 0;
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
        "gitWorktrees": [],
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
    Some(json!({
        "path": path,
        "originalPath": original,
        "index": chars.next().unwrap_or('.').to_string(),
        "worktree": chars.next().unwrap_or('.').to_string(),
        "kind": kind,
        "submodule": sub != "N...",
    }))
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
        "files": [], "branches": [], "remotes": [], "gitWorktrees": [],
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
    use super::{GitWorkspace, parse_status, parse_worktree_list};
    use crate::error::ErrorCode;
    use serde_json::{json, Value};
    use std::{fs, process::Command};
    use tempfile::tempdir;
    use tokio_util::sync::CancellationToken;

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
        let trees = main_status["gitWorktrees"]
            .as_array()
            .expect("git worktrees");
        assert_eq!(trees.len(), 2);
        assert!(trees.iter().any(|tree| tree["branch"] == "feature"));
    }
}
