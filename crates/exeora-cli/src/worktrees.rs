use crate::config::{ConfigStore, ProjectEntry, WorktreeEntry, WorktreeSyncState};
use anyhow::{Context, Result, anyhow, bail};
use std::{
    env, fs,
    path::{Path, PathBuf},
    process::Command,
};
use uuid::Uuid;

pub struct CreateWorktree {
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
    let worktree = config
        .data()
        .worktrees
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
    worktree.ok_or_else(|| {
        anyhow!("The current directory is not inside an Exeora project. Pass --project <slug|id>.")
    })
}

pub fn create(
    config: &ConfigStore,
    project: &ProjectEntry,
    input: CreateWorktree,
) -> Result<WorktreeEntry> {
    let branch_slug = slugify(&input.branch);
    let slug = input.slug.unwrap_or(branch_slug);
    validate_slug(&slug)?;
    ensure_unique(config, project, &slug, None)?;

    let destination = input
        .path
        .unwrap_or(config.worktree_root()?.join(&project.slug).join(&slug));
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
) -> Result<WorktreeEntry> {
    let path = fs::canonicalize(path)
        .with_context(|| format!("Could not open worktree {}", path.display()))?;
    let branch =
        git_optional(&path, &["branch", "--show-current"])?.filter(|value| !value.is_empty());
    let fallback = branch
        .as_deref()
        .and_then(|value| value.rsplit('/').next())
        .unwrap_or_else(|| {
            path.file_name()
                .and_then(|value| value.to_str())
                .unwrap_or("worktree")
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

fn entry_for_path(
    config: &ConfigStore,
    project: &ProjectEntry,
    path: &Path,
    name: String,
    slug: String,
    managed: bool,
) -> Result<WorktreeEntry> {
    let main_git_root = git_path(&project.root, &["rev-parse", "--show-toplevel"])?;
    let worktree_git_root = git_path(path, &["rev-parse", "--show-toplevel"])?;
    let main_git_root = fs::canonicalize(main_git_root)?;
    let worktree_git_root = fs::canonicalize(worktree_git_root)?;
    if main_git_root == worktree_git_root {
        bail!("The primary project worktree is selected by `main` and cannot be attached again.");
    }
    if config
        .data()
        .worktrees
        .iter()
        .any(|entry| fs::canonicalize(&entry.git_root).ok().as_ref() == Some(&worktree_git_root))
    {
        bail!("That Git worktree is already connected to Exeora.");
    }
    let main_common = git_path(&project.root, &["rev-parse", "--git-common-dir"])?;
    let worktree_common = git_path(path, &["rev-parse", "--git-common-dir"])?;
    if fs::canonicalize(main_common)? != fs::canonicalize(worktree_common)? {
        bail!(
            "{} is not a worktree of the repository serving {}.",
            path.display(),
            project.slug
        );
    }
    let relative_root = fs::canonicalize(&project.root)?
        .strip_prefix(&main_git_root)
        .context("The registered project root is outside its Git worktree")?
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
    Ok(WorktreeEntry {
        id: format!("wtr_{}", Uuid::new_v4().simple()),
        project_id: project.id.clone(),
        slug,
        name,
        branch,
        git_root: worktree_git_root,
        root: fs::canonicalize(root)?,
        managed,
        sync_state: WorktreeSyncState::PendingUpsert,
    })
}

pub fn ensure_unique(
    config: &ConfigStore,
    project: &ProjectEntry,
    slug: &str,
    except_id: Option<&str>,
) -> Result<()> {
    if slug.eq_ignore_ascii_case("main") {
        bail!("`main` is reserved for the project's primary worktree.");
    }
    if config.data().worktrees.iter().any(|entry| {
        entry.project_id == project.id
            && entry.slug.eq_ignore_ascii_case(slug)
            && except_id != Some(entry.id.as_str())
    }) {
        bail!("Worktree {slug} is already connected to {}.", project.slug);
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
                .worktrees
                .iter()
                .map(|entry| ("worktree", &entry.git_root)),
        )
    {
        if let Ok(root) = fs::canonicalize(root)
            && destination.starts_with(&root)
        {
            bail!(
                "Refusing to create a worktree inside the existing {kind} at {}.",
                root.display()
            );
        }
    }
    Ok(())
}

pub fn is_dirty(entry: &WorktreeEntry) -> Result<bool> {
    Ok(!git_output(&entry.git_root, &["status", "--porcelain"])?.is_empty())
}

pub fn remove_git_worktree(
    project: &ProjectEntry,
    entry: &WorktreeEntry,
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
        bail!("Worktree slugs use lowercase letters, digits and hyphens (max 60 characters).");
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
        "worktree".to_owned()
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
        .context("Worktree destination has no parent")?;
    fs::create_dir_all(parent)?;
    Ok(fs::canonicalize(parent)?.join(
        path.file_name()
            .context("Worktree destination has no name")?,
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
    use super::{CreateWorktree, create, is_dirty, remove_git_worktree, slugify};
    use crate::config::{ConfigStore, ProjectEntry, WorktreeSyncState};
    use std::{fs, process::Command};
    use tempfile::tempdir;

    #[test]
    fn creates_safe_slugs_from_branch_names() {
        assert_eq!(slugify("feature/Worktrees!"), "feature-worktrees");
    }

    #[test]
    fn creates_and_tracks_a_native_git_worktree() {
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
        };
        config.upsert_project(project.clone());
        let destination = temp.path().join("feature-worktree");

        let entry = create(
            &config,
            &project,
            CreateWorktree {
                branch: "feature/worktrees".to_owned(),
                from: None,
                reuse_existing_branch: false,
                name: None,
                slug: None,
                path: Some(destination),
                source: None,
            },
        )
        .expect("worktree");

        assert_eq!(entry.slug, "feature-worktrees");
        assert_eq!(entry.branch.as_deref(), Some("feature/worktrees"));
        assert_eq!(entry.sync_state, WorktreeSyncState::PendingUpsert);
        assert!(entry.root.join("tracked.txt").is_file());
        assert!(!is_dirty(&entry).expect("status"));

        remove_git_worktree(&project, &entry, false).expect("remove");
        assert!(!entry.git_root.exists());
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
