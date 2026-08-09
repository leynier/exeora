//! The Rust half of `bun run bench:tools`.
//!
//! Takes a fixture the comparison script generated, runs one suite over it and
//! prints the timings as JSON. It builds nothing itself: the script hands both
//! engines their own copy of the same corpus, which is the only way the two
//! numbers under a case mean the same thing. `--verify` swaps the timings for a
//! fingerprint of every answer, which is how the script proves the two engines
//! did the same work before dividing one by the other.

mod core_suite;
mod hard_cases;
mod hard_suite;
mod harness;
mod verify;

use exeora_cli::tools::ToolEngine;
use harness::{BenchmarkResult, Config, Suite};
use std::{env, path::PathBuf};

struct Arguments {
    root: PathBuf,
    suite: Suite,
    quick: bool,
    verify: bool,
}

fn main() {
    let arguments = parse_arguments();
    let config = Config::new(arguments.suite, arguments.quick);
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("Tokio runtime");
    let engine = ToolEngine::new().expect("tool engine");
    let root = arguments.root.as_path();

    if arguments.verify {
        let fingerprints = verify::run(&runtime, &engine, root);
        println!(
            "{}",
            serde_json::to_string(&fingerprints).expect("serialize fingerprints")
        );
        return;
    }

    let cases = match arguments.suite {
        Suite::Core => core_suite::run(&runtime, &engine, root, config),
        Suite::Hard => hard_suite::run(&runtime, &engine, root, config),
    };

    println!(
        "{}",
        serde_json::to_string(&BenchmarkResult {
            engine: "rust",
            cases,
        })
        .expect("serialize benchmark result")
    );
}

fn parse_arguments() -> Arguments {
    let mut root = None;
    let mut suite = Suite::Core;
    let mut quick = false;
    let mut verify = false;
    let mut arguments = env::args().skip(1);

    while let Some(argument) = arguments.next() {
        match argument.as_str() {
            "--fixture" => root = arguments.next().map(PathBuf::from),
            "--suite" => {
                suite = match arguments.next().as_deref() {
                    Some("core") | None => Suite::Core,
                    Some("hard") => Suite::Hard,
                    Some(other) => panic!("unknown suite: {other}"),
                }
            }
            "--quick" => quick = true,
            "--verify" => verify = true,
            _ => panic!("unknown argument: {argument}"),
        }
    }

    Arguments {
        root: root.expect("--fixture PATH is required"),
        suite,
        quick,
        verify,
    }
}
