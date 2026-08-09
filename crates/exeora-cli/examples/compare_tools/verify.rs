//! What each hard case answered, reduced to a line both engines can be held to.
//!
//! A speedup only means something if the two engines did the same work, and the
//! binary case is the reason this exists: an engine that walks away from 4 MB of
//! blobs at the first NUL byte looks identical to one that never opened them.
//! Unified diffs are excluded on purpose, since `diff` and `similar` format the
//! same edit differently; the file left on disk is checked instead.

use crate::{
    hard_cases::{EDIT_ANCHOR_NEW, hard_cases, reset_case},
    hard_suite::fill_unicode_ring,
    harness::execute,
};
use exeora_cli::{protocol::ToolName, tools::ToolEngine};
use serde_json::{Value, json};
use std::{collections::BTreeMap, fs, path::Path};
use tokio::runtime::Runtime;

pub fn run(runtime: &Runtime, engine: &ToolEngine, root: &Path) -> BTreeMap<String, String> {
    let mut fingerprints = BTreeMap::new();

    for hard in hard_cases() {
        if hard.reset {
            reset_case(root);
        }
        let result = execute(runtime, engine, root, hard.tool, hard.arguments);
        fingerprints.insert(hard.name.to_owned(), fingerprint(root, hard.tool, &result));
    }

    let id = fill_unicode_ring(runtime, engine, root);
    let output = execute(
        runtime,
        engine,
        root,
        ToolName::GetCommandOutput,
        json!({"processId":id, "cursor":0}),
    );
    // Not the cursor: both rings evict whole chunks, and a chunk is whatever one
    // read off the pipe returned, so how much was dropped is the kernel's answer
    // rather than the executor's. The slice handed back is the comparable part.
    fingerprints.insert(
        "get_command_output_unicode".to_owned(),
        format!(
            "units={} skipped={}",
            text(&output, "chunk").encode_utf16().count(),
            output["skipped"]
        ),
    );
    execute(
        runtime,
        engine,
        root,
        ToolName::KillCommand,
        json!({"processId":id}),
    );
    runtime.block_on(engine.kill_all());

    fingerprints
}

fn fingerprint(root: &Path, tool: ToolName, value: &Value) -> String {
    match tool {
        ToolName::ReadFile => format!(
            "path={} lines={} truncated={} bytes={}",
            text(value, "path"),
            value["totalLines"],
            value["truncated"],
            text(value, "content").len()
        ),
        ToolName::ListFiles => {
            let entries = array(value, "entries");
            format!(
                "entries={} truncated={} first={} last={}",
                entries.len(),
                value["truncated"],
                edge(entries.first()),
                edge(entries.last())
            )
        }
        ToolName::Grep => {
            let matches = array(value, "matches");
            format!(
                "matches={} truncated={} first={} last={}",
                matches.len(),
                value["truncated"],
                location(matches.first()),
                location(matches.last())
            )
        }
        ToolName::EditFile => {
            let content = fs::read_to_string(root.join(text(value, "path"))).expect("edited file");
            format!(
                "path={} replacements={} fileBytes={} anchored={}",
                text(value, "path"),
                value["replacements"],
                content.len(),
                content.contains(EDIT_ANCHOR_NEW)
            )
        }
        ToolName::WriteFile => format!(
            "path={} bytes={} created={}",
            text(value, "path"),
            value["bytesWritten"],
            value["created"]
        ),
        ToolName::RunCommand => format!(
            "exit={} truncated={} timedOut={} stdout={} stderr={}",
            value["exitCode"],
            value["truncated"],
            value["timedOut"],
            text(value, "stdout").len(),
            text(value, "stderr").len()
        ),
        other => panic!("no fingerprint defined for {other}"),
    }
}

fn text<'a>(value: &'a Value, key: &str) -> &'a str {
    value[key].as_str().unwrap_or_default()
}

fn array<'a>(value: &'a Value, key: &str) -> &'a [Value] {
    value[key].as_array().map_or(&[], Vec::as_slice)
}

fn edge(entry: Option<&Value>) -> String {
    entry.map_or_else(|| "none".to_owned(), |entry| text(entry, "path").to_owned())
}

fn location(entry: Option<&Value>) -> String {
    entry.map_or_else(
        || "none".to_owned(),
        |entry| format!("{}:{}", text(entry, "path"), entry["line"]),
    )
}
