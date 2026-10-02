//! Files that are nobody's business but the user the CLI runs as.
//!
//! A script of the project, the state of its runs, a token for GitHub: each
//! is written whole or not at all, and readable by its owner alone. Written
//! whole means written beside the file and renamed over it, so a reader
//! never finds half of one and a crash leaves the old one in place.

use std::{
    fs, io,
    io::{Read, Write},
    path::{Path, PathBuf},
};

/// Makes the directory and what leads to it, and closes it to everybody but
/// its owner. One that exists is closed too, whoever made it.
pub(crate) fn directory(path: &Path) -> io::Result<()> {
    reject_symlink_components(path)?;
    fs::create_dir_all(path)?;
    reject_symlink_components(path)?;
    restrict(path, 0o700)
}

fn reject_symlink_components(path: &Path) -> io::Result<()> {
    let mut current = PathBuf::new();
    for component in path.components() {
        current.push(component);
        match fs::symlink_metadata(&current) {
            Ok(metadata) if metadata.file_type().is_symlink() => {
                return Err(io::Error::new(
                    io::ErrorKind::PermissionDenied,
                    "private directory cannot contain a symlink",
                ));
            }
            Ok(metadata) if !metadata.is_dir() => {
                return Err(io::Error::new(
                    io::ErrorKind::NotADirectory,
                    "private directory path contains a non-directory",
                ));
            }
            Ok(_) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(error),
        }
    }
    Ok(())
}

/// Replaces the file with `bytes`, with `mode` as its permissions from the
/// moment it exists.
pub(crate) fn write(path: &Path, bytes: &[u8], mode: u32) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        reject_symlink_components(parent)?;
    }
    let temporary = beside(path);
    let written = (|| {
        let mut file = create(&temporary, mode)?;
        file.write_all(bytes)?;
        file.sync_all()
    })();
    let moved = written.and_then(|()| fs::rename(&temporary, path));
    if moved.is_err() {
        let _ = fs::remove_file(&temporary);
    }
    moved
}

/// Removes a private file without allowing a symlinked parent to redirect the
/// path outside its intended directory. Removing the final symlink itself is
/// safe and is left to the platform's unlink operation.
pub(crate) fn remove(path: &Path) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        reject_symlink_components(parent)?;
    }
    fs::remove_file(path)
}

/// Reads a private file without following a symlink or retaining an
/// unbounded attacker-controlled body. The fallback credential file is
/// user-owned state, so refusing an old/shared file is safer than sending its
/// contents as a bearer token.
pub(crate) fn read(path: &Path, max_bytes: usize) -> io::Result<Vec<u8>> {
    if let Some(parent) = path.parent() {
        reject_symlink_components(parent)?;
    }
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "private file cannot be a symlink",
            ));
        }
        Ok(_) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let file = options.open(path)?;
    let metadata = file.metadata()?;
    if !metadata.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "private file is not a regular file",
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.uid() != unsafe { libc::geteuid() }
            || metadata.mode() & 0o077 != 0
            || metadata.nlink() != 1
        {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "private file is not owned exclusively by this account",
            ));
        }
    }
    let mut bytes = Vec::with_capacity(max_bytes.min(4096));
    file.take((max_bytes.saturating_add(1)) as u64)
        .read_to_end(&mut bytes)?;
    if bytes.len() > max_bytes {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "private file is too large",
        ));
    }
    Ok(bytes)
}

fn beside(path: &Path) -> PathBuf {
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    path.with_file_name(format!(".{name}.{}.tmp", uuid::Uuid::new_v4().simple()))
}

#[cfg(unix)]
fn create(path: &Path, mode: u32) -> io::Result<fs::File> {
    use std::os::unix::fs::OpenOptionsExt;
    let file = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .mode(mode)
        .open(path)?;
    // The mode asked for at creation is cut down by the umask; this is not.
    restrict(path, mode)?;
    Ok(file)
}

#[cfg(not(unix))]
fn create(path: &Path, _mode: u32) -> io::Result<fs::File> {
    fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(path)
}

#[cfg(unix)]
fn restrict(path: &Path, mode: u32) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(mode))
}

#[cfg(not(unix))]
fn restrict(_path: &Path, _mode: u32) -> io::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{directory, read, write};

    #[test]
    fn replaces_a_file_whole_and_leaves_nothing_beside_it() {
        let home = tempfile::tempdir().unwrap();
        let folder = home.path().join("a/b");
        directory(&folder).unwrap();
        let path = folder.join("state.json");
        write(&path, b"one", 0o600).unwrap();
        write(&path, b"two", 0o600).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"two");
        let names: Vec<_> = std::fs::read_dir(&folder)
            .unwrap()
            .flatten()
            .map(|entry| entry.file_name())
            .collect();
        assert_eq!(names, ["state.json"]);
    }

    #[test]
    fn reads_only_a_private_regular_file_within_the_limit() {
        let home = tempfile::tempdir().unwrap();
        let folder = home.path().join("private");
        directory(&folder).unwrap();
        let path = folder.join("state.json");
        write(&path, b"{}", 0o600).unwrap();
        assert_eq!(read(&path, 16).unwrap(), b"{}");
        assert!(read(&path, 1).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn refuses_a_symlink_when_reading_a_private_file() {
        let home = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let target = outside.path().join("secret");
        std::fs::write(&target, b"token").unwrap();
        let path = home.path().join("link");
        std::os::unix::fs::symlink(target, &path).unwrap();
        assert!(read(&path, 16).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn keeps_everybody_else_out() {
        use std::os::unix::fs::PermissionsExt;
        let home = tempfile::tempdir().unwrap();
        let folder = home.path().join("hooks");
        std::fs::create_dir(&folder).unwrap();
        std::fs::set_permissions(&folder, std::fs::Permissions::from_mode(0o755)).unwrap();
        directory(&folder).unwrap();
        let mode =
            |path: &std::path::Path| std::fs::metadata(path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode(&folder), 0o700);
        write(&folder.join("state.json"), b"{}", 0o600).unwrap();
        assert_eq!(mode(&folder.join("state.json")), 0o600);
        write(&folder.join("install.sh"), b"true", 0o700).unwrap();
        assert_eq!(mode(&folder.join("install.sh")), 0o700);
    }

    #[cfg(unix)]
    #[test]
    fn refuses_a_symlinked_private_directory() {
        let home = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let link = home.path().join("link");
        std::os::unix::fs::symlink(outside.path(), &link).unwrap();

        assert!(directory(&link.join("nested")).is_err());
        assert!(!link.join("nested").exists());
    }
}
