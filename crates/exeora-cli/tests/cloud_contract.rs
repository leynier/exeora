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

fn write_machine_token(path: &Path, value: &str) {
    std::fs::write(path, value).unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).unwrap();
    }
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
    write_machine_token(&token, "not a machine token\n");
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
    write_machine_token(&token, "exm_test_token\n");
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

// The two commands an instance runs and a person never types: `cloud-hook`,
// from a shell on the instance, and `gh-shim`, which is what `gh` is there.

#[test]
fn cloud_hook_status_prints_what_the_instance_remembers() {
    let home = tempfile::tempdir().unwrap();
    let hooks = home.path().join("hooks");
    // A machine that never ran a script remembers nothing, and says so
    // without failing.
    let output = exeora(home.path())
        .env("EXEORA_HOOKS_DIR", &hooks)
        .args(["cloud-hook", "status"])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let state: serde_json::Value = serde_json::from_slice(&output).unwrap();
    assert_eq!(state["install"], serde_json::Value::Null);
    assert_eq!(state["installAttempted"], serde_json::Value::Null);

    std::fs::create_dir_all(&hooks).unwrap();
    std::fs::write(
        hooks.join("state.json"),
        r#"{
          "install": {
            "runId": "run_1", "status": "failed", "source": "repository", "trigger": "setup",
            "scriptSha256": "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
            "exitCode": 2, "startedAt": 10, "finishedAt": 20, "output": "npm: not found\n",
            "truncated": false
          },
          "resume": null,
          "installAttempted": "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
          "config": { "scripts": { "install": null, "resume": null }, "repository": true }
        }"#,
    )
    .unwrap();
    let output = exeora(home.path())
        .env("EXEORA_HOOKS_DIR", &hooks)
        .args(["cloud-hook", "status"])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let state: serde_json::Value = serde_json::from_slice(&output).unwrap();
    assert_eq!(state["install"]["status"], "failed");
    assert_eq!(state["install"]["exitCode"], 2);
    assert_eq!(state["install"]["output"], "npm: not found\n");
    assert_eq!(state["config"]["repository"], true);

    std::fs::write(hooks.join("state.json"), "{ not json").unwrap();
    exeora(home.path())
        .env("EXEORA_HOOKS_DIR", &hooks)
        .args(["cloud-hook", "status"])
        .assert()
        .failure()
        .stderr(predicate::str::contains("is damaged"));
}

#[test]
fn cloud_hook_run_asks_the_service_and_runs_nothing_itself() {
    let home = tempfile::tempdir().unwrap();
    let hooks = home.path().join("hooks");
    let requests = hooks.join("requests");

    let output = exeora(home.path())
        .env("EXEORA_HOOKS_DIR", &hooks)
        .args(["cloud-hook", "run", "resume", "--no-wait"])
        .assert()
        .success()
        .get_output()
        .stdout
        .clone();
    let asked: serde_json::Value = serde_json::from_slice(&output).unwrap();
    assert_eq!(asked["requested"], "resume");
    let id = asked["runId"].as_str().unwrap();
    let left: serde_json::Value =
        serde_json::from_slice(&std::fs::read(requests.join(format!("{id}.json"))).unwrap())
            .unwrap();
    assert_eq!(left["id"], id);
    assert_eq!(left["hook"], "resume");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = |path: &Path| std::fs::metadata(path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode(&requests), 0o700);
        assert_eq!(mode(&requests.join(format!("{id}.json"))), 0o600);
    }

    // There are two scripts and no third.
    exeora(home.path())
        .env("EXEORA_HOOKS_DIR", &hooks)
        .args(["cloud-hook", "run", "deploy"])
        .assert()
        .failure()
        .stderr(predicate::str::contains("install").and(predicate::str::contains("resume")));
}

#[test]
fn cloud_hook_run_takes_its_request_back_when_no_service_takes_it() {
    let home = tempfile::tempdir().unwrap();
    let hooks = home.path().join("hooks");
    exeora(home.path())
        .env("EXEORA_HOOKS_DIR", &hooks)
        .args(["cloud-hook", "run", "install", "--pickup-ms", "300"])
        .assert()
        .failure()
        .stderr(predicate::str::contains("did not take the request"));
    // Nothing is left to run by surprise when the service next starts.
    assert_eq!(
        std::fs::read_dir(hooks.join("requests")).unwrap().count(),
        0
    );
}

#[test]
fn the_commands_of_an_instance_are_not_shown_to_a_person() {
    let home = tempfile::tempdir().unwrap();
    exeora(home.path()).arg("--help").assert().success().stdout(
        predicate::str::contains("gh-shim")
            .not()
            .and(predicate::str::contains("cloud-hook").not()),
    );
}

#[cfg(unix)]
mod gh {
    use super::{BOOTSTRAP_CONFIG, exeora};
    use assert_cmd::Command;
    use predicates::prelude::*;
    use std::{
        io::{Read, Write},
        net::TcpListener,
        path::{Path, PathBuf},
        sync::{
            Arc, Mutex,
            atomic::{AtomicUsize, Ordering},
        },
        thread,
    };

    /// Stands in for the GitHub CLI: says what it was given, and exits with
    /// what its first argument asks for.
    const REAL: &str = r#"#!/bin/sh
echo "token=${GH_TOKEN-unset} args=$*"
case "$1" in
  needs-auth) exit 4 ;;
  fails) exit 7 ;;
esac
exit 0
"#;

    fn program(path: &Path, text: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
        path.to_path_buf()
    }

    /// `gh` as the bootstrap writes it, running the CLI under test.
    fn shim(path: &Path) -> PathBuf {
        let exeora = assert_cmd::cargo::cargo_bin("exeora");
        program(
            path,
            &format!(
                "#!/bin/sh\n# Written by Exeora.\nexec \"{}\" gh-shim -- \"$@\"\n",
                exeora.display()
            ),
        )
    }

    /// The shim with nothing of the caller's that could decide the outcome:
    /// no token, no `gh` of the machine the tests run on, and a home of its
    /// own.
    fn gh(home: &Path) -> Command {
        let mut command = exeora(home);
        command
            .env("HOME", home)
            .env("PATH", "/usr/bin:/bin")
            .env_remove("GH_TOKEN")
            .env_remove("GITHUB_TOKEN")
            .env_remove("GH_HOST")
            .env_remove("EXEORA_REAL_GH")
            .env_remove("EXEORA_GH_CACHE_DIR")
            .env("NO_PROXY", "127.0.0.1")
            .env("no_proxy", "127.0.0.1")
            .arg("gh-shim")
            .arg("--");
        command
    }

    /// An instance: a config that names its project, and the machine's token.
    fn instance(home: &Path) -> Command {
        std::fs::write(home.join("config.json"), BOOTSTRAP_CONFIG).unwrap();
        super::write_machine_token(&home.join("token"), "exm_test_machine\n");
        let mut command = gh(home);
        command.env("EXEORA_MACHINE_TOKEN_FILE", home.join("token"));
        command
    }

    struct Gateway {
        url: String,
        asked: Arc<AtomicUsize>,
        requests: Arc<Mutex<Vec<String>>>,
    }

    /// A gateway that gives every request the same answer, and keeps the
    /// head of each.
    fn gateway(status: u16, answer: &str) -> Gateway {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let asked = Arc::new(AtomicUsize::new(0));
        let requests = Arc::new(Mutex::new(Vec::new()));
        let (count, log, answer) = (asked.clone(), requests.clone(), answer.to_owned());
        thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else { return };
                let mut bytes = Vec::new();
                let mut chunk = [0u8; 4096];
                let head = loop {
                    let Ok(read) = stream.read(&mut chunk) else {
                        break String::new();
                    };
                    bytes.extend_from_slice(&chunk[..read]);
                    let text = String::from_utf8_lossy(&bytes).into_owned();
                    if let Some((head, body)) = text.split_once("\r\n\r\n") {
                        let length = head
                            .lines()
                            .find_map(|line| {
                                let (name, value) = line.split_once(':')?;
                                name.eq_ignore_ascii_case("content-length")
                                    .then(|| value.trim().parse::<usize>().ok())?
                            })
                            .unwrap_or(0);
                        if body.len() >= length {
                            break head.to_owned();
                        }
                    }
                    if read == 0 {
                        break String::new();
                    }
                };
                count.fetch_add(1, Ordering::SeqCst);
                log.lock().unwrap().push(head);
                let _ = stream.write_all(
                    format!(
                        "HTTP/1.1 {status} OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{answer}",
                        answer.len()
                    )
                    .as_bytes(),
                );
            }
        });
        Gateway {
            url,
            asked,
            requests,
        }
    }

    /// A folder in memory that is this test's alone, where the machine has
    /// one. Without one there is nothing to keep a token in, and the test
    /// goes on without the part that is about keeping.
    fn memory() -> Option<tempfile::TempDir> {
        let mounts = std::fs::read_to_string("/proc/mounts").ok()?;
        mounts
            .lines()
            .any(|line| {
                let mut fields = line.split_whitespace();
                fields.nth(1) == Some("/dev/shm")
                    && matches!(fields.next(), Some("tmpfs" | "ramfs"))
            })
            .then(|| tempfile::tempdir_in("/dev/shm").ok())
            .flatten()
    }

    #[test]
    fn a_caller_with_a_token_of_their_own_is_passed_through_untouched() {
        let home = tempfile::tempdir().unwrap();
        let real = program(&home.path().join("real/gh"), REAL);
        let gateway = gateway(
            200,
            r#"{"host":"github.com","token":"ghu_from_exeora","expiresAt":null,"login":null,"source":"user"}"#,
        );
        for name in ["GH_TOKEN", "GITHUB_TOKEN"] {
            let expected = if name == "GH_TOKEN" {
                "token=ghu_mine args=pr list --json number\n"
            } else {
                // Left for gh to read, under the name the caller gave it.
                "token=unset args=pr list --json number\n"
            };
            instance(home.path())
                .env("EXEORA_GATEWAY_URL", &gateway.url)
                .env("EXEORA_REAL_GH", &real)
                .env(name, "ghu_mine")
                .args(["pr", "list", "--json", "number"])
                .assert()
                .success()
                .stdout(expected)
                .stderr("");
        }
        // The gateway was asked for nothing.
        assert_eq!(gateway.asked.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn outside_an_instance_it_is_the_real_gh_and_nothing_more() {
        let home = tempfile::tempdir().unwrap();
        let real = program(&home.path().join("real/gh"), REAL);
        gh(home.path())
            .env("EXEORA_REAL_GH", &real)
            .args(["fails", "--flag"])
            .assert()
            .code(7)
            .stdout("token=unset args=fails --flag\n")
            .stderr("");
        // Not signed in, and not this command's business to say why.
        gh(home.path())
            .env("EXEORA_REAL_GH", &real)
            .arg("needs-auth")
            .assert()
            .code(4)
            .stderr("");
    }

    #[test]
    fn finds_the_real_gh_behind_itself_on_the_path() {
        let home = tempfile::tempdir().unwrap();
        let first = home.path().join("local/bin");
        let second = home.path().join("usr/bin");
        let shim = shim(&first.join("gh"));
        program(&second.join("gh"), REAL);
        let path = std::env::join_paths([
            first.as_path(),
            second.as_path(),
            Path::new("/usr/bin"),
            Path::new("/bin"),
        ])
        .unwrap();

        // As an agent runs it: by name, through the path, shim first.
        let output = std::process::Command::new(&shim)
            .args(["repo", "view"])
            .env("PATH", &path)
            .env("HOME", home.path())
            .env("EXEORA_CONFIG_PATH", home.path().join("config.json"))
            .env_remove("GH_TOKEN")
            .env_remove("GITHUB_TOKEN")
            .env_remove("EXEORA_REAL_GH")
            .env_remove("EXEORA_MACHINE_TOKEN_FILE")
            .output()
            .unwrap();
        assert_eq!(
            String::from_utf8_lossy(&output.stdout),
            "token=unset args=repo view\n"
        );
        assert!(output.status.success());

        // Where the bootstrap installs it comes before the path.
        program(
            &home.path().join(".local/share/exeora/bin/gh"),
            "#!/bin/sh\necho installed\n",
        );
        gh(home.path())
            .env("PATH", &path)
            .arg("--version")
            .assert()
            .success()
            .stdout("installed\n");
    }

    #[test]
    fn says_so_and_exits_127_when_there_is_no_real_gh() {
        let home = tempfile::tempdir().unwrap();
        let only = home.path().join("local/bin");
        shim(&only.join("gh"));
        // The shim is all there is, on the path and where it was named:
        // running it would run this again, without end.
        for named in [
            None,
            Some(only.join("gh")),
            Some(home.path().join("nowhere")),
        ] {
            let mut command = gh(home.path());
            command.env("PATH", &only);
            if let Some(named) = named {
                command.env("EXEORA_REAL_GH", named);
            }
            command
                .arg("--version")
                .timeout(std::time::Duration::from_secs(30))
                .assert()
                .code(127)
                .stdout("")
                .stderr(predicate::str::contains(
                    "the GitHub CLI is not installed on this machine",
                ));
        }
    }

    #[test]
    fn signs_gh_in_with_the_token_the_gateway_answers_with() {
        let home = tempfile::tempdir().unwrap();
        let real = program(&home.path().join("real/gh"), REAL);
        let gateway = gateway(
            200,
            r#"{"host":"github.com","token":"ghu_from_exeora","expiresAt":null,"login":"octocat","source":"user"}"#,
        );
        let memory = memory();
        let run = || {
            let mut command = instance(home.path());
            command
                .env("EXEORA_GATEWAY_URL", &gateway.url)
                .env("EXEORA_REAL_GH", &real)
                .args(["fails", "now"]);
            if let Some(memory) = &memory {
                command.env("EXEORA_GH_CACHE_DIR", memory.path().join("exeora"));
            } else {
                command.env("EXEORA_GH_CACHE_DIR", home.path().join("not-memory"));
            }
            command
                .assert()
                .code(7)
                .stdout("token=ghu_from_exeora args=fails now\n")
                .stderr("");
        };
        run();
        {
            let requests = gateway.requests.lock().unwrap();
            assert_eq!(requests.len(), 1);
            assert!(
                requests[0].starts_with("POST /api/projects/prj_alera/gh-token "),
                "{}",
                requests[0]
            );
            assert!(
                requests[0]
                    .to_ascii_lowercase()
                    .contains("authorization: bearer exm_test_machine"),
                "{}",
                requests[0]
            );
        }
        run();
        match &memory {
            // Kept in memory, so the second run asked nobody.
            Some(memory) => {
                use std::os::unix::fs::PermissionsExt;
                assert_eq!(gateway.asked.load(Ordering::SeqCst), 1);
                let folder = memory.path().join("exeora");
                let mode =
                    |path: &Path| std::fs::metadata(path).unwrap().permissions().mode() & 0o777;
                assert_eq!(mode(&folder), 0o700);
                assert_eq!(mode(&folder.join("gh-token.json")), 0o600);
            }
            None => assert_eq!(gateway.asked.load(Ordering::SeqCst), 2),
        }
        // Nowhere under the home directory, whatever else happened.
        assert!(!contains_text(home.path(), "ghu_from_exeora"));
    }

    #[test]
    fn a_folder_on_a_disk_keeps_no_token_whoever_names_it() {
        let home = tempfile::tempdir().unwrap();
        let real = program(&home.path().join("real/gh"), REAL);
        let gateway = gateway(
            200,
            r#"{"host":"github.com","token":"ghu_from_exeora","expiresAt":null,"login":null,"source":"stored"}"#,
        );
        let named = home.path().join("cache");
        // Only where the home of the test is itself on a disk, which is
        // what this is about.
        let mounts = std::fs::read_to_string("/proc/mounts").unwrap_or_default();
        let resolved = std::fs::canonicalize(home.path()).unwrap();
        let in_memory = mounts
            .lines()
            .filter_map(|line| {
                let mut fields = line.split_whitespace();
                let (point, kind) = (fields.nth(1)?, fields.next()?);
                resolved.starts_with(point).then_some((point.len(), kind))
            })
            .max_by_key(|(length, _)| *length)
            .is_some_and(|(_, kind)| matches!(kind, "tmpfs" | "ramfs"));
        if in_memory {
            return;
        }
        for _ in 0..2 {
            instance(home.path())
                .env("EXEORA_GATEWAY_URL", &gateway.url)
                .env("EXEORA_REAL_GH", &real)
                .env("EXEORA_GH_CACHE_DIR", &named)
                .arg("status")
                .assert()
                .success()
                .stdout("token=ghu_from_exeora args=status\n");
        }
        assert_eq!(gateway.asked.load(Ordering::SeqCst), 2);
        assert!(!named.exists());
        assert!(!contains_text(home.path(), "ghu_from_exeora"));
    }

    #[test]
    fn without_a_token_gh_still_runs_and_the_reason_is_said_when_it_matters() {
        let home = tempfile::tempdir().unwrap();
        let real = program(&home.path().join("real/gh"), REAL);
        let gateway = gateway(
            409,
            r#"{"error":"github_reconnect","message":"token=ghu_leak"}"#,
        );
        let memory = memory();
        let run = |args: &[&str]| {
            let mut command = instance(home.path());
            command
                .env("EXEORA_GATEWAY_URL", &gateway.url)
                .env("EXEORA_REAL_GH", &real)
                .env(
                    "EXEORA_GH_CACHE_DIR",
                    memory.as_ref().map_or_else(
                        || home.path().join("not-memory"),
                        |memory| memory.path().join("exeora"),
                    ),
                )
                .args(args);
            command.assert()
        };
        let reason = "exeora: gh is not signed in: the connection to GitHub has to be made again. Reconnect GitHub in Exeora's settings, then run the command again.\n";

        // Needs no GitHub, and is none the worse.
        run(&["--version"])
            .success()
            .stdout("token=unset args=--version\n")
            .stderr("");
        // Failed for a reason of its own.
        run(&["fails"]).code(7).stderr("");
        // Needed a sign-in: one line, with the reason and what to do.
        run(&["needs-auth", "pr", "list"])
            .code(4)
            .stdout("token=unset args=needs-auth pr list\n")
            .stderr(reason);
        // Asked who is signed in.
        run(&["auth", "status"]).success().stderr(reason);
        if memory.is_some() {
            // The refusal was kept: four runs, one question.
            assert_eq!(gateway.asked.load(Ordering::SeqCst), 1);
        }
    }

    #[test]
    fn a_gateway_that_is_not_there_does_not_stop_gh() {
        let home = tempfile::tempdir().unwrap();
        let real = program(&home.path().join("real/gh"), REAL);
        instance(home.path())
            .env("EXEORA_REAL_GH", &real)
            .env("EXEORA_GH_CACHE_DIR", home.path().join("not-memory"))
            .arg("--version")
            .assert()
            .success()
            .stdout("token=unset args=--version\n")
            .stderr("");
        instance(home.path())
            .env("EXEORA_REAL_GH", &real)
            .env("EXEORA_GH_CACHE_DIR", home.path().join("not-memory"))
            .arg("needs-auth")
            .assert()
            .code(4)
            .stderr(
                predicate::str::starts_with("exeora: gh is not signed in: ")
                    .and(predicate::str::contains("could not be asked for a token"))
                    .and(predicate::function(|text: &str| text.lines().count() == 1)),
            );
    }

    /// Whether any file under `folder` holds `text`.
    fn contains_text(folder: &Path, text: &str) -> bool {
        let Ok(entries) = std::fs::read_dir(folder) else {
            return false;
        };
        entries.flatten().any(|entry| {
            let path = entry.path();
            if path.is_dir() {
                contains_text(&path, text)
            } else {
                std::fs::read(&path).is_ok_and(|bytes| {
                    bytes
                        .windows(text.len())
                        .any(|window| window == text.as_bytes())
                })
            }
        })
    }
}

/// The service itself, against a relay that lives for one test: what it
/// says when it connects, and what it does with the scripts it is told of.
#[cfg(unix)]
mod service {
    use futures_util::{SinkExt, StreamExt};
    use serde_json::{Value, json};
    use std::{
        path::Path,
        process::{Child, Command, Stdio},
        time::Duration,
    };
    use tokio::net::{TcpListener, TcpStream};
    use tokio_tungstenite::{WebSocketStream, accept_async, tungstenite::Message};

    const PATIENCE: Duration = Duration::from_secs(60);

    /// The service, ended with the test however the test ends.
    struct Service(Child);

    impl Drop for Service {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }

    /// An instance as the bootstrap leaves it, with a checkout of its own.
    fn start(home: &Path, gateway: &str) -> Service {
        let checkout = home.join("workspace");
        std::fs::create_dir_all(checkout.join(".exeora")).unwrap();
        std::fs::write(
            home.join("config.json"),
            json!({
                "gatewayUrl": gateway,
                "deviceId": "dev_cloud",
                "deviceName": "alera-main",
                "projects": [
                    { "id": "prj_alera", "slug": "alera", "name": "Alera", "root": checkout }
                ],
                "workspaces": [],
            })
            .to_string(),
        )
        .unwrap();
        super::write_machine_token(&home.join("token"), "exm_test_machine\n");
        let child = Command::new(assert_cmd::cargo::cargo_bin("exeora"))
            .args(["--json", "connect", "--cloud"])
            .env("HOME", home)
            .env("EXEORA_CONFIG_PATH", home.join("config.json"))
            .env("EXEORA_CREDENTIAL_PATH", home.join("credentials.json"))
            .env("EXEORA_GATEWAY_URL", gateway)
            .env("EXEORA_MACHINE_TOKEN_FILE", home.join("token"))
            .env("EXEORA_HOOKS_DIR", home.join("hooks"))
            // Any port that is free: nothing here wakes the machine.
            .env("EXEORA_CLOUD_HTTP_PORT", "0")
            .env("EXEORA_SPRITE_API_SOCKET", home.join("api.sock"))
            .env("EXEORA_CLOUD_FATAL_DELAY_MS", "0")
            .env_remove("EXEORA_CGROUP_ROOT")
            .env_remove("EXEORA_CLOUD")
            .env("NO_PROXY", "127.0.0.1")
            .env("no_proxy", "127.0.0.1")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        Service(child)
    }

    type Socket = WebSocketStream<TcpStream>;

    async fn accept(listener: &TcpListener) -> Socket {
        let (stream, _) = tokio::time::timeout(PATIENCE, listener.accept())
            .await
            .expect("the service dials the relay")
            .unwrap();
        accept_async(stream).await.unwrap()
    }

    /// The next frame that is not a heartbeat.
    async fn next(socket: &mut Socket) -> Value {
        loop {
            let message = tokio::time::timeout(PATIENCE, socket.next())
                .await
                .expect("a frame in time")
                .expect("the socket is open")
                .unwrap();
            let Message::Text(text) = message else {
                continue;
            };
            let frame: Value = serde_json::from_str(&text).unwrap();
            if !matches!(frame["type"].as_str(), Some("heartbeat" | "presence")) {
                return frame;
            }
        }
    }

    async fn send(socket: &mut Socket, frame: Value) {
        socket
            .send(Message::Text(frame.to_string().into()))
            .await
            .unwrap();
    }

    /// Reads until a run of `hook` is over, and answers with every frame
    /// about the scripts up to and including that one.
    async fn until_over(socket: &mut Socket, hook: &str) -> Vec<Value> {
        let mut frames = Vec::new();
        loop {
            let frame = next(socket).await;
            if frame["type"] != "cloud.hook.state" {
                continue;
            }
            let over = frame["hook"] == hook && frame["run"]["status"] != "running";
            frames.push(frame);
            if over {
                return frames;
            }
        }
    }

    #[tokio::test]
    async fn runs_the_scripts_it_is_told_of_and_says_how_they_went() {
        let home = tempfile::tempdir().unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let gateway = format!("http://{}", listener.local_addr().unwrap());
        let _service = start(home.path(), &gateway);
        let checkout = home.path().join("workspace");
        std::fs::write(
            checkout.join(".exeora/cloud_resume.sh"),
            "echo \"$EXEORA_RESUME_KIND\" >> resumes\n",
        )
        .unwrap();

        let mut socket = accept(&listener).await;
        let hello = next(&mut socket).await;
        assert_eq!(hello["type"], "hello");
        assert_eq!(hello["cliVersion"], env!("CARGO_PKG_VERSION"));
        let features = hello["capabilities"]["features"].as_array().unwrap();
        assert!(features.contains(&json!("cloud-hooks-v1")), "{hello}");
        assert!(features.contains(&json!("cloud-v1")), "{hello}");

        let page = json!({
            "scripts": { "install": "echo installed >> installs\necho done\n", "resume": null },
            "repository": true,
        });
        send(
            &mut socket,
            json!({ "type": "hello.ack", "cloudHooks": page }),
        )
        .await;

        let frames = until_over(&mut socket, "resume").await;
        let of = |hook: &str| -> Vec<&Value> {
            frames
                .iter()
                .filter(|frame| frame["hook"] == hook)
                .collect()
        };
        let install = of("install");
        assert_eq!(install.len(), 2, "{frames:?}");
        assert_eq!(install[0]["run"]["status"], "running");
        assert_eq!(install[1]["run"]["status"], "ok");
        assert_eq!(install[1]["run"]["source"], "dashboard");
        assert_eq!(install[1]["run"]["trigger"], "setup");
        assert_eq!(install[1]["run"]["exitCode"], 0);
        assert_eq!(install[1]["run"]["output"], "done\n");
        assert_eq!(install[1]["run"]["truncated"], false);
        assert_eq!(
            install[1]["run"]["scriptSha256"].as_str().map(str::len),
            Some(64)
        );
        let resume = of("resume");
        assert_eq!(resume.len(), 1);
        assert_eq!(resume[0]["run"]["status"], "ok");
        assert_eq!(resume[0]["run"]["source"], "repository");
        assert_eq!(resume[0]["run"]["trigger"], "cold");
        // Install first, then resume.
        assert!(install[1]["run"]["finishedAt"].as_u64() <= resume[0]["run"]["startedAt"].as_u64());
        let lines = |name: &str| {
            std::fs::read_to_string(checkout.join(name))
                .unwrap_or_default()
                .lines()
                .map(str::to_owned)
                .collect::<Vec<_>>()
        };
        assert_eq!(lines("installs"), ["installed"]);
        assert_eq!(lines("resumes"), ["cold"]);

        // A person asks for the install again.
        send(
            &mut socket,
            json!({ "type": "cloud.hook.run", "hook": "install", "config": page }),
        )
        .await;
        let frames = until_over(&mut socket, "install").await;
        let asked = frames.last().unwrap();
        assert_eq!(asked["run"]["trigger"], "manual");
        assert_eq!(asked["run"]["status"], "ok");
        assert_eq!(lines("installs"), ["installed", "installed"]);

        // And from a shell on the instance, through the service.
        let output = super::exeora(home.path())
            .env("EXEORA_HOOKS_DIR", home.path().join("hooks"))
            .args(["cloud-hook", "run", "resume"])
            .timeout(PATIENCE)
            .assert()
            .success()
            .get_output()
            .stdout
            .clone();
        let run: Value = serde_json::from_slice(&output).unwrap();
        assert_eq!(run["trigger"], "manual");
        assert_eq!(run["status"], "ok");
        let frames = until_over(&mut socket, "resume").await;
        assert_eq!(frames.last().unwrap()["run"]["runId"], run["runId"]);
        assert_eq!(lines("resumes"), ["cold", "cold"]);

        // The connection drops and comes back: nothing runs again, and the
        // gateway is told the last word on both once more.
        drop(socket);
        let mut socket = accept(&listener).await;
        assert_eq!(next(&mut socket).await["type"], "hello");
        send(
            &mut socket,
            json!({ "type": "hello.ack", "cloudHooks": page }),
        )
        .await;
        let again = until_over(&mut socket, "resume").await;
        assert_eq!(again.len(), 2, "{again:?}");
        assert_eq!(again[0]["run"]["runId"], asked["run"]["runId"]);
        assert_eq!(again[1]["run"]["runId"], run["runId"]);
        send(
            &mut socket,
            json!({
                "type": "tool.call",
                "requestId": "req_read",
                "projectId": "prj_alera",
                "tool": "read_file",
                "arguments": { "path": "installs" },
            }),
        )
        .await;
        let answer = next(&mut socket).await;
        assert_eq!(answer["type"], "tool.result", "{answer}");
        assert_eq!(lines("installs"), ["installed", "installed"]);
        assert_eq!(lines("resumes"), ["cold", "cold"]);
    }

    #[tokio::test]
    async fn runs_nothing_for_a_gateway_that_knows_nothing_of_scripts() {
        let home = tempfile::tempdir().unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let gateway = format!("http://{}", listener.local_addr().unwrap());
        let _service = start(home.path(), &gateway);
        let checkout = home.path().join("workspace");
        for file in ["cloud_install.sh", "cloud_resume.sh"] {
            std::fs::write(checkout.join(".exeora").join(file), "echo ran >> ran\n").unwrap();
        }

        let mut socket = accept(&listener).await;
        assert_eq!(next(&mut socket).await["type"], "hello");
        send(&mut socket, json!({ "type": "hello.ack" })).await;
        send(
            &mut socket,
            json!({
                "type": "tool.call",
                "requestId": "req_run",
                "projectId": "prj_alera",
                "tool": "run_command",
                "arguments": { "command": "echo hello" },
            }),
        )
        .await;

        // The first thing it has to say is the answer to the call.
        let answer = next(&mut socket).await;
        assert_eq!(answer["type"], "tool.result", "{answer}");
        assert_eq!(answer["result"]["value"]["stdout"], "hello\n");
        assert!(!checkout.join("ran").exists());
        assert!(!home.path().join("hooks/state.json").exists());
    }

    #[tokio::test]
    async fn a_command_that_arrives_behind_the_hello_waits_for_the_install() {
        let home = tempfile::tempdir().unwrap();
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let gateway = format!("http://{}", listener.local_addr().unwrap());
        let _service = start(home.path(), &gateway);

        let mut socket = accept(&listener).await;
        assert_eq!(next(&mut socket).await["type"], "hello");
        // The acknowledgement and the call, one right behind the other, as
        // a gateway that was waiting for this machine sends them.
        send(
            &mut socket,
            json!({
                "type": "hello.ack",
                "cloudHooks": {
                    "scripts": { "install": "sleep 1\necho ready > ready\n", "resume": null },
                    "repository": true,
                },
            }),
        )
        .await;
        send(
            &mut socket,
            json!({
                "type": "tool.call",
                "requestId": "req_run",
                "projectId": "prj_alera",
                "tool": "run_command",
                "arguments": { "command": "cat ready" },
            }),
        )
        .await;

        let mut order = Vec::new();
        let answer = loop {
            let frame = next(&mut socket).await;
            match frame["type"].as_str() {
                Some("cloud.hook.state") => order.push(format!(
                    "{} {}",
                    frame["hook"].as_str().unwrap(),
                    frame["run"]["status"].as_str().unwrap()
                )),
                Some("tool.result") => break frame,
                _ => {}
            }
        };
        // The command found what the install made, and was answered after
        // the scripts were over.
        assert_eq!(answer["result"]["value"]["stdout"], "ready\n", "{answer}");
        assert_eq!(order, ["install running", "install ok", "resume skipped"]);
    }
}
