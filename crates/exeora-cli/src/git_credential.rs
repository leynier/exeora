//! `exeora git-credential`: what git asks when a repository of a project
//! wants a password.
//!
//! Git runs a credential helper with `get`, `store` or `erase` and describes
//! the request on stdin as `key=value` lines. For `get` this answers with a
//! short-lived token the gateway makes for the project's repository. There is
//! nothing to store or erase: the token is made on request and kept nowhere.
//!
//! A helper that fails must fail quietly. Whatever goes wrong, nothing is
//! written to stdout and the exit is a success, so git moves on to the next
//! helper or to its own error; the reason goes to stderr, where git shows it.

use crate::{
    CLI_VERSION,
    api::{ApiClient, ApiError, GitCredential},
    auth::AuthManager,
    config::ConfigStore,
    repo::repository_key,
    workspace::clone::validate_project_id,
};
use anyhow::{Result, anyhow, bail};
use clap::Args;
use std::{
    collections::HashMap,
    io::{BufRead, Write},
    path::PathBuf,
    sync::Arc,
    time::Duration,
};

/// Git waits on the helper with the person watching, so it gives up early.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_REQUEST_LINES: usize = 64;

#[derive(Debug, Args)]
pub struct GitCredentialArgs {
    #[arg(
        long,
        help = "The project whose repository is asked about; found from the host and path otherwise"
    )]
    project: Option<String>,
    #[arg(help = "get, store or erase, as git passes it")]
    operation: Option<String>,
}

/// Never fails and never exits with an error: see the module.
pub async fn run(args: GitCredentialArgs) {
    // Read even when there is nothing to do with it, so git never writes
    // into a pipe nobody is reading.
    let request = read_request(std::io::stdin().lock());
    if args.operation.as_deref() != Some("get") {
        return;
    }
    match answer(args.project.as_deref(), &request).await {
        Ok(credential) => {
            let mut stdout = std::io::stdout().lock();
            let _ = stdout.write_all(render(&credential).as_bytes());
            let _ = stdout.flush();
        }
        Err(reason) => eprintln!("exeora: no credential from Exeora: {reason}"),
    }
}

/// The request as git wrote it: lines of `key=value`, ended by a blank line.
fn read_request(input: impl BufRead) -> HashMap<String, String> {
    let mut request = HashMap::new();
    for line in input.lines().take(MAX_REQUEST_LINES) {
        let Ok(line) = line else { break };
        let line = line.trim_end_matches('\r');
        if line.is_empty() {
            break;
        }
        if let Some((key, value)) = line.split_once('=') {
            request.insert(key.to_owned(), value.to_owned());
        }
    }
    request
}

fn render(credential: &GitCredential) -> String {
    format!(
        "protocol=https\nhost={}\nusername={}\npassword={}\n\n",
        credential.host, credential.username, credential.password
    )
}

async fn answer(project: Option<&str>, request: &HashMap<String, String>) -> Result<GitCredential> {
    if let Some(protocol) = request.get("protocol")
        && protocol != "https"
    {
        bail!("a token is only ever sent over https, and git asked for {protocol}.");
    }
    let config = ConfigStore::load()?;
    let project_id = match project {
        Some(project) => project.to_owned(),
        None => project_for(&config, request)?,
    };
    validate_project_id(&project_id).map_err(|error| anyhow!(error.message))?;

    let http = reqwest::Client::builder()
        .user_agent(format!("exeora/{CLI_VERSION}"))
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .build()?;
    let gateway = config.gateway_url();
    // The same choice `connect --cloud` makes: a machine Exeora runs has a
    // token on disk and no session to refresh.
    let auth = match std::env::var_os("EXEORA_MACHINE_TOKEN_FILE") {
        Some(file) => {
            AuthManager::with_machine_token(gateway.clone(), http.clone(), PathBuf::from(file))
        }
        None => AuthManager::new(gateway.clone(), http.clone()),
    };
    let api = ApiClient::new(&gateway, http, Arc::new(auth))?;
    let credential = api
        .git_credential(&project_id, config.data().device_id.as_deref())
        .await
        .map_err(plain_reason)?;
    check(&credential, request)?;
    Ok(credential)
}

/// The project whose repository git is asking about, from the host and path
/// of the request. Needs the path, which git sends when
/// `credential.useHttpPath` is set: a host alone names no repository, and a
/// token for one project must not answer for another.
fn project_for(config: &ConfigStore, request: &HashMap<String, String>) -> Result<String> {
    let host = request
        .get("host")
        .filter(|host| !host.is_empty())
        .ok_or_else(|| anyhow!("git named no host."))?;
    let path = request
        .get("path")
        .filter(|path| !path.is_empty())
        .ok_or_else(|| {
            anyhow!("git named no repository path. Set credential.useHttpPath to true, or pass --project.")
        })?;
    let asked = repository_key(&format!("https://{host}/{path}"))
        .ok_or_else(|| anyhow!("{host}/{path} is not a repository."))?;
    config
        .data()
        .projects
        .iter()
        .find(|project| {
            project
                .repo_url
                .as_deref()
                .and_then(repository_key)
                .is_some_and(|key| key == asked)
        })
        .map(|project| project.id.clone())
        .ok_or_else(|| anyhow!("no project on this machine has the repository {asked}."))
}

/// A refusal in words that cannot carry what the gateway wrote in its body.
fn plain_reason(error: anyhow::Error) -> anyhow::Error {
    let Some(refusal) = error.downcast_ref::<ApiError>() else {
        return error;
    };
    match refusal.code.as_deref() {
        Some("no_credential") => anyhow!(
            "this project is not connected to GitHub. Connect it in the Exeora dashboard, or set up git credentials on this machine."
        ),
        Some("github_disabled") => {
            anyhow!("this Exeora has no GitHub connection. Set up git credentials on this machine.")
        }
        Some(code) => anyhow!("the gateway refused ({}, {code}).", refusal.status),
        None => anyhow!("the gateway refused ({}).", refusal.status),
    }
}

/// What the gateway sent is written into a protocol made of lines, and is
/// for one host. Anything that would break either is not passed on.
fn check(credential: &GitCredential, request: &HashMap<String, String>) -> Result<()> {
    let breaks_a_line = |text: &str| text.is_empty() || text.contains(['\n', '\r', '\0']);
    if breaks_a_line(&credential.host)
        || breaks_a_line(&credential.username)
        || breaks_a_line(&credential.password)
    {
        bail!("the gateway answered with something that is not a credential.");
    }
    if let Some(host) = request.get("host")
        && !host.eq_ignore_ascii_case(&credential.host)
    {
        bail!(
            "the credential is for {}, and git asked about {host}.",
            credential.host
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{check, project_for, read_request, render};
    use crate::{
        api::GitCredential,
        config::{ConfigStore, ProjectEntry},
    };
    use std::{collections::HashMap, path::PathBuf};
    use tempfile::tempdir;

    fn credential() -> GitCredential {
        GitCredential {
            host: "github.com".to_owned(),
            username: "x-access-token".to_owned(),
            password: "ghs_example".to_owned(),
            expires_at: None,
        }
    }

    #[test]
    fn reads_what_git_writes_up_to_the_blank_line() {
        let request = read_request(
            "protocol=https\nhost=github.com\r\npath=acme/api.git\nwwwauth[]=Basic realm=\"GitHub\"\n\nhost=evil.example\n"
                .as_bytes(),
        );
        assert_eq!(request.get("protocol").map(String::as_str), Some("https"));
        assert_eq!(request.get("host").map(String::as_str), Some("github.com"));
        assert_eq!(
            request.get("path").map(String::as_str),
            Some("acme/api.git")
        );
        assert_eq!(
            request.get("wwwauth[]").map(String::as_str),
            Some("Basic realm=\"GitHub\"")
        );
    }

    #[test]
    fn answers_in_the_lines_git_expects() {
        assert_eq!(
            render(&credential()),
            "protocol=https\nhost=github.com\nusername=x-access-token\npassword=ghs_example\n\n"
        );
    }

    #[test]
    fn finds_the_project_by_the_repository_git_names() {
        let directory = tempdir().expect("temp directory");
        let mut config =
            ConfigStore::load_from(directory.path().join("config.json")).expect("config");
        config.upsert_project(ProjectEntry::directory(
            "prj_plain".to_owned(),
            "plain".to_owned(),
            "Plain".to_owned(),
            PathBuf::from("/code/plain"),
        ));
        config.upsert_project(ProjectEntry {
            repo_url: Some("https://github.com/Acme/API.git".to_owned()),
            ..ProjectEntry::directory(
                "prj_api".to_owned(),
                "api".to_owned(),
                "API".to_owned(),
                PathBuf::from("/code/api"),
            )
        });
        let request = |host: &str, path: Option<&str>| {
            let mut request = HashMap::from([("host".to_owned(), host.to_owned())]);
            if let Some(path) = path {
                request.insert("path".to_owned(), path.to_owned());
            }
            request
        };

        assert_eq!(
            project_for(&config, &request("github.com", Some("acme/api.git"))).expect("project"),
            "prj_api"
        );
        assert_eq!(
            project_for(&config, &request("GitHub.com", Some("Acme/API"))).expect("project"),
            "prj_api"
        );
        assert!(project_for(&config, &request("github.com", Some("acme/other"))).is_err());
        assert!(project_for(&config, &request("gitlab.com", Some("acme/api"))).is_err());
        // A host alone names no repository.
        assert!(project_for(&config, &request("github.com", None)).is_err());
    }

    #[test]
    fn passes_on_only_a_credential_for_the_host_that_was_asked_about() {
        let asked = |host: &str| HashMap::from([("host".to_owned(), host.to_owned())]);
        assert!(check(&credential(), &asked("github.com")).is_ok());
        assert!(check(&credential(), &HashMap::new()).is_ok());
        assert!(check(&credential(), &asked("evil.example")).is_err());
        assert!(
            check(
                &GitCredential {
                    password: "ghs_example\nhost=evil.example".to_owned(),
                    ..credential()
                },
                &asked("github.com")
            )
            .is_err()
        );
    }
}
