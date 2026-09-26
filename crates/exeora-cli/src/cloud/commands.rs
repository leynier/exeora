//! `exeora cloud …`: Exeora Cloud from a laptop's CLI, with the person's own
//! session. Every command is a thin call on the same routes the dashboard
//! uses, plus the waiting a terminal can do for you: a create polls until the
//! machine is ready or has failed, and says which.

use crate::api::{ApiClient, CloudMachineView, CloudProjectView};
use anyhow::{Context, Result, anyhow, bail};
use clap::Subcommand;
use serde_json::json;
use std::{io::Read, time::Duration};

const POLL: Duration = Duration::from_secs(2);
const CREATE_BUDGET: Duration = Duration::from_secs(600);

#[derive(Debug, Subcommand)]
pub enum CloudCommand {
    #[command(about = "Put a repository on a machine Exeora runs for you")]
    Add {
        #[arg(help = "HTTPS clone URL of the repository")]
        git_url: String,
        #[arg(long, help = "Display name; the repository's name by default")]
        name: Option<String>,
        #[arg(long, help = "Project slug; derived from the name by default")]
        slug: Option<String>,
        #[arg(
            long,
            default_value = "main",
            help = "The branch the main workspace checks out"
        )]
        branch: String,
        #[arg(
            long,
            help = "Read a repository access token from stdin, for a private repository"
        )]
        token_stdin: bool,
        #[arg(
            long,
            default_value = "x-access-token",
            help = "The username the token goes with"
        )]
        username: String,
    },
    #[command(about = "List your cloud projects and their machines")]
    List,
    #[command(
        about = "Replace or remove the repository token a cloud project clones with",
        long_about = "Replace or remove the repository token a cloud project clones with. Machines created or retried from now on use it; the ones already running keep the token they were set up with."
    )]
    Credential {
        #[arg(help = "Project slug or id")]
        project: String,
        #[arg(
            long,
            conflicts_with = "clear",
            help = "Read the new repository access token from stdin"
        )]
        token_stdin: bool,
        #[arg(
            long,
            default_value = "x-access-token",
            help = "The username the token goes with"
        )]
        username: String,
        #[arg(long, help = "Remove the stored token: clone as a public repository")]
        clear: bool,
    },
    #[command(about = "Take a cloud project and every one of its machines down")]
    Remove {
        #[arg(help = "Project slug or id")]
        project: String,
        #[arg(short = 'y', long, help = "Do not ask first")]
        yes: bool,
    },
    #[command(about = "Manage the workspaces of a cloud project, each a machine of its own")]
    Workspace {
        #[command(subcommand)]
        command: CloudWorkspaceCommand,
    },
}

#[derive(Debug, Subcommand)]
pub enum CloudWorkspaceCommand {
    #[command(about = "Create a workspace on a new machine, on a branch")]
    Create {
        #[arg(help = "Project slug or id")]
        project: String,
        branch: String,
        #[arg(
            long = "from",
            help = "Ref to start the branch from when it does not exist yet"
        )]
        from_ref: Option<String>,
    },
    #[command(about = "Take a workspace's machine down")]
    Remove {
        #[arg(help = "Project slug or id")]
        project: String,
        #[arg(help = "Workspace slug or id")]
        workspace: String,
        #[arg(short = 'y', long, help = "Do not ask first")]
        yes: bool,
    },
}

pub async fn run(api: &ApiClient, command: CloudCommand, json_output: bool) -> Result<()> {
    match command {
        CloudCommand::List => list(api, json_output).await,
        CloudCommand::Add {
            git_url,
            name,
            slug,
            branch,
            token_stdin,
            username,
        } => {
            let name = name.unwrap_or_else(|| repository_name(&git_url));
            let slug = slug.unwrap_or_else(|| slugify(&name));
            let mut body =
                json!({ "name": name, "slug": slug, "repoUrl": git_url, "defaultBranch": branch });
            if token_stdin {
                body["token"] = json!(token_from_stdin()?);
                body["username"] = json!(username);
            }
            let created = api.cloud_add_project(body).await?;
            if !json_output {
                println!("Creating {slug} on a new machine…");
            }
            let machine = wait_ready(api, &created.device_id, json_output).await?;
            finish(json_output, "project", &slug, &machine)
        }
        CloudCommand::Credential {
            project,
            token_stdin,
            username,
            clear,
        } => {
            if !token_stdin && !clear {
                bail!("Pass --token-stdin with the new token on stdin, or --clear to remove it.");
            }
            let project = find_project(api, &project).await?;
            let body = if clear {
                json!({ "token": null })
            } else {
                json!({ "token": token_from_stdin()?, "username": username })
            };
            api.cloud_set_credential(&project.project_id, body).await?;
            if json_output {
                println!(
                    "{}",
                    json!({ "credential": if clear { "cleared" } else { "set" }, "slug": project.slug, "appliesTo": "new_machines" })
                );
            } else if clear {
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
        CloudCommand::Remove { project, yes } => {
            let project = find_project(api, &project).await?;
            let machines = project.machines.len();
            if !confirm(
                yes,
                json_output,
                &format!(
                    "Remove {} and its {machines} machine(s)? Anything not pushed from them is lost.",
                    project.slug
                ),
            )? {
                return Ok(());
            }
            api.cloud_remove_project(&project.project_id).await?;
            done(
                json_output,
                json!({ "removed": "project", "slug": project.slug }),
            )
        }
        CloudCommand::Workspace { command } => match command {
            CloudWorkspaceCommand::Create {
                project,
                branch,
                from_ref,
            } => {
                let project = find_project(api, &project).await?;
                let mut body = json!({ "branch": branch });
                if let Some(from) = from_ref {
                    body["from"] = json!(from);
                }
                let created = api.cloud_add_workspace(&project.project_id, body).await?;
                let slug = created.slug.clone().unwrap_or_else(|| branch.clone());
                if !json_output {
                    println!("Creating {}/{slug} on a new machine…", project.slug);
                }
                let machine = wait_ready(api, &created.device_id, json_output).await?;
                finish(json_output, "workspace", &slug, &machine)
            }
            CloudWorkspaceCommand::Remove {
                project,
                workspace,
                yes,
            } => {
                let project = find_project(api, &project).await?;
                let machine = project
                    .machines
                    .iter()
                    .find(|machine| {
                        machine.workspace_id.as_deref() == Some(&workspace)
                            || machine.workspace_slug == workspace
                    })
                    .ok_or_else(|| anyhow!("No workspace {workspace} in {}.", project.slug))?;
                let Some(workspace_id) = machine.workspace_id.clone() else {
                    bail!("The main workspace is the project itself. Use `exeora cloud remove`.");
                };
                if !confirm(
                    yes,
                    json_output,
                    &format!(
                        "Remove {}/{} and its machine? Anything not pushed from it is lost.",
                        project.slug, machine.workspace_slug
                    ),
                )? {
                    return Ok(());
                }
                api.cloud_remove_workspace(&project.project_id, &workspace_id)
                    .await?;
                done(
                    json_output,
                    json!({ "removed": "workspace", "slug": machine.workspace_slug }),
                )
            }
        },
    }
}

async fn list(api: &ApiClient, json_output: bool) -> Result<()> {
    let projects = api.cloud_projects().await?;
    if json_output {
        println!("{}", serde_json::to_string(&projects)?);
        return Ok(());
    }
    if projects.is_empty() {
        println!("No cloud projects. Put one on a machine with `exeora cloud add <git-url>`.");
        return Ok(());
    }
    for project in projects {
        println!(
            "{}  {}  ({})",
            project.slug, project.repo_url, project.default_branch
        );
        for machine in project.machines {
            println!("  {}", describe(&machine));
        }
    }
    Ok(())
}

fn describe(machine: &CloudMachineView) -> String {
    let state = match machine.status.as_str() {
        "ready" if machine.online => "awake".to_owned(),
        "ready" => "asleep".to_owned(),
        "creating" => format!(
            "creating: {}",
            machine.step.as_deref().unwrap_or("starting")
        ),
        "error" => format!("error: {}", machine.error.as_deref().unwrap_or("unknown")),
        other => other.to_owned(),
    };
    format!(
        "{:<24} {:<24} {state}",
        machine.workspace_slug,
        machine.branch.as_deref().unwrap_or("-")
    )
}

/// Polls the listing until the machine is ready or has failed.
async fn wait_ready(
    api: &ApiClient,
    device_id: &str,
    json_output: bool,
) -> Result<CloudMachineView> {
    let started = tokio::time::Instant::now();
    let mut last_step: Option<String> = None;
    loop {
        let projects = api.cloud_projects().await?;
        let machine = projects
            .into_iter()
            .flat_map(|project| project.machines)
            .find(|machine| machine.device_id == device_id)
            .ok_or_else(|| anyhow!("The machine disappeared while it was being created."))?;
        if json_output {
            println!(
                "{}",
                json!({ "event": "cloud.status", "deviceId": device_id, "status": machine.status, "step": machine.step, "error": machine.error })
            );
        } else if machine.step != last_step
            && let Some(step) = &machine.step
        {
            println!("  {step}…");
            last_step = Some(step.clone());
        }
        match machine.status.as_str() {
            "ready" => return Ok(machine),
            "error" => bail!(
                "The machine could not be created: {}",
                machine.error.as_deref().unwrap_or("unknown error")
            ),
            _ => {}
        }
        if started.elapsed() > CREATE_BUDGET {
            bail!("The machine is still being created. Check `exeora cloud list` later.");
        }
        tokio::time::sleep(POLL).await;
    }
}

async fn find_project(api: &ApiClient, selector: &str) -> Result<CloudProjectView> {
    api.cloud_projects()
        .await?
        .into_iter()
        .find(|project| project.slug == selector || project.project_id == selector)
        .ok_or_else(|| anyhow!("No cloud project {selector}. See `exeora cloud list`."))
}

fn confirm(yes: bool, json_output: bool, question: &str) -> Result<bool> {
    if yes {
        return Ok(true);
    }
    if json_output {
        bail!("Pass -y to confirm in --json mode.");
    }
    Ok(cliclack::confirm(question)
        .initial_value(false)
        .interact()?)
}

fn finish(json_output: bool, kind: &str, slug: &str, machine: &CloudMachineView) -> Result<()> {
    if json_output {
        println!(
            "{}",
            serde_json::to_string(&json!({ "created": kind, "slug": slug, "machine": machine }))?
        );
    } else {
        println!("✓ {slug} is ready.");
    }
    Ok(())
}

fn done(json_output: bool, fields: serde_json::Value) -> Result<()> {
    if json_output {
        println!("{fields}");
    } else {
        println!("✓ Removal started.");
    }
    Ok(())
}

/// A token only ever arrives on stdin: never in argv, so never in a shell
/// history or a process list.
fn token_from_stdin() -> Result<String> {
    let mut token = String::new();
    std::io::stdin()
        .read_to_string(&mut token)
        .context("Could not read the token from stdin")?;
    let token = token.trim();
    if token.is_empty() {
        bail!("No token arrived on stdin.");
    }
    Ok(token.to_owned())
}

/// `https://github.com/leynier/exeora.git` is `exeora`.
fn repository_name(git_url: &str) -> String {
    git_url
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .unwrap_or(git_url)
        .trim_end_matches(".git")
        .to_owned()
}

fn slugify(value: &str) -> String {
    let mut result = String::new();
    let mut hyphen = false;
    for character in value.chars().flat_map(char::to_lowercase) {
        if character.is_ascii_alphanumeric() {
            result.push(character);
            hyphen = false;
        } else if !result.is_empty() && !hyphen {
            result.push('-');
            hyphen = true;
        }
        if result.len() >= 60 {
            break;
        }
    }
    while result.ends_with('-') {
        result.pop();
    }
    if result.is_empty() {
        "project".to_owned()
    } else {
        result
    }
}

#[cfg(test)]
mod tests {
    use super::{repository_name, slugify};

    #[test]
    fn names_a_project_after_its_repository() {
        assert_eq!(
            repository_name("https://github.com/leynier/exeora.git"),
            "exeora"
        );
        assert_eq!(
            repository_name("https://github.com/leynier/exeora/"),
            "exeora"
        );
        assert_eq!(slugify("Exeora Cloud!"), "exeora-cloud");
        assert_eq!(slugify("///"), "project");
    }
}
