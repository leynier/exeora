//! The ten tool calls at the size an agent hits them all day.

use crate::harness::{CaseResult, Config, CoreKind, execute, measure, process_id, timed};
use exeora_cli::{protocol::ToolName, tools::ToolEngine};
use serde_json::{Value, json};
use std::{fs, path::Path, thread, time::Duration};
use tokio::runtime::Runtime;

#[cfg(unix)]
const INTERACTIVE_COMMAND: &str = "cat";
#[cfg(windows)]
const INTERACTIVE_COMMAND: &str = "more";

#[cfg(unix)]
const SHORT_COMMAND: &str = "printf exeora";
#[cfg(windows)]
const SHORT_COMMAND: &str = "echo|set /p=exeora";

pub fn run(runtime: &Runtime, engine: &ToolEngine, root: &Path, config: Config) -> Vec<CaseResult> {
    let samples = config.samples;
    let files = config.core(CoreKind::File);
    let processes = config.core(CoreKind::Process);
    let call = |tool: ToolName, arguments: Value| execute(runtime, engine, root, tool, arguments);
    let mut cases = Vec::new();

    cases.push(measure("read_file", files, samples, || {
        timed(|| {
            call(ToolName::ReadFile, json!({"path":"src/module-000.rs"}));
        })
    }));
    cases.push(measure("list_files", files, samples, || {
        timed(|| {
            call(ToolName::ListFiles, json!({"path":"src", "recursive":true}));
        })
    }));
    cases.push(measure(
        "grep",
        config.core(CoreKind::Grep),
        samples,
        || {
            timed(|| {
                call(
                    ToolName::Grep,
                    json!({"pattern":"indexed_symbol", "path":"src", "maxResults":200}),
                );
            })
        },
    ));
    cases.push(measure("edit_file", files, samples, || {
        fs::write(root.join("edit.txt"), "before\nneedle\nafter\n").expect("reset edit file");
        timed(|| {
            call(
                ToolName::EditFile,
                json!({"path":"edit.txt", "oldString":"needle", "newString":"replacement"}),
            );
        })
    }));

    let write_content = "x".repeat(64 * 1024);
    cases.push(measure("write_file", files, samples, || {
        timed(|| {
            call(
                ToolName::WriteFile,
                json!({"path":"output.txt", "content":write_content}),
            );
        })
    }));
    cases.push(measure("run_command", processes, samples, || {
        timed(|| {
            call(ToolName::RunCommand, json!({"command":SHORT_COMMAND}));
        })
    }));
    cases.push(measure("start_command", processes, samples, || {
        let started = std::time::Instant::now();
        let result = call(
            ToolName::StartCommand,
            json!({"command":INTERACTIVE_COMMAND}),
        );
        let elapsed = started.elapsed().as_nanos();
        call(
            ToolName::KillCommand,
            json!({"processId":process_id(&result)}),
        );
        runtime.block_on(engine.kill_all());
        elapsed
    }));
    cases.push(measure("kill_command", processes, samples, || {
        let result = call(
            ToolName::StartCommand,
            json!({"command":INTERACTIVE_COMMAND}),
        );
        let id = process_id(&result);
        let elapsed = timed(|| {
            call(ToolName::KillCommand, json!({"processId":id}));
        });
        runtime.block_on(engine.kill_all());
        elapsed
    }));

    let persistent = call(
        ToolName::StartCommand,
        json!({"command":INTERACTIVE_COMMAND}),
    );
    let persistent_id = process_id(&persistent);
    cases.push(measure("send_command_input", files, samples, || {
        timed(|| {
            call(
                ToolName::SendCommandInput,
                json!({"processId":persistent_id, "data":"ping", "newline":true}),
            );
        })
    }));
    call(
        ToolName::SendCommandInput,
        json!({"processId":persistent_id, "data":"x".repeat(150_000), "newline":false}),
    );
    thread::sleep(Duration::from_millis(50));
    cases.push(measure("get_command_output", files, samples, || {
        timed(|| {
            call(
                ToolName::GetCommandOutput,
                json!({"processId":persistent_id, "cursor":0}),
            );
        })
    }));
    call(ToolName::KillCommand, json!({"processId":persistent_id}));
    runtime.block_on(engine.kill_all());

    cases
}
