use exeora_cli::{error::ErrorCode, protocol::ToolName, tools::ToolEngine};
use serde_json::json;
use tempfile::TempDir;
use tokio_util::sync::CancellationToken;

async fn call(
    engine: &ToolEngine,
    root: &TempDir,
    tool: ToolName,
    args: serde_json::Value,
) -> serde_json::Value {
    engine
        .execute(root.path(), tool, args, CancellationToken::new())
        .await
        .unwrap()
}

#[tokio::test]
async fn file_tools_follow_the_tool_contract() {
    let root = TempDir::new().unwrap();
    let engine = ToolEngine::new().unwrap();

    let written = call(
        &engine,
        &root,
        ToolName::WriteFile,
        json!({"path": "src/../src/main.txt", "content": "alpha\nbeta\nalpha\n"}),
    )
    .await;
    assert_eq!(
        written,
        json!({"path":"src/main.txt","bytesWritten":17,"created":true})
    );

    let read = call(
        &engine,
        &root,
        ToolName::ReadFile,
        json!({"path": "src/main.txt", "offset": 2, "limit": 1}),
    )
    .await;
    assert_eq!(
        read,
        json!({"path":"src/main.txt","content":"beta","truncated":true,"totalLines":3})
    );

    let grep = call(
        &engine,
        &root,
        ToolName::Grep,
        json!({"pattern": "^alpha$", "glob": "**/*.txt"}),
    )
    .await;
    assert_eq!(grep["matches"].as_array().unwrap().len(), 2);
    assert_eq!(grep["matches"][0]["line"], 1);

    let edited = call(
        &engine,
        &root,
        ToolName::EditFile,
        json!({"path": "src/main.txt", "oldString": "beta", "newString": "gamma"}),
    )
    .await;
    assert_eq!(edited["replacements"], 1);
    assert!(edited["diff"].as_str().unwrap().contains("+gamma"));

    let listed = call(
        &engine,
        &root,
        ToolName::ListFiles,
        json!({"recursive": true}),
    )
    .await;
    assert!(
        listed["entries"]
            .as_array()
            .unwrap()
            .iter()
            .any(|entry| entry["path"] == "src/main.txt")
    );
}

#[tokio::test]
async fn rejects_escape_invalid_arguments_and_observes_cancellation() {
    let root = TempDir::new().unwrap();
    let engine = ToolEngine::new().unwrap();
    let escape = engine
        .execute(
            root.path(),
            ToolName::ReadFile,
            json!({"path":"../secret"}),
            CancellationToken::new(),
        )
        .await
        .unwrap_err();
    assert_eq!(escape.code, ErrorCode::PathEscape);

    let invalid = engine
        .execute(
            root.path(),
            ToolName::ReadFile,
            json!({}),
            CancellationToken::new(),
        )
        .await
        .unwrap_err();
    assert_eq!(invalid.code, ErrorCode::InvalidArguments);

    let cancelled = CancellationToken::new();
    cancelled.cancel();
    let result = engine
        .execute(root.path(), ToolName::ListFiles, json!({}), cancelled)
        .await
        .unwrap_err();
    assert_eq!(result.code, ErrorCode::Cancelled);
}

#[tokio::test]
async fn command_tools_capture_output_and_time_out() {
    let root = TempDir::new().unwrap();
    let engine = ToolEngine::new().unwrap();
    let output = call(
        &engine,
        &root,
        ToolName::RunCommand,
        json!({"command":"printf exeora"}),
    )
    .await;
    assert_eq!(output["stdout"], "exeora");
    assert_eq!(output["exitCode"], 0);
    assert_eq!(output["timedOut"], false);

    let timeout = call(
        &engine,
        &root,
        ToolName::RunCommand,
        json!({"command":"sleep 2", "timeoutMs": 1000}),
    )
    .await;
    assert_eq!(timeout["timedOut"], true);
    assert_eq!(timeout["exitCode"], serde_json::Value::Null);
}
