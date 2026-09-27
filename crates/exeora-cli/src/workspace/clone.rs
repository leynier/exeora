//! Bringing a copy of a project onto this machine.
//!
//! A project is a repository that lives in several places. The first time one
//! is asked for on a machine that has no copy, this is what makes the copy:
//! it takes a checkout of the same repository that is already in the projects
//! folder, or clones one there. It is the laptop's version of what `run.sh`
//! does on a cloud machine, with the two differences a person's own disk
//! asks for: nothing that is already there is ever deleted or written over,
//! and a clone that fails leaves nothing behind.

use super::git::{GitOutput, NON_INTERACTIVE_SSH, run_git};
use crate::{
    api::ApiClient,
    config::{ConfigStore, ProjectEntry},
    error::{ErrorCode, ExeoraError},
    repo::{
        checkout_root, default_branch_of, https_repository_url, origin_of, repository_host,
        repository_key, ssh_repository_url,
    },
};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    ffi::OsString,
    future::Future,
    path::{Path, PathBuf},
    pin::Pin,
    sync::{Arc, LazyLock, Mutex as StdMutex},
    time::Duration,
};
use tokio::sync::{Mutex, watch};
use tokio_util::sync::CancellationToken;
use uuid::Uuid;

/// A repository the size of a monorepo over a home connection takes a while.
/// Far past the 300 s a fetch gets, and still an end: a clone that has made
/// no progress in half an hour is not going to.
pub const CLONE_TIMEOUT: Duration = Duration::from_secs(30 * 60);
/// Long enough for a handshake, short enough that asking costs nothing.
const REACH_TIMEOUT: Duration = Duration::from_secs(20);
const LOCAL_TIMEOUT: Duration = Duration::from_secs(60);
/// The gateway being slow to take a note must not hold a clone up.
const REPORT_TIMEOUT: Duration = Duration::from_secs(15);
const TEMPORARY_MARK: &str = ".exeora-clone-";
const MAX_GIT_WORDS: usize = 300;

/// Whose credentials the clone tries first.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Credential {
    /// A short-lived token from the gateway, through `exeora git-credential`.
    Exeora,
    /// Whatever git on this machine already has.
    Machine,
}

/// A repository as the gateway describes it to a machine that is about to
/// hold a copy: `RepositoryRef` in `packages/protocol/src/repository.ts`.
#[derive(Debug, Clone)]
pub struct Repository {
    pub url: String,
    pub default_branch: Option<String>,
    pub slug: String,
    pub name: String,
    pub credential: Credential,
}

impl Repository {
    /// Reads the `repository` of a `project_prepare` action. Checked here as
    /// strictly as the schema does, because the slug becomes a folder name.
    pub fn from_value(value: &Value) -> Result<Self, ExeoraError> {
        let text = |name: &str, max: usize| -> Result<Option<String>, ExeoraError> {
            match value.get(name) {
                None | Some(Value::Null) => Ok(None),
                Some(Value::String(text)) if !text.is_empty() && text.chars().count() <= max => {
                    Ok(Some(text.clone()))
                }
                Some(_) => Err(invalid(format!("repository.{name} is not valid."))),
            }
        };
        let required = |name: &str, max: usize| -> Result<String, ExeoraError> {
            text(name, max)?.ok_or_else(|| invalid(format!("repository.{name} is required.")))
        };
        let repository = Self {
            url: required("url", 1000)?,
            default_branch: text("defaultBranch", 255)?,
            slug: required("slug", 60)?,
            name: required("name", 100)?,
            credential: match value.get("credential").and_then(Value::as_str) {
                Some("exeora") => Credential::Exeora,
                None | Some("machine") => Credential::Machine,
                Some(_) => return Err(invalid("repository.credential is not valid.")),
            },
        };
        validate_slug(&repository.slug)?;
        Ok(repository)
    }
}

/// Where the copy is, and whether it was there before anyone asked.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Prepared {
    pub local_path: PathBuf,
    pub adopted: bool,
    pub branch: Option<String>,
}

impl Prepared {
    /// The value a `project_prepare` call answers with.
    pub fn to_value(&self) -> Value {
        json!({
            "kind": "prepared",
            "localPath": self.local_path,
            "adopted": self.adopted,
            "branch": self.branch,
        })
    }
}

/// One way of asking for the repository.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Attempt {
    pub url: String,
    /// Whether Exeora's credential helper answers for this one.
    pub helper: bool,
}

/// The addresses to clone from, in the order they are tried, and what makes a
/// checkout that is already there a checkout of the same repository.
///
/// Kept apart from `Repository` so the addresses can be given as they are: a
/// test clones from a `file://` URL, which names no repository on a host.
#[derive(Debug, Clone)]
pub struct Plan {
    pub attempts: Vec<Attempt>,
    /// The repository key. Without one, an origin is the same repository only
    /// when it is one of the addresses, character for character.
    pub key: Option<String>,
}

impl Plan {
    /// Exeora's helper first when the gateway said it has a credential, then
    /// the machine's own git over https, then ssh, which is where the keys of
    /// most people who have any are.
    pub fn for_repository(repository: &Repository) -> Result<Self, ExeoraError> {
        let (Some(https), Some(ssh)) = (
            https_repository_url(&repository.url),
            ssh_repository_url(&repository.url),
        ) else {
            return Err(invalid(format!(
                "{} is not the address of a repository on a host, so there is nothing to clone. Give the project's checkout a remote and run `exeora sync` where it lives.",
                repository.url
            )));
        };
        let mut attempts = Vec::new();
        if repository.credential == Credential::Exeora {
            attempts.push(Attempt {
                url: https.clone(),
                helper: true,
            });
        }
        attempts.push(Attempt {
            url: https,
            helper: false,
        });
        attempts.push(Attempt {
            url: ssh,
            helper: false,
        });
        Ok(Self {
            attempts,
            key: repository_key(&repository.url),
        })
    }

    fn is_origin(&self, origin: &str) -> bool {
        match (&self.key, repository_key(origin)) {
            (Some(key), Some(found)) => *key == found,
            (None, None) => self.attempts.iter().any(|attempt| attempt.url == origin),
            _ => false,
        }
    }
}

/// What this machine tells the gateway about its copy while it makes it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LocationReport {
    Cloning,
    Ready { local_path: PathBuf },
    Failed { message: String, code: &'static str },
}

impl LocationReport {
    fn body(&self) -> Value {
        match self {
            Self::Cloning => json!({ "status": "cloning" }),
            Self::Ready { local_path } => json!({ "status": "ready", "localPath": local_path }),
            Self::Failed { message, code } => {
                json!({ "status": "error", "error": message, "errorCode": code })
            }
        }
    }
}

type Reporting = Pin<Box<dyn Future<Output = ()> + Send>>;
pub type Reporter = Arc<dyn Fn(LocationReport) -> Reporting + Send + Sync>;

/// Reports through `PUT /api/projects/:id/locations/:deviceId`. A report that
/// does not arrive is dropped: the copy is what matters, and the next call or
/// `exeora sync` says where it is.
pub fn gateway_reporter(api: ApiClient, project_id: String, device_id: String) -> Reporter {
    Arc::new(move |report| {
        let api = api.clone();
        let project_id = project_id.clone();
        let device_id = device_id.clone();
        Box::pin(async move {
            let _ = api
                .report_location(&project_id, &device_id, report.body())
                .await;
        })
    })
}

/// Everything a clone needs to know about the machine it runs on.
#[derive(Clone)]
pub struct CloneContext {
    pub config_path: PathBuf,
    pub projects_root: PathBuf,
    /// The `exeora` git is told to ask for credentials.
    pub helper_program: PathBuf,
    pub reporter: Option<Reporter>,
    /// Held while the config is written, by a process that has other calls
    /// reading and writing it.
    pub config_guard: Option<Arc<Mutex<()>>>,
    pub clone_timeout: Duration,
}

impl CloneContext {
    /// The context of this machine as its config describes it now.
    pub fn for_machine(
        config_path: &Path,
        api: &ApiClient,
        project_id: &str,
        config_guard: Option<Arc<Mutex<()>>>,
    ) -> Result<Self, ExeoraError> {
        let config = ConfigStore::load_from(config_path.to_path_buf()).map_err(|error| {
            internal(format!(
                "Could not read the local Exeora configuration: {error}"
            ))
        })?;
        let projects_root = config.projects_root().map_err(|error| {
            internal(format!(
                "Could not tell where projects go on this machine: {error}"
            ))
        })?;
        let helper_program = std::env::current_exe().map_err(|error| {
            internal(format!(
                "Could not find the Exeora executable on this machine: {error}"
            ))
        })?;
        let reporter = config
            .data()
            .device_id
            .clone()
            .map(|device_id| gateway_reporter(api.clone(), project_id.to_owned(), device_id));
        Ok(Self {
            config_path: config_path.to_path_buf(),
            projects_root,
            helper_program,
            reporter,
            config_guard,
            clone_timeout: CLONE_TIMEOUT,
        })
    }

    async fn report(&self, report: LocationReport) {
        if let Some(reporter) = &self.reporter {
            let _ = tokio::time::timeout(REPORT_TIMEOUT, reporter(report)).await;
        }
    }
}

type Outcome = Result<Prepared, (ErrorCode, String)>;

/// The clones running in this process, one per project of a machine at most.
///
/// A clone belongs to the machine, not to the call that asked for it: the
/// relay gives a call about five minutes and a large repository takes longer.
/// So the work runs in a task of its own and the call only waits for it. A
/// call that is cancelled or runs out of time answers with its error and the
/// clone goes on, reporting to the gateway how it ended.
///
/// They are told apart by the configuration they write to as well as by the
/// project: two machines in one process, which is what tests are, would
/// otherwise answer each other's calls.
#[derive(Default)]
pub struct Cloner {
    running: StdMutex<HashMap<String, watch::Receiver<Option<Outcome>>>>,
}

static SHARED: LazyLock<Arc<Cloner>> = LazyLock::new(|| Arc::new(Cloner::default()));

/// Takes the project out of the running set however the task ends, so a task
/// that was dropped or panicked does not leave every later call waiting.
struct Running {
    cloner: Arc<Cloner>,
    key: String,
}

impl Drop for Running {
    fn drop(&mut self) {
        self.cloner
            .running
            .lock()
            .unwrap_or_else(|poison| poison.into_inner())
            .remove(&self.key);
    }
}

impl Cloner {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    /// The one every call in this process goes through.
    pub fn shared() -> Arc<Self> {
        SHARED.clone()
    }

    pub async fn prepare(
        self: &Arc<Self>,
        context: CloneContext,
        project_id: &str,
        repository: Repository,
        cancel: CancellationToken,
    ) -> Result<Prepared, ExeoraError> {
        let plan = Plan::for_repository(&repository)?;
        self.prepare_with_plan(context, project_id, repository, plan, cancel)
            .await
    }

    /// `prepare` with the addresses already decided.
    pub async fn prepare_with_plan(
        self: &Arc<Self>,
        context: CloneContext,
        project_id: &str,
        repository: Repository,
        plan: Plan,
        cancel: CancellationToken,
    ) -> Result<Prepared, ExeoraError> {
        validate_project_id(project_id)?;
        validate_slug(&repository.slug)?;
        let name = repository.name.clone();
        let key = format!("{}\n{project_id}", context.config_path.display());
        let mut receiver = {
            let mut running = self
                .running
                .lock()
                .unwrap_or_else(|poison| poison.into_inner());
            match running.get(&key) {
                // A second request for the same project waits for the first.
                Some(receiver) => receiver.clone(),
                None => {
                    let (sender, receiver) = watch::channel(None);
                    running.insert(key.clone(), receiver.clone());
                    let guard = Running {
                        cloner: self.clone(),
                        key,
                    };
                    let project_id = project_id.to_owned();
                    tokio::spawn(async move {
                        let outcome = run(&context, &project_id, &repository, &plan)
                            .await
                            .map_err(|error| (error.code, error.message));
                        drop(guard);
                        let _ = sender.send(Some(outcome));
                    });
                    receiver
                }
            }
        };
        tokio::select! {
            _ = cancel.cancelled() => Err(ExeoraError::new(
                ErrorCode::Cancelled,
                format!("The call ended before {name} was cloned. The clone goes on, and this machine tells Exeora when it is ready."),
            )),
            outcome = receiver.wait_for(Option::is_some) => match outcome.map(|value| value.clone()) {
                Ok(Some(Ok(prepared))) => Ok(prepared),
                Ok(Some(Err((code, message)))) => Err(ExeoraError::new(code, message)),
                Ok(None) | Err(_) => Err(internal(format!(
                    "The clone of {name} stopped without saying why. Try again."
                ))),
            },
        }
    }
}

/// Makes sure this machine holds a copy of the project, and says where.
pub async fn prepare_project(
    context: CloneContext,
    project_id: &str,
    repository: Repository,
    cancel: CancellationToken,
) -> Result<Prepared, ExeoraError> {
    Cloner::shared()
        .prepare(context, project_id, repository, cancel)
        .await
}

/// A failure, with the code the gateway files it under.
struct Failure {
    error: ExeoraError,
    code: &'static str,
}

impl Failure {
    fn new(code: &'static str, error: ExeoraError) -> Self {
        Self { error, code }
    }

    fn setup(message: impl Into<String>) -> Self {
        Self::new("setup_failed", ExeoraError::tool(message))
    }
}

async fn run(
    context: &CloneContext,
    project_id: &str,
    repository: &Repository,
    plan: &Plan,
) -> Result<Prepared, ExeoraError> {
    let config = ConfigStore::load_from(context.config_path.clone()).map_err(|error| {
        internal(format!(
            "Could not read the local Exeora configuration: {error}"
        ))
    })?;
    // The project is already here: the config says where, and that is the answer.
    if let Some(entry) = config.find_project(project_id)
        && entry.root.is_dir()
    {
        let prepared = Prepared {
            local_path: entry.root.clone(),
            adopted: true,
            branch: current_branch(&entry.root).await,
        };
        context
            .report(LocationReport::Ready {
                local_path: prepared.local_path.clone(),
            })
            .await;
        return Ok(prepared);
    }

    let destination = context.projects_root.join(&repository.slug);
    let placed = match place(context, project_id, repository, plan, &destination).await {
        Ok(prepared) => remember(context, project_id, repository, plan, &prepared)
            .await
            .map(|()| prepared),
        Err(failure) => Err(failure),
    };
    match placed {
        Ok(prepared) => {
            context
                .report(LocationReport::Ready {
                    local_path: prepared.local_path.clone(),
                })
                .await;
            Ok(prepared)
        }
        Err(failure) => {
            context
                .report(LocationReport::Failed {
                    message: failure.error.message.clone(),
                    code: failure.code,
                })
                .await;
            Err(failure.error)
        }
    }
}

async fn place(
    context: &CloneContext,
    project_id: &str,
    repository: &Repository,
    plan: &Plan,
    destination: &Path,
) -> Result<Prepared, Failure> {
    match std::fs::symlink_metadata(destination) {
        Ok(_) => adopt(repository, plan, destination).await,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            clone(context, project_id, repository, plan, destination).await
        }
        Err(error) => Err(Failure::setup(format!(
            "Could not look at {}: {error}. Choose another folder with `exeora config set projects-root <path>`, then try again.",
            destination.display()
        ))),
    }
}

/// Takes what is at the destination when it is a checkout of this repository,
/// and refuses anything else without touching it.
async fn adopt(
    repository: &Repository,
    plan: &Plan,
    destination: &Path,
) -> Result<Prepared, Failure> {
    let is_same_repository = destination.is_dir()
        && checkout_root(destination)
            .and_then(|top| std::fs::canonicalize(top).ok())
            .is_some_and(|top| std::fs::canonicalize(destination).ok().as_ref() == Some(&top))
        && origin_of(destination).is_some_and(|origin| plan.is_origin(&origin));
    if !is_same_repository {
        return Err(Failure::setup(format!(
            "{} already exists and is not a checkout of {}. Move it somewhere else, or choose another folder with `exeora config set projects-root <path>`, then try again.",
            destination.display(),
            repository.name
        )));
    }
    Ok(Prepared {
        local_path: destination.to_path_buf(),
        adopted: true,
        branch: current_branch(destination).await,
    })
}

/// Removes the half-made clone however the clone ends, unless it was moved
/// into place.
struct Temporary {
    path: PathBuf,
    keep: bool,
}

impl Drop for Temporary {
    fn drop(&mut self) {
        if !self.keep {
            let _ = std::fs::remove_dir_all(&self.path);
        }
    }
}

async fn clone(
    context: &CloneContext,
    project_id: &str,
    repository: &Repository,
    plan: &Plan,
    destination: &Path,
) -> Result<Prepared, Failure> {
    context.report(LocationReport::Cloning).await;
    let root = &context.projects_root;
    std::fs::create_dir_all(root).map_err(|error| {
        Failure::setup(format!(
            "Could not create the projects folder {}: {error}. Choose another folder with `exeora config set projects-root <path>`, then try again.",
            root.display()
        ))
    })?;
    forget_abandoned_clones(root, &repository.slug, context.clone_timeout);

    // Cloned beside the destination and moved into place at the end, so the
    // destination either does not exist or holds a whole checkout. A sibling
    // is on the same filesystem, which is what makes the move one step.
    let mut temporary = Temporary {
        path: root.join(format!(
            "{}{TEMPORARY_MARK}{}",
            repository.slug,
            &Uuid::new_v4().simple().to_string()[..8]
        )),
        keep: false,
    };
    let environment = quiet_environment(root).await;
    let environment: Vec<(&str, &str)> = environment
        .iter()
        .map(|(name, value)| (*name, value.as_str()))
        .collect();
    // The clone is not the call's to cancel; see `Cloner`.
    let never = CancellationToken::new();

    let mut failures = Vec::new();
    let mut cloned = None;
    for attempt in &plan.attempts {
        let arguments = clone_arguments(context, project_id, attempt, &temporary.path);
        let output = run_git(
            root,
            &arguments,
            None,
            &environment,
            context.clone_timeout,
            &never,
        )
        .await;
        match output {
            Ok(output) if output.success => {
                cloned = Some(attempt);
                break;
            }
            Ok(output) => {
                failures.push(String::from_utf8_lossy(&output.stderr).into_owned());
                let _ = std::fs::remove_dir_all(&temporary.path);
            }
            Err(error) if error.code == ErrorCode::ToolTimeout => {
                return Err(Failure::new(
                    "timed_out",
                    ExeoraError::new(
                        ErrorCode::ToolTimeout,
                        format!(
                            "Cloning {} timed out after {} minutes and was stopped. Check the connection of this machine, then try again.",
                            repository.name,
                            context.clone_timeout.as_secs() / 60
                        ),
                    ),
                ));
            }
            Err(error) => return Err(Failure::new("setup_failed", error)),
        }
    }
    let Some(attempt) = cloned else {
        return Err(explain(repository, &failures));
    };

    if attempt.helper
        && let Some(host) = repository_host(&attempt.url)
        && !machine_reaches_origin(&temporary.path, &environment, &never).await
    {
        keep_helper(
            context,
            project_id,
            &host,
            &temporary.path,
            &environment,
            &never,
        )
        .await?;
    }
    if let Some(branch) = &repository.default_branch {
        check_out(branch, &temporary.path, &environment, &never).await;
    }

    if let Err(error) = std::fs::rename(&temporary.path, destination) {
        // Another process may have put the same checkout there meanwhile.
        if std::fs::symlink_metadata(destination).is_ok() {
            return adopt(repository, plan, destination).await;
        }
        return Err(Failure::setup(format!(
            "The clone of {} could not be moved to {}: {error}. Check that the folder can be written to, then try again.",
            repository.name,
            destination.display()
        )));
    }
    temporary.keep = true;

    Ok(Prepared {
        local_path: destination.to_path_buf(),
        adopted: false,
        branch: current_branch(destination).await,
    })
}

/// What keeps git from stopping to ask somebody. `run_git` already turns the
/// terminal prompt off; a clone can also reach for a window to ask in, which
/// on a machine that serves calls in the background nobody is looking at.
pub(crate) async fn quiet_environment(root: &Path) -> Vec<(&'static str, String)> {
    let mut environment = vec![
        // Set and empty is how git is told there is no program to ask with.
        ("GIT_ASKPASS", String::new()),
        ("SSH_ASKPASS", String::new()),
        ("GCM_INTERACTIVE", "never".to_owned()),
    ];
    // Only when the user has not chosen an ssh command: setting
    // GIT_SSH_COMMAND would override theirs.
    let configured = std::env::var_os("GIT_SSH_COMMAND").is_some()
        || run_git(
            root,
            &["config", "--get", "core.sshCommand"],
            None,
            &[],
            LOCAL_TIMEOUT,
            &CancellationToken::new(),
        )
        .await
        .is_ok_and(|output| output.success);
    if !configured {
        environment.push(("GIT_SSH_COMMAND", NON_INTERACTIVE_SSH.to_owned()));
    }
    environment
}

fn clone_arguments(
    context: &CloneContext,
    project_id: &str,
    attempt: &Attempt,
    temporary: &Path,
) -> Vec<OsString> {
    let mut arguments: Vec<OsString> = Vec::new();
    if attempt.helper {
        // The empty value first: it clears the helpers of the machine, so the
        // token is asked of Exeora alone and is never handed to a keychain to
        // store when the clone succeeds.
        arguments.extend([
            "-c".into(),
            "credential.helper=".into(),
            "-c".into(),
            format!(
                "credential.helper={}",
                helper_command(&context.helper_program, project_id)
            )
            .into(),
            "-c".into(),
            "credential.useHttpPath=true".into(),
        ]);
    }
    arguments.extend([
        "clone".into(),
        "--".into(),
        attempt.url.as_str().into(),
        temporary.as_os_str().to_owned(),
    ]);
    arguments
}

/// What git runs to ask Exeora for a credential. Git hands a helper that
/// starts with `!` to a shell, on Windows too, where that shell is the one
/// git brings along: so the path is quoted for a POSIX shell either way.
pub fn helper_command(program: &Path, project_id: &str) -> String {
    let program = program.to_string_lossy();
    let program = if cfg!(windows) {
        program.replace('\\', "/")
    } else {
        program.into_owned()
    };
    format!(
        "!'{}' git-credential --project {project_id}",
        program.replace('\'', "'\\''")
    )
}

/// Whether git on this machine can read the remote with what it has, asked
/// without Exeora's helper and without anything that could stop to ask.
async fn machine_reaches_origin(
    checkout: &Path,
    environment: &[(&str, &str)],
    cancel: &CancellationToken,
) -> bool {
    run_git(
        checkout,
        &["ls-remote", "--exit-code", "origin", "HEAD"],
        None,
        environment,
        REACH_TIMEOUT,
        cancel,
    )
    .await
    .is_ok_and(|output| output.success)
}

/// Writes Exeora's helper into the repository's own config, and nowhere
/// else, for a machine that could not have fetched without it.
///
/// The empty value clears the machine's helpers for this host in this
/// repository. Without it git would hand the short-lived token to every one
/// of them to store after a fetch, and an hour later a keychain would answer
/// first with a token that has expired.
async fn keep_helper(
    context: &CloneContext,
    project_id: &str,
    host: &str,
    checkout: &Path,
    environment: &[(&str, &str)],
    cancel: &CancellationToken,
) -> Result<(), Failure> {
    let helper = format!("credential.https://{host}.helper");
    let command = helper_command(&context.helper_program, project_id);
    for arguments in [
        vec!["config", "--local", "--replace-all", helper.as_str(), ""],
        vec![
            "config",
            "--local",
            "--add",
            helper.as_str(),
            command.as_str(),
        ],
        vec!["config", "--local", "credential.useHttpPath", "true"],
    ] {
        let written = run_git(
            checkout,
            &arguments,
            None,
            environment,
            LOCAL_TIMEOUT,
            cancel,
        )
        .await
        .is_ok_and(|output| output.success);
        if !written {
            return Err(Failure::setup(
                "The repository was cloned, but its configuration could not be written, so later fetches would have no credentials. Check that the projects folder can be written to, then try again.",
            ));
        }
    }
    Ok(())
}

/// Checks the project's default branch out when the clone landed on another
/// one. Left where it is when the branch is not on the remote: the checkout is
/// whole either way, and a workspace names its own branch.
async fn check_out(
    branch: &str,
    checkout: &Path,
    environment: &[(&str, &str)],
    cancel: &CancellationToken,
) {
    if !is_plain_ref(branch) || current_branch(checkout).await.as_deref() == Some(branch) {
        return;
    }
    let remote = format!("refs/remotes/origin/{branch}");
    let on_origin = run_git(
        checkout,
        &["rev-parse", "--verify", "--quiet", remote.as_str()],
        None,
        environment,
        LOCAL_TIMEOUT,
        cancel,
    )
    .await
    .is_ok_and(|output| output.success);
    if on_origin {
        let _ = run_git(
            checkout,
            &["switch", branch],
            None,
            environment,
            LOCAL_TIMEOUT,
            cancel,
        )
        .await;
    }
}

async fn current_branch(checkout: &Path) -> Option<String> {
    let output: GitOutput = run_git(
        checkout,
        &["branch", "--show-current"],
        None,
        &[],
        LOCAL_TIMEOUT,
        &CancellationToken::new(),
    )
    .await
    .ok()?;
    if !output.success {
        return None;
    }
    let branch = String::from_utf8_lossy(&output.stdout).trim().to_owned();
    (!branch.is_empty()).then_some(branch)
}

/// Writes the project into the config as the file is now, not as it was when
/// the clone started.
async fn remember(
    context: &CloneContext,
    project_id: &str,
    repository: &Repository,
    plan: &Plan,
    prepared: &Prepared,
) -> Result<(), Failure> {
    let entry = ProjectEntry {
        id: project_id.to_owned(),
        slug: repository.slug.clone(),
        name: repository.name.clone(),
        root: prepared.local_path.clone(),
        repo_url: https_repository_url(&repository.url)
            .or_else(|| plan.attempts.first().map(|attempt| attempt.url.clone())),
        default_branch: repository
            .default_branch
            .clone()
            .or_else(|| default_branch_of(&prepared.local_path))
            .or_else(|| prepared.branch.clone()),
    };
    let _guard = match &context.config_guard {
        Some(guard) => Some(guard.lock().await),
        None => None,
    };
    ConfigStore::update(&context.config_path, |config| config.upsert_project(entry))
        .map(|_| ())
        .map_err(|error| {
            Failure::new(
                "setup_failed",
                internal(format!(
                    "{} is at {}, but the local Exeora configuration could not be saved: {error}. Run `exeora project add {}` to register it.",
                    repository.name,
                    prepared.local_path.display(),
                    prepared.local_path.display()
                )),
            )
        })
}

/// Clears away what a clone that was killed left beside the destination. Only
/// folders this module named, and only ones older than any clone that could
/// still be running.
fn forget_abandoned_clones(root: &Path, slug: &str, clone_timeout: Duration) {
    let prefix = format!("{slug}{TEMPORARY_MARK}");
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let abandoned = entry.file_name().to_string_lossy().starts_with(&prefix)
            && entry
                .metadata()
                .and_then(|metadata| metadata.modified())
                .ok()
                .and_then(|modified| modified.elapsed().ok())
                .is_some_and(|age| age > clone_timeout + Duration::from_secs(3600));
        if abandoned {
            let _ = std::fs::remove_dir_all(entry.path());
        }
    }
}

const REFUSED: [&str; 10] = [
    "authentication failed",
    "could not read username",
    "could not read password",
    "terminal prompts disabled",
    "invalid username or password",
    "invalid username or token",
    "http basic: access denied",
    "permission denied (publickey",
    "returned error: 401",
    "returned error: 403",
];
const NOT_FOUND: [&str; 4] = [
    "repository not found",
    "does not appear to be a git repository",
    "returned error: 404",
    "project you were looking for could not be found",
];
const UNREACHABLE: [&str; 7] = [
    "could not resolve host",
    "could not resolve hostname",
    "failed to connect to",
    "connection timed out",
    "connection refused",
    "network is unreachable",
    "operation timed out",
];

/// The line of git's output that says what went wrong, if one does.
fn telling_line<'a>(failures: &'a [String], signs: &[&str]) -> Option<&'a str> {
    failures
        .iter()
        .flat_map(|failure| failure.lines())
        .find(|line| {
            let line = line.to_lowercase();
            signs.iter().any(|sign| line.contains(sign))
                || (line.contains("repository '")
                    && line.contains("' not found")
                    && signs.contains(&NOT_FOUND[0]))
        })
}

/// Says what git's refusals mean and what to do about them.
///
/// Every way of asking failed, and they rarely fail alike. A host only says a
/// repository is not there to somebody it has let in, so that answer from
/// one way of asking says more than a refusal from another: the machine has
/// credentials, and they do not reach this repository. After that, access
/// before network, which is the order a person can do something about them.
fn explain(repository: &Repository, failures: &[String]) -> Failure {
    let address = https_repository_url(&repository.url).unwrap_or_else(|| repository.url.clone());
    let (code, sentence, line) = if let Some(line) = telling_line(failures, &NOT_FOUND) {
        (
            "repo_not_found",
            format!(
                "No repository was found at {address}. Check the address. A private repository looks the same when this machine has no access to it: connect GitHub in the Exeora dashboard, or set up git credentials here, then try again."
            ),
            Some(line),
        )
    } else if let Some(line) = telling_line(failures, &REFUSED) {
        (
            "clone_auth_failed",
            "The repository refused access from this machine. Connect GitHub in the Exeora dashboard, or set up git credentials here, then try again.".to_owned(),
            Some(line),
        )
    } else if let Some(line) = telling_line(failures, &UNREACHABLE) {
        (
            "setup_failed",
            format!(
                "This machine could not reach the host of {address}. Check its connection, then try again."
            ),
            Some(line),
        )
    } else {
        (
            "setup_failed",
            format!(
                "{} could not be cloned. Check that git works on this machine, then try again.",
                repository.name
            ),
            failures
                .iter()
                .rev()
                .flat_map(|failure| failure.lines().rev())
                .find(|line| !line.trim().is_empty()),
        )
    };
    let message = match line.map(without_secrets).filter(|line| !line.is_empty()) {
        Some(line) => format!("{sentence} Git said: {line}"),
        None => sentence,
    };
    Failure::new(code, ExeoraError::tool(message))
}

/// A line of git's output as it may be shown: bounded, and without whatever
/// was written between `://` and `@` in an address, which is where a token
/// would be if an address ever carried one.
fn without_secrets(line: &str) -> String {
    let mut clean = String::with_capacity(line.len());
    let mut rest = line.trim();
    while let Some(start) = rest.find("://") {
        let (before, after) = rest.split_at(start + 3);
        clean.push_str(before);
        let end = after
            .find(|character: char| character == '/' || character.is_whitespace())
            .unwrap_or(after.len());
        rest = match after[..end].rfind('@') {
            Some(at) => &after[at + 1..],
            None => after,
        };
    }
    clean.push_str(rest);
    clean.chars().take(MAX_GIT_WORDS).collect()
}

fn validate_slug(slug: &str) -> Result<(), ExeoraError> {
    let valid = !slug.is_empty()
        && slug.len() <= 60
        && slug
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        && slug.as_bytes()[0].is_ascii_alphanumeric();
    if valid {
        Ok(())
    } else {
        Err(invalid(
            "Project slugs use lowercase letters, digits and hyphens (max 60 characters).",
        ))
    }
}

/// The id ends up in a command a shell reads, so it is held to what an id is.
pub fn validate_project_id(project_id: &str) -> Result<(), ExeoraError> {
    let valid = !project_id.is_empty()
        && project_id.len() <= 100
        && project_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
        && project_id.as_bytes()[0].is_ascii_alphanumeric();
    if valid {
        Ok(())
    } else {
        Err(invalid("That is not the id of a project."))
    }
}

fn is_plain_ref(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 255
        && !value.starts_with('-')
        && !value.chars().any(char::is_control)
}

fn invalid(message: impl Into<String>) -> ExeoraError {
    ExeoraError::new(ErrorCode::InvalidArguments, message)
}

fn internal(message: impl Into<String>) -> ExeoraError {
    ExeoraError::new(ErrorCode::InternalError, message)
}

#[cfg(test)]
mod tests {
    use super::{
        Attempt, CLONE_TIMEOUT, CloneContext, Cloner, Credential, LocationReport, Plan, Reporter,
        Repository, explain, helper_command, keep_helper, validate_project_id, without_secrets,
    };
    use crate::{config::ConfigStore, error::ErrorCode};
    use serde_json::json;
    use std::{
        fs,
        path::{Path, PathBuf},
        process::Command,
        sync::{Arc, Mutex},
        time::Duration,
    };
    use tempfile::{TempDir, tempdir};
    use tokio_util::sync::CancellationToken;

    fn git(cwd: &Path, args: &[&str]) {
        let output = Command::new("git")
            .arg("-C")
            .arg(cwd)
            .args(args)
            .output()
            .expect("git");
        assert!(
            output.status.success(),
            "git {}: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    /// A folder as an address git can clone from, on any platform.
    fn file_address(path: &Path) -> String {
        url::Url::from_file_path(path)
            .expect("an absolute path")
            .to_string()
    }

    struct Fixture {
        temp: TempDir,
        origin: String,
        reports: Arc<Mutex<Vec<LocationReport>>>,
    }

    impl Fixture {
        /// A bare repository with one commit on `main` and a branch `release`.
        fn new() -> Self {
            let temp = tempdir().expect("temp directory");
            let seed = temp.path().join("seed");
            fs::create_dir(&seed).expect("seed");
            git(&seed, &["-c", "init.defaultBranch=main", "init", "--quiet"]);
            git(&seed, &["config", "user.email", "test@example.com"]);
            git(&seed, &["config", "user.name", "Exeora Test"]);
            fs::write(seed.join("tracked.txt"), "main\n").expect("fixture");
            git(&seed, &["add", "tracked.txt"]);
            git(&seed, &["commit", "--quiet", "-m", "initial"]);
            git(&seed, &["branch", "release"]);
            let bare = temp.path().join("origin.git");
            git(
                temp.path(),
                &[
                    "clone",
                    "--quiet",
                    "--bare",
                    &seed.to_string_lossy(),
                    &bare.to_string_lossy(),
                ],
            );
            let origin = file_address(&bare);
            Self {
                temp,
                origin,
                reports: Arc::new(Mutex::new(Vec::new())),
            }
        }

        fn root(&self) -> PathBuf {
            self.temp.path().join("projects")
        }

        fn config_path(&self) -> PathBuf {
            self.temp.path().join("config.json")
        }

        fn context(&self) -> CloneContext {
            let reports = self.reports.clone();
            let reporter: Reporter = Arc::new(move |report| {
                let reports = reports.clone();
                Box::pin(async move {
                    reports.lock().expect("reports").push(report);
                })
            });
            CloneContext {
                config_path: self.config_path(),
                projects_root: self.root(),
                helper_program: PathBuf::from("/usr/local/bin/exeora"),
                reporter: Some(reporter),
                config_guard: None,
                clone_timeout: CLONE_TIMEOUT,
            }
        }

        fn repository(&self) -> Repository {
            Repository {
                url: self.origin.clone(),
                default_branch: None,
                slug: "api".to_owned(),
                name: "API".to_owned(),
                credential: Credential::Machine,
            }
        }

        fn plan(&self) -> Plan {
            Plan {
                attempts: vec![Attempt {
                    url: self.origin.clone(),
                    helper: false,
                }],
                key: None,
            }
        }

        fn reports(&self) -> Vec<LocationReport> {
            self.reports.lock().expect("reports").clone()
        }

        fn entries(&self) -> Vec<String> {
            let Ok(entries) = fs::read_dir(self.root()) else {
                return Vec::new();
            };
            let mut names: Vec<_> = entries
                .flatten()
                .map(|entry| entry.file_name().to_string_lossy().into_owned())
                .collect();
            names.sort();
            names
        }
    }

    #[tokio::test]
    async fn clones_into_an_empty_projects_folder_and_remembers_the_project() {
        let fixture = Fixture::new();
        let prepared = Cloner::new()
            .prepare_with_plan(
                fixture.context(),
                "prj_api",
                fixture.repository(),
                fixture.plan(),
                CancellationToken::new(),
            )
            .await
            .expect("prepared");

        assert_eq!(prepared.local_path, fixture.root().join("api"));
        assert!(!prepared.adopted);
        assert_eq!(prepared.branch.as_deref(), Some("main"));
        assert!(prepared.local_path.join("tracked.txt").is_file());
        // Nothing of the temporary folder is left beside the checkout.
        assert_eq!(fixture.entries(), ["api"]);
        assert_eq!(
            fixture.reports(),
            [
                LocationReport::Cloning,
                LocationReport::Ready {
                    local_path: prepared.local_path.clone()
                }
            ]
        );

        let config = ConfigStore::load_from(fixture.config_path()).expect("config");
        let entry = config.find_project("prj_api").expect("entry");
        assert_eq!(entry.slug, "api");
        assert_eq!(entry.name, "API");
        assert_eq!(entry.root, prepared.local_path);
        assert_eq!(entry.repo_url.as_deref(), Some(fixture.origin.as_str()));
        assert_eq!(entry.default_branch.as_deref(), Some("main"));
        assert_eq!(
            prepared.to_value(),
            json!({
                "kind": "prepared",
                "localPath": prepared.local_path,
                "adopted": false,
                "branch": "main",
            })
        );
    }

    #[tokio::test]
    async fn checks_out_the_default_branch_the_project_names() {
        let fixture = Fixture::new();
        let prepared = Cloner::new()
            .prepare_with_plan(
                fixture.context(),
                "prj_api",
                Repository {
                    default_branch: Some("release".to_owned()),
                    ..fixture.repository()
                },
                fixture.plan(),
                CancellationToken::new(),
            )
            .await
            .expect("prepared");
        assert_eq!(prepared.branch.as_deref(), Some("release"));

        // A branch the remote does not have leaves the checkout where it landed.
        let other = Fixture::new();
        let prepared = Cloner::new()
            .prepare_with_plan(
                other.context(),
                "prj_api",
                Repository {
                    default_branch: Some("missing".to_owned()),
                    ..other.repository()
                },
                other.plan(),
                CancellationToken::new(),
            )
            .await
            .expect("prepared");
        assert_eq!(prepared.branch.as_deref(), Some("main"));
    }

    #[tokio::test]
    async fn adopts_a_checkout_of_the_same_origin_that_is_already_there() {
        let fixture = Fixture::new();
        fs::create_dir_all(fixture.root()).expect("projects folder");
        git(
            &fixture.root(),
            &["clone", "--quiet", &fixture.origin, "api"],
        );
        let checkout = fixture.root().join("api");
        fs::write(checkout.join("notes.txt"), "mine\n").expect("local file");

        let prepared = Cloner::new()
            .prepare_with_plan(
                fixture.context(),
                "prj_api",
                fixture.repository(),
                fixture.plan(),
                CancellationToken::new(),
            )
            .await
            .expect("prepared");

        assert!(prepared.adopted);
        assert_eq!(prepared.local_path, checkout);
        assert_eq!(
            fs::read_to_string(checkout.join("notes.txt")).expect("local file"),
            "mine\n"
        );
        // Nothing was cloned, so nothing said it was cloning.
        assert_eq!(
            fixture.reports(),
            [LocationReport::Ready {
                local_path: checkout.clone()
            }]
        );
        let config = ConfigStore::load_from(fixture.config_path()).expect("config");
        assert_eq!(
            config.find_project("prj_api").expect("entry").root,
            checkout
        );
    }

    #[tokio::test]
    async fn answers_with_the_project_the_config_already_holds() {
        let fixture = Fixture::new();
        let cloner = Cloner::new();
        let first = cloner
            .prepare_with_plan(
                fixture.context(),
                "prj_api",
                fixture.repository(),
                fixture.plan(),
                CancellationToken::new(),
            )
            .await
            .expect("prepared");
        let again = cloner
            .prepare_with_plan(
                fixture.context(),
                "prj_api",
                Repository {
                    slug: "renamed".to_owned(),
                    ..fixture.repository()
                },
                fixture.plan(),
                CancellationToken::new(),
            )
            .await
            .expect("prepared");
        assert!(again.adopted);
        assert_eq!(again.local_path, first.local_path);
        assert_eq!(fixture.entries(), ["api"]);
    }

    #[tokio::test]
    async fn refuses_a_folder_that_holds_something_else_without_touching_it() {
        let fixture = Fixture::new();
        let occupied = fixture.root().join("api");
        fs::create_dir_all(&occupied).expect("folder");
        fs::write(occupied.join("thesis.txt"), "years of work\n").expect("file");

        let error = Cloner::new()
            .prepare_with_plan(
                fixture.context(),
                "prj_api",
                fixture.repository(),
                fixture.plan(),
                CancellationToken::new(),
            )
            .await
            .expect_err("refused");

        assert_eq!(error.code, ErrorCode::ToolFailed);
        assert!(error.message.contains(&occupied.display().to_string()));
        assert!(error.message.contains("projects-root"));
        assert_eq!(
            fs::read_to_string(occupied.join("thesis.txt")).expect("file"),
            "years of work\n"
        );
        assert_eq!(fixture.entries(), ["api"]);
        assert!(matches!(
            fixture.reports().as_slice(),
            [LocationReport::Failed {
                code: "setup_failed",
                ..
            }]
        ));
        let config = ConfigStore::load_from(fixture.config_path()).expect("config");
        assert!(config.find_project("prj_api").is_none());
    }

    #[tokio::test]
    async fn refuses_a_checkout_of_another_repository() {
        let fixture = Fixture::new();
        let other = Fixture::new();
        fs::create_dir_all(fixture.root()).expect("projects folder");
        git(&fixture.root(), &["clone", "--quiet", &other.origin, "api"]);

        let error = Cloner::new()
            .prepare_with_plan(
                fixture.context(),
                "prj_api",
                fixture.repository(),
                fixture.plan(),
                CancellationToken::new(),
            )
            .await
            .expect_err("refused");
        assert_eq!(error.code, ErrorCode::ToolFailed);
        assert!(fixture.root().join("api/tracked.txt").is_file());
    }

    #[tokio::test]
    async fn a_clone_that_fails_leaves_no_folder_behind() {
        let fixture = Fixture::new();
        let missing = file_address(&fixture.temp.path().join("missing.git"));
        let error = Cloner::new()
            .prepare_with_plan(
                fixture.context(),
                "prj_api",
                fixture.repository(),
                Plan {
                    attempts: vec![Attempt {
                        url: missing,
                        helper: false,
                    }],
                    key: None,
                },
                CancellationToken::new(),
            )
            .await
            .expect_err("failed");

        assert_eq!(error.code, ErrorCode::ToolFailed);
        assert_eq!(fixture.entries(), Vec::<String>::new());
        assert!(matches!(
            fixture.reports().as_slice(),
            [
                LocationReport::Cloning,
                LocationReport::Failed {
                    code: "repo_not_found",
                    ..
                }
            ]
        ));
        let config = ConfigStore::load_from(fixture.config_path()).expect("config");
        assert!(config.find_project("prj_api").is_none());
    }

    #[tokio::test]
    async fn tries_the_next_address_when_one_fails() {
        let fixture = Fixture::new();
        let missing = file_address(&fixture.temp.path().join("missing.git"));
        let prepared = Cloner::new()
            .prepare_with_plan(
                fixture.context(),
                "prj_api",
                fixture.repository(),
                Plan {
                    attempts: vec![
                        Attempt {
                            url: missing,
                            helper: false,
                        },
                        Attempt {
                            url: fixture.origin.clone(),
                            helper: false,
                        },
                    ],
                    key: None,
                },
                CancellationToken::new(),
            )
            .await
            .expect("prepared");
        assert!(!prepared.adopted);
        assert_eq!(fixture.entries(), ["api"]);
    }

    #[tokio::test]
    async fn two_requests_at_once_make_one_clone() {
        let fixture = Fixture::new();
        let cloner = Cloner::new();
        let (first, second) = tokio::join!(
            cloner.prepare_with_plan(
                fixture.context(),
                "prj_api",
                fixture.repository(),
                fixture.plan(),
                CancellationToken::new(),
            ),
            cloner.prepare_with_plan(
                fixture.context(),
                "prj_api",
                fixture.repository(),
                fixture.plan(),
                CancellationToken::new(),
            ),
        );
        let first = first.expect("first");
        let second = second.expect("second");

        assert_eq!(first, second);
        assert!(!first.adopted, "both waited for the same clone");
        let cloning = fixture
            .reports()
            .iter()
            .filter(|report| **report == LocationReport::Cloning)
            .count();
        assert_eq!(cloning, 1);
        assert_eq!(fixture.entries(), ["api"]);
    }

    #[tokio::test]
    async fn the_clone_outlives_the_call_that_asked_for_it() {
        let fixture = Fixture::new();
        let cloner = Cloner::new();
        let cancel = CancellationToken::new();
        cancel.cancel();
        let error = cloner
            .prepare_with_plan(
                fixture.context(),
                "prj_api",
                fixture.repository(),
                fixture.plan(),
                cancel,
            )
            .await
            .expect_err("cancelled");
        assert_eq!(error.code, ErrorCode::Cancelled);

        let checkout = fixture.root().join("api");
        let finished = async {
            loop {
                let ready = fixture
                    .reports()
                    .iter()
                    .any(|report| matches!(report, LocationReport::Ready { .. }));
                if ready {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(20)).await;
            }
        };
        tokio::time::timeout(Duration::from_secs(30), finished)
            .await
            .expect("the clone finished on its own");
        assert!(checkout.join("tracked.txt").is_file());
        let config = ConfigStore::load_from(fixture.config_path()).expect("config");
        assert!(config.find_project("prj_api").is_some());
    }

    fn local_config(checkout: &Path, key: &str) -> Vec<String> {
        let output = Command::new("git")
            .arg("-C")
            .arg(checkout)
            .args(["config", "--local", "--get-all", key])
            .output()
            .expect("git");
        String::from_utf8_lossy(&output.stdout)
            .lines()
            .map(str::to_owned)
            .collect()
    }

    #[tokio::test]
    async fn leaves_the_repository_alone_when_the_machine_can_reach_the_remote() {
        let fixture = Fixture::new();
        let prepared = Cloner::new()
            .prepare_with_plan(
                fixture.context(),
                "prj_api",
                fixture.repository(),
                Plan {
                    attempts: vec![Attempt {
                        url: fixture.origin.clone(),
                        helper: true,
                    }],
                    key: None,
                },
                CancellationToken::new(),
            )
            .await
            .expect("prepared");

        let config = fs::read_to_string(prepared.local_path.join(".git/config")).expect("config");
        assert!(!config.contains("credential"), "{config}");
        assert!(!config.contains("git-credential"), "{config}");
    }

    #[tokio::test]
    async fn keeps_the_helper_in_the_repository_and_nowhere_else() {
        let temp = tempdir().expect("temp directory");
        git(temp.path(), &["init", "--quiet"]);
        let fixture = Fixture::new();
        let kept = keep_helper(
            &fixture.context(),
            "prj_api",
            "github.com",
            temp.path(),
            &[],
            &CancellationToken::new(),
        )
        .await;
        assert!(kept.is_ok());

        // The empty value first, which is what clears the machine's helpers
        // for this host in this repository.
        assert_eq!(
            local_config(temp.path(), "credential.https://github.com.helper"),
            [
                "",
                "!'/usr/local/bin/exeora' git-credential --project prj_api"
            ]
        );
        assert_eq!(
            local_config(temp.path(), "credential.useHttpPath"),
            ["true"]
        );

        // Written again, it is the same two lines and not four.
        let again = keep_helper(
            &fixture.context(),
            "prj_api",
            "github.com",
            temp.path(),
            &[],
            &CancellationToken::new(),
        )
        .await;
        assert!(again.is_ok());
        assert_eq!(
            local_config(temp.path(), "credential.https://github.com.helper").len(),
            2
        );
    }

    #[test]
    fn plans_the_helper_first_only_when_exeora_has_a_credential() {
        let repository = |credential| Repository {
            url: "git@github.com:Acme/API.git".to_owned(),
            default_branch: None,
            slug: "api".to_owned(),
            name: "API".to_owned(),
            credential,
        };
        let plan = Plan::for_repository(&repository(Credential::Exeora)).expect("plan");
        assert_eq!(
            plan.attempts,
            [
                Attempt {
                    url: "https://github.com/Acme/API.git".to_owned(),
                    helper: true
                },
                Attempt {
                    url: "https://github.com/Acme/API.git".to_owned(),
                    helper: false
                },
                Attempt {
                    url: "git@github.com:Acme/API.git".to_owned(),
                    helper: false
                },
            ]
        );
        assert!(plan.is_origin("ssh://git@github.com/acme/api"));
        assert!(!plan.is_origin("https://github.com/acme/api-docs"));
        assert!(!plan.is_origin("/home/me/code/api"));

        let plan = Plan::for_repository(&repository(Credential::Machine)).expect("plan");
        assert!(plan.attempts.iter().all(|attempt| !attempt.helper));
        assert_eq!(plan.attempts.len(), 2);

        let error = Plan::for_repository(&Repository {
            url: "file:///srv/api.git".to_owned(),
            ..repository(Credential::Machine)
        })
        .expect_err("not a repository on a host");
        assert_eq!(error.code, ErrorCode::InvalidArguments);
    }

    #[test]
    fn reads_a_repository_as_strictly_as_the_schema() {
        let repository = Repository::from_value(&json!({
            "url": "https://github.com/acme/api.git",
            "defaultBranch": "main",
            "slug": "api",
            "name": "API",
            "credential": "exeora",
        }))
        .expect("repository");
        assert_eq!(repository.credential, Credential::Exeora);
        assert_eq!(repository.default_branch.as_deref(), Some("main"));

        let repository = Repository::from_value(&json!({
            "url": "https://github.com/acme/api.git", "slug": "api", "name": "API",
        }))
        .expect("repository");
        assert_eq!(repository.credential, Credential::Machine);

        for bad in [
            json!({ "slug": "api", "name": "API" }),
            json!({ "url": "https://github.com/acme/api.git", "slug": "../api", "name": "API" }),
            json!({ "url": "https://github.com/acme/api.git", "slug": "Api", "name": "API" }),
            json!({ "url": "https://github.com/acme/api.git", "slug": "api", "name": 7 }),
            json!({ "url": "https://github.com/acme/api.git", "slug": "api", "name": "API", "credential": "root" }),
        ] {
            let error = Repository::from_value(&bad).expect_err("refused");
            assert_eq!(error.code, ErrorCode::InvalidArguments, "{bad}");
        }
    }

    #[test]
    fn quotes_the_helper_for_the_shell_git_hands_it_to() {
        assert_eq!(
            helper_command(Path::new("/opt/my tools/exeora"), "prj_1"),
            "!'/opt/my tools/exeora' git-credential --project prj_1"
        );
        assert_eq!(
            helper_command(Path::new("/opt/it's/exeora"), "prj_1"),
            "!'/opt/it'\\''s/exeora' git-credential --project prj_1"
        );
        assert!(validate_project_id("prj_0aZ-9").is_ok());
        for bad in ["", "prj 1", "prj;rm", "$(id)", "-prj"] {
            assert!(validate_project_id(bad).is_err(), "{bad:?}");
        }
    }

    #[test]
    fn explains_what_git_refused_and_what_to_do() {
        let repository = Repository {
            url: "https://github.com/acme/api".to_owned(),
            default_branch: None,
            slug: "api".to_owned(),
            name: "API".to_owned(),
            credential: Credential::Machine,
        };
        let refused = explain(
            &repository,
            &[
                "Cloning into 'api'...\nfatal: could not read Username for 'https://github.com': terminal prompts disabled\n".to_owned(),
                "git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.\n".to_owned(),
            ],
        );
        assert_eq!(refused.code, "clone_auth_failed");
        assert!(refused.error.message.starts_with(
            "The repository refused access from this machine. Connect GitHub in the Exeora dashboard, or set up git credentials here, then try again."
        ));

        // The machine was let in over https and the key was refused over
        // ssh: what the host said to the one it let in is the answer.
        let missing = explain(
            &repository,
            &[
                "remote: Repository not found.\nfatal: repository 'https://github.com/acme/api.git/' not found\n".to_owned(),
                "git@github.com: Permission denied (publickey).\nfatal: Could not read from remote repository.\n".to_owned(),
            ],
        );
        assert_eq!(missing.code, "repo_not_found");
        assert!(
            missing
                .error
                .message
                .contains("No repository was found at https://github.com/acme/api.git.")
        );
        assert!(missing.error.message.contains("private repository"));
        assert!(
            missing
                .error
                .message
                .ends_with("Git said: remote: Repository not found.")
        );

        let offline = explain(
            &repository,
            &["fatal: unable to access 'https://github.com/acme/api.git/': Could not resolve host: github.com\n".to_owned()],
        );
        assert_eq!(offline.code, "setup_failed");
        assert!(offline.error.message.contains("could not reach"));

        let unknown = explain(&repository, &["fatal: something new\n".to_owned()]);
        assert!(
            unknown
                .error
                .message
                .ends_with("Git said: fatal: something new")
        );
    }

    #[test]
    fn never_repeats_what_an_address_carried_before_the_host() {
        assert_eq!(
            without_secrets(
                "fatal: Authentication failed for 'https://x-access-token:ghs_secret@github.com/acme/api.git/'"
            ),
            "fatal: Authentication failed for 'https://github.com/acme/api.git/'"
        );
        assert_eq!(
            without_secrets("fatal: unable to access 'https://github.com/acme/api.git/'"),
            "fatal: unable to access 'https://github.com/acme/api.git/'"
        );
        assert_eq!(
            without_secrets("ssh://git@host/a and https://u:p@other/b"),
            "ssh://host/a and https://other/b"
        );
    }
}
