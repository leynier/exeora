use assert_cmd::Command;
use predicates::prelude::*;
use serde_json::json;

use exeora_cli::protocol::{ToolResult, WireError};

#[test]
fn exposes_the_command_surface_and_version_flag() {
    Command::cargo_bin("exeora")
        .unwrap()
        .arg("-v")
        .assert()
        .success()
        // Read from Cargo rather than written out: the version is bumped every
        // release, and a literal here only ever fails for having been bumped.
        .stdout(format!("exeora {}\n", env!("CARGO_PKG_VERSION")));

    Command::cargo_bin("exeora")
        .unwrap()
        .arg("--help")
        .assert()
        .success()
        .stdout(
            predicate::str::contains("login")
                .and(predicate::str::contains("logout"))
                .and(predicate::str::contains("gateway"))
                .and(predicate::str::contains("device"))
                .and(predicate::str::contains("project"))
                .and(predicate::str::contains("connect"))
                .and(predicate::str::contains("status"))
                .and(predicate::str::contains("logs"))
                .and(predicate::str::contains("init"))
                .and(predicate::str::contains("prompt"))
                .and(predicate::str::contains("sync"))
                .and(predicate::str::contains("upgrade"))
                .and(predicate::str::contains("keep it awake")),
        );

    Command::cargo_bin("exeora")
        .unwrap()
        .arg("connect")
        .arg("--help")
        .assert()
        .success()
        .stdout(
            predicate::str::contains("serve registered projects")
                .and(predicate::str::contains("--no-add").not())
                .and(predicate::str::contains("[PATH]").not()),
        );
}

#[test]
fn serializes_wire_results_with_boolean_discriminators() {
    assert_eq!(
        serde_json::to_value(ToolResult::ok(json!({"answer": 42}))).unwrap(),
        json!({"ok": true, "value": {"answer": 42}})
    );
    assert_eq!(
        serde_json::to_value(ToolResult::err(WireError::new(
            exeora_cli::error::ErrorCode::ToolFailed,
            "failed",
        )))
        .unwrap(),
        json!({"ok": false, "error": {"code": "TOOL_FAILED", "message": "failed"}})
    );
}

#[test]
fn json_mode_keeps_errors_machine_readable() {
    let config = tempfile::NamedTempFile::new().unwrap();
    Command::cargo_bin("exeora")
        .unwrap()
        .env("EXEORA_CONFIG_PATH", config.path())
        .args(["--json", "status"])
        .assert()
        .failure()
        .stderr(predicate::str::starts_with("{\"error\":"));
}
