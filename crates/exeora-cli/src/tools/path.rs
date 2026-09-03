use crate::error::{ErrorCode, ExeoraError};
use std::{
    env, fs,
    path::{Component, Path, PathBuf},
};

/// How a path is allowed to resolve.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Access {
    /// `read_file`, `list_files`, `grep`: project, plus `~/.agents/AGENTS.md` and `~/.agents/skills/`.
    Read,
    /// `edit_file`, `write_file`, `apply_patch`: project only.
    Write,
    /// `run_command` / `start_command` working directory: same extra roots as read.
    Cwd,
}

/// A path confined to the project or to an extra root.
#[derive(Debug)]
pub struct ResolvedPath {
    /// Directory to open / walk / `chdir` from.
    pub root: PathBuf,
    /// Path relative to `root`. Empty means `root` itself.
    pub relative: PathBuf,
    extra_display: Option<&'static str>,
    /// The extra root is one file; `display` is `extra_display`, not `relative`.
    extra_is_file: bool,
}

pub const GLOBAL_AGENTS_MD: &str = "~/.agents/AGENTS.md";
pub const GLOBAL_SKILLS_PREFIX: &str = "~/.agents/skills";

impl ResolvedPath {
    /// Path to return to the model, so a follow-up call can send it back.
    pub fn display(&self) -> String {
        self.display_under(&self.relative)
    }

    /// Display form of a walk entry whose relative path is from `self.root`.
    pub fn display_under(&self, relative: &Path) -> String {
        match self.extra_display {
            None => {
                if relative.as_os_str().is_empty() {
                    ".".to_owned()
                } else {
                    relative_string(relative)
                }
            }
            Some(prefix) if self.extra_is_file => prefix.to_owned(),
            Some(prefix) => {
                if relative.as_os_str().is_empty() {
                    prefix.to_owned()
                } else {
                    format!("{prefix}/{}", relative_string(relative))
                }
            }
        }
    }

    pub fn absolute(&self) -> PathBuf {
        if self.relative.as_os_str().is_empty() {
            self.root.clone()
        } else {
            self.root.join(&self.relative)
        }
    }
}

pub fn resolve_in_project(root: &Path, relative: &str) -> Result<(PathBuf, PathBuf), ExeoraError> {
    let resolved = resolve_path(root, relative, Access::Write)?;
    Ok((resolved.root, resolved.relative))
}

pub fn resolve_path(root: &Path, path: &str, access: Access) -> Result<ResolvedPath, ExeoraError> {
    if path.as_bytes().contains(&0) {
        return Err(ExeoraError::new(
            ErrorCode::PathEscape,
            "Path contains an invalid character.",
        ));
    }

    if let Some(expanded) = expand_user(path) {
        return resolve_extra(&expanded, access);
    }

    let input = Path::new(path);
    if input.is_absolute() {
        return resolve_extra(input, access);
    }

    resolve_project(root, path)
}

pub fn user_home() -> Option<PathBuf> {
    env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" }).map(PathBuf::from)
}

pub fn global_skills_dir() -> Option<PathBuf> {
    Some(user_home()?.join(".agents").join("skills"))
}

fn expand_user(path: &str) -> Option<PathBuf> {
    let rest = path.strip_prefix("~/").or_else(|| {
        if cfg!(windows) {
            path.strip_prefix("~\\")
        } else {
            None
        }
    })?;
    Some(user_home()?.join(rest))
}

fn resolve_project(root: &Path, relative: &str) -> Result<ResolvedPath, ExeoraError> {
    let input = Path::new(relative);
    let mut normalized = PathBuf::new();
    for component in input.components() {
        match component {
            Component::Normal(part) => normalized.push(part),
            Component::CurDir => {}
            Component::ParentDir if normalized.pop() => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(escape_outside());
            }
        }
    }
    let real_root = fs::canonicalize(root)
        .map_err(|_| ExeoraError::new(ErrorCode::PathNotFound, "Project root was not found."))?;
    let target = real_root.join(&normalized);
    let real_ancestor = existing_canonical_prefix(&target);
    if !real_ancestor.starts_with(&real_root) {
        return Err(escape_outside());
    }
    Ok(ResolvedPath {
        root: real_root,
        relative: normalized,
        extra_display: None,
        extra_is_file: false,
    })
}

fn resolve_extra(absolute: &Path, access: Access) -> Result<ResolvedPath, ExeoraError> {
    if matches!(access, Access::Write) {
        return Err(ExeoraError::new(
            ErrorCode::PathEscape,
            "Path must be relative to the project root.",
        ));
    }

    let Some(home) = user_home() else {
        return Err(escape_outside());
    };

    let agents_dir = home.join(".agents");
    let agents_md = agents_dir.join("AGENTS.md");
    let skills = agents_dir.join("skills");

    let target = normalize_path(&existing_canonical_prefix(absolute))?;
    let agents_md_real = normalize_path(&existing_canonical_prefix(&agents_md))?;
    let skills_real = normalize_path(&existing_canonical_prefix(&skills))?;

    if paths_equal(&target, &agents_md_real) {
        if matches!(access, Access::Cwd) {
            return Err(escape_outside());
        }
        let (root, relative) = match fs::canonicalize(&agents_md) {
            Ok(real) => {
                if !real.is_file() {
                    return Err(escape_outside());
                }
                let name = real.file_name().ok_or_else(escape_outside)?;
                let parent = real.parent().ok_or_else(escape_outside)?;
                (parent.to_path_buf(), PathBuf::from(name))
            }
            Err(_) => {
                let parent = agents_md_real.parent().ok_or_else(escape_outside)?;
                (parent.to_path_buf(), PathBuf::from("AGENTS.md"))
            }
        };
        return Ok(ResolvedPath {
            root,
            relative,
            extra_display: Some(GLOBAL_AGENTS_MD),
            extra_is_file: true,
        });
    }

    if let Some(relative) = strip_prefix_path(&target, &skills_real) {
        let relative = normalize_path(&relative)?;
        let joined = if relative.as_os_str().is_empty() {
            skills_real.clone()
        } else {
            skills_real.join(&relative)
        };
        if let Ok(real) = fs::canonicalize(&joined)
            && !real.starts_with(&skills_real)
            && real != skills_real
        {
            return Err(escape_outside());
        }
        return Ok(ResolvedPath {
            root: skills_real,
            relative,
            extra_display: Some(GLOBAL_SKILLS_PREFIX),
            extra_is_file: false,
        });
    }

    Err(escape_outside())
}

fn existing_canonical_prefix(path: &Path) -> PathBuf {
    let mut ancestor = path;
    loop {
        if let Ok(real) = fs::canonicalize(ancestor) {
            let rest = path.strip_prefix(ancestor).unwrap_or(Path::new(""));
            return if rest.as_os_str().is_empty() {
                real
            } else {
                real.join(rest)
            };
        }
        match ancestor.parent() {
            Some(parent) if parent != ancestor => ancestor = parent,
            _ => return path.to_path_buf(),
        }
    }
}

fn normalize_path(path: &Path) -> Result<PathBuf, ExeoraError> {
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Prefix(prefix) => normalized.push(prefix.as_os_str()),
            Component::RootDir => normalized.push(component.as_os_str()),
            Component::Normal(part) => normalized.push(part),
            Component::CurDir => {}
            Component::ParentDir => {
                if !normalized.pop() {
                    return Err(escape_outside());
                }
            }
        }
    }
    Ok(normalized)
}

fn strip_prefix_path(path: &Path, prefix: &Path) -> Option<PathBuf> {
    if path == prefix {
        return Some(PathBuf::new());
    }
    path.strip_prefix(prefix).ok().map(Path::to_path_buf)
}

fn paths_equal(left: &Path, right: &Path) -> bool {
    if left == right {
        return true;
    }
    match (fs::canonicalize(left), fs::canonicalize(right)) {
        (Ok(a), Ok(b)) => a == b,
        _ => false,
    }
}

fn escape_outside() -> ExeoraError {
    ExeoraError::new(
        ErrorCode::PathEscape,
        "Path resolves outside the project root.",
    )
}

pub fn relative_string(path: &Path) -> String {
    path.components()
        .map(|part| part.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_project() -> tempfile::TempDir {
        tempfile::TempDir::new().unwrap()
    }

    #[test]
    fn project_relative_paths_stay_inside() {
        let dir = temp_project();
        fs::create_dir_all(dir.path().join("src")).unwrap();
        let resolved = resolve_path(dir.path(), "src/main.rs", Access::Read).unwrap();
        assert_eq!(resolved.display(), "src/main.rs");
        assert_eq!(resolved.relative, PathBuf::from("src/main.rs"));
    }

    #[test]
    fn write_rejects_absolute_paths() {
        let dir = temp_project();
        let error = resolve_path(dir.path(), "/tmp/secret", Access::Write).unwrap_err();
        assert_eq!(error.code, ErrorCode::PathEscape);
    }

    #[test]
    fn parent_dir_cannot_leave_the_project() {
        let dir = temp_project();
        let error = resolve_path(dir.path(), "../secret", Access::Read).unwrap_err();
        assert_eq!(error.code, ErrorCode::PathEscape);
    }
}
