//! The Explorer's side of a checkout: one level of the tree, a file's content
//! with a token for the version it was, and the edits an editor makes. Every
//! path goes through the project's own confinement, and the version control
//! directories are refused outright.

use super::git::{GitWorkspace, invalid, required_string};
use crate::{
    error::{ErrorCode, ExeoraError},
    tools::path::{relative_string, resolve_in_project},
};
use atomic_write_file::AtomicWriteFile;
use base64::Engine as _;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::HashSet,
    ffi::OsStr,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};
use tokio_util::sync::CancellationToken;

const ACTIONS: &[&str] = &[
    "tree",
    "file_read",
    "file_write",
    "file_create",
    "file_rename",
    "file_move",
    "file_delete",
    "file_duplicate",
];
const PROTECTED: &[&str] = &[".git", ".hg", ".svn"];
pub(super) const MAX_TREE_ENTRIES: usize = 2_000;
/// The whole result must fit the protocol's limit once it is JSON, escapes
/// and all; these leave the room for that.
const MAX_TEXT_BYTES: usize = 900_000;
const MAX_BASE64_BYTES: usize = 700_000;
const JSON_TEXT_BUDGET: usize = 950_000;
const MAX_WRITE_BYTES: usize = 1_000_000;
const BINARY_PROBE: usize = 8_192;

/// A path of the project, resolved: the canonical root, where the path is
/// on disk, and how the dashboard names it.
pub(super) struct Located {
    pub(super) root: PathBuf,
    pub(super) absolute: PathBuf,
    pub(super) relative: String,
}

pub(super) fn is_protected(name: &OsStr) -> bool {
    name.to_str().is_some_and(|name| PROTECTED.contains(&name))
}

pub(super) fn project_path(root: &Path, path: &str) -> Result<Located, ExeoraError> {
    let (real_root, relative) = resolve_in_project(root, path)?;
    if relative
        .components()
        .any(|component| is_protected(component.as_os_str()))
    {
        return Err(ExeoraError::new(
            ErrorCode::Forbidden,
            "Paths inside '.git', '.hg' and '.svn' are not available to the Explorer.",
        ));
    }
    let absolute = if relative.as_os_str().is_empty() {
        real_root.clone()
    } else {
        real_root.join(&relative)
    };
    Ok(Located {
        root: real_root,
        absolute,
        relative: relative_string(&relative),
    })
}

pub(super) fn handles(name: &str) -> bool {
    ACTIONS.contains(&name)
}

pub(super) async fn execute(
    git: &GitWorkspace,
    root: &Path,
    action: Value,
    cancel: CancellationToken,
) -> Result<Value, ExeoraError> {
    let name = action
        .get("action")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    match name.as_str() {
        "tree" => tree(git, root, &action, &cancel).await,
        "file_read" => blocking(root, action, read).await,
        _ => {
            let _guard = git.operation.lock().await;
            let (stdout, stderr) = match name.as_str() {
                "file_write" => return blocking(root, action, write).await,
                "file_create" => blocking(root, action, create).await?,
                "file_rename" => rename(git, root, &action, &cancel).await?,
                "file_move" => move_into(git, root, &action, &cancel).await?,
                "file_delete" => blocking(root, action, delete).await?,
                "file_duplicate" => blocking(root, action, duplicate).await?,
                _ => return Err(invalid("Unsupported workspace action.")),
            };
            git.mutation_result(root, stdout, stderr, &cancel).await
        }
    }
}

async fn blocking<T: Send + 'static>(
    root: &Path,
    action: Value,
    work: fn(&Path, &Value) -> Result<T, ExeoraError>,
) -> Result<T, ExeoraError> {
    let root = root.to_owned();
    tokio::task::spawn_blocking(move || work(&root, &action))
        .await
        .map_err(|error| ExeoraError::tool(format!("File operation failed: {error}")))?
}

struct Entry {
    name: String,
    kind: &'static str,
    size: Option<u64>,
}

/// One directory: folders first, then files, each without regard to case.
/// What `.gitignore` covers is marked, and left out unless asked for.
async fn tree(
    git: &GitWorkspace,
    root: &Path,
    action: &Value,
    cancel: &CancellationToken,
) -> Result<Value, ExeoraError> {
    let path = action.get("path").and_then(Value::as_str).unwrap_or(".");
    let show_ignored = action
        .get("showIgnored")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let located = project_path(root, path)?;
    let absolute = located.absolute.clone();
    let (entries, truncated) = tokio::task::spawn_blocking(move || list_directory(&absolute))
        .await
        .map_err(|error| ExeoraError::tool(format!("Could not list the directory: {error}")))??;
    let paths = entries
        .iter()
        .map(|entry| join(&located.relative, &entry.name))
        .collect::<Vec<_>>();
    let ignored = ignored_paths(git, root, &paths, cancel).await?;
    let entries = entries
        .iter()
        .zip(paths)
        .filter(|(_, path)| show_ignored || !ignored.contains(path))
        .map(|(entry, path)| {
            let mut value = json!({
                "name": entry.name,
                "path": path,
                "type": entry.kind,
                "ignored": ignored.contains(&path),
            });
            if let Some(size) = entry.size {
                value["size"] = json!(size);
            }
            value
        })
        .collect::<Vec<_>>();
    Ok(json!({
        "kind": "tree",
        "path": if located.relative.is_empty() { ".".to_owned() } else { located.relative },
        "entries": entries,
        "truncated": truncated,
    }))
}

fn list_directory(absolute: &Path) -> Result<(Vec<Entry>, bool), ExeoraError> {
    let listed = fs::read_dir(absolute).map_err(|error| {
        ExeoraError::new(
            ErrorCode::PathNotFound,
            format!("Could not list the directory: {error}"),
        )
    })?;
    let mut entries = Vec::new();
    for entry in listed {
        let Ok(entry) = entry else { continue };
        if is_protected(&entry.file_name()) {
            continue;
        }
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        let (kind, size) = if file_type.is_symlink() {
            ("symlink", None)
        } else if file_type.is_dir() {
            ("directory", None)
        } else {
            ("file", entry.metadata().ok().map(|metadata| metadata.len()))
        };
        entries.push(Entry {
            name: entry.file_name().to_string_lossy().into_owned(),
            kind,
            size,
        });
    }
    entries.sort_by(|a, b| {
        (a.kind != "directory")
            .cmp(&(b.kind != "directory"))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
            .then_with(|| a.name.cmp(&b.name))
    });
    let truncated = entries.len() > MAX_TREE_ENTRIES;
    entries.truncate(MAX_TREE_ENTRIES);
    Ok((entries, truncated))
}

/// Which of the paths `.gitignore` covers. None outside a repository.
async fn ignored_paths(
    git: &GitWorkspace,
    root: &Path,
    paths: &[String],
    cancel: &CancellationToken,
) -> Result<HashSet<String>, ExeoraError> {
    if paths.is_empty() {
        return Ok(HashSet::new());
    }
    let input = paths.join("\0");
    let output = git
        .run(
            root,
            &["check-ignore", "-z", "--stdin"],
            Some(input.as_bytes()),
            cancel,
        )
        .await?;
    // 1 is "none of them"; anything else that is not success is not a repository.
    if !output.success {
        return Ok(HashSet::new());
    }
    Ok(output
        .stdout
        .split(|byte| *byte == 0)
        .filter(|path| !path.is_empty())
        .map(|path| String::from_utf8_lossy(path).into_owned())
        .collect())
}

fn join(directory: &str, name: &str) -> String {
    if directory.is_empty() {
        name.to_owned()
    } else {
        format!("{directory}/{name}")
    }
}

fn read(root: &Path, action: &Value) -> Result<Value, ExeoraError> {
    let path = required_string(action, "path")?;
    let encoding = action
        .get("encoding")
        .and_then(Value::as_str)
        .unwrap_or("text");
    let limit = match encoding {
        "text" => MAX_TEXT_BYTES,
        "base64" => MAX_BASE64_BYTES,
        _ => return Err(invalid("Encoding must be text or base64.")),
    };
    let located = project_path(root, path)?;
    let mut file = fs::File::open(&located.absolute).map_err(|error| not_found(path, error))?;
    if file.metadata().is_ok_and(|metadata| metadata.is_dir()) {
        return Err(invalid(format!("'{path}' is a directory.")));
    }
    // One pass hashes the whole file and keeps only the head that is sent.
    let mut hasher = Sha256::new();
    let mut head = Vec::new();
    let mut total = 0usize;
    let mut buffer = vec![0u8; 64 * 1024];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|error| ExeoraError::tool(format!("Could not read '{path}': {error}")))?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
        total += count;
        let room = (limit + 1).saturating_sub(head.len());
        head.extend_from_slice(&buffer[..count.min(room)]);
    }
    let binary = head[..head.len().min(BINARY_PROBE)].contains(&0);
    let over = total > limit;
    let (content, truncated) = match encoding {
        "text" if binary => (String::new(), false),
        "text" => fit_text(&head[..head.len().min(limit)], over),
        _ if over => (String::new(), true),
        _ => (
            base64::engine::general_purpose::STANDARD.encode(&head),
            false,
        ),
    };
    Ok(json!({
        "kind": "file",
        "path": located.relative,
        "content": content,
        "encoding": encoding,
        "token": hex(hasher.finalize().as_slice()),
        "size": total,
        "truncated": truncated,
        "binary": binary,
        "mime": mime_of(&located.relative),
    }))
}

/// Text that fits the result once JSON has escaped it. A cut lands on a
/// character boundary, never inside one.
fn fit_text(bytes: &[u8], mut truncated: bool) -> (String, bool) {
    let valid = match std::str::from_utf8(bytes) {
        Ok(_) => bytes.len(),
        Err(error) if error.error_len().is_none() => error.valid_up_to(),
        Err(_) => bytes.len(),
    };
    let mut text = String::from_utf8_lossy(&bytes[..valid]).into_owned();
    loop {
        let escaped = serde_json::to_string(&text).map_or(0, |json| json.len());
        if escaped <= JSON_TEXT_BUDGET {
            return (text, truncated);
        }
        let mut keep = text.len() * JSON_TEXT_BUDGET / escaped;
        while keep > 0 && !text.is_char_boundary(keep) {
            keep -= 1;
        }
        text.truncate(keep);
        truncated = true;
    }
}

fn mime_of(path: &str) -> Option<&'static str> {
    let extension = Path::new(path).extension()?.to_str()?.to_ascii_lowercase();
    Some(match extension.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "ico" => "image/x-icon",
        "avif" => "image/avif",
        "svg" => "image/svg+xml",
        "pdf" => "application/pdf",
        _ => return None,
    })
}

/// A save. When the editor says which version it read, a file that is no
/// longer that version is answered with a conflict and left as it is.
fn write(root: &Path, action: &Value) -> Result<Value, ExeoraError> {
    let path = required_string(action, "path")?;
    let content = action
        .get("content")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("'content' is required."))?;
    if content.len() > MAX_WRITE_BYTES {
        return Err(invalid(
            "The content is larger than a file the Explorer writes.",
        ));
    }
    let expected = action.get("expectedToken").and_then(Value::as_str);
    let create = action
        .get("create")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let located = project_path(root, path)?;
    match fs::symlink_metadata(&located.absolute) {
        Ok(metadata) if metadata.is_dir() => {
            return Err(invalid(format!("'{path}' is a directory.")));
        }
        Ok(_) => {
            if let Some(expected) = expected {
                let current = hash_file(&located.absolute, path)?;
                if current != expected {
                    return Ok(json!({
                        "kind": "file_write", "path": located.relative,
                        "status": "conflict", "token": current,
                    }));
                }
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            if !create {
                return Err(ExeoraError::new(
                    ErrorCode::PathNotFound,
                    format!("'{path}' no longer exists."),
                ));
            }
        }
        Err(error) => {
            return Err(ExeoraError::tool(format!(
                "Could not save '{path}': {error}"
            )));
        }
    }
    write_atomically(&located.absolute, content.as_bytes(), path)?;
    Ok(json!({
        "kind": "file_write", "path": located.relative,
        "status": "written", "token": hex(&Sha256::digest(content.as_bytes())),
    }))
}

pub(super) fn write_atomically(
    absolute: &Path,
    bytes: &[u8],
    path: &str,
) -> Result<(), ExeoraError> {
    let failed =
        |error: std::io::Error| ExeoraError::tool(format!("Could not save '{path}': {error}"));
    if let Some(parent) = absolute.parent() {
        fs::create_dir_all(parent).map_err(failed)?;
    }
    let mut file = AtomicWriteFile::options().open(absolute).map_err(failed)?;
    file.write_all(bytes).map_err(failed)?;
    file.commit().map_err(failed)
}

pub(super) fn hash_file(absolute: &Path, path: &str) -> Result<String, ExeoraError> {
    let bytes = fs::read(absolute).map_err(|error| not_found(path, error))?;
    Ok(hex(&Sha256::digest(&bytes)))
}

pub(super) fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn not_found(path: &str, error: std::io::Error) -> ExeoraError {
    if error.kind() == std::io::ErrorKind::NotFound {
        ExeoraError::new(ErrorCode::PathNotFound, format!("'{path}' does not exist."))
    } else {
        ExeoraError::tool(format!("Could not read '{path}': {error}"))
    }
}

fn create(root: &Path, action: &Value) -> Result<(String, String), ExeoraError> {
    let path = required_string(action, "path")?;
    let kind = required_string(action, "type")?;
    let located = project_path(root, path)?;
    if located.relative.is_empty() {
        return Err(invalid("The project root already exists."));
    }
    if fs::symlink_metadata(&located.absolute).is_ok() {
        return Err(invalid(format!("'{path}' already exists.")));
    }
    let failed =
        |error: std::io::Error| ExeoraError::tool(format!("Could not create '{path}': {error}"));
    match kind {
        "directory" => fs::create_dir_all(&located.absolute).map_err(failed)?,
        "file" => {
            if let Some(parent) = located.absolute.parent() {
                fs::create_dir_all(parent).map_err(failed)?;
            }
            fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&located.absolute)
                .map_err(failed)?;
        }
        _ => return Err(invalid("Type must be file or directory.")),
    }
    Ok((String::new(), String::new()))
}

async fn rename(
    git: &GitWorkspace,
    root: &Path,
    action: &Value,
    cancel: &CancellationToken,
) -> Result<(String, String), ExeoraError> {
    let from = required_string(action, "from")?;
    let to = required_string(action, "to")?;
    let overwrite = action
        .get("overwrite")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let source = project_path(root, from)?;
    let target = project_path(root, to)?;
    if source.relative.is_empty() || target.relative.is_empty() {
        return Err(invalid("The project root cannot be renamed."));
    }
    move_path(git, root, &source, &target, overwrite, cancel).await
}

/// Each path into the directory `to`, keeping its name.
async fn move_into(
    git: &GitWorkspace,
    root: &Path,
    action: &Value,
    cancel: &CancellationToken,
) -> Result<(String, String), ExeoraError> {
    let to = required_string(action, "to")?;
    let overwrite = action
        .get("overwrite")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let directory = project_path(root, to)?;
    if !directory.absolute.is_dir() {
        return Err(invalid(format!("'{to}' is not a directory.")));
    }
    let mut stdout = String::new();
    let mut stderr = String::new();
    for path in listed_paths(action)? {
        let source = project_path(root, &path)?;
        let name = Path::new(&source.relative)
            .file_name()
            .ok_or_else(|| invalid("The project root cannot be moved."))?
            .to_string_lossy()
            .into_owned();
        let target = project_path(root, &join(&directory.relative, &name))?;
        if target.relative == source.relative {
            continue;
        }
        let (out, err) = move_path(git, root, &source, &target, overwrite, cancel).await?;
        stdout.push_str(&out);
        stderr.push_str(&err);
    }
    Ok((stdout, stderr))
}

/// `git mv` for what git tracks, so the index follows; a plain rename for
/// the rest. Never over something that is there unless told to, and never
/// over a directory.
async fn move_path(
    git: &GitWorkspace,
    root: &Path,
    source: &Located,
    target: &Located,
    overwrite: bool,
    cancel: &CancellationToken,
) -> Result<(String, String), ExeoraError> {
    let from = source.relative.as_str();
    let to = target.relative.as_str();
    if fs::symlink_metadata(&source.absolute).is_err() {
        return Err(ExeoraError::new(
            ErrorCode::PathNotFound,
            format!("'{from}' does not exist."),
        ));
    }
    if to.starts_with(&format!("{from}/")) {
        return Err(invalid(format!("'{from}' cannot be moved into itself.")));
    }
    match fs::symlink_metadata(&target.absolute) {
        Ok(metadata) if metadata.is_dir() => {
            return Err(invalid(format!("'{to}' is a directory.")));
        }
        Ok(_) if !overwrite => return Err(invalid(format!("'{to}' already exists."))),
        _ => {}
    }
    let failed =
        |error: std::io::Error| ExeoraError::tool(format!("Could not move '{from}': {error}"));
    if let Some(parent) = target.absolute.parent() {
        fs::create_dir_all(parent).map_err(failed)?;
    }
    let tracked = git
        .run(
            root,
            &["ls-files", "--error-unmatch", "--", from],
            None,
            cancel,
        )
        .await?
        .success;
    if tracked {
        let mut args = vec!["mv"];
        if overwrite {
            args.push("-f");
        }
        args.extend(["--", from, to]);
        let output = git.run(root, &args, None, cancel).await?;
        if !output.success {
            return Err(ExeoraError::tool(format!(
                "Could not move '{from}': {}",
                String::from_utf8_lossy(&output.stderr).trim()
            )));
        }
        return Ok((
            String::from_utf8_lossy(&output.stdout).into_owned(),
            String::from_utf8_lossy(&output.stderr).into_owned(),
        ));
    }
    if overwrite && fs::symlink_metadata(&target.absolute).is_ok() {
        fs::remove_file(&target.absolute).map_err(failed)?;
    }
    fs::rename(&source.absolute, &target.absolute).map_err(failed)?;
    Ok((String::new(), String::new()))
}

fn listed_paths(action: &Value) -> Result<Vec<String>, ExeoraError> {
    let values = action
        .get("paths")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid("At least one path is required."))?;
    if values.is_empty() || values.len() > 100 {
        return Err(invalid("Between 1 and 100 paths are required."));
    }
    values
        .iter()
        .map(|value| {
            value
                .as_str()
                .map(str::to_owned)
                .ok_or_else(|| invalid("Paths must be strings."))
        })
        .collect()
}

fn delete(root: &Path, action: &Value) -> Result<(String, String), ExeoraError> {
    for path in listed_paths(action)? {
        let located = project_path(root, &path)?;
        if located.relative.is_empty() {
            return Err(invalid("The project root cannot be deleted."));
        }
        let metadata =
            fs::symlink_metadata(&located.absolute).map_err(|error| not_found(&path, error))?;
        let removed = if metadata.is_dir() {
            fs::remove_dir_all(&located.absolute)
        } else {
            fs::remove_file(&located.absolute)
        };
        removed
            .map_err(|error| ExeoraError::tool(format!("Could not delete '{path}': {error}")))?;
    }
    Ok((String::new(), String::new()))
}

/// `name copy.ext`, then `name copy 2.ext` and on, beside the original.
fn duplicate(root: &Path, action: &Value) -> Result<(String, String), ExeoraError> {
    let path = required_string(action, "path")?;
    let located = project_path(root, path)?;
    if located.relative.is_empty() {
        return Err(invalid("The project root cannot be duplicated."));
    }
    let metadata =
        fs::symlink_metadata(&located.absolute).map_err(|error| not_found(path, error))?;
    let source = Path::new(&located.relative);
    let stem = source
        .file_stem()
        .map(|stem| stem.to_string_lossy().into_owned())
        .unwrap_or_default();
    let extension = source
        .extension()
        .map(|extension| format!(".{}", extension.to_string_lossy()));
    let parent = source.parent().unwrap_or(Path::new(""));
    let copy = (1..=1_000)
        .map(|attempt| {
            let suffix = if attempt == 1 {
                " copy".to_owned()
            } else {
                format!(" copy {attempt}")
            };
            parent.join(format!(
                "{stem}{suffix}{}",
                extension.as_deref().unwrap_or_default()
            ))
        })
        .find(|candidate| fs::symlink_metadata(located.root.join(candidate)).is_err())
        .ok_or_else(|| invalid(format!("'{path}' has too many copies already.")))?;
    let target = located.root.join(&copy);
    let failed =
        |error: std::io::Error| ExeoraError::tool(format!("Could not copy '{path}': {error}"));
    if metadata.is_dir() {
        copy_directory(&located.absolute, &target).map_err(failed)?;
    } else {
        fs::copy(&located.absolute, &target).map_err(failed)?;
    }
    Ok((String::new(), String::new()))
}

fn copy_directory(from: &Path, to: &Path) -> std::io::Result<()> {
    fs::create_dir_all(to)?;
    for entry in fs::read_dir(from)? {
        let entry = entry?;
        let target = to.join(entry.file_name());
        let file_type = entry.file_type()?;
        if file_type.is_dir() {
            copy_directory(&entry.path(), &target)?;
        } else if file_type.is_file() {
            fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}
