use assert_cmd::Command;
use predicates::prelude::*;
use std::path::Path;

fn exeora(home: &Path) -> Command {
    let mut command = Command::cargo_bin("exeora").unwrap();
    command
        .env("EXEORA_CONFIG_PATH", home.join("config.json"))
        .env("EXEORA_CREDENTIAL_PATH", home.join("credentials.json"))
        .env("EXEORA_GATEWAY_URL", "http://127.0.0.1:9")
        .env("EXEORA_CLOUD_FATAL_DELAY_MS", "0")
        .env_remove("EXEORA_MACHINE_TOKEN_FILE")
        .env_remove("EXEORA_CLOUD");
    command
}

/// `config.json` as the bootstrap of a cloud machine writes it: the
/// `CloudCliConfig` of `packages/protocol/src/cloud.ts`, which knows nothing
/// of a projects folder or of the repository of a project.
const BOOTSTRAP_CONFIG: &str = r#"{
  "gatewayUrl": "http://127.0.0.1:9",
  "deviceId": "dev_cloud",
  "deviceName": "alera-main",
  "projects": [
    { "id": "prj_alera", "slug": "alera", "name": "Alera", "root": "/home/sprite/workspace" }
  ],
  "workspaces": [],
  "workspaceRoot": "/home/sprite/.exeora/workspaces"
}"#;

#[test]
fn the_cloud_commands_still_run_for_the_scripts_that_call_them() {
    let home = tempfile::tempdir().unwrap();
    exeora(home.path())
        .args(["cloud", "--help"])
        .assert()
        .success()
        .stdout(
            predicate::str::contains("add")
                .and(predicate::str::contains("list"))
                .and(predicate::str::contains("credential"))
                .and(predicate::str::contains("remove"))
                .and(predicate::str::contains("workspace")),
        );
    exeora(home.path())
        .args(["cloud", "workspace", "--help"])
        .assert()
        .success()
        .stdout(predicate::str::contains("create").and(predicate::str::contains("remove")));
    // The branch is the repository's to say unless somebody names one.
    exeora(home.path())
        .args(["cloud", "add", "--help"])
        .assert()
        .success()
        .stdout(
            predicate::str::contains("--branch")
                .and(predicate::str::contains("[default: main]").not())
                .and(predicate::str::contains("--token-stdin")),
        );
}

#[test]
fn a_cloud_machine_reads_the_config_its_bootstrap_wrote() {
    let home = tempfile::tempdir().unwrap();
    std::fs::write(home.path().join("config.json"), BOOTSTRAP_CONFIG).unwrap();
    // The config loads, and what stops the service is the token it lacks.
    exeora(home.path())
        .args(["--json", "connect", "--cloud"])
        .assert()
        .failure()
        .stderr(predicate::str::contains(
            "EXEORA_MACHINE_TOKEN_FILE is not set",
        ));
    exeora(home.path())
        .env("EXEORA_CLOUD", "1")
        .args(["--json", "connect"])
        .assert()
        .failure()
        .stderr(predicate::str::contains(
            "EXEORA_MACHINE_TOKEN_FILE is not set",
        ));

    let token = home.path().join("token");
    std::fs::write(&token, "not a machine token\n").unwrap();
    exeora(home.path())
        .env("EXEORA_MACHINE_TOKEN_FILE", &token)
        .args(["--json", "connect", "--cloud"])
        .assert()
        .failure()
        .stderr(predicate::str::contains("does not hold a machine token"));
}

#[test]
fn a_cloud_machine_without_a_bootstrap_says_so() {
    let home = tempfile::tempdir().unwrap();
    let token = home.path().join("token");
    std::fs::write(&token, "exm_test_token\n").unwrap();
    exeora(home.path())
        .env("EXEORA_MACHINE_TOKEN_FILE", &token)
        .args(["connect", "--cloud"])
        .assert()
        .failure()
        .stderr(predicate::str::contains(
            "this machine was not bootstrapped",
        ));
    // Cloud mode is its own way in: it takes none of the flags of a sign-in.
    exeora(home.path())
        .args(["connect", "--cloud", "--name", "laptop"])
        .assert()
        .failure()
        .stderr(predicate::str::contains("cannot be used with"));
}
