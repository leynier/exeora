//! The machine token a cloud CLI presents on its relay socket.
//!
//! Read from a file rather than the environment: every command an agent runs
//! inherits the environment, and a token in it would show up in any `env`
//! dump. The file is still readable by that same user, which is the honest
//! limit of a machine that runs the agent's commands as itself; what bounds
//! the damage is that the token opens nothing but this device's relay.

use anyhow::{Context, Result, bail};
use std::{fs, fs::OpenOptions, io::Read, path::Path};

#[cfg(unix)]
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};

const PREFIX: &str = "exm_";
const MAX_BYTES: usize = 512;

/// Reads and checks the token. Re-read on every connection attempt, so a
/// token the gateway replaced takes effect without a restart.
pub fn read(path: &Path) -> Result<String> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_symlink() => {
            bail!("The machine token path cannot be a symlink.");
        }
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(error).with_context(|| {
                format!("Could not inspect the machine token at {}", path.display())
            });
        }
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    options.custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW | libc::O_NONBLOCK);
    let file = options
        .open(path)
        .with_context(|| format!("Could not read the machine token at {}", path.display()))?;
    let metadata = file
        .metadata()
        .with_context(|| format!("Could not inspect the machine token at {}", path.display()))?;
    if !metadata.is_file() {
        bail!("The machine token path is not a regular file.");
    }
    #[cfg(unix)]
    {
        // A token must be private to the service account. O_NOFOLLOW above
        // prevents the final path component from being swapped to a symlink,
        // while these checks reject shared files and aliases to another path.
        if metadata.uid() != unsafe { libc::geteuid() }
            || metadata.mode() & 0o077 != 0
            || metadata.nlink() != 1
        {
            bail!("The machine token file must be private to this account.");
        }
    }
    let mut bytes = Vec::with_capacity(MAX_BYTES.min(4096));
    file.take((MAX_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .context("Could not read the machine token file")?;
    if bytes.len() > MAX_BYTES {
        bail!("The machine token file does not hold a machine token.");
    }
    let raw = String::from_utf8(bytes).context("The machine token file is not UTF-8")?;
    let token = raw.trim();
    if token.is_empty() {
        bail!("The machine token file is empty.");
    }
    if token.len() > MAX_BYTES || !token.starts_with(PREFIX) {
        bail!("The machine token file does not hold a machine token.");
    }
    if token
        .chars()
        .any(|character| character.is_whitespace() || character.is_control())
    {
        bail!("The machine token file holds more than one token.");
    }
    Ok(token.to_owned())
}

#[cfg(test)]
mod tests {
    use super::read;
    #[cfg(unix)]
    use std::fs;
    use std::io::Write;

    fn file(contents: &str) -> tempfile::NamedTempFile {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        file.write_all(contents.as_bytes()).unwrap();
        file
    }

    #[test]
    fn accepts_a_token_with_a_trailing_newline() {
        let file = file("exm_abc_def\n");
        assert_eq!(read(file.path()).unwrap(), "exm_abc_def");
    }

    #[test]
    fn refuses_anything_that_is_not_one_machine_token() {
        for contents in [
            "",
            "   \n",
            "usr:grant:secret",
            "exm_a b",
            &"exm_".repeat(200),
        ] {
            let file = file(contents);
            assert!(read(file.path()).is_err(), "accepted {contents:?}");
        }
        assert!(read(std::path::Path::new("/nonexistent/exeora/token")).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn refuses_a_symlink_to_a_machine_token() {
        let target = file("exm_target\n");
        let directory = tempfile::tempdir().unwrap();
        let link = directory.path().join("token");
        std::os::unix::fs::symlink(target.path(), &link).unwrap();
        assert!(read(&link).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn refuses_a_token_file_shared_with_other_users() {
        let file = file("exm_private\n");
        fs::set_permissions(file.path(), fs::Permissions::from_mode(0o644)).unwrap();
        assert!(read(file.path()).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn refuses_a_fifo_without_waiting_for_a_writer() {
        use std::{ffi::CString, os::unix::ffi::OsStrExt};

        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("token");
        let c_path = CString::new(path.as_os_str().as_bytes()).unwrap();
        // SAFETY: the path is a valid, NUL-free temporary path and the mode
        // only grants access to the current account.
        assert_eq!(unsafe { libc::mkfifo(c_path.as_ptr(), 0o600) }, 0);
        assert!(read(&path).is_err());
    }

    #[cfg(unix)]
    use std::os::unix::fs::PermissionsExt;
}
