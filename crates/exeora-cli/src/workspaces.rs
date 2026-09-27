use crate::{
    api::ApiClient,
    config::{ConfigStore, ProjectEntry, WorkspaceEntry, WorkspaceSyncState},
};
use anyhow::{Context, Result, anyhow, bail};
use serde::Serialize;
use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
};
use uuid::Uuid;

pub struct CreateWorkspace {
    pub branch: String,
    pub from: Option<String>,
    pub reuse_existing_branch: bool,
    pub name: Option<String>,
    pub slug: Option<String>,
    pub path: Option<PathBuf>,
    /// Directory to run `git worktree add` from. Defaults to the current
    /// checkout of this repository, then the registered project root.
    pub source: Option<PathBuf>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicWorkspace {
    pub id: String,
    pub slug: String,
    pub name: String,
    pub branch: Option<String>,
    pub managed: bool,
}

impl From<&WorkspaceEntry> for PublicWorkspace {
    fn from(entry: &WorkspaceEntry) -> Self {
        Self {
            id: entry.id.clone(),
            slug: entry.slug.clone(),
            name: entry.name.clone(),
            branch: entry.branch.clone(),
            managed: entry.managed,
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitWorkspaceInfo {
    pub path: PathBuf,
    pub branch: Option<String>,
    pub primary: bool,
    pub connected: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connected_slug: Option<String>,
}

pub struct WorkspaceOutcome {
    pub entry: WorkspaceEntry,
    pub outcome: &'static str,
    /// Why the gateway did not take it, when trying again would not help.
    pub problem: Option<String>,
}

pub struct RemoveOutcome {
    pub entry: WorkspaceEntry,
    pub outcome: &'static str,
    pub branch_deleted: bool,
}

pub fn resolve_project(config: &ConfigStore, selector: Option<&str>) -> Result<ProjectEntry> {
    if let Some(selector) = selector {
        return config
            .data()
            .projects
            .iter()
            .find(|project| project.id == selector || project.slug.eq_ignore_ascii_case(selector))
            .cloned()
            .ok_or_else(|| anyhow!("No project called {selector} on this machine."));
    }

    let cwd = fs::canonicalize(env::current_dir()?)?;
    let direct = config
        .data()
        .projects
        .iter()
        .filter_map(|project| {
            fs::canonicalize(&project.root)
                .ok()
                .filter(|root| cwd.starts_with(root))
                .map(|root| (root.components().count(), project.clone()))
        })
        .max_by_key(|(depth, _)| *depth)
        .map(|(_, project)| project);
    if let Some(project) = direct {
        return Ok(project);
    }
    let from_workspace = config
        .data()
        .workspaces
        .iter()
        .filter_map(|entry| {
            fs::canonicalize(&entry.root)
                .ok()
                .filter(|root| cwd.starts_with(root))
                .map(|root| (root.components().count(), entry.project_id.as_str()))
        })
        .max_by_key(|(depth, _)| *depth)
        .and_then(|(_, project_id)| config.find_project(project_id))
        .cloned();
    from_workspace.ok_or_else(|| {
        anyhow!("The current directory is not inside an Exeora project. Pass --project <slug|id>.")
    })
}

pub fn create(
    config: &ConfigStore,
    project: &ProjectEntry,
    input: CreateWorkspace,
) -> Result<WorkspaceEntry> {
    let branch_slug = slugify(&input.branch);
    let slug = input.slug.unwrap_or(branch_slug);
    validate_slug(&slug)?;
    ensure_unique(config, project, &slug, None)?;

    let destination = input
        .path
        .unwrap_or(config.workspace_root()?.join(&project.slug).join(&slug));
    let destination = absolute(destination)?;
    validate_destination(config, &destination)?;
    if destination.exists() {
        bail!("{} already exists.", destination.display());
    }
    if let Some(parent) = destination.parent() {
        fs::create_dir_all(parent)?;
    }

    let mut args = vec!["worktree".to_owned(), "add".to_owned()];
    if input.reuse_existing_branch {
        args.push(destination.to_string_lossy().into_owned());
        args.push(input.branch.clone());
    } else {
        args.push("-b".to_owned());
        args.push(input.branch.clone());
        args.push(destination.to_string_lossy().into_owned());
        args.push(input.from.unwrap_or_else(|| "HEAD".to_owned()));
    }
    let source = input
        .source
        .filter(|path| path.is_dir())
        .or_else(|| current_repository_for(project))
        .unwrap_or_else(|| project.root.clone());
    git_checked(&source, &args)?;

    match entry_for_path(
        config,
        project,
        &destination,
        input.name.unwrap_or_else(|| input.branch.clone()),
        slug,
        true,
    ) {
        Ok(entry) => Ok(entry),
        Err(error) => {
            let _ = git_checked(
                &project.root,
                &[
                    "worktree".to_owned(),
                    "remove".to_owned(),
                    "--force".to_owned(),
                    destination.to_string_lossy().into_owned(),
                ],
            );
            Err(error)
        }
    }
}

fn current_repository_for(project: &ProjectEntry) -> Option<PathBuf> {
    let cwd = env::current_dir().ok()?;
    let current = git_path(&cwd, &["rev-parse", "--git-common-dir"]).ok()?;
    let project_common = git_path(&project.root, &["rev-parse", "--git-common-dir"]).ok()?;
    (fs::canonicalize(current).ok()? == fs::canonicalize(project_common).ok()?).then_some(cwd)
}

pub fn attach(
    config: &ConfigStore,
    project: &ProjectEntry,
    path: &Path,
    name: Option<String>,
    slug: Option<String>,
) -> Result<WorkspaceEntry> {
    let path = fs::canonicalize(path)
        .with_context(|| format!("Could not open workspace {}", path.display()))?;
    let branch =
        git_optional(&path, &["branch", "--show-current"])?.filter(|value| !value.is_empty());
    let fallback = branch
        .as_deref()
        .and_then(|value| value.rsplit('/').next())
        .unwrap_or_else(|| {
            path.file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("workspace")
        });
    let slug = slug.unwrap_or_else(|| slugify(fallback));
    validate_slug(&slug)?;
    ensure_unique(config, project, &slug, None)?;
    entry_for_path(
        config,
        project,
        &path,
        name.unwrap_or_else(|| fallback.to_owned()),
        slug,
        false,
    )
}

pub fn discover(config: &ConfigStore, project: &ProjectEntry) -> Result<Vec<GitWorkspaceInfo>> {
    let main = fs::canonicalize(git_path(&project.root, &["rev-parse", "--show-toplevel"])?)?;
    let output = git_output(&project.root, &["worktree", "list", "--porcelain"])?;
    let mut discovered = parse_worktree_porcelain(&output);

    for item in &mut discovered {
        let canonical = fs::canonicalize(&item.path).unwrap_or_else(|_| item.path.clone());
        item.path = canonical.clone();
        item.primary = canonical == main;
        item.connected_slug = config.data().workspaces.iter().find_map(|entry| {
            let root = fs::canonicalize(&entry.git_root).ok()?;
            (entry.project_id == project.id && root == canonical).then(|| entry.slug.clone())
        });
        item.connected = item.connected_slug.is_some();
    }

    Ok(discovered)
}

pub fn path_for_branch(
    config: &ConfigStore,
    project: &ProjectEntry,
    branch: &str,
) -> Result<PathBuf> {
    let matches: Vec<_> = discover(config, project)?
        .into_iter()
        .filter(|item| item.branch.as_deref() == Some(branch))
        .collect();
    match matches.as_slice() {
        [] => bail!("No Git workspace has branch {branch} checked out."),
        [item] if item.primary => {
            bail!("The primary project root is selected by `main` and cannot be attached again.")
        }
        [item] if item.connected => bail!("That Git workspace is already connected to Exeora."),
        [item] => Ok(item.path.clone()),
        _ => bail!("More than one Git workspace has branch {branch} checked out; attach by path."),
    }
}

pub async fn persist(
    config: &mut ConfigStore,
    api: &ApiClient,
    mut entry: WorkspaceEntry,
) -> Result<WorkspaceOutcome> {
    config.upsert_workspace(entry.clone());
    config.save()?;
    let device_id = config.data().device_id.clone();
    let mut problem = None;
    let outcome = match api
        .put_workspace(&entry.project_id, &entry, device_id.as_deref())
        .await
    {
        Ok(stored) => {
            adopt_registration(&mut entry, &stored);
            entry.sync_state = WorkspaceSyncState::Active;
            config.upsert_workspace(entry.clone());
            config.save()?;
            "active"
        }
        Err(error) => {
            problem = refusal(&error);
            "pendingUpsert"
        }
    };
    Ok(WorkspaceOutcome {
        entry,
        outcome,
        problem,
    })
}

/// What to do about a refusal that `exeora sync` alone would meet again.
fn refusal(error: &anyhow::Error) -> Option<String> {
    match crate::api::error_code(error)? {
        "not_a_location" => Some(
            "This machine is not one of the project's locations. Add it with `exeora project locations add <project> --on here`, then run `exeora sync`.".to_owned(),
        ),
        "slug_conflict" => Some(
            "Another workspace of the project on this machine has that slug. Detach this one and attach it again with another --slug.".to_owned(),
        ),
        _ => None,
    }
}

/// Takes the slug and the name the gateway stored, which are the ones it
/// routes by. They are what was sent unless the same branch already has a
/// workspace in another location of the project: then the gateway keeps both
/// apart with a suffix, and a local entry under the slug that was asked for
/// would never match a call again.
pub fn adopt_registration(entry: &mut WorkspaceEntry, stored: &crate::api::WorkspaceView) {
    if stored.id != entry.id {
        return;
    }
    if validate_slug(&stored.slug).is_ok() && !stored.slug.eq_ignore_ascii_case("main") {
        entry.slug = stored.slug.clone();
    }
    if !stored.name.trim().is_empty() {
        entry.name = stored.name.clone();
    }
}

pub async fn detach(
    config: &mut ConfigStore,
    api: &ApiClient,
    mut entry: WorkspaceEntry,
) -> Result<WorkspaceOutcome> {
    entry.sync_state = WorkspaceSyncState::Disabled;
    config.upsert_workspace(entry.clone());
    config.save()?;
    let outcome = match api.remove_workspace(&entry.project_id, &entry.id).await {
        Ok(_) => {
            config.remove_workspace(&entry.id);
            config.save()?;
            "detached"
        }
        Err(_) => {
            entry.sync_state = WorkspaceSyncState::PendingDelete;
            config.upsert_workspace(entry.clone());
            config.save()?;
            "pendingDelete"
        }
    };
    Ok(WorkspaceOutcome {
        entry,
        outcome,
        problem: None,
    })
}

pub async fn remove(
    config: &mut ConfigStore,
    api: &ApiClient,
    project: &ProjectEntry,
    mut entry: WorkspaceEntry,
    force: bool,
    delete_branch_after: bool,
) -> Result<RemoveOutcome> {
    if is_dirty(&entry)? && !force {
        bail!(
            "{} has uncommitted changes. Pass force: true to remove it anyway.",
            entry.slug
        );
    }
    let branch = if delete_branch_after {
        Some(
            entry
                .branch
                .clone()
                .context("The workspace is detached at HEAD, so it has no branch to delete")?,
        )
    } else {
        None
    };
    entry.sync_state = WorkspaceSyncState::Removing;
    config.upsert_workspace(entry.clone());
    config.save()?;
    if let Err(error) = remove_git_worktree(project, &entry, force) {
        entry.sync_state = WorkspaceSyncState::Active;
        config.upsert_workspace(entry);
        config.save()?;
        return Err(error);
    }
    entry.sync_state = WorkspaceSyncState::PendingDelete;
    config.upsert_workspace(entry.clone());
    config.save()?;
    let remote_removed = api
        .remove_workspace(&entry.project_id, &entry.id)
        .await
        .is_ok();
    if remote_removed {
        config.remove_workspace(&entry.id);
        config.save()?;
    }
    let branch_deleted = match branch {
        Some(branch) => {
            delete_branch(project, &branch)?;
            true
        }
        None => false,
    };
    Ok(RemoveOutcome {
        entry,
        outcome: if remote_removed {
            "removed"
        } else {
            "pendingDelete"
        },
        branch_deleted,
    })
}

fn parse_worktree_porcelain(output: &str) -> Vec<GitWorkspaceInfo> {
    let mut result = Vec::new();
    let mut path: Option<PathBuf> = None;
    let mut branch: Option<String> = None;
    let flush = |result: &mut Vec<GitWorkspaceInfo>,
                 path: &mut Option<PathBuf>,
                 branch: &mut Option<String>| {
        if let Some(path) = path.take() {
            result.push(GitWorkspaceInfo {
                path,
                branch: branch.take(),
                primary: false,
                connected: false,
                connected_slug: None,
            });
        }
    };
    for line in output.lines() {
        if let Some(value) = line.strip_prefix("worktree ") {
            flush(&mut result, &mut path, &mut branch);
            path = Some(PathBuf::from(value));
        } else if let Some(value) = line.strip_prefix("branch refs/heads/") {
            branch = Some(value.to_owned());
        } else if line.is_empty() {
            flush(&mut result, &mut path, &mut branch);
        }
    }
    flush(&mut result, &mut path, &mut branch);
    result
}

fn entry_for_path(
    config: &ConfigStore,
    project: &ProjectEntry,
    path: &Path,
    name: String,
    slug: String,
    managed: bool,
) -> Result<WorkspaceEntry> {
    let main_git_root = git_path(&project.root, &["rev-parse", "--show-toplevel"])?;
    let worktree_git_root = git_path(path, &["rev-parse", "--show-toplevel"])?;
    let main_git_root = fs::canonicalize(main_git_root)?;
    let worktree_git_root = fs::canonicalize(worktree_git_root)?;
    if main_git_root == worktree_git_root {
        bail!("The primary project root is selected by `main` and cannot be attached again.");
    }
    if config
        .data()
        .workspaces
        .iter()
        .any(|entry| fs::canonicalize(&entry.git_root).ok().as_ref() == Some(&worktree_git_root))
    {
        bail!("That Git workspace is already connected to Exeora.");
    }
    let main_common = git_path(&project.root, &["rev-parse", "--git-common-dir"])?;
    let worktree_common = git_path(path, &["rev-parse", "--git-common-dir"])?;
    if fs::canonicalize(main_common)? != fs::canonicalize(worktree_common)? {
        bail!(
            "{} is not a workspace of the repository serving {}.",
            path.display(),
            project.slug
        );
    }
    let relative_root = fs::canonicalize(&project.root)?
        .strip_prefix(&main_git_root)
        .context("The registered project root is outside its Git workspace")?
        .to_path_buf();
    let root = worktree_git_root.join(relative_root);
    if !root.is_dir() {
        bail!(
            "The branch does not contain the registered project subdirectory {}.",
            root.display()
        );
    }
    let branch = git_optional(&worktree_git_root, &["branch", "--show-current"])?
        .filter(|value| !value.is_empty());
    Ok(WorkspaceEntry {
        id: format!("wsp_{}", Uuid::new_v4().simple()),
        project_id: project.id.clone(),
        slug,
        name,
        branch,
        git_root: worktree_git_root,
        root: fs::canonicalize(root)?,
        managed,
        sync_state: WorkspaceSyncState::PendingUpsert,
    })
}

pub fn ensure_unique(
    config: &ConfigStore,
    project: &ProjectEntry,
    slug: &str,
    except_id: Option<&str>,
) -> Result<()> {
    if slug.eq_ignore_ascii_case("main") {
        bail!("`main` is reserved for the project's primary workspace.");
    }
    if config.data().workspaces.iter().any(|entry| {
        entry.project_id == project.id
            && entry.slug.eq_ignore_ascii_case(slug)
            && except_id != Some(entry.id.as_str())
    }) {
        bail!("Workspace {slug} is already connected to {}.", project.slug);
    }
    Ok(())
}

pub fn validate_destination(config: &ConfigStore, destination: &Path) -> Result<()> {
    let destination = normalized_nonexistent(destination)?;
    for (kind, root) in config
        .data()
        .projects
        .iter()
        .map(|entry| ("project", &entry.root))
        .chain(
            config
                .data()
                .workspaces
                .iter()
                .map(|entry| ("workspace", &entry.git_root)),
        )
    {
        if let Ok(root) = fs::canonicalize(root)
            && destination.starts_with(&root)
        {
            bail!(
                "Refusing to create a workspace inside the existing {kind} at {}.",
                root.display()
            );
        }
    }
    Ok(())
}

pub fn is_dirty(entry: &WorkspaceEntry) -> Result<bool> {
    Ok(!git_output(&entry.git_root, &["status", "--porcelain"])?.is_empty())
}

pub fn remove_git_worktree(
    project: &ProjectEntry,
    entry: &WorkspaceEntry,
    force: bool,
) -> Result<()> {
    let mut args = vec!["worktree".to_owned(), "remove".to_owned()];
    if force {
        args.push("--force".to_owned());
    }
    args.push(entry.git_root.to_string_lossy().into_owned());
    git_checked(&project.root, &args)
}

pub fn delete_branch(project: &ProjectEntry, branch: &str) -> Result<()> {
    git_checked(
        &project.root,
        &["branch".to_owned(), "-d".to_owned(), branch.to_owned()],
    )
}

fn validate_slug(slug: &str) -> Result<()> {
    let valid = !slug.is_empty()
        && slug.len() <= 60
        && slug
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        && slug.as_bytes()[0].is_ascii_alphanumeric();
    if !valid {
        bail!("Workspace slugs use lowercase letters, digits and hyphens (max 60 characters).");
    }
    Ok(())
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
        "workspace".to_owned()
    } else {
        result
    }
}

fn absolute(path: PathBuf) -> Result<PathBuf> {
    Ok(if path.is_absolute() {
        path
    } else {
        env::current_dir()?.join(path)
    })
}

fn normalized_nonexistent(path: &Path) -> Result<PathBuf> {
    if path.exists() {
        return Ok(fs::canonicalize(path)?);
    }
    let parent = path
        .parent()
        .context("Workspace destination has no parent")?;
    fs::create_dir_all(parent)?;
    Ok(fs::canonicalize(parent)?.join(
        path.file_name()
            .context("Workspace destination has no name")?,
    ))
}

fn git_path(cwd: &Path, args: &[&str]) -> Result<PathBuf> {
    let value = git_output(cwd, args)?;
    let path = PathBuf::from(value);
    Ok(if path.is_absolute() {
        path
    } else {
        cwd.join(path)
    })
}

fn git_optional(cwd: &Path, args: &[&str]) -> Result<Option<String>> {
    Ok(Some(git_output(cwd, args)?))
}

fn git_output(cwd: &Path, args: &[&str]) -> Result<String> {
    let output = Command::new("git").arg("-C").arg(cwd).args(args).output()?;
    if !output.status.success() {
        bail!(
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(String::from_utf8(output.stdout)?.trim().to_owned())
}

fn git_checked(cwd: &Path, args: &[String]) -> Result<()> {
    let output = Command::new("git").arg("-C").arg(cwd).args(args).output()?;
    if !output.status.success() {
        bail!(
            "git {} failed: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr).trim()
        );
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        CreateWorkspace, adopt_registration, attach, create, discover, is_dirty, path_for_branch,
        persist, remove_git_worktree, slugify,
    };
    use crate::{
        config::{ConfigStore, ProjectEntry, WorkspaceSyncState},
        testing::Gateway,
    };
    use serde_json::json;
    use std::{fs, process::Command};
    use tempfile::tempdir;

    #[test]
    fn creates_safe_slugs_from_branch_names() {
        assert_eq!(slugify("feature/Workspaces!"), "feature-workspaces");
    }

    #[test]
    fn creates_and_tracks_a_native_git_workspace() {
        let temp = tempdir().expect("temp directory");
        let repository = temp.path().join("repository");
        fs::create_dir(&repository).expect("repository");
        git(&repository, &["init"]);
        git(&repository, &["config", "user.email", "test@example.com"]);
        git(&repository, &["config", "user.name", "Exeora Test"]);
        fs::write(repository.join("tracked.txt"), "main\n").expect("fixture");
        git(&repository, &["add", "tracked.txt"]);
        git(&repository, &["commit", "-m", "initial"]);

        let mut config = ConfigStore::load_from(temp.path().join("config.json")).expect("config");
        let project = ProjectEntry {
            id: "prj_test".to_owned(),
            slug: "repository".to_owned(),
            name: "Repository".to_owned(),
            root: fs::canonicalize(&repository).expect("root"),
            repo_url: None,
            default_branch: None,
        };
        config.upsert_project(project.clone());
        let destination = temp.path().join("feature-workspace");

        let entry = create(
            &config,
            &project,
            CreateWorkspace {
                branch: "feature/workspaces".to_owned(),
                from: None,
                reuse_existing_branch: false,
                name: None,
                slug: None,
                path: Some(destination),
                source: None,
            },
        )
        .expect("workspace");

        assert_eq!(entry.slug, "feature-workspaces");
        assert_eq!(entry.branch.as_deref(), Some("feature/workspaces"));
        assert_eq!(entry.sync_state, WorkspaceSyncState::PendingUpsert);
        assert!(entry.root.join("tracked.txt").is_file());
        assert!(!is_dirty(&entry).expect("status"));

        remove_git_worktree(&project, &entry, false).expect("remove");
        assert!(!entry.git_root.exists());
    }

    #[test]
    fn discovers_and_attaches_an_existing_workspace_by_branch() {
        let temp = tempdir().expect("temp directory");
        let repository = temp.path().join("repository");
        fs::create_dir(&repository).expect("repository");
        git(&repository, &["init"]);
        git(&repository, &["config", "user.email", "test@example.com"]);
        git(&repository, &["config", "user.name", "Exeora Test"]);
        fs::write(repository.join("tracked.txt"), "main\n").expect("fixture");
        git(&repository, &["add", "tracked.txt"]);
        git(&repository, &["commit", "-m", "initial"]);

        let external = temp.path().join("external");
        let external_text = external.to_string_lossy().into_owned();
        git(
            &repository,
            &["worktree", "add", "-b", "feature/existing", &external_text],
        );
        let mut config = ConfigStore::load_from(temp.path().join("config.json")).expect("config");
        let project = ProjectEntry {
            id: "prj_test".to_owned(),
            slug: "repository".to_owned(),
            name: "Repository".to_owned(),
            root: fs::canonicalize(&repository).expect("root"),
            repo_url: None,
            default_branch: None,
        };
        config.upsert_project(project.clone());

        let inventory = discover(&config, &project).expect("inventory");
        assert_eq!(inventory.len(), 2);
        let candidate = inventory
            .iter()
            .find(|item| item.branch.as_deref() == Some("feature/existing"))
            .expect("feature workspace");
        assert!(!candidate.primary);
        assert!(!candidate.connected);
        assert_eq!(
            path_for_branch(&config, &project, "feature/existing").expect("branch path"),
            fs::canonicalize(&external).expect("external path")
        );

        let entry = attach(
            &config,
            &project,
            &external,
            None,
            Some("existing".to_owned()),
        )
        .expect("attached workspace");
        assert!(!entry.managed);
        config.upsert_workspace(entry);
        let connected = discover(&config, &project).expect("connected inventory");
        let candidate = connected
            .iter()
            .find(|item| item.branch.as_deref() == Some("feature/existing"))
            .expect("feature workspace");
        assert!(candidate.connected);
        assert_eq!(candidate.connected_slug.as_deref(), Some("existing"));
        assert!(path_for_branch(&config, &project, "feature/existing").is_err());
    }

    /// A repository with one commit and a workspace of it that is not yet
    /// known to the gateway.
    fn pending_workspace(temp: &std::path::Path) -> (ConfigStore, crate::config::WorkspaceEntry) {
        let repository = temp.join("repository");
        fs::create_dir(&repository).expect("repository");
        git(&repository, &["init"]);
        git(&repository, &["config", "user.email", "test@example.com"]);
        git(&repository, &["config", "user.name", "Exeora Test"]);
        fs::write(repository.join("tracked.txt"), "main\n").expect("fixture");
        git(&repository, &["add", "tracked.txt"]);
        git(&repository, &["commit", "-m", "initial"]);

        let mut config = ConfigStore::load_from(temp.join("config.json")).expect("config");
        config.data_mut().device_id = Some("dev_laptop".to_owned());
        let project = ProjectEntry {
            id: "prj_test".to_owned(),
            slug: "repository".to_owned(),
            name: "Repository".to_owned(),
            root: fs::canonicalize(&repository).expect("root"),
            repo_url: None,
            default_branch: None,
        };
        config.upsert_project(project.clone());
        let entry = create(
            &config,
            &project,
            CreateWorkspace {
                branch: "fix/login".to_owned(),
                from: None,
                reuse_existing_branch: false,
                name: None,
                slug: None,
                path: Some(temp.join("fix-login")),
                source: None,
            },
        )
        .expect("workspace");
        (config, entry)
    }

    #[tokio::test]
    async fn takes_the_slug_and_the_name_the_gateway_stored() {
        let temp = tempdir().expect("temp directory");
        let (mut config, entry) = pending_workspace(temp.path());
        assert_eq!(entry.slug, "fix-login");
        // The same branch already has a workspace in another location of the
        // project, so the gateway keeps this one apart with a suffix.
        let gateway = Gateway::start(|_, _, body| {
            (
                200,
                json!({
                    "id": "wsp_other",
                    "projectId": "prj_test",
                    "slug": format!("{}-laptop", body["slug"].as_str().unwrap_or_default()),
                    "name": "fix/login (laptop)",
                    "branch": body["branch"],
                    "localPath": body["localPath"],
                    "managed": true,
                    "deviceId": body["deviceId"],
                    "cloud": false,
                    "machine": "laptop",
                    "createdAt": 1,
                    "updatedAt": 1,
                }),
            )
        })
        .await;
        let api = gateway.api().await;

        // An answer about another workspace is not this one's to take.
        let foreign = persist(&mut config, &api, entry.clone())
            .await
            .expect("outcome");
        assert_eq!(foreign.outcome, "active");
        assert_eq!(foreign.entry.slug, "fix-login");

        let gateway = Gateway::start(|_, path, body| {
            (
                200,
                json!({
                    "id": path.rsplit('/').next().unwrap_or_default(),
                    "projectId": "prj_test",
                    "slug": format!("{}-laptop", body["slug"].as_str().unwrap_or_default()),
                    "name": "fix/login (laptop)",
                    "branch": body["branch"],
                    "localPath": body["localPath"],
                    "managed": true,
                    "deviceId": body["deviceId"],
                    "cloud": false,
                    "machine": "laptop",
                    "createdAt": 1,
                    "updatedAt": 1,
                }),
            )
        })
        .await;
        let api = gateway.api().await;
        let outcome = persist(&mut config, &api, entry.clone())
            .await
            .expect("outcome");

        assert_eq!(outcome.outcome, "active");
        assert_eq!(outcome.entry.slug, "fix-login-laptop");
        assert_eq!(outcome.entry.name, "fix/login (laptop)");
        assert_eq!(outcome.entry.sync_state, WorkspaceSyncState::Active);
        let sent = gateway.received();
        assert_eq!(sent.len(), 1);
        assert_eq!(sent[0].method, "PUT");
        assert_eq!(
            sent[0].path,
            format!("/api/projects/prj_test/workspaces/{}", entry.id)
        );
        assert_eq!(sent[0].body["deviceId"], "dev_laptop");
        assert_eq!(sent[0].body["slug"], "fix-login");

        // What was written is what the next call is resolved against.
        let saved = ConfigStore::load_from(config.path().to_path_buf()).expect("config");
        let stored = saved
            .data()
            .workspaces
            .iter()
            .find(|workspace| workspace.id == entry.id)
            .expect("stored workspace");
        assert_eq!(stored.slug, "fix-login-laptop");
        assert_eq!(stored.name, "fix/login (laptop)");
    }

    #[tokio::test]
    async fn keeps_a_workspace_pending_when_the_gateway_refuses_it() {
        let temp = tempdir().expect("temp directory");
        let (mut config, entry) = pending_workspace(temp.path());
        let gateway = Gateway::start(|_, _, _| (409, json!({ "error": "slug_conflict" }))).await;
        let api = gateway.api().await;

        let outcome = persist(&mut config, &api, entry).await.expect("outcome");
        assert_eq!(outcome.outcome, "pendingUpsert");
        assert!(
            outcome
                .problem
                .as_deref()
                .is_some_and(|problem| problem.contains("--slug"))
        );
        assert_eq!(outcome.entry.slug, "fix-login");
        assert_eq!(outcome.entry.sync_state, WorkspaceSyncState::PendingUpsert);
    }

    #[test]
    fn refuses_a_stored_slug_that_could_not_be_routed() {
        let mut entry = crate::config::WorkspaceEntry {
            id: "wsp_1".to_owned(),
            project_id: "prj_1".to_owned(),
            slug: "fix-login".to_owned(),
            name: "fix/login".to_owned(),
            branch: None,
            git_root: "/code/fix-login".into(),
            root: "/code/fix-login".into(),
            managed: true,
            sync_state: WorkspaceSyncState::PendingUpsert,
        };
        let stored = |slug: &str, name: &str| crate::api::WorkspaceView {
            id: "wsp_1".to_owned(),
            project_id: "prj_1".to_owned(),
            slug: slug.to_owned(),
            name: name.to_owned(),
            branch: None,
            local_path: "/code/fix-login".to_owned(),
            managed: true,
            device_id: None,
            machine: None,
            cloud: false,
            created_at: 0,
            updated_at: 0,
        };
        for slug in ["main", "", "Fix Login", "../x"] {
            adopt_registration(&mut entry, &stored(slug, ""));
            assert_eq!(entry.slug, "fix-login", "{slug:?}");
            assert_eq!(entry.name, "fix/login");
        }
        adopt_registration(&mut entry, &stored("fix-login-desktop", "Fix login"));
        assert_eq!(entry.slug, "fix-login-desktop");
        assert_eq!(entry.name, "Fix login");
    }

    fn git(cwd: &std::path::Path, args: &[&str]) {
        let status = Command::new("git")
            .arg("-C")
            .arg(cwd)
            .args(args)
            .status()
            .expect("git");
        assert!(status.success(), "git {}", args.join(" "));
    }
}
