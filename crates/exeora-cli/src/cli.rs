use crate::{
    CLI_VERSION,
    api::{ApiClient, DeviceView, ProjectRegistration, ProjectView, ToolCallView, WorkspaceView},
    auth::{
        AuthManager, clear_credentials, discover_client, load_credentials, using_file_fallback,
    },
    cloud::commands::{confirm, done, finish, wait_ready},
    config::{ConfigStore, DEFAULT_GATEWAY, ProjectEntry, WorkspaceEntry, WorkspaceSyncState},
    connection::connect_forever,
    git_credential::GitCredentialArgs,
    policy::{LocalCommandPolicy, POLICY_FILENAME, PolicyMode, render_policy_toml},
    projects::{
        self, Listing, ProjectCommand, can_ask, find_location, location_names, offline_notice,
    },
    repo::{checkout_root, default_branch_of, https_repository_url, origin_of, repository_key},
    workspaces,
};
use anyhow::{Context, Result, anyhow, bail};
use clap::{ArgAction, Args, Parser, Subcommand};
use serde_json::{Value, json};
use std::{
    env, fs,
    path::{Path, PathBuf},
    sync::Arc,
};
use url::Url;

#[derive(Debug, Parser)]
#[command(name = "exeora", version = CLI_VERSION, disable_version_flag = true, arg_required_else_help = true, about = "Connect AI agents to the development environment on this machine, wherever it runs.")]
pub struct Cli {
    #[arg(short = 'v', long = "version", action = ArgAction::Version, help = "Print version")]
    version: Option<bool>,
    #[arg(
        long,
        global = true,
        help = "Print machine-readable output instead of drawing on the terminal"
    )]
    pub json: bool,
    #[command(subcommand)]
    pub command: Commands,
}

#[derive(Debug, Subcommand)]
pub enum Commands {
    #[command(about = "Sign in to Exeora")]
    Login(GatewayChoice),
    #[command(about = "Forget the stored session on this machine")]
    Logout,
    #[command(about = "Show or change the Exeora this machine talks to")]
    Gateway {
        #[command(subcommand)]
        command: Option<GatewayCommand>,
    },
    #[command(
        visible_alias = "machine",
        about = "Manage your machines, this one and the ones Exeora Cloud runs"
    )]
    Device {
        #[command(subcommand)]
        command: DeviceCommand,
    },
    #[command(about = "Manage projects and the places they live")]
    Project {
        #[command(subcommand)]
        command: ProjectCommand,
    },
    #[command(about = "Manage the Git workspaces of your projects, wherever they are")]
    Workspace {
        #[command(subcommand)]
        command: WorkspaceCommand,
    },
    #[command(about = "Show or change local Exeora settings")]
    Config {
        #[command(subcommand)]
        command: ConfigCommand,
    },
    #[command(
        about = "Sign in, register this machine if needed, and keep it awake to serve registered projects"
    )]
    Connect(ConnectArgs),
    #[command(about = "Show this machine's registration and projects")]
    Status,
    #[command(about = "Show recent tool calls: what ran, who asked and how it ended")]
    Logs(LogsArgs),
    #[command(about = "Write an exeora.toml restricting what agents may do in a directory")]
    Init(InitArgs),
    #[command(
        about = "Print the Exeora coding-agent prompt, for a client that cannot fetch it itself"
    )]
    Prompt {
        #[arg(short, long)]
        account: bool,
    },
    #[command(about = "Reconcile this machine's registration and projects with the dashboard")]
    Sync,
    #[command(about = "Upgrade this native installation to the latest Exeora CLI")]
    Upgrade,
    // Kept so scripts written for 0.17.0 go on working. Everything it does
    // is now said with `project` and `workspace` and `--on cloud`.
    #[command(
        hide = true,
        about = "Manage Exeora Cloud: repositories on machines Exeora runs for you"
    )]
    Cloud {
        #[command(subcommand)]
        command: crate::cloud::commands::CloudCommand,
    },
    // Run by git, not by a person: see `git_credential.rs`.
    #[command(
        name = "git-credential",
        hide = true,
        about = "Answer git with a short-lived credential for a project's repository"
    )]
    GitCredential(GitCredentialArgs),
}

#[derive(Debug, Args)]
pub struct GatewayChoice {
    #[arg(
        short = 'g',
        long,
        help = "Sign in to this Exeora instead, and remember it"
    )]
    gateway: Option<String>,
    #[arg(short = 'y', long, help = "Do not ask before switching gateway")]
    yes: bool,
    #[arg(
        long,
        help = "Sign in with a code shown in the terminal, for machines without a browser"
    )]
    code: bool,
}

#[derive(Debug, Subcommand)]
pub enum GatewayCommand {
    #[command(about = "Talk to a different Exeora, forgetting what belongs to this one")]
    Use {
        url: String,
        #[arg(short = 'y', long)]
        yes: bool,
        #[arg(long)]
        force: bool,
    },
    #[command(about = "Go back to https://exeora.dev")]
    Reset {
        #[arg(short = 'y', long)]
        yes: bool,
        #[arg(long)]
        force: bool,
    },
}

#[derive(Debug, Subcommand)]
pub enum DeviceCommand {
    #[command(about = "Register this machine so it can serve tool calls")]
    Register {
        #[arg(short, long)]
        name: Option<String>,
    },
    #[command(about = "List your machines and the ones Exeora Cloud runs for you")]
    List,
}

#[derive(Debug, Subcommand)]
pub enum WorkspaceCommand {
    #[command(
        about = "Create a Git workspace of a project, on this machine or wherever --on says",
        long_about = "Create a Git workspace of a project.\n\nWithout --on, or with --on naming this machine, the workspace is a Git worktree here; a project this machine is a location of and holds no copy of yet is cloned first. With --on naming another location the workspace is made there: a worktree on that machine, or a machine of its own on Exeora Cloud."
    )]
    Create {
        branch: String,
        #[arg(long = "from")]
        from_ref: Option<String>,
        #[arg(long)]
        #[arg(conflicts_with = "from_ref")]
        reuse_existing_branch: bool,
        #[arg(short, long)]
        project: Option<String>,
        #[arg(
            long = "on",
            value_name = "MACHINE|cloud",
            help = "The location to create it in; this machine by default"
        )]
        on: Option<String>,
        #[arg(short, long)]
        name: Option<String>,
        #[arg(short, long)]
        slug: Option<String>,
        #[arg(long, conflicts_with = "on")]
        path: Option<PathBuf>,
    },
    #[command(about = "Connect an existing Git workspace to an Exeora project")]
    Attach {
        path: PathBuf,
        #[arg(short, long)]
        project: Option<String>,
        #[arg(short, long)]
        name: Option<String>,
        #[arg(short, long)]
        slug: Option<String>,
    },
    #[command(about = "List the workspaces of your projects and where each one lives")]
    List {
        #[arg(short, long, conflicts_with = "all")]
        project: Option<String>,
        #[arg(
            long,
            help = "Every project, not only the one of the current directory"
        )]
        all: bool,
    },
    #[command(about = "Disconnect a workspace from Exeora without deleting it")]
    Detach { selector: String },
    #[command(
        about = "Disconnect and remove a Git workspace, or take down its machine on Exeora Cloud"
    )]
    Remove {
        selector: String,
        #[arg(
            short,
            long,
            help = "The project, when several have a workspace by that name"
        )]
        project: Option<String>,
        #[arg(long)]
        force: bool,
        #[arg(long)]
        delete_branch: bool,
        #[arg(
            short = 'y',
            long,
            help = "Do not ask before taking down a machine on Exeora Cloud"
        )]
        yes: bool,
    },
}

#[derive(Debug, Subcommand)]
pub enum ConfigCommand {
    Get { key: String },
    Set { key: String, value: PathBuf },
    Unset { key: String },
}

#[derive(Debug, Args)]
pub struct ConnectArgs {
    #[arg(short, long)]
    name: Option<String>,
    #[arg(long)]
    reset: bool,
    #[arg(short = 'g', long)]
    gateway: Option<String>,
    #[arg(short = 'y', long)]
    yes: bool,
    #[arg(
        long,
        help = "Sign in with a code shown in the terminal, for machines without a browser"
    )]
    code: bool,
    #[arg(
        long,
        conflicts_with_all = ["name", "reset", "gateway", "yes", "code"],
        help = "Run as the service inside an Exeora Cloud machine, with the token and config it was set up with"
    )]
    cloud: bool,
}

#[derive(Debug, Args)]
pub struct LogsArgs {
    #[arg(short = 'n', long, default_value_t = 30)]
    limit: usize,
    #[arg(short, long)]
    project: Option<String>,
    #[arg(short, long)]
    workspace: Option<String>,
    #[arg(short, long)]
    client: Option<String>,
    #[arg(long)]
    failed: bool,
}

#[derive(Debug, Args)]
pub struct InitArgs {
    path: Option<PathBuf>,
    #[arg(short, long)]
    mode: Option<String>,
    #[arg(short, long)]
    allow: Option<String>,
    #[arg(short, long)]
    deny: Option<String>,
    #[arg(short, long)]
    tools: Option<String>,
    #[arg(short = 'y', long)]
    yes: bool,
    #[arg(short, long)]
    force: bool,
}

pub async fn run(cli: Cli) -> Result<()> {
    if matches!(&cli.command, Commands::Upgrade) {
        return crate::upgrade::run(cli.json).await;
    }
    // Before anything that could fail: git runs this one, and a helper that
    // exits with an error gets in the way of the helpers after it.
    if let Commands::GitCredential(args) = cli.command {
        crate::git_credential::run(args).await;
        return Ok(());
    }
    let mut config = ConfigStore::load()?;
    // A cloud machine has no session, no browser and no registration to do:
    // it reads what the bootstrap wrote and dials the relay.
    if let Commands::Connect(args) = &cli.command
        && (args.cloud || crate::cloud::enabled_by_env())
    {
        return crate::cloud::connect(config, cli.json).await;
    }
    if let Commands::Config { command } = &cli.command {
        return config_command(&mut config, command, cli.json);
    }
    if let Commands::Gateway { command } = &cli.command {
        return gateway_command(&mut config, command, cli.json).await;
    }
    if let Commands::Prompt { account } = cli.command {
        return prompt_command(account, cli.json);
    }
    if let Commands::Init(args) = cli.command {
        return init_command(args, cli.json);
    }

    let mut choice = None;
    match &cli.command {
        Commands::Login(value) => {
            choice = value.gateway.clone().map(|gateway| (gateway, value.yes))
        }
        Commands::Connect(value) => {
            choice = value.gateway.clone().map(|gateway| (gateway, value.yes))
        }
        _ => {}
    }
    if let Some((gateway, yes)) = choice
        && !switch_gateway(&mut config, &gateway, yes, false, cli.json).await?
    {
        return Ok(());
    }

    let http = reqwest::Client::builder()
        .user_agent(format!("exeora/{CLI_VERSION}"))
        .build()?;
    let gateway = config.gateway_url();
    let auth = Arc::new(AuthManager::new(gateway.clone(), http.clone()));
    let api = ApiClient::new(&gateway, http, auth.clone())?;

    match cli.command {
        Commands::Login(args) => login_command(&api, auth, &config, args.code).await,
        Commands::Logout => {
            clear_credentials()?;
            auth.forget_access_token().await;
            println!(
                "Signed out of {}. The device is still registered; revoke it in the dashboard.",
                config.gateway_url()
            );
            Ok(())
        }
        Commands::Device { command } => device_command(&mut config, &api, command, cli.json).await,
        Commands::Project { command } => projects::run(&mut config, &api, command, cli.json).await,
        Commands::Workspace { command } => {
            workspace_command(&mut config, &api, command, cli.json).await
        }
        Commands::Connect(args) => connect_command(&mut config, &api, auth, args, cli.json).await,
        Commands::Cloud { command } => crate::cloud::commands::run(&api, command, cli.json).await,
        Commands::Status => status_command(&config, &api, cli.json).await,
        Commands::Logs(args) => logs_command(&api, args, cli.json).await,
        Commands::Sync => sync_command(&mut config, &api).await,
        Commands::Gateway { .. }
        | Commands::Config { .. }
        | Commands::Prompt { .. }
        | Commands::Init(_)
        | Commands::GitCredential(_)
        | Commands::Upgrade => unreachable!(),
    }
}

/// A folder this machine keeps things in, which is every setting there is.
#[derive(Clone, Copy)]
enum Setting {
    WorkspaceRoot,
    ProjectsRoot,
}

impl Setting {
    const NAMES: &str = "workspace-root, projects-root";

    fn named(key: &str) -> Result<Self> {
        match key {
            "workspace-root" => Ok(Self::WorkspaceRoot),
            "projects-root" => Ok(Self::ProjectsRoot),
            _ => bail!("Unknown setting {key}. Available settings: {}", Self::NAMES),
        }
    }

    fn value(self, config: &ConfigStore) -> Result<PathBuf> {
        match self {
            Self::WorkspaceRoot => config.workspace_root(),
            Self::ProjectsRoot => config.projects_root(),
        }
    }

    fn source(self, config: &ConfigStore) -> &'static str {
        match self {
            Self::WorkspaceRoot => config.workspace_root_source(),
            Self::ProjectsRoot => config.projects_root_source(),
        }
    }

    fn store(self, config: &mut ConfigStore, value: Option<PathBuf>) {
        match self {
            Self::WorkspaceRoot => config.data_mut().workspace_root = value,
            Self::ProjectsRoot => config.data_mut().projects_root = value,
        }
    }
}

fn config_command(
    config: &mut ConfigStore,
    command: &ConfigCommand,
    json_output: bool,
) -> Result<()> {
    match command {
        ConfigCommand::Get { key } => {
            let setting = Setting::named(key)?;
            let value = setting.value(config)?;
            if json_output {
                emit(json!({ "key": key, "value": value, "source": setting.source(config) }))
            } else {
                println!("{}", value.display());
                Ok(())
            }
        }
        ConfigCommand::Set { key, value } => {
            let setting = Setting::named(key)?;
            let value = if value.is_absolute() {
                value.clone()
            } else {
                env::current_dir()?.join(value)
            };
            setting.store(config, Some(value.clone()));
            config.save()?;
            if json_output {
                emit(json!({ "key": key, "value": value }))
            } else {
                println!("Set {key} to {}.", value.display());
                Ok(())
            }
        }
        ConfigCommand::Unset { key } => {
            let setting = Setting::named(key)?;
            setting.store(config, None);
            config.save()?;
            if json_output {
                emit(
                    json!({ "key": key, "value": setting.value(config)?, "source": setting.source(config) }),
                )
            } else {
                println!("Unset {key}.");
                Ok(())
            }
        }
    }
}

async fn workspace_command(
    config: &mut ConfigStore,
    api: &ApiClient,
    command: WorkspaceCommand,
    json_output: bool,
) -> Result<()> {
    match command {
        WorkspaceCommand::Create {
            branch,
            from_ref,
            reuse_existing_branch,
            project,
            on,
            name,
            slug,
            path,
        } => {
            if let Some(on) = on.as_deref()
                && let Some((remote, place)) =
                    another_location(config, api, project.as_deref(), on).await?
            {
                return create_workspace_elsewhere(
                    api,
                    &remote,
                    &place,
                    json!({
                        "branch": branch,
                        "from": from_ref,
                        "reuseExistingBranch": reuse_existing_branch,
                        "name": name,
                        "slug": slug,
                    }),
                    json_output,
                )
                .await;
            }
            let project =
                projects::local_project(config, api, project.as_deref(), json_output).await?;
            let entry = workspaces::create(
                config,
                &project,
                workspaces::CreateWorkspace {
                    branch,
                    from: from_ref,
                    reuse_existing_branch,
                    name,
                    slug,
                    path,
                    source: None,
                },
            )?;
            persist_workspace(config, api, entry, json_output).await
        }
        WorkspaceCommand::Attach {
            path,
            project,
            name,
            slug,
        } => {
            let project = workspaces::resolve_project(config, project.as_deref())?;
            let entry = workspaces::attach(config, &project, &path, name, slug)?;
            persist_workspace(config, api, entry, json_output).await
        }
        WorkspaceCommand::List { project, all } => {
            list_workspaces(config, api, project.as_deref(), all, json_output).await
        }
        WorkspaceCommand::Detach { selector } => {
            let outcome =
                workspaces::detach(config, api, find_workspace(config, &selector, None)?).await?;
            if json_output {
                emit(json!({
                    "workspace": outcome.entry,
                    "outcome": outcome.outcome
                }))
            } else {
                println!(
                    "Detached {}.{}",
                    outcome.entry.slug,
                    if outcome.outcome == "detached" {
                        " The Git workspace was not changed."
                    } else {
                        " Gateway deletion is pending; run `exeora sync`."
                    }
                );
                Ok(())
            }
        }
        WorkspaceCommand::Remove {
            selector,
            project,
            force,
            delete_branch,
            yes,
        } => {
            let entry = match find_workspace(config, &selector, project.as_deref()) {
                Ok(entry) => entry,
                // Not on this machine. It may be one Exeora Cloud runs.
                Err(missing) => {
                    return remove_workspace_elsewhere(
                        api,
                        &selector,
                        project.as_deref(),
                        yes,
                        json_output,
                        missing,
                    )
                    .await;
                }
            };
            let project = config
                .data()
                .projects
                .iter()
                .find(|project| project.id == entry.project_id)
                .cloned()
                .context("The parent project is no longer registered")?;
            let outcome =
                workspaces::remove(config, api, &project, entry, force, delete_branch).await?;
            if json_output {
                emit(json!({
                    "workspace": outcome.entry,
                    "outcome": outcome.outcome,
                    "branchDeleted": outcome.branch_deleted
                }))
            } else {
                println!(
                    "Removed {}.{}",
                    outcome.entry.slug,
                    if outcome.outcome == "removed" {
                        ""
                    } else {
                        " Gateway deletion is pending; run `exeora sync`."
                    }
                );
                Ok(())
            }
        }
    }
}

async fn persist_workspace(
    config: &mut ConfigStore,
    api: &ApiClient,
    entry: WorkspaceEntry,
    json_output: bool,
) -> Result<()> {
    let outcome = workspaces::persist(config, api, entry).await?;
    if json_output {
        let mut value = json!({
            "workspace": outcome.entry,
            "outcome": outcome.outcome
        });
        if let Some(problem) = &outcome.problem {
            value["problem"] = json!(problem);
        }
        emit(value)
    } else {
        println!(
            "Connected {} at {}.{}",
            outcome.entry.slug,
            outcome.entry.root.display(),
            match (&outcome.problem, outcome.outcome) {
                (Some(problem), _) => format!(" The gateway did not take it. {problem}"),
                (None, "active") => String::new(),
                (None, _) => " Gateway sync is pending; run `exeora sync`.".to_owned(),
            }
        );
        Ok(())
    }
}

fn find_workspace(
    config: &ConfigStore,
    selector: &str,
    project: Option<&str>,
) -> Result<WorkspaceEntry> {
    if let Some(entry) = config
        .data()
        .workspaces
        .iter()
        .find(|entry| entry.id == selector)
    {
        return Ok(entry.clone());
    }
    let project_id = project.and_then(|project| {
        config
            .data()
            .projects
            .iter()
            .find(|entry| entry.id == project || entry.slug.eq_ignore_ascii_case(project))
            .map(|entry| entry.id.as_str())
    });
    let matches: Vec<_> = config
        .data()
        .workspaces
        .iter()
        .filter(|entry| entry.slug.eq_ignore_ascii_case(selector))
        .filter(|entry| project.is_none() || project_id == Some(entry.project_id.as_str()))
        .cloned()
        .collect();
    match matches.as_slice() {
        [] => Err(anyhow!("No workspace called {selector} on this machine.")),
        [entry] => Ok(entry.clone()),
        _ => bail!(
            "Several projects have a workspace called {selector}. Pass --project, or use its ID from `exeora workspace list --all`."
        ),
    }
}

/// The project and the location `--on` names, when that is somewhere other
/// than this machine. None when it is this machine after all, by whichever
/// of its names.
async fn another_location(
    config: &ConfigStore,
    api: &ApiClient,
    project: Option<&str>,
    on: &str,
) -> Result<Option<(ProjectView, String)>> {
    if projects::names_this_machine(config, on) {
        return Ok(None);
    }
    let selector = match project {
        Some(project) => project.to_owned(),
        None => workspaces::resolve_project(config, None)?.id,
    };
    let remote = projects::find_project(api, &selector).await?;
    let place = match find_location(config, &remote.locations, on) {
        Some(location)
            if location.device_id.is_some() && location.device_id == config.data().device_id =>
        {
            return Ok(None);
        }
        Some(location) => location.slug.clone(),
        // Every project with a repository can be put on Exeora Cloud, and
        // asking for a workspace there is what puts it.
        None if on.trim().eq_ignore_ascii_case("cloud") => "cloud".to_owned(),
        None => bail!(
            "{} does not live on {on}. Its locations are: {}. Add one with `exeora project locations add {} --on {on}`.",
            remote.slug,
            location_names(&remote.locations),
            remote.slug
        ),
    };
    Ok(Some((remote, place)))
}

/// Asks the gateway for a workspace in another location: a worktree on that
/// machine, which answers when it is made, or a machine of its own on Exeora
/// Cloud, which is waited for.
async fn create_workspace_elsewhere(
    api: &ApiClient,
    project: &ProjectView,
    place: &str,
    mut body: Value,
    json_output: bool,
) -> Result<()> {
    if let Some(fields) = body.as_object_mut() {
        fields.retain(|_, value| !value.is_null() && *value != json!(false));
        fields.insert("where".to_owned(), json!(place));
    }
    let answer = api.create_workspace_at(&project.id, body).await?;
    let text = |pointer: &str| answer.pointer(pointer).and_then(Value::as_str);
    if text("/status") == Some("creating") {
        let device_id =
            text("/deviceId").context("The gateway did not say which machine it is making")?;
        let slug = text("/slug").unwrap_or("workspace").to_owned();
        if !json_output {
            println!("Creating {}/{slug} on a new machine…", project.slug);
        }
        let machine = wait_ready(api, device_id, json_output).await?;
        return finish(json_output, "workspace", &slug, &machine);
    }
    if json_output {
        return emit(answer);
    }
    println!(
        "Created {} on {} at {}.",
        text("/workspace/slug").unwrap_or("the workspace"),
        text("/where").unwrap_or(place),
        text("/workspace/localPath").unwrap_or("its workspace folder")
    );
    Ok(())
}

/// The projects a listing is about: the one named, every one, or the one the
/// current directory is in. Every one too when the directory is in none.
fn listed_projects<'a>(
    config: &ConfigStore,
    remote: &'a [ProjectView],
    project: Option<&str>,
    all: bool,
) -> Result<Vec<&'a ProjectView>> {
    if let Some(selector) = project {
        let found = remote
            .iter()
            .find(|entry| entry.id == selector || entry.slug.eq_ignore_ascii_case(selector))
            .ok_or_else(|| anyhow!("No project called {selector}. See `exeora project list`."))?;
        return Ok(vec![found]);
    }
    if !all
        && let Ok(local) = workspaces::resolve_project(config, None)
        && let Some(found) = remote.iter().find(|entry| entry.id == local.id)
    {
        return Ok(vec![found]);
    }
    Ok(remote.iter().collect())
}

fn workspace_place(config: &ConfigStore, workspace: &WorkspaceView) -> String {
    let here = workspace.device_id.is_some() && workspace.device_id == config.data().device_id;
    let name = if workspace.cloud {
        "Exeora Cloud".to_owned()
    } else {
        workspace
            .machine
            .clone()
            .unwrap_or_else(|| "unknown machine".to_owned())
    };
    if here {
        format!("{name} (this machine)")
    } else {
        name
    }
}

fn sync_mark(state: Option<WorkspaceSyncState>) -> String {
    match state {
        None | Some(WorkspaceSyncState::Active) => String::new(),
        Some(state) => format!("  [{}]", format!("{state:?}").to_lowercase()),
    }
}

/// The workspaces in the local config, in the shape the gateway lists them
/// as far as this machine can fill it in: they are all here, and when the
/// gateway first heard of them is not something this machine was told.
fn local_workspace_listing(
    config: &ConfigStore,
    project: Option<&str>,
    all: bool,
    notice: String,
) -> Result<Listing> {
    let data = config.data();
    let only = match project {
        Some(selector) => Some(workspaces::resolve_project(config, Some(selector))?.id),
        None if all => None,
        None => workspaces::resolve_project(config, None)
            .ok()
            .map(|project| project.id),
    };
    let machine = data
        .device_name
        .clone()
        .unwrap_or_else(|| "this machine".to_owned());
    let mut items = Vec::new();
    let mut lines = Vec::new();
    for entry in data
        .workspaces
        .iter()
        .filter(|entry| only.as_ref().is_none_or(|id| &entry.project_id == id))
    {
        let project_slug = config
            .find_project(&entry.project_id)
            .map_or("removed", |project| project.slug.as_str());
        items.push(json!({
            "id": entry.id,
            "projectId": entry.project_id,
            "slug": entry.slug,
            "name": entry.name,
            "branch": entry.branch,
            "localPath": entry.root,
            "managed": entry.managed,
            "deviceId": data.device_id,
            "cloud": false,
            "machine": machine,
            "projectSlug": project_slug,
            "thisMachine": true,
            "syncState": entry.sync_state,
            "offline": true,
        }));
        lines.push(format!(
            "{:<24} {:<18} {:<32} {}{}",
            entry.slug,
            project_slug,
            format!("{machine} (this machine)"),
            entry.branch.as_deref().unwrap_or("-"),
            sync_mark(Some(entry.sync_state))
        ));
    }
    if items.is_empty() {
        lines.push("No workspaces on this machine.".to_owned());
    }
    Ok(Listing {
        items,
        lines,
        notice: Some(notice),
    })
}

async fn list_workspaces(
    config: &ConfigStore,
    api: &ApiClient,
    project: Option<&str>,
    all: bool,
    json_output: bool,
) -> Result<()> {
    workspace_listing(config, api, project, all)
        .await?
        .print(json_output)
}

/// The workspaces of the account, from the gateway, or those of this machine
/// when the gateway cannot be reached. A refusal is returned as the error it
/// is, and so is a gateway that answers for the projects and then fails for
/// one of them with anything but silence.
async fn workspace_listing(
    config: &ConfigStore,
    api: &ApiClient,
    project: Option<&str>,
    all: bool,
) -> Result<Listing> {
    match remote_workspace_listing(config, api, project, all).await {
        Err(error) if crate::api::is_unreachable(&error) => {
            local_workspace_listing(config, project, all, offline_notice(&error))
        }
        listing => listing,
    }
}

async fn remote_workspace_listing(
    config: &ConfigStore,
    api: &ApiClient,
    project: Option<&str>,
    all: bool,
) -> Result<Listing> {
    let remote = api.list_projects().await?;
    let mut rows = Vec::new();
    let mut lines = Vec::new();
    for project in listed_projects(config, &remote, project, all)? {
        let known = api.list_workspaces(&project.id).await?;
        // What this machine made and the gateway has not heard of yet.
        let unsent: Vec<_> = config
            .data()
            .workspaces
            .iter()
            .filter(|entry| entry.project_id == project.id)
            .filter(|entry| known.iter().all(|workspace| workspace.id != entry.id))
            .map(|entry| WorkspaceView {
                id: entry.id.clone(),
                project_id: entry.project_id.clone(),
                slug: entry.slug.clone(),
                name: entry.name.clone(),
                branch: entry.branch.clone(),
                local_path: entry.root.to_string_lossy().into_owned(),
                managed: entry.managed,
                device_id: config.data().device_id.clone(),
                machine: config.data().device_name.clone(),
                cloud: false,
                created_at: 0,
                updated_at: 0,
            })
            .collect();
        for workspace in known.into_iter().chain(unsent) {
            let here =
                workspace.device_id.is_some() && workspace.device_id == config.data().device_id;
            let state = config
                .data()
                .workspaces
                .iter()
                .find(|entry| entry.id == workspace.id)
                .map(|entry| entry.sync_state);
            let mut row = serde_json::to_value(&workspace)?;
            row["projectSlug"] = json!(project.slug);
            row["thisMachine"] = json!(here);
            row["syncState"] = json!(state);
            rows.push(row);
            lines.push(format!(
                "{:<24} {:<18} {:<32} {}{}",
                workspace.slug,
                project.slug,
                workspace_place(config, &workspace),
                workspace.branch.as_deref().unwrap_or("-"),
                sync_mark(state)
            ));
        }
    }
    if lines.is_empty() {
        lines.push("No workspaces. Create one with `exeora workspace create <branch>`.".to_owned());
    }
    Ok(Listing {
        items: rows,
        lines,
        notice: None,
    })
}

/// Removes a workspace this machine does not hold. One that is a machine on
/// Exeora Cloud is taken down through the gateway; one on another machine of
/// the person is removed there, where its files are.
async fn remove_workspace_elsewhere(
    api: &ApiClient,
    selector: &str,
    project: Option<&str>,
    yes: bool,
    json_output: bool,
    missing: anyhow::Error,
) -> Result<()> {
    // The workspace is not on this machine, and only the gateway knows
    // where else it could be. When it cannot be asked, that is what is said:
    // a request that failed is not an answer that there is no such workspace.
    let remote = api.list_projects().await.map_err(|error| {
        anyhow!("{missing} Whether it lives somewhere else could not be looked up: {error}")
    })?;
    let mut found = Vec::new();
    for entry in remote.iter().filter(|entry| {
        project
            .is_none_or(|project| entry.id == project || entry.slug.eq_ignore_ascii_case(project))
    }) {
        for workspace in api.list_workspaces(&entry.id).await? {
            if workspace.id == selector || workspace.slug.eq_ignore_ascii_case(selector) {
                found.push((entry, workspace));
            }
        }
    }
    let (project, workspace) = match found.as_slice() {
        [] => return Err(missing),
        [one] => one,
        _ => bail!(
            "Several projects have a workspace called {selector}. Pass --project, or use its ID from `exeora workspace list --all`."
        ),
    };
    if !workspace.cloud {
        bail!(
            "{} lives on {}. Run `exeora workspace remove {}` there, where its files are.",
            workspace.slug,
            workspace.machine.as_deref().unwrap_or("another machine"),
            workspace.slug
        );
    }
    if !confirm(
        yes,
        json_output,
        &format!(
            "Remove {}/{} and its machine? Anything not pushed from it is lost.",
            project.slug, workspace.slug
        ),
    )? {
        return Ok(());
    }
    api.cloud_remove_workspace(&project.id, &workspace.id)
        .await?;
    done(
        json_output,
        json!({ "removed": "workspace", "slug": workspace.slug }),
    )
}

async fn sign_in(auth: &AuthManager, code: bool) -> Result<crate::auth::LoginResult> {
    if code {
        auth.login_code().await
    } else {
        auth.login_browser().await
    }
}

async fn login_command(
    api: &ApiClient,
    auth: Arc<AuthManager>,
    config: &ConfigStore,
    code: bool,
) -> Result<()> {
    cliclack::intro("Exeora")?;
    let _ = sign_in(auth.as_ref(), code).await?;
    let user = api.me().await?;
    cliclack::log::success(format!("Signed in as {}", user.email))?;
    if using_file_fallback() {
        let parent = config.path().parent().unwrap_or(config.path()).display();
        cliclack::log::warning(format!(
            "No system keychain available, so the session is stored in a 0600 file under {parent}."
        ))?;
    }
    cliclack::outro(
        "Run `exeora connect` to bring this machine online, then `exeora project add` in a directory to serve it.",
    )?;
    Ok(())
}

async fn device_command(
    config: &mut ConfigStore,
    api: &ApiClient,
    command: DeviceCommand,
    json_output: bool,
) -> Result<()> {
    match command {
        DeviceCommand::Register { name } => {
            if let Some(id) = &config.data().device_id {
                println!(
                    "Already registered as {} ({id}).",
                    config
                        .data()
                        .device_name
                        .as_deref()
                        .unwrap_or("this machine")
                );
                return Ok(());
            }
            let name = name.unwrap_or_else(|| {
                hostname::get()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .into_owned()
            });
            let registered = api.register_device(&name, platform(), CLI_VERSION).await?;
            config.data_mut().device_id = Some(registered.id.clone());
            config.data_mut().device_name = Some(registered.name.clone());
            config.save()?;
            println!("Registered {} ({}).", registered.name, registered.id);
        }
        DeviceCommand::List => {
            let machines = api.list_machines_raw().await?;
            let this = config.data().device_id.as_deref();
            if json_output {
                return emit(Value::Array(
                    machines
                        .into_iter()
                        .map(|mut machine| {
                            let here = this.is_some()
                                && machine.get("deviceId").and_then(Value::as_str) == this;
                            machine["thisMachine"] = json!(here);
                            machine
                        })
                        .collect(),
                ));
            }
            if machines.is_empty() {
                println!("No machines yet. Run `exeora connect` on one to register it.");
            }
            for machine in machines {
                let machine: crate::api::MachineView = serde_json::from_value(machine)?;
                println!("{}", describe_machine(&machine, this));
            }
        }
    }
    Ok(())
}

/// One line for a machine: whose it is, what it is doing, what it holds.
fn describe_machine(machine: &crate::api::MachineView, this: Option<&str>) -> String {
    let holds = if machine.kind == "cloud" {
        match (&machine.project, &machine.workspace) {
            (Some(project), Some(workspace)) => format!(
                "{}/{} ({})",
                project.slug,
                workspace.slug,
                workspace.branch.as_deref().unwrap_or("-")
            ),
            _ => String::new(),
        }
    } else {
        let copies: Vec<_> = machine
            .projects
            .iter()
            .map(|project| {
                let mut copy = project.slug.clone();
                if project.is_default {
                    copy.push('*');
                }
                if project.status != "ready" && !project.status.is_empty() {
                    copy.push_str(&format!(" [{}]", project.status));
                }
                if project.workspaces > 0 {
                    copy.push_str(&format!(" +{}", project.workspaces));
                }
                copy
            })
            .collect();
        format!("{}  {}", machine.platform, copies.join(", "))
    };
    let line = format!(
        "{:<24} {:<6} {:<11} {}{}",
        machine.name,
        machine.kind,
        machine.state,
        holds.trim(),
        if this == Some(machine.device_id.as_str()) {
            "  (this machine)"
        } else {
            ""
        }
    );
    line.trim_end().to_owned()
}

async fn connect_command(
    config: &mut ConfigStore,
    api: &ApiClient,
    auth: Arc<AuthManager>,
    args: ConnectArgs,
    json_output: bool,
) -> Result<()> {
    if args.reset {
        config.data_mut().device_id = None;
        config.data_mut().device_name = None;
        config.save()?;
    }
    let devices = match api.list_devices().await {
        Ok(devices) => devices,
        Err(error) if error.to_string().contains("Not signed in") => {
            let _ = sign_in(auth.as_ref(), args.code).await?;
            api.list_devices().await?
        }
        Err(error) => return Err(error),
    };
    let device = ensure_device(config, api, devices, args.name).await?;
    config.save()?;
    ask_projects_root(config, json_output)?;
    if config.data().projects.is_empty() && !json_output {
        println!(
            "No projects registered yet. Run `exeora project add` in a directory to serve it."
        );
    }
    connect_forever(
        config,
        api,
        auth,
        device.0,
        config.data().projects.clone(),
        json_output,
        crate::connection::ConnectMode::Local,
    )
    .await
}

/// Asks, the first time `connect` runs at a terminal, where projects should
/// be cloned on this machine. Once: the answer is saved, and a machine that
/// was told through the config or the environment is never asked.
fn ask_projects_root(config: &mut ConfigStore, json_output: bool) -> Result<()> {
    if config.data().projects_root.is_some()
        || env::var_os("EXEORA_PROJECTS_ROOT").is_some()
        || !can_ask(json_output)
    {
        return Ok(());
    }
    let suggested = config.projects_root()?;
    let answer: String =
        cliclack::input("Where should Exeora clone your projects on this machine?")
            .default_input(&suggested.to_string_lossy())
            .interact()?;
    let chosen = projects_root_from(answer.trim(), &suggested)?;
    config.data_mut().projects_root = Some(chosen.clone());
    config.save()?;
    println!(
        "Projects are cloned into {}. Change it with `exeora config set projects-root <path>`.",
        chosen.display()
    );
    Ok(())
}

/// The folder somebody typed, with `~` read the way a shell would.
fn projects_root_from(answer: &str, suggested: &Path) -> Result<PathBuf> {
    if answer.is_empty() {
        return Ok(suggested.to_path_buf());
    }
    let home = env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from);
    let path = match (answer.strip_prefix('~'), home) {
        (Some(""), Some(home)) => home,
        (Some(rest), Some(home)) if rest.starts_with(['/', '\\']) => {
            home.join(rest.trim_start_matches(['/', '\\']))
        }
        _ => PathBuf::from(answer),
    };
    Ok(if path.is_absolute() {
        path
    } else {
        env::current_dir()?.join(path)
    })
}

async fn status_command(config: &ConfigStore, api: &ApiClient, json_output: bool) -> Result<()> {
    let me = api.me().await;
    if json_output {
        let base = json!({
            "gateway": config.gateway_url(), "gatewaySource": config.gateway_source(), "config": config.path(),
            "accountMcpUrl": Url::parse(&config.gateway_url())?.join("/mcp")?,
            "device": config.data().device_id.as_ref().map(|id| json!({ "id": id, "name": config.data().device_name })),
        });
        let mut value = base;
        match me {
            Ok(user) => {
                let remote = api.list_projects().await?;
                let ids: std::collections::HashSet<_> =
                    remote.iter().map(|entry| entry.id.as_str()).collect();
                value["signedIn"] = json!(true);
                value["email"] = json!(user.email);
                value["projects"] = Value::Array(
                    config
                        .data()
                        .projects
                        .iter()
                        .map(|entry| {
                            let mut project =
                                project_json(entry, &config.gateway_url()).unwrap_or_default();
                            project["knownToGateway"] = json!(ids.contains(entry.id.as_str()));
                            project
                        })
                        .collect(),
                );
            }
            Err(error) => {
                value["signedIn"] = if error.to_string().contains("Not signed in") {
                    json!(false)
                } else {
                    Value::Null
                };
                value["projects"] = json!([]);
                if !error.to_string().contains("Not signed in") {
                    value["error"] = json!(error.to_string());
                }
            }
        }
        return emit(value);
    }
    println!(
        "Gateway   {} ({})",
        config.gateway_url(),
        source_description(config.gateway_source())
    );
    println!(
        "One URL   {}",
        Url::parse(&config.gateway_url())?.join("/mcp")?
    );
    println!("Config    {}", config.path().display());
    println!(
        "Device    {}",
        config
            .data()
            .device_id
            .as_ref()
            .map(|id| format!(
                "{} ({id})",
                config
                    .data()
                    .device_name
                    .as_deref()
                    .unwrap_or("this machine")
            ))
            .unwrap_or_else(|| "not registered".to_owned())
    );
    match me {
        Ok(user) => println!("Signed in {}", user.email),
        Err(error) if error.to_string().contains("Not signed in") => {
            println!("Signed in not signed in, run `exeora connect`");
            return Ok(());
        }
        Err(_) => {
            println!("Signed in unknown");
            return Ok(());
        }
    }
    let remote = api.list_projects().await?;
    let ids: std::collections::HashSet<_> = remote.iter().map(|entry| entry.id.as_str()).collect();
    println!(
        "Projects  {}",
        if config.data().projects.is_empty() {
            "none"
        } else {
            ""
        }
    );
    for entry in &config.data().projects {
        println!(
            "  {:<18} {}{}",
            entry.slug,
            entry.root.display(),
            if ids.contains(entry.id.as_str()) {
                ""
            } else {
                " (unknown to the gateway)"
            }
        );
    }
    Ok(())
}

async fn logs_command(api: &ApiClient, args: LogsArgs, json_output: bool) -> Result<()> {
    if args.limit < 1 {
        bail!("--limit takes a positive whole number.");
    }
    let (calls, projects) = tokio::try_join!(api.list_tool_calls(args.limit), api.list_projects())?;
    let by_id: std::collections::HashMap<_, _> = projects
        .iter()
        .map(|entry| (entry.id.as_str(), entry))
        .collect();
    let rows: Vec<_> = calls
        .into_iter()
        .filter(|call| {
            (!args.failed || call.status == "error")
                && args.project.as_ref().is_none_or(|slug| {
                    by_id
                        .get(call.project_id.as_str())
                        .is_some_and(|entry| entry.slug.eq_ignore_ascii_case(slug))
                })
                && args.workspace.as_ref().is_none_or(|selector| {
                    call.workspace_id.as_deref() == Some(selector)
                        || call
                            .workspace_slug
                            .as_deref()
                            .is_some_and(|slug| slug.eq_ignore_ascii_case(selector))
                        || (selector.eq_ignore_ascii_case("main") && call.workspace_id.is_none())
                })
                && args.client.as_ref().is_none_or(|name| {
                    client_name(call)
                        .to_lowercase()
                        .contains(&name.to_lowercase())
                })
        })
        .collect();
    if json_output {
        return emit(Value::Array(
            rows.iter()
                .map(|call| {
                    let mut value = serde_json::to_value(call).unwrap_or_default();
                    value["projectSlug"] = by_id
                        .get(call.project_id.as_str())
                        .map_or(Value::Null, |entry| json!(entry.slug));
                    value
                })
                .collect(),
        ));
    }
    if rows.is_empty() {
        println!("Nothing matches those filters.");
    }
    for call in rows.iter().rev() {
        println!(
            "{} {:<12} {:<16} {:<16} {:<20} {}ms",
            if call.status == "ok" { "✓" } else { "✗" },
            call.tool,
            by_id
                .get(call.project_id.as_str())
                .map_or("removed", |entry| entry.slug.as_str()),
            call.workspace_slug.as_deref().unwrap_or("main"),
            client_name(call),
            call.duration_ms
        );
    }
    Ok(())
}

fn init_command(args: InitArgs, json_output: bool) -> Result<()> {
    let root = absolute(args.path.unwrap_or_else(|| PathBuf::from(".")))?;
    let path = root.join(POLICY_FILENAME);
    if path.exists() && !args.force {
        bail!(
            "{} already exists. Pass --force to replace it, or edit it by hand.",
            path.display()
        );
    }
    let mut policy = LocalCommandPolicy {
        mode: args.mode.as_deref().map(parse_mode).transpose()?,
        allow: args.allow.as_deref().map(split_list),
        deny: args.deny.as_deref().map(split_list),
        shell: None,
        approve: None,
        tools: args
            .tools
            .as_deref()
            .map(|value| {
                split_list(value)
                    .into_iter()
                    .map(|name| name.parse())
                    .collect::<Result<Vec<_>, _>>()
            })
            .transpose()?,
    };
    if !args.yes && policy.mode.is_none() {
        let selected: String = cliclack::select("What may an agent do here?")
            .item(
                "allow_list".to_owned(),
                "Only the commands I name",
                "recommended",
            )
            .item("read_only".to_owned(), "Read, never change anything", "")
            .item("allow_all".to_owned(), "Anything the account allows", "")
            .interact()?;
        policy.mode = Some(parse_mode(&selected)?);
    }
    fs::write(&path, render_policy_toml(&policy))?;
    if json_output {
        emit(json!({ "path": path, "policy": policy, "effective": Value::Null }))?;
    } else {
        println!("Wrote {}.", path.display());
    }
    Ok(())
}

fn prompt_command(account: bool, json_output: bool) -> Result<()> {
    let contract: Value = serde_json::from_str(include_str!("../protocol/contract.json"))?;
    let key = if account { "account" } else { "project" };
    let prompt = contract
        .pointer(&format!("/prompts/{key}"))
        .and_then(Value::as_str)
        .context("generated prompt is missing")?;
    if json_output {
        emit(json!({ "prompt": prompt }))
    } else {
        println!("{prompt}");
        Ok(())
    }
}

async fn sync_command(config: &mut ConfigStore, api: &ApiClient) -> Result<()> {
    let (devices, remote) = tokio::try_join!(api.list_devices(), api.list_projects())?;
    let Some(stored) = config.data().device_id.clone() else {
        println!("This machine is not registered. Run `exeora connect` first.");
        return Ok(());
    };
    let Some(device) = devices.iter().find(|entry| entry.id == stored) else {
        let count = config.data().projects.len();
        config.forget_local_state();
        config.save()?;
        println!(
            "This machine was deleted from the dashboard. Forgot it and its {count} projects. Run `exeora connect` to register again."
        );
        return Ok(());
    };
    if device.revoked_at.is_some() {
        println!(
            "This machine ({}) was revoked from the dashboard, so it will not serve tool calls. Run `exeora connect --reset` to register it again.",
            device.name
        );
    }
    let mut next = projects_on_this_machine(&stored, &remote, &config.data().projects);
    let taught = teach_repositories(api, &stored, &remote, &next).await;
    if taught > 0 {
        // The gateway may have answered by joining a checkout to a project it
        // already had. What it holds now is what this machine should mirror.
        let remote = api.list_projects().await?;
        next = projects_on_this_machine(&stored, &remote, &config.data().projects);
    }
    let projects_changed = next != config.data().projects;
    if projects_changed {
        config.data_mut().projects = next;
        config.save()?;
    }
    let pending = config.data().workspaces.clone();
    let mut synced = 0usize;
    let mut recovered = 0usize;
    for mut entry in pending {
        match entry.sync_state {
            WorkspaceSyncState::PendingUpsert => {
                if let Ok(registered) = api
                    .put_workspace(&entry.project_id, &entry, Some(&stored))
                    .await
                {
                    workspaces::adopt_registration(&mut entry, &registered);
                    entry.sync_state = WorkspaceSyncState::Active;
                    config.upsert_workspace(entry);
                    synced += 1;
                }
            }
            WorkspaceSyncState::PendingDelete | WorkspaceSyncState::Disabled => {
                if api
                    .remove_workspace(&entry.project_id, &entry.id)
                    .await
                    .is_ok()
                {
                    config.remove_workspace(&entry.id);
                    synced += 1;
                }
            }
            WorkspaceSyncState::Removing => {
                recovered += 1;
                if entry.git_root.exists() {
                    // The process stopped before Git removed the workspace. Make
                    // it routable again instead of leaving it permanently
                    // hidden behind the transient Removing state.
                    entry.sync_state = WorkspaceSyncState::Active;
                    config.upsert_workspace(entry);
                } else {
                    // Git removal completed, but the process stopped before the
                    // gateway deletion. Resume that half of the operation.
                    entry.sync_state = WorkspaceSyncState::PendingDelete;
                    if api
                        .remove_workspace(&entry.project_id, &entry.id)
                        .await
                        .is_ok()
                    {
                        config.remove_workspace(&entry.id);
                        synced += 1;
                    } else {
                        config.upsert_workspace(entry);
                    }
                }
            }
            WorkspaceSyncState::Active => {}
        }
    }
    config.save()?;
    if taught > 0 {
        println!(
            "Told Exeora the repository of {taught} project(s), so other machines can hold a copy of them."
        );
    }
    if projects_changed || synced > 0 || recovered > 0 {
        println!(
            "Synchronized projects and {synced} pending workspaces with the gateway; recovered {recovered} interrupted removals."
        );
    } else if taught == 0 {
        println!("Already up to date.");
    }
    Ok(())
}

/// The projects that belong in this machine's config, as the gateway sees
/// them.
///
/// A project belongs here when one of its locations is this machine, whether
/// or not it is the default one. The root is where that location says the
/// copy is. A location that has no copy yet, because nobody has asked for a
/// workspace on it or because it is being cloned right now, keeps whatever
/// entry this machine already has and gains none: the clone writes the entry
/// when there is something to point at.
fn projects_on_this_machine(
    device: &str,
    remote: &[ProjectView],
    local: &[ProjectEntry],
) -> Vec<ProjectEntry> {
    remote
        .iter()
        .filter_map(|project| {
            let known = local.iter().find(|entry| entry.id == project.id);
            let default_here = project.device_id == device;
            let root = if project.locations.is_empty() {
                // A gateway from before locations: the project is on one
                // machine, and that is the whole of what it says.
                default_here.then(|| PathBuf::from(&project.local_path))
            } else {
                let location = project
                    .location_on(device)
                    .filter(|location| !location.is_cloud())?;
                let waiting = matches!(location.status.as_str(), "pending" | "cloning");
                location
                    .local_path
                    .as_deref()
                    .filter(|_| !waiting)
                    .map(PathBuf::from)
                    .or_else(|| known.map(|entry| entry.root.clone()))
                    .or_else(|| {
                        (default_here && !waiting).then(|| PathBuf::from(&project.local_path))
                    })
            }?;
            Some(ProjectEntry {
                id: project.id.clone(),
                slug: project.slug.clone(),
                name: project.name.clone(),
                root,
                repo_url: project
                    .repo_url
                    .clone()
                    .or_else(|| known.and_then(|entry| entry.repo_url.clone())),
                default_branch: project
                    .default_branch
                    .clone()
                    .or_else(|| known.and_then(|entry| entry.default_branch.clone())),
            })
        })
        .collect()
}

/// Tells the gateway the repository of projects it knows only as a directory.
///
/// That is every project registered by a CLI older than 0.18.0. Until the
/// gateway knows the repository, the project cannot live anywhere else. Sent
/// as the same registration again, which the gateway reads as an update.
/// Answers with how many it told; one that is refused is left as it was.
async fn teach_repositories(
    api: &ApiClient,
    device: &str,
    remote: &[ProjectView],
    local: &[ProjectEntry],
) -> usize {
    let mut taught = 0;
    for entry in local {
        let unknown_to_gateway = remote
            .iter()
            .find(|project| project.id == entry.id)
            .is_some_and(|project| project.repo_url.is_none());
        if !unknown_to_gateway {
            continue;
        }
        let Some(repo_url) = repository_of(&entry.root) else {
            continue;
        };
        let default_branch = default_branch_of(&entry.root);
        let told = api
            .add_project(ProjectRegistration {
                device_id: device,
                name: &entry.name,
                slug: &entry.slug,
                local_path: &entry.root.to_string_lossy(),
                repo_url: Some(&repo_url),
                default_branch: default_branch.as_deref(),
            })
            .await;
        if told.is_ok() {
            taught += 1;
        }
    }
    taught
}

/// The https address of the repository a directory is the top of. None for a
/// folder inside a checkout: the project is that folder, not the repository.
fn repository_of(root: &Path) -> Option<String> {
    let root = root.canonicalize().ok()?;
    let top = checkout_root(&root)?.canonicalize().ok()?;
    if top != root {
        return None;
    }
    let origin = origin_of(&root)?;
    repository_key(&origin)?;
    https_repository_url(&origin)
}

async fn gateway_command(
    config: &mut ConfigStore,
    command: &Option<GatewayCommand>,
    json_output: bool,
) -> Result<()> {
    match command {
        None => {
            if json_output {
                emit(json!({ "gateway": config.gateway_url(), "source": config.gateway_source() }))?
            } else {
                println!(
                    "Gateway  {}  ({})",
                    config.gateway_url(),
                    source_description(config.gateway_source())
                );
            }
        }
        Some(GatewayCommand::Use { url, yes, force }) => {
            let _ = switch_gateway(config, url, *yes, *force, json_output).await?;
        }
        Some(GatewayCommand::Reset { yes, force }) => {
            let _ = switch_gateway(config, DEFAULT_GATEWAY, *yes, *force, json_output).await?;
        }
    }
    Ok(())
}

async fn switch_gateway(
    config: &mut ConfigStore,
    input: &str,
    yes: bool,
    force: bool,
    json_output: bool,
) -> Result<bool> {
    let target = normalize_gateway(input)?;
    if target == config.gateway_url() {
        if json_output {
            emit(
                json!({ "gateway": target, "source": config.gateway_source(), "outcome": "unchanged" }),
            )?;
        } else {
            println!("Already using {target}.");
        }
        return Ok(true);
    }
    if !force {
        let http = reqwest::Client::new();
        let _ = discover_client(&http, &target).await?;
    }
    let signed_in = load_credentials()?.is_some();
    let has_state =
        config.data().device_name.is_some() || !config.data().projects.is_empty() || signed_in;
    if has_state && !yes {
        if json_output {
            bail!(
                "Switching to {target} would forget the current registration. Pass --yes to confirm."
            );
        }
        let answer = cliclack::confirm(format!("Switching to {target} forgets this machine's registration, projects and session. Switch anyway?")).initial_value(false).interact()?;
        if !answer {
            println!("Left the gateway as it was.");
            return Ok(false);
        }
    }
    clear_credentials()?;
    config.forget_local_state();
    config.data_mut().gateway_url = target.clone();
    config.save()?;
    if json_output {
        emit(
            json!({ "gateway": target, "source": config.gateway_source(), "outcome": "switched" }),
        )?;
    } else {
        println!("Now using {target}.");
    }
    Ok(true)
}

async fn ensure_device(
    config: &mut ConfigStore,
    api: &ApiClient,
    devices: Vec<DeviceView>,
    name: Option<String>,
) -> Result<(String, String)> {
    if let Some(stored) = config.data().device_id.clone()
        && let Some(device) = devices.iter().find(|entry| entry.id == stored)
    {
        if device.revoked_at.is_some() {
            bail!(
                "This machine ({}) was revoked from the dashboard, so it will not serve tool calls. Run `exeora connect --reset` to register it again.",
                device.name
            );
        }
        config.data_mut().device_name = Some(device.name.clone());
        return Ok((device.id.clone(), device.name.clone()));
    }
    let name = name.unwrap_or_else(|| {
        hostname::get()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned()
    });
    let device = api.register_device(&name, platform(), CLI_VERSION).await?;
    config.data_mut().device_id = Some(device.id.clone());
    config.data_mut().device_name = Some(device.name.clone());
    println!("Registered this machine as {}.", device.name);
    Ok((device.id, device.name))
}

fn normalize_gateway(input: &str) -> Result<String> {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        bail!("Give the gateway's base URL, for example https://exeora.example.com.");
    }
    let explicit = trimmed.contains("://");
    let candidate = if explicit {
        trimmed.to_owned()
    } else {
        format!("https://{trimmed}")
    };
    let mut url = Url::parse(&candidate)?;
    if !explicit && matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "::1")) {
        url.set_scheme("http")
            .map_err(|_| anyhow!("invalid gateway scheme"))?;
    }
    if !matches!(url.scheme(), "http" | "https") {
        bail!("{trimmed} is not an http or https address.");
    }
    if url.scheme() == "http" && !matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "::1"))
    {
        bail!(
            "{trimmed} is plain http, which would put your session token on the wire in the clear. Use https, or a loopback address for local development."
        );
    }
    if url.path() != "/" {
        bail!(
            "{trimmed} has a path. A gateway is a whole origin. Use {} instead.",
            url.origin().ascii_serialization()
        );
    }
    Ok(url.origin().ascii_serialization())
}

pub(crate) fn project_root(path: Option<PathBuf>) -> Result<PathBuf> {
    let root = absolute(path.unwrap_or_else(|| PathBuf::from(".")))?;
    let home = env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
        .and_then(|home| PathBuf::from(home).canonicalize().ok());
    validate_project_root(root, home.as_deref())
}

fn validate_project_root(root: PathBuf, home: Option<&Path>) -> Result<PathBuf> {
    if !root.is_dir() {
        bail!("{} is not a directory.", root.display());
    }
    if home.is_some_and(|home| root == home) {
        bail!(
            "That is your home directory, and a project is the boundary an agent is confined to. Run this inside the directory you want to serve."
        );
    }
    if root.parent().is_none() {
        bail!(
            "That is the filesystem root, and a project is the boundary an agent is confined to. Run this inside the directory you want to serve."
        );
    }
    Ok(root)
}

pub(crate) fn slugify(value: &str) -> String {
    let slug = value
        .to_lowercase()
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if slug.is_empty() {
        "project".to_owned()
    } else {
        slug
    }
}
fn absolute(path: PathBuf) -> Result<PathBuf> {
    if path.is_absolute() {
        Ok(path)
    } else {
        Ok(env::current_dir()?.join(path))
    }
    .and_then(|path| {
        path.canonicalize()
            .with_context(|| format!("Could not resolve {}", path.display()))
    })
}
pub(crate) fn file_name(path: &Path) -> Result<String> {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .context("The project path has no directory name")
}
pub(crate) fn project_mcp_url(gateway: &str, id: &str) -> Result<Url> {
    Ok(Url::parse(gateway)?.join(&format!("/p/{id}/mcp"))?)
}
fn project_json(entry: &ProjectEntry, gateway: &str) -> Result<Value> {
    Ok(
        json!({ "id": entry.id, "slug": entry.slug, "name": entry.name, "root": entry.root, "mcpUrl": project_mcp_url(gateway, &entry.id)? }),
    )
}
fn split_list(value: &str) -> Vec<String> {
    value
        .split(',')
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .collect()
}
fn parse_mode(value: &str) -> Result<PolicyMode> {
    match value {
        "allow_all" => Ok(PolicyMode::AllowAll),
        "allow_list" => Ok(PolicyMode::AllowList),
        "read_only" => Ok(PolicyMode::ReadOnly),
        _ => bail!("invalid policy mode: {value}"),
    }
}
pub(crate) fn emit(value: Value) -> Result<()> {
    println!("{}", serde_json::to_string_pretty(&value)?);
    Ok(())
}
fn platform() -> &'static str {
    if cfg!(target_os = "windows") {
        "win32"
    } else if cfg!(target_os = "macos") {
        "darwin"
    } else {
        "linux"
    }
}
fn source_description(source: &str) -> &'static str {
    match source {
        "env" => "from EXEORA_GATEWAY_URL",
        "default" => "default",
        _ => "configured",
    }
}
fn client_name(call: &ToolCallView) -> String {
    call.client_name.clone().unwrap_or_else(|| {
        if call.client_id.is_some() {
            "unknown".to_owned()
        } else {
            "—".to_owned()
        }
    })
}

#[cfg(test)]
mod tests {
    use super::{
        describe_machine, listed_projects, projects_on_this_machine, projects_root_from,
        sync_command, validate_project_root, workspace_listing,
    };
    use crate::{
        api::{MachineView, ProjectView},
        config::{ConfigStore, ProjectEntry, WorkspaceEntry, WorkspaceSyncState},
        testing::{Gateway, listed_location, listed_project},
    };
    use serde_json::{Value, json};
    use std::{
        fs,
        path::{Path, PathBuf},
        process::Command,
    };
    use tempfile::tempdir;

    fn views(projects: Value) -> Vec<ProjectView> {
        serde_json::from_value(projects).expect("project views")
    }

    fn entry(id: &str, slug: &str, root: &str) -> ProjectEntry {
        ProjectEntry::directory(
            id.to_owned(),
            slug.to_owned(),
            slug.to_owned(),
            PathBuf::from(root),
        )
    }

    #[test]
    fn a_project_belongs_here_when_one_of_its_locations_is_this_machine() {
        let remote = views(json!([
            // The default is another machine, and this one holds a copy too.
            listed_project(
                "prj_shared",
                "shared",
                json!({
                    "repoUrl": "https://github.com/acme/shared.git",
                    "defaultBranch": "main",
                    "locations": [
                        listed_location(Some("dev_elsewhere"), "desktop", json!({ "default": true, "localPath": "/elsewhere/shared" })),
                        listed_location(Some("dev_here"), "laptop", json!({ "localPath": "/here/shared" })),
                    ],
                })
            ),
            // Chosen as a location, not cloned yet, and known here already.
            listed_project(
                "prj_pending",
                "pending",
                json!({
                    "locations": [
                        listed_location(Some("dev_elsewhere"), "desktop", json!({ "default": true })),
                        listed_location(Some("dev_here"), "laptop", json!({ "status": "pending", "state": "not cloned" })),
                    ],
                })
            ),
            // Being cloned right now, by a call that has not finished.
            listed_project(
                "prj_cloning",
                "cloning",
                json!({
                    "locations": [
                        listed_location(Some("dev_here"), "laptop", json!({ "status": "cloning", "localPath": "/here/half" })),
                    ],
                })
            ),
            // Lives on another machine and on Exeora Cloud, not here.
            listed_project(
                "prj_away",
                "away",
                json!({
                    "locations": [
                        listed_location(Some("dev_elsewhere"), "desktop", json!({ "default": true })),
                        listed_location(None, "cloud", json!({ "kind": "cloud" })),
                    ],
                })
            ),
            // From a gateway that lists no locations: where it is, is `deviceId`.
            listed_project(
                "prj_legacy",
                "legacy",
                json!({ "deviceId": "dev_here", "localPath": "/here/legacy" })
            ),
            listed_project("prj_legacy_away", "legacy-away", json!({})),
        ]));
        let local = [
            entry("prj_pending", "pending", "/here/pending"),
            entry("prj_away", "away", "/here/away"),
            entry("prj_gone", "gone", "/here/gone"),
        ];

        let next = projects_on_this_machine("dev_here", &remote, &local);
        let roots: Vec<_> = next
            .iter()
            .map(|entry| (entry.id.as_str(), entry.root.to_string_lossy().into_owned()))
            .collect();
        assert_eq!(
            roots,
            [
                ("prj_shared", "/here/shared".to_owned()),
                ("prj_pending", "/here/pending".to_owned()),
                ("prj_legacy", "/here/legacy".to_owned()),
            ]
        );
        assert_eq!(
            next[0].repo_url.as_deref(),
            Some("https://github.com/acme/shared.git")
        );
        assert_eq!(next[0].default_branch.as_deref(), Some("main"));
    }

    fn git(cwd: &Path, args: &[&str]) {
        let output = Command::new("git")
            .arg("-C")
            .arg(cwd)
            .args(args)
            .output()
            .expect("git");
        assert!(output.status.success(), "git {}", args.join(" "));
    }

    #[tokio::test]
    async fn sync_tells_the_gateway_the_repository_of_a_project_it_knows_as_a_directory() {
        let temp = tempdir().expect("temp directory");
        let checkout = fs::canonicalize(temp.path()).expect("path").join("api");
        fs::create_dir(&checkout).expect("checkout");
        git(&checkout, &["init", "--quiet"]);
        git(
            &checkout,
            &["remote", "add", "origin", "git@github.com:Acme/API.git"],
        );
        git(
            &checkout,
            &[
                "symbolic-ref",
                "refs/remotes/origin/HEAD",
                "refs/remotes/origin/trunk",
            ],
        );
        let plain = fs::canonicalize(temp.path()).expect("path").join("notes");
        fs::create_dir(&plain).expect("directory");

        let mut config = ConfigStore::load_from(temp.path().join("config.json")).expect("config");
        config.data_mut().device_id = Some("dev_here".to_owned());
        config.upsert_project(entry("prj_api", "api", &checkout.to_string_lossy()));
        config.upsert_project(entry("prj_notes", "notes", &plain.to_string_lossy()));
        config.save().expect("save");

        let api_path = checkout.to_string_lossy().into_owned();
        let notes_path = plain.to_string_lossy().into_owned();
        let taught = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let heard = taught.clone();
        let gateway = Gateway::start(move |method, path, _| match (method, path) {
            ("GET", "/api/devices") => (
                200,
                json!([{ "id": "dev_here", "name": "laptop", "platform": "linux", "cliVersion": null, "online": true, "lastSeenAt": null, "revokedAt": null }]),
            ),
            ("GET", "/api/projects") => {
                let known = heard.load(std::sync::atomic::Ordering::SeqCst);
                (
                    200,
                    json!([
                        listed_project("prj_api", "api", json!({
                            "deviceId": "dev_here",
                            "localPath": api_path,
                            "repoUrl": if known { json!("https://github.com/Acme/API.git") } else { Value::Null },
                            "defaultBranch": if known { json!("trunk") } else { Value::Null },
                            "locations": [listed_location(Some("dev_here"), "laptop", json!({ "default": true, "localPath": api_path }))],
                        })),
                        listed_project("prj_notes", "notes", json!({
                            "deviceId": "dev_here",
                            "localPath": notes_path,
                            "locations": [listed_location(Some("dev_here"), "laptop", json!({ "default": true, "localPath": notes_path }))],
                        })),
                    ]),
                )
            }
            ("POST", "/api/projects") => {
                heard.store(true, std::sync::atomic::Ordering::SeqCst);
                (
                    200,
                    json!({ "id": "prj_api", "slug": "api", "name": "api", "location": "updated" }),
                )
            }
            _ => (404, json!({ "error": "not_found" })),
        })
        .await;

        sync_command(&mut config, &gateway.api().await)
            .await
            .expect("sync");

        let sent = gateway.received_as("POST", "/api/projects");
        assert_eq!(sent.len(), 1, "only the checkout with a remote is told");
        assert_eq!(
            sent[0].body,
            json!({
                "deviceId": "dev_here",
                "name": "api",
                "slug": "api",
                "localPath": checkout.to_string_lossy(),
                "repoUrl": "https://github.com/Acme/API.git",
                "defaultBranch": "trunk",
            })
        );
        let saved = ConfigStore::load_from(config.path().to_path_buf()).expect("config");
        let api_entry = saved.find_project("prj_api").expect("entry");
        assert_eq!(
            api_entry.repo_url.as_deref(),
            Some("https://github.com/Acme/API.git")
        );
        assert_eq!(api_entry.default_branch.as_deref(), Some("trunk"));
        assert!(
            saved
                .find_project("prj_notes")
                .expect("entry")
                .repo_url
                .is_none()
        );

        // Once the gateway knows, the next run has nothing to say.
        sync_command(&mut config, &gateway.api().await)
            .await
            .expect("sync");
        assert_eq!(gateway.received_as("POST", "/api/projects").len(), 1);
    }

    #[tokio::test]
    async fn sync_takes_the_slug_the_gateway_stored_for_a_pending_workspace() {
        let temp = tempdir().expect("temp directory");
        let root = fs::canonicalize(temp.path()).expect("path");
        let mut config = ConfigStore::load_from(temp.path().join("config.json")).expect("config");
        config.data_mut().device_id = Some("dev_here".to_owned());
        config.upsert_project(entry("prj_api", "api", &root.to_string_lossy()));
        config.upsert_workspace(WorkspaceEntry {
            id: "wsp_fix".to_owned(),
            project_id: "prj_api".to_owned(),
            slug: "fix-login".to_owned(),
            name: "fix/login".to_owned(),
            branch: Some("fix/login".to_owned()),
            git_root: root.join("fix-login"),
            root: root.join("fix-login"),
            managed: true,
            sync_state: WorkspaceSyncState::PendingUpsert,
        });
        config.save().expect("save");
        let project_path = root.to_string_lossy().into_owned();
        let gateway = Gateway::start(move |method, path, body| match (method, path) {
            ("GET", "/api/devices") => (
                200,
                json!([{ "id": "dev_here", "name": "laptop", "platform": "linux", "cliVersion": null, "online": true, "lastSeenAt": null, "revokedAt": null }]),
            ),
            ("GET", "/api/projects") => (
                200,
                json!([listed_project("prj_api", "api", json!({
                    "deviceId": "dev_elsewhere",
                    "locations": [
                        listed_location(Some("dev_elsewhere"), "desktop", json!({ "default": true })),
                        listed_location(Some("dev_here"), "laptop", json!({ "localPath": project_path })),
                    ],
                }))]),
            ),
            ("PUT", "/api/projects/prj_api/workspaces/wsp_fix") => (
                200,
                json!({
                    "id": "wsp_fix", "projectId": "prj_api", "slug": "fix-login-laptop",
                    "name": "fix/login", "branch": body["branch"], "localPath": body["localPath"],
                    "managed": true, "deviceId": body["deviceId"], "cloud": false,
                    "machine": "laptop", "createdAt": 1, "updatedAt": 1,
                }),
            ),
            _ => (404, json!({ "error": "not_found" })),
        })
        .await;

        sync_command(&mut config, &gateway.api().await)
            .await
            .expect("sync");

        let sent = gateway.received_as("PUT", "/api/projects/prj_api/workspaces/wsp_fix");
        assert_eq!(sent.len(), 1);
        assert_eq!(sent[0].body["deviceId"], "dev_here");
        assert_eq!(sent[0].body["slug"], "fix-login");
        let saved = ConfigStore::load_from(config.path().to_path_buf()).expect("config");
        assert_eq!(saved.data().workspaces.len(), 1);
        assert_eq!(saved.data().workspaces[0].slug, "fix-login-laptop");
        assert_eq!(
            saved.data().workspaces[0].sync_state,
            WorkspaceSyncState::Active
        );
        // The project stayed, though its default location is another machine.
        assert!(saved.find_project("prj_api").is_some());
    }

    fn machine_with_a_workspace(temp: &Path) -> ConfigStore {
        let mut config = ConfigStore::load_from(temp.join("config.json")).expect("config");
        config.data_mut().device_id = Some("dev_here".to_owned());
        config.data_mut().device_name = Some("laptop".to_owned());
        config.upsert_project(entry("prj_api", "api", "/code/api"));
        config.upsert_project(entry("prj_web", "web", "/code/web"));
        for (id, project, slug, state) in [
            (
                "wsp_fix",
                "prj_api",
                "fix-login",
                WorkspaceSyncState::Active,
            ),
            (
                "wsp_new",
                "prj_web",
                "new-page",
                WorkspaceSyncState::PendingUpsert,
            ),
        ] {
            config.upsert_workspace(WorkspaceEntry {
                id: id.to_owned(),
                project_id: project.to_owned(),
                slug: slug.to_owned(),
                name: slug.to_owned(),
                branch: Some(slug.to_owned()),
                git_root: PathBuf::from("/work").join(slug),
                root: PathBuf::from("/work").join(slug),
                managed: true,
                sync_state: state,
            });
        }
        config.save().expect("save");
        config
    }

    #[tokio::test]
    async fn lists_the_workspaces_of_this_machine_when_the_gateway_is_out_of_reach() {
        let temp = tempdir().expect("temp directory");
        let config = machine_with_a_workspace(temp.path());
        let gone = Gateway::gone();
        let unwell = Gateway::start(|_, _, _| (503, json!({ "error": "unavailable" }))).await;

        for api in [gone.api().await, unwell.api().await] {
            let listing = workspace_listing(&config, &api, None, true)
                .await
                .expect("what this machine knows");
            assert!(
                listing
                    .notice
                    .as_deref()
                    .is_some_and(|notice| notice.contains("could not be reached")
                        && notice.contains("what this machine knows"))
            );
            assert_eq!(
                listing.items,
                [
                    json!({
                        "id": "wsp_fix", "projectId": "prj_api", "slug": "fix-login",
                        "name": "fix-login", "branch": "fix-login", "localPath": "/work/fix-login",
                        "managed": true, "deviceId": "dev_here", "cloud": false,
                        "machine": "laptop", "projectSlug": "api", "thisMachine": true,
                        "syncState": "active", "offline": true,
                    }),
                    json!({
                        "id": "wsp_new", "projectId": "prj_web", "slug": "new-page",
                        "name": "new-page", "branch": "new-page", "localPath": "/work/new-page",
                        "managed": true, "deviceId": "dev_here", "cloud": false,
                        "machine": "laptop", "projectSlug": "web", "thisMachine": true,
                        "syncState": "pendingUpsert", "offline": true,
                    }),
                ]
            );
            assert_eq!(listing.lines.len(), 2);
            assert!(listing.lines[0].contains("laptop (this machine)"));
            assert!(listing.lines[1].ends_with("[pendingupsert]"));
        }

        let one = workspace_listing(&config, &gone.api().await, Some("web"), false)
            .await
            .expect("what this machine knows");
        assert_eq!(one.items.len(), 1);
        assert_eq!(one.items[0]["slug"], "new-page");
        // A project this machine does not have cannot be listed from here.
        assert!(
            workspace_listing(&config, &gone.api().await, Some("other"), false)
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn a_refusal_is_not_answered_with_what_this_machine_knows() {
        let temp = tempdir().expect("temp directory");
        let config = machine_with_a_workspace(temp.path());
        for status in [401, 403, 404] {
            let gateway =
                Gateway::start(move |_, _, _| (status, json!({ "error": "refused" }))).await;
            assert!(
                workspace_listing(&config, &gateway.api().await, None, true)
                    .await
                    .is_err(),
                "{status}"
            );
        }
        // The gateway answers, and its workspaces are listed without a notice.
        let gateway = Gateway::start(|_, path, _| match path {
            "/api/projects" => (200, json!([listed_project("prj_api", "api", json!({}))])),
            _ => (200, json!([])),
        })
        .await;
        let listing = workspace_listing(&config, &gateway.api().await, None, true)
            .await
            .expect("listing");
        assert!(listing.notice.is_none());
        assert_eq!(
            listing.items.len(),
            1,
            "the one the gateway has not heard of"
        );
        assert!(listing.items[0].get("offline").is_none());
    }

    #[test]
    fn lists_the_project_that_was_named_or_all_of_them() {
        let temp = tempdir().expect("temp directory");
        let config = ConfigStore::load_from(temp.path().join("config.json")).expect("config");
        let remote = views(json!([
            listed_project("prj_a", "alpha", json!({})),
            listed_project("prj_b", "beta", json!({})),
        ]));
        let slugs = |project: Option<&str>, all: bool| {
            listed_projects(&config, &remote, project, all).map(|found| {
                found
                    .iter()
                    .map(|project| project.slug.clone())
                    .collect::<Vec<_>>()
            })
        };
        assert_eq!(slugs(Some("BETA"), false).expect("found"), ["beta"]);
        assert_eq!(slugs(Some("prj_a"), false).expect("found"), ["alpha"]);
        assert_eq!(slugs(None, true).expect("found"), ["alpha", "beta"]);
        assert!(slugs(Some("gamma"), false).is_err());
    }

    #[test]
    fn describes_a_machine_by_what_it_is_doing() {
        let machine =
            |value: Value| -> MachineView { serde_json::from_value(value).expect("machine") };
        let laptop = machine(json!({
            "deviceId": "dev_here", "kind": "local", "name": "laptop", "platform": "linux",
            "cliVersion": "0.18.0", "online": true, "state": "online", "lastSeenAt": 1,
            "createdAt": 1, "revokedAt": null,
            "projects": [
                { "projectId": "prj_a", "slug": "alpha", "name": "Alpha", "localPath": "/code/alpha", "status": "ready", "default": true, "workspaces": 2 },
                { "projectId": "prj_b", "slug": "beta", "name": "Beta", "localPath": null, "status": "pending", "default": false, "workspaces": 0 },
            ],
        }));
        assert_eq!(
            describe_machine(&laptop, Some("dev_here")),
            "laptop                   local  online      linux  alpha* +2, beta [pending]  (this machine)"
        );
        // A cloud machine that is not connected is asleep, which is what it
        // is for, and never offline.
        let cloud = machine(json!({
            "deviceId": "dev_cloud", "kind": "cloud", "name": "alpha-fix", "platform": "linux",
            "cliVersion": "0.18.0", "online": false, "state": "asleep", "lastSeenAt": 1,
            "createdAt": 1, "revokedAt": null,
            "project": { "id": "prj_a", "slug": "alpha", "name": "Alpha" },
            "workspace": { "id": "wsp_1", "slug": "fix", "branch": "fix/login" },
            "status": "ready", "step": null, "error": null,
        }));
        assert_eq!(
            describe_machine(&cloud, Some("dev_here")),
            "alpha-fix                cloud  asleep      alpha/fix (fix/login)"
        );
    }

    #[test]
    fn reads_the_folder_somebody_typed() {
        let suggested = Path::new("/home/me/exeora");
        assert_eq!(
            projects_root_from("", suggested).expect("path"),
            PathBuf::from("/home/me/exeora")
        );
        let absolute = std::env::temp_dir().join("code");
        assert_eq!(
            projects_root_from(&absolute.to_string_lossy(), suggested).expect("path"),
            absolute
        );
        if let Some(home) = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }) {
            assert_eq!(
                projects_root_from("~/code", suggested).expect("path"),
                PathBuf::from(&home).join("code")
            );
            assert_eq!(
                projects_root_from("~", suggested).expect("path"),
                PathBuf::from(&home)
            );
        }
    }

    #[test]
    fn rejects_home_root_and_files_as_project_boundaries() {
        let temp = tempdir().expect("temp directory");
        let home = temp.path().to_path_buf();
        assert!(validate_project_root(home.clone(), Some(&home)).is_err());

        let file = home.join("file.txt");
        fs::write(&file, "not a directory").expect("fixture");
        assert!(validate_project_root(file, None).is_err());

        let filesystem_root = home
            .ancestors()
            .last()
            .map(PathBuf::from)
            .expect("filesystem root");
        assert!(validate_project_root(filesystem_root, None).is_err());
    }

    #[test]
    fn accepts_a_regular_project_directory() {
        let temp = tempdir().expect("temp directory");
        let project = temp.path().join("project");
        fs::create_dir(&project).expect("fixture");
        assert_eq!(
            validate_project_root(project.clone(), Some(temp.path())).expect("valid project"),
            project
        );
    }
}
