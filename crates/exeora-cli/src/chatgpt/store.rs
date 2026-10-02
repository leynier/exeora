use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io,
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};
use uuid::Uuid;

const ACCOUNTS_DIR: &str = "accounts";
const ACTIVE_FILE: &str = "active.json";
const LOGOUT_FILE: &str = "logout-revision.json";
const PROVISIONAL_FILE: &str = "provisional-client.json";
const MAX_ACCOUNT_BYTES: usize = 256 * 1024;
const MAX_ACTIVE_BYTES: usize = 2048;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct StoredAccount {
    #[serde(default)]
    pub email: Option<String>,
    pub issuer: String,
    pub subject: String,
    pub client_id: String,
    pub ext_agent_host_id: String,
    #[serde(default)]
    pub id_token: Option<String>,
    #[serde(default)]
    pub access_token: Option<String>,
    #[serde(default)]
    pub refresh_token: Option<String>,
    #[serde(default = "default_token_type")]
    pub token_type: String,
    #[serde(default)]
    pub expires_at: Option<u64>,
    #[serde(default)]
    pub earliest_refresh_at: Option<u64>,
    #[serde(default)]
    pub scopes: Vec<String>,
    pub saved_at: u64,
    #[serde(default)]
    pub label: Option<String>,
    /// Local state is deliberately kept with the registration so a failed
    /// refresh cannot make the client ID disappear or accidentally retry.
    #[serde(default)]
    pub state: Option<String>,
    #[serde(default)]
    pub new_registration: bool,
}

fn default_token_type() -> String {
    "Bearer".to_owned()
}

impl StoredAccount {
    pub(crate) fn plan_usage_allowed(&self) -> bool {
        self.scopes
            .iter()
            .any(|scope| scope == "chatgpt.tokens.use.direct")
    }

    pub(crate) fn state(&self) -> &'static str {
        match self.state.as_deref() {
            Some("client_invalid") => "client_invalid",
            Some("reconnect") => "reconnect",
            Some("signed_out") => "signed_out",
            Some("plan_disabled") => "plan_disabled",
            _ if self.access_token.is_some() && self.plan_usage_allowed() => "ready",
            _ if self.access_token.is_some() => "plan_disabled",
            _ => "signed_out",
        }
    }

    pub(crate) fn clear_tokens(&mut self, state: &'static str) {
        self.id_token = None;
        self.access_token = None;
        self.refresh_token = None;
        self.expires_at = None;
        self.earliest_refresh_at = None;
        self.state = Some(state.to_owned());
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ActiveFile {
    client_id: String,
    #[serde(default)]
    activation_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct LogoutFile {
    revision: String,
    active_revision: Option<String>,
}

#[derive(Debug)]
pub(crate) struct Store {
    root: PathBuf,
}

impl Store {
    pub(crate) fn new(config_path: &Path) -> Self {
        let parent = config_path.parent().unwrap_or_else(|| Path::new("."));
        Self {
            root: parent.join("chatgpt"),
        }
    }

    #[cfg(test)]
    pub(crate) fn for_test(root: &Path) -> Self {
        Self {
            root: root.join("chatgpt"),
        }
    }

    pub(crate) fn root(&self) -> &Path {
        &self.root
    }

    fn logout_file(&self) -> Result<Option<LogoutFile>> {
        let bytes = match crate::private::read(&self.root.join(LOGOUT_FILE), 512) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.into()),
        };
        let logout: LogoutFile = serde_json::from_slice(&bytes)?;
        Uuid::parse_str(&logout.revision)?;
        if let Some(revision) = &logout.active_revision {
            Uuid::parse_str(revision)?;
        }
        Ok(Some(logout))
    }

    pub(crate) fn logout_revision(&self) -> Result<Option<String>> {
        Ok(self.logout_file()?.map(|logout| logout.revision))
    }

    pub(crate) fn was_logged_out(&self) -> Result<bool> {
        let Some(logout) = self.logout_file()? else {
            return Ok(false);
        };
        Ok(self.active_revision()? == logout.active_revision)
    }

    pub(crate) fn active_state(&self) -> Result<&'static str> {
        let Some(account) = self.load_active()? else {
            return Ok("signed_out");
        };
        if self.was_logged_out()? {
            return Ok("signed_out");
        }
        Ok(account.state())
    }

    pub(crate) fn state_for(&self, client_id: &str) -> Result<&'static str> {
        let account = self.load(client_id)?;
        if self
            .load_active()?
            .is_some_and(|active| active.client_id == client_id)
            && self.was_logged_out()?
        {
            return Ok("signed_out");
        }
        Ok(account.state())
    }

    pub(crate) fn record_logout_unlocked(&self) -> Result<()> {
        self.ensure_directories()?;
        let logout = LogoutFile {
            revision: Uuid::new_v4().to_string(),
            active_revision: self.active_revision()?,
        };
        crate::private::write(
            &self.root.join(LOGOUT_FILE),
            &serde_json::to_vec(&logout)?,
            0o600,
        )?;
        Ok(())
    }

    pub(crate) fn provisional_client_id(&self) -> Result<Option<String>> {
        let bytes = match crate::private::read(&self.root.join(PROVISIONAL_FILE), MAX_ACTIVE_BYTES)
        {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error.into()),
        };
        let client_id: Option<String> = serde_json::from_slice(&bytes)?;
        if let Some(client_id) = &client_id {
            validate_client_id(client_id)?;
        }
        Ok(client_id)
    }

    pub(crate) async fn remember_provisional_client(&self, client_id: &str) -> Result<()> {
        validate_client_id(client_id)?;
        let _lock = self.lock("provisional-registration").await?;
        crate::private::write(
            &self.root.join(PROVISIONAL_FILE),
            &serde_json::to_vec(client_id)?,
            0o600,
        )?;
        Ok(())
    }

    pub(crate) async fn forget_provisional_client(&self, client_id: &str) -> Result<()> {
        let _lock = self.lock("provisional-registration").await?;
        if self.provisional_client_id()?.as_deref() == Some(client_id) {
            crate::private::write(&self.root.join(PROVISIONAL_FILE), b"null", 0o600)?;
        }
        Ok(())
    }

    pub(crate) fn ensure_directories(&self) -> Result<()> {
        crate::private::directory(&self.root)?;
        crate::private::directory(&self.accounts_dir())?;
        Ok(())
    }

    fn accounts_dir(&self) -> PathBuf {
        self.root.join(ACCOUNTS_DIR)
    }

    pub(crate) fn account_path(&self, client_id: &str) -> PathBuf {
        let mut digest = Sha256::new();
        digest.update(client_id.as_bytes());
        let mut hex = String::with_capacity(64);
        for byte in digest.finalize() {
            use std::fmt::Write;
            let _ = write!(hex, "{byte:02x}");
        }
        self.accounts_dir().join(format!("{hex}.json"))
    }

    pub(crate) fn load_active(&self) -> Result<Option<StoredAccount>> {
        let active_path = self.root.join(ACTIVE_FILE);
        let bytes = match crate::private::read(&active_path, MAX_ACTIVE_BYTES) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(error) => {
                return Err(error)
                    .with_context(|| format!("Could not read {}", active_path.display()));
            }
        };
        let active: ActiveFile = serde_json::from_slice(&bytes)
            .with_context(|| format!("Could not parse {}", active_path.display()))?;
        self.load(&active.client_id).map(Some)
    }

    pub(crate) fn active_revision(&self) -> Result<Option<String>> {
        let active_path = self.root.join(ACTIVE_FILE);
        let bytes = match crate::private::read(&active_path, MAX_ACTIVE_BYTES) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(error) => {
                return Err(error)
                    .with_context(|| format!("Could not read {}", active_path.display()));
            }
        };
        let active: ActiveFile = serde_json::from_slice(&bytes)
            .with_context(|| format!("Could not parse {}", active_path.display()))?;
        let Some(activation_id) = active.activation_id else {
            return Ok(None);
        };
        Uuid::parse_str(&activation_id)
            .with_context(|| format!("Could not parse {}", active_path.display()))?;
        Ok(Some(activation_id))
    }

    pub(crate) fn load(&self, client_id: &str) -> Result<StoredAccount> {
        validate_client_id(client_id)?;
        let path = self.account_path(client_id);
        let bytes = crate::private::read(&path, MAX_ACCOUNT_BYTES)
            .with_context(|| format!("Could not read {}", path.display()))?;
        let account: StoredAccount = serde_json::from_slice(&bytes)
            .with_context(|| format!("Could not parse {}", path.display()))?;
        if account.client_id != client_id
            || account.subject.is_empty()
            || account.ext_agent_host_id.is_empty()
        {
            bail!("The ChatGPT registration file does not match its record.");
        }
        Ok(account)
    }

    pub(crate) fn load_if_exists(&self, client_id: &str) -> Result<Option<StoredAccount>> {
        validate_client_id(client_id)?;
        let path = self.account_path(client_id);
        let bytes = match crate::private::read(&path, MAX_ACCOUNT_BYTES) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(error) => {
                return Err(error).with_context(|| format!("Could not read {}", path.display()));
            }
        };
        let account: StoredAccount = serde_json::from_slice(&bytes)
            .with_context(|| format!("Could not parse {}", path.display()))?;
        if account.client_id != client_id
            || account.subject.is_empty()
            || account.ext_agent_host_id.is_empty()
        {
            bail!("The ChatGPT registration file does not match its record.");
        }
        Ok(Some(account))
    }

    #[cfg(test)]
    pub(crate) fn save(&self, account: &StoredAccount) -> Result<()> {
        validate_client_id(&account.client_id)?;
        self.ensure_directories()?;
        let _lock = RecordLock::acquire(&self.account_path(&account.client_id))?;
        self.save_unlocked(account)
    }

    pub(crate) fn save_unlocked(&self, account: &StoredAccount) -> Result<()> {
        self.ensure_directories()?;
        self.save_record_unlocked(account)?;
        self.activate_unlocked(&account.client_id)
    }

    pub(crate) fn save_record_unlocked(&self, account: &StoredAccount) -> Result<()> {
        validate_client_id(&account.client_id)?;
        self.ensure_directories()?;
        let path = self.account_path(&account.client_id);
        let bytes = serde_json::to_vec_pretty(account)?;
        if bytes.len() > MAX_ACCOUNT_BYTES {
            bail!("The ChatGPT registration file is too large.");
        }
        crate::private::write(&path, &bytes, 0o600)
            .with_context(|| format!("Could not save {}", path.display()))?;
        Ok(())
    }

    fn activate_unlocked(&self, client_id: &str) -> Result<()> {
        validate_client_id(client_id)?;
        let active = ActiveFile {
            client_id: client_id.to_owned(),
            activation_id: Some(Uuid::new_v4().to_string()),
        };
        let bytes = serde_json::to_vec(&active)?;
        if bytes.len() > MAX_ACTIVE_BYTES {
            bail!("The ChatGPT active registration file is too large.");
        }
        crate::private::write(&self.root.join(ACTIVE_FILE), &bytes, 0o600)?;
        Ok(())
    }

    pub(crate) async fn clear_new_registration(&self, client_id: &str) -> Result<StoredAccount> {
        let _lock = self.lock(client_id).await?;
        let mut account = self.load(client_id)?;
        if account.new_registration {
            account.new_registration = false;
            self.save_record_unlocked(&account)?;
        }
        Ok(account)
    }

    pub(crate) async fn lock(&self, client_id: &str) -> Result<RecordLock> {
        validate_client_id(client_id)?;
        self.ensure_directories()?;
        self.lock_path(&self.account_path(client_id)).await
    }

    pub(crate) async fn session_lock(&self) -> Result<RecordLock> {
        self.ensure_directories()?;
        self.lock_path(&self.root.join("session-transition.json"))
            .await
    }

    async fn lock_path(&self, path: &Path) -> Result<RecordLock> {
        let lock = RecordLock::open(path)?;
        for _ in 0..120 {
            match lock.file.try_lock() {
                Ok(()) => return Ok(lock),
                Err(std::fs::TryLockError::WouldBlock) => {
                    tokio::time::sleep(Duration::from_millis(25)).await
                }
                Err(std::fs::TryLockError::Error(error)) => return Err(error.into()),
            }
        }
        bail!("Timed out waiting for the ChatGPT registration lock.")
    }
}

fn validate_client_id(client_id: &str) -> Result<()> {
    if client_id.is_empty()
        || client_id.len() > 512
        || client_id == "dynamic_agent_client"
        || client_id.bytes().any(|byte| byte.is_ascii_control())
    {
        bail!("Invalid ChatGPT client identifier.");
    }
    Ok(())
}

pub(crate) struct RecordLock {
    file: File,
}

impl RecordLock {
    fn open(path: &Path) -> Result<Self> {
        let lock = path.with_extension("lock");
        if let Ok(metadata) = fs::symlink_metadata(&lock)
            && metadata.file_type().is_symlink()
        {
            bail!("The ChatGPT registration lock cannot be a symlink.");
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
        let file = options.open(lock)?;
        let metadata = file.metadata()?;
        if !metadata.is_file() {
            bail!("The ChatGPT registration lock is not a regular file.");
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            if metadata.uid() != unsafe { libc::geteuid() }
                || metadata.mode() & 0o077 != 0
                || metadata.nlink() != 1
            {
                bail!("The ChatGPT registration lock is not private to this account.");
            }
        }
        Ok(Self { file })
    }

    #[cfg(test)]
    fn acquire(path: &Path) -> Result<Self> {
        let lock = Self::open(path)?;
        for _ in 0..120 {
            match lock.file.try_lock() {
                Ok(()) => return Ok(lock),
                Err(std::fs::TryLockError::WouldBlock) => {
                    std::thread::sleep(Duration::from_millis(25))
                }
                Err(std::fs::TryLockError::Error(error)) => return Err(error.into()),
            }
        }
        bail!("Timed out waiting for the ChatGPT registration lock.")
    }
}

impl Drop for RecordLock {
    fn drop(&mut self) {
        let _ = self.file.unlock();
    }
}

pub(crate) fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn maximum_length_client_id_survives_active_record_serialization() {
        let dir = tempdir().unwrap();
        let store = Store::for_test(dir.path());
        let client_id = "c".repeat(512);
        store.save(&account(&client_id)).unwrap();
        assert_eq!(store.load_active().unwrap().unwrap().client_id, client_id);
        assert!(store.active_revision().unwrap().is_some());
    }

    fn account(client_id: &str) -> StoredAccount {
        StoredAccount {
            email: Some("person@example.test".to_owned()),
            issuer: "https://auth.openai.com".to_owned(),
            subject: "subject".to_owned(),
            client_id: client_id.to_owned(),
            ext_agent_host_id: "urn:uuid:123e4567-e89b-12d3-a456-426614174000".to_owned(),
            id_token: Some("id".to_owned()),
            access_token: Some("access".to_owned()),
            refresh_token: Some("refresh".to_owned()),
            token_type: "Bearer".to_owned(),
            expires_at: Some(now_secs() + 3600),
            earliest_refresh_at: None,
            scopes: vec!["chatgpt.tokens.use.direct".to_owned()],
            saved_at: now_secs(),
            label: Some("person@example.test".to_owned()),
            state: None,
            new_registration: false,
        }
    }

    #[test]
    fn records_are_keyed_by_client_and_active_pointer_is_private() {
        let dir = tempdir().unwrap();
        let store = Store::for_test(dir.path());
        let one = account("client-one");
        let two = account("client-two");
        store.save(&one).unwrap();
        store.save(&two).unwrap();
        assert_eq!(
            store.load_active().unwrap().unwrap().client_id,
            "client-two"
        );
        assert_eq!(
            store.load("client-one").unwrap().email.as_deref(),
            Some("person@example.test")
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = fs::metadata(store.account_path("client-two"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777;
            assert_eq!(mode, 0o600);
        }
    }

    #[test]
    fn activation_revision_changes_only_when_active_pointer_is_replaced() {
        let dir = tempdir().unwrap();
        let store = Store::for_test(dir.path());
        let one = account("client-one");
        store.save(&one).unwrap();
        let first = store.active_revision().unwrap().unwrap();
        assert!(Uuid::parse_str(&first).is_ok());

        store.save_record_unlocked(&one).unwrap();
        assert_eq!(store.active_revision().unwrap().unwrap(), first);

        store.save(&one).unwrap();
        let second = store.active_revision().unwrap().unwrap();
        assert_ne!(first, second);

        crate::private::write(
            &store.root().join(ACTIVE_FILE),
            br#"{"clientId":"client-one"}"#,
            0o600,
        )
        .unwrap();
        assert_eq!(store.active_revision().unwrap(), None);
    }

    #[test]
    fn token_clear_keeps_registration_mapping() {
        let mut value = account("client");
        value.clear_tokens("reconnect");
        assert_eq!(value.client_id, "client");
        assert_eq!(value.state(), "reconnect");
        assert!(value.refresh_token.is_none());
    }
}
