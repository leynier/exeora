use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, OpenOptions},
    io,
    time::Duration,
};
use uuid::Uuid;

use super::store::Store;

const HOST_FILE: &str = "host.json";
const MAX_HOST_FILE_BYTES: usize = 512;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct HostFile {
    pub ext_agent_host_id: String,
}

pub(crate) fn load_or_create(store: &Store) -> Result<HostFile> {
    store.ensure_directories()?;
    let path = store.root().join(HOST_FILE);
    match crate::private::read(&path, MAX_HOST_FILE_BYTES) {
        Ok(bytes) => {
            let host: HostFile = serde_json::from_slice(&bytes)
                .with_context(|| format!("Could not parse {}", path.display()))?;
            validate(&host)?;
            Ok(host)
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            let _lock = HostLock::acquire(&path)?;
            match crate::private::read(&path, MAX_HOST_FILE_BYTES) {
                Ok(bytes) => {
                    let host: HostFile = serde_json::from_slice(&bytes)
                        .with_context(|| format!("Could not parse {}", path.display()))?;
                    validate(&host)?;
                    Ok(host)
                }
                Err(error) if error.kind() == io::ErrorKind::NotFound => {
                    let host = HostFile {
                        ext_agent_host_id: format!("urn:uuid:{}", Uuid::new_v4()),
                    };
                    validate(&host)?;
                    let bytes = serde_json::to_vec(&host)?;
                    crate::private::write(&path, &bytes, 0o600)
                        .with_context(|| format!("Could not save {}", path.display()))?;
                    Ok(host)
                }
                Err(error) => {
                    Err(error).with_context(|| format!("Could not read {}", path.display()))
                }
            }
        }
        Err(error) => Err(error).with_context(|| format!("Could not read {}", path.display())),
    }
}

struct HostLock(File);

impl HostLock {
    fn acquire(path: &std::path::Path) -> Result<Self> {
        let lock = path.with_extension("lock");
        if let Ok(metadata) = fs::symlink_metadata(&lock)
            && metadata.file_type().is_symlink()
        {
            bail!("The ChatGPT host lock cannot be a symlink.");
        }
        let mut options = OpenOptions::new();
        options.read(true).write(true).create(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options
                .mode(0o600)
                .custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW | libc::O_NONBLOCK);
        }
        let file = options.open(&lock)?;
        let metadata = file.metadata()?;
        if !metadata.is_file() {
            bail!("The ChatGPT host lock is not a regular file.");
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            if metadata.uid() != unsafe { libc::geteuid() }
                || metadata.mode() & 0o077 != 0
                || metadata.nlink() != 1
            {
                bail!("The ChatGPT host lock is not private to this account.");
            }
        }
        for _ in 0..120 {
            match file.try_lock() {
                Ok(()) => return Ok(Self(file)),
                Err(std::fs::TryLockError::WouldBlock) => {
                    std::thread::sleep(Duration::from_millis(25))
                }
                Err(std::fs::TryLockError::Error(error)) => return Err(error.into()),
            }
        }
        bail!("Timed out waiting for the ChatGPT host lock.")
    }
}

impl Drop for HostLock {
    fn drop(&mut self) {
        let _ = self.0.unlock();
    }
}

fn validate(host: &HostFile) -> Result<()> {
    let Some(uuid) = host.ext_agent_host_id.strip_prefix("urn:uuid:") else {
        bail!("The ChatGPT host identifier is invalid.");
    };
    Uuid::parse_str(uuid).context("The ChatGPT host identifier is invalid.")?;
    if host.ext_agent_host_id.len() > 128 {
        bail!("The ChatGPT host identifier is too long.");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn host_id_is_stable_and_private() {
        let dir = tempdir().unwrap();
        let store = Store::for_test(dir.path());
        let first = load_or_create(&store).unwrap();
        let second = load_or_create(&store).unwrap();
        assert_eq!(first.ext_agent_host_id, second.ext_agent_host_id);
        assert!(store.root().join(HOST_FILE).is_file());
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(store.root().join(HOST_FILE))
                .unwrap()
                .permissions()
                .mode()
                & 0o777;
            assert_eq!(mode, 0o600);
        }
    }

    #[test]
    fn malformed_host_is_rejected() {
        let dir = tempdir().unwrap();
        let store = Store::for_test(dir.path());
        store.ensure_directories().unwrap();
        fs::write(
            store.root().join(HOST_FILE),
            br#"{"ext_agent_host_id":"not-a-uuid"}"#,
        )
        .unwrap();
        assert!(load_or_create(&store).is_err());
    }
}
