//! A process handle is only valid for the project, worktree and caller that
//! started it. Missing proof is a refusal, never a search.

#![cfg(unix)]

use exeora_cli::{
    error::ErrorCode,
    protocol::ToolName,
    tools::{CallScope, ToolEngine},
};
use serde_json::{Value, json};
use tempfile::TempDir;
use tokio_util::sync::CancellationToken;

async fn scoped(
    engine: &ToolEngine,
    root: &TempDir,
    project: &str,
    worktree: &str,
    owner: Option<&str>,
    tool: ToolName,
    args: Value,
) -> Result<Value, exeora_cli::error::ExeoraError> {
    engine
        .execute_scoped(
            root.path(),
            CallScope {
                project,
                worktree,
                owner,
            },
            tool,
            args,
            CancellationToken::new(),
        )
        .await
}

async fn start(
    engine: &ToolEngine,
    root: &TempDir,
    project: &str,
    worktree: &str,
    owner: Option<&str>,
) -> String {
    scoped(
        engine,
        root,
        project,
        worktree,
        owner,
        ToolName::StartCommand,
        json!({"command":"cat"}),
    )
    .await
    .unwrap()["processId"]
        .as_str()
        .unwrap()
        .to_owned()
}

#[tokio::test]
async fn a_handle_is_refused_from_another_worktree_with_the_same_words() {
    let root = TempDir::new().unwrap();
    let other = TempDir::new().unwrap();
    let engine = ToolEngine::new().unwrap();
    let id = start(&engine, &root, "prj_one", "feature", None).await;

    let missing = scoped(
        &engine,
        &root,
        "prj_one",
        "feature",
        None,
        ToolName::GetCommandOutput,
        json!({"processId":"proc_nope"}),
    )
    .await
    .unwrap_err();
    let elsewhere = scoped(
        &engine,
        &other,
        "prj_one",
        "main",
        None,
        ToolName::GetCommandOutput,
        json!({"processId":id}),
    )
    .await
    .unwrap_err();

    assert_eq!(missing.code, ErrorCode::UnknownProcess);
    assert_eq!(elsewhere.code, ErrorCode::UnknownProcess);
    assert_eq!(missing.to_string(), elsewhere.to_string());
    assert_eq!(
        missing.to_string(),
        "No such process in this project and worktree."
    );

    scoped(
        &engine,
        &root,
        "prj_one",
        "feature",
        None,
        ToolName::KillCommand,
        json!({"processId":id}),
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn a_bound_process_refuses_a_different_client() {
    let root = TempDir::new().unwrap();
    let engine = ToolEngine::new().unwrap();
    let id = start(&engine, &root, "prj_one", "main", Some("cli_a")).await;

    let stolen = scoped(
        &engine,
        &root,
        "prj_one",
        "main",
        Some("cli_b"),
        ToolName::KillCommand,
        json!({"processId":id}),
    )
    .await
    .unwrap_err();
    assert_eq!(stolen.code, ErrorCode::UnknownProcess);

    scoped(
        &engine,
        &root,
        "prj_one",
        "main",
        Some("cli_a"),
        ToolName::KillCommand,
        json!({"processId":id}),
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn an_unattributed_process_is_reachable_by_any_caller_in_the_same_tuple() {
    let root = TempDir::new().unwrap();
    let engine = ToolEngine::new().unwrap();
    let id = start(&engine, &root, "prj_one", "main", None).await;

    scoped(
        &engine,
        &root,
        "prj_one",
        "main",
        Some("cli_later"),
        ToolName::GetCommandOutput,
        json!({"processId":id, "cursor":0}),
    )
    .await
    .unwrap();

    scoped(
        &engine,
        &root,
        "prj_one",
        "main",
        Some("cli_later"),
        ToolName::KillCommand,
        json!({"processId":id}),
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn a_stable_worktree_id_keeps_the_handle_when_the_slug_would_have_changed() {
    let root = TempDir::new().unwrap();
    let engine = ToolEngine::new().unwrap();
    let id = start(&engine, &root, "prj_one", "wtr_active", None).await;

    scoped(
        &engine,
        &root,
        "prj_one",
        "wtr_active",
        None,
        ToolName::GetCommandOutput,
        json!({"processId":id, "cursor":0}),
    )
    .await
    .unwrap();

    let old_slug = scoped(
        &engine,
        &root,
        "prj_one",
        "feature",
        None,
        ToolName::GetCommandOutput,
        json!({"processId":id}),
    )
    .await
    .unwrap_err();
    assert_eq!(old_slug.code, ErrorCode::UnknownProcess);

    scoped(
        &engine,
        &root,
        "prj_one",
        "wtr_active",
        None,
        ToolName::KillCommand,
        json!({"processId":id}),
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn a_full_worktree_does_not_spend_another_worktree_slot() {
    let root = TempDir::new().unwrap();
    let other = TempDir::new().unwrap();
    let engine = ToolEngine::new().unwrap();
    let mut feature = Vec::new();
    for _ in 0..exeora_cli::protocol::MAX_PROCESSES_PER_WORKTREE {
        feature.push(start(&engine, &root, "prj_one", "feature", None).await);
    }

    let overflow = scoped(
        &engine,
        &root,
        "prj_one",
        "feature",
        None,
        ToolName::StartCommand,
        json!({"command":"cat"}),
    )
    .await
    .unwrap_err();
    assert!(overflow.to_string().contains("worktree"));

    let main = start(&engine, &other, "prj_one", "main", None).await;

    for id in feature {
        scoped(
            &engine,
            &root,
            "prj_one",
            "feature",
            None,
            ToolName::KillCommand,
            json!({"processId":id}),
        )
        .await
        .unwrap();
    }
    scoped(
        &engine,
        &other,
        "prj_one",
        "main",
        None,
        ToolName::KillCommand,
        json!({"processId":main}),
    )
    .await
    .unwrap();
}
