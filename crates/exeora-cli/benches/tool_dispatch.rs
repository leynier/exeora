use criterion::{BatchSize, Criterion, Throughput, criterion_group, criterion_main};
use exeora_cli::{protocol::ToolName, tools::ToolEngine};
use serde_json::{Value, json};
use std::{fs, path::Path};
use tempfile::TempDir;
use tokio::runtime::Runtime;
use tokio_util::sync::CancellationToken;

fn execute(
    runtime: &Runtime,
    engine: &ToolEngine,
    root: &Path,
    tool: ToolName,
    arguments: Value,
) -> Value {
    runtime
        .block_on(engine.execute(root, tool, arguments, CancellationToken::new()))
        .unwrap()
}

fn fixture() -> TempDir {
    let root = TempDir::new().unwrap();
    fs::create_dir(root.path().join("src")).unwrap();
    let body = "fn indexed_symbol() { println!(\"exeora benchmark\"); }\n".repeat(128);
    for index in 0..128 {
        fs::write(root.path().join(format!("src/module-{index:03}.rs")), &body).unwrap();
    }
    root
}

#[cfg(unix)]
const INTERACTIVE_COMMAND: &str = "cat";
#[cfg(windows)]
const INTERACTIVE_COMMAND: &str = "more";

fn tool_calls(c: &mut Criterion) {
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let engine = ToolEngine::new().unwrap();
    let root = fixture();
    let read_size = fs::metadata(root.path().join("src/module-000.rs"))
        .unwrap()
        .len();

    let mut files = c.benchmark_group("tool calls/files");
    files.throughput(Throughput::Bytes(read_size));
    files.bench_function("read_file cached 7 KiB", |b| {
        b.iter(|| {
            execute(
                &runtime,
                &engine,
                root.path(),
                ToolName::ReadFile,
                json!({"path":"src/module-000.rs"}),
            )
        })
    });
    files.throughput(Throughput::Elements(128));
    files.bench_function("list_files 128 entries", |b| {
        b.iter(|| {
            execute(
                &runtime,
                &engine,
                root.path(),
                ToolName::ListFiles,
                json!({"path":"src", "recursive":true}),
            )
        })
    });
    files.throughput(Throughput::Bytes(read_size * 128));
    files.bench_function("grep 128 files parallel", |b| {
        b.iter(|| {
            execute(
                &runtime,
                &engine,
                root.path(),
                ToolName::Grep,
                json!({"pattern":"indexed_symbol", "path":"src", "maxResults":200}),
            )
        })
    });
    files.throughput(Throughput::Bytes(64 * 1024));
    files.bench_function("write_file overwrite 64 KiB", |b| {
        let content = "x".repeat(64 * 1024);
        b.iter(|| {
            execute(
                &runtime,
                &engine,
                root.path(),
                ToolName::WriteFile,
                json!({"path":"output.txt", "content":content}),
            )
        })
    });
    files.bench_function("edit_file unique replacement", |b| {
        b.iter_batched(
            || fs::write(root.path().join("edit.txt"), "before\nneedle\nafter\n").unwrap(),
            |_| {
                execute(
                    &runtime,
                    &engine,
                    root.path(),
                    ToolName::EditFile,
                    json!({"path":"edit.txt", "oldString":"needle", "newString":"replacement"}),
                )
            },
            BatchSize::PerIteration,
        )
    });
    files.finish();

    let mut processes = c.benchmark_group("tool calls/processes");
    processes.sample_size(20);
    processes.bench_function("run_command spawn and capture", |b| {
        b.iter(|| {
            execute(
                &runtime,
                &engine,
                root.path(),
                ToolName::RunCommand,
                json!({"command":"printf exeora"}),
            )
        })
    });
    processes.bench_function("start_command and kill_command lifecycle", |b| {
        b.iter(|| {
            let started = execute(
                &runtime,
                &engine,
                root.path(),
                ToolName::StartCommand,
                json!({"command":INTERACTIVE_COMMAND}),
            );
            execute(
                &runtime,
                &engine,
                root.path(),
                ToolName::KillCommand,
                json!({"processId":started["processId"]}),
            )
        })
    });

    let persistent = execute(
        &runtime,
        &engine,
        root.path(),
        ToolName::StartCommand,
        json!({"command":INTERACTIVE_COMMAND}),
    );
    let process_id = persistent["processId"].as_str().unwrap().to_owned();
    processes.bench_function("send_command_input", |b| {
        b.iter(|| {
            execute(
                &runtime,
                &engine,
                root.path(),
                ToolName::SendCommandInput,
                json!({"processId":process_id, "data":"ping", "newline":true}),
            )
        })
    });
    execute(
        &runtime,
        &engine,
        root.path(),
        ToolName::SendCommandInput,
        json!({"processId":process_id, "data":"x".repeat(150_000), "newline":false}),
    );
    runtime.block_on(async { tokio::time::sleep(std::time::Duration::from_millis(50)).await });
    processes.bench_function("get_command_output", |b| {
        b.iter(|| {
            execute(
                &runtime,
                &engine,
                root.path(),
                ToolName::GetCommandOutput,
                json!({"processId":process_id, "cursor":0}),
            )
        })
    });
    execute(
        &runtime,
        &engine,
        root.path(),
        ToolName::KillCommand,
        json!({"processId":process_id}),
    );
    processes.finish();

    c.bench_function("tool schema initialization", |b| {
        b.iter(|| std::hint::black_box(ToolEngine::new().unwrap()))
    });
}

criterion_group!(benches, tool_calls);
criterion_main!(benches);
