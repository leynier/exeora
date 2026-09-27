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
        ProjectView, error_code,
    },
    cli::{emit, file_name, project_mcp_url, project_root, slugify},
    cloud::commands::{confirm, created_project, token_from_stdin},
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

/// How a project that lives nowhere is given a place again.
pub fn give_it_a_place(slug: &str) -> String {
    format!(
        "Give it a place: run `exeora project add .` in a checkout of it, or `exeora project locations add {slug} --on <machine|cloud>`."
    )
}

/// How Exeora Cloud comes to hold the project root again, said under a
/// location that holds no instance for it.
fn make_the_instance(slug: &str) -> String {
    format!(
        "Exeora Cloud holds no instance for the project root. The next call to it makes one, and so does `exeora project default {slug} --on {CLOUD}`."
    )
}

/// Whether a project has nowhere left to name: it lives nowhere, and not
/// even Exeora Cloud is waiting to make an instance for it.
pub fn has_no_place(project: &ProjectView) -> bool {
    project.nowhere && project.standing().next().is_none()
}

/// What is said when a command names a place the project does not live in.
pub fn not_a_location(project: &ProjectView, on: &str) -> anyhow::Error {
    if has_no_place(project) {
        return anyhow!(
            "{} lives nowhere at the moment. Give it a place with `exeora project locations add {} --on {on}`: the first machine a project is given becomes its default location.",
            project.slug,
            project.slug
        );
    }
    anyhow!(
        "{} does not live on {on}. Its locations are: {}. Add one with `exeora project locations add {} --on {on}`.",
        project.slug,
        location_names(&project.locations),
        project.slug
    )
}

/// The project the account has by that slug or id, or None when the gateway
/// answered and it is not among them. A request that failed is an error and
/// never a None: not having heard is not the same as having heard no.
pub async fn lookup_project(api: &ApiClient, selector: &str) -> Result<Option<ProjectView>> {
    Ok(api
        .list_projects()
        .await?
        .into_iter()
        .find(|project| project.id == selector || project.slug.eq_ignore_ascii_case(selector)))
}

pub async fn find_project(api: &ApiClient, selector: &str) -> Result<ProjectView> {
    lookup_project(api, selector)
        .await?
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
    created_project(api, created, &slug, json_output).await
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

/// What the project root is called: `main` where calls that name no
/// workspace land, which is the default location.
pub const ROOT_SELECTOR: &str = "main";

/// What the root of a location is called when the location is named:
/// `main@desktop`. The gateway takes it for every location that holds a
/// copy, the default one included.
pub fn named_root(location_slug: &str) -> String {
    format!("{ROOT_SELECTOR}@{location_slug}")
}

/// The selector of the project root in a location: `main` in the default
/// one, `main@<slug>` in any other. None for a location that holds no copy
/// of the root, which is one that was only chosen, one whose clone has not
/// finished or has failed, one whose machine was removed, and Exeora Cloud
/// while it holds no instance for the root, whether it holds workspaces or
/// is the default location waiting for the call that makes one.
pub fn root_selector(location: &LocationView) -> Option<String> {
    let holds_a_copy = location.device_id.is_some()
        && location.state != "removed"
        && (location.is_cloud() || location.status == "ready");
    holds_a_copy.then(|| {
        if location.is_default {
            ROOT_SELECTOR.to_owned()
        } else {
            named_root(&location.slug)
        }
    })
}

fn describe_location(config: &ConfigStore, project: &str, location: &LocationView) -> String {
    let here = location.device_id.is_some() && location.device_id == config.data().device_id;
    let name = if here {
        format!("{} (this machine)", location.name)
    } else {
        location.name.clone()
    };
    let mut line = format!(
        "  {} {:<32} {:<12} {:<20} {}",
        if location.is_default { "*" } else { " " },
        name,
        if location.state.is_empty() {
            &location.status
        } else {
            &location.state
        },
        root_selector(location).unwrap_or_default(),
        location.local_path.as_deref().unwrap_or("")
    );
    line.truncate(line.trim_end().len());
    if let Some(error) = location.error.as_deref().filter(|error| !error.is_empty()) {
        line.push_str(&format!("\n      {error}"));
    }
    if location.has_no_instance() {
        line.push_str(&format!("\n      {}", make_the_instance(project)));
    }
    line
}

/// The lines under a project: one for each place it lives, or that it lives
/// nowhere and how to change that.
///
/// `nowhere` is the gateway's word for it and not something read off the
/// locations: a project whose only machine was revoked has no location that
/// stands, and still has that machine for its default until it is deleted.
fn location_lines(
    config: &ConfigStore,
    project: &str,
    nowhere: bool,
    locations: &[LocationView],
) -> Vec<String> {
    let mut lines = Vec::new();
    if nowhere && locations.iter().all(|location| location.state == "removed") {
        lines.push("    nowhere".to_owned());
        lines.push(format!("      {}", give_it_a_place(project)));
    }
    lines.extend(
        locations
            .iter()
            .map(|location| describe_location(config, project, location)),
    );
    lines
}

/// What a listing has to say: the items for `--json`, the lines for a
/// person, and what goes to stderr beside either.
#[derive(Debug)]
pub struct Listing {
    pub items: Vec<Value>,
    pub lines: Vec<String>,
    /// Said when the gateway could not be asked and the listing is only what
    /// this machine knows.
    pub notice: Option<String>,
}

impl Listing {
    pub fn print(self, json_output: bool) -> Result<()> {
        if let Some(notice) = &self.notice {
            if json_output {
                eprintln!("{}", json!({ "warning": notice }));
            } else {
                eprintln!("warning: {notice}");
            }
        }
        if json_output {
            return emit(Value::Array(self.items));
        }
        for line in self.lines {
            println!("{line}");
        }
        Ok(())
    }
}

/// What is said beside a listing that the gateway had no part in.
pub fn offline_notice(error: &anyhow::Error) -> String {
    format!(
        "The gateway could not be reached ({error}), so this is what this machine knows. Other machines and Exeora Cloud are not shown."
    )
}

fn repository_line(slug: &str, repo_url: Option<&str>, default_branch: Option<&str>) -> String {
    let repository = repo_url
        .and_then(repository_key)
        .or_else(|| repo_url.map(str::to_owned))
        .unwrap_or_else(|| "no repository".to_owned());
    match default_branch {
        Some(branch) => format!("{slug:<20} {repository} ({branch})"),
        None => format!("{slug:<20} {repository}"),
    }
}

const NO_PROJECTS: &str =
    "No projects yet. Run `exeora project add` in a directory, or `exeora project add owner/repo`.";

/// The projects of the account, from the gateway. When it cannot be reached,
/// the projects of this machine, which is less and still what somebody on a
/// train wants to see. A refusal is returned as the error it is.
pub async fn project_listing(config: &ConfigStore, api: &ApiClient) -> Result<Listing> {
    let listed = match api.list_projects_raw().await {
        Ok(items) => items,
        Err(error) if crate::api::is_unreachable(&error) => {
            return local_project_listing(config, offline_notice(&error));
        }
        Err(error) => return Err(error),
    };
    let mut items = Vec::new();
    let mut lines = Vec::new();
    for item in listed {
        let project: ProjectView = serde_json::from_value(item.clone())?;
        items.push(project_item(config, &project, item));
        lines.push(repository_line(
            &project.slug,
            project.repo_url.as_deref(),
            project.default_branch.as_deref(),
        ));
        lines.extend(location_lines(
            config,
            &project.slug,
            project.nowhere,
            &project.locations,
        ));
        lines.push(format!("  {}", project.mcp_url));
    }
    if items.is_empty() {
        lines.push(NO_PROJECTS.to_owned());
    }
    Ok(Listing {
        items,
        lines,
        notice: None,
    })
}

/// A project as `--json` prints it: what the gateway said, and beside it
/// what 0.17.0 printed under the names it printed it.
///
/// 0.17.0 listed the projects of this machine from its config, as `id`,
/// `slug`, `name`, `root` and `mcpUrl`. The gateway says all of those but
/// `root`, which is where the project is on this machine: the directory the
/// config holds, or the one the gateway has for this machine's location, and
/// null for a project that is not here, which 0.17.0 would not have listed.
/// Each location also says what its root is called, when it has one.
///
/// `nowhere` is always there, false from a gateway that does not say it: a
/// script asks one key whether a project has a place, whatever answered.
fn project_item(config: &ConfigStore, project: &ProjectView, mut item: Value) -> Value {
    let here = config.data().device_id.as_deref();
    let root = config
        .find_project(&project.id)
        .map(|entry| json!(entry.root))
        .or_else(|| {
            here.and_then(|device| project.location_on(device))
                .and_then(|location| location.local_path.as_ref())
                .map(|path| json!(path))
        })
        .unwrap_or(Value::Null);
    item["root"] = root;
    item["nowhere"] = json!(project.nowhere);
    if let Some(locations) = item.get_mut("locations").and_then(Value::as_array_mut) {
        for (location, view) in locations.iter_mut().zip(&project.locations) {
            if location.get("selector").is_none() {
                location["selector"] = json!(root_selector(view));
            }
        }
    }
    item
}

/// The projects in the local config, in the shape the gateway lists them as
/// far as this machine can fill it in. What only the gateway knows, such as
/// whether a location is online or which one is the default, is left out
/// instead of guessed.
fn local_project_listing(config: &ConfigStore, notice: String) -> Result<Listing> {
    let gateway = config.gateway_url();
    let data = config.data();
    let machine = data
        .device_name
        .clone()
        .unwrap_or_else(|| "this machine".to_owned());
    let mut items = Vec::new();
    let mut lines = Vec::new();
    for entry in &data.projects {
        let mcp_url = project_mcp_url(&gateway, &entry.id)?;
        items.push(json!({
            "id": entry.id,
            "slug": entry.slug,
            "name": entry.name,
            "deviceId": data.device_id,
            "localPath": entry.root,
            "root": entry.root,
            "repoUrl": entry.repo_url,
            "defaultBranch": entry.default_branch,
            // Named in full: whether this machine is the default location
            // is the gateway's to say, and the full name is right either way.
            "locations": [{
                "kind": "local",
                "deviceId": data.device_id,
                "name": machine,
                "slug": location_slug(&machine),
                "localPath": entry.root,
                "selector": named_root(&location_slug(&machine)),
            }],
            "mcpUrl": mcp_url,
            // It is in this machine's config, so as far as this machine
            // knows it lives here.
            "nowhere": false,
            "offline": true,
        }));
        lines.push(repository_line(
            &entry.slug,
            entry.repo_url.as_deref(),
            entry.default_branch.as_deref(),
        ));
        lines.push(format!(
            "    {:<32} {:<12} {:<20} {}",
            format!("{machine} (this machine)"),
            "unknown",
            named_root(&location_slug(&machine)),
            entry.root.display()
        ));
        lines.push(format!("  {mcp_url}"));
    }
    if items.is_empty() {
        lines.push("No projects on this machine.".to_owned());
    }
    Ok(Listing {
        items,
        lines,
        notice: Some(notice),
    })
}

async fn list(config: &ConfigStore, api: &ApiClient, json_output: bool) -> Result<()> {
    project_listing(config, api).await?.print(json_output)
}

async fn remove(
    config: &mut ConfigStore,
    api: &ApiClient,
    selector: &str,
    yes: bool,
    json_output: bool,
) -> Result<()> {
    // Asked first, and an answer is waited for: a gateway that could not be
    // reached has not said the project is gone, and nothing is forgotten on
    // the strength of a request that failed.
    let project = match lookup_project(api, selector).await? {
        Some(project) => project,
        None => {
            // Known here and not to the gateway: all that is left of it is
            // the local entry, which nothing can serve.
            let Some(entry) = config
                .data()
                .projects
                .iter()
                .find(|entry| entry.id == selector || entry.slug.eq_ignore_ascii_case(selector))
                .cloned()
            else {
                bail!("No project called {selector}. See `exeora project list`.");
            };
            if !confirm(
                yes,
                json_output,
                &format!(
                    "Exeora no longer knows {}. Forget it on this machine too? The files at {} are not deleted.",
                    entry.slug,
                    entry.root.display()
                ),
            )? {
                return Ok(());
            }
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

/// The locations of a project after a command changed them. The project is
/// the one that was read before the change, so it names the project and
/// says nothing of where it lives now: the locations do.
fn report_locations(
    config: &ConfigStore,
    project: &ProjectView,
    locations: &[LocationView],
    json_output: bool,
) -> Result<()> {
    if json_output {
        return emit(json!({ "project": project.slug, "locations": locations }));
    }
    for line in location_lines(config, &project.slug, false, locations) {
        println!("{line}");
    }
    Ok(())
}

/// What `exeora project locations <slug>` has to say, as the document of
/// `--json` and as the lines for a person: the places a project lives, or
/// that it lives nowhere.
fn locations_listing(
    config: &ConfigStore,
    project: &ProjectView,
    locations: &[LocationView],
) -> (Value, Vec<String>) {
    let mut lines = vec![project.slug.clone()];
    lines.extend(location_lines(
        config,
        &project.slug,
        project.nowhere,
        locations,
    ));
    (
        json!({
            "project": project.slug,
            "nowhere": project.nowhere,
            "locations": locations,
        }),
        lines,
    )
}

async fn locations(
    config: &ConfigStore,
    api: &ApiClient,
    selector: &str,
    json_output: bool,
) -> Result<()> {
    let project = find_project(api, selector).await?;
    let locations = api.list_locations(&project.id).await?;
    let (document, lines) = locations_listing(config, &project, &locations);
    if json_output {
        return emit(document);
    }
    for line in lines {
        println!("{line}");
    }
    Ok(())
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
    if project.nowhere && project.locations.is_empty() {
        bail!(
            "{} lives nowhere at the moment, so there is no location to take it off. {}",
            project.slug,
            give_it_a_place(&project.slug)
        );
    }
    let location = find_location(config, &project.locations, on)
        .cloned()
        .ok_or_else(|| {
            anyhow!(
                "{} does not live on {on}. Its locations are: {}.",
                project.slug,
                location_names(&project.locations)
            )
        })?;
    // The only place the project lives. A repository outlives it: the
    // project stays and lives nowhere. The gateway is the one that refuses
    // a directory with no remote, which nothing could clone anywhere else.
    let last = location.state != "removed" && project.standing().count() == 1;
    let mut question = if location.is_cloud() {
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
    if last && project.repo_url.is_some() {
        question.push_str(
            " It is the only place the project lives: the project stays, and lives nowhere until it is given a place again.",
        );
    }
    if !confirm(yes, json_output, &question)? {
        return Ok(());
    }
    if let Err(error) = api.remove_location(&project.id, &location.id).await {
        return Err(removal_refused(&project, &location, error));
    }
    if location.device_id.is_some() && location.device_id == config.data().device_id {
        config.remove_project(&project.id);
        config.save()?;
    }
    if json_output {
        return emit(json!({
            "removed": "location",
            "project": project.slug,
            "location": location.slug,
            "nowhere": last,
        }));
    }
    println!("{}", removed_location(&project, &location, last));
    Ok(())
}

/// What is said once a location is gone.
fn removed_location(project: &ProjectView, location: &LocationView, last: bool) -> String {
    let gone = format!("{} no longer lives on {}.", project.slug, location.name);
    if !last {
        return gone;
    }
    format!(
        "{gone} It is still a project of your account, with its MCP URL, its policy and its clients, and it lives nowhere until it is given a place again. {}",
        give_it_a_place(&project.slug)
    )
}

/// A refusal to take a location away, in words that say what to do next.
/// Anything else the gateway said is returned as it said it.
fn removal_refused(
    project: &ProjectView,
    location: &LocationView,
    error: anyhow::Error,
) -> anyhow::Error {
    match error_code(&error) {
        // Only a directory with no remote is refused its last location by a
        // gateway that keeps repositories. One that has a repository was
        // refused by an older gateway, whose own words are the right ones.
        Some("last_location") if project.repo_url.is_none() => anyhow!(
            "{} is a directory with no remote, and {} is the only place it lives: nothing could bring it back anywhere else. Remove the project instead with `exeora project remove {}`, or give its checkout a remote and run `exeora sync`.",
            project.slug,
            location.name,
            project.slug
        ),
        Some("default_location") => anyhow!(
            "{} is the default location of {}. Choose another one first with `exeora project default {} --on <machine|cloud>`, then remove this one.",
            location.name,
            project.slug,
            project.slug
        ),
        _ => error,
    }
}

async fn set_default(
    config: &ConfigStore,
    api: &ApiClient,
    selector: &str,
    on: &str,
    json_output: bool,
) -> Result<()> {
    let project = find_project(api, selector).await?;
    let location = find_location(config, &project.locations, on)
        .ok_or_else(|| not_a_location(&project, on))?;
    let locations = api.set_default_location(&project.id, &location.id).await?;
    if !json_output {
        println!("{}", made_default(&project, location, &locations));
    }
    report_locations(config, &project, &locations, json_output)
}

/// What is said once a location is the default. Exeora Cloud that held no
/// instance for the project root was asked for one by this, and that takes
/// a moment, so the first call is not a surprise.
fn made_default(project: &ProjectView, chosen: &LocationView, now: &[LocationView]) -> String {
    let said = format!(
        "Calls to {} that name no workspace now go to {}.",
        project.slug, chosen.name
    );
    let being_made = chosen.is_cloud()
        && chosen.device_id.is_none()
        && now
            .iter()
            .any(|location| location.id == chosen.id && location.state == "setting up");
    if being_made {
        format!(
            "{said} The instance for the project root is being made, which takes about a minute."
        )
    } else {
        said
    }
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
    // Only an answer that does not hold the project says it is unknown. A
    // request that failed says why it failed.
    let Some(project) = lookup_project(api, selector).await? else {
        return Err(unknown);
    };
    if has_no_place(&project) {
        bail!(
            "{} lives nowhere at the moment. Add this machine with `exeora project locations add {} --on {HERE}` and create the workspace again, or pass `--on {CLOUD}` to put it on Exeora Cloud.",
            project.slug,
            project.slug
        );
    }
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
        LocationsCommand, ProjectAddArgs, ProjectCommand, Target, classify, find_location,
        has_no_place, local_project, location_slug, locations_listing, made_default,
        names_this_machine, not_a_location, project_listing, removal_refused, removed_location,
        root_selector, run, said,
    };
    use crate::{
        api::{LocationView, ProjectView},
        cloud::commands::joined_project,
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

    fn remove(slug: &str) -> ProjectCommand {
        ProjectCommand::Remove {
            slug: slug.to_owned(),
            yes: true,
        }
    }

    fn machine_with_projects(temp: &Path) -> ConfigStore {
        let mut config = machine(temp);
        config.upsert_project(ProjectEntry {
            repo_url: Some("https://github.com/Acme/API.git".to_owned()),
            default_branch: Some("trunk".to_owned()),
            ..ProjectEntry::directory(
                "prj_api".to_owned(),
                "api".to_owned(),
                "API".to_owned(),
                PathBuf::from("/code/api"),
            )
        });
        config.upsert_project(ProjectEntry::directory(
            "prj_notes".to_owned(),
            "notes".to_owned(),
            "Notes".to_owned(),
            PathBuf::from("/code/notes"),
        ));
        config.save().expect("save");
        config
    }

    fn saved_slugs(config: &ConfigStore) -> Vec<String> {
        ConfigStore::load_from(config.path().to_path_buf())
            .expect("config")
            .data()
            .projects
            .iter()
            .map(|entry| entry.slug.clone())
            .collect()
    }

    #[tokio::test]
    async fn a_request_that_failed_never_forgets_a_project() {
        let temp = tempdir().expect("temp directory");
        let mut config = machine_with_projects(temp.path());

        // Not there at all, unwell, and refusing: none of them said the
        // project is gone.
        let gone = Gateway::gone();
        let error = run(&mut config, &gone.api().await, remove("api"), true)
            .await
            .expect_err("the request failed");
        assert!(!error.to_string().contains("No project called"), "{error}");
        assert_eq!(saved_slugs(&config), ["api", "notes"]);

        for status in [500, 503, 401, 403, 429] {
            let gateway =
                Gateway::start(move |_, _, _| (status, json!({ "error": "refused" }))).await;
            run(&mut config, &gateway.api().await, remove("api"), true)
                .await
                .expect_err("the request failed");
            assert_eq!(saved_slugs(&config), ["api", "notes"], "{status}");
            assert!(
                gateway
                    .received()
                    .iter()
                    .all(|request| request.method == "GET"),
                "{status}"
            );
        }

        // A project the config has never held is looked up the same way.
        let error = local_project(&mut config, &gone.api().await, Some("elsewhere"), true)
            .await
            .expect_err("the request failed");
        assert!(!error.to_string().contains("No project called"), "{error}");
        assert_eq!(saved_slugs(&config), ["api", "notes"]);
    }

    #[tokio::test]
    async fn forgets_a_project_only_when_the_gateway_answered_without_it() {
        let temp = tempdir().expect("temp directory");
        let mut config = machine_with_projects(temp.path());
        let gateway = Gateway::start(|method, path, _| match (method, path) {
            ("GET", "/api/projects") => (
                200,
                json!([listed_project("prj_notes", "notes", json!({}))]),
            ),
            _ => (200, json!({ "ok": true })),
        })
        .await;
        let api = gateway.api().await;

        // Asked for, and in --json there is nobody to ask: nothing happens.
        let unconfirmed = run(
            &mut config,
            &api,
            ProjectCommand::Remove {
                slug: "api".to_owned(),
                yes: false,
            },
            true,
        )
        .await
        .expect_err("not confirmed");
        assert!(unconfirmed.to_string().contains("-y"), "{unconfirmed}");
        assert_eq!(saved_slugs(&config), ["api", "notes"]);

        run(&mut config, &api, remove("api"), true)
            .await
            .expect("forgotten");
        assert_eq!(saved_slugs(&config), ["notes"]);
        assert!(
            gateway
                .received_as("DELETE", "/api/projects/prj_api")
                .is_empty()
        );

        // One the gateway knows is removed there, and then here.
        run(&mut config, &api, remove("notes"), true)
            .await
            .expect("removed");
        assert_eq!(
            gateway
                .received_as("DELETE", "/api/projects/prj_notes")
                .len(),
            1
        );
        assert!(saved_slugs(&config).is_empty());

        let unknown = run(&mut config, &api, remove("nothing"), true)
            .await
            .expect_err("unknown");
        assert!(unknown.to_string().contains("No project called nothing"));
    }

    #[tokio::test]
    async fn a_failed_removal_leaves_the_project_where_it_was() {
        let temp = tempdir().expect("temp directory");
        let mut config = machine_with_projects(temp.path());
        let gateway = Gateway::start(|method, _, _| match method {
            "GET" => (200, json!([listed_project("prj_api", "api", json!({}))])),
            _ => (503, json!({ "error": "unavailable" })),
        })
        .await;
        run(&mut config, &gateway.api().await, remove("api"), true)
            .await
            .expect_err("the removal failed");
        assert_eq!(saved_slugs(&config), ["api", "notes"]);
    }

    #[tokio::test]
    async fn a_repository_that_is_already_a_project_joins_exeora_cloud_without_a_machine() {
        let temp = tempdir().expect("temp directory");
        let mut config = machine(temp.path());
        let gateway = Gateway::start(|method, path, _| match (method, path) {
            ("POST", "/api/cloud/projects") => (
                200,
                json!({ "projectId": "prj_alera", "deviceId": null, "status": "ready", "location": "joined" }),
            ),
            ("GET", "/api/projects") => (
                200,
                json!([listed_project("prj_alera", "alera", json!({ "name": "Alera" }))]),
            ),
            _ => (500, json!({ "error": "unexpected" })),
        })
        .await;
        let api = gateway.api().await;

        let added = ProjectCommand::Add(ProjectAddArgs {
            target: Some("Acme/API".to_owned()),
            name: None,
            slug: None,
            on: Some("cloud".to_owned()),
            branch: None,
            token_stdin: false,
            username: "x-access-token".to_owned(),
            yes: true,
        });
        run(&mut config, &api, added, true).await.expect("joined");

        let sent = gateway.received_as("POST", "/api/cloud/projects");
        assert_eq!(sent.len(), 1);
        assert_eq!(
            sent[0].body,
            json!({ "name": "API", "slug": "api", "repoUrl": "https://github.com/Acme/API.git" })
        );
        // There is no machine, so none was waited for.
        assert!(gateway.received_as("GET", "/api/cloud/projects").is_empty());

        let created = serde_json::from_value(json!({
            "projectId": "prj_alera", "deviceId": null, "status": "ready", "location": "joined",
        }))
        .expect("the joined answer");
        let (line, value) = joined_project(&api, &created, "api").await;
        assert_eq!(
            line,
            "alera already exists; it is now on Exeora Cloud too. No machine was started: one is made for each workspace you create there."
        );
        assert_eq!(
            value,
            json!({
                "joined": "project", "slug": "alera", "projectId": "prj_alera",
                "location": "joined", "status": "ready", "machine": null,
            })
        );
    }

    #[tokio::test]
    async fn lists_the_projects_of_this_machine_when_the_gateway_is_out_of_reach() {
        let temp = tempdir().expect("temp directory");
        let config = machine_with_projects(temp.path());
        let gone = Gateway::gone();
        let unwell = Gateway::start(|_, _, _| (502, json!({ "error": "bad_gateway" }))).await;

        for api in [gone.api().await, unwell.api().await] {
            let listing = project_listing(&config, &api)
                .await
                .expect("what this machine knows");
            assert!(
                listing
                    .notice
                    .as_deref()
                    .is_some_and(|notice| notice.contains("could not be reached")
                        && notice.contains("what this machine knows"))
            );
            assert_eq!(listing.items.len(), 2);
            let mut api_project = listing.items[0].clone();
            // The address of the gateway is whatever the environment says.
            assert!(
                api_project["mcpUrl"]
                    .as_str()
                    .is_some_and(|url| url.ends_with("/p/prj_api/mcp"))
            );
            api_project["mcpUrl"] = json!(null);
            assert_eq!(
                api_project,
                json!({
                    "id": "prj_api", "slug": "api", "name": "API", "deviceId": "dev_here",
                    "localPath": "/code/api", "root": "/code/api",
                    "repoUrl": "https://github.com/Acme/API.git", "defaultBranch": "trunk",
                    "locations": [{
                        "kind": "local", "deviceId": "dev_here", "name": "laptop",
                        "slug": "laptop", "localPath": "/code/api", "selector": "main@laptop",
                    }],
                    "mcpUrl": null, "nowhere": false, "offline": true,
                })
            );
            for item in &listing.items {
                for key in PROJECT_KEYS_0_17 {
                    assert!(item.get(key).is_some(), "{key} is missing from {item}");
                }
            }
            assert_eq!(listing.items[1]["root"], "/code/notes");
            assert!(listing.lines[1].contains(" main@laptop "));
            assert_eq!(listing.items[1]["offline"], true);
            assert_eq!(listing.items[1]["repoUrl"], json!(null));
            assert_eq!(
                listing.lines[0],
                format!("{:<20} github.com/acme/api (trunk)", "api")
            );
            assert!(listing.lines[1].contains("laptop (this machine)"));
            assert!(listing.lines[1].ends_with("/code/api"));
            assert_eq!(listing.lines[3], format!("{:<20} no repository", "notes"));
        }
    }

    /// The keys `exeora project list --json` printed in 0.17.0, from the
    /// config of the machine it ran on.
    const PROJECT_KEYS_0_17: [&str; 5] = ["id", "slug", "name", "root", "mcpUrl"];

    #[tokio::test]
    async fn a_project_is_printed_with_the_keys_of_0_17_beside_the_gateways() {
        let temp = tempdir().expect("temp directory");
        let config = machine_with_projects(temp.path());
        let listed = json!([
            // On this machine, and in its config.
            listed_project(
                "prj_api",
                "api",
                json!({
                    "name": "API",
                    "deviceId": "dev_desktop",
                    "locations": [
                        listed_location(Some("dev_desktop"), "desktop", json!({ "default": true, "localPath": "/home/me/exeora/api" })),
                        listed_location(Some("dev_here"), "laptop", json!({ "localPath": "/gateway/says/api" })),
                        listed_location(Some("dev_a"), "chosen", json!({ "status": "pending" })),
                        listed_location(None, "cloud", json!({ "kind": "cloud" })),
                    ],
                })
            ),
            // On this machine as far as the gateway knows, and not in the config.
            listed_project(
                "prj_new",
                "new",
                json!({
                    "locations": [listed_location(Some("dev_here"), "laptop", json!({ "default": true, "localPath": "/gateway/says/new" }))],
                })
            ),
            // Somewhere else, which 0.17.0 would not have listed at all.
            listed_project(
                "prj_away",
                "away",
                json!({
                    "locations": [listed_location(Some("dev_desktop"), "desktop", json!({ "default": true, "localPath": "/home/me/exeora/away" }))],
                })
            ),
        ]);
        let answer = listed.clone();
        let gateway = Gateway::start(move |_, _, _| (200, answer.clone())).await;

        let listing = project_listing(&config, &gateway.api().await)
            .await
            .expect("listing");
        assert_eq!(listing.items.len(), 3);
        for (item, said) in listing.items.iter().zip(listed.as_array().expect("array")) {
            for key in PROJECT_KEYS_0_17 {
                assert!(item.get(key).is_some(), "{key} is missing from {item}");
            }
            // What the gateway said is all still there, as it said it.
            for (key, value) in said.as_object().expect("an object") {
                if key != "locations" {
                    assert_eq!(&item[key], value, "{key}");
                }
            }
        }
        let api_project = &listing.items[0];
        assert_eq!(api_project["id"], "prj_api");
        assert_eq!(api_project["slug"], "api");
        assert_eq!(api_project["name"], "API");
        assert_eq!(api_project["mcpUrl"], "https://exeora.test/p/prj_api/mcp");
        // Where the config says the project is, which is what 0.17.0 printed.
        assert_eq!(api_project["root"], "/code/api");
        assert_eq!(listing.items[1]["root"], "/gateway/says/new");
        assert_eq!(listing.items[2]["root"], json!(null));

        let selectors: Vec<_> = api_project["locations"]
            .as_array()
            .expect("locations")
            .iter()
            .map(|location| location["selector"].clone())
            .collect();
        assert_eq!(
            selectors,
            [
                json!("main"),
                json!("main@laptop"),
                json!(null),
                json!(null)
            ]
        );
        assert_eq!(
            api_project["locations"][1]["localPath"],
            "/gateway/says/api"
        );
        assert!(listing.lines[1].contains(" main "));
        assert!(listing.lines[2].contains(" main@laptop "));
        assert!(!listing.lines[3].contains("main"));
    }

    #[test]
    fn names_the_root_of_a_location_that_holds_a_copy() {
        let location = |value: serde_json::Value| -> LocationView {
            serde_json::from_value(value).expect("location")
        };
        let named = |value: serde_json::Value| root_selector(&location(value));
        assert_eq!(
            named(listed_location(
                Some("dev_a"),
                "laptop",
                json!({ "default": true })
            ))
            .as_deref(),
            Some("main")
        );
        assert_eq!(
            named(listed_location(Some("dev_b"), "desktop", json!({}))).as_deref(),
            Some("main@desktop")
        );
        // Exeora Cloud with a machine for the root, and without one.
        assert_eq!(
            named(listed_location(
                Some("dev_c"),
                "cloud",
                json!({ "kind": "cloud", "state": "asleep" })
            ))
            .as_deref(),
            Some("main@cloud")
        );
        assert_eq!(
            named(listed_location(None, "cloud", json!({ "kind": "cloud" }))),
            None
        );
        for fields in [
            json!({ "status": "pending" }),
            json!({ "status": "cloning" }),
            json!({ "status": "error" }),
            json!({ "state": "removed" }),
        ] {
            assert_eq!(
                named(listed_location(Some("dev_d"), "other", fields.clone())),
                None,
                "{fields}"
            );
        }
    }

    #[tokio::test]
    async fn lists_what_the_gateway_says_and_returns_what_it_refuses() {
        let temp = tempdir().expect("temp directory");
        let config = machine_with_projects(temp.path());
        for status in [401, 403, 404] {
            let gateway =
                Gateway::start(move |_, _, _| (status, json!({ "error": "refused" }))).await;
            assert!(
                project_listing(&config, &gateway.api().await)
                    .await
                    .is_err(),
                "{status}"
            );
        }

        let remote = listed_project(
            "prj_api",
            "api",
            json!({
                "repoUrl": "https://github.com/Acme/API.git",
                "locations": [
                    listed_location(Some("dev_here"), "laptop", json!({ "default": true, "localPath": "/code/api" })),
                    listed_location(None, "cloud", json!({ "kind": "cloud", "name": "Exeora Cloud", "online": false, "state": "asleep" })),
                ],
            }),
        );
        let answer = remote.clone();
        let gateway = Gateway::start(move |_, _, _| (200, json!([answer]))).await;
        let listing = project_listing(&config, &gateway.api().await)
            .await
            .expect("listing");
        assert!(listing.notice.is_none());
        assert_eq!(listing.items.len(), 1);
        assert_eq!(listing.items[0]["id"], remote["id"]);
        assert_eq!(listing.items[0]["repoUrl"], remote["repoUrl"]);
        assert!(listing.items[0].get("offline").is_none());
        assert_eq!(listing.lines.len(), 4);
        assert!(listing.lines[1].starts_with("  * laptop (this machine)"));
        assert!(listing.lines[2].contains("Exeora Cloud"));
        assert!(listing.lines[2].contains("asleep"));
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

    /// The id the gateway gives a project that has no machine: one that
    /// names no machine of the account.
    const NO_MACHINE: &str = "dev_none_abc";

    /// A repository whose last machine was removed.
    fn homeless(id: &str, slug: &str) -> serde_json::Value {
        listed_project(
            id,
            slug,
            json!({
                "deviceId": NO_MACHINE,
                "nowhere": true,
                "repoUrl": "https://github.com/acme/api.git",
                "defaultBranch": "trunk",
            }),
        )
    }

    /// Exeora Cloud as the default location, after the instance of the
    /// project root was destroyed.
    fn cloud_with_no_instance() -> serde_json::Value {
        listed_location(
            None,
            "cloud",
            json!({
                "kind": "cloud", "name": "Exeora Cloud", "default": true,
                "online": false, "state": "no instance",
            }),
        )
    }

    /// A repository that is on Exeora Cloud and nowhere else, with no
    /// instance for its root.
    fn released(id: &str, slug: &str) -> serde_json::Value {
        let mut project = homeless(id, slug);
        project["locations"] = json!([cloud_with_no_instance()]);
        project
    }

    fn view(project: serde_json::Value) -> ProjectView {
        serde_json::from_value(project).expect("project")
    }

    fn places(locations: serde_json::Value) -> Vec<LocationView> {
        serde_json::from_value(locations).expect("locations")
    }

    fn remove_location(slug: &str, on: &str) -> ProjectCommand {
        ProjectCommand::Locations {
            slug: None,
            command: Some(LocationsCommand::Remove {
                slug: slug.to_owned(),
                on: on.to_owned(),
                yes: true,
            }),
        }
    }

    fn make_default(slug: &str, on: &str) -> ProjectCommand {
        ProjectCommand::Default {
            slug: slug.to_owned(),
            on: on.to_owned(),
        }
    }

    const WAY_BACK: &str = "Give it a place: run `exeora project add .` in a checkout of it, or `exeora project locations add api --on <machine|cloud>`.";

    #[tokio::test]
    async fn a_project_that_lives_nowhere_is_listed_as_such_with_the_way_back() {
        let temp = tempdir().expect("temp directory");
        let config = machine(temp.path());
        let listed = json!([
            homeless("prj_api", "api"),
            released("prj_web", "web"),
            // From a gateway that does not say `nowhere`.
            listed_project(
                "prj_old",
                "old",
                json!({
                    "deviceId": "dev_here",
                    "locations": [listed_location(Some("dev_here"), "laptop", json!({ "default": true, "localPath": "/code/old" }))],
                })
            ),
        ]);
        let answer = listed.clone();
        let gateway = Gateway::start(move |_, _, _| (200, answer.clone())).await;

        let listing = project_listing(&config, &gateway.api().await)
            .await
            .expect("listing");

        assert_eq!(
            listing.lines,
            [
                format!("{:<20} github.com/acme/api (trunk)", "api"),
                "    nowhere".to_owned(),
                format!("      {WAY_BACK}"),
                "  https://exeora.test/p/prj_api/mcp".to_owned(),
                format!("{:<20} github.com/acme/api (trunk)", "web"),
                format!(
                    "  * {:<32} no instance\n      Exeora Cloud holds no instance for the project root. The next call to it makes one, and so does `exeora project default web --on cloud`.",
                    "Exeora Cloud"
                ),
                "  https://exeora.test/p/prj_web/mcp".to_owned(),
                format!("{:<20} no repository", "old"),
                format!(
                    "  * {:<32} {:<12} {:<20} /code/old",
                    "laptop (this machine)", "online", "main"
                ),
                "  https://exeora.test/p/prj_old/mcp".to_owned(),
            ]
        );

        let nowhere: Vec<_> = listing
            .items
            .iter()
            .map(|item| item["nowhere"].clone())
            .collect();
        assert_eq!(nowhere, [json!(true), json!(true), json!(false)]);
        for (item, said) in listing.items.iter().zip(listed.as_array().expect("array")) {
            // Every key 0.18.0 printed: the ones of 0.17.0, and what the
            // gateway said, as it said it.
            for key in PROJECT_KEYS_0_17 {
                assert!(item.get(key).is_some(), "{key} is missing from {item}");
            }
            for (key, value) in said.as_object().expect("an object") {
                if key != "locations" {
                    assert_eq!(&item[key], value, "{key}");
                }
            }
        }
        // It is not on this machine, nor on any other.
        assert_eq!(listing.items[0]["root"], json!(null));
        assert_eq!(listing.items[0]["locations"], json!([]));
        assert_eq!(listing.items[0]["deviceId"], NO_MACHINE);
        // No instance holds the root, so there is no root to name.
        assert_eq!(listing.items[1]["locations"][0]["selector"], json!(null));
        assert_eq!(listing.items[1]["locations"][0]["state"], "no instance");
        assert_eq!(listing.items[2]["root"], "/code/old");
    }

    #[tokio::test]
    async fn a_listing_from_this_machine_says_its_projects_live_here() {
        let temp = tempdir().expect("temp directory");
        let config = machine_with_projects(temp.path());
        let listing = project_listing(&config, &Gateway::gone().api().await)
            .await
            .expect("what this machine knows");
        assert_eq!(listing.items.len(), 2);
        for item in &listing.items {
            assert_eq!(item["nowhere"], false, "{item}");
        }
    }

    #[test]
    fn a_machine_that_was_removed_is_shown_under_a_project_that_lives_nowhere() {
        let temp = tempdir().expect("temp directory");
        let config = machine(temp.path());
        let mut project = homeless("prj_api", "api");
        project["locations"] = json!([listed_location(
            Some("dev_old"),
            "desktop",
            json!({ "online": false, "state": "removed" })
        )]);
        let project = view(project);
        assert!(has_no_place(&project));

        let (document, lines) = locations_listing(&config, &project, &project.locations);
        assert_eq!(lines.len(), 4);
        assert_eq!(lines[0], "api");
        assert_eq!(lines[1], "    nowhere");
        assert_eq!(lines[2], format!("      {WAY_BACK}"));
        assert!(lines[3].contains("desktop"), "{}", lines[3]);
        assert!(lines[3].contains("removed"), "{}", lines[3]);
        assert_eq!(document["nowhere"], true);

        // A machine that was revoked and not deleted is still the default of
        // its project, which the gateway does not call nowhere.
        let mut revoked = listed_project("prj_web", "web", json!({ "deviceId": "dev_old" }));
        revoked["locations"] = json!([listed_location(
            Some("dev_old"),
            "desktop",
            json!({ "default": true, "online": false, "state": "removed" })
        )]);
        let revoked = view(revoked);
        assert!(!has_no_place(&revoked));
        let (document, lines) = locations_listing(&config, &revoked, &revoked.locations);
        assert_eq!(lines.len(), 2);
        assert!(lines[1].starts_with("  * desktop"), "{}", lines[1]);
        assert_eq!(document["nowhere"], false);
    }

    #[test]
    fn the_locations_of_a_project_that_has_none_are_printed_without_a_machine() {
        let temp = tempdir().expect("temp directory");
        let config = machine(temp.path());

        let project = view(homeless("prj_api", "api"));
        let (document, lines) = locations_listing(&config, &project, &[]);
        assert_eq!(
            lines,
            ["api", "    nowhere", &format!("      {WAY_BACK}") as &str]
        );
        assert_eq!(
            document,
            json!({ "project": "api", "nowhere": true, "locations": [] })
        );
        for line in &lines {
            assert!(!line.contains(NO_MACHINE), "{line}");
            assert!(!line.contains("unknown"), "{line}");
        }

        let project = view(released("prj_web", "web"));
        let (document, lines) = locations_listing(&config, &project, &project.locations);
        assert_eq!(lines.len(), 2);
        assert!(lines[1].starts_with("  * Exeora Cloud"), "{}", lines[1]);
        assert!(lines[1].contains(" no instance\n"), "{}", lines[1]);
        assert!(
            lines[1].ends_with("`exeora project default web --on cloud`."),
            "{}",
            lines[1]
        );
        // What 0.18.0 printed, and whether the project has a place.
        assert_eq!(document["project"], "web");
        assert_eq!(document["nowhere"], true);
        assert_eq!(document["locations"][0]["state"], "no instance");
        assert_eq!(document["locations"][0]["deviceId"], json!(null));
        assert_eq!(document["locations"][0]["default"], true);
    }

    #[tokio::test]
    async fn the_locations_command_reads_a_project_with_none() {
        let temp = tempdir().expect("temp directory");
        let mut config = machine(temp.path());
        let gateway = Gateway::start(|method, path, _| match (method, path) {
            ("GET", "/api/projects") => (200, json!([homeless("prj_api", "api")])),
            ("GET", "/api/projects/prj_api/locations") => (200, json!({ "locations": [] })),
            _ => (500, json!({ "error": "unexpected" })),
        })
        .await;
        let api = gateway.api().await;
        let listed = || ProjectCommand::Locations {
            slug: Some("api".to_owned()),
            command: None,
        };

        run(&mut config, &api, listed(), false)
            .await
            .expect("listed");
        run(&mut config, &api, listed(), true)
            .await
            .expect("listed");
        assert_eq!(
            gateway
                .received_as("GET", "/api/projects/prj_api/locations")
                .len(),
            2
        );
    }

    #[test]
    fn no_root_is_named_where_no_instance_holds_it() {
        let location: LocationView =
            serde_json::from_value(cloud_with_no_instance()).expect("location");
        assert!(location.has_no_instance());
        assert!(location.is_default);
        assert_eq!(root_selector(&location), None);
    }

    #[tokio::test]
    async fn the_last_location_of_a_repository_is_removed_and_the_project_stays() {
        let temp = tempdir().expect("temp directory");
        let mut config = machine_with_projects(temp.path());
        let gateway = Gateway::start(|method, path, _| match (method, path) {
            ("GET", "/api/projects") => (
                200,
                json!([listed_project("prj_api", "api", json!({
                    "deviceId": "dev_here",
                    "repoUrl": "https://github.com/Acme/API.git",
                    "locations": [
                        listed_location(Some("dev_here"), "laptop", json!({ "default": true, "localPath": "/code/api" })),
                        // Gone already, so it is not a place the project lives.
                        listed_location(Some("dev_old"), "desktop", json!({ "online": false, "state": "removed" })),
                    ],
                }))]),
            ),
            ("DELETE", "/api/projects/prj_api/locations/loc_laptop") => (200, json!({ "ok": true })),
            _ => (500, json!({ "error": "unexpected" })),
        })
        .await;

        run(
            &mut config,
            &gateway.api().await,
            remove_location("api", "here"),
            true,
        )
        .await
        .expect("removed");

        assert_eq!(
            gateway
                .received_as("DELETE", "/api/projects/prj_api/locations/loc_laptop")
                .len(),
            1
        );
        // The project itself was not asked to go.
        assert!(
            gateway
                .received_as("DELETE", "/api/projects/prj_api")
                .is_empty()
        );
        // This machine no longer holds it. What is in the account is the
        // gateway's to keep.
        assert_eq!(saved_slugs(&config), ["notes"]);
    }

    #[test]
    fn says_that_a_project_with_no_location_left_stays_and_lives_nowhere() {
        let project = view(listed_project(
            "prj_api",
            "api",
            json!({ "repoUrl": "https://github.com/Acme/API.git" }),
        ));
        let laptop: LocationView =
            serde_json::from_value(listed_location(Some("dev_here"), "laptop", json!({})))
                .expect("location");

        assert_eq!(
            removed_location(&project, &laptop, false),
            "api no longer lives on laptop."
        );
        assert_eq!(
            removed_location(&project, &laptop, true),
            format!(
                "api no longer lives on laptop. It is still a project of your account, with its MCP URL, its policy and its clients, and it lives nowhere until it is given a place again. {WAY_BACK}"
            )
        );
    }

    #[tokio::test]
    async fn a_directory_with_no_remote_keeps_the_only_place_it_lives() {
        let temp = tempdir().expect("temp directory");
        let mut config = machine_with_projects(temp.path());
        let gateway = Gateway::start(|method, path, _| match (method, path) {
            ("GET", "/api/projects") => (
                200,
                json!([listed_project("prj_notes", "notes", json!({
                    "deviceId": "dev_here",
                    "locations": [listed_location(Some("dev_here"), "laptop", json!({ "default": true, "localPath": "/code/notes" }))],
                }))]),
            ),
            ("DELETE", _) => (
                409,
                json!({
                    "error": "last_location",
                    "message": "This project is a directory on this machine and lives nowhere else. Remove the project instead.",
                }),
            ),
            _ => (500, json!({ "error": "unexpected" })),
        })
        .await;

        let error = run(
            &mut config,
            &gateway.api().await,
            remove_location("notes", "laptop"),
            true,
        )
        .await
        .expect_err("refused");

        assert_eq!(
            error.to_string(),
            "notes is a directory with no remote, and laptop is the only place it lives: nothing could bring it back anywhere else. Remove the project instead with `exeora project remove notes`, or give its checkout a remote and run `exeora sync`."
        );
        // Nothing was forgotten on the strength of a refusal.
        assert_eq!(saved_slugs(&config), ["api", "notes"]);
    }

    #[tokio::test]
    async fn a_refusal_to_remove_a_location_says_what_to_do_next() {
        let refusal = |code: &'static str, message: &'static str| async move {
            let gateway =
                Gateway::start(move |_, _, _| (409, json!({ "error": code, "message": message })))
                    .await;
            gateway
                .api()
                .await
                .remove_location("prj_api", "loc_laptop")
                .await
                .expect_err("refused")
        };
        let repository = view(listed_project(
            "prj_api",
            "api",
            json!({ "repoUrl": "https://github.com/Acme/API.git" }),
        ));
        let laptop: LocationView =
            serde_json::from_value(listed_location(Some("dev_here"), "laptop", json!({})))
                .expect("location");

        // The default, while the project lives somewhere else as well.
        let default = removal_refused(
            &repository,
            &laptop,
            refusal(
                "default_location",
                "Choose another default location before removing this one.",
            )
            .await,
        );
        assert_eq!(
            default.to_string(),
            "laptop is the default location of api. Choose another one first with `exeora project default api --on <machine|cloud>`, then remove this one."
        );

        // A gateway older than the rule refuses a repository its last
        // location, and its own words are what is said.
        let older = removal_refused(
            &repository,
            &laptop,
            refusal(
                "last_location",
                "This is the only place the project lives. Remove the project instead.",
            )
            .await,
        );
        assert_eq!(
            older.to_string(),
            "This is the only place the project lives. Remove the project instead."
        );

        // Anything else is returned as it came.
        let other = removal_refused(
            &repository,
            &laptop,
            refusal("not_found", "No such location.").await,
        );
        assert_eq!(other.to_string(), "No such location.");
    }

    #[tokio::test]
    async fn a_project_that_lives_nowhere_has_no_location_to_lose_or_to_choose() {
        let temp = tempdir().expect("temp directory");
        let mut config = machine(temp.path());
        let gateway = Gateway::start(|method, path, _| match (method, path) {
            ("GET", "/api/projects") => (200, json!([homeless("prj_api", "api")])),
            _ => (500, json!({ "error": "unexpected" })),
        })
        .await;
        let api = gateway.api().await;

        let removed = run(&mut config, &api, remove_location("api", "laptop"), true)
            .await
            .expect_err("nothing to remove");
        assert_eq!(
            removed.to_string(),
            format!(
                "api lives nowhere at the moment, so there is no location to take it off. {WAY_BACK}"
            )
        );

        let chosen = run(&mut config, &api, make_default("api", "desktop"), true)
            .await
            .expect_err("nothing to choose");
        assert_eq!(
            chosen.to_string(),
            "api lives nowhere at the moment. Give it a place with `exeora project locations add api --on desktop`: the first machine a project is given becomes its default location."
        );

        // Nothing but the listing was asked of the gateway.
        assert!(
            gateway
                .received()
                .iter()
                .all(|request| request.method == "GET" && request.path == "/api/projects")
        );

        // A project that lives somewhere is told where, as before.
        let elsewhere = view(listed_project(
            "prj_web",
            "web",
            json!({ "locations": [listed_location(Some("dev_elsewhere"), "desktop", json!({ "default": true }))] }),
        ));
        assert_eq!(
            not_a_location(&elsewhere, "laptop").to_string(),
            "web does not live on laptop. Its locations are: desktop. Add one with `exeora project locations add web --on laptop`."
        );
    }

    #[tokio::test]
    async fn making_exeora_cloud_the_default_asks_for_the_instance_of_the_root() {
        let temp = tempdir().expect("temp directory");
        let mut config = machine(temp.path());
        let gateway = Gateway::start(|method, path, _| match (method, path) {
            ("GET", "/api/projects") => (200, json!([released("prj_web", "web")])),
            ("PUT", "/api/projects/prj_web/default-location") => (
                200,
                json!({ "locations": [listed_location(
                    Some("dev_cloud"),
                    "cloud",
                    json!({
                        "kind": "cloud", "name": "Exeora Cloud", "default": true,
                        "online": false, "status": "cloning", "state": "setting up",
                    })
                )] }),
            ),
            _ => (500, json!({ "error": "unexpected" })),
        })
        .await;

        run(
            &mut config,
            &gateway.api().await,
            make_default("web", "cloud"),
            false,
        )
        .await
        .expect("asked for");

        let sent = gateway.received_as("PUT", "/api/projects/prj_web/default-location");
        assert_eq!(sent.len(), 1);
        assert_eq!(sent[0].body, json!({ "locationId": "loc_cloud" }));
    }

    #[test]
    fn says_when_the_instance_of_the_root_is_being_made() {
        let project = view(released("prj_web", "web"));
        let cloud = &project.locations[0];
        let being_made = places(json!([listed_location(
            Some("dev_cloud"),
            "cloud",
            json!({ "kind": "cloud", "name": "Exeora Cloud", "default": true, "state": "setting up" })
        )]));
        assert_eq!(
            made_default(&project, cloud, &being_made),
            "Calls to web that name no workspace now go to Exeora Cloud. The instance for the project root is being made, which takes about a minute."
        );

        // One that held the root already has nothing to wait for.
        let held = places(json!([listed_location(
            Some("dev_cloud"),
            "cloud",
            json!({ "kind": "cloud", "name": "Exeora Cloud", "state": "asleep" })
        )]));
        assert_eq!(
            made_default(&project, &held[0], &held),
            "Calls to web that name no workspace now go to Exeora Cloud."
        );
        let desktop = places(json!([listed_location(
            Some("dev_desktop"),
            "desktop",
            json!({ "default": true })
        )]));
        assert_eq!(
            made_default(&project, &desktop[0], &desktop),
            "Calls to web that name no workspace now go to desktop."
        );
    }

    #[tokio::test]
    async fn a_workspace_here_is_not_made_of_a_project_that_lives_nowhere() {
        let temp = tempdir().expect("temp directory");
        let mut config = machine(temp.path());
        let gateway = Gateway::start(|method, path, _| match (method, path) {
            ("GET", "/api/projects") => (
                200,
                json!([homeless("prj_api", "api"), released("prj_web", "web")]),
            ),
            _ => (500, json!({ "error": "unexpected" })),
        })
        .await;
        let api = gateway.api().await;

        let error = local_project(&mut config, &api, Some("api"), true)
            .await
            .expect_err("it is not here");
        assert_eq!(
            error.to_string(),
            "api lives nowhere at the moment. Add this machine with `exeora project locations add api --on here` and create the workspace again, or pass `--on cloud` to put it on Exeora Cloud."
        );

        // One that is on Exeora Cloud is told so, as any project that is
        // somewhere else.
        let error = local_project(&mut config, &api, Some("web"), true)
            .await
            .expect_err("it is not here");
        assert_eq!(
            error.to_string(),
            "web does not live on this machine. Its locations are: cloud. Pass --on with one of them, or add this machine with `exeora project locations add web --on here`."
        );
        assert!(!temp.path().join("projects").exists());
        assert!(config.data().projects.is_empty());
    }
}
