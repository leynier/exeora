use assert_cmd::Command;
use predicates::prelude::*;
use serde_json::Value;
use std::path::Path;

/// `exeora` on a machine that has never been used, pointed at a gateway that
/// is not there, so no test reads a real session or reaches the network.
fn exeora(home: &Path) -> Command {
    let mut command = Command::cargo_bin("exeora").unwrap();
    command
        .env("EXEORA_CONFIG_PATH", home.join("config.json"))
        .env("EXEORA_CREDENTIAL_PATH", home.join("credentials.json"))
        .env("EXEORA_GATEWAY_URL", "http://127.0.0.1:9")
        .env_remove("EXEORA_PROJECTS_ROOT")
        .env_remove("EXEORA_WORKSPACE_ROOT")
        .env_remove("EXEORA_MACHINE_TOKEN_FILE")
        .env_remove("EXEORA_CLOUD");
    command
}

#[test]
fn offers_one_set_of_verbs_for_every_place_a_project_lives() {
    let home = tempfile::tempdir().unwrap();
    exeora(home.path())
        .args(["project", "--help"])
        .assert()
        .success()
        .stdout(
            predicate::str::contains("add")
                .and(predicate::str::contains("list"))
                .and(predicate::str::contains("remove"))
                .and(predicate::str::contains("locations"))
                .and(predicate::str::contains("default"))
                .and(predicate::str::contains("credential")),
        );
    exeora(home.path())
        .args(["project", "add", "--help"])
        .assert()
        .success()
        .stdout(
            predicate::str::contains("[TARGET]")
                .and(predicate::str::contains("--name"))
                .and(predicate::str::contains("--slug"))
                .and(predicate::str::contains("--on"))
                .and(predicate::str::contains("--branch"))
                .and(predicate::str::contains("--token-stdin"))
                .and(predicate::str::contains("--yes")),
        );
    exeora(home.path())
        .args(["project", "locations", "--help"])
        .assert()
        .success()
        .stdout(predicate::str::contains("add").and(predicate::str::contains("remove")));
    for verb in ["add", "remove"] {
        exeora(home.path())
            .args(["project", "locations", verb, "--help"])
            .assert()
            .success()
            .stdout(predicate::str::contains("--on"));
    }
    exeora(home.path())
        .args(["workspace", "create", "--help"])
        .assert()
        .success()
        .stdout(
            predicate::str::contains("--on")
                .and(predicate::str::contains("--project"))
                .and(predicate::str::contains("--from"))
                .and(predicate::str::contains("--reuse-existing-branch")),
        );
    exeora(home.path())
        .args(["workspace", "remove", "--help"])
        .assert()
        .success()
        .stdout(predicate::str::contains("--yes").and(predicate::str::contains("--force")));
    // A machine is a device by its other name.
    for noun in ["device", "machine"] {
        exeora(home.path())
            .args([noun, "list", "--help"])
            .assert()
            .success();
    }
}

#[test]
fn keeps_the_projects_folder_beside_the_workspace_folder() {
    let home = tempfile::tempdir().unwrap();
    let default = exeora(home.path())
        .env("HOME", home.path())
        .env("USERPROFILE", home.path())
        .args(["--json", "config", "get", "projects-root"])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let default: Value = serde_json::from_slice(&default).unwrap();
    assert_eq!(default["key"], "projects-root");
    assert_eq!(default["source"], "default");
    assert_eq!(
        default["value"],
        home.path().join("exeora").to_string_lossy().as_ref()
    );

    let chosen = home.path().join("code");
    exeora(home.path())
        .args(["config", "set", "projects-root"])
        .arg(&chosen)
        .assert()
        .success()
        .stdout(format!("Set projects-root to {}.\n", chosen.display()));
    exeora(home.path())
        .args(["config", "get", "projects-root"])
        .assert()
        .success()
        .stdout(format!("{}\n", chosen.display()));
    let saved: Value =
        serde_json::from_slice(&std::fs::read(home.path().join("config.json")).unwrap()).unwrap();
    assert_eq!(saved["projectsRoot"], chosen.to_string_lossy().as_ref());

    // The environment wins over the file, as it does for the workspaces.
    let elsewhere = home.path().join("elsewhere");
    let from_env = exeora(home.path())
        .env("EXEORA_PROJECTS_ROOT", &elsewhere)
        .args(["--json", "config", "get", "projects-root"])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let from_env: Value = serde_json::from_slice(&from_env).unwrap();
    assert_eq!(from_env["source"], "env");
    assert_eq!(from_env["value"], elsewhere.to_string_lossy().as_ref());

    exeora(home.path())
        .args(["config", "unset", "projects-root"])
        .assert()
        .success()
        .stdout("Unset projects-root.\n");
    // The workspace folder is its own setting and was not touched.
    exeora(home.path())
        .args(["--json", "config", "get", "workspace-root"])
        .assert()
        .success()
        .stdout(predicate::str::contains("\"source\": \"default\""));
    exeora(home.path())
        .args(["config", "get", "nothing"])
        .assert()
        .failure()
        .stderr(predicate::str::contains("workspace-root, projects-root"));
}

#[test]
fn never_asks_a_question_without_a_terminal_to_ask_it_on() {
    let home = tempfile::tempdir().unwrap();
    // Removing a project asks first, and in --json there is nobody to ask.
    exeora(home.path())
        .args(["--json", "project", "remove", "alera"])
        .assert()
        .failure()
        .stderr(predicate::str::starts_with("{\"error\":"));
    exeora(home.path())
        .args(["project", "locations"])
        .assert()
        .failure()
        .stderr(predicate::str::contains("exeora project locations <slug>"));
    exeora(home.path())
        .args(["project", "credential", "alera"])
        .assert()
        .failure()
        .stderr(
            predicate::str::contains("--token-stdin").and(predicate::str::contains("--remove")),
        );
    // A path and another location cannot both say where the workspace goes.
    exeora(home.path())
        .args([
            "workspace",
            "create",
            "fix",
            "--on",
            "cloud",
            "--path",
            "/tmp/fix",
        ])
        .assert()
        .failure()
        .stderr(predicate::str::contains("cannot be used with"));
}
