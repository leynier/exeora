use crate::{
    CLI_VERSION,
    api::{ApiClient, DeviceView, ProjectView, ToolCallView},
    auth::{
        AuthManager, clear_credentials, discover_client, load_credentials, using_file_fallback,
    },
    config::{ConfigStore, DEFAULT_GATEWAY, ProjectEntry},
    connection::connect_forever,
    policy::{LocalCommandPolicy, POLICY_FILENAME, PolicyMode, render_policy_toml},
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
    #[command(about = "Serve a directory to your AI clients (signs in and registers as needed)")]
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

#[derive(Debug, Args)]
pub struct ConnectArgs {
    path: Option<PathBuf>,
    #[arg(short, long)]
    slug: Option<String>,
    #[arg(short, long)]
    name: Option<String>,
    #[arg(long = "no-add", action = clap::ArgAction::SetFalse, default_value_t = true)]
    add: bool,
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
        Commands::Connect(args) => connect_command(&mut config, &api, auth, args, cli.json).await,
        Commands::Status => status_command(&config, &api, cli.json).await,
        Commands::Logs(args) => logs_command(&api, args, cli.json).await,
        Commands::Sync => sync_command(&mut config, &api).await,
        Commands::Gateway { .. }
        | Commands::Prompt { .. }
        | Commands::Init(_)
        | Commands::Upgrade => unreachable!(),
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
    cliclack::outro("Run `exeora connect` in a project directory.")?;
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
            let root = absolute(path.unwrap_or_else(|| PathBuf::from(".")))?;
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
                println!("No projects yet. Run `exeora connect` in one.");
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
    if args.add {
        let root = project_root(args.path)?;
        ensure_project(config, api, &device.0, root, args.slug).await?;
    }
    config.save()?;
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
            "{} {:<12} {:<16} {:<20} {}ms",
            if call.status == "ok" { "✓" } else { "✗" },
            call.tool,
            by_id
                .get(call.project_id.as_str())
                .map_or("removed", |entry| entry.slug.as_str()),
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
    if next == config.data().projects {
        println!("Already up to date.");
    } else {
        config.data_mut().projects = next;
        config.save()?;
        println!("Updated local projects from the gateway.");
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

async fn ensure_project(
    config: &mut ConfigStore,
    api: &ApiClient,
    device_id: &str,
    root: PathBuf,
    requested: Option<String>,
) -> Result<ProjectEntry> {
    let remote = api.list_projects().await?;
    if let Some(local) = config
        .data()
        .projects
        .iter()
        .find(|entry| entry.root == root)
        && remote.iter().any(|entry| {
            entry.id == local.id
                && entry.device_id == device_id
                && entry.local_path == root.to_string_lossy()
        })
    {
        return Ok(local.clone());
    }
    let name = file_name(&root)?;
    let local = config
        .data()
        .projects
        .iter()
        .find(|entry| entry.root == root);
    let slug = requested
        .or_else(|| local.map(|entry| entry.slug.clone()))
        .unwrap_or_else(|| unique_slug(&name, &root, &remote));
    let added = api
        .add_project(device_id, &name, &slug, &root.to_string_lossy())
        .await?;
    let entry = ProjectEntry {
        id: added.id,
        slug: added.slug.unwrap_or(slug),
        name: added.name,
        root,
    };
    config.upsert_project(entry.clone());
    println!("Serving {} from {}.", entry.name, entry.root.display());
    Ok(entry)
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
    if env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
        .is_some_and(|home| root.as_os_str() == home)
    {
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

fn unique_slug(name: &str, root: &Path, remote: &[ProjectView]) -> String {
    let base = slugify(name);
    let taken: std::collections::HashSet<_> = remote
        .iter()
        .filter(|entry| Path::new(&entry.local_path) != root)
        .map(|entry| entry.slug.as_str())
        .collect();
    if !taken.contains(base.as_str()) {
        return base;
    }
    (2..100)
        .map(|suffix| format!("{base}-{suffix}"))
        .find(|candidate| !taken.contains(candidate.as_str()))
        .unwrap_or_else(|| format!("{base}-{}", crate::protocol::now_ms()))
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
