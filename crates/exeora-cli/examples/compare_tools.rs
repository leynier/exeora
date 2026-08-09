use exeora_cli::{protocol::ToolName, tools::ToolEngine};
use serde::Serialize;
use serde_json::{Value, json};
use std::{
    env, fs,
    path::{Path, PathBuf},
    time::{Duration, Instant},
};
use tokio::runtime::Runtime;
use tokio_util::sync::CancellationToken;

#[cfg(unix)]
const INTERACTIVE_COMMAND: &str = "cat";
#[cfg(windows)]
const INTERACTIVE_COMMAND: &str = "more";

#[cfg(unix)]
const SHORT_COMMAND: &str = "printf exeora";
#[cfg(windows)]
const SHORT_COMMAND: &str = "echo|set /p=exeora";

#[derive(Clone, Copy)]
struct Config {
    samples: usize,
    file_iterations: usize,
    grep_iterations: usize,
    process_iterations: usize,
}

impl Config {
    fn from_quick(quick: bool) -> Self {
        if quick {
            Self {
                samples: 3,
                file_iterations: 20,
                grep_iterations: 3,
                process_iterations: 5,
            }
        } else {
            Self {
                samples: 5,
                file_iterations: 100,
                grep_iterations: 10,
                process_iterations: 20,
            }
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CaseResult {
    name: &'static str,
    iterations: usize,
    samples: usize,
    median_ns: f64,
}

#[derive(Serialize)]
struct BenchmarkResult {
    engine: &'static str,
    cases: Vec<CaseResult>,
}

fn execute(
    runtime: &Runtime,
    engine: &ToolEngine,
    root: &Path,
    tool: ToolName,
    arguments: Value,
) -> Value {
    runtime
        .block_on(engine.execute(root, tool, arguments, CancellationToken::new()))
        .unwrap_or_else(|error| panic!("{tool} failed during comparison: {error}"))
}

fn measure(
    name: &'static str,
    iterations: usize,
    samples: usize,
    mut operation: impl FnMut() -> u128,
) -> CaseResult {
    for _ in 0..3 {
        std::hint::black_box(operation());
    }

    let mut averages = Vec::with_capacity(samples);
    for _ in 0..samples {
        let mut elapsed = 0_u128;
        for _ in 0..iterations {
            elapsed += std::hint::black_box(operation());
        }
        averages.push(elapsed as f64 / iterations as f64);
    }
    averages.sort_by(f64::total_cmp);

    CaseResult {
        name,
        iterations,
        samples,
        median_ns: averages[averages.len() / 2],
    }
}

fn timed(operation: impl FnOnce()) -> u128 {
    let started = Instant::now();
    operation();
    started.elapsed().as_nanos()
}

fn process_id(value: &Value) -> String {
    value["processId"]
        .as_str()
        .expect("start_command must return processId")
        .to_owned()
}

fn parse_arguments() -> (PathBuf, bool) {
    let mut root = None;
    let mut quick = false;
    let mut arguments = env::args().skip(1);
    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--fixture" => root = arguments.next().map(PathBuf::from),
            "--quick" => quick = true,
            _ => panic!("unknown argument: {argument}"),
        }
    }
    (root.expect("--fixture PATH is required"), quick)
}

fn main() {
    let (root, quick) = parse_arguments();
    let config = Config::from_quick(quick);
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("Tokio runtime");
    let engine = ToolEngine::new().expect("tool engine");
    let mut cases = Vec::with_capacity(ToolName::ALL.len());

    cases.push(measure(
        "read_file",
        config.file_iterations,
        config.samples,
        || {
            timed(|| {
                execute(
                    &runtime,
                    &engine,
                    &root,
                    ToolName::ReadFile,
                    json!({"path":"src/module-000.rs"}),
                );
            })
        },
    ));
    cases.push(measure(
        "list_files",
        config.file_iterations,
        config.samples,
        || {
            timed(|| {
                execute(
                    &runtime,
                    &engine,
                    &root,
                    ToolName::ListFiles,
                    json!({"path":"src", "recursive":true}),
                );
            })
        },
    ));
    cases.push(measure(
        "grep",
        config.grep_iterations,
        config.samples,
        || {
            timed(|| {
                execute(
                    &runtime,
                    &engine,
                    &root,
                    ToolName::Grep,
                    json!({"pattern":"indexed_symbol", "path":"src", "maxResults":200}),
                );
            })
        },
    ));
    cases.push(measure(
        "edit_file",
        config.file_iterations,
        config.samples,
        || {
            fs::write(root.join("edit.txt"), "before\nneedle\nafter\n").expect("reset edit file");
            timed(|| {
                execute(
                    &runtime,
                    &engine,
                    &root,
                    ToolName::EditFile,
                    json!({"path":"edit.txt", "oldString":"needle", "newString":"replacement"}),
                );
            })
        },
    ));
    let write_content = "x".repeat(64 * 1024);
    cases.push(measure(
        "write_file",
        config.file_iterations,
        config.samples,
        || {
            timed(|| {
                execute(
                    &runtime,
                    &engine,
                    &root,
                    ToolName::WriteFile,
                    json!({"path":"output.txt", "content":write_content}),
                );
            })
        },
    ));
    cases.push(measure(
        "run_command",
        config.process_iterations,
        config.samples,
        || {
            timed(|| {
                execute(
                    &runtime,
                    &engine,
                    &root,
                    ToolName::RunCommand,
                    json!({"command":SHORT_COMMAND}),
                );
            })
        },
    ));
    cases.push(measure(
        "start_command",
        config.process_iterations,
        config.samples,
        || {
            let started = Instant::now();
            let result = execute(
                &runtime,
                &engine,
                &root,
                ToolName::StartCommand,
                json!({"command":INTERACTIVE_COMMAND}),
            );
            let elapsed = started.elapsed().as_nanos();
            execute(
                &runtime,
                &engine,
                &root,
                ToolName::KillCommand,
                json!({"processId":process_id(&result)}),
            );
            runtime.block_on(engine.kill_all());
            elapsed
        },
    ));
    cases.push(measure(
        "kill_command",
        config.process_iterations,
        config.samples,
        || {
            let result = execute(
                &runtime,
                &engine,
                &root,
                ToolName::StartCommand,
                json!({"command":INTERACTIVE_COMMAND}),
            );
            let id = process_id(&result);
            let elapsed = timed(|| {
                execute(
                    &runtime,
                    &engine,
                    &root,
                    ToolName::KillCommand,
                    json!({"processId":id}),
                );
            });
            runtime.block_on(engine.kill_all());
            elapsed
        },
    ));

    let persistent = execute(
        &runtime,
        &engine,
        &root,
        ToolName::StartCommand,
        json!({"command":INTERACTIVE_COMMAND}),
    );
    let persistent_id = process_id(&persistent);
    cases.push(measure(
        "send_command_input",
        config.file_iterations,
        config.samples,
        || {
            timed(|| {
                execute(
                    &runtime,
                    &engine,
                    &root,
                    ToolName::SendCommandInput,
                    json!({"processId":persistent_id, "data":"ping", "newline":true}),
                );
            })
        },
    ));
    execute(
        &runtime,
        &engine,
        &root,
        ToolName::SendCommandInput,
        json!({"processId":persistent_id, "data":"x".repeat(150_000), "newline":false}),
    );
    std::thread::sleep(Duration::from_millis(50));
    cases.push(measure(
        "get_command_output",
        config.file_iterations,
        config.samples,
        || {
            timed(|| {
                execute(
                    &runtime,
                    &engine,
                    &root,
                    ToolName::GetCommandOutput,
                    json!({"processId":persistent_id, "cursor":0}),
                );
            })
        },
    ));
    execute(
        &runtime,
        &engine,
        &root,
        ToolName::KillCommand,
        json!({"processId":persistent_id}),
    );
    runtime.block_on(engine.kill_all());

    println!(
        "{}",
        serde_json::to_string(&BenchmarkResult {
            engine: "rust",
            cases,
        })
        .expect("serialize benchmark result")
    );
}
