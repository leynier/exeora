use crate::{
    CLI_VERSION,
    api::{ApiClient, DeviceView, ToolCallView},
    auth::{
        AuthManager, clear_credentials, discover_client, load_credentials, using_file_fallback,
    },
    config::{ConfigStore, DEFAULT_GATEWAY, ProjectEntry, WorktreeEntry, WorktreeSyncState},
    connection::connect_forever,
    policy::{LocalCommandPolicy, POLICY_FILENAME, PolicyMode, render_policy_toml},
    worktrees::{self, CreateWorktree},
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
    #[command(about = "Sign in to Exeora in your browser")]
    Login(GatewayChoice),
    #[command(about = "Forget the stored session on this machine")]
    Logout,
    #[command(about = "Show or change the Exeora this machine talks to")]
    Gateway {
        #[command(subcommand)]
        command: Option<GatewayCommand>,
    },
    #[command(about = "Manage this machine")]
    Device {
        #[command(subcommand)]
        command: DeviceCommand,
    },
    #[command(about = "Manage projects on this machine")]
    Project {
        #[command(subcommand)]
        command: ProjectCommand,
    },
    #[command(about = "Manage Git worktrees connected to Exeora projects")]
    Worktree {
        #[command(subcommand)]
        command: WorktreeCommand,
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
    #[command(about = "List your registered machines")]
    List,
}

#[derive(Debug, Subcommand)]
pub enum ProjectCommand {
    #[command(about = "Register a local directory as a project")]
    Add {
        path: Option<PathBuf>,
        #[arg(short, long)]
        slug: Option<String>,
    },
    #[command(about = "List projects registered on this machine")]
    List,
    #[command(about = "Stop serving a project from this machine")]
    Remove { slug: String },
}

#[derive(Debug, Subcommand)]
pub enum WorktreeCommand {
    #[command(about = "Create a Git worktree and connect it to an Exeora project")]
    Create {
        branch: String,
        #[arg(long = "from")]
        from_ref: Option<String>,
        #[arg(long)]
        #[arg(conflicts_with = "from_ref")]
        reuse_existing_branch: bool,
        #[arg(short, long)]
        project: Option<String>,
        #[arg(short, long)]
        name: Option<String>,
        #[arg(short, long)]
        slug: Option<String>,
        #[arg(long)]
        path: Option<PathBuf>,
    },
    #[command(about = "Connect an existing Git worktree to an Exeora project")]
    Attach {
        path: PathBuf,
        #[arg(short, long)]
        project: Option<String>,
        #[arg(short, long)]
        name: Option<String>,
        #[arg(short, long)]
        slug: Option<String>,
    },
    #[command(about = "List worktrees connected to Exeora")]
    List {
        #[arg(short, long, conflicts_with = "all")]
        project: Option<String>,
        #[arg(long)]
        all: bool,
    },
    #[command(about = "Disconnect a worktree from Exeora without deleting it")]
    Detach { selector: String },
    #[command(about = "Disconnect and remove a Git worktree")]
    Remove {
        selector: String,
        #[arg(long)]
        force: bool,
        #[arg(long)]
        delete_branch: bool,
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
}

#[derive(Debug, Args)]
pub struct LogsArgs {
    #[arg(short = 'n', long, default_value_t = 30)]
    limit: usize,
    #[arg(short, long)]
    project: Option<String>,
    #[arg(short, long)]
    worktree: Option<String>,
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
    let mut config = ConfigStore::load()?;
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
        Commands::Login(_) => login_command(&api, auth, &config).await,
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
        Commands::Project { command } => {
            project_command(&mut config, &api, command, cli.json).await
        }
        Commands::Worktree { command } => {
            worktree_command(&mut config, &api, command, cli.json).await
        }
        Commands::Connect(args) => connect_command(&mut config, &api, auth, args, cli.json).await,
        Commands::Status => status_command(&config, &api, cli.json).await,
        Commands::Logs(args) => logs_command(&api, args, cli.json).await,
        Commands::Sync => sync_command(&mut config, &api).await,
        Commands::Gateway { .. }
        | Commands::Config { .. }
        | Commands::Prompt { .. }
        | Commands::Init(_)
        | Commands::Upgrade => unreachable!(),
    }
}

fn config_command(
    config: &mut ConfigStore,
    command: &ConfigCommand,
    json_output: bool,
) -> Result<()> {
    match command {
        ConfigCommand::Get { key } if key == "worktree-root" => {
            let value = config.worktree_root()?;
            if json_output {
                emit(json!({ "key": key, "value": value, "source": config.worktree_root_source() }))
            } else {
                println!("{}", value.display());
                Ok(())
            }
        }
        ConfigCommand::Set { key, value } if key == "worktree-root" => {
            let value = if value.is_absolute() {
                value.clone()
            } else {
                env::current_dir()?.join(value)
            };
            config.data_mut().worktree_root = Some(value.clone());
            config.save()?;
            if json_output {
                emit(json!({ "key": key, "value": value }))
            } else {
                println!("Set {key} to {}.", value.display());
                Ok(())
            }
        }
        ConfigCommand::Unset { key } if key == "worktree-root" => {
            config.data_mut().worktree_root = None;
            config.save()?;
            if json_output {
                emit(
                    json!({ "key": key, "value": config.worktree_root()?, "source": config.worktree_root_source() }),
                )
            } else {
                println!("Unset {key}.");
                Ok(())
            }
        }
        ConfigCommand::Get { key }
        | ConfigCommand::Set { key, .. }
        | ConfigCommand::Unset { key } => {
            bail!("Unknown setting {key}. Available settings: worktree-root")
        }
    }
}

async fn worktree_command(
    config: &mut ConfigStore,
    api: &ApiClient,
    command: WorktreeCommand,
    json_output: bool,
) -> Result<()> {
    match command {
        WorktreeCommand::Create {
            branch,
            from_ref,
            reuse_existing_branch,
            project,
            name,
            slug,
            path,
        } => {
            let project = worktrees::resolve_project(config, project.as_deref())?;
            let entry = worktrees::create(
                config,
                &project,
                CreateWorktree {
                    branch,
                    from: from_ref,
                    reuse_existing_branch,
                    name,
                    slug,
                    path,
                    source: None,
                },
            )?;
            persist_worktree(config, api, entry, json_output).await
        }
        WorktreeCommand::Attach {
            path,
            project,
            name,
            slug,
        } => {
            let project = worktrees::resolve_project(config, project.as_deref())?;
            let entry = worktrees::attach(config, &project, &path, name, slug)?;
            persist_worktree(config, api, entry, json_output).await
        }
        WorktreeCommand::List { project, all } => {
            let project_id = if all {
                None
            } else {
                Some(worktrees::resolve_project(config, project.as_deref())?.id)
            };
            let entries: Vec<_> = config
                .data()
                .worktrees
                .iter()
                .filter(|entry| project_id.as_ref().is_none_or(|id| &entry.project_id == id))
                .collect();
            if json_output {
                return emit(serde_json::to_value(entries)?);
            }
            if entries.is_empty() {
                println!("No connected worktrees.");
            }
            for entry in entries {
                let project = config
                    .data()
                    .projects
                    .iter()
                    .find(|project| project.id == entry.project_id)
                    .map_or("removed", |project| project.slug.as_str());
                println!(
                    "{:<20} {:<18} {:<14} {}",
                    entry.slug,
                    project,
                    format!("{:?}", entry.sync_state).to_lowercase(),
                    entry.root.display()
                );
            }
            Ok(())
        }
        WorktreeCommand::Detach { selector } => {
            let mut entry = find_worktree(config, &selector)?;
            entry.sync_state = WorktreeSyncState::Disabled;
            config.upsert_worktree(entry.clone());
            config.save()?;
            match api.remove_worktree(&entry.project_id, &entry.id).await {
                Ok(_) => {
                    config.remove_worktree(&entry.id);
                    config.save()?;
                    if json_output {
                        emit(json!({ "worktree": entry, "outcome": "detached" }))
                    } else {
                        println!("Detached {}. The Git worktree was not changed.", entry.slug);
                        Ok(())
                    }
                }
                Err(error) => {
                    entry.sync_state = WorktreeSyncState::PendingDelete;
                    config.upsert_worktree(entry.clone());
                    config.save()?;
                    if json_output {
                        emit(
                            json!({ "worktree": entry, "outcome": "pendingDelete", "warning": error.to_string() }),
                        )
                    } else {
                        println!(
                            "Detached {} locally. Gateway deletion is pending; run `exeora sync`.",
                            entry.slug
                        );
                        Ok(())
                    }
                }
            }
        }
        WorktreeCommand::Remove {
            selector,
            force,
            delete_branch,
        } => {
            let mut entry = find_worktree(config, &selector)?;
            let project = config
                .data()
                .projects
                .iter()
                .find(|project| project.id == entry.project_id)
                .cloned()
                .context("The parent project is no longer registered")?;
            if worktrees::is_dirty(&entry)? && !force {
                bail!(
                    "{} has uncommitted changes. Pass --force to remove it anyway.",
                    entry.slug
                );
            }
            entry.sync_state = WorktreeSyncState::Removing;
            config.upsert_worktree(entry.clone());
            config.save()?;
            if let Err(error) = worktrees::remove_git_worktree(&project, &entry, force) {
                entry.sync_state = WorktreeSyncState::Active;
                config.upsert_worktree(entry);
                config.save()?;
                return Err(error);
            }
            let branch = entry.branch.clone();
            entry.sync_state = WorktreeSyncState::PendingDelete;
            config.upsert_worktree(entry.clone());
            config.save()?;
            let remote_removed = api
                .remove_worktree(&entry.project_id, &entry.id)
                .await
                .is_ok();
            if remote_removed {
                config.remove_worktree(&entry.id);
                config.save()?;
            }
            if delete_branch {
                let branch = branch
                    .context("The worktree was detached at HEAD, so it has no branch to delete")?;
                worktrees::delete_branch(&project, &branch)?;
            }
            if json_output {
                emit(
                    json!({ "worktree": entry, "outcome": if remote_removed { "removed" } else { "pendingDelete" }, "branchDeleted": delete_branch }),
                )
            } else {
                println!(
                    "Removed {}.{}",
                    entry.slug,
                    if remote_removed {
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

async fn persist_worktree(
    config: &mut ConfigStore,
    api: &ApiClient,
    mut entry: WorktreeEntry,
    json_output: bool,
) -> Result<()> {
    config.upsert_worktree(entry.clone());
    config.save()?;
    let outcome = match api.put_worktree(&entry.project_id, &entry).await {
        Ok(_) => {
            entry.sync_state = WorktreeSyncState::Active;
            config.upsert_worktree(entry.clone());
            config.save()?;
            "active"
        }
        Err(_) => "pendingUpsert",
    };
    if json_output {
        emit(json!({ "worktree": entry, "outcome": outcome }))
    } else {
        println!(
            "Connected {} at {}.{}",
            entry.slug,
            entry.root.display(),
            if outcome == "active" {
                ""
            } else {
                " Gateway sync is pending; run `exeora sync`."
            }
        );
        Ok(())
    }
}

fn find_worktree(config: &ConfigStore, selector: &str) -> Result<WorktreeEntry> {
    if let Some(entry) = config
        .data()
        .worktrees
        .iter()
        .find(|entry| entry.id == selector)
    {
        return Ok(entry.clone());
    }
    let matches: Vec<_> = config
        .data()
        .worktrees
        .iter()
        .filter(|entry| entry.slug.eq_ignore_ascii_case(selector))
        .cloned()
        .collect();
    match matches.as_slice() {
        [] => Err(anyhow!("No worktree called {selector} on this machine.")),
        [entry] => Ok(entry.clone()),
        _ => bail!(
            "Several projects have a worktree called {selector}. Use its wtr_ id from `exeora worktree list --all`."
        ),
    }
}

async fn login_command(
    api: &ApiClient,
    auth: Arc<AuthManager>,
    config: &ConfigStore,
) -> Result<()> {
    cliclack::intro("Exeora")?;
    let _ = auth.login_browser().await?;
    let user = api.me().await?;
    cliclack::log::success(format!("Signed in as {}", user.email))?;
    if using_file_fallback() {
        let parent = config.path().parent().unwrap_or(config.path()).display();
        cliclack::log::warning(format!(
            "No system keychain available, so the session is stored in a 0600 file under {parent}."
        ))?;
    }
    cliclack::outro("Run `exeora connect` to bring this machine online, then `exeora project add` in a directory to serve it.")?;
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
            let devices = api.list_devices().await?;
            if json_output {
                emit(Value::Array(
                    devices
                        .into_iter()
                        .map(|entry| {
                            let this = config.data().device_id.as_deref() == Some(&entry.id);
                            let mut value = serde_json::to_value(&entry).unwrap_or_default();
                            value["online"] = json!(is_online(&entry));
                            value["thisMachine"] = json!(this);
                            value
                        })
                        .collect(),
                ))?;
            } else if devices.is_empty() {
                println!("No devices registered yet.");
            } else {
                for entry in devices {
                    println!(
                        "{:<20} {:<9} {}{}",
                        entry.name,
                        if entry.revoked_at.is_some() {
                            "revoked"
                        } else if is_online(&entry) {
                            "online"
                        } else {
                            "offline"
                        },
                        entry.platform,
                        if config.data().device_id.as_deref() == Some(&entry.id) {
                            "  (this machine)"
                        } else {
                            ""
                        }
                    );
                }
            }
        }
    }
    Ok(())
}

async fn project_command(
    config: &mut ConfigStore,
    api: &ApiClient,
    command: ProjectCommand,
    json_output: bool,
) -> Result<()> {
    match command {
        ProjectCommand::Add { path, slug } => {
            let device = config.data().device_id.clone().ok_or_else(|| {
                anyhow!("This machine is not registered. Run `exeora device register` first.")
            })?;
            let root = project_root(Some(path.unwrap_or_else(|| PathBuf::from("."))))?;
            let name = file_name(&root)?;
            let slug = slug.unwrap_or_else(|| slugify(&name));
            let added = api
                .add_project(&device, &name, &slug, &root.to_string_lossy())
                .await?;
            let entry = ProjectEntry {
                id: added.id,
                slug: added.slug.unwrap_or(slug),
                name: added.name,
                root,
            };
            config.upsert_project(entry.clone());
            config.save()?;
            println!("Added {}.", entry.name);
            println!("{}", project_mcp_url(&config.gateway_url(), &entry.id)?);
        }
        ProjectCommand::List => {
            if json_output {
                emit(Value::Array(
                    config
                        .data()
                        .projects
                        .iter()
                        .map(|entry| project_json(entry, &config.gateway_url()))
                        .collect::<Result<_>>()?,
                ))?;
            } else if config.data().projects.is_empty() {
                println!("No projects yet. Run `exeora project add` in a directory.");
            } else {
                for entry in &config.data().projects {
                    println!("{:<20} {}", entry.slug, entry.root.display());
                    println!(
                        "{:<20} {}",
                        "",
                        project_mcp_url(&config.gateway_url(), &entry.id)?
                    );
                }
            }
        }
        ProjectCommand::Remove { slug } => {
            let entry = config
                .data()
                .projects
                .iter()
                .find(|entry| entry.slug == slug)
                .cloned()
                .ok_or_else(|| anyhow!("No project called {slug} on this machine."))?;
            let _ = api.remove_project(&entry.id).await?;
            config.remove_project(&entry.id);
            config.save()?;
            println!("Removed {slug}.");
        }
    }
    Ok(())
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
            let _ = auth.login_browser().await?;
            api.list_devices().await?
        }
        Err(error) => return Err(error),
    };
    let device = ensure_device(config, api, devices, args.name).await?;
    config.save()?;
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
    )
    .await
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
                && args.worktree.as_ref().is_none_or(|selector| {
                    call.worktree_id.as_deref() == Some(selector)
                        || call
                            .worktree_slug
                            .as_deref()
                            .is_some_and(|slug| slug.eq_ignore_ascii_case(selector))
                        || (selector.eq_ignore_ascii_case("main") && call.worktree_id.is_none())
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
            call.worktree_slug.as_deref().unwrap_or("main"),
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
    let authority: Vec<_> = remote
        .into_iter()
        .filter(|entry| entry.device_id == stored)
        .collect();
    let next: Vec<ProjectEntry> = authority
        .into_iter()
        .map(|entry| ProjectEntry {
            id: entry.id,
            slug: entry.slug,
            name: entry.name,
            root: PathBuf::from(entry.local_path),
        })
        .collect();
    let projects_changed = next != config.data().projects;
    if projects_changed {
        config.data_mut().projects = next;
        config.save()?;
    }
    let pending = config.data().worktrees.clone();
    let mut synced = 0usize;
    let mut recovered = 0usize;
    for mut entry in pending {
        match entry.sync_state {
            WorktreeSyncState::PendingUpsert => {
                if api.put_worktree(&entry.project_id, &entry).await.is_ok() {
                    entry.sync_state = WorktreeSyncState::Active;
                    config.upsert_worktree(entry);
                    synced += 1;
                }
            }
            WorktreeSyncState::PendingDelete | WorktreeSyncState::Disabled => {
                if api
                    .remove_worktree(&entry.project_id, &entry.id)
                    .await
                    .is_ok()
                {
                    config.remove_worktree(&entry.id);
                    synced += 1;
                }
            }
            WorktreeSyncState::Removing => {
                recovered += 1;
                if entry.git_root.exists() {
                    // The process stopped before Git removed the worktree. Make
                    // it routable again instead of leaving it permanently
                    // hidden behind the transient Removing state.
                    entry.sync_state = WorktreeSyncState::Active;
                    config.upsert_worktree(entry);
                } else {
                    // Git removal completed, but the process stopped before the
                    // gateway deletion. Resume that half of the operation.
                    entry.sync_state = WorktreeSyncState::PendingDelete;
                    if api
                        .remove_worktree(&entry.project_id, &entry.id)
                        .await
                        .is_ok()
                    {
                        config.remove_worktree(&entry.id);
                        synced += 1;
                    } else {
                        config.upsert_worktree(entry);
                    }
                }
            }
            WorktreeSyncState::Active => {}
        }
    }
    config.save()?;
    if projects_changed || synced > 0 || recovered > 0 {
        println!(
            "Synchronized projects and {synced} pending worktrees with the gateway; recovered {recovered} interrupted removals."
        );
    } else {
        println!("Already up to date.");
    }
    Ok(())
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

fn project_root(path: Option<PathBuf>) -> Result<PathBuf> {
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

fn slugify(value: &str) -> String {
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
fn file_name(path: &Path) -> Result<String> {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .context("The project path has no directory name")
}
fn project_mcp_url(gateway: &str, id: &str) -> Result<Url> {
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
fn emit(value: Value) -> Result<()> {
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
fn is_online(device: &DeviceView) -> bool {
    device.revoked_at.is_none()
        && device.online.unwrap_or_else(|| {
            device
                .last_seen_at
                .is_some_and(|at| crate::protocol::now_ms().saturating_sub(at) < 90_000)
        })
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
    use super::validate_project_root;
    use std::{fs, path::PathBuf};
    use tempfile::tempdir;

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
