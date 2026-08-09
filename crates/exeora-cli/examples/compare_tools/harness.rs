//! Timing primitives and budgets, mirroring `scripts/tool-benchmark`.
//!
//! Every constant here has a twin in TypeScript. They cannot be shared: the two
//! engines are separate processes in separate languages, so the comparison
//! script re-checks the iteration and sample counts it received and refuses to
//! divide numbers that were not produced under the same budget.

use exeora_cli::{protocol::ToolName, tools::ToolEngine};
use serde::Serialize;
use serde_json::Value;
use std::{path::Path, time::Instant};
use tokio::runtime::Runtime;
use tokio_util::sync::CancellationToken;

/// Untimed calls that let the page cache and the thread pools settle.
pub const WARMUP: usize = 3;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Suite {
    Core,
    Hard,
}

#[derive(Clone, Copy)]
pub enum Weight {
    Light,
    Medium,
    Heavy,
    XHeavy,
}

#[derive(Clone, Copy)]
pub enum CoreKind {
    File,
    Grep,
    Process,
}

#[derive(Clone, Copy)]
pub struct Config {
    pub quick: bool,
    pub samples: usize,
}

impl Config {
    pub fn new(suite: Suite, quick: bool) -> Self {
        let samples = match suite {
            Suite::Hard => 3,
            Suite::Core if quick => 3,
            Suite::Core => 5,
        };
        Self { quick, samples }
    }

    pub fn core(self, kind: CoreKind) -> usize {
        match (kind, self.quick) {
            (CoreKind::File, true) => 20,
            (CoreKind::File, false) => 100,
            (CoreKind::Grep, true) => 3,
            (CoreKind::Grep, false) => 10,
            (CoreKind::Process, true) => 5,
            (CoreKind::Process, false) => 20,
        }
    }

    pub fn hard(self, weight: Weight) -> usize {
        match (weight, self.quick) {
            (Weight::Light, false) => 20,
            (Weight::Light, true) => 5,
            (Weight::Medium, false) => 10,
            (Weight::Medium, true) => 3,
            (Weight::Heavy, false) => 5,
            (Weight::Heavy, true) => 2,
            (Weight::XHeavy, false) => 3,
            (Weight::XHeavy, true) => 1,
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaseResult {
    pub name: String,
    pub iterations: usize,
    pub samples: usize,
    pub median_ns: f64,
}

#[derive(Serialize)]
pub struct BenchmarkResult {
    pub engine: &'static str,
    pub cases: Vec<CaseResult>,
}

/// Reports the median of `samples` averages, so one descheduled run cannot move it.
pub fn measure(
    name: impl Into<String>,
    iterations: usize,
    samples: usize,
    mut operation: impl FnMut() -> u128,
) -> CaseResult {
    for _ in 0..WARMUP {
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
        name: name.into(),
        iterations,
        samples,
        median_ns: averages[averages.len() / 2],
    }
}

pub fn timed(operation: impl FnOnce()) -> u128 {
    let started = Instant::now();
    operation();
    started.elapsed().as_nanos()
}

pub fn execute(
    runtime: &Runtime,
    engine: &ToolEngine,
    root: &Path,
    tool: ToolName,
    arguments: Value,
) -> Value {
    let value = runtime
        .block_on(engine.execute(root, tool, arguments, CancellationToken::new()))
        .unwrap_or_else(|error| panic!("{tool} failed during comparison: {error}"));
    serialize(&value);
    value
}

/**
 * The JSON the relay sends, which both executors produce and neither may skip.
 *
 * A JavaScript engine builds a joined string as a rope and flattens it only
 * when something reads it, so discarding a result there measures an answer that
 * was never assembled. Serializing on both sides is what the connection does
 * with every result anyway, and it puts the two engines on the same work.
 */
pub fn serialize(value: &Value) {
    std::hint::black_box(serde_json::to_string(value).expect("serialize tool result"));
}

pub fn process_id(value: &Value) -> String {
    value["processId"]
        .as_str()
        .expect("start_command must return processId")
        .to_owned()
}
