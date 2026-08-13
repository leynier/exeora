//! Reading a ring buffer back has to reassemble exactly what went in.
//!
//! The slice is taken across chunks now rather than from one flattened copy, so
//! the offset arithmetic runs per chunk and every boundary is a place to be off
//! by one. Multi-byte text is what makes that visible: cursors and limits count
//! UTF-8 bytes, while every returned chunk must still end on a character boundary.

#![cfg(unix)]

use exeora_cli::{protocol::ToolName, tools::ToolEngine};
use serde_json::{Value, json};
use std::time::Duration;
use tempfile::TempDir;
use tokio_util::sync::CancellationToken;

/// Nine UTF-16 units and sixteen UTF-8 bytes.
const UNIT: &str = "héllo→世界 ";
/// Past the 100,000-byte read limit, under the 256,000-byte ring.
const REPEATS: usize = 12_000;

async fn call(engine: &ToolEngine, root: &TempDir, tool: ToolName, args: Value) -> Value {
    engine
        .execute(root.path(), tool, args, CancellationToken::new())
        .await
        .unwrap()
}

#[tokio::test]
async fn a_multibyte_ring_reads_back_in_order_across_chunks() {
    let root = TempDir::new().unwrap();
    let engine = ToolEngine::new().unwrap();
    let sent = UNIT.repeat(REPEATS);
    let bytes = sent.len();

    let started = call(
        &engine,
        &root,
        ToolName::StartCommand,
        json!({"command":"cat"}),
    )
    .await;
    let id = started["processId"].as_str().unwrap().to_owned();
    call(
        &engine,
        &root,
        ToolName::SendCommandInput,
        json!({"processId":id, "data":sent, "newline":false}),
    )
    .await;
    tokio::time::sleep(Duration::from_millis(250)).await;

    let first = call(
        &engine,
        &root,
        ToolName::GetCommandOutput,
        json!({"processId":id, "cursor":0}),
    )
    .await;
    let head = first["chunk"].as_str().unwrap().to_owned();
    assert_eq!(head.len(), 100_000, "read limit in bytes");
    assert_eq!(first["nextCursor"], 100_000);
    assert_eq!(first["skipped"], false, "nothing was dropped at this size");

    let second = call(
        &engine,
        &root,
        ToolName::GetCommandOutput,
        json!({"processId":id, "cursor":first["nextCursor"].clone()}),
    )
    .await;
    let tail = second["chunk"].as_str().unwrap();

    assert_eq!(second["nextCursor"].as_u64().unwrap() as usize, bytes);
    assert_eq!(
        format!("{head}{tail}"),
        sent,
        "the two reads must rebuild the input exactly"
    );

    call(
        &engine,
        &root,
        ToolName::KillCommand,
        json!({"processId":id}),
    )
    .await;
}

#[tokio::test]
async fn writing_to_a_finished_process_says_so_rather_than_reporting_a_pipe() {
    let root = TempDir::new().unwrap();
    let engine = ToolEngine::new().unwrap();

    let started = call(
        &engine,
        &root,
        ToolName::StartCommand,
        json!({"command":"exit 0"}),
    )
    .await;
    let id = started["processId"].as_str().unwrap().to_owned();
    tokio::time::sleep(Duration::from_millis(200)).await;

    // The write is what discovers the exit, since nothing asked the kernel
    // beforehand. The caller still has to be told which of the two it was.
    let error = engine
        .execute(
            root.path(),
            ToolName::SendCommandInput,
            json!({"processId":id, "data":"anyone there", "newline":true}),
            CancellationToken::new(),
        )
        .await
        .expect_err("a finished process cannot take input");
    assert!(
        error.to_string().contains("not accepting input"),
        "unexpected message: {error}"
    );
}

#[tokio::test]
async fn a_killed_process_stops_reporting_itself_as_running() {
    let root = TempDir::new().unwrap();
    let engine = ToolEngine::new().unwrap();

    let started = call(
        &engine,
        &root,
        ToolName::StartCommand,
        json!({"command":"cat"}),
    )
    .await;
    let id = started["processId"].as_str().unwrap().to_owned();

    let killed = call(
        &engine,
        &root,
        ToolName::KillCommand,
        json!({"processId":id}),
    )
    .await;
    assert_eq!(killed["killed"], true);

    // The kill signals without waiting for the reap, so this is the call that
    // has to observe the process is gone rather than the kill itself.
    let output = call(
        &engine,
        &root,
        ToolName::GetCommandOutput,
        json!({"processId":id, "cursor":0}),
    )
    .await;
    assert_eq!(output["running"], false);

    let again = call(
        &engine,
        &root,
        ToolName::KillCommand,
        json!({"processId":id}),
    )
    .await;
    assert_eq!(again["killed"], false, "a second kill is not an error");
}
