//! Source Control v2, the Explorer and search, against real repositories in
//! temporary directories. The Explorer and search are routed through the
//! engine, which is the door the relay uses.

use crate::{error::ErrorCode, workspace::WorkspaceEngine};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{fs, path::Path, process::Command};
use tempfile::{TempDir, tempdir};
use tokio_util::sync::CancellationToken;

fn git(cwd: &Path, args: &[&str]) {
    let output = Command::new("git")
        .current_dir(cwd)
        .args(["-c", "user.name=t", "-c", "user.email=t@example.test"])
        .args(args)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "git {args:?}: {}",
        String::from_utf8_lossy(&output.stderr)
    );
}

fn git_stdout(cwd: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .current_dir(cwd)
        .args(args)
        .output()
        .unwrap();
    String::from_utf8_lossy(&output.stdout).trim().to_owned()
}

/// A repository on `main` with one commit of `README.md`.
fn repo() -> TempDir {
    let dir = tempdir().unwrap();
    git(dir.path(), &["init", "-q", "-b", "main"]);
    git(dir.path(), &["config", "user.name", "Exeora Test"]);
    git(dir.path(), &["config", "user.email", "test@exeora.dev"]);
    fs::write(dir.path().join("README.md"), "hello\n").unwrap();
    git(dir.path(), &["add", "."]);
    git(dir.path(), &["commit", "-qm", "initial"]);
    dir
}

async fn run(root: &Path, action: Value) -> Result<Value, crate::error::ExeoraError> {
    WorkspaceEngine::new()
        .execute(root, action, CancellationToken::new())
        .await
}

async fn ok(root: &Path, action: Value) -> Value {
    run(root, action.clone())
        .await
        .unwrap_or_else(|error| panic!("{action}: {error:?}"))
}

fn sha(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[tokio::test]
async fn pages_the_log_with_parents_and_refs() {
    let dir = repo();
    let root = dir.path();
    git(root, &["commit", "-q", "--allow-empty", "-m", "second"]);
    git(root, &["switch", "-qc", "side"]);
    git(root, &["commit", "-q", "--allow-empty", "-m", "side work"]);
    git(root, &["switch", "-q", "main"]);
    git(
        root,
        &["merge", "-q", "--no-ff", "-m", "merge side", "side"],
    );
    git(root, &["tag", "v1"]);

    let first = ok(root, json!({ "action": "log", "limit": 2 })).await;
    let commits = first["commits"].as_array().unwrap();
    assert_eq!(commits.len(), 2);
    assert_eq!(commits[0]["subject"], "merge side");
    assert_eq!(commits[0]["parents"].as_array().unwrap().len(), 2);
    assert_eq!(first["head"], commits[0]["oid"]);
    assert_eq!(first["upstream"], Value::Null);
    let refs = commits[0]["refs"].as_array().unwrap();
    assert!(refs.contains(&json!("main")), "{refs:?}");
    assert!(refs.contains(&json!("tag: v1")), "{refs:?}");
    assert_eq!(first["nextCursor"], "2");
    assert_eq!(commits[0]["shortOid"].as_str().unwrap().len(), 7);
    assert!(commits[0]["authoredAt"].as_str().unwrap().starts_with("20"));

    let cursor = first["nextCursor"].as_str().unwrap();
    let rest = ok(
        root,
        json!({ "action": "log", "cursor": cursor, "limit": 2 }),
    )
    .await;
    let older = rest["commits"].as_array().unwrap();
    assert_eq!(older.len(), 2);
    assert_eq!(older[1]["subject"], "initial");
    assert_eq!(older[1]["parents"], json!([]));
    assert_eq!(rest["nextCursor"], Value::Null);
    assert!(
        run(root, json!({ "action": "log", "cursor": "nope" }))
            .await
            .is_err()
    );

    let empty = tempdir().unwrap();
    git(empty.path(), &["init", "-q"]);
    let none = ok(empty.path(), json!({ "action": "log" })).await;
    assert_eq!(none["commits"], json!([]));
    assert_eq!(none["head"], Value::Null);
}

#[tokio::test]
async fn describes_a_commit_with_numstat_and_renames() {
    let dir = repo();
    let root = dir.path();
    git(root, &["mv", "README.md", "GUIDE.md"]);
    fs::write(root.join("new.txt"), "one\ntwo\n").unwrap();
    fs::write(root.join("logo.png"), b"\x89PNG\0\0binary").unwrap();
    git(root, &["add", "."]);
    git(root, &["commit", "-qm", "rename and add"]);
    let oid = git_stdout(root, &["rev-parse", "HEAD"]);

    let detail = ok(root, json!({ "action": "commit_detail", "oid": oid })).await;
    assert_eq!(detail["kind"], "commit_detail");
    assert_eq!(detail["oid"], oid);
    assert_eq!(detail["message"].as_str().unwrap().trim(), "rename and add");
    let files = detail["files"].as_array().unwrap();
    let find = |path: &str| files.iter().find(|file| file["path"] == path).unwrap();
    assert_eq!(find("GUIDE.md")["status"], "R");
    assert_eq!(find("GUIDE.md")["oldPath"], "README.md");
    assert_eq!(find("new.txt")["status"], "A");
    assert_eq!(find("new.txt")["additions"], 2);
    assert_eq!(find("logo.png")["binary"], true);

    let short = &oid[..8];
    let root_oid = git_stdout(root, &["rev-parse", "HEAD~1"]);
    let first = ok(root, json!({ "action": "commit_detail", "oid": root_oid })).await;
    assert_eq!(first["files"][0]["path"], "README.md");
    assert_eq!(first["files"][0]["status"], "A");

    let patch = ok(root, json!({ "action": "commit_diff", "oid": short })).await;
    assert_eq!(patch["oid"], oid);
    assert_eq!(patch["path"], Value::Null);
    let text = patch["patch"].as_str().unwrap();
    assert!(text.contains("+two"), "{text}");
    assert!(text.contains("rename from README.md"), "{text}");
    assert_eq!(patch["binary"], true);

    let one = ok(
        root,
        json!({ "action": "commit_diff", "oid": short, "path": "new.txt" }),
    )
    .await;
    let text = one["patch"].as_str().unwrap();
    assert!(
        text.contains("new.txt") && !text.contains("GUIDE.md"),
        "{text}"
    );
    assert_eq!(one["binary"], false);

    let refused = run(
        root,
        json!({ "action": "commit_diff", "oid": "--output=x" }),
    )
    .await
    .unwrap_err();
    assert_eq!(refused.code, ErrorCode::InvalidArguments);
}

#[tokio::test]
async fn diffs_a_range_from_the_merge_base_and_gathers_context() {
    let dir = repo();
    let root = dir.path();
    let base = git_stdout(root, &["rev-parse", "HEAD"]);
    git(root, &["switch", "-qc", "feature"]);
    fs::write(root.join("feature.txt"), "feature\n").unwrap();
    git(root, &["add", "."]);
    git(root, &["commit", "-qm", "feature work"]);
    git(root, &["switch", "-q", "main"]);
    fs::write(root.join("main.txt"), "main\n").unwrap();
    git(root, &["add", "."]);
    git(root, &["commit", "-qm", "main moved on"]);
    git(root, &["switch", "-q", "feature"]);

    let range = ok(root, json!({ "action": "range_diff", "base": "main" })).await;
    assert_eq!(range["mergeBase"], base);
    assert_eq!(range["head"], git_stdout(root, &["rev-parse", "HEAD"]));
    assert_eq!(range["files"][0]["path"], "feature.txt");
    assert!(range["patch"].as_str().unwrap().contains("+feature"));
    assert!(!range["patch"].as_str().unwrap().contains("main.txt"));

    let context = ok(root, json!({ "action": "range_context", "base": "main" })).await;
    assert_eq!(context["commits"].as_array().unwrap().len(), 1);
    assert_eq!(context["commits"][0]["subject"], "feature work");
    assert_eq!(context["commits"][0]["author"], "t");
    assert_eq!(context["files"][0]["status"], "A");
    assert_eq!(context["truncated"], false);
    assert!(
        run(root, json!({ "action": "range_context", "base": "nope" }))
            .await
            .is_err()
    );

    fs::write(root.join("README.md"), "changed\n").unwrap();
    fs::write(root.join("big.txt"), "x".repeat(250_000)).unwrap();
    git(root, &["add", "."]);
    let staged = ok(root, json!({ "action": "staged_context" })).await;
    assert_eq!(staged["branch"], "feature");
    let files = staged["files"].as_array().unwrap();
    assert!(
        files
            .iter()
            .any(|file| file["path"] == "README.md" && file["status"] == "M")
    );
    assert_eq!(staged["truncated"], true);
    assert!(staged["patch"].as_str().unwrap().len() <= 200_000);

    let all = ok(root, json!({ "action": "diff_all", "area": "staged" })).await;
    assert!(all["patch"].as_str().unwrap().contains("+changed"));
    assert_eq!(all["untrackedOmitted"], false);
    fs::write(root.join("loose.txt"), "loose\n").unwrap();
    let working = ok(root, json!({ "action": "diff_all", "area": "working" })).await;
    assert!(
        working["patch"].as_str().unwrap().contains("+loose"),
        "{working}"
    );
}

#[tokio::test]
async fn stashes_amends_and_discards_everything() {
    let dir = repo();
    let root = dir.path();
    fs::write(root.join("README.md"), "changed\n").unwrap();
    fs::write(root.join("loose.txt"), "loose\n").unwrap();

    let pushed = ok(root, json!({ "action": "stash_push", "message": "keep" })).await;
    assert_eq!(pushed["status"]["files"], json!([]));
    assert_eq!(pushed["status"]["stashes"], 1);
    let list = ok(root, json!({ "action": "stash_list" })).await;
    assert_eq!(list["entries"][0]["index"], 0);
    assert!(
        list["entries"][0]["message"]
            .as_str()
            .unwrap()
            .contains("keep")
    );
    assert!(
        list["entries"][0]["createdAt"]
            .as_str()
            .unwrap()
            .contains('T')
    );
    let popped = ok(root, json!({ "action": "stash_pop" })).await;
    assert_eq!(popped["status"]["files"].as_array().unwrap().len(), 2);
    ok(
        root,
        json!({ "action": "stash_push", "includeUntracked": false }),
    )
    .await;
    assert!(root.join("loose.txt").exists());
    ok(root, json!({ "action": "stash_drop", "index": 0 })).await;
    assert_eq!(
        ok(root, json!({ "action": "stash_list" })).await["entries"],
        json!([])
    );

    fs::write(root.join("README.md"), "second\n").unwrap();
    git(root, &["add", "README.md"]);
    ok(root, json!({ "action": "commit", "message": "second" })).await;
    fs::write(root.join("README.md"), "amended\n").unwrap();
    git(root, &["add", "README.md"]);
    let amended = ok(
        root,
        json!({ "action": "amend", "message": "better second" }),
    )
    .await;
    assert_eq!(amended["status"]["files"].as_array().unwrap().len(), 1);
    let log = ok(root, json!({ "action": "log" })).await;
    assert_eq!(log["commits"].as_array().unwrap().len(), 2);
    assert_eq!(log["commits"][0]["subject"], "better second");
    fs::write(root.join("README.md"), "amended twice\n").unwrap();
    git(root, &["add", "README.md"]);
    ok(root, json!({ "action": "amend" })).await;
    let log = ok(root, json!({ "action": "log" })).await;
    assert_eq!(log["commits"].as_array().unwrap().len(), 2);
    assert_eq!(log["commits"][0]["subject"], "better second");
    assert_eq!(
        git_stdout(root, &["show", "HEAD:README.md"]),
        "amended twice"
    );

    fs::write(root.join("README.md"), "dirty\n").unwrap();
    let discarded = ok(root, json!({ "action": "discard_all" })).await;
    let files = discarded["status"]["files"].as_array().unwrap();
    assert_eq!(files.len(), 1, "{files:?}");
    assert_eq!(files[0]["path"], "loose.txt");
    assert_eq!(
        fs::read_to_string(root.join("README.md")).unwrap(),
        "amended twice\n"
    );
}

#[tokio::test]
async fn syncs_with_a_remote_in_one_go() {
    let dir = tempdir().unwrap();
    let origin = dir.path().join("origin.git");
    let seed = dir.path().join("seed");
    let clone = dir.path().join("clone");
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
    git(&clone, &["config", "user.name", "Exeora Test"]);
    git(&clone, &["config", "user.email", "test@exeora.dev"]);
    git(&clone, &["config", "pull.rebase", "false"]);

    git(&seed, &["pull", "-q", origin.to_str().unwrap(), "main"]);
    fs::write(seed.join("remote.txt"), "from the remote\n").unwrap();
    git(&seed, &["add", "."]);
    git(&seed, &["commit", "-qm", "remote work"]);
    git(&seed, &["push", "-q", origin.to_str().unwrap(), "main"]);
    fs::write(clone.join("local.txt"), "from here\n").unwrap();
    git(&clone, &["add", "."]);
    git(&clone, &["commit", "-qm", "local work"]);

    let synced = ok(&clone, json!({ "action": "sync" })).await;
    assert_eq!(synced["status"]["ahead"], 0);
    assert_eq!(synced["status"]["behind"], 0);
    assert!(clone.join("remote.txt").exists());
    assert_eq!(
        git_stdout(&origin, &["rev-parse", "main"]),
        git_stdout(&clone, &["rev-parse", "HEAD"])
    );
    let output = format!("{}{}", synced["stdout"], synced["stderr"]);
    assert!(output.contains("main"), "{output}");
}

#[tokio::test]
async fn stages_unstages_and_discards_whole_folders() {
    let dir = repo();
    let root = dir.path();
    fs::create_dir_all(root.join("src/deep")).unwrap();
    fs::write(root.join("src/a.txt"), "a\n").unwrap();
    fs::write(root.join("src/deep/b.txt"), "b\n").unwrap();

    let staged = ok(root, json!({ "action": "stage", "paths": ["src"] })).await;
    let files = staged["status"]["files"].as_array().unwrap();
    assert_eq!(files.len(), 2);
    assert!(files.iter().all(|file| file["index"] == "A"), "{files:?}");
    let unstaged = ok(root, json!({ "action": "unstage", "paths": ["src/"] })).await;
    let files = unstaged["status"]["files"].as_array().unwrap();
    assert!(
        files.iter().all(|file| file["kind"] == "untracked"),
        "{files:?}"
    );

    git(root, &["add", "src"]);
    git(root, &["commit", "-qm", "src"]);
    fs::write(root.join("src/a.txt"), "changed\n").unwrap();
    fs::write(root.join("src/deep/b.txt"), "changed\n").unwrap();
    let discarded = ok(root, json!({ "action": "discard", "paths": ["src"] })).await;
    assert_eq!(discarded["status"]["files"], json!([]));
}

#[tokio::test]
async fn lists_a_directory_with_ignored_entries_and_refuses_the_git_directory() {
    let dir = repo();
    let root = dir.path();
    fs::write(root.join(".gitignore"), "build/\n*.log\n").unwrap();
    fs::create_dir_all(root.join("build")).unwrap();
    fs::create_dir_all(root.join("src")).unwrap();
    fs::write(root.join("build/out.js"), "").unwrap();
    fs::write(root.join("a.log"), "").unwrap();
    fs::write(root.join("Zed.txt"), "zz").unwrap();

    let shown = ok(root, json!({ "action": "tree" })).await;
    let names = |value: &Value| {
        value["entries"]
            .as_array()
            .unwrap()
            .iter()
            .map(|entry| entry["name"].as_str().unwrap().to_owned())
            .collect::<Vec<_>>()
    };
    assert_eq!(shown["path"], ".");
    assert_eq!(names(&shown), ["src", ".gitignore", "README.md", "Zed.txt"]);
    assert_eq!(shown["truncated"], false);
    let zed = shown["entries"]
        .as_array()
        .unwrap()
        .iter()
        .find(|entry| entry["name"] == "Zed.txt")
        .unwrap();
    assert_eq!(zed["size"], 2);
    assert_eq!(zed["type"], "file");

    let all = ok(root, json!({ "action": "tree", "showIgnored": true })).await;
    assert_eq!(
        names(&all),
        [
            "build",
            "src",
            ".gitignore",
            "a.log",
            "README.md",
            "Zed.txt"
        ]
    );
    let entry = |name: &str| {
        all["entries"]
            .as_array()
            .unwrap()
            .iter()
            .find(|entry| entry["name"] == name)
            .unwrap()
            .clone()
    };
    assert_eq!(entry("build")["ignored"], true);
    assert_eq!(entry("build")["type"], "directory");
    assert_eq!(entry("a.log")["ignored"], true);
    assert_eq!(entry("src")["ignored"], false);
    assert_eq!(entry("src")["path"], "src");

    let inside = ok(
        root,
        json!({ "action": "tree", "path": "build", "showIgnored": true }),
    )
    .await;
    assert_eq!(inside["entries"][0]["path"], "build/out.js");
    assert_eq!(inside["entries"][0]["ignored"], true);

    let refused = run(root, json!({ "action": "tree", "path": ".git" }))
        .await
        .unwrap_err();
    assert_eq!(refused.code, ErrorCode::Forbidden);
    let refused = run(root, json!({ "action": "file_read", "path": ".git/HEAD" }))
        .await
        .unwrap_err();
    assert_eq!(refused.code, ErrorCode::Forbidden);
    assert!(
        run(root, json!({ "action": "tree", "path": "../" }))
            .await
            .is_err()
    );

    let plain = tempdir().unwrap();
    fs::write(plain.path().join("a.log"), "").unwrap();
    let outside = ok(plain.path(), json!({ "action": "tree" })).await;
    assert_eq!(outside["entries"][0]["ignored"], false);
}

#[tokio::test]
async fn reads_and_writes_files_with_conflict_tokens() {
    let dir = repo();
    let root = dir.path();
    let written = ok(
        root,
        json!({ "action": "file_write", "path": "notes/x.txt", "content": "one" }),
    )
    .await;
    assert_eq!(written["status"], "written");
    let first = written["token"].as_str().unwrap().to_owned();
    assert_eq!(first, sha(b"one"));

    let read = ok(
        root,
        json!({ "action": "file_read", "path": "notes/x.txt" }),
    )
    .await;
    assert_eq!(read["kind"], "file");
    assert_eq!(read["content"], "one");
    assert_eq!(read["token"], first);
    assert_eq!(read["size"], 3);
    assert_eq!(read["binary"], false);
    assert_eq!(read["mime"], Value::Null);
    assert_eq!(read["truncated"], false);

    let again = ok(
        root,
        json!({ "action": "file_write", "path": "notes/x.txt", "content": "two", "expectedToken": first }),
    )
    .await;
    assert_eq!(again["status"], "written");
    let second = again["token"].as_str().unwrap().to_owned();
    let stale = ok(
        root,
        json!({ "action": "file_write", "path": "notes/x.txt", "content": "three", "expectedToken": first }),
    )
    .await;
    assert_eq!(stale["status"], "conflict");
    assert_eq!(stale["token"], second);
    assert_eq!(fs::read_to_string(root.join("notes/x.txt")).unwrap(), "two");

    let missing = run(
        root,
        json!({ "action": "file_write", "path": "gone.txt", "content": "x", "create": false }),
    )
    .await
    .unwrap_err();
    assert_eq!(missing.code, ErrorCode::PathNotFound);

    fs::write(root.join("logo.png"), b"\x89PNG\0\0data").unwrap();
    let binary = ok(root, json!({ "action": "file_read", "path": "logo.png" })).await;
    assert_eq!(binary["binary"], true);
    assert_eq!(binary["content"], "");
    assert_eq!(binary["mime"], "image/png");
    let encoded = ok(
        root,
        json!({ "action": "file_read", "path": "logo.png", "encoding": "base64" }),
    )
    .await;
    assert_eq!(encoded["content"], "iVBORwAAZGF0YQ==");
    assert_eq!(encoded["encoding"], "base64");

    fs::write(root.join("big.txt"), "y".repeat(1_000_000)).unwrap();
    let big = ok(root, json!({ "action": "file_read", "path": "big.txt" })).await;
    assert_eq!(big["truncated"], true);
    assert_eq!(big["size"], 1_000_000);
    assert!(big["content"].as_str().unwrap().len() <= 900_000);
}

#[tokio::test]
async fn renames_moves_deletes_and_duplicates_through_git_when_tracked() {
    let dir = repo();
    let root = dir.path();
    let renamed = ok(
        root,
        json!({ "action": "file_rename", "from": "README.md", "to": "GUIDE.md" }),
    )
    .await;
    let files = renamed["status"]["files"].as_array().unwrap();
    assert_eq!(files.len(), 1, "{files:?}");
    assert_eq!(files[0]["path"], "GUIDE.md");
    assert_eq!(files[0]["originalPath"], "README.md");
    assert_eq!(files[0]["index"], "R");

    fs::write(root.join("loose.txt"), "loose\n").unwrap();
    let moved = ok(
        root,
        json!({ "action": "file_rename", "from": "loose.txt", "to": "renamed.txt" }),
    )
    .await;
    assert!(
        moved["status"]["files"]
            .as_array()
            .unwrap()
            .iter()
            .any(|file| file["path"] == "renamed.txt" && file["kind"] == "untracked")
    );
    let refused = run(
        root,
        json!({ "action": "file_rename", "from": "renamed.txt", "to": "GUIDE.md" }),
    )
    .await
    .unwrap_err();
    assert_eq!(refused.code, ErrorCode::InvalidArguments);
    ok(
        root,
        json!({ "action": "file_rename", "from": "renamed.txt", "to": "GUIDE.md", "overwrite": true }),
    )
    .await;
    assert_eq!(
        fs::read_to_string(root.join("GUIDE.md")).unwrap(),
        "loose\n"
    );

    ok(
        root,
        json!({ "action": "file_create", "path": "sub", "type": "directory" }),
    )
    .await;
    ok(
        root,
        json!({ "action": "file_create", "path": "sub/new.txt", "type": "file" }),
    )
    .await;
    assert!(root.join("sub/new.txt").is_file());
    let exists = run(
        root,
        json!({ "action": "file_create", "path": "sub", "type": "file" }),
    )
    .await
    .unwrap_err();
    assert_eq!(exists.code, ErrorCode::InvalidArguments);

    ok(
        root,
        json!({ "action": "file_move", "paths": ["GUIDE.md"], "to": "sub" }),
    )
    .await;
    assert!(root.join("sub/GUIDE.md").exists());
    assert_eq!(
        git_stdout(root, &["ls-files", "sub/GUIDE.md"]),
        "sub/GUIDE.md"
    );
    let itself = run(
        root,
        json!({ "action": "file_move", "paths": ["sub"], "to": "sub" }),
    )
    .await
    .unwrap_err();
    assert_eq!(itself.code, ErrorCode::InvalidArguments);

    ok(
        root,
        json!({ "action": "file_duplicate", "path": "sub/new.txt" }),
    )
    .await;
    ok(
        root,
        json!({ "action": "file_duplicate", "path": "sub/new.txt" }),
    )
    .await;
    assert!(root.join("sub/new copy.txt").exists());
    assert!(root.join("sub/new copy 2.txt").exists());
    ok(root, json!({ "action": "file_duplicate", "path": "sub" })).await;
    assert!(root.join("sub copy/new.txt").exists());

    let deleted = ok(
        root,
        json!({ "action": "file_delete", "paths": ["sub", "sub copy"] }),
    )
    .await;
    assert!(!root.join("sub").exists());
    assert_eq!(deleted["kind"], "mutation");
    let refused = run(root, json!({ "action": "file_delete", "paths": [".git"] }))
        .await
        .unwrap_err();
    assert_eq!(refused.code, ErrorCode::Forbidden);
}

fn search_fixture() -> TempDir {
    let dir = repo();
    let root = dir.path();
    fs::write(root.join(".gitignore"), "build/\n").unwrap();
    fs::create_dir_all(root.join("src")).unwrap();
    fs::create_dir_all(root.join("build")).unwrap();
    fs::write(root.join("src/a.ts"), "const todo = 1;\nTODO: fix todos\n").unwrap();
    fs::write(root.join("src/b.js"), "todo\n").unwrap();
    fs::write(root.join("build/out.js"), "todo\n").unwrap();
    fs::write(root.join("notes.txt"), "Todo\n").unwrap();
    fs::write(root.join("blob.bin"), b"todo\0todo").unwrap();
    dir
}

fn total(value: &Value) -> u64 {
    value["totalMatches"].as_u64().unwrap()
}

#[tokio::test]
async fn searches_with_words_case_regex_globs_and_ignores() {
    let dir = search_fixture();
    let root = dir.path();
    let all = ok(root, json!({ "action": "search", "query": "todo" })).await;
    assert_eq!(total(&all), 5, "{all}");
    assert_eq!(all["filesSkipped"], 1, "the binary file");
    assert_eq!(all["truncated"], false);
    let a = all["files"]
        .as_array()
        .unwrap()
        .iter()
        .find(|file| file["path"] == "src/a.ts")
        .unwrap();
    assert_eq!(a["token"], sha(b"const todo = 1;\nTODO: fix todos\n"));
    assert_eq!(a["matches"][1]["line"], 2);
    assert_eq!(a["matches"][1]["column"], 1);
    assert_eq!(a["matches"][1]["length"], 4);
    assert_eq!(a["matches"][1]["preview"], "TODO: fix todos");
    assert_eq!(a["matches"][1]["previewOffset"], 0);
    assert_eq!(a["matches"][2]["column"], 11);
    assert!(
        !all["files"]
            .as_array()
            .unwrap()
            .iter()
            .any(|file| file["path"].as_str().unwrap().starts_with("build/"))
    );

    let words = ok(
        root,
        json!({ "action": "search", "query": "todo", "wholeWord": true }),
    )
    .await;
    assert_eq!(total(&words), 4);
    let exact = ok(
        root,
        json!({ "action": "search", "query": "todo", "caseSensitive": true }),
    )
    .await;
    assert_eq!(total(&exact), 3);
    let regex = ok(
        root,
        json!({ "action": "search", "query": "^TODO", "regex": true, "caseSensitive": true }),
    )
    .await;
    assert_eq!(total(&regex), 1);
    let literal = ok(root, json!({ "action": "search", "query": "^TODO" })).await;
    assert_eq!(total(&literal), 0);
    let bad = run(
        root,
        json!({ "action": "search", "query": "(", "regex": true }),
    )
    .await;
    assert_eq!(bad.unwrap_err().code, ErrorCode::InvalidArguments);

    let included = ok(
        root,
        json!({ "action": "search", "query": "todo", "include": "*.ts" }),
    )
    .await;
    assert_eq!(included["files"].as_array().unwrap().len(), 1);
    assert_eq!(included["files"][0]["path"], "src/a.ts");
    let excluded = ok(
        root,
        json!({ "action": "search", "query": "todo", "exclude": "src/**, *.bin" }),
    )
    .await;
    assert_eq!(excluded["files"].as_array().unwrap().len(), 1);
    assert_eq!(excluded["files"][0]["path"], "notes.txt");
    let under = ok(
        root,
        json!({ "action": "search", "query": "todo", "path": "src" }),
    )
    .await;
    assert_eq!(total(&under), 4);

    let ignored = ok(
        root,
        json!({ "action": "search", "query": "todo", "includeIgnored": true }),
    )
    .await;
    assert_eq!(total(&ignored), 6);

    let per_file = ok(
        root,
        json!({ "action": "search", "query": "todo", "maxPerFile": 1 }),
    )
    .await;
    let a = per_file["files"]
        .as_array()
        .unwrap()
        .iter()
        .find(|file| file["path"] == "src/a.ts")
        .unwrap();
    assert_eq!(a["matches"].as_array().unwrap().len(), 1);
    assert_eq!(a["truncated"], true);
    let capped = ok(
        root,
        json!({ "action": "search", "query": "todo", "maxResults": 2 }),
    )
    .await;
    assert_eq!(total(&capped), 2);
    assert_eq!(capped["truncated"], true);
}

#[tokio::test]
async fn replaces_preserving_case_and_refuses_files_that_changed() {
    let dir = repo();
    let root = dir.path();
    let content = "Hello hello HELLO\nhello again\n";
    fs::write(root.join("greet.txt"), content).unwrap();
    fs::write(root.join("other.txt"), "hello\n").unwrap();
    let token = sha(content.as_bytes());

    let result = ok(
        root,
        json!({
            "action": "replace", "query": "hello", "replacement": "world", "preserveCase": true,
            "targets": [
                { "path": "greet.txt", "token": token, "lines": [1] },
                { "path": "other.txt", "token": "stale" },
                { "path": "missing.txt", "token": "none" },
            ],
        }),
    )
    .await;
    assert_eq!(result["kind"], "replace");
    assert_eq!(result["replaced"], 3);
    assert_eq!(result["skipped"], 2);
    assert_eq!(result["files"][0]["status"], "ok");
    assert_eq!(result["files"][0]["replaced"], 3);
    assert_eq!(result["files"][1]["status"], "conflict");
    assert_eq!(result["files"][2]["status"], "missing");
    assert_eq!(
        fs::read_to_string(root.join("greet.txt")).unwrap(),
        "World world WORLD\nhello again\n"
    );
    assert_eq!(
        fs::read_to_string(root.join("other.txt")).unwrap(),
        "hello\n"
    );

    let nothing = ok(
        root,
        json!({
            "action": "replace", "query": "absent", "replacement": "x",
            "targets": [{ "path": "other.txt", "token": sha(b"hello\n") }],
        }),
    )
    .await;
    assert_eq!(nothing["files"][0]["status"], "skipped");
    assert_eq!(nothing["skipped"], 0);

    let dollars = ok(
        root,
        json!({
            "action": "replace", "query": "hello", "replacement": "$1",
            "targets": [{ "path": "other.txt", "token": sha(b"hello\n") }],
        }),
    )
    .await;
    assert_eq!(dollars["replaced"], 1);
    assert_eq!(fs::read_to_string(root.join("other.txt")).unwrap(), "$1\n");
}
