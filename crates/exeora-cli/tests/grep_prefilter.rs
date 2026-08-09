//! The literal prefilter must change what grep skips, never what it finds.
//!
//! Every pattern here is one the prefilter could get wrong: a construct only
//! JavaScript has, a class Rust reads differently, a case fold outside ASCII,
//! or a pattern that can match nothing at all. The counts are what a JavaScript
//! engine answers, which is what the contract promises.

use exeora_cli::{protocol::ToolName, tools::ToolEngine};
use serde_json::{Value, json};
use std::fs;
use tempfile::TempDir;
use tokio_util::sync::CancellationToken;

const LINES: &[&str] = &[
    "let zeta_001_beacon = compute();",         // 1
    "let ZETA_002_BEACON = compute();",         // 2
    "foobar and foobaz on one line",            // 3
    "xy and zy",                                // 4
    "aa bb cc",                                 // 5
    " indent with a leading space",             // 6
    "\u{feff}indent behind a zero width space", // 7
    "café au lait",                             // 8
    "CAFÉ AU LAIT",                             // 9
    "start of the line",                        // 10
    "the line's end",                           // 11
    "wrap <div id=\"x\"> here",                 // 12
    "this is about time",                       // 13
    "a zone of quiet",                          // 14
    "the ANGLE marker",                         // 15
];

fn fixture() -> TempDir {
    let root = TempDir::new().unwrap();
    fs::write(
        root.path().join("sample.txt"),
        format!("{}\n", LINES.join("\n")),
    )
    .unwrap();
    root
}

async fn lines_matching(pattern: &str, case_insensitive: bool) -> Vec<u64> {
    let root = fixture();
    let engine = ToolEngine::new().unwrap();
    let result: Value = engine
        .execute(
            root.path(),
            ToolName::Grep,
            json!({"pattern": pattern, "caseInsensitive": case_insensitive, "maxResults": 200}),
            CancellationToken::new(),
        )
        .await
        .unwrap();

    result["matches"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| entry["line"].as_u64().unwrap())
        .collect()
}

#[tokio::test]
async fn alternation_is_prefiltered_without_losing_a_case_fold() {
    // The prefilter proves four prefixes here, and has to match either case.
    assert_eq!(
        lines_matching(r"(?:zeta|omega|kappa|sigma)_[0-9]{3}_beacon", false).await,
        vec![1]
    );
    assert_eq!(
        lines_matching(r"(?:zeta|omega|kappa|sigma)_[0-9]{3}_beacon", true).await,
        vec![1, 2]
    );
}

#[tokio::test]
async fn javascript_only_syntax_falls_back_to_the_engine() {
    // None of these parse as a Rust regex, so none of them get a prefilter.
    assert_eq!(lines_matching(r"foo(?=bar)", false).await, vec![3]);
    assert_eq!(lines_matching(r"(?<=x)y", false).await, vec![4]);
    // Every doubled word character: the `00` in both beacons, `oo` in foobar,
    // and `aa`. What matters is that a backreference still searches every line.
    assert_eq!(lines_matching(r"(\w)\1", false).await, vec![1, 2, 3, 5]);
}

#[tokio::test]
async fn escapes_rust_reads_as_syntax_stay_literal() {
    // Without the `u` flag JavaScript reads every one of these as the character
    // itself. Rust reads `\<` as a word boundary, `\a` as a bell and `\A`/`\z`
    // as anchors, so a prefilter built from the Rust parse would require a
    // literal the pattern never has and grep would answer nothing.
    assert_eq!(lines_matching(r"\<div", false).await, vec![12]);
    assert_eq!(lines_matching(r"\about", false).await, vec![13]);
    assert_eq!(lines_matching(r"\zone", false).await, vec![14]);
    assert_eq!(lines_matching(r"\ANGLE", false).await, vec![15]);
}

#[tokio::test]
async fn a_whitespace_class_is_declined_rather_than_narrowed() {
    // Rust's `\s` is Unicode White_Space, which JavaScript's also covers U+FEFF
    // beyond. A prefilter built from the narrower set would lose line 7.
    assert_eq!(lines_matching(r"\sindent", false).await, vec![6, 7]);
}

#[tokio::test]
async fn a_non_ascii_literal_is_declined_when_folding_is_asked_for() {
    assert_eq!(lines_matching("café", false).await, vec![8]);
    assert_eq!(lines_matching("café", true).await, vec![8, 9]);
}

#[tokio::test]
async fn anchors_and_empty_matches_survive() {
    assert_eq!(lines_matching("^start", false).await, vec![10]);
    assert_eq!(lines_matching("end$", false).await, vec![11]);
    // `x*` matches the empty string, so no literal is required and every line
    // is a match. A prefilter here would answer nothing at all.
    assert_eq!(
        lines_matching("x*", false).await.len(),
        LINES.len(),
        "an empty-matching pattern must still match every line"
    );
}
