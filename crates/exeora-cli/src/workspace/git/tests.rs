//! The v1 actions, against real repositories in temporary directories.

use super::{
    GitWorkspace,
    status::{ahead_of_upstream, parse_status, parse_worktree_list},
};
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
    let status = parse_status(b"# branch.oid abc123\0# branch.head main\0# stash 3\0", "").unwrap();
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
