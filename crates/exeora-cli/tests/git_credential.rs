use assert_cmd::Command;
use predicates::prelude::*;
use serde_json::{Value, json};
use std::{
    io::{Read, Write},
    net::TcpListener,
    path::Path,
    sync::mpsc,
    thread,
    time::Duration,
};

const TOKEN: &str = "ghs_a_token_nobody_may_see";

fn write_machine_token(path: &Path) {
    std::fs::write(path, "exm_test_machine\n").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600)).unwrap();
    }
}

fn exeora(home: &Path, gateway: &str) -> Command {
    let mut command = Command::cargo_bin("exeora").unwrap();
    command
        .env("EXEORA_CONFIG_PATH", home.join("config.json"))
        .env("EXEORA_CREDENTIAL_PATH", home.join("credentials.json"))
        .env("EXEORA_GATEWAY_URL", gateway)
        .env_remove("EXEORA_MACHINE_TOKEN_FILE")
        .env_remove("EXEORA_CLOUD")
        .timeout(Duration::from_secs(60));
    command
}

/// What a machine of Exeora Cloud has on disk: a token, and a config that
/// names the device and the project it holds.
fn machine(home: &Path, gateway: &str) -> Command {
    let token = home.join("token");
    write_machine_token(&token);
    std::fs::write(
        home.join("config.json"),
        json!({
            "gatewayUrl": gateway,
            "deviceId": "dev_here",
            "deviceName": "laptop",
            "projects": [
                { "id": "prj_api", "slug": "api", "name": "API", "root": "/code/api", "repoUrl": "https://github.com/Acme/API.git" },
                { "id": "prj_notes", "slug": "notes", "name": "Notes", "root": "/code/notes" }
            ],
        })
        .to_string(),
    )
    .unwrap();
    let mut command = exeora(home, gateway);
    command.env("EXEORA_MACHINE_TOKEN_FILE", token);
    command
}

struct Request {
    line: String,
    authorization: String,
    body: Value,
}

/// A gateway that answers one request and says what it was asked.
fn gateway(status: u16, answer: Value) -> (String, mpsc::Receiver<Request>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let Ok((mut stream, _)) = listener.accept() else {
            return;
        };
        let mut bytes = Vec::new();
        let mut chunk = [0u8; 4096];
        let (head, body) = loop {
            let Ok(read) = stream.read(&mut chunk) else {
                return;
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
                    break (head.to_owned(), body.to_owned());
                }
            }
            if read == 0 {
                return;
            }
        };
        let header = |name: &str| {
            head.lines()
                .find_map(|line| {
                    let (found, value) = line.split_once(':')?;
                    found
                        .eq_ignore_ascii_case(name)
                        .then(|| value.trim().to_owned())
                })
                .unwrap_or_default()
        };
        let _ = sender.send(Request {
            line: head.lines().next().unwrap_or_default().to_owned(),
            authorization: header("authorization"),
            body: serde_json::from_str(&body).unwrap_or(Value::Null),
        });
        let payload = answer.to_string();
        let _ = stream.write_all(
            format!(
                "HTTP/1.1 {status} OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{payload}",
                payload.len()
            )
            .as_bytes(),
        );
    });
    (url, receiver)
}

fn credential() -> Value {
    json!({ "host": "github.com", "username": "x-access-token", "password": TOKEN, "expiresAt": 1_900_000_000_000u64 })
}

#[test]
fn has_nothing_to_store_or_erase() {
    let home = tempfile::tempdir().unwrap();
    for operation in ["store", "erase"] {
        exeora(home.path(), "http://127.0.0.1:9")
            .args(["git-credential", "--project", "prj_api", operation])
            .write_stdin(format!(
                "protocol=https\nhost=github.com\nusername=x-access-token\npassword={TOKEN}\n\n"
            ))
            .assert()
            .success()
            .stdout("")
            .stderr("");
    }
    // Whatever else git may come to ask is not an error either.
    exeora(home.path(), "http://127.0.0.1:9")
        .args(["git-credential", "capability"])
        .write_stdin("")
        .assert()
        .success()
        .stdout("");
}

#[test]
fn says_nothing_when_nobody_is_signed_in() {
    let home = tempfile::tempdir().unwrap();
    exeora(home.path(), "http://127.0.0.1:9")
        .args(["git-credential", "--project", "prj_api", "get"])
        .write_stdin("protocol=https\nhost=github.com\npath=acme/api.git\n\n")
        .assert()
        .success()
        .stdout("")
        .stderr(predicate::str::starts_with(
            "exeora: no credential from Exeora:",
        ));
    // A config that cannot be read is one more reason, not a crash.
    std::fs::write(home.path().join("config.json"), "{ not json").unwrap();
    exeora(home.path(), "http://127.0.0.1:9")
        .args(["git-credential", "--project", "prj_api", "get"])
        .write_stdin("protocol=https\nhost=github.com\n\n")
        .assert()
        .success()
        .stdout("");
}

#[test]
fn answers_git_with_the_credential_of_the_project() {
    let home = tempfile::tempdir().unwrap();
    let (url, requests) = gateway(200, credential());
    machine(home.path(), &url)
        .args(["git-credential", "--project", "prj_api", "get"])
        .write_stdin("protocol=https\nhost=github.com\npath=Acme/API.git\n\n")
        .assert()
        .success()
        .stdout(format!(
            "protocol=https\nhost=github.com\nusername=x-access-token\npassword={TOKEN}\n\n"
        ))
        .stderr("");

    let request = requests.recv_timeout(Duration::from_secs(5)).unwrap();
    assert_eq!(
        request.line,
        "POST /api/projects/prj_api/git-credential HTTP/1.1"
    );
    // The machine token, exactly as `connect --cloud` presents it.
    assert_eq!(request.authorization, "Bearer exm_test_machine");
    assert_eq!(request.body, json!({ "deviceId": "dev_here" }));
}

#[test]
fn finds_the_project_from_what_git_says_about_the_repository() {
    let home = tempfile::tempdir().unwrap();
    let (url, requests) = gateway(200, credential());
    machine(home.path(), &url)
        .args(["git-credential", "get"])
        .write_stdin("protocol=https\nhost=github.com\npath=acme/api.git\n\n")
        .assert()
        .success()
        .stdout(predicate::str::contains(format!("password={TOKEN}\n")));
    let request = requests.recv_timeout(Duration::from_secs(5)).unwrap();
    assert_eq!(
        request.line,
        "POST /api/projects/prj_api/git-credential HTTP/1.1"
    );

    // A repository of no project, or a host alone, is nothing to answer for.
    for asked in [
        "protocol=https\nhost=github.com\npath=acme/other.git\n\n",
        "protocol=https\nhost=github.com\n\n",
    ] {
        machine(home.path(), "http://127.0.0.1:9")
            .args(["git-credential", "get"])
            .write_stdin(asked)
            .assert()
            .success()
            .stdout("")
            .stderr(predicate::str::starts_with(
                "exeora: no credential from Exeora:",
            ));
    }
}

#[test]
fn a_refusal_is_silence_on_stdout_and_a_reason_on_stderr() {
    let home = tempfile::tempdir().unwrap();
    for (status, answer, reason) in [
        (
            404,
            json!({ "error": "no_credential" }),
            "not connected to GitHub",
        ),
        (
            404,
            json!({ "error": "github_disabled" }),
            "no GitHub connection",
        ),
        // Whatever a gateway writes in a refusal is not repeated.
        (
            500,
            json!({ "error": "internal", "message": format!("leaked {TOKEN}") }),
            "the gateway refused (500, internal)",
        ),
    ] {
        let (url, _requests) = gateway(status, answer);
        machine(home.path(), &url)
            .args(["git-credential", "--project", "prj_api", "get"])
            .write_stdin("protocol=https\nhost=github.com\npath=acme/api.git\n\n")
            .assert()
            .success()
            .stdout("")
            .stderr(predicate::str::contains(reason).and(predicate::str::contains(TOKEN).not()));
    }
}

#[test]
fn never_hands_a_token_to_a_host_or_a_protocol_it_is_not_for() {
    let home = tempfile::tempdir().unwrap();
    let (url, _requests) = gateway(200, credential());
    machine(home.path(), &url)
        .args(["git-credential", "--project", "prj_api", "get"])
        .write_stdin("protocol=https\nhost=evil.example\npath=acme/api.git\n\n")
        .assert()
        .success()
        .stdout("")
        .stderr(
            predicate::str::contains("evil.example").and(predicate::str::contains(TOKEN).not()),
        );

    machine(home.path(), "http://127.0.0.1:9")
        .args(["git-credential", "--project", "prj_api", "get"])
        .write_stdin("protocol=http\nhost=github.com\n\n")
        .assert()
        .success()
        .stdout("")
        .stderr(predicate::str::contains("only ever sent over https"));

    // An id is what ends up in a command a shell reads.
    machine(home.path(), "http://127.0.0.1:9")
        .args(["git-credential", "--project", "prj;id", "get"])
        .write_stdin("protocol=https\nhost=github.com\n\n")
        .assert()
        .success()
        .stdout("");
}

/// The whole way round: git is given the helper exactly as a clone gives it,
/// runs it through its shell, and reads the credential out of its answer.
#[test]
fn git_itself_gets_the_credential_through_the_helper() {
    let home = tempfile::tempdir().unwrap();
    let (url, requests) = gateway(200, credential());
    // Writes the token and the config the helper will read.
    drop(machine(home.path(), &url));
    // A path with a space and a quote in it, which is what quoting is for.
    let folder = home.path().join("it's here");
    std::fs::create_dir(&folder).unwrap();
    let program = folder.join(if cfg!(windows) {
        "exeora.exe"
    } else {
        "exeora"
    });
    std::fs::copy(env!("CARGO_BIN_EXE_exeora"), &program).unwrap();
    let helper = exeora_cli::workspace::clone::helper_command(&program, "prj_api");

    let output = std::process::Command::new("git")
        .args(["-c", "credential.helper="])
        .args(["-c", &format!("credential.helper={helper}")])
        .args(["-c", "credential.useHttpPath=true"])
        .args(["credential", "fill"])
        .current_dir(home.path())
        .env("EXEORA_CONFIG_PATH", home.path().join("config.json"))
        .env("EXEORA_MACHINE_TOKEN_FILE", home.path().join("token"))
        .env("EXEORA_GATEWAY_URL", &url)
        .env("GIT_CONFIG_GLOBAL", home.path().join("no-gitconfig"))
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_ASKPASS", "")
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .and_then(|mut child| {
            child
                .stdin
                .take()
                .unwrap()
                .write_all(b"protocol=https\nhost=github.com\npath=Acme/API.git\n\n")?;
            child.wait_with_output()
        })
        .unwrap();

    let answer = String::from_utf8_lossy(&output.stdout);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(answer.contains("username=x-access-token\n"), "{answer}");
    assert!(answer.contains(&format!("password={TOKEN}\n")), "{answer}");
    let request = requests.recv_timeout(Duration::from_secs(5)).unwrap();
    assert_eq!(
        request.line,
        "POST /api/projects/prj_api/git-credential HTTP/1.1"
    );
}
