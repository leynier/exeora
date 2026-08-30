use super::{
    files::{join_error, open_root, parse, replace_exact},
    path::{relative_string, resolve_in_project},
};
use crate::{
    error::{ErrorCode, ExeoraError},
    protocol::{MAX_PATCH_BYTES, MAX_PATCH_OPS, MAX_RESULT_BYTES},
};
use cap_std::fs::{Dir, OpenOptions, Permissions};
use serde::Deserialize;
use serde_json::{Value, json};
use similar::TextDiff;
use std::{
    collections::{HashMap, HashSet},
    io::{Read, Write},
    path::{Path, PathBuf},
};

#[derive(Deserialize)]
struct PatchArgs {
    operations: Vec<PatchOp>,
}

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "camelCase")]
enum PatchOp {
    Create {
        path: String,
        content: String,
    },
    Update {
        path: String,
        #[serde(rename = "oldString")]
        old_string: String,
        #[serde(rename = "newString")]
        new_string: String,
    },
    Replace {
        path: String,
        content: String,
    },
    Delete {
        path: String,
    },
    Move {
        from: String,
        to: String,
    },
}

#[derive(Clone, Copy)]
enum Kind {
    Missing,
    File,
    Other,
}

enum ApplyAction {
    Write(String),
    Delete,
    Rename(PathBuf),
}

struct PlannedFile {
    path: PathBuf,
    op: &'static str,
    action: Option<ApplyAction>,
    diff: Option<String>,
    created: bool,
    deleted: bool,
    original: Option<Vec<u8>>,
    permissions: Option<Permissions>,
    written_bytes: usize,
}

pub async fn apply_patch(root: &Path, args: Value) -> Result<Value, ExeoraError> {
    let root = root.to_owned();
    tokio::task::spawn_blocking(move || apply_patch_sync(&root, args))
        .await
        .map_err(join_error)?
}

fn apply_patch_sync(root: &Path, args: Value) -> Result<Value, ExeoraError> {
    let args: PatchArgs = parse(args)?;
    if args.operations.is_empty() {
        return Err(ExeoraError::new(
            ErrorCode::InvalidArguments,
            "apply_patch needs at least one operation.",
        ));
    }
    if args.operations.len() > MAX_PATCH_OPS {
        return Err(ExeoraError::new(
            ErrorCode::InvalidArguments,
            format!("apply_patch accepts at most {MAX_PATCH_OPS} operations."),
        ));
    }
    let written_bytes: usize = args
        .operations
        .iter()
        .map(|op| match op {
            PatchOp::Create { content, .. } | PatchOp::Replace { content, .. } => content.len(),
            PatchOp::Update { new_string, .. } => new_string.len(),
            PatchOp::Delete { .. } | PatchOp::Move { .. } => 0,
        })
        .sum();
    if written_bytes > MAX_PATCH_BYTES {
        return Err(ExeoraError::new(
            ErrorCode::InvalidArguments,
            format!("apply_patch contents must stay within {MAX_PATCH_BYTES} bytes."),
        ));
    }

    let (real_root, _) = resolve_in_project(root, ".")?;
    let dir = open_root(&real_root)?;
    let planned = preflight(&dir, &real_root, &args.operations)?;
    let planned_bytes: usize = planned.iter().map(|file| file.written_bytes).sum();
    if planned_bytes > MAX_PATCH_BYTES {
        return Err(ExeoraError::new(
            ErrorCode::InvalidArguments,
            format!("apply_patch contents must stay within {MAX_PATCH_BYTES} bytes."),
        ));
    }
    let result = result_value(&planned);
    let encoded =
        serde_json::to_vec(&result).map_err(|error| ExeoraError::tool(error.to_string()))?;
    if encoded.len() > MAX_RESULT_BYTES {
        return Err(ExeoraError::new(
            ErrorCode::InvalidArguments,
            format!("apply_patch result would exceed the {MAX_RESULT_BYTES}-byte protocol limit."),
        ));
    }
    apply_all(&dir, &planned)?;
    Ok(result)
}

fn result_value(planned: &[PlannedFile]) -> Value {
    json!({
        "files": planned.iter().map(|file| {
            let mut value = json!({
                "path": relative_string(&file.path),
                "op": file.op,
            });
            if let Some(diff) = &file.diff {
                value["diff"] = json!(diff);
            }
            if file.created {
                value["created"] = json!(true);
            }
            if file.deleted {
                value["deleted"] = json!(true);
            }
            value
        }).collect::<Vec<_>>(),
    })
}

fn preflight(
    dir: &Dir,
    root: &Path,
    operations: &[PatchOp],
) -> Result<Vec<PlannedFile>, ExeoraError> {
    let mut state: HashMap<PathBuf, Kind> = HashMap::new();
    let mut claimed = HashSet::new();
    let mut inodes = HashSet::new();
    let mut planned = Vec::new();

    for operation in operations {
        match operation {
            PatchOp::Create { path, content } => {
                let relative = resolve_file(root, path)?;
                claim(dir, &mut claimed, &mut inodes, &relative)?;
                match kind(dir, &mut state, &relative)? {
                    Kind::Missing => {}
                    Kind::File => {
                        return Err(ExeoraError::new(
                            ErrorCode::InvalidArguments,
                            format!("{} already exists.", relative_string(&relative)),
                        ));
                    }
                    Kind::Other => return Err(not_a_file(&relative)),
                }
                let diff = unified_diff("", content, &relative);
                state.insert(relative.clone(), Kind::File);
                planned.push(PlannedFile {
                    path: relative,
                    op: "create",
                    action: Some(ApplyAction::Write(content.clone())),
                    diff: Some(diff),
                    created: true,
                    deleted: false,
                    original: None,
                    permissions: None,
                    written_bytes: content.len(),
                });
            }
            PatchOp::Update {
                path,
                old_string,
                new_string,
            } => {
                let relative = resolve_file(root, path)?;
                claim(dir, &mut claimed, &mut inodes, &relative)?;
                let raw = read_text(dir, &mut state, &relative)?;
                let replaced = replace_exact(&raw, old_string, new_string, &relative)?;
                let written_bytes = replaced.written.len();
                state.insert(relative.clone(), Kind::File);
                planned.push(PlannedFile {
                    path: relative,
                    op: "update",
                    action: Some(ApplyAction::Write(replaced.written)),
                    diff: Some(replaced.diff),
                    created: false,
                    deleted: false,
                    original: Some(raw.into_bytes()),
                    permissions: None,
                    written_bytes,
                });
            }
            PatchOp::Replace { path, content } => {
                let relative = resolve_file(root, path)?;
                claim(dir, &mut claimed, &mut inodes, &relative)?;
                let original = match kind(dir, &mut state, &relative)? {
                    Kind::File => Some(read_bytes(dir, &relative)?),
                    Kind::Missing => None,
                    Kind::Other => return Err(not_a_file(&relative)),
                };
                let existed = original.is_some();
                let previous = original
                    .as_ref()
                    .map(|bytes| String::from_utf8_lossy(bytes).into_owned())
                    .unwrap_or_default();
                let diff = unified_diff(&previous, content, &relative);
                state.insert(relative.clone(), Kind::File);
                planned.push(PlannedFile {
                    path: relative,
                    op: "replace",
                    action: Some(ApplyAction::Write(content.clone())),
                    diff: Some(diff),
                    created: !existed,
                    deleted: false,
                    original,
                    permissions: None,
                    written_bytes: content.len(),
                });
            }
            PatchOp::Delete { path } => {
                let relative = resolve_file(root, path)?;
                claim(dir, &mut claimed, &mut inodes, &relative)?;
                require_regular_file(dir, &mut state, &relative)?;
                let raw = read_bytes(dir, &relative)?;
                let permissions = snapshot_permissions(dir, &relative)?;
                state.insert(relative.clone(), Kind::Missing);
                planned.push(PlannedFile {
                    path: relative,
                    op: "delete",
                    action: Some(ApplyAction::Delete),
                    diff: None,
                    created: false,
                    deleted: true,
                    original: Some(raw),
                    permissions,
                    written_bytes: 0,
                });
            }
            PatchOp::Move { from, to } => {
                let source = resolve_file(root, from)?;
                let destination = resolve_file(root, to)?;
                claim(dir, &mut claimed, &mut inodes, &source)?;
                claim(dir, &mut claimed, &mut inodes, &destination)?;
                let size = require_regular_file(dir, &mut state, &source)?;
                match kind(dir, &mut state, &destination)? {
                    Kind::Missing => {}
                    Kind::File => {
                        return Err(ExeoraError::new(
                            ErrorCode::InvalidArguments,
                            format!("{} already exists.", relative_string(&destination)),
                        ));
                    }
                    Kind::Other => return Err(not_a_file(&destination)),
                }
                state.insert(source.clone(), Kind::Missing);
                state.insert(destination.clone(), Kind::File);
                planned.push(PlannedFile {
                    path: source.clone(),
                    op: "move",
                    action: Some(ApplyAction::Rename(destination.clone())),
                    diff: None,
                    created: false,
                    deleted: true,
                    original: None,
                    permissions: None,
                    written_bytes: size,
                });
                planned.push(PlannedFile {
                    path: destination,
                    op: "move",
                    action: None,
                    diff: None,
                    created: true,
                    deleted: false,
                    original: None,
                    permissions: None,
                    written_bytes: 0,
                });
            }
        }
    }
    Ok(planned)
}

fn apply_all(dir: &Dir, planned: &[PlannedFile]) -> Result<(), ExeoraError> {
    let mut attempted = Vec::new();
    let mut created_dirs = Vec::new();
    for file in apply_order(planned) {
        attempted.push(file);
        if apply_one(dir, file, &mut created_dirs).is_err() {
            return match rollback(dir, &attempted, &created_dirs) {
                Ok(()) => Err(ExeoraError::new(
                    ErrorCode::ToolFailed,
                    "The patch was aborted and the tree restored.",
                )),
                Err(restore) => Err(restore),
            };
        }
    }
    Ok(())
}

fn apply_order(planned: &[PlannedFile]) -> impl Iterator<Item = &PlannedFile> {
    let destinations = planned.iter().filter(|file| {
        matches!(
            file.action,
            Some(ApplyAction::Write(_) | ApplyAction::Rename(_))
        )
    });
    let deletions = planned
        .iter()
        .filter(|file| matches!(file.action, Some(ApplyAction::Delete)));
    destinations.chain(deletions)
}

fn apply_one(
    dir: &Dir,
    file: &PlannedFile,
    created_dirs: &mut Vec<PathBuf>,
) -> Result<(), ExeoraError> {
    #[cfg(test)]
    record_applied_action(&file.action);
    match &file.action {
        Some(ApplyAction::Write(content)) => {
            ensure_parents(dir, &file.path, created_dirs)?;
            write_file(dir, &file.path, content)
        }
        Some(ApplyAction::Delete) => {
            #[cfg(test)]
            if fail_next_delete() {
                return Err(ExeoraError::tool("injected delete failure"));
            }
            dir.remove_file(&file.path)
                .map_err(|error| ExeoraError::tool(error.to_string()))
        }
        Some(ApplyAction::Rename(destination)) => {
            ensure_parents(dir, destination, created_dirs)?;
            #[cfg(test)]
            if fail_next_rename() {
                return Err(ExeoraError::tool("injected rename failure"));
            }
            dir.rename(&file.path, dir, destination)
                .map_err(|error| ExeoraError::tool(error.to_string()))
        }
        None => Ok(()),
    }
}

fn rollback(
    dir: &Dir,
    attempted: &[&PlannedFile],
    created_dirs: &[PathBuf],
) -> Result<(), ExeoraError> {
    let mut dirty = false;
    for file in attempted.iter().rev() {
        if restore_one(dir, file).is_err() {
            dirty = true;
        }
    }
    for path in created_dirs.iter().rev() {
        match dir.remove_dir(path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => dirty = true,
        }
    }
    if dirty {
        Err(ExeoraError::new(
            ErrorCode::InternalError,
            "The patch was aborted and the tree may be dirty.",
        ))
    } else {
        Ok(())
    }
}

fn restore_one(dir: &Dir, file: &PlannedFile) -> Result<(), ExeoraError> {
    match &file.action {
        Some(ApplyAction::Write(_)) => match &file.original {
            Some(original) => write_bytes(dir, &file.path, original),
            None => remove_if_present(dir, &file.path),
        },
        Some(ApplyAction::Delete) => match &file.original {
            Some(original) => restore_deleted(dir, &file.path, original, file.permissions.as_ref()),
            None => Ok(()),
        },
        Some(ApplyAction::Rename(destination)) => {
            dir.rename(destination, dir, &file.path).or_else(|error| {
                if error.kind() == std::io::ErrorKind::NotFound {
                    Ok(())
                } else {
                    Err(ExeoraError::tool(error.to_string()))
                }
            })
        }
        None => Ok(()),
    }
}

fn remove_if_present(dir: &Dir, path: &Path) -> Result<(), ExeoraError> {
    match dir.remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(ExeoraError::tool(error.to_string())),
    }
}

fn ensure_parents(
    dir: &Dir,
    path: &Path,
    created_dirs: &mut Vec<PathBuf>,
) -> Result<(), ExeoraError> {
    let Some(parent) = path.parent() else {
        return Ok(());
    };
    if parent.as_os_str().is_empty() {
        return Ok(());
    }
    let mut missing = Vec::new();
    let mut current = parent;
    loop {
        match dir.metadata(current) {
            Ok(_) => break,
            Err(_) => missing.push(current.to_path_buf()),
        }
        match current.parent() {
            Some(next) if !next.as_os_str().is_empty() => current = next,
            _ => break,
        }
    }
    // Child-first collection, ancestor-first create, so rollback can reverse
    // the recorded list and remove children before parents.
    for path in missing.iter().rev() {
        dir.create_dir(path)
            .map_err(|error| ExeoraError::tool(error.to_string()))?;
        created_dirs.push(path.clone());
    }
    Ok(())
}

fn snapshot_permissions(dir: &Dir, path: &Path) -> Result<Option<Permissions>, ExeoraError> {
    match dir.metadata(path) {
        Ok(metadata) => Ok(Some(metadata.permissions())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(ExeoraError::tool(error.to_string())),
    }
}

fn restore_deleted(
    dir: &Dir,
    path: &Path,
    original: &[u8],
    permissions: Option<&Permissions>,
) -> Result<(), ExeoraError> {
    write_bytes(dir, path, original)?;
    if let Some(permissions) = permissions {
        dir.set_permissions(path, permissions.clone())
            .map_err(|error| ExeoraError::tool(error.to_string()))?;
    }
    Ok(())
}

fn write_file(dir: &Dir, path: &Path, content: &str) -> Result<(), ExeoraError> {
    write_bytes(dir, path, content.as_bytes())
}

fn write_bytes(dir: &Dir, path: &Path, content: &[u8]) -> Result<(), ExeoraError> {
    let mut options = OpenOptions::new();
    options.write(true).create(true).truncate(true);
    let mut file = dir
        .open_with(path, &options)
        .map_err(|error| ExeoraError::tool(error.to_string()))?;
    #[cfg(test)]
    if fail_next_write() {
        return Err(ExeoraError::tool("injected write failure"));
    }
    file.write_all(content)
        .map_err(|error| ExeoraError::tool(error.to_string()))
}

fn resolve_file(root: &Path, relative: &str) -> Result<PathBuf, ExeoraError> {
    let (_, path) = resolve_in_project(root, relative)?;
    if path.as_os_str().is_empty() {
        return Err(ExeoraError::new(
            ErrorCode::InvalidArguments,
            "A patch cannot target the project root.",
        ));
    }
    Ok(path)
}

fn claim(
    dir: &Dir,
    claimed: &mut HashSet<PathBuf>,
    inodes: &mut HashSet<(u64, u64)>,
    path: &Path,
) -> Result<(), ExeoraError> {
    let identity = claim_key(&filesystem_identity(dir, path)?);
    if claimed.iter().any(|existing| overlaps(existing, &identity)) {
        return Err(overlap_error(path));
    }
    #[cfg(unix)]
    if let Some(inode) = file_inode(dir, path)
        && !inodes.insert(inode)
    {
        return Err(overlap_error(path));
    }
    #[cfg(not(unix))]
    let _ = inodes;
    claimed.insert(identity);
    Ok(())
}

fn overlap_error(path: &Path) -> ExeoraError {
    ExeoraError::new(
        ErrorCode::InvalidArguments,
        format!(
            "Two operations in this patch target overlapping paths including {}.",
            relative_string(path)
        ),
    )
}

fn overlaps(left: &Path, right: &Path) -> bool {
    left == right || left.starts_with(right) || right.starts_with(left)
}

/// Comparison key for a claimed path.
///
/// On case-insensitive filesystems, unresolved components would otherwise keep
/// the caller's spelling (`A.txt` vs `a.txt`) and pass preflight as two files.
fn claim_key(path: &Path) -> PathBuf {
    #[cfg(any(windows, target_os = "macos"))]
    {
        fold_path(path)
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        path.to_path_buf()
    }
}

#[cfg(any(windows, target_os = "macos", test))]
fn fold_path(path: &Path) -> PathBuf {
    use std::path::Component;
    let mut folded = PathBuf::new();
    for component in path.components() {
        match component {
            Component::Normal(name) => folded.push(fold_name(&name.to_string_lossy())),
            Component::Prefix(prefix) => folded.push(prefix.as_os_str()),
            Component::RootDir => folded.push(component.as_os_str()),
            Component::CurDir | Component::ParentDir => folded.push(component.as_os_str()),
        }
    }
    folded
}

/// Unicode caseless key: NFKC, then default case fold (C+F mappings).
///
/// `str::to_lowercase` is contextual and 1:1 for most letters, so `ß.txt` and
/// `ss.txt`, or `ΟΣ.txt` and `οσ.txt`, would claim as two files on APFS/NTFS.
#[cfg(any(windows, target_os = "macos", test))]
fn fold_name(name: &str) -> String {
    use unicode_normalization::UnicodeNormalization;
    let nfkc: String = name.nfkc().collect();
    caseless::default_case_fold_str(&nfkc)
}

/// Canonical location of this path, following directory symlinks.
///
/// Missing files keep the last existing ancestor canonicalised and the
/// remaining relative tail, so `alias/f` and `real/f` collide when `alias`
/// is a directory symlink to `real`.
fn filesystem_identity(dir: &Dir, path: &Path) -> Result<PathBuf, ExeoraError> {
    match dir.canonicalize(path) {
        Ok(canonical) => Ok(canonical),
        Err(_) => {
            let mut ancestor = path;
            let mut missing = PathBuf::new();
            loop {
                match ancestor.parent() {
                    Some(parent) if !parent.as_os_str().is_empty() => {
                        if let Some(name) = ancestor.file_name() {
                            missing = Path::new(name).join(missing);
                        }
                        ancestor = parent;
                        if let Ok(canonical) = dir.canonicalize(ancestor) {
                            return Ok(canonical.join(missing));
                        }
                    }
                    _ => return Ok(path.to_path_buf()),
                }
            }
        }
    }
}

#[cfg(unix)]
fn file_inode(dir: &Dir, path: &Path) -> Option<(u64, u64)> {
    use cap_std::fs::MetadataExt;
    let metadata = dir.metadata(path).ok()?;
    if !metadata.is_file() {
        return None;
    }
    Some((metadata.dev(), metadata.ino()))
}

fn not_a_file(path: &Path) -> ExeoraError {
    ExeoraError::new(
        ErrorCode::InvalidArguments,
        format!("{} is not a file.", relative_string(path)),
    )
}

fn kind(dir: &Dir, state: &mut HashMap<PathBuf, Kind>, path: &Path) -> Result<Kind, ExeoraError> {
    if let Some(current) = state.get(path) {
        return Ok(match current {
            Kind::Missing => Kind::Missing,
            Kind::File => Kind::File,
            Kind::Other => Kind::Other,
        });
    }
    let current = inspect(dir, path)?;
    state.insert(path.to_path_buf(), current);
    Ok(current)
}

fn inspect(dir: &Dir, path: &Path) -> Result<Kind, ExeoraError> {
    match dir.symlink_metadata(path) {
        Ok(metadata) if metadata.is_symlink() => Err(ExeoraError::new(
            ErrorCode::InvalidArguments,
            format!(
                "{} is a symlink. apply_patch only edits regular files.",
                relative_string(path)
            ),
        )),
        Ok(metadata) if metadata.is_file() => Ok(Kind::File),
        Ok(_) => Ok(Kind::Other),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Kind::Missing),
        Err(error) => Err(ExeoraError::tool(format!(
            "Could not read {}: {:?}.",
            relative_string(path),
            error.kind()
        ))),
    }
}

fn require_regular_file(
    dir: &Dir,
    state: &mut HashMap<PathBuf, Kind>,
    path: &Path,
) -> Result<usize, ExeoraError> {
    match kind(dir, state, path)? {
        Kind::File => {
            let metadata = dir
                .metadata(path)
                .map_err(|error| ExeoraError::tool(error.to_string()))?;
            Ok(metadata.len() as usize)
        }
        Kind::Missing => Err(ExeoraError::new(
            ErrorCode::PathNotFound,
            format!("{} was not found.", relative_string(path)),
        )),
        Kind::Other => Err(not_a_file(path)),
    }
}

fn read_bytes(dir: &Dir, path: &Path) -> Result<Vec<u8>, ExeoraError> {
    let mut file = dir
        .open(path)
        .map_err(|error| ExeoraError::tool(error.to_string()))?;
    let mut raw = Vec::new();
    file.read_to_end(&mut raw)
        .map_err(|error| ExeoraError::tool(error.to_string()))?;
    Ok(raw)
}

fn read_text(
    dir: &Dir,
    state: &mut HashMap<PathBuf, Kind>,
    path: &Path,
) -> Result<String, ExeoraError> {
    require_regular_file(dir, state, path)?;
    let raw = read_bytes(dir, path)?;
    String::from_utf8(raw).map_err(|_| {
        ExeoraError::new(
            ErrorCode::InvalidArguments,
            format!(
                "{} is not valid UTF-8. update only edits text files.",
                relative_string(path)
            ),
        )
    })
}

fn unified_diff(before: &str, after: &str, path: &Path) -> String {
    let display = relative_string(path);
    TextDiff::from_lines(before, after)
        .unified_diff()
        .header(&display, &display)
        .to_string()
}

#[cfg(test)]
thread_local! {
    static FAIL_NEXT_WRITE: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
    static FAIL_NEXT_RENAME: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
    static FAIL_DELETE_AT: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
    static DELETE_COUNT: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
    static APPLIED: std::cell::RefCell<Vec<&'static str>> = const { std::cell::RefCell::new(Vec::new()) };
}

#[cfg(test)]
fn record_applied_action(action: &Option<ApplyAction>) {
    let kind = match action {
        Some(ApplyAction::Write(_)) => "write",
        Some(ApplyAction::Rename(_)) => "rename",
        Some(ApplyAction::Delete) => "delete",
        None => return,
    };
    APPLIED.with(|applied| applied.borrow_mut().push(kind));
}

#[cfg(test)]
fn take_applied_actions() -> Vec<&'static str> {
    APPLIED.with(|applied| applied.replace(Vec::new()))
}

#[cfg(test)]
fn fail_next_write() -> bool {
    FAIL_NEXT_WRITE.with(|flag| flag.replace(false))
}

#[cfg(test)]
fn fail_next_rename() -> bool {
    FAIL_NEXT_RENAME.with(|flag| flag.replace(false))
}

#[cfg(test)]
fn fail_next_delete() -> bool {
    let n = DELETE_COUNT.with(|count| {
        let next = count.get() + 1;
        count.set(next);
        next
    });
    FAIL_DELETE_AT.with(|target| target.get() == n)
}

#[cfg(test)]
fn inject_next_write_failure() {
    FAIL_NEXT_WRITE.with(|flag| flag.set(true));
}

#[cfg(test)]
fn inject_next_rename_failure() {
    FAIL_NEXT_RENAME.with(|flag| flag.set(true));
}

#[cfg(all(test, unix))]
fn inject_delete_failure_at(n: usize) {
    DELETE_COUNT.with(|count| count.set(0));
    FAIL_DELETE_AT.with(|target| target.set(n));
}

#[cfg(test)]
mod tests {
    #[cfg(unix)]
    use super::inject_delete_failure_at;
    use super::{
        apply_patch_sync, inject_next_rename_failure, inject_next_write_failure,
        take_applied_actions,
    };
    use crate::error::ErrorCode;
    use serde_json::json;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn filesystem_equivalent_spellings_share_a_claim_key() {
        use super::{fold_path, overlaps};
        use std::path::Path;
        let upper = fold_path(Path::new("Dir/A.txt"));
        let lower = fold_path(Path::new("dir/a.txt"));
        assert_eq!(upper, lower);
        assert!(overlaps(&upper, &lower));
        let composed = fold_path(Path::new("cafe\u{0301}.txt"));
        let precomposed = fold_path(Path::new("caf\u{00e9}.txt"));
        assert_eq!(composed, precomposed);
        assert_eq!(
            fold_path(Path::new("ΟΣ.txt")),
            fold_path(Path::new("οσ.txt"))
        );
        assert_eq!(fold_path(Path::new("ς.txt")), fold_path(Path::new("σ.txt")));
        assert_eq!(
            fold_path(Path::new("ß.txt")),
            fold_path(Path::new("ss.txt"))
        );
        assert_eq!(
            fold_path(Path::new("Straße.txt")),
            fold_path(Path::new("STRASSE.txt"))
        );
    }

    #[cfg(any(windows, target_os = "macos"))]
    #[test]
    fn sharp_s_aliases_of_missing_paths_are_refused_before_any_write() {
        let root = TempDir::new().unwrap();
        let error = apply_patch_sync(
            root.path(),
            json!({
                "operations": [
                    {"op": "create", "path": "ß.txt", "content": "first\n"},
                    {"op": "create", "path": "ss.txt", "content": "second\n"}
                ]
            }),
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::InvalidArguments);
        assert!(error.to_string().contains("overlapping"));
    }

    #[cfg(any(windows, target_os = "macos"))]
    #[test]
    fn greek_sigma_aliases_of_missing_paths_are_refused_before_any_write() {
        let root = TempDir::new().unwrap();
        let error = apply_patch_sync(
            root.path(),
            json!({
                "operations": [
                    {"op": "create", "path": "ΟΣ.txt", "content": "first\n"},
                    {"op": "create", "path": "οσ.txt", "content": "second\n"}
                ]
            }),
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::InvalidArguments);
        assert!(error.to_string().contains("overlapping"));
    }

    #[cfg(any(windows, target_os = "macos"))]
    #[test]
    fn case_aliases_of_missing_paths_are_refused_before_any_write() {
        let root = TempDir::new().unwrap();
        let error = apply_patch_sync(
            root.path(),
            json!({
                "operations": [
                    {"op": "create", "path": "A.txt", "content": "first\n"},
                    {"op": "create", "path": "a.txt", "content": "second\n"}
                ]
            }),
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::InvalidArguments);
        assert!(error.to_string().contains("overlapping"));
        assert!(!root.path().join("A.txt").exists());
        assert!(!root.path().join("a.txt").exists());
    }

    #[cfg(any(windows, target_os = "macos"))]
    #[test]
    fn case_aliases_of_move_destinations_are_refused_before_any_write() {
        let root = TempDir::new().unwrap();
        fs::write(root.path().join("from.txt"), "moved\n").unwrap();
        fs::write(root.path().join("other.txt"), "other\n").unwrap();
        let error = apply_patch_sync(
            root.path(),
            json!({
                "operations": [
                    {"op": "move", "from": "from.txt", "to": "Out.txt"},
                    {"op": "move", "from": "other.txt", "to": "out.txt"}
                ]
            }),
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::InvalidArguments);
        assert!(root.path().join("from.txt").exists());
        assert!(root.path().join("other.txt").exists());
        assert!(!root.path().join("Out.txt").exists());
        assert!(!root.path().join("out.txt").exists());
    }

    #[test]
    fn an_inexact_update_is_refused_and_leaves_the_file_untouched() {
        let root = TempDir::new().unwrap();
        let original = "left   \ncafe\u{301}\n";
        fs::write(root.path().join("notes.txt"), original).unwrap();
        let error = apply_patch_sync(
            root.path(),
            json!({
                "operations": [{
                    "op": "update",
                    "path": "notes.txt",
                    "oldString": "café",
                    "newString": "done"
                }]
            }),
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::ToolFailed);
        assert_eq!(
            fs::read_to_string(root.path().join("notes.txt")).unwrap(),
            original
        );
    }

    #[test]
    fn overlapping_paths_are_refused_before_any_write() {
        let root = TempDir::new().unwrap();
        fs::write(root.path().join("a.txt"), "one\n").unwrap();
        let error = apply_patch_sync(
            root.path(),
            json!({
                "operations": [
                    {"op": "update", "path": "a.txt", "oldString": "one", "newString": "two"},
                    {"op": "update", "path": "a.txt", "oldString": "two", "newString": "three"}
                ]
            }),
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::InvalidArguments);
        assert_eq!(
            fs::read_to_string(root.path().join("a.txt")).unwrap(),
            "one\n"
        );
    }

    #[test]
    fn a_file_and_a_nested_path_cannot_share_a_patch() {
        let root = TempDir::new().unwrap();
        let error = apply_patch_sync(
            root.path(),
            json!({
                "operations": [
                    {"op": "create", "path": "nested/leaf.txt", "content": "leaf\n"},
                    {"op": "create", "path": "nested", "content": "file\n"}
                ]
            }),
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::InvalidArguments);
        assert!(!root.path().join("nested").exists());
        assert!(!root.path().join("nested/leaf.txt").exists());
    }

    #[cfg(unix)]
    #[test]
    fn a_fifo_is_rejected_before_any_read_or_write() {
        let root = TempDir::new().unwrap();
        let fifo = root.path().join("blocked");
        let status = std::process::Command::new("mkfifo")
            .arg(&fifo)
            .status()
            .expect("mkfifo");
        assert!(status.success());
        let error = apply_patch_sync(
            root.path(),
            json!({
                "operations": [{"op": "delete", "path": "blocked"}]
            }),
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::InvalidArguments);
        assert!(error.to_string().contains("not a file"));
        assert!(fifo.exists());
    }

    #[cfg(unix)]
    #[test]
    fn a_failed_second_delete_restores_the_first_files_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let root = TempDir::new().unwrap();
        let script = root.path().join("script.sh");
        fs::write(&script, "#!/bin/sh\n").unwrap();
        fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();
        fs::write(root.path().join("other.txt"), "keep\n").unwrap();
        take_applied_actions();
        inject_delete_failure_at(2);
        let error = apply_patch_sync(
            root.path(),
            json!({
                "operations": [
                    {"op": "delete", "path": "script.sh"},
                    {"op": "delete", "path": "other.txt"}
                ]
            }),
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::ToolFailed);
        assert_eq!(take_applied_actions(), ["delete", "delete"]);
        assert_eq!(fs::read_to_string(&script).unwrap(), "#!/bin/sh\n");
        assert_eq!(
            fs::metadata(&script).unwrap().permissions().mode() & 0o777,
            0o755
        );
        assert_eq!(
            fs::read_to_string(root.path().join("other.txt")).unwrap(),
            "keep\n"
        );
    }

    #[test]
    fn writes_and_renames_run_before_deletes_even_when_delete_is_listed_first() {
        let root = TempDir::new().unwrap();
        fs::write(root.path().join("gone.txt"), "bye\n").unwrap();
        take_applied_actions();
        inject_next_write_failure();
        let error = apply_patch_sync(
            root.path(),
            json!({
                "operations": [
                    {"op": "delete", "path": "gone.txt"},
                    {"op": "create", "path": "new.txt", "content": "hi\n"}
                ]
            }),
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::ToolFailed);
        assert_eq!(take_applied_actions(), ["write"]);
        assert_eq!(
            fs::read_to_string(root.path().join("gone.txt")).unwrap(),
            "bye\n"
        );
        assert!(!root.path().join("new.txt").exists());
    }

    #[test]
    fn a_failed_update_write_restores_the_original() {
        let root = TempDir::new().unwrap();
        fs::write(root.path().join("keep.txt"), "keep\n").unwrap();
        fs::write(root.path().join("old.txt"), "alpha\n").unwrap();
        inject_next_write_failure();
        let error = apply_patch_sync(
            root.path(),
            json!({
                "operations": [
                    {"op": "update", "path": "old.txt", "oldString": "alpha", "newString": "beta"},
                    {"op": "create", "path": "ghost.txt", "content": "nope\n"}
                ]
            }),
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::ToolFailed);
        assert_eq!(
            fs::read_to_string(root.path().join("old.txt")).unwrap(),
            "alpha\n"
        );
        assert_eq!(
            fs::read_to_string(root.path().join("keep.txt")).unwrap(),
            "keep\n"
        );
        assert!(!root.path().join("ghost.txt").exists());
    }

    #[test]
    fn a_failed_move_keeps_the_source_and_does_not_leave_the_destination() {
        let root = TempDir::new().unwrap();
        fs::write(root.path().join("from.txt"), "moved\n").unwrap();
        inject_next_rename_failure();
        let error = apply_patch_sync(
            root.path(),
            json!({
                "operations": [{"op": "move", "from": "from.txt", "to": "to.txt"}]
            }),
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::ToolFailed);
        assert_eq!(
            fs::read_to_string(root.path().join("from.txt")).unwrap(),
            "moved\n"
        );
        assert!(!root.path().join("to.txt").exists());
    }

    #[test]
    fn a_move_accepts_a_binary_file() {
        let root = TempDir::new().unwrap();
        fs::write(root.path().join("blob.bin"), [0xff, 0x00, 0xfe]).unwrap();
        apply_patch_sync(
            root.path(),
            json!({
                "operations": [{"op": "move", "from": "blob.bin", "to": "out.bin"}]
            }),
        )
        .unwrap();
        assert!(!root.path().join("blob.bin").exists());
        assert_eq!(
            fs::read(root.path().join("out.bin")).unwrap(),
            [0xff, 0x00, 0xfe]
        );
    }

    #[test]
    fn a_move_keeps_the_source_file_identity() {
        let root = TempDir::new().unwrap();
        let from = root.path().join("from.txt");
        fs::write(&from, "moved\n").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&from, fs::Permissions::from_mode(0o755)).unwrap();
        }
        apply_patch_sync(
            root.path(),
            json!({
                "operations": [{"op": "move", "from": "from.txt", "to": "to.txt"}]
            }),
        )
        .unwrap();
        assert!(!from.exists());
        let to = root.path().join("to.txt");
        assert_eq!(fs::read_to_string(&to).unwrap(), "moved\n");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(&to).unwrap().permissions().mode() & 0o777,
                0o755
            );
        }
    }

    #[test]
    fn a_symlink_is_refused_before_any_write() {
        let root = TempDir::new().unwrap();
        fs::write(root.path().join("real.txt"), "keep\n").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink("real.txt", root.path().join("alias.txt")).unwrap();
        #[cfg(windows)]
        std::os::windows::fs::symlink_file("real.txt", root.path().join("alias.txt")).unwrap();
        let error = apply_patch_sync(
            root.path(),
            json!({
                "operations": [
                    {"op": "update", "path": "alias.txt", "oldString": "keep", "newString": "changed"}
                ]
            }),
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::InvalidArguments);
        assert!(error.to_string().contains("symlink"));
        assert_eq!(
            fs::read_to_string(root.path().join("real.txt")).unwrap(),
            "keep\n"
        );
        assert!(
            root.path()
                .join("alias.txt")
                .symlink_metadata()
                .unwrap()
                .is_symlink()
        );
    }

    #[test]
    fn a_directory_symlink_cannot_alias_another_path_in_the_same_patch() {
        let root = TempDir::new().unwrap();
        fs::create_dir(root.path().join("real")).unwrap();
        fs::write(root.path().join("real/f.txt"), "x\n").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink("real", root.path().join("alias")).unwrap();
        #[cfg(windows)]
        std::os::windows::fs::symlink_dir("real", root.path().join("alias")).unwrap();
        let error = apply_patch_sync(
            root.path(),
            json!({
                "operations": [
                    {"op": "update", "path": "real/f.txt", "oldString": "x", "newString": "y"},
                    {"op": "update", "path": "alias/f.txt", "oldString": "x", "newString": "z"}
                ]
            }),
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::InvalidArguments);
        assert!(error.to_string().contains("overlapping"));
        assert_eq!(
            fs::read_to_string(root.path().join("real/f.txt")).unwrap(),
            "x\n"
        );
    }

    #[cfg(unix)]
    #[test]
    fn a_hardlink_cannot_be_edited_twice_in_the_same_patch() {
        let root = TempDir::new().unwrap();
        fs::write(root.path().join("a.txt"), "x\n").unwrap();
        fs::hard_link(root.path().join("a.txt"), root.path().join("b.txt")).unwrap();
        let error = apply_patch_sync(
            root.path(),
            json!({
                "operations": [
                    {"op": "update", "path": "a.txt", "oldString": "x", "newString": "y"},
                    {"op": "update", "path": "b.txt", "oldString": "x", "newString": "z"}
                ]
            }),
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::InvalidArguments);
        assert_eq!(
            fs::read_to_string(root.path().join("a.txt")).unwrap(),
            "x\n"
        );
        assert_eq!(
            fs::read_to_string(root.path().join("b.txt")).unwrap(),
            "x\n"
        );
    }

    #[test]
    fn an_oversized_result_is_refused_before_writing() {
        let root = TempDir::new().unwrap();
        let content = "x\n".repeat(400_000);
        let error = apply_patch_sync(
            root.path(),
            json!({
                "operations": [{"op": "create", "path": "huge.txt", "content": content}]
            }),
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::InvalidArguments);
        assert!(error.to_string().contains("protocol limit"));
        assert!(!root.path().join("huge.txt").exists());
    }

    #[test]
    fn a_failed_nested_create_does_not_leave_empty_directories() {
        let root = TempDir::new().unwrap();
        inject_next_write_failure();
        let error = apply_patch_sync(
            root.path(),
            json!({
                "operations": [{"op": "create", "path": "a/b/file.txt", "content": "nested\n"}]
            }),
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::ToolFailed);
        assert!(!root.path().join("a").exists());
        assert!(!root.path().join("a/b").exists());
        assert!(!root.path().join("a/b/file.txt").exists());
    }

    #[test]
    fn a_large_update_is_refused_before_writing() {
        let root = TempDir::new().unwrap();
        let original = format!("head{}", "x".repeat(1_000_000));
        fs::write(root.path().join("big.txt"), &original).unwrap();
        let error = apply_patch_sync(
            root.path(),
            json!({
                "operations": [{
                    "op": "update",
                    "path": "big.txt",
                    "oldString": "head",
                    "newString": "tail"
                }]
            }),
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::InvalidArguments);
        assert!(error.to_string().contains("bytes"));
        assert_eq!(
            fs::read_to_string(root.path().join("big.txt")).unwrap(),
            original
        );
    }

    #[test]
    fn a_large_move_is_refused_before_writing() {
        let root = TempDir::new().unwrap();
        let original = "x".repeat(1_000_001);
        fs::write(root.path().join("from.txt"), &original).unwrap();
        let error = apply_patch_sync(
            root.path(),
            json!({
                "operations": [{"op": "move", "from": "from.txt", "to": "to.txt"}]
            }),
        )
        .unwrap_err();
        assert_eq!(error.code, ErrorCode::InvalidArguments);
        assert_eq!(
            fs::read_to_string(root.path().join("from.txt")).unwrap(),
            original
        );
        assert!(!root.path().join("to.txt").exists());
    }
}
