//! History: a page of commits, and one commit in full.

use super::{
    GitWorkspace,
    run::{ensure_success, invalid, required_string, validate_oid},
};
use crate::error::ExeoraError;
use serde_json::{Value, json};
use std::path::Path;
use tokio_util::sync::CancellationToken;

/// Fields separated by a unit separator, commits by a record separator:
/// neither can appear in a hash, a name or a subject line.
const LOG_FORMAT: &str = "--format=%H%x1f%h%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%cI%x1f%s%x1f%D%x1e";

impl GitWorkspace {
    /// A page of the history of HEAD and its upstream, newest first. The
    /// cursor is how many commits to skip; one more than the page is asked
    /// for, to know whether there is a next one.
    pub(super) async fn log(
        &self,
        root: &Path,
        action: &Value,
        cancel: &CancellationToken,
    ) -> Result<Value, ExeoraError> {
        let limit = action
            .get("limit")
            .and_then(Value::as_u64)
            .unwrap_or(30)
            .clamp(1, 100) as usize;
        let skip: usize = match action.get("cursor").and_then(Value::as_str) {
            None | Some("") => 0,
            Some(cursor) => cursor
                .parse()
                .map_err(|_| invalid("The log cursor is not one this CLI issued."))?,
        };
        let Some(head) = self.resolve(root, "HEAD", cancel).await? else {
            return Ok(json!({
                "kind": "log", "commits": [], "nextCursor": Value::Null,
                "head": Value::Null, "upstream": Value::Null,
            }));
        };
        let upstream = self
            .run(
                root,
                &["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
                None,
                cancel,
            )
            .await?;
        let upstream = upstream
            .success
            .then(|| String::from_utf8_lossy(&upstream.stdout).trim().to_owned())
            .filter(|name| !name.is_empty());
        let skip_arg = format!("--skip={skip}");
        let count_arg = format!("--max-count={}", limit + 1);
        let mut args = vec![
            "log",
            "--date-order",
            skip_arg.as_str(),
            count_arg.as_str(),
            LOG_FORMAT,
            "HEAD",
        ];
        if let Some(upstream) = &upstream {
            args.push(upstream.as_str());
        }
        let output = self.run(root, &args, None, cancel).await?;
        ensure_success(&output)?;
        let text = String::from_utf8_lossy(&output.stdout);
        let mut commits = text
            .split('\u{1e}')
            .map(str::trim)
            .filter(|record| !record.is_empty())
            .map(parse_commit)
            .collect::<Vec<_>>();
        let next_cursor = (commits.len() > limit).then(|| (skip + limit).to_string());
        commits.truncate(limit);
        Ok(json!({
            "kind": "log",
            "commits": commits,
            "nextCursor": next_cursor,
            "head": head,
            "upstream": upstream,
        }))
    }

    /// One commit: its whole message and the files it changed.
    pub(super) async fn commit_detail(
        &self,
        root: &Path,
        action: &Value,
        cancel: &CancellationToken,
    ) -> Result<Value, ExeoraError> {
        let oid = required_string(action, "oid")?;
        validate_oid(oid)?;
        let tree = self.commit_tree(root, oid, cancel).await?;
        let full = tree.last().cloned().unwrap_or_default();
        let message = self
            .text(root, &["show", "-s", "--format=%B", &full], cancel)
            .await?;
        let tree = tree.iter().map(String::as_str).collect::<Vec<_>>();
        let files = self.changed_files(root, &tree, cancel).await?;
        Ok(json!({
            "kind": "commit_detail",
            "oid": full,
            "message": message,
            "files": files,
        }))
    }
}

fn parse_commit(record: &str) -> Value {
    let mut fields = record.split('\u{1f}');
    let mut next = || fields.next().unwrap_or_default().to_owned();
    let oid = next();
    let short_oid = next();
    let parents = next()
        .split_whitespace()
        .map(str::to_owned)
        .collect::<Vec<_>>();
    let author_name = next();
    let author_email = next();
    let authored_at = next();
    let committed_at = next();
    let subject = next();
    let refs = next()
        .split(", ")
        .map(|name| name.strip_prefix("HEAD -> ").unwrap_or(name).trim())
        .filter(|name| !name.is_empty())
        .map(str::to_owned)
        .collect::<Vec<_>>();
    json!({
        "oid": oid,
        "shortOid": short_oid,
        "parents": parents,
        "authorName": author_name,
        "authorEmail": author_email,
        "authoredAt": authored_at,
        "committedAt": committed_at,
        "subject": subject,
        "refs": refs,
    })
}

#[cfg(test)]
mod tests {
    use super::parse_commit;

    #[test]
    fn reads_a_log_record_and_its_decorations() {
        let commit = parse_commit(
            "abc\u{1f}ab\u{1f}p1 p2\u{1f}Ann\u{1f}ann@example.test\u{1f}2026-01-01T00:00:00+00:00\u{1f}2026-01-02T00:00:00+00:00\u{1f}Merge it\u{1f}HEAD -> main, origin/main, tag: v1",
        );
        assert_eq!(commit["parents"], serde_json::json!(["p1", "p2"]));
        assert_eq!(
            commit["refs"],
            serde_json::json!(["main", "origin/main", "tag: v1"])
        );
        assert_eq!(commit["subject"], "Merge it");
        let bare = parse_commit("abc\u{1f}ab\u{1f}\u{1f}A\u{1f}a\u{1f}t\u{1f}t\u{1f}s\u{1f}");
        assert_eq!(bare["parents"], serde_json::json!([]));
        assert_eq!(bare["refs"], serde_json::json!([]));
    }
}
