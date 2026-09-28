//! What is remembered about the scripts from one start to the next.
//!
//! A cold start is a new process that knows nothing, on a disk that kept
//! everything. Without this file it would install again on every cold start,
//! could not tell the gateway how the last run ended, and would have no copy
//! of the page's scripts for the day the gateway cannot read them.

use super::script::{Hook, HooksConfig, Source};
use crate::private;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const STATE_FILE: &str = "state.json";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Status {
    Running,
    Ok,
    Failed,
    TimedOut,
    Skipped,
}

impl Status {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Running => "running",
            Self::Ok => "ok",
            Self::Failed => "failed",
            Self::TimedOut => "timed_out",
            Self::Skipped => "skipped",
        }
    }

    pub const fn is_final(self) -> bool {
        !matches!(self, Self::Running)
    }
}

/// Why a script ran.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Trigger {
    Setup,
    Changed,
    Manual,
    Cold,
    Warm,
}

impl Trigger {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Setup => "setup",
            Self::Changed => "changed",
            Self::Manual => "manual",
            Self::Cold => "cold",
            Self::Warm => "warm",
        }
    }
}

/// One run of a script: `CloudHookRun` of the contract, field for field.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HookRun {
    pub run_id: String,
    pub status: Status,
    pub source: Source,
    pub trigger: Trigger,
    pub script_sha256: Option<String>,
    pub exit_code: Option<i32>,
    pub started_at: u64,
    pub finished_at: Option<u64>,
    /// The end of what the script printed. Only a run that is over has one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub output: Option<String>,
    #[serde(default)]
    pub truncated: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HookState {
    /// The last run of each hook.
    #[serde(default)]
    pub install: Option<HookRun>,
    #[serde(default)]
    pub resume: Option<HookRun>,
    /// The fingerprint of the install script that was last attempted,
    /// however the attempt ended. An install runs when the script is not
    /// this one, so one that fails is not run again at every resume.
    #[serde(default)]
    pub install_attempted: Option<String>,
    /// What the gateway last said, with the scripts it could read.
    #[serde(default)]
    pub config: Option<HooksConfig>,
}

impl HookState {
    pub fn last(&self, hook: Hook) -> Option<&HookRun> {
        match hook {
            Hook::Install => self.install.as_ref(),
            Hook::Resume => self.resume.as_ref(),
        }
    }

    pub fn set_last(&mut self, hook: Hook, run: HookRun) {
        match hook {
            Hook::Install => self.install = Some(run),
            Hook::Resume => self.resume = Some(run),
        }
    }
}

pub fn path(directory: &Path) -> PathBuf {
    directory.join(STATE_FILE)
}

/// Reads the file. One that is not there is a machine that never ran a
/// script; one that cannot be understood is treated the same and said so,
/// since refusing to start over a damaged note would leave the machine with
/// no scripts at all.
pub fn load(directory: &Path) -> (HookState, Option<String>) {
    let path = path(directory);
    let text = match std::fs::read_to_string(&path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return (HookState::default(), None);
        }
        Err(error) => {
            return (
                HookState::default(),
                Some(format!(
                    "Could not read {}: {error}. The scripts start over as on a new machine.",
                    path.display()
                )),
            );
        }
    };
    match serde_json::from_str(&text) {
        Ok(state) => (state, None),
        Err(error) => (
            HookState::default(),
            Some(format!(
                "{} is damaged ({error}). The scripts start over as on a new machine.",
                path.display()
            )),
        ),
    }
}

pub fn save(directory: &Path, state: &HookState) -> std::io::Result<()> {
    private::directory(directory)?;
    let text = serde_json::to_vec_pretty(state).map_err(std::io::Error::other)?;
    private::write(&path(directory), &text, 0o600)
}

#[cfg(test)]
mod tests {
    use super::{HookRun, HookState, Status, Trigger, load, save};
    use crate::cloud::hooks::script::{HooksConfig, Scripts, Source};
    use serde_json::json;

    fn run() -> HookRun {
        HookRun {
            run_id: "run_1".to_owned(),
            status: Status::TimedOut,
            source: Source::Dashboard,
            trigger: Trigger::Setup,
            script_sha256: Some("a".repeat(64)),
            exit_code: None,
            started_at: 10,
            finished_at: Some(20),
            output: Some("tail".to_owned()),
            truncated: true,
        }
    }

    #[test]
    fn a_run_is_written_as_the_contract_names_it() {
        assert_eq!(
            serde_json::to_value(run()).unwrap(),
            json!({
                "runId": "run_1",
                "status": "timed_out",
                "source": "dashboard",
                "trigger": "setup",
                "scriptSha256": "a".repeat(64),
                "exitCode": null,
                "startedAt": 10,
                "finishedAt": 20,
                "output": "tail",
                "truncated": true,
            })
        );
        // A run that is not over has no output to send.
        let running = HookRun {
            status: Status::Running,
            finished_at: None,
            output: None,
            truncated: false,
            ..run()
        };
        let value = serde_json::to_value(running).unwrap();
        assert!(value.get("output").is_none());
        assert_eq!(value["finishedAt"], json!(null));
    }

    #[test]
    fn survives_a_cold_start() {
        let home = tempfile::tempdir().unwrap();
        let directory = home.path().join("hooks");
        let state = HookState {
            install: Some(run()),
            resume: None,
            install_attempted: Some("a".repeat(64)),
            config: Some(HooksConfig {
                scripts: Some(Scripts {
                    install: Some("npm ci".to_owned()),
                    resume: None,
                }),
                repository: false,
            }),
        };
        save(&directory, &state).unwrap();
        let (loaded, problem) = load(&directory);
        assert_eq!(problem, None);
        assert_eq!(loaded, state);
    }

    #[cfg(unix)]
    #[test]
    fn is_for_its_owner_alone() {
        use std::os::unix::fs::PermissionsExt;
        let home = tempfile::tempdir().unwrap();
        let directory = home.path().join("hooks");
        save(&directory, &HookState::default()).unwrap();
        let mode =
            |path: &std::path::Path| std::fs::metadata(path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode(&directory), 0o700);
        assert_eq!(mode(&super::path(&directory)), 0o600);
    }

    #[test]
    fn a_machine_that_never_ran_a_script_has_nothing_to_remember() {
        let home = tempfile::tempdir().unwrap();
        assert_eq!(load(home.path()), (HookState::default(), None));
    }

    #[test]
    fn a_damaged_file_starts_over_and_says_so() {
        let home = tempfile::tempdir().unwrap();
        std::fs::write(home.path().join("state.json"), "{ not json").unwrap();
        let (state, problem) = load(home.path());
        assert_eq!(state, HookState::default());
        assert!(problem.is_some_and(|problem| problem.contains("is damaged")));
    }
}
