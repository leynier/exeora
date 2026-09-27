//! Which script a hook runs, and where it comes from.
//!
//! A script can be written in two places: the project's page, which the
//! gateway sends, and a file in the repository. The page wins. A script
//! written there replaces the file of the same hook, it does not run before
//! or after it. The file runs only where the page has nothing for that hook
//! and the project lets its repository's files run at all.

use crate::protocol::{
    CLOUD_INSTALL_FILE, CLOUD_INSTALL_TIMEOUT_MS, CLOUD_RESUME_FILE, CLOUD_RESUME_TIMEOUT_MS,
    MAX_CLOUD_SCRIPT_BYTES,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    fmt,
    io::Read,
    path::{Path, PathBuf},
};

/// A file of the repository is read whole to be fingerprinted. Nothing a
/// person wrote as a script comes near this; what does is a mistake.
const MAX_REPOSITORY_SCRIPT_BYTES: u64 = 1 << 20;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Hook {
    Install,
    Resume,
}

impl Hook {
    pub const ALL: [Self; 2] = [Self::Install, Self::Resume];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Install => "install",
            Self::Resume => "resume",
        }
    }

    pub fn parse(text: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|hook| hook.as_str() == text)
    }

    /// Where the script is looked for in the repository, from its root.
    pub const fn file(self) -> &'static str {
        match self {
            Self::Install => CLOUD_INSTALL_FILE,
            Self::Resume => CLOUD_RESUME_FILE,
        }
    }

    pub const fn timeout_ms(self) -> u64 {
        match self {
            Self::Install => CLOUD_INSTALL_TIMEOUT_MS,
            Self::Resume => CLOUD_RESUME_TIMEOUT_MS,
        }
    }
}

impl fmt::Display for Hook {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Source {
    Dashboard,
    Repository,
    None,
}

impl Source {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Dashboard => "dashboard",
            Self::Repository => "repository",
            Self::None => "none",
        }
    }
}

/// The scripts of the project's page. A hook with none is null.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Scripts {
    #[serde(default)]
    pub install: Option<String>,
    #[serde(default)]
    pub resume: Option<String>,
}

impl Scripts {
    pub fn of(&self, hook: Hook) -> Option<&str> {
        match hook {
            Hook::Install => self.install.as_deref(),
            Hook::Resume => self.resume.as_deref(),
        }
    }
}

/// `cloudHooks`, as the gateway sends it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HooksConfig {
    /// Null when the gateway could not read the scripts, which is not the
    /// same as there being none.
    pub scripts: Option<Scripts>,
    #[serde(default = "allowed")]
    pub repository: bool,
}

fn allowed() -> bool {
    true
}

impl HooksConfig {
    /// Reads what the gateway sent. Refused whole when it is not what the
    /// contract says: a script half understood is worse than none run.
    pub fn from_value(value: &Value) -> Result<Self, String> {
        let config: Self = serde_json::from_value(value.clone())
            .map_err(|error| format!("The gateway sent scripts that cannot be read: {error}."))?;
        if let Some(scripts) = &config.scripts {
            for hook in Hook::ALL {
                if scripts
                    .of(hook)
                    .is_some_and(|text| text.len() > MAX_CLOUD_SCRIPT_BYTES)
                {
                    return Err(format!(
                        "The gateway sent a {hook} script larger than {MAX_CLOUD_SCRIPT_BYTES} bytes. Shorten it on the project's page."
                    ));
                }
            }
        }
        Ok(config)
    }

    /// The scripts to go by: the ones just sent, or the copy kept from last
    /// time when the gateway could not read them. None when there is neither,
    /// and then nothing is known about the page, so nothing may run: the
    /// files of the repository are not a stand-in for a page that could not
    /// be read.
    pub fn scripts_or(&self, kept: Option<&Scripts>) -> Option<Scripts> {
        self.scripts.clone().or_else(|| kept.cloned())
    }
}

/// The script a hook runs.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Script {
    Dashboard {
        text: String,
        sha256: String,
    },
    Repository {
        path: PathBuf,
        sha256: String,
    },
    /// Neither place has one.
    None,
    /// There is one and it cannot be run. The reason is for a person.
    Unusable {
        source: Source,
        reason: String,
    },
}

impl Script {
    pub fn source(&self) -> Source {
        match self {
            Self::Dashboard { .. } => Source::Dashboard,
            Self::Repository { .. } => Source::Repository,
            Self::None => Source::None,
            Self::Unusable { source, .. } => *source,
        }
    }

    pub fn sha256(&self) -> Option<&str> {
        match self {
            Self::Dashboard { sha256, .. } | Self::Repository { sha256, .. } => Some(sha256),
            Self::None | Self::Unusable { .. } => None,
        }
    }

    /// What an attempt at this script is remembered by: its fingerprint, or
    /// a word for there being none, so that finding none is an attempt too
    /// and is not made again at every resume.
    pub fn key(&self) -> String {
        match self {
            Self::Dashboard { sha256, .. } | Self::Repository { sha256, .. } => sha256.clone(),
            Self::None => "none".to_owned(),
            Self::Unusable { reason, .. } => format!("unusable:{}", sha256(reason.as_bytes())),
        }
    }
}

/// Decides the script of a hook. The order is the whole rule: the page's
/// script when it has one, else the repository's file when the project lets
/// those run and the file is there, else none.
pub fn resolve(hook: Hook, scripts: &Scripts, repository: bool, checkout: &Path) -> Script {
    if let Some(text) = scripts.of(hook) {
        return Script::Dashboard {
            sha256: sha256(text.as_bytes()),
            text: text.to_owned(),
        };
    }
    if !repository {
        return Script::None;
    }
    let path = checkout.join(hook.file());
    let metadata = match std::fs::metadata(&path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Script::None,
        Err(error) => {
            return Script::Unusable {
                source: Source::Repository,
                reason: format!(
                    "{} could not be read: {error}. Check its permissions in the repository.",
                    hook.file()
                ),
            };
        }
    };
    if !metadata.is_file() {
        return Script::Unusable {
            source: Source::Repository,
            reason: format!(
                "{} is not a file. Make it a shell script, or remove it.",
                hook.file()
            ),
        };
    }
    if metadata.len() > MAX_REPOSITORY_SCRIPT_BYTES {
        return Script::Unusable {
            source: Source::Repository,
            reason: format!(
                "{} is larger than {MAX_REPOSITORY_SCRIPT_BYTES} bytes. Keep the script short and have it call what it needs.",
                hook.file()
            ),
        };
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    let read = std::fs::File::open(&path).and_then(|file| {
        file.take(MAX_REPOSITORY_SCRIPT_BYTES + 1)
            .read_to_end(&mut bytes)
    });
    match read {
        Ok(_) => Script::Repository {
            sha256: sha256(&bytes),
            path,
        },
        Err(error) => Script::Unusable {
            source: Source::Repository,
            reason: format!(
                "{} could not be read: {error}. Check its permissions in the repository.",
                hook.file()
            ),
        },
    }
}

pub fn sha256(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{Hook, HooksConfig, Script, Scripts, Source, resolve, sha256};
    use serde_json::json;
    use std::path::Path;

    fn checkout(install: Option<&str>, resume: Option<&str>) -> tempfile::TempDir {
        let checkout = tempfile::tempdir().unwrap();
        std::fs::create_dir(checkout.path().join(".exeora")).unwrap();
        for (hook, text) in [(Hook::Install, install), (Hook::Resume, resume)] {
            if let Some(text) = text {
                std::fs::write(checkout.path().join(hook.file()), text).unwrap();
            }
        }
        checkout
    }

    fn page(install: Option<&str>, resume: Option<&str>) -> Scripts {
        Scripts {
            install: install.map(str::to_owned),
            resume: resume.map(str::to_owned),
        }
    }

    #[test]
    fn fingerprints_are_sha256_in_hex() {
        assert_eq!(
            sha256(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }

    #[test]
    fn the_page_replaces_the_file_of_the_same_hook_and_no_other() {
        let checkout = checkout(Some("echo file install"), Some("echo file resume"));
        let scripts = page(Some("echo page install"), None);

        let install = resolve(Hook::Install, &scripts, true, checkout.path());
        assert_eq!(
            install,
            Script::Dashboard {
                text: "echo page install".to_owned(),
                sha256: sha256(b"echo page install"),
            }
        );
        // The page has nothing for resume, so the file of resume still runs.
        let resume = resolve(Hook::Resume, &scripts, true, checkout.path());
        assert_eq!(
            resume,
            Script::Repository {
                path: checkout.path().join(".exeora/cloud_resume.sh"),
                sha256: sha256(b"echo file resume"),
            }
        );
    }

    #[test]
    fn a_project_that_turned_its_files_off_never_runs_them() {
        let checkout = checkout(Some("echo file install"), Some("echo file resume"));
        let scripts = page(None, Some("echo page resume"));
        assert_eq!(
            resolve(Hook::Install, &scripts, false, checkout.path()),
            Script::None
        );
        // What the page says still runs.
        assert_eq!(
            resolve(Hook::Resume, &scripts, false, checkout.path()).source(),
            Source::Dashboard
        );
    }

    #[test]
    fn neither_place_having_a_script_is_none() {
        let checkout = checkout(None, None);
        assert_eq!(
            resolve(Hook::Install, &page(None, None), true, checkout.path()),
            Script::None
        );
        assert_eq!(
            resolve(
                Hook::Install,
                &page(None, None),
                true,
                Path::new("/nonexistent/exeora/checkout")
            ),
            Script::None
        );
    }

    #[test]
    fn a_folder_where_the_script_should_be_is_said_so() {
        let checkout = checkout(None, None);
        std::fs::create_dir(checkout.path().join(".exeora/cloud_install.sh")).unwrap();
        let script = resolve(Hook::Install, &page(None, None), true, checkout.path());
        assert!(
            matches!(&script, Script::Unusable { source: Source::Repository, reason } if reason.contains("is not a file")),
            "{script:?}"
        );
        assert_eq!(script.sha256(), None);
    }

    #[test]
    fn scripts_the_gateway_could_not_read_are_the_ones_kept_from_last_time() {
        let unread = HooksConfig::from_value(&json!({ "scripts": null, "repository": true }))
            .expect("config");
        assert_eq!(unread.scripts, None);
        let kept = page(Some("echo kept"), None);
        assert_eq!(unread.scripts_or(Some(&kept)), Some(kept.clone()));
        // With nothing kept nothing is known, which is not an empty page.
        assert_eq!(unread.scripts_or(None), None);

        let read = HooksConfig::from_value(
            &json!({ "scripts": { "install": null, "resume": "echo new" }, "repository": false }),
        )
        .expect("config");
        assert!(!read.repository);
        assert_eq!(
            read.scripts_or(Some(&kept)),
            Some(page(None, Some("echo new")))
        );
    }

    #[test]
    fn the_repository_runs_unless_the_gateway_says_otherwise() {
        let config =
            HooksConfig::from_value(&json!({ "scripts": { "install": null, "resume": null } }))
                .expect("config");
        assert!(config.repository);
    }

    #[test]
    fn refuses_what_is_not_the_contract() {
        assert!(HooksConfig::from_value(&json!({ "scripts": "echo" })).is_err());
        assert!(HooksConfig::from_value(&json!("install")).is_err());
        let long = "x".repeat(16_385);
        let error = HooksConfig::from_value(
            &json!({ "scripts": { "install": long, "resume": null }, "repository": true }),
        )
        .unwrap_err();
        assert!(error.contains("larger than 16384 bytes"), "{error}");
    }

    #[test]
    fn finding_no_script_is_remembered_as_an_attempt_of_its_own() {
        assert_eq!(Script::None.key(), "none");
        let script = Script::Dashboard {
            text: "true".to_owned(),
            sha256: sha256(b"true"),
        };
        assert_eq!(script.key(), sha256(b"true"));
    }
}
