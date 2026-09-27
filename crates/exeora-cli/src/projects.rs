//! `exeora project …`: projects, and the places they live.
//!
//! A project is one repository. It lives on as many of the person's machines
//! as they like and on Exeora Cloud, and these commands are the same for all
//! of them: `--on` says where. What a command knows about a project comes
//! from the gateway, which is the one party that sees every location; the
//! local config only says what this machine holds.

use crate::{
    api::{
        ApiClient, GithubRepositoryView, LocationView, MachineView, ProjectRegistration,
        ProjectView,
    },
    cli::{emit, file_name, project_mcp_url, project_root, slugify},
    cloud::commands::{confirm, finish, token_from_stdin, wait_ready},
    config::{ConfigStore, ProjectEntry},
    repo::{
        checkout_root, default_branch_of, https_repository_url, origin_of, repository_key,
        repository_name,
    },
    workspace::clone::{CloneContext, Credential, Repository, prepare_project},
};
use anyhow::{Context, Result, anyhow, bail};
use clap::{Args, Subcommand};
use serde_json::{Value, json};
use std::{
    io::IsTerminal,
    path::{Path, PathBuf},
};
use tokio_util::sync::CancellationToken;
use unicode_normalization::UnicodeNormalization;

const CLOUD: &str = "cloud";
const CLOUD_NAME: &str = "Exeora Cloud";
/// What `--on` takes for the machine the command runs on, whatever its name.
const HERE: &str = "here";
const PICKER_LIMIT: usize = 100;

#[derive(Debug, Subcommand)]
pub enum ProjectCommand {
    #[command(
        about = "Add a directory or a repository as a project",
        long_about = "Add a directory or a repository as a project.\n\nTARGET is a directory on this machine, the address of a repository, or owner/repo on GitHub. A directory is registered where it is. A repository is cloned into this machine's projects folder (see `exeora config get projects-root`), or put on Exeora Cloud with `--on cloud`. Without a TARGET, the current directory is added when it is inside a checkout; otherwise, with GitHub connected, a repository is picked from a list."
    )]
    Add(ProjectAddArgs),
    #[command(about = "List your projects and where each one lives")]
    List,
    #[command(about = "Remove a project from Exeora, everywhere it lives")]
    Remove {
        #[arg(help = "Project slug or id")]
        slug: String,
        #[arg(short = 'y', long, help = "Do not ask first")]
        yes: bool,
    },
    #[command(
        about = "List, add or remove the places a project lives",
        args_conflicts_with_subcommands = true
    )]
    Locations {
        #[arg(help = "Project slug or id")]
        slug: Option<String>,
        #[command(subcommand)]
        command: Option<LocationsCommand>,
    },
    #[command(about = "Choose the location that calls naming no workspace land on")]
    Default {
        #[arg(help = "Project slug or id")]
        slug: String,
        #[arg(long = "on", value_name = "MACHINE|cloud")]
        on: String,
    },
    #[command(
        about = "Replace or remove the repository token Exeora Cloud clones a project with",
        long_about = "Replace or remove the repository token Exeora Cloud clones a project with. Machines created or retried from now on use it; the ones already running keep the token they were set up with."
    )]
    Credential {
        #[arg(help = "Project slug or id")]
        slug: String,
        #[arg(
            long,
            conflicts_with = "remove",
            help = "Read the new repository access token from stdin"
        )]
        token_stdin: bool,
        #[arg(
            long,
            default_value = "x-access-token",
            help = "The username the token goes with"
        )]
        username: String,
        #[arg(
            long,
            alias = "clear",
            help = "Remove the stored token: clone as a public repository"
        )]
        remove: bool,
    },
}

#[derive(Debug, Args)]
pub struct ProjectAddArgs {
    #[arg(
        value_name = "TARGET",
        help = "A directory, the address of a repository, or owner/repo on GitHub"
    )]
    target: Option<String>,
    #[arg(
        short,
        long,
        help = "Display name; the directory's or repository's by default"
    )]
    name: Option<String>,
    #[arg(short, long, help = "Project slug; derived from the name by default")]
    slug: Option<String>,
    #[arg(
        long = "on",
        value_name = "MACHINE|cloud",
        help = "Where a repository goes: this machine by default, or `cloud`"
    )]
    on: Option<String>,
    #[arg(
        long,
        help = "The project's default branch; the repository's by default"
    )]
    branch: Option<String>,
    #[arg(
        long,
        help = "Read a repository access token from stdin, for a private repository on Exeora Cloud"
    )]
    token_stdin: bool,
    #[arg(
        long,
        default_value = "x-access-token",
        help = "The username the token goes with"
    )]
    username: String,
    #[arg(short = 'y', long, help = "Do not ask first")]
    yes: bool,
}

#[derive(Debug, Subcommand)]
pub enum LocationsCommand {
    #[command(about = "Let a project live on another machine, or on Exeora Cloud")]
    Add {
        #[arg(help = "Project slug or id")]
        slug: String,
        #[arg(long = "on", value_name = "MACHINE|cloud")]
        on: String,
        #[arg(
            long,
            help = "Read a repository access token from stdin, for a private repository on Exeora Cloud"
        )]
        token_stdin: bool,
        #[arg(
            long,
            default_value = "x-access-token",
            help = "The username the token goes with"
        )]
        username: String,
    },
    #[command(about = "Take a project off one of the places it lives")]
    Remove {
        #[arg(help = "Project slug or id")]
        slug: String,
        #[arg(long = "on", value_name = "MACHINE|cloud")]
        on: String,
        #[arg(short = 'y', long, help = "Do not ask first")]
        yes: bool,
    },
}

pub async fn run(
    config: &mut ConfigStore,
    api: &ApiClient,
    command: ProjectCommand,
    json_output: bool,
) -> Result<()> {
    match command {
        ProjectCommand::Add(args) => add(config, api, args, json_output).await,
        ProjectCommand::List => list(config, api, json_output).await,
        ProjectCommand::Remove { slug, yes } => remove(config, api, &slug, yes, json_output).await,
        ProjectCommand::Locations {
            slug: Some(slug),
            command: None,
        } => locations(config, api, &slug, json_output).await,
        ProjectCommand::Locations {
            command:
                Some(LocationsCommand::Add {
                    slug,
                    on,
                    token_stdin,
                    username,
                }),
            ..
        } => add_location(config, api, &slug, &on, token_stdin, &username, json_output).await,
        ProjectCommand::Locations {
            command: Some(LocationsCommand::Remove { slug, on, yes }),
            ..
        } => remove_location(config, api, &slug, &on, yes, json_output).await,
        ProjectCommand::Locations {
            slug: None,
            command: None,
        } => bail!(
            "Name a project: `exeora project locations <slug>`. See `exeora project list` for the slugs."
        ),
        ProjectCommand::Default { slug, on } => {
            set_default(config, api, &slug, &on, json_output).await
        }
        ProjectCommand::Credential {
            slug,
            token_stdin,
            username,
            remove,
        } => credential(api, &slug, token_stdin, &username, remove, json_output).await,
    }
}

/// Whether there is a person at a terminal to ask. Never in `--json`, and
/// never when either end is a pipe.
pub fn can_ask(json_output: bool) -> bool {
    !json_output && std::io::stdin().is_terminal() && std::io::stdout().is_terminal()
}

/// What a TARGET names.
#[derive(Debug, PartialEq, Eq)]
enum Target {
    Directory(PathBuf),
    /// The address of a repository, in whatever form it was written.
    Repository(String),
}

/// A directory that exists is a directory, whatever else it could be read
/// as. After that, an address of a repository, then `owner/repo`.
fn classify(target: &str) -> Target {
    let text = target.trim();
    let written_as_a_path = text.starts_with(['.', '/', '~']) || text.contains('\\');
    if written_as_a_path || Path::new(text).exists() {
        return Target::Directory(PathBuf::from(text));
    }
    if repository_key(text).is_some() {
        return Target::Repository(text.to_owned());
    }
    let mut segments = text.split('/');
    let is_segment = |segment: Option<&str>| {
        segment.is_some_and(|segment| {
            !segment.is_empty()
                && segment
                    .chars()
                    .all(|character| character.is_ascii_alphanumeric() || "-_.".contains(character))
        })
    };
    if is_segment(segments.next()) && is_segment(segments.next()) && segments.next().is_none() {
        return Target::Repository(format!("https://github.com/{text}"));
    }
    Target::Directory(PathBuf::from(text))
}

/// Where a repository is to go.
enum Place {
    Here,
    Cloud,
    Machine(String),
}

fn place(config: &ConfigStore, on: Option<&str>) -> Place {
    match on.map(str::trim) {
        None => Place::Here,
        Some(on) if on.eq_ignore_ascii_case(CLOUD) => Place::Cloud,
        Some(on) if names_this_machine(config, on) => Place::Here,
        Some(on) => Place::Machine(on.to_owned()),
    }
}

/// A machine's name as a selector, the way the gateway writes it:
/// `locationSlug` in `apps/gateway/src/locations.ts`.
pub fn location_slug(name: &str) -> String {
    let mut slug = String::new();
    let mut gap = false;
    for character in name.to_lowercase().nfkd() {
        if character.is_ascii_lowercase() || character.is_ascii_digit() {
            if gap && !slug.is_empty() {
                slug.push('-');
            }
            gap = false;
            slug.push(character);
        } else {
            gap = true;
        }
    }
    let slug: String = slug.chars().take(60).collect();
    if slug.is_empty() || slug == CLOUD || slug == "main" {
        return format!(
            "{}-machine",
            if slug.is_empty() { "machine" } else { &slug }
        );
    }
    slug
}

pub fn names_this_machine(config: &ConfigStore, selector: &str) -> bool {
    let selector = selector.trim();
    let data = config.data();
    selector.eq_ignore_ascii_case(HERE)
        || data.device_id.as_deref() == Some(selector)
        || data.device_name.as_deref().is_some_and(|name| {
            name.eq_ignore_ascii_case(selector) || location_slug(name) == selector.to_lowercase()
        })
}

pub fn find_location<'a>(
    config: &ConfigStore,
    locations: &'a [LocationView],
    selector: &str,
) -> Option<&'a LocationView> {
    let selector = selector.trim();
    if names_this_machine(config, selector)
        && let Some(device_id) = &config.data().device_id
        && let Some(location) = locations
            .iter()
            .find(|location| location.device_id.as_ref() == Some(device_id))
    {
        return Some(location);
    }
    locations.iter().find(|location| {
        location.id == selector
            || location.device_id.as_deref() == Some(selector)
            || location.slug.eq_ignore_ascii_case(selector)
            || location.name.eq_ignore_ascii_case(selector)
            || (location.is_cloud() && selector.eq_ignore_ascii_case(CLOUD))
    })
}

pub fn location_names(locations: &[LocationView]) -> String {
    if locations.is_empty() {
        return "none".to_owned();
    }
    locations
        .iter()
        .map(|location| location.slug.as_str())
        .collect::<Vec<_>>()
        .join(", ")
}

pub async fn find_project(api: &ApiClient, selector: &str) -> Result<ProjectView> {
    api.list_projects()
        .await?
        .into_iter()
        .find(|project| project.id == selector || project.slug.eq_ignore_ascii_case(selector))
        .ok_or_else(|| anyhow!("No project called {selector}. See `exeora project list`."))
}

/// One of the person's own machines, by name, slug or id.
async fn find_machine(
    api: &ApiClient,
    config: &ConfigStore,
    selector: &str,
) -> Result<MachineView> {
    let selector = selector.trim();
    let here = names_this_machine(config, selector);
    let machines: Vec<_> = api
        .list_machines()
        .await?
        .into_iter()
        .filter(|machine| machine.kind == "local" && machine.revoked_at.is_none())
        .collect();
    let names = machines
        .iter()
        .map(|machine| location_slug(&machine.name))
        .collect::<Vec<_>>()
        .join(", ");
    machines
        .into_iter()
        .find(|machine| {
            if here {
                return config.data().device_id.as_deref() == Some(&machine.device_id);
            }
            machine.device_id == selector
                || machine.name.eq_ignore_ascii_case(selector)
                || location_slug(&machine.name) == selector.to_lowercase()
        })
        .ok_or_else(|| {
            anyhow!(
                "No machine called {selector}. Your machines are: {}. Run `exeora connect` on a machine to register it.",
                if names.is_empty() { "none" } else { &names }
            )
        })
}

fn this_device(config: &ConfigStore) -> Result<String> {
    config.data().device_id.clone().ok_or_else(|| {
        anyhow!("This machine is not registered. Run `exeora connect` first, then try again.")
    })
}

async fn add(
    config: &mut ConfigStore,
    api: &ApiClient,
    mut args: ProjectAddArgs,
    json_output: bool,
) -> Result<()> {
    let target = match args.target.take() {
        Some(target) => classify(&target),
        None => {
            let inside_a_checkout = std::env::current_dir()
                .ok()
                .and_then(|cwd| checkout_root(&cwd))
                .is_some();
            if !inside_a_checkout && can_ask(json_output) && api.github().await?.connected {
                let picked = pick_repository(api).await?;
                if args.branch.is_none() {
                    args.branch = picked.default_branch.clone();
                }
                if args.on.is_none() {
                    args.on = Some(pick_place(config)?);
                }
                // Chosen from a list and placed by hand: that was the asking.
                args.yes = true;
                Target::Repository(picked.url)
            } else {
                Target::Directory(PathBuf::from("."))
            }
        }
    };
    match target {
        Target::Directory(path) => add_directory(config, api, path, args, json_output).await,
        Target::Repository(url) => match place(config, args.on.as_deref()) {
            Place::Here => clone_here(config, api, &url, args, json_output).await,
            Place::Cloud => add_to_cloud(api, &url, args, json_output).await,
            Place::Machine(machine) => {
                add_on_machine(config, api, &url, &machine, json_output).await
            }
        },
    }
}

async fn pick_repository(api: &ApiClient) -> Result<GithubRepositoryView> {
    let repositories = api.github_repositories("", PICKER_LIMIT).await?;
    if repositories.is_empty() {
        bail!(
            "GitHub is connected, but Exeora was given no repository. Choose the repositories it may read in the Exeora dashboard, or pass one: `exeora project add owner/repo`."
        );
    }
    let mut picker = cliclack::select("Which repository?").filter_mode();
    for (index, repository) in repositories.iter().enumerate() {
        let label = if repository.private {
            format!("{} 🔒", repository.full_name)
        } else {
            repository.full_name.clone()
        };
        let hint = if repository.project_id.is_some() {
            "already a project"
        } else {
            ""
        };
        picker = picker.item(index, label, hint);
    }
    let picked = picker.interact()?;
    repositories
        .into_iter()
        .nth(picked)
        .context("The picker answered with a repository that is not in the list")
}

fn pick_place(config: &ConfigStore) -> Result<String> {
    let machine = config
        .data()
        .device_name
        .clone()
        .unwrap_or_else(|| "this machine".to_owned());
    let root = config.projects_root()?;
    Ok(cliclack::select("Where should it live?")
        .item(
            HERE.to_owned(),
            format!("On {machine}"),
            format!("cloned into {}", root.display()),
        )
        .item(
            CLOUD.to_owned(),
            format!("On {CLOUD_NAME}"),
            "a machine Exeora runs for you",
        )
        .interact()?)
}

fn said(location: Option<&str>, name: &str) -> String {
    match location {
        Some("joined") => {
            format!("{name} already exists; this machine is now one of its locations.")
        }
        Some("updated") => {
            format!("{name} was already registered on this machine; it is up to date.")
        }
        _ => format!("Added {name}."),
    }
}

fn entry_json(entry: &ProjectEntry, gateway: &str) -> Result<Value> {
    Ok(json!({
        "id": entry.id,
        "slug": entry.slug,
        "name": entry.name,
        "root": entry.root,
        "repoUrl": entry.repo_url,
        "defaultBranch": entry.default_branch,
        "mcpUrl": project_mcp_url(gateway, &entry.id)?,
    }))
}

fn report_added(
    config: &ConfigStore,
    entry: &ProjectEntry,
    location: Option<&str>,
    adopted: Option<bool>,
    json_output: bool,
) -> Result<()> {
    let gateway = config.gateway_url();
    if json_output {
        let mut value = json!({
            "project": entry_json(entry, &gateway)?,
            "location": location.unwrap_or("created"),
        });
        if let Some(adopted) = adopted {
            value["adopted"] = json!(adopted);
        }
        return emit(value);
    }
    println!("{}", said(location, &entry.name));
    match adopted {
        Some(true) => println!(
            "Took the checkout that was already at {}.",
            entry.root.display()
        ),
        Some(false) => println!("Cloned into {}.", entry.root.display()),
        None => {}
    }
    println!("{}", project_mcp_url(&gateway, &entry.id)?);
    Ok(())
}

async fn add_directory(
    config: &mut ConfigStore,
    api: &ApiClient,
    path: PathBuf,
    args: ProjectAddArgs,
    json_output: bool,
) -> Result<()> {
    if args.on.is_some() && !matches!(place(config, args.on.as_deref()), Place::Here) {
        bail!(
            "A directory is added from the machine it is on. To put the project somewhere else, pass the address of its repository instead of a path."
        );
    }
    if args.token_stdin {
        bail!(
            "--token-stdin is for a repository on Exeora Cloud. A directory on this machine uses the git credentials of this machine."
        );
    }
    let device = this_device(config)?;
    let root = project_root(Some(path))?;
    // A project that is a folder inside a checkout is that folder, not the
    // repository: another machine that cloned the repository would hold
    // something else. Only the top of a checkout says which repository it is.
    let is_checkout_top = checkout_root(&root)
        .and_then(|top| std::fs::canonicalize(top).ok())
        .is_some_and(|top| top == root);
    let repo_url = is_checkout_top
        .then(|| origin_of(&root))
        .flatten()
        .and_then(|origin| https_repository_url(&origin));
    let default_branch = args.branch.or_else(|| {
        repo_url
            .is_some()
            .then(|| default_branch_of(&root))
            .flatten()
    });
    let name = match args.name {
        Some(name) => name,
        None => file_name(&root)?,
    };
    let slug = args.slug.unwrap_or_else(|| slugify(&name));
    let added = api
        .add_project(ProjectRegistration {
            device_id: &device,
            name: &name,
            slug: &slug,
            local_path: &root.to_string_lossy(),
            repo_url: repo_url.as_deref(),
            default_branch: default_branch.as_deref(),
        })
        .await?;
    // From the answer, not from what was sent: a machine that joined a
    // project takes the id, slug and name that project already has.
    let entry = ProjectEntry {
        id: added.id,
        slug: added.slug.unwrap_or(slug),
        name: added.name,
        root,
        repo_url,
        default_branch,
    };
    config.upsert_project(entry.clone());
    config.save()?;
    report_added(config, &entry, added.location.as_deref(), None, json_output)
}

/// Registers the repository, clones it into the projects folder and says
/// where the copy is.
///
/// Registered before it is cloned, not after: the token Exeora makes for a
/// clone is made for a project, so the project has to exist for the clone to
/// have one. A project this command made is removed again when the clone
/// fails, so a repository that could not be cloned leaves nothing behind.
async fn clone_here(
    config: &mut ConfigStore,
    api: &ApiClient,
    url: &str,
    args: ProjectAddArgs,
    json_output: bool,
) -> Result<()> {
    if args.token_stdin {
        bail!(
            "--token-stdin is for a repository on Exeora Cloud. On this machine a clone uses the GitHub connection of your account or the git credentials that are here."
        );
    }
    let device = this_device(config)?;
    let address = https_repository_url(url)
        .ok_or_else(|| anyhow!("{url} is not the address of a repository."))?;
    let key = repository_key(url);
    let existing = api.list_projects().await?.into_iter().find(|project| {
        project
            .repo_url
            .as_deref()
            .and_then(repository_key)
            .is_some_and(|found| Some(found) == key)
    });
    if let Some(project) = &existing
        && let Some(entry) = config.find_project(&project.id)
        && entry.root.is_dir()
    {
        let entry = entry.clone();
        if json_output {
            return emit(json!({
                "project": entry_json(&entry, &config.gateway_url())?,
                "location": "updated",
                "adopted": true,
            }));
        }
        println!(
            "{} is already on this machine, at {}.",
            entry.name,
            entry.root.display()
        );
        return Ok(());
    }

    let name = args
        .name
        .or_else(|| existing.as_ref().map(|project| project.name.clone()))
        .or_else(|| repository_name(url))
        .ok_or_else(|| anyhow!("{url} names no repository."))?;
    let slug = args
        .slug
        .or_else(|| existing.as_ref().map(|project| project.slug.clone()))
        .unwrap_or_else(|| slugify(&name));
    let destination = config.projects_root()?.join(&slug);
    if can_ask(json_output)
        && !args.yes
        && !cliclack::confirm(format!("Clone {name} into {}?", destination.display()))
            .initial_value(true)
            .interact()?
    {
        println!("Nothing was added.");
        return Ok(());
    }

    let registered = api
        .add_project(ProjectRegistration {
            device_id: &device,
            name: &name,
            slug: &slug,
            local_path: &destination.to_string_lossy(),
            repo_url: Some(&address),
            default_branch: args.branch.as_deref(),
        })
        .await?;
    let made_here = registered.location.as_deref() == Some("created");
    // A gateway that cannot say whether the account is connected is treated
    // as one where it is not: the machine's own credentials are still tried.
    let connected = api.github().await.is_ok_and(|github| github.connected);
    let repository = Repository {
        url: address.clone(),
        default_branch: args.branch.clone(),
        slug: registered.slug.clone().unwrap_or(slug),
        name: registered.name.clone(),
        credential: if connected {
            Credential::Exeora
        } else {
            Credential::Machine
        },
    };
    if !json_output {
        println!(
            "Cloning {} into {}…",
            repository.name,
            config.projects_root()?.join(&repository.slug).display()
        );
    }
    let context = CloneContext::for_machine(config.path(), api, &registered.id, None)
        .map_err(|error| anyhow!(error.message))?;
    let prepared = match prepare_project(
        context,
        &registered.id,
        repository,
        CancellationToken::new(),
    )
    .await
    {
        Ok(prepared) => prepared,
        Err(error) => {
            if made_here {
                let _ = api.remove_project(&registered.id).await;
            }
            return Err(anyhow!(error.message));
        }
    };

    // The clone wrote the project into the file; this copy is from before.
    *config = ConfigStore::load_from(config.path().to_path_buf())?;
    let entry = config
        .find_project(&registered.id)
        .cloned()
        .context("The project was cloned but is missing from the local configuration")?;
    // Said again now that the copy is there, with what only the copy could
    // tell: where it ended up, and the branch the repository calls its default.
    let _ = api
        .add_project(ProjectRegistration {
            device_id: &device,
            name: &entry.name,
            slug: &entry.slug,
            local_path: &entry.root.to_string_lossy(),
            repo_url: Some(&address),
            default_branch: entry.default_branch.as_deref(),
        })
        .await;
    report_added(
        config,
        &entry,
        registered.location.as_deref(),
        Some(prepared.adopted),
        json_output,
    )
}

async fn add_to_cloud(
    api: &ApiClient,
    url: &str,
    args: ProjectAddArgs,
    json_output: bool,
) -> Result<()> {
    let address = https_repository_url(url)
        .ok_or_else(|| anyhow!("{url} is not the address of a repository."))?;
    let name = args
        .name
        .or_else(|| repository_name(url))
        .ok_or_else(|| anyhow!("{url} names no repository."))?;
    let slug = args.slug.unwrap_or_else(|| slugify(&name));
    if can_ask(json_output)
        && !args.yes
        && !cliclack::confirm(format!(
            "Put {name} on a machine {CLOUD_NAME} runs for you?"
        ))
        .initial_value(true)
        .interact()?
    {
        println!("Nothing was added.");
        return Ok(());
    }
    let mut body = json!({ "name": name, "slug": slug, "repoUrl": address });
    // Left out when nobody named one: the gateway asks the repository.
    if let Some(branch) = args.branch {
        body["defaultBranch"] = json!(branch);
    }
    if args.token_stdin {
        body["token"] = json!(token_from_stdin()?);
        body["username"] = json!(args.username);
    }
    let created = api.cloud_add_project(body).await?;
    if !json_output {
        println!("Creating {slug} on a new machine…");
    }
    let machine = wait_ready(api, &created.device_id, json_output).await?;
    finish(json_output, "project", &slug, &machine)
}

async fn add_on_machine(
    config: &ConfigStore,
    api: &ApiClient,
    url: &str,
    machine: &str,
    json_output: bool,
) -> Result<()> {
    let key = repository_key(url);
    let project = api
        .list_projects()
        .await?
        .into_iter()
        .find(|project| {
            project
                .repo_url
                .as_deref()
                .and_then(repository_key)
                .is_some_and(|found| Some(found) == key)
        })
        .ok_or_else(|| {
            anyhow!(
                "That repository is not a project yet, and a project starts on the machine that adds it or on Exeora Cloud. Run `exeora project add {url}` on {machine}, or add it here and then run `exeora project locations add <slug> --on {machine}`."
            )
        })?;
    add_location(
        config,
        api,
        &project.slug,
        machine,
        false,
        "x-access-token",
        json_output,
    )
    .await
}

fn describe_location(config: &ConfigStore, location: &LocationView) -> String {
    let here = location.device_id.is_some() && location.device_id == config.data().device_id;
    let name = if here {
        format!("{} (this machine)", location.name)
    } else {
        location.name.clone()
    };
    let mut line = format!(
        "  {} {:<32} {:<12} {}",
        if location.is_default { "*" } else { " " },
        name,
        if location.state.is_empty() {
            &location.status
        } else {
            &location.state
        },
        location.local_path.as_deref().unwrap_or("")
    );
    line.truncate(line.trim_end().len());
    if let Some(error) = location.error.as_deref().filter(|error| !error.is_empty()) {
        line.push_str(&format!("\n      {error}"));
    }
    line
}

async fn list(config: &ConfigStore, api: &ApiClient, json_output: bool) -> Result<()> {
    if json_output {
        return emit(Value::Array(api.list_projects_raw().await?));
    }
    let projects = api.list_projects().await?;
    if projects.is_empty() {
        println!(
            "No projects yet. Run `exeora project add` in a directory, or `exeora project add owner/repo`."
        );
        return Ok(());
    }
    for project in projects {
        let repository = project
            .repo_url
            .as_deref()
            .and_then(repository_key)
            .or_else(|| project.repo_url.clone())
            .unwrap_or_else(|| "no repository".to_owned());
        match &project.default_branch {
            Some(branch) => println!("{:<20} {repository} ({branch})", project.slug),
            None => println!("{:<20} {repository}", project.slug),
        }
        for location in &project.locations {
            println!("{}", describe_location(config, location));
        }
        println!("  {}", project.mcp_url);
    }
    Ok(())
}

async fn remove(
    config: &mut ConfigStore,
    api: &ApiClient,
    selector: &str,
    yes: bool,
    json_output: bool,
) -> Result<()> {
    let project = match find_project(api, selector).await {
        Ok(project) => project,
        Err(error) => {
            // Known here and not to the gateway: all that is left of it is
            // the local entry, which nothing can serve.
            let Some(entry) = config
                .data()
                .projects
                .iter()
                .find(|entry| entry.id == selector || entry.slug.eq_ignore_ascii_case(selector))
                .cloned()
            else {
                return Err(error);
            };
            config.remove_project(&entry.id);
            config.save()?;
            if json_output {
                return emit(json!({ "removed": "project", "slug": entry.slug, "locations": [] }));
            }
            println!(
                "Exeora no longer knew {}; forgot it on this machine. The files at {} were not deleted.",
                entry.slug,
                entry.root.display()
            );
            return Ok(());
        }
    };
    let on_cloud = project.locations.iter().any(LocationView::is_cloud);
    let mut question = if project.locations.len() > 1 {
        format!(
            "Remove {} from all {} of its locations ({})? Files on your machines are not deleted.",
            project.slug,
            project.locations.len(),
            location_names(&project.locations)
        )
    } else {
        format!(
            "Remove {}? Exeora stops serving it; files on your machines are not deleted.",
            project.slug
        )
    };
    if on_cloud {
        question.push_str(
            " Its machines on Exeora Cloud are taken down, and anything not pushed from them is lost.",
        );
    }
    if !confirm(yes, json_output, &question)? {
        return Ok(());
    }
    let _ = api.remove_project(&project.id).await?;
    config.remove_project(&project.id);
    config.save()?;
    if json_output {
        return emit(json!({
            "removed": "project",
            "slug": project.slug,
            "locations": project.locations.iter().map(|location| &location.slug).collect::<Vec<_>>(),
        }));
    }
    println!(
        "Removed {}.{}",
        project.slug,
        if on_cloud {
            " Its machines on Exeora Cloud are being taken down."
        } else {
            ""
        }
    );
    Ok(())
}

fn report_locations(
    config: &ConfigStore,
    project: &ProjectView,
    locations: &[LocationView],
    json_output: bool,
) -> Result<()> {
    if json_output {
        return emit(json!({ "project": project.slug, "locations": locations }));
    }
    for location in locations {
        println!("{}", describe_location(config, location));
    }
    Ok(())
}

async fn locations(
    config: &ConfigStore,
    api: &ApiClient,
    selector: &str,
    json_output: bool,
) -> Result<()> {
    let project = find_project(api, selector).await?;
    let locations = api.list_locations(&project.id).await?;
    if !json_output {
        println!("{}", project.slug);
    }
    report_locations(config, &project, &locations, json_output)
}

async fn add_location(
    config: &ConfigStore,
    api: &ApiClient,
    selector: &str,
    on: &str,
    token_stdin: bool,
    username: &str,
    json_output: bool,
) -> Result<()> {
    let project = find_project(api, selector).await?;
    let (body, name) = if on.trim().eq_ignore_ascii_case(CLOUD) {
        let mut body = json!({ "kind": "cloud" });
        if token_stdin {
            body["token"] = json!(token_from_stdin()?);
            body["username"] = json!(username);
        }
        (body, CLOUD_NAME.to_owned())
    } else {
        if token_stdin {
            bail!(
                "--token-stdin is for Exeora Cloud. A machine of yours clones with the GitHub connection of your account or its own git credentials."
            );
        }
        let machine = find_machine(api, config, on).await?;
        (json!({ "deviceId": machine.device_id }), machine.name)
    };
    let locations = api.add_location(&project.id, body).await?;
    if !json_output {
        println!(
            "{} can now live on {name}. It is cloned there the first time a workspace is made on it.",
            project.slug
        );
    }
    report_locations(config, &project, &locations, json_output)
}

async fn remove_location(
    config: &mut ConfigStore,
    api: &ApiClient,
    selector: &str,
    on: &str,
    yes: bool,
    json_output: bool,
) -> Result<()> {
    let project = find_project(api, selector).await?;
    let location = find_location(config, &project.locations, on)
        .cloned()
        .ok_or_else(|| {
            anyhow!(
                "{} does not live on {on}. Its locations are: {}.",
                project.slug,
                location_names(&project.locations)
            )
        })?;
    let question = if location.is_cloud() {
        format!(
            "Take {} off {CLOUD_NAME}? Its machines there are taken down, and anything not pushed from them is lost.",
            project.slug
        )
    } else {
        format!(
            "Take {} off {}? Exeora forgets the copy and its workspaces there; the files are not deleted.",
            project.slug, location.name
        )
    };
    if !confirm(yes, json_output, &question)? {
        return Ok(());
    }
    let _ = api.remove_location(&project.id, &location.id).await?;
    if location.device_id.is_some() && location.device_id == config.data().device_id {
        config.remove_project(&project.id);
        config.save()?;
    }
    if json_output {
        return emit(
            json!({ "removed": "location", "project": project.slug, "location": location.slug }),
        );
    }
    println!("{} no longer lives on {}.", project.slug, location.name);
    Ok(())
}

async fn set_default(
    config: &ConfigStore,
    api: &ApiClient,
    selector: &str,
    on: &str,
    json_output: bool,
) -> Result<()> {
    let project = find_project(api, selector).await?;
    let location = find_location(config, &project.locations, on).ok_or_else(|| {
        anyhow!(
            "{} does not live on {on}. Its locations are: {}. Add one with `exeora project locations add {} --on {on}`.",
            project.slug,
            location_names(&project.locations),
            project.slug
        )
    })?;
    let locations = api.set_default_location(&project.id, &location.id).await?;
    if !json_output {
        println!(
            "Calls to {} that name no workspace now go to {}.",
            project.slug, location.name
        );
    }
    report_locations(config, &project, &locations, json_output)
}

async fn credential(
    api: &ApiClient,
    selector: &str,
    token_stdin: bool,
    username: &str,
    remove: bool,
    json_output: bool,
) -> Result<()> {
    if !token_stdin && !remove {
        bail!("Pass --token-stdin with the new token on stdin, or --remove to remove it.");
    }
    let project = find_project(api, selector).await?;
    let body = if remove {
        json!({ "token": null })
    } else {
        json!({ "token": token_from_stdin()?, "username": username })
    };
    api.cloud_set_credential(&project.id, body).await?;
    if json_output {
        println!(
            "{}",
            json!({ "credential": if remove { "cleared" } else { "set" }, "slug": project.slug, "appliesTo": "new_machines" })
        );
    } else if remove {
        println!(
            "✓ Token removed. New machines of {} clone without one.",
            project.slug
        );
    } else {
        println!(
            "✓ Token saved for {}. Machines created or retried from now on use it.",
            project.slug
        );
    }
    Ok(())
}

/// The project on this machine that a command names, cloned first when this
/// machine is one of its locations and holds no copy yet.
pub async fn local_project(
    config: &mut ConfigStore,
    api: &ApiClient,
    selector: Option<&str>,
    json_output: bool,
) -> Result<ProjectEntry> {
    let unknown = match crate::workspaces::resolve_project(config, selector) {
        Ok(project) if project.root.is_dir() => return Ok(project),
        Ok(project) => anyhow!(
            "The directory of {} is no longer at {}.",
            project.slug,
            project.root.display()
        ),
        Err(error) => error,
    };
    let Some(selector) = selector else {
        return Err(unknown);
    };
    let device = this_device(config)?;
    let Ok(project) = find_project(api, selector).await else {
        return Err(unknown);
    };
    if project.location_on(&device).is_none() {
        bail!(
            "{} does not live on this machine. Its locations are: {}. Pass --on with one of them, or add this machine with `exeora project locations add {} --on {HERE}`.",
            project.slug,
            location_names(&project.locations),
            project.slug
        );
    }
    let url = project.repo_url.clone().ok_or_else(|| {
        anyhow!(
            "{} has no repository, so it cannot be cloned onto this machine. Give its checkout a remote and run `exeora sync` where it lives.",
            project.slug
        )
    })?;
    let connected = api.github().await.is_ok_and(|github| github.connected);
    if !json_output {
        println!(
            "{} is not on this machine yet. Cloning it into {}…",
            project.slug,
            config.projects_root()?.join(&project.slug).display()
        );
    }
    let context = CloneContext::for_machine(config.path(), api, &project.id, None)
        .map_err(|error| anyhow!(error.message))?;
    prepare_project(
        context,
        &project.id,
        Repository {
            url,
            default_branch: project.default_branch.clone(),
            slug: project.slug.clone(),
            name: project.name.clone(),
            credential: if connected {
                Credential::Exeora
            } else {
                Credential::Machine
            },
        },
        CancellationToken::new(),
    )
    .await
    .map_err(|error| anyhow!(error.message))?;
    *config = ConfigStore::load_from(config.path().to_path_buf())?;
    config
        .find_project(&project.id)
        .cloned()
        .context("The project was cloned but is missing from the local configuration")
}

#[cfg(test)]
mod tests {
    use super::{
        ProjectAddArgs, ProjectCommand, Target, classify, find_location, local_project,
        location_slug, names_this_machine, run, said,
    };
    use crate::{
        api::LocationView,
        config::{ConfigStore, ProjectEntry},
        testing::{Gateway, listed_location, listed_project},
    };
    use serde_json::json;
    use std::{
        fs,
        path::{Path, PathBuf},
        process::Command,
    };
    use tempfile::tempdir;

    fn git(cwd: &Path, args: &[&str]) {
        let output = Command::new("git")
            .arg("-C")
            .arg(cwd)
            .args(args)
            .output()
            .expect("git");
        assert!(output.status.success(), "git {}", args.join(" "));
    }

    /// A checkout of `github.com/Acme/API` with nothing in it, which is all a
    /// command needs to see to know which repository it is.
    fn checkout(path: &Path) -> PathBuf {
        fs::create_dir_all(path).expect("checkout");
        git(path, &["init", "--quiet"]);
        git(
            path,
            &["remote", "add", "origin", "git@github.com:Acme/API.git"],
        );
        git(
            path,
            &[
                "symbolic-ref",
                "refs/remotes/origin/HEAD",
                "refs/remotes/origin/trunk",
            ],
        );
        fs::canonicalize(path).expect("path")
    }

    fn machine(temp: &Path) -> ConfigStore {
        let mut config = ConfigStore::load_from(temp.join("config.json")).expect("config");
        config.data_mut().device_id = Some("dev_here".to_owned());
        config.data_mut().device_name = Some("laptop".to_owned());
        config.data_mut().projects_root = Some(temp.join("projects"));
        config.save().expect("save");
        config
    }

    fn add(target: &str) -> ProjectCommand {
        ProjectCommand::Add(ProjectAddArgs {
            target: Some(target.to_owned()),
            name: None,
            slug: None,
            on: None,
            branch: None,
            token_stdin: false,
            username: "x-access-token".to_owned(),
            yes: true,
        })
    }

    #[tokio::test]
    async fn a_directory_that_joins_a_project_takes_what_the_project_is_called() {
        let temp = tempdir().expect("temp directory");
        let root = checkout(&temp.path().join("my-fork"));
        let mut config = machine(temp.path());
        let gateway = Gateway::start(|_, _, _| {
            (
                200,
                json!({ "id": "prj_existing", "slug": "alera", "name": "Alera", "location": "joined" }),
            )
        })
        .await;

        run(
            &mut config,
            &gateway.api().await,
            add(&root.to_string_lossy()),
            true,
        )
        .await
        .expect("added");

        let sent = gateway.received_as("POST", "/api/projects");
        assert_eq!(sent.len(), 1);
        assert_eq!(
            sent[0].body,
            json!({
                "deviceId": "dev_here",
                "name": "my-fork",
                "slug": "my-fork",
                "localPath": root.to_string_lossy(),
                "repoUrl": "https://github.com/Acme/API.git",
                "defaultBranch": "trunk",
            })
        );
        let saved = ConfigStore::load_from(config.path().to_path_buf()).expect("config");
        assert_eq!(
            saved.data().projects,
            [ProjectEntry {
                id: "prj_existing".to_owned(),
                slug: "alera".to_owned(),
                name: "Alera".to_owned(),
                root,
                repo_url: Some("https://github.com/Acme/API.git".to_owned()),
                default_branch: Some("trunk".to_owned()),
            }]
        );
    }

    #[tokio::test]
    async fn a_directory_without_a_remote_is_registered_as_a_directory() {
        let temp = tempdir().expect("temp directory");
        let plain = temp.path().join("notes");
        fs::create_dir(&plain).expect("directory");
        // A folder inside a checkout is that folder, not the repository.
        let inside = checkout(&temp.path().join("monorepo")).join("packages");
        fs::create_dir(&inside).expect("directory");
        let mut config = machine(temp.path());
        let gateway = Gateway::start(|_, _, body| {
            (
                201,
                json!({ "id": format!("prj_{}", body["slug"].as_str().unwrap_or_default()), "slug": body["slug"], "name": body["name"], "location": "created" }),
            )
        })
        .await;
        let api = gateway.api().await;

        run(&mut config, &api, add(&plain.to_string_lossy()), true)
            .await
            .expect("added");
        run(&mut config, &api, add(&inside.to_string_lossy()), true)
            .await
            .expect("added");

        for request in gateway.received_as("POST", "/api/projects") {
            assert!(request.body.get("repoUrl").is_none(), "{}", request.body);
            assert!(request.body.get("defaultBranch").is_none());
        }
        assert!(
            config
                .find_project("prj_notes")
                .expect("entry")
                .repo_url
                .is_none()
        );
        assert!(config.find_project("prj_packages").is_some());
    }

    #[tokio::test]
    async fn a_repository_is_registered_and_placed_in_the_projects_folder() {
        let temp = tempdir().expect("temp directory");
        let mut config = machine(temp.path());
        // Already there, so there is nothing to fetch from anywhere.
        let existing = checkout(&temp.path().join("projects/api"));
        let gateway = Gateway::start(|method, path, body| match (method, path) {
            ("GET", "/api/projects") => (200, json!([])),
            ("GET", "/api/github") => (404, json!({ "error": "not_found" })),
            ("POST", "/api/projects") => (
                201,
                json!({ "id": "prj_api", "slug": body["slug"], "name": body["name"], "location": "created" }),
            ),
            ("PUT", _) => (200, json!({ "locations": [] })),
            _ => (404, json!({ "error": "not_found" })),
        })
        .await;

        run(&mut config, &gateway.api().await, add("Acme/API"), true)
            .await
            .expect("added");

        let registrations = gateway.received_as("POST", "/api/projects");
        assert_eq!(registrations.len(), 2, "before the copy and after it");
        assert_eq!(registrations[0].body["slug"], "api");
        assert_eq!(registrations[0].body["name"], "API");
        assert_eq!(
            registrations[0].body["repoUrl"],
            "https://github.com/Acme/API.git"
        );
        assert!(registrations[0].body.get("defaultBranch").is_none());
        assert_eq!(registrations[1].body["defaultBranch"], "trunk");
        assert_eq!(
            registrations[1].body["localPath"],
            json!(temp.path().join("projects/api").to_string_lossy())
        );
        let reports = gateway.received_as("PUT", "/api/projects/prj_api/locations/dev_here");
        assert_eq!(reports.len(), 1);
        assert_eq!(reports[0].body["status"], "ready");

        let entry = config.find_project("prj_api").expect("entry").clone();
        assert_eq!(fs::canonicalize(&entry.root).expect("root"), existing);
        assert_eq!(
            entry.repo_url.as_deref(),
            Some("https://github.com/Acme/API.git")
        );
        assert_eq!(entry.default_branch.as_deref(), Some("trunk"));
    }

    #[tokio::test]
    async fn a_project_that_could_not_be_cloned_is_not_left_registered() {
        let temp = tempdir().expect("temp directory");
        let mut config = machine(temp.path());
        let occupied = temp.path().join("projects/api");
        fs::create_dir_all(&occupied).expect("folder");
        fs::write(occupied.join("thesis.txt"), "years of work\n").expect("file");
        let gateway = Gateway::start(|method, path, body| match (method, path) {
            ("GET", "/api/projects") => (200, json!([])),
            ("GET", "/api/github") => (200, json!({ "enabled": true, "connected": false })),
            ("POST", "/api/projects") => (
                201,
                json!({ "id": "prj_api", "slug": body["slug"], "name": body["name"], "location": "created" }),
            ),
            _ => (200, json!({ "ok": true, "locations": [] })),
        })
        .await;

        let error = run(&mut config, &gateway.api().await, add("acme/api"), true)
            .await
            .expect_err("refused");

        assert!(error.to_string().contains("already exists"), "{error}");
        assert_eq!(
            gateway.received_as("DELETE", "/api/projects/prj_api").len(),
            1
        );
        assert!(occupied.join("thesis.txt").is_file());
        let saved = ConfigStore::load_from(config.path().to_path_buf()).expect("config");
        assert!(saved.data().projects.is_empty());
    }

    #[tokio::test]
    async fn a_workspace_here_first_brings_the_project_it_belongs_to() {
        let temp = tempdir().expect("temp directory");
        let mut config = machine(temp.path());
        let existing = checkout(&temp.path().join("projects/alera"));
        let gateway = Gateway::start(|method, path, _| match (method, path) {
            ("GET", "/api/projects") => (
                200,
                json!([
                    listed_project("prj_alera", "alera", json!({
                        "name": "Alera",
                        "repoUrl": "https://github.com/acme/api.git",
                        "locations": [
                            listed_location(Some("dev_elsewhere"), "desktop", json!({ "default": true })),
                            listed_location(Some("dev_here"), "laptop", json!({ "status": "pending" })),
                        ],
                    })),
                    listed_project("prj_away", "away", json!({
                        "repoUrl": "https://github.com/acme/away.git",
                        "locations": [listed_location(Some("dev_elsewhere"), "desktop", json!({ "default": true }))],
                    })),
                ]),
            ),
            ("GET", "/api/github") => (200, json!({ "enabled": false, "connected": false })),
            _ => (200, json!({ "locations": [] })),
        })
        .await;
        let api = gateway.api().await;

        let project = local_project(&mut config, &api, Some("alera"), true)
            .await
            .expect("project");
        assert_eq!(project.id, "prj_alera");
        assert_eq!(fs::canonicalize(&project.root).expect("root"), existing);
        assert!(config.find_project("prj_alera").is_some());

        // A project that does not live here is not brought here by accident.
        let error = local_project(&mut config, &api, Some("away"), true)
            .await
            .expect_err("refused");
        assert!(
            error.to_string().contains("does not live on this machine"),
            "{error}"
        );
        assert!(!temp.path().join("projects/away").exists());
    }

    #[test]
    fn tells_a_directory_from_a_repository() {
        let temp = tempdir().expect("temp directory");
        let existing = temp.path().to_string_lossy().into_owned();
        assert_eq!(classify(&existing), Target::Directory(temp.path().into()));
        assert_eq!(classify("."), Target::Directory(PathBuf::from(".")));
        assert_eq!(
            classify("./acme/api"),
            Target::Directory(PathBuf::from("./acme/api"))
        );
        assert_eq!(
            classify("C:\\code\\api"),
            Target::Directory(PathBuf::from("C:\\code\\api"))
        );
        assert_eq!(
            classify("git@github.com:acme/api.git"),
            Target::Repository("git@github.com:acme/api.git".to_owned())
        );
        assert_eq!(
            classify("https://gitlab.com/group/sub/project"),
            Target::Repository("https://gitlab.com/group/sub/project".to_owned())
        );
        assert_eq!(
            classify("acme/api.js"),
            Target::Repository("https://github.com/acme/api.js".to_owned())
        );
        // Neither an address nor owner/repo: read as a path, which then fails
        // for not being a directory.
        assert_eq!(
            classify("acme/api/docs"),
            Target::Directory(PathBuf::from("acme/api/docs"))
        );
        assert_eq!(classify("api"), Target::Directory(PathBuf::from("api")));
    }

    #[test]
    fn writes_a_machine_name_the_way_the_gateway_does() {
        assert_eq!(
            location_slug("Leynier's MacBook Air"),
            "leynier-s-macbook-air"
        );
        assert_eq!(location_slug("  desktop  "), "desktop");
        assert_eq!(location_slug("Café"), "cafe");
        assert_eq!(location_slug("cloud"), "cloud-machine");
        assert_eq!(location_slug("Main"), "main-machine");
        assert_eq!(location_slug("!!!"), "machine-machine");
    }

    fn location(
        id: &str,
        kind: &str,
        device: Option<&str>,
        name: &str,
        slug: &str,
    ) -> LocationView {
        LocationView {
            id: id.to_owned(),
            kind: kind.to_owned(),
            device_id: device.map(str::to_owned),
            name: name.to_owned(),
            slug: slug.to_owned(),
            local_path: None,
            status: "ready".to_owned(),
            error: None,
            error_code: None,
            is_default: false,
            online: true,
            state: "online".to_owned(),
        }
    }

    #[test]
    fn finds_a_location_by_any_of_its_names() {
        let temp = tempdir().expect("temp directory");
        let mut config = ConfigStore::load_from(temp.path().join("config.json")).expect("config");
        config.data_mut().device_id = Some("dev_laptop".to_owned());
        config.data_mut().device_name = Some("Work Laptop".to_owned());
        let locations = [
            location(
                "loc_1",
                "local",
                Some("dev_laptop"),
                "Work Laptop",
                "work-laptop",
            ),
            location("loc_2", "local", Some("dev_desktop"), "Desktop", "desktop"),
            location("loc_3", "cloud", None, "Exeora Cloud", "cloud"),
        ];
        let found = |selector: &str| {
            find_location(&config, &locations, selector).map(|location| location.id.as_str())
        };

        assert_eq!(found("here"), Some("loc_1"));
        assert_eq!(found("work-laptop"), Some("loc_1"));
        assert_eq!(found("Work Laptop"), Some("loc_1"));
        assert_eq!(found("DESKTOP"), Some("loc_2"));
        assert_eq!(found("dev_desktop"), Some("loc_2"));
        assert_eq!(found("loc_3"), Some("loc_3"));
        assert_eq!(found("Cloud"), Some("loc_3"));
        assert_eq!(found("server"), None);
        assert!(names_this_machine(&config, "work-laptop"));
        assert!(!names_this_machine(&config, "desktop"));
    }

    #[test]
    fn says_what_the_gateway_did_with_the_registration() {
        assert_eq!(said(Some("created"), "alera"), "Added alera.");
        assert_eq!(said(None, "alera"), "Added alera.");
        assert_eq!(
            said(Some("joined"), "alera"),
            "alera already exists; this machine is now one of its locations."
        );
    }
}
