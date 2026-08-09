use crate::error::{ErrorCode, ExeoraError};
use std::{
    fs,
    path::{Component, Path, PathBuf},
};

pub fn resolve_in_project(root: &Path, relative: &str) -> Result<(PathBuf, PathBuf), ExeoraError> {
    if relative.as_bytes().contains(&0) {
        return Err(ExeoraError::new(
            ErrorCode::PathEscape,
            "Path contains an invalid character.",
        ));
    }
    let input = Path::new(relative);
    if input.is_absolute() {
        return Err(ExeoraError::new(
            ErrorCode::PathEscape,
            "Path must be relative to the project root.",
        ));
    }
    let mut normalized = PathBuf::new();
    for component in input.components() {
        match component {
            Component::Normal(part) => normalized.push(part),
            Component::CurDir => {}
            Component::ParentDir if normalized.pop() => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(ExeoraError::new(
                    ErrorCode::PathEscape,
                    "Path resolves outside the project root.",
                ));
            }
        }
    }
    let real_root = fs::canonicalize(root)
        .map_err(|_| ExeoraError::new(ErrorCode::PathNotFound, "Project root was not found."))?;
    let target = real_root.join(&normalized);
    let mut ancestor = target.as_path();
    let real_ancestor = loop {
        match fs::canonicalize(ancestor) {
            Ok(path) => break path,
            Err(_) => ancestor = ancestor.parent().unwrap_or(&real_root),
        }
    };
    if !real_ancestor.starts_with(&real_root) {
        return Err(ExeoraError::new(
            ErrorCode::PathEscape,
            "Path resolves outside the project root.",
        ));
    }
    Ok((real_root, normalized))
}

pub fn relative_string(path: &Path) -> String {
    path.components()
        .map(|part| part.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}
