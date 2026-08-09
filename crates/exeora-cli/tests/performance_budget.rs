use exeora_cli::{protocol::ToolName, tools::ToolEngine};
use serde_json::json;
use std::{
    fs,
    time::{Duration, Instant},
};
use tempfile::TempDir;
use tokio_util::sync::CancellationToken;

#[cfg(unix)]
const INTERACTIVE_COMMAND: &str = "cat";
#[cfg(windows)]
const INTERACTIVE_COMMAND: &str = "more";

fn fixture() -> TempDir {
    let root = TempDir::new().unwrap();
    fs::create_dir(root.path().join("src")).unwrap();
    let content = "pub fn searchable_symbol() {}\n".repeat(128);
    for index in 0..100 {
        fs::write(
            root.path().join(format!("src/file-{index:03}.rs")),
            &content,
        )
        .unwrap();
    }
    root
}

#[tokio::test]
async fn representative_tool_calls_stay_inside_generous_regression_budgets() {
    let root = fixture();
    let initialized = Instant::now();
    let engine = ToolEngine::new().unwrap();
    assert!(
        initialized.elapsed() < Duration::from_secs(2),
        "schema initialization exceeded 2s"
    );

    let read = Instant::now();
    for _ in 0..50 {
        engine
            .execute(
                root.path(),
                ToolName::ReadFile,
                json!({"path":"src/file-000.rs"}),
                CancellationToken::new(),
            )
            .await
            .unwrap();
    }
    assert!(
        read.elapsed() < Duration::from_secs(2),
        "50 cached reads exceeded 2s"
    );

    let list = Instant::now();
    for _ in 0..20 {
        engine
            .execute(
                root.path(),
                ToolName::ListFiles,
                json!({"path":"src", "recursive":true}),
                CancellationToken::new(),
            )
            .await
            .unwrap();
    }
    assert!(
        list.elapsed() < Duration::from_secs(3),
        "20 recursive listings exceeded 3s"
    );

    let grep = Instant::now();
    for _ in 0..10 {
        engine
            .execute(
                root.path(),
                ToolName::Grep,
                json!({"pattern":"searchable_symbol", "path":"src", "maxResults":200}),
                CancellationToken::new(),
            )
            .await
            .unwrap();
    }
    assert!(
        grep.elapsed() < Duration::from_secs(5),
        "10 parallel searches exceeded 5s"
    );

    let writes = Instant::now();
    for index in 0..25 {
        engine
            .execute(
                root.path(),
                ToolName::WriteFile,
                json!({"path":"output.txt", "content":format!("value-{index}")}),
                CancellationToken::new(),
            )
            .await
            .unwrap();
    }
    assert!(
        writes.elapsed() < Duration::from_secs(2),
        "25 writes exceeded 2s"
    );

    let commands = Instant::now();
    for _ in 0..10 {
        engine
            .execute(
                root.path(),
                ToolName::RunCommand,
                json!({"command":"printf exeora"}),
                CancellationToken::new(),
            )
            .await
            .unwrap();
    }
    assert!(
        commands.elapsed() < Duration::from_secs(5),
        "10 captured commands exceeded 5s"
    );

    let lifecycle = Instant::now();
    for _ in 0..10 {
        let started = engine
            .execute(
                root.path(),
                ToolName::StartCommand,
                json!({"command":INTERACTIVE_COMMAND}),
                CancellationToken::new(),
            )
            .await
            .unwrap();
        engine
            .execute(
                root.path(),
                ToolName::KillCommand,
                json!({"processId":started["processId"]}),
                CancellationToken::new(),
            )
            .await
            .unwrap();
    }
    assert!(
        lifecycle.elapsed() < Duration::from_secs(5),
        "10 process lifecycles exceeded 5s"
    );

    #[cfg(unix)]
    {
        let started = engine
            .execute(
                root.path(),
                ToolName::StartCommand,
                json!({"command":"cat"}),
                CancellationToken::new(),
            )
            .await
            .unwrap();
        let process_id = started["processId"].as_str().unwrap();
        engine
            .execute(
                root.path(),
                ToolName::SendCommandInput,
                json!({"processId":process_id, "data":"x".repeat(150_000), "newline":false}),
                CancellationToken::new(),
            )
            .await
            .unwrap();
        tokio::time::sleep(Duration::from_millis(50)).await;
        let large_output = Instant::now();
        let output = engine
            .execute(
                root.path(),
                ToolName::GetCommandOutput,
                json!({"processId":process_id, "cursor":0}),
                CancellationToken::new(),
            )
            .await
            .unwrap();
        assert!(
            output["chunk"].as_str().unwrap().len() >= 50_000,
            "large-output fixture did not reach the ring buffer"
        );
        assert!(
            large_output.elapsed() < Duration::from_millis(500),
            "linear get_command_output slice exceeded 500ms"
        );
        engine
            .execute(
                root.path(),
                ToolName::KillCommand,
                json!({"processId":process_id}),
                CancellationToken::new(),
            )
            .await
            .unwrap();
    }
}
