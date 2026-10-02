//! `exeora gh-shim`: the GitHub CLI, signed in as the person the instance
//! belongs to.
//!
//! On an instance `gh` is a two-line script that runs this, and the real
//! GitHub CLI is kept elsewhere. This asks the gateway for the person's
//! token and becomes the real `gh` with that token in its environment and
//! nowhere else: not in `gh`'s own config, not in a file under the home
//! directory, not in the environment of anything but that one process.
//!
//! Whatever goes wrong with the token, the real `gh` still runs. Much of it
//! needs no GitHub at all, and what does need it says so by its exit code,
//! which is when the reason is worth a line.

use crate::{
    CLI_VERSION,
    api::{ApiClient, ApiError, GhToken},
    auth::AuthManager,
    config::ConfigStore,
    private,
    protocol::now_ms,
    workspace::clone::validate_project_id,
};
use clap::Args;
use serde::{Deserialize, Serialize};
use std::{
    ffi::{OsStr, OsString},
    io::Read,
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};

/// A command waits on this with the person watching, so it gives up early.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);

/// A token is asked for again this long before it ends.
const EXPIRY_MARGIN_MS: u64 = 5 * 60_000;
/// And this long after it was fetched, whatever it says of its end: the
/// person may have disconnected GitHub, and the gateway is who knows.
const MAX_AGE_MS: u64 = 30 * 60_000;
/// A refusal is remembered this long, so a loop that calls `gh` does not
/// ask the gateway the same question every time round.
const REFUSAL_AGE_MS: u64 = 60_000;

/// What `gh` exits with when the command needed a sign-in and had none.
const GH_NEEDS_AUTH: i32 = 4;
/// What a shell exits with for a command that is not there.
const NOT_FOUND: i32 = 127;
const NOT_RUNNABLE: i32 = 126;

const HOST: &str = "github.com";
const CACHE_FILE: &str = "gh-token.json";
#[cfg(unix)]
const MEMORY: &str = "/dev/shm";

#[derive(Debug, Args)]
pub struct GhShimArgs {
    #[arg(
        trailing_var_arg = true,
        allow_hyphen_values = true,
        help = "What to run gh with"
    )]
    args: Vec<OsString>,
}

/// Runs `gh` and answers with what the process is to exit with. Where the
/// real `gh` could be signed in, this does not come back: the process
/// becomes it.
pub async fn run(args: GhShimArgs) -> i32 {
    let named = std::env::var_os("EXEORA_REAL_GH").map(PathBuf::from);
    let installed = crate::config::home_dir()
        .ok()
        .map(|home| home.join(".local/share/exeora/bin/gh"));
    let path = std::env::var_os("PATH");
    let beside = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(|folder| folder.join("gh")));
    let itself = std::env::current_exe().ok();
    let Some(real) = find_real_gh(&Search {
        named: named.as_deref(),
        installed: installed.as_deref(),
        path: path.as_deref(),
        shims: &[beside, itself].into_iter().flatten().collect::<Vec<_>>(),
    }) else {
        eprintln!(
            "exeora: the GitHub CLI is not installed on this machine. Install gh, or set EXEORA_REAL_GH to where it is."
        );
        return NOT_FOUND;
    };

    let set = |name: &str| std::env::var_os(name).is_some_and(|value| !value.is_empty());
    // A caller who brought a token means it to be used, and one who is not
    // on an instance has a `gh` of their own that is none of this.
    if set("GH_TOKEN") || set("GITHUB_TOKEN") {
        return become_gh(&real, &args.args, None);
    }
    let Some(token_file) = std::env::var_os("EXEORA_MACHINE_TOKEN_FILE").map(PathBuf::from) else {
        return become_gh(&real, &args.args, None);
    };

    match ask(token_file).await {
        Ok(token) => become_gh(&real, &args.args, Some(&token)),
        Err(refusal) => run_unsigned(&real, &args.args, &refusal),
    }
}

async fn ask(token_file: PathBuf) -> Result<String, Refusal> {
    let config = ConfigStore::load().map_err(|error| Refusal::Unreachable(error.to_string()))?;
    // An instance holds one project, and the token is that project's.
    let project = config
        .data()
        .projects
        .first()
        .map(|project| project.id.clone())
        .ok_or_else(|| Refusal::Unreachable("this machine holds no project".to_owned()))?;
    validate_project_id(&project).map_err(|error| Refusal::Unreachable(error.message))?;
    let gateway = config.gateway_url();
    let http = reqwest::Client::builder()
        .user_agent(format!("exeora/{CLI_VERSION}"))
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(REQUEST_TIMEOUT)
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| Refusal::Unreachable(error.to_string()))?;
    let auth = AuthManager::with_machine_token(gateway.clone(), http.clone(), token_file);
    let api = ApiClient::new(&gateway, http, Arc::new(auth))
        .map_err(|error| Refusal::Unreachable(error.to_string()))?;
    token(
        &api,
        &TokenCache::of_this_user(),
        &Asked {
            gateway,
            project,
            device: config.data().device_id.clone(),
        },
        now_ms(),
    )
    .await
}

/// Whose token, asked of whom. A token kept for one is never the answer
/// for another.
pub(crate) struct Asked {
    pub gateway: String,
    pub project: String,
    pub device: Option<String>,
}

/// The token, from what was kept when that still holds and from the
/// gateway when not.
pub(crate) async fn token(
    api: &ApiClient,
    cache: &TokenCache,
    asked: &Asked,
    now: u64,
) -> Result<String, Refusal> {
    match cache.read(asked, now) {
        Some(Kept::Token(token)) => return Ok(token),
        Some(Kept::Refusal(refusal)) => return Err(refusal),
        None => {}
    }
    let answer = api
        .gh_token(&asked.project, asked.device.as_deref())
        .await
        .map_err(Refusal::from_error)
        .and_then(check);
    match &answer {
        Ok(token) => cache.keep_token(asked, token, now),
        Err(refusal) if refusal.is_kept() => cache.keep_refusal(asked, refusal, now),
        Err(_) => {}
    }
    answer.map(|token| token.token)
}

/// The token goes into an environment and is for one host. What could not
/// be either is not passed on.
fn check(token: GhToken) -> Result<GhToken, Refusal> {
    let unfit = token.token.is_empty()
        || token
            .token
            .chars()
            .any(|character| character.is_whitespace() || character.is_control());
    if unfit || !token.host.eq_ignore_ascii_case(HOST) {
        return Err(Refusal::Unreachable(
            "the gateway answered with something that is not a token for github.com".to_owned(),
        ));
    }
    Ok(token)
}

/// Why there is no token.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Refusal {
    NoCredential,
    NotGithub,
    Reconnect,
    Disabled,
    Unavailable,
    RateLimited,
    /// Refused for a reason this CLI has no words for.
    Refused(u16),
    /// The gateway was not asked, or did not answer. Never holds what it
    /// wrote in a body.
    Unreachable(String),
}

impl Refusal {
    fn from_error(error: anyhow::Error) -> Self {
        let Some(refusal) = error.downcast_ref::<ApiError>() else {
            // Without the address: a reqwest error names the URL it failed on.
            let reason = match error.downcast_ref::<reqwest::Error>() {
                Some(error) if error.is_timeout() => "the gateway did not answer in time",
                Some(error) if error.is_connect() => "the gateway could not be reached",
                Some(_) => "the request to the gateway failed",
                None => "the machine's token could not be used",
            };
            return Self::Unreachable(reason.to_owned());
        };
        match (refusal.status, refusal.code.as_deref()) {
            (429, _) => Self::RateLimited,
            (_, Some("no_credential")) => Self::NoCredential,
            (_, Some("not_github")) => Self::NotGithub,
            (_, Some("github_reconnect")) => Self::Reconnect,
            (_, Some("github_disabled")) => Self::Disabled,
            (_, Some("github_unavailable")) => Self::Unavailable,
            (status, _) if (400..500).contains(&status) => Self::Refused(status),
            (status, _) => Self::Unreachable(format!("the gateway answered {status}")),
        }
    }

    /// A refusal is kept when asking again would get the same answer: the
    /// gateway said no. Not when it was busy, or GitHub was, or nobody
    /// answered, which the next try may find mended.
    fn is_kept(&self) -> bool {
        matches!(
            self,
            Self::NoCredential
                | Self::NotGithub
                | Self::Reconnect
                | Self::Disabled
                | Self::Refused(_)
        )
    }

    fn code(&self) -> String {
        match self {
            Self::NoCredential => "no_credential".to_owned(),
            Self::NotGithub => "not_github".to_owned(),
            Self::Reconnect => "github_reconnect".to_owned(),
            Self::Disabled => "github_disabled".to_owned(),
            Self::Unavailable => "github_unavailable".to_owned(),
            Self::RateLimited => "rate_limited".to_owned(),
            Self::Refused(status) => format!("refused:{status}"),
            Self::Unreachable(_) => "unreachable".to_owned(),
        }
    }

    fn from_code(code: &str) -> Option<Self> {
        Some(match code {
            "no_credential" => Self::NoCredential,
            "not_github" => Self::NotGithub,
            "github_reconnect" => Self::Reconnect,
            "github_disabled" => Self::Disabled,
            other => Self::Refused(other.strip_prefix("refused:")?.parse().ok()?),
        })
    }

    /// One line: why `gh` is not signed in, and what to do about it.
    pub(crate) fn message(&self) -> String {
        let reason = match self {
            Self::NoCredential => {
                "this project is not connected to GitHub and has no token. Connect GitHub in Exeora's settings, then run the command again.".to_owned()
            }
            Self::NotGithub => {
                "the repository of this project is not on github.com, so Exeora has no token for GitHub. Set GH_TOKEN if gh is needed here.".to_owned()
            }
            Self::Reconnect => {
                "the connection to GitHub has to be made again. Reconnect GitHub in Exeora's settings, then run the command again.".to_owned()
            }
            Self::Disabled => {
                "this Exeora has no connection to GitHub. Set GH_TOKEN, or add a repository token to the project.".to_owned()
            }
            Self::Unavailable => {
                "GitHub did not answer Exeora. Run the command again in a moment.".to_owned()
            }
            Self::RateLimited => {
                "Exeora was asked for a token too many times. Wait a minute, then run the command again.".to_owned()
            }
            Self::Refused(status) => format!(
                "Exeora refused this machine a token ({status}). Check in the dashboard that the instance still belongs to the project."
            ),
            Self::Unreachable(reason) => format!(
                "Exeora could not be asked for a token: {reason}. Check the network of the instance, then run the command again."
            ),
        };
        format!("exeora: gh is not signed in: {reason}")
    }
}

/// What is kept between two runs of `gh`.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    gateway: String,
    project: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    token: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    expires_at: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    refusal: Option<String>,
    /// When the gateway answered.
    at: u64,
}

pub(crate) enum Kept {
    Token(String),
    Refusal(Refusal),
}

/// Where a token waits between two runs of `gh`, so that not every one of
/// them asks the gateway.
///
/// In memory, or not at all. A token written to a disk outlives the
/// instance's sleep, its snapshots and whoever copies the disk, so it is
/// kept only where the machine forgets it when it stops: a folder of this
/// user alone on a filesystem that lives in memory. Where there is no such
/// filesystem nothing is kept, and the gateway is asked every time.
pub(crate) struct TokenCache {
    folder: Option<PathBuf>,
}

impl TokenCache {
    /// `memory` is whether `folder` is on a filesystem that lives in
    /// memory. The caller is who knows.
    pub(crate) fn at(folder: PathBuf, memory: bool) -> Self {
        Self {
            folder: memory.then_some(folder),
        }
    }

    /// `EXEORA_GH_CACHE_DIR` names another folder, and changes nothing of
    /// the rule: a folder that is not in memory keeps nothing.
    #[cfg(unix)]
    fn of_this_user() -> Self {
        let mounts = std::fs::read_to_string("/proc/mounts").unwrap_or_default();
        // SAFETY: getuid reads the id of this process and cannot fail.
        let user = unsafe { libc::getuid() };
        let folder = std::env::var_os("EXEORA_GH_CACHE_DIR")
            .map(PathBuf::from)
            .filter(|folder| folder.is_absolute())
            .unwrap_or_else(|| Path::new(MEMORY).join(format!("exeora-{user}")));
        let memory = lives_in_memory(&mounts, &folder);
        Self::at(folder, memory)
    }

    /// Only a unix says whose a folder is and who may look into it, so
    /// nowhere else is anything kept.
    #[cfg(not(unix))]
    fn of_this_user() -> Self {
        Self::at(PathBuf::new(), false)
    }

    fn file(&self) -> Option<PathBuf> {
        let folder = self.folder.as_ref()?;
        own_folder(folder).then(|| folder.join(CACHE_FILE))
    }

    pub(crate) fn read(&self, asked: &Asked, now: u64) -> Option<Kept> {
        let file = self.file()?;
        if !own_file(&file) {
            return None;
        }
        let mut bytes = Vec::new();
        std::fs::File::open(&file)
            .ok()?
            .take(16_384)
            .read_to_end(&mut bytes)
            .ok()?;
        let entry: Entry = serde_json::from_slice(&bytes).ok()?;
        // A clock that went backwards makes every age wrong.
        if entry.gateway != asked.gateway || entry.project != asked.project || entry.at > now {
            return None;
        }
        if let Some(code) = &entry.refusal {
            return (now < entry.at.saturating_add(REFUSAL_AGE_MS))
                .then(|| Refusal::from_code(code))
                .flatten()
                .map(Kept::Refusal);
        }
        let token = entry.token?;
        (now < good_until(entry.expires_at, entry.at)).then_some(Kept::Token(token))
    }

    fn keep_token(&self, asked: &Asked, token: &GhToken, now: u64) {
        self.keep(&Entry {
            gateway: asked.gateway.clone(),
            project: asked.project.clone(),
            token: Some(token.token.clone()),
            expires_at: token.expires_at,
            refusal: None,
            at: now,
        });
    }

    fn keep_refusal(&self, asked: &Asked, refusal: &Refusal, now: u64) {
        self.keep(&Entry {
            gateway: asked.gateway.clone(),
            project: asked.project.clone(),
            token: None,
            expires_at: None,
            refusal: Some(refusal.code()),
            at: now,
        });
    }

    /// Not being able to keep a token costs a request next time and
    /// nothing else, so a failure here is not anybody's problem.
    fn keep(&self, entry: &Entry) {
        let Some(folder) = &self.folder else {
            return;
        };
        if !folder.exists() && make_folder(folder).is_err() {
            return;
        }
        let Some(file) = self.file() else {
            return;
        };
        if let Ok(bytes) = serde_json::to_vec(entry) {
            let _ = private::write(&file, &bytes, 0o600);
        }
    }
}

/// Until when a token that was fetched at `at` is used without asking.
fn good_until(expires_at: Option<u64>, at: u64) -> u64 {
    let oldest = at.saturating_add(MAX_AGE_MS);
    match expires_at {
        Some(expires_at) => expires_at.saturating_sub(EXPIRY_MARGIN_MS).min(oldest),
        None => oldest,
    }
}

/// Whether `path` is on a filesystem that keeps its files in memory, going
/// by the lines of `/proc/mounts`. The filesystem of a path is the one
/// mounted nearest above it, and where two are mounted on the same point
/// the later one is the one that is seen.
#[cfg(unix)]
pub(crate) fn lives_in_memory(mounts: &str, path: &Path) -> bool {
    mounts
        .lines()
        .filter_map(|line| {
            let mut fields = line.split_whitespace();
            let (_device, point, kind) = (fields.next()?, fields.next()?, fields.next()?);
            path.starts_with(point).then_some((point, kind))
        })
        .max_by_key(|(point, _)| Path::new(point).components().count())
        .is_some_and(|(_, kind)| matches!(kind, "tmpfs" | "ramfs"))
}

#[cfg(unix)]
fn make_folder(folder: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::DirBuilderExt;
    std::fs::DirBuilder::new().mode(0o700).create(folder)?;
    // The mode asked for at creation is cut down by the umask, never widened.
    Ok(())
}

#[cfg(not(unix))]
fn make_folder(folder: &Path) -> std::io::Result<()> {
    std::fs::create_dir(folder)
}

/// Whether the folder is a folder, this user's, and closed to everybody
/// else. The place it is in is one where anybody may make a folder, this
/// name included, so one that was made by another is not trusted.
#[cfg(unix)]
fn own_folder(folder: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;
    std::fs::symlink_metadata(folder).is_ok_and(|metadata| {
        // SAFETY: getuid reads the id of this process and cannot fail.
        metadata.is_dir()
            && metadata.uid() == unsafe { libc::getuid() }
            && metadata.mode() & 0o077 == 0
    })
}

#[cfg(not(unix))]
fn own_folder(_folder: &Path) -> bool {
    false
}

#[cfg(unix)]
fn own_file(file: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;
    std::fs::symlink_metadata(file).is_ok_and(|metadata| {
        // SAFETY: getuid reads the id of this process and cannot fail.
        metadata.is_file()
            && metadata.uid() == unsafe { libc::getuid() }
            && metadata.mode() & 0o077 == 0
    })
}

#[cfg(not(unix))]
fn own_file(_file: &Path) -> bool {
    false
}

/// Where the real `gh` may be.
pub(crate) struct Search<'a> {
    /// What `EXEORA_REAL_GH` names.
    pub named: Option<&'a Path>,
    /// Where the bootstrap installs it.
    pub installed: Option<&'a Path>,
    /// `PATH`.
    pub path: Option<&'a OsStr>,
    /// What is known to be the shim or the CLI itself, and must never be
    /// taken for `gh`: it would run this again, for ever.
    pub shims: &'a [PathBuf],
}

/// The real `gh`: the one named, else the one installed, else the first on
/// the path. Whatever would lead back here is passed over, wherever it was
/// found.
pub(crate) fn find_real_gh(search: &Search<'_>) -> Option<PathBuf> {
    let shims: Vec<PathBuf> = search
        .shims
        .iter()
        .filter_map(|shim| std::fs::canonicalize(shim).ok())
        .collect();
    let real = |candidate: &Path| -> bool {
        let Ok(resolved) = std::fs::canonicalize(candidate) else {
            return false;
        };
        runnable(&resolved) && !shims.contains(&resolved) && !is_shim(&resolved)
    };
    let names: &[&str] = if cfg!(windows) {
        &["gh.exe", "gh.cmd", "gh.bat"]
    } else {
        &["gh"]
    };
    [search.named, search.installed]
        .into_iter()
        .flatten()
        .map(Path::to_path_buf)
        .chain(
            search
                .path
                .into_iter()
                .flat_map(std::env::split_paths)
                .filter(|folder| folder.is_absolute())
                .flat_map(|folder| names.iter().map(move |name| folder.join(name))),
        )
        .find(|candidate| real(candidate))
}

#[cfg(unix)]
fn runnable(file: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    std::fs::metadata(file)
        .is_ok_and(|metadata| metadata.is_file() && metadata.permissions().mode() & 0o111 != 0)
}

#[cfg(not(unix))]
fn runnable(file: &Path) -> bool {
    file.is_file()
}

/// Whether the file is a script that runs this command, by what it says.
/// The shim is known by where it is too, but it may have been copied or
/// linked anywhere, and what it does is the same wherever it is.
fn is_shim(file: &Path) -> bool {
    let mut start = Vec::new();
    let read = std::fs::File::open(file).and_then(|file| file.take(2_048).read_to_end(&mut start));
    read.is_ok() && start.starts_with(b"#!") && contains(&start, b"gh-shim")
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    haystack
        .windows(needle.len())
        .any(|window| window == needle)
}

/// Whether the command is `gh auth status`, which asks the very question
/// this has the answer to.
pub(crate) fn asks_who_is_signed_in(args: &[OsString]) -> bool {
    let mut words = args
        .iter()
        .filter_map(|arg| arg.to_str())
        .filter(|arg| !arg.starts_with('-'));
    words.next() == Some("auth") && words.next() == Some("status")
}

/// Becomes the real `gh`. With a token, the token is in the environment of
/// that process and of nothing else.
#[cfg(unix)]
fn become_gh(real: &Path, args: &[OsString], token: Option<&str>) -> i32 {
    use std::os::unix::process::CommandExt;
    let mut command = std::process::Command::new(real);
    command.args(args);
    if let Some(token) = token {
        command.env("GH_TOKEN", token);
    }
    // Comes back only when there was nothing to become.
    let error = command.exec();
    eprintln!("exeora: could not run {}: {error}", real.display());
    NOT_RUNNABLE
}

#[cfg(not(unix))]
fn become_gh(real: &Path, args: &[OsString], token: Option<&str>) -> i32 {
    let mut command = std::process::Command::new(real);
    command.args(args);
    if let Some(token) = token {
        command.env("GH_TOKEN", token);
    }
    wait_for(real, command)
}

/// Runs the real `gh` without a token and stays to see how it ends, so the
/// reason can be said when the command turns out to have needed one.
fn run_unsigned(real: &Path, args: &[OsString], refusal: &Refusal) -> i32 {
    let mut command = std::process::Command::new(real);
    command.args(args);
    let code = wait_for(real, command);
    if code == GH_NEEDS_AUTH || asks_who_is_signed_in(args) {
        eprintln!("{}", refusal.message());
    }
    code
}

fn wait_for(real: &Path, mut command: std::process::Command) -> i32 {
    // An interrupt from the keyboard reaches both processes. It is `gh`'s
    // to answer; this one waits for what `gh` makes of it.
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // SAFETY: changes how this process takes two signals, and gives the
        // child back the way every process starts with. The hook makes two
        // raw calls and allocates nothing.
        unsafe {
            libc::signal(libc::SIGINT, libc::SIG_IGN);
            libc::signal(libc::SIGQUIT, libc::SIG_IGN);
            command.pre_exec(|| {
                libc::signal(libc::SIGINT, libc::SIG_DFL);
                libc::signal(libc::SIGQUIT, libc::SIG_DFL);
                Ok(())
            });
        }
    }
    match command.status() {
        Ok(status) => exit_code(status),
        Err(error) => {
            eprintln!("exeora: could not run {}: {error}", real.display());
            NOT_RUNNABLE
        }
    }
}

#[cfg(unix)]
fn exit_code(status: std::process::ExitStatus) -> i32 {
    use std::os::unix::process::ExitStatusExt;
    // A process ended by a signal has no code; a shell reports it this way.
    status
        .code()
        .or_else(|| status.signal().map(|signal| 128 + signal))
        .unwrap_or(1)
}

#[cfg(not(unix))]
fn exit_code(status: std::process::ExitStatus) -> i32 {
    status.code().unwrap_or(1)
}

// On a unix only, like what is kept: see `TokenCache::of_this_user`.
#[cfg(all(test, unix))]
mod tests {
    use super::{
        Asked, Kept, Refusal, TokenCache, asks_who_is_signed_in, good_until, lives_in_memory, token,
    };
    use crate::testing::Gateway;
    use serde_json::json;
    use std::{ffi::OsString, path::Path};

    const MINUTE: u64 = 60_000;
    const NOW: u64 = 1_800_000_000_000;

    fn asked(gateway: &Gateway) -> Asked {
        Asked {
            gateway: gateway.url.clone(),
            project: "prj_alera".to_owned(),
            device: Some("dev_cloud".to_owned()),
        }
    }

    /// A gateway that answers every request for a token with `answer`.
    async fn answering(status: u16, answer: serde_json::Value) -> Gateway {
        Gateway::start(move |_, _, _| (status, answer.clone())).await
    }

    fn a_token(expires_at: Option<u64>) -> serde_json::Value {
        json!({
            "host": "github.com",
            "token": "ghu_example",
            "expiresAt": expires_at,
            "login": "octocat",
            "source": "user",
        })
    }

    fn asked_for(gateway: &Gateway) -> usize {
        gateway
            .received_as("POST", "/api/projects/prj_alera/gh-token")
            .len()
    }

    #[test]
    fn a_token_is_used_until_five_minutes_before_its_end_or_thirty_after_it_came() {
        // Eight hours to live: thirty minutes after it was fetched.
        assert_eq!(good_until(Some(NOW + 480 * MINUTE), NOW), NOW + 30 * MINUTE);
        // Twenty minutes to live: five minutes before its end.
        assert_eq!(good_until(Some(NOW + 20 * MINUTE), NOW), NOW + 15 * MINUTE);
        // No end named: thirty minutes after it was fetched.
        assert_eq!(good_until(None, NOW), NOW + 30 * MINUTE);
        // Already within five minutes of its end: never used from the cache.
        assert!(good_until(Some(NOW + 4 * MINUTE), NOW) <= NOW);
    }

    #[tokio::test]
    async fn a_token_that_was_kept_is_not_asked_for_again_until_it_is_due() {
        let gateway = answering(200, a_token(Some(NOW + 20 * MINUTE))).await;
        let memory = tempfile::tempdir().unwrap();
        let cache = TokenCache::at(memory.path().join("exeora-1000"), true);
        let api = gateway.api().await;
        let asked = asked(&gateway);

        assert_eq!(
            token(&api, &cache, &asked, NOW).await.as_deref(),
            Ok("ghu_example")
        );
        assert_eq!(asked_for(&gateway), 1);
        assert_eq!(
            gateway.received()[0].body,
            json!({ "deviceId": "dev_cloud" })
        );

        // Fourteen minutes on it is still good, and the gateway is left alone.
        assert_eq!(
            token(&api, &cache, &asked, NOW + 14 * MINUTE)
                .await
                .as_deref(),
            Ok("ghu_example")
        );
        assert_eq!(asked_for(&gateway), 1);

        // Fifteen minutes on it is within five of its end, and asked for anew.
        assert!(token(&api, &cache, &asked, NOW + 15 * MINUTE).await.is_ok());
        assert_eq!(asked_for(&gateway), 2);
    }

    #[tokio::test]
    async fn a_token_with_no_end_is_asked_for_again_after_thirty_minutes() {
        let gateway = answering(200, a_token(None)).await;
        let memory = tempfile::tempdir().unwrap();
        let cache = TokenCache::at(memory.path().join("exeora-1000"), true);
        let api = gateway.api().await;
        let asked = asked(&gateway);

        assert!(token(&api, &cache, &asked, NOW).await.is_ok());
        assert!(token(&api, &cache, &asked, NOW + 29 * MINUTE).await.is_ok());
        assert_eq!(asked_for(&gateway), 1);
        // The second fetch starts the thirty minutes over.
        assert!(token(&api, &cache, &asked, NOW + 30 * MINUTE).await.is_ok());
        assert!(token(&api, &cache, &asked, NOW + 59 * MINUTE).await.is_ok());
        assert_eq!(asked_for(&gateway), 2);
    }

    #[tokio::test]
    async fn what_is_kept_is_for_its_owner_alone() {
        use std::os::unix::fs::PermissionsExt;
        let gateway = answering(200, a_token(None)).await;
        let memory = tempfile::tempdir().unwrap();
        let folder = memory.path().join("exeora-1000");
        let cache = TokenCache::at(folder.clone(), true);
        assert!(
            token(&gateway.api().await, &cache, &asked(&gateway), NOW)
                .await
                .is_ok()
        );

        let mode =
            |path: &std::path::Path| std::fs::metadata(path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode(&folder), 0o700);
        assert_eq!(mode(&folder.join("gh-token.json")), 0o600);
        // Written whole: nothing half made is left beside it.
        let names: Vec<_> = std::fs::read_dir(&folder)
            .unwrap()
            .flatten()
            .map(|entry| entry.file_name())
            .collect();
        assert_eq!(names, ["gh-token.json"]);
    }

    #[tokio::test]
    async fn a_folder_anybody_can_look_into_is_not_used() {
        use std::os::unix::fs::PermissionsExt;
        let gateway = answering(200, a_token(None)).await;
        let memory = tempfile::tempdir().unwrap();
        let folder = memory.path().join("exeora-1000");
        std::fs::create_dir(&folder).unwrap();
        std::fs::set_permissions(&folder, std::fs::Permissions::from_mode(0o755)).unwrap();
        let cache = TokenCache::at(folder.clone(), true);
        let api = gateway.api().await;
        let asked = asked(&gateway);

        assert!(token(&api, &cache, &asked, NOW).await.is_ok());
        assert!(token(&api, &cache, &asked, NOW + 1).await.is_ok());
        assert_eq!(asked_for(&gateway), 2);
        assert_eq!(std::fs::read_dir(&folder).unwrap().count(), 0);
    }

    #[tokio::test]
    async fn nothing_is_kept_where_the_folder_is_not_in_memory() {
        let gateway = answering(200, a_token(None)).await;
        let disk = tempfile::tempdir().unwrap();
        let folder = disk.path().join("exeora-1000");
        let cache = TokenCache::at(folder.clone(), false);
        let api = gateway.api().await;
        let asked = asked(&gateway);

        assert_eq!(
            token(&api, &cache, &asked, NOW).await.as_deref(),
            Ok("ghu_example")
        );
        assert_eq!(
            token(&api, &cache, &asked, NOW + 1).await.as_deref(),
            Ok("ghu_example")
        );
        // Asked every time, and not a byte written.
        assert_eq!(asked_for(&gateway), 2);
        assert!(!folder.exists());
        assert_eq!(std::fs::read_dir(disk.path()).unwrap().count(), 0);
    }

    #[test]
    fn a_filesystem_lives_in_memory_when_the_kernel_says_so() {
        let folder = Path::new("/dev/shm/exeora-1000");
        let mounts = "proc /proc proc rw 0 0\n/dev/vda / ext4 rw 0 0\ntmpfs /dev/shm tmpfs rw,nosuid,nodev 0 0\n";
        assert!(lives_in_memory(mounts, folder));
        assert!(lives_in_memory(
            "/dev/vda / ext4 rw 0 0\nnone /dev/shm ramfs rw 0 0\n",
            folder
        ));
        // A folder of the disk under that name, a filesystem in memory
        // that is somewhere else, and a file that could not be read.
        assert!(!lives_in_memory(
            "/dev/vda / ext4 rw 0 0\n/dev/vdb /dev/shm ext4 rw 0 0\n",
            folder
        ));
        assert!(!lives_in_memory(
            "/dev/vda / ext4 rw 0 0\ntmpfs /run tmpfs rw 0 0\n",
            folder
        ));
        assert!(!lives_in_memory(
            "/dev/vda / ext4 rw 0 0\ntmpfs /dev/shm/exeora-1000/inner tmpfs rw 0 0\n",
            folder
        ));
        assert!(!lives_in_memory("", folder));
        // A name that only begins the same is another folder.
        assert!(!lives_in_memory(
            "/dev/vda / ext4 rw 0 0\ntmpfs /dev/sh tmpfs rw 0 0\n",
            folder
        ));
        // The nearest mount above decides, whatever is mounted further up.
        assert!(!lives_in_memory(
            "tmpfs / tmpfs rw 0 0\n/dev/vdb /dev/shm ext4 rw 0 0\n",
            folder
        ));
        // Mounted over: what is seen is the last.
        assert!(!lives_in_memory(
            "tmpfs /dev/shm tmpfs rw 0 0\n/dev/vdb /dev/shm ext4 rw 0 0\n",
            folder
        ));
        assert!(lives_in_memory(
            "/dev/vdb /dev/shm ext4 rw 0 0\ntmpfs /dev/shm tmpfs rw 0 0\n",
            folder
        ));
    }

    #[tokio::test]
    async fn a_refusal_is_kept_for_a_minute() {
        let gateway = answering(404, json!({ "error": "no_credential" })).await;
        let memory = tempfile::tempdir().unwrap();
        let cache = TokenCache::at(memory.path().join("exeora-1000"), true);
        let api = gateway.api().await;
        let asked = asked(&gateway);

        assert_eq!(
            token(&api, &cache, &asked, NOW).await,
            Err(Refusal::NoCredential)
        );
        assert_eq!(
            token(&api, &cache, &asked, NOW + 59_000).await,
            Err(Refusal::NoCredential)
        );
        assert_eq!(asked_for(&gateway), 1);
        assert_eq!(
            token(&api, &cache, &asked, NOW + 60_000).await,
            Err(Refusal::NoCredential)
        );
        assert_eq!(asked_for(&gateway), 2);
    }

    #[tokio::test]
    async fn every_refusal_the_gateway_names_is_told_apart() {
        for (status, code, refusal, kept) in [
            (404, "no_credential", Refusal::NoCredential, true),
            (404, "not_github", Refusal::NotGithub, true),
            (404, "github_disabled", Refusal::Disabled, true),
            (409, "github_reconnect", Refusal::Reconnect, true),
            (403, "forbidden", Refusal::Refused(403), true),
            // What the next try may find mended is asked again.
            (502, "github_unavailable", Refusal::Unavailable, false),
            (429, "rate_limited", Refusal::RateLimited, false),
        ] {
            let gateway = answering(status, json!({ "error": code })).await;
            let memory = tempfile::tempdir().unwrap();
            let cache = TokenCache::at(memory.path().join("exeora-1000"), true);
            let api = gateway.api().await;
            let asked = asked(&gateway);

            assert_eq!(token(&api, &cache, &asked, NOW).await, Err(refusal.clone()));
            assert_eq!(
                token(&api, &cache, &asked, NOW + 1_000).await,
                Err(refusal.clone())
            );
            assert_eq!(asked_for(&gateway), if kept { 1 } else { 2 }, "{code}");
            let message = refusal.message();
            assert!(
                message.starts_with("exeora: gh is not signed in: "),
                "{message}"
            );
            assert_eq!(message.lines().count(), 1, "{message}");
        }
    }

    #[tokio::test]
    async fn a_gateway_that_is_not_there_is_a_reason_without_an_address() {
        let gateway = Gateway::gone();
        let memory = tempfile::tempdir().unwrap();
        let cache = TokenCache::at(memory.path().join("exeora-1000"), true);
        let refusal = token(&gateway.api().await, &cache, &asked(&gateway), NOW)
            .await
            .unwrap_err();
        assert!(matches!(refusal, Refusal::Unreachable(_)), "{refusal:?}");
        assert!(!refusal.message().contains("127.0.0.1"));
        assert!(!memory.path().join("exeora-1000").exists());
    }

    #[tokio::test]
    async fn what_was_kept_for_one_project_is_not_the_answer_for_another() {
        let gateway = answering(200, a_token(None)).await;
        let memory = tempfile::tempdir().unwrap();
        let cache = TokenCache::at(memory.path().join("exeora-1000"), true);
        let api = gateway.api().await;
        let first = asked(&gateway);
        assert!(token(&api, &cache, &first, NOW).await.is_ok());

        let other = Asked {
            project: "prj_other".to_owned(),
            ..asked(&gateway)
        };
        assert!(cache.read(&other, NOW + 1).is_none());
        assert!(matches!(cache.read(&first, NOW + 1), Some(Kept::Token(_))));
        // Nor is anything believed from before the clock was set back.
        assert!(cache.read(&first, NOW - 1).is_none());
    }

    #[tokio::test]
    async fn an_answer_that_is_not_a_token_for_github_is_not_passed_on() {
        for answer in [
            json!({ "host": "github.com", "token": "", "expiresAt": null }),
            json!({ "host": "github.com", "token": "ghu_a\nGH_HOST=evil.example", "expiresAt": null }),
            json!({ "host": "evil.example", "token": "ghu_example", "expiresAt": null }),
        ] {
            let gateway = answering(200, answer).await;
            let memory = tempfile::tempdir().unwrap();
            let folder = memory.path().join("exeora-1000");
            let cache = TokenCache::at(folder.clone(), true);
            let refusal = token(&gateway.api().await, &cache, &asked(&gateway), NOW)
                .await
                .unwrap_err();
            assert!(matches!(refusal, Refusal::Unreachable(_)));
            assert!(!folder.exists());
        }
    }

    #[test]
    fn knows_the_command_that_asks_who_is_signed_in() {
        let args = |words: &[&str]| words.iter().map(OsString::from).collect::<Vec<_>>();
        assert!(asks_who_is_signed_in(&args(&["auth", "status"])));
        assert!(asks_who_is_signed_in(&args(&[
            "auth",
            "status",
            "--hostname",
            "github.com"
        ])));
        assert!(asks_who_is_signed_in(&args(&[
            "auth",
            "--show-token",
            "status"
        ])));
        assert!(!asks_who_is_signed_in(&args(&["auth", "login"])));
        assert!(!asks_who_is_signed_in(&args(&["pr", "status"])));
        assert!(!asks_who_is_signed_in(&args(&["--version"])));
        assert!(!asks_who_is_signed_in(&args(&[])));
    }

    mod finding {
        use super::super::{Search, find_real_gh};
        use std::{
            ffi::OsString,
            path::{Path, PathBuf},
        };

        const SHIM: &str =
            "#!/bin/sh\n# Written by Exeora.\nexec \"$HOME/.local/bin/exeora\" gh-shim -- \"$@\"\n";
        const REAL: &str = "#!/bin/sh\necho gh version 2.101.0\n";

        fn program(path: &Path, text: &str) -> PathBuf {
            use std::os::unix::fs::PermissionsExt;
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, text).unwrap();
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o755)).unwrap();
            std::fs::canonicalize(path).unwrap()
        }

        fn path(folders: &[&Path]) -> OsString {
            std::env::join_paths(folders).unwrap()
        }

        #[test]
        fn takes_the_one_named_then_the_one_installed_then_the_path() {
            let home = tempfile::tempdir().unwrap();
            let home = std::fs::canonicalize(home.path()).unwrap();
            let named = program(&home.join("named/gh"), REAL);
            let installed = program(&home.join("share/exeora/bin/gh"), REAL);
            let on_path = program(&home.join("usr/bin/gh"), REAL);
            let folders = path(&[&home.join("empty"), &home.join("usr/bin")]);

            let search = |named: Option<&Path>, installed: Option<&Path>| {
                find_real_gh(&Search {
                    named,
                    installed,
                    path: Some(&folders),
                    shims: &[],
                })
            };
            assert_eq!(search(Some(&named), Some(&installed)), Some(named.clone()));
            assert_eq!(search(None, Some(&installed)), Some(installed.clone()));
            assert_eq!(search(None, None), Some(on_path.clone()));
            // One that is named and is not there does not end the search.
            assert_eq!(search(Some(&home.join("nowhere/gh")), None), Some(on_path));
        }

        #[test]
        fn never_takes_the_shim_for_gh_wherever_it_is_found() {
            let home = tempfile::tempdir().unwrap();
            let home = std::fs::canonicalize(home.path()).unwrap();
            let shim = program(&home.join("local/bin/gh"), SHIM);
            let real = program(&home.join("usr/bin/gh"), REAL);
            let folders = path(&[&home.join("local/bin"), &home.join("usr/bin")]);

            // First on the path, as it is on an instance.
            assert_eq!(
                find_real_gh(&Search {
                    named: None,
                    installed: None,
                    path: Some(&folders),
                    shims: std::slice::from_ref(&shim),
                }),
                Some(real.clone())
            );
            // Known by what it says, where nobody said where it is.
            assert_eq!(
                find_real_gh(&Search {
                    named: Some(&shim),
                    installed: Some(&shim),
                    path: Some(&folders),
                    shims: &[],
                }),
                Some(real.clone())
            );
            // Known by where it is, under another name and through a link.
            let disguised = program(&home.join("opt/bin/gh"), REAL);
            std::os::unix::fs::symlink(&disguised, home.join("opt/link")).unwrap();
            let only = path(&[&home.join("opt/bin")]);
            assert_eq!(
                find_real_gh(&Search {
                    named: Some(&home.join("opt/link")),
                    installed: None,
                    path: Some(&only),
                    shims: std::slice::from_ref(&disguised),
                }),
                None
            );
        }

        #[test]
        fn finds_nothing_where_there_is_only_the_shim() {
            let home = tempfile::tempdir().unwrap();
            let home = std::fs::canonicalize(home.path()).unwrap();
            program(&home.join("local/bin/gh"), SHIM);
            let folders = path(&[&home.join("local/bin")]);
            assert_eq!(
                find_real_gh(&Search {
                    named: None,
                    installed: Some(&home.join("share/exeora/bin/gh")),
                    path: Some(&folders),
                    shims: &[],
                }),
                None
            );
        }

        #[test]
        fn passes_over_what_cannot_be_run() {
            use std::os::unix::fs::PermissionsExt;
            let home = tempfile::tempdir().unwrap();
            let home = std::fs::canonicalize(home.path()).unwrap();
            let plain = program(&home.join("first/gh"), REAL);
            std::fs::set_permissions(&plain, std::fs::Permissions::from_mode(0o644)).unwrap();
            std::fs::create_dir_all(home.join("second/gh")).unwrap();
            let real = program(&home.join("third/gh"), REAL);
            let folders = path(&[
                &home.join("first"),
                &home.join("second"),
                Path::new("relative"),
                &home.join("third"),
            ]);
            assert_eq!(
                find_real_gh(&Search {
                    named: None,
                    installed: None,
                    path: Some(&folders),
                    shims: &[],
                }),
                Some(real)
            );
        }
    }
}
