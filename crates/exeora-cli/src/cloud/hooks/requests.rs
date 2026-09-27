//! How `exeora cloud-hook run` reaches the service: a file in a folder.
//!
//! The service already listens on a loopback port, and a route there would
//! have been the obvious way. It is not used, because that port is the one
//! the Sprite proxy forwards the machine's public URL to: the listener is
//! bound to 127.0.0.1 and `/wake` reaches it from outside all the same, so
//! what the proxy forwards arrives over loopback like anything local does.
//! Nothing in a request tells the two apart for certain, and a route that
//! runs a script must not be one that can be reached from outside.
//!
//! A file can only be written by somebody who is already on the machine as
//! this user, who could run the script by hand anyway. The folder is closed
//! to everybody else. The service looks into it once a second, takes the
//! request out, runs the script in turn with every other run, and leaves the
//! answer beside where the request was.

use super::{script::Hook, state::HookRun};
use crate::{private, protocol::now_ms};
use serde::{Deserialize, Serialize};
use std::{
    fs,
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};

const FOLDER: &str = "requests";
const REQUEST_SUFFIX: &str = ".json";
const ANSWER_SUFFIX: &str = ".answer.json";
const MAX_REQUEST_BYTES: u64 = 1_024;
/// A request nobody took, or an answer nobody read, is cleared after this.
const STALE: Duration = Duration::from_secs(3_600);

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    /// Also the id of the run, so whoever asked can tell its answer from
    /// the answer to anybody else's.
    pub id: String,
    pub hook: Hook,
    pub requested_at: u64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Answer {
    pub id: String,
    pub hook: Hook,
    /// The run, when there was one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run: Option<HookRun>,
    /// Why there was none.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

pub fn folder(directory: &Path) -> PathBuf {
    directory.join(FOLDER)
}

fn request_path(directory: &Path, id: &str) -> PathBuf {
    folder(directory).join(format!("{id}{REQUEST_SUFFIX}"))
}

fn answer_path(directory: &Path, id: &str) -> PathBuf {
    folder(directory).join(format!("{id}{ANSWER_SUFFIX}"))
}

/// An id is a file name, so it is nothing but what this module writes.
fn is_id(text: &str) -> bool {
    text.len() == 32 && text.bytes().all(|byte| byte.is_ascii_hexdigit())
}

/// Leaves a request for the service.
pub fn ask(directory: &Path, hook: Hook) -> std::io::Result<Request> {
    private::directory(directory)?;
    private::directory(&folder(directory))?;
    let request = Request {
        id: uuid::Uuid::new_v4().simple().to_string(),
        hook,
        requested_at: now_ms(),
    };
    let text = serde_json::to_vec(&request).map_err(std::io::Error::other)?;
    private::write(&request_path(directory, &request.id), &text, 0o600)?;
    Ok(request)
}

/// Whether the request is still where it was left, which is to say that
/// the service has not taken it.
pub fn is_waiting(directory: &Path, id: &str) -> bool {
    request_path(directory, id).exists()
}

/// Takes a request back, or out: true for whoever removed it, so of the
/// service and the one who asked only one goes on with it.
pub fn take(directory: &Path, id: &str) -> bool {
    fs::remove_file(request_path(directory, id)).is_ok()
}

/// The requests that are waiting, oldest first. What is in the folder and
/// is not a request is left alone unless it has grown old; what claims to
/// be one and is not is removed.
pub fn waiting(directory: &Path) -> Vec<Request> {
    let Ok(entries) = fs::read_dir(folder(directory)) else {
        return Vec::new();
    };
    let mut requests = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name();
        let name = name.to_string_lossy();
        let Ok(metadata) = fs::symlink_metadata(&path) else {
            continue;
        };
        let old = metadata
            .modified()
            .ok()
            .and_then(|modified| SystemTime::now().duration_since(modified).ok())
            .is_some_and(|age| age > STALE);
        if old {
            let _ = fs::remove_file(&path);
            continue;
        }
        let id = match name.strip_suffix(REQUEST_SUFFIX) {
            Some(id) if is_id(id) => id,
            _ => continue,
        };
        let request = (metadata.is_file() && metadata.len() <= MAX_REQUEST_BYTES)
            .then(|| fs::read(&path).ok())
            .flatten()
            .and_then(|bytes| serde_json::from_slice::<Request>(&bytes).ok())
            .filter(|request| request.id == id);
        match request {
            Some(request) => requests.push(request),
            None => {
                let _ = fs::remove_file(&path);
            }
        }
    }
    requests.sort_by(|a, b| {
        a.requested_at
            .cmp(&b.requested_at)
            .then_with(|| a.id.cmp(&b.id))
    });
    requests
}

pub fn answer(directory: &Path, answer: &Answer) -> std::io::Result<()> {
    private::directory(&folder(directory))?;
    let text = serde_json::to_vec(answer).map_err(std::io::Error::other)?;
    private::write(&answer_path(directory, &answer.id), &text, 0o600)
}

/// Reads the answer and takes it away: it is for the one who asked.
pub fn collect(directory: &Path, id: &str) -> Option<Answer> {
    let path = answer_path(directory, id);
    let bytes = fs::read(&path).ok()?;
    let answer = serde_json::from_slice::<Answer>(&bytes).ok()?;
    let _ = fs::remove_file(&path);
    Some(answer)
}

#[cfg(test)]
mod tests {
    use super::{Answer, answer, ask, collect, folder, is_waiting, take, waiting};
    use crate::cloud::hooks::script::Hook;

    #[test]
    fn a_request_waits_until_it_is_taken_and_is_taken_once() {
        let home = tempfile::tempdir().unwrap();
        let directory = home.path().join("hooks");
        assert!(waiting(&directory).is_empty());

        let install = ask(&directory, Hook::Install).unwrap();
        let resume = ask(&directory, Hook::Resume).unwrap();
        let found = waiting(&directory);
        assert_eq!(found.len(), 2);
        assert!(found.contains(&install) && found.contains(&resume));
        assert!(is_waiting(&directory, &install.id));

        assert!(take(&directory, &install.id));
        assert!(!take(&directory, &install.id));
        assert!(!is_waiting(&directory, &install.id));
        assert_eq!(waiting(&directory), vec![resume]);
    }

    #[test]
    fn an_answer_is_read_by_the_one_who_asked_and_then_gone() {
        let home = tempfile::tempdir().unwrap();
        let directory = home.path().join("hooks");
        let request = ask(&directory, Hook::Resume).unwrap();
        assert_eq!(collect(&directory, &request.id), None);
        let reply = Answer {
            id: request.id.clone(),
            hook: Hook::Resume,
            run: None,
            error: Some("No gateway.".to_owned()),
        };
        answer(&directory, &reply).unwrap();
        // An answer is not mistaken for a request.
        assert_eq!(waiting(&directory), vec![request.clone()]);
        assert_eq!(collect(&directory, &request.id), Some(reply));
        assert_eq!(collect(&directory, &request.id), None);
    }

    #[test]
    fn what_is_not_a_request_is_never_run() {
        let home = tempfile::tempdir().unwrap();
        let directory = home.path().join("hooks");
        let real = ask(&directory, Hook::Install).unwrap();
        let requests = folder(&directory);
        let id = "0123456789abcdef0123456789abcdef";
        // A hook that does not exist, a body that is another request's, a
        // name that is a path, and a file too large to be a request.
        std::fs::write(
            requests.join(format!("{id}.json")),
            format!(r#"{{"id":"{id}","hook":"deploy","requestedAt":1}}"#),
        )
        .unwrap();
        std::fs::write(
            requests.join("fedcba9876543210fedcba9876543210.json"),
            serde_json::to_vec(&real).unwrap(),
        )
        .unwrap();
        std::fs::write(requests.join("notes.json"), "{}").unwrap();
        std::fs::write(
            requests.join("00000000000000000000000000000000.json"),
            " ".repeat(2_000),
        )
        .unwrap();

        assert_eq!(waiting(&directory), vec![real]);
        assert!(!requests.join(format!("{id}.json")).exists());
        assert!(requests.join("notes.json").exists());
    }

    #[cfg(unix)]
    #[test]
    fn the_folder_is_closed_to_everybody_else() {
        use std::os::unix::fs::PermissionsExt;
        let home = tempfile::tempdir().unwrap();
        let directory = home.path().join("hooks");
        let request = ask(&directory, Hook::Install).unwrap();
        let mode =
            |path: &std::path::Path| std::fs::metadata(path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode(&folder(&directory)), 0o700);
        assert_eq!(
            mode(&folder(&directory).join(format!("{}.json", request.id))),
            0o600
        );
    }
}
