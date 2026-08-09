//! The same ten tools, at sizes and shapes that stop being a syscall wrapper.

use crate::{
    hard_cases::{
        ALTERNATION_PATTERN, MISS_PATTERN, hard_cases, package_path, reset_case, unit_path,
    },
    harness::{CaseResult, Config, Weight, execute, measure, process_id, serialize, timed},
};
use exeora_cli::{protocol::ToolName, tools::ToolEngine};
use futures_util::future::join_all;
use serde_json::{Value, json};
use std::{
    path::Path,
    thread,
    time::{Duration, Instant},
};
use tokio::runtime::Runtime;
use tokio_util::sync::CancellationToken;

pub const UNICODE_UNIT: &str = "héllo→世界 ";
pub const UNICODE_UNIT_REPEATS: usize = 7_111;
pub const UNICODE_CHUNKS: usize = 8;

const FANOUT_READS: usize = 64;
const FANOUT_GREPS: usize = 8;
const MIXED_READS: usize = 32;
const MIXED_LISTS: usize = 8;
const MIXED_GREPS: usize = 8;

#[cfg(unix)]
pub const INTERACTIVE_COMMAND: &str = "cat";
#[cfg(windows)]
pub const INTERACTIVE_COMMAND: &str = "more";

pub fn run(runtime: &Runtime, engine: &ToolEngine, root: &Path, config: Config) -> Vec<CaseResult> {
    let mut cases = Vec::new();

    for hard in hard_cases() {
        cases.push(measure(
            hard.name,
            config.hard(hard.weight),
            config.samples,
            || {
                if hard.reset {
                    reset_case(root);
                }
                // Cloned outside the timed region: the TypeScript side hands the
                // same object to every call and is charged for no copy at all.
                let payload = hard.arguments.clone();
                timed(|| {
                    execute(runtime, engine, root, hard.tool, payload);
                })
            },
        ));
    }

    cases.push(unicode_output(runtime, engine, root, config));
    cases.extend(concurrency(runtime, engine, root, config));
    runtime.block_on(engine.kill_all());
    cases
}

/// A full ring buffer of multi-byte text, read from the start.
///
/// The cursor the contract hands out counts UTF-16 units, which is what a
/// JavaScript string is indexed in and what a Rust `String` is not.
fn unicode_output(
    runtime: &Runtime,
    engine: &ToolEngine,
    root: &Path,
    config: Config,
) -> CaseResult {
    let id = fill_unicode_ring(runtime, engine, root);
    let result = measure(
        "get_command_output_unicode",
        config.hard(Weight::Light),
        config.samples,
        || {
            timed(|| {
                execute(
                    runtime,
                    engine,
                    root,
                    ToolName::GetCommandOutput,
                    json!({"processId":id, "cursor":0}),
                );
            })
        },
    );

    execute(
        runtime,
        engine,
        root,
        ToolName::KillCommand,
        json!({"processId":id}),
    );
    runtime.block_on(engine.kill_all());
    result
}

/// Starts a process and overruns its 256,000-unit ring with multi-byte text.
pub fn fill_unicode_ring(runtime: &Runtime, engine: &ToolEngine, root: &Path) -> String {
    let started = execute(
        runtime,
        engine,
        root,
        ToolName::StartCommand,
        json!({"command":INTERACTIVE_COMMAND}),
    );
    let id = process_id(&started);
    let chunk = UNICODE_UNIT.repeat(UNICODE_UNIT_REPEATS);

    for _ in 0..UNICODE_CHUNKS {
        execute(
            runtime,
            engine,
            root,
            ToolName::SendCommandInput,
            json!({"processId":id, "data":chunk, "newline":false}),
        );
    }
    thread::sleep(Duration::from_millis(250));
    id
}

/// Bursts, because the relay does not wait for one call before starting the next.
fn concurrency(
    runtime: &Runtime,
    engine: &ToolEngine,
    root: &Path,
    config: Config,
) -> Vec<CaseResult> {
    let batch = |calls: &[(ToolName, Value)]| {
        let started = Instant::now();
        runtime.block_on(async {
            let futures = calls.iter().map(|(tool, arguments)| {
                engine.execute(root, *tool, arguments.clone(), CancellationToken::new())
            });
            for result in join_all(futures).await {
                serialize(&result.expect("concurrent call failed"));
            }
        });
        started.elapsed().as_nanos()
    };

    let reads: Vec<(ToolName, Value)> = (0..FANOUT_READS)
        .map(|index| (ToolName::ReadFile, json!({"path":unit_path(index)})))
        .collect();
    let greps: Vec<(ToolName, Value)> = (0..FANOUT_GREPS)
        .map(|_| {
            (
                ToolName::Grep,
                json!({"pattern":ALTERNATION_PATTERN, "path":"corpus/pkg-00", "caseInsensitive":true, "maxResults":200}),
            )
        })
        .collect();

    let mut mixed: Vec<(ToolName, Value)> = (0..MIXED_READS)
        .map(|index| (ToolName::ReadFile, json!({"path":unit_path(index)})))
        .collect();
    mixed.extend((0..MIXED_LISTS).map(|index| {
        (
            ToolName::ListFiles,
            json!({"path":package_path(index), "recursive":true}),
        )
    }));
    mixed.extend((0..MIXED_GREPS).map(|index| {
        (
            ToolName::Grep,
            json!({"pattern":MISS_PATTERN, "path":package_path(index), "maxResults":200}),
        )
    }));

    vec![
        measure(
            format!("concurrent_reads_x{FANOUT_READS}"),
            config.hard(Weight::Heavy),
            config.samples,
            || batch(&reads),
        ),
        measure(
            format!("concurrent_greps_x{FANOUT_GREPS}"),
            config.hard(Weight::XHeavy),
            config.samples,
            || batch(&greps),
        ),
        measure(
            format!("concurrent_mixed_x{}", mixed.len()),
            config.hard(Weight::XHeavy),
            config.samples,
            || batch(&mixed),
        ),
    ]
}
