//! Files that are nobody's business but the user the CLI runs as.
//!
//! A script of the project, the state of its runs, a token for GitHub: each
//! is written whole or not at all, and readable by its owner alone. Written
//! whole means written beside the file and renamed over it, so a reader
//! never finds half of one and a crash leaves the old one in place.

use std::{
    fs, io,
    io::Write,
    path::{Path, PathBuf},
};

/// Makes the directory and what leads to it, and closes it to everybody but
/// its owner. One that exists is closed too, whoever made it.
pub(crate) fn directory(path: &Path) -> io::Result<()> {
    fs::create_dir_all(path)?;
    restrict(path, 0o700)
}

/// Replaces the file with `bytes`, with `mode` as its permissions from the
/// moment it exists.
pub(crate) fn write(path: &Path, bytes: &[u8], mode: u32) -> io::Result<()> {
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
    use super::{directory, write};

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
}
