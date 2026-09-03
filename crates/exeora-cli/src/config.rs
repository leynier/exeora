use anyhow::{Context, Result};
use atomic_write_file::AtomicWriteFile;
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    env, fs,
    io::Write,
    path::{Path, PathBuf},
};

pub const DEFAULT_GATEWAY: &str = "https://exeora.dev";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectEntry {
    pub id: String,
    pub slug: String,
    pub name: String,
    pub root: PathBuf,
}

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum WorkspaceSyncState {
    PendingUpsert,
    #[default]
    Active,
    PendingDelete,
    Disabled,
    Removing,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceEntry {
    pub id: String,
    pub project_id: String,
    pub slug: String,
    pub name: String,
    #[serde(default)]
    pub branch: Option<String>,
    pub git_root: PathBuf,
    pub root: PathBuf,
    #[serde(default)]
    pub managed: bool,
    #[serde(default)]
    pub sync_state: WorkspaceSyncState,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StarPrompt {
    pub runs: u64,
    pub ask_at: u64,
    pub asked: u64,
    pub done: bool,
}

impl Default for StarPrompt {
    fn default() -> Self {
        Self {
            runs: 0,
            ask_at: 3,
            asked: 0,
            done: false,
        }
    }
}

/// One MCP server Exeora can connect to and re-expose through its own MCP endpoint.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct McpServerConfig {
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub command: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub args: Vec<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub env: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub headers: BTreeMap<String, String>,
}

const fn default_true() -> bool {
    true
}

impl Default for McpServerConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            command: None,
            args: Vec::new(),
            env: BTreeMap::new(),
            url: None,
            headers: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigData {
    #[serde(default = "default_gateway")]
    pub gateway_url: String,
    #[serde(default)]
    pub device_id: Option<String>,
    #[serde(default)]
    pub device_name: Option<String>,
    #[serde(default)]
    pub projects: Vec<ProjectEntry>,
    #[serde(default)]
    pub workspaces: Vec<WorkspaceEntry>,
    #[serde(default)]
    pub workspace_root: Option<PathBuf>,
    /// User-wide MCP servers. A project may override or disable one by name in exeora.toml.
    #[serde(default)]
    pub mcp_servers: BTreeMap<String, McpServerConfig>,
    #[serde(default)]
    pub star: StarPrompt,
}

fn default_gateway() -> String {
    DEFAULT_GATEWAY.to_owned()
}

impl Default for ConfigData {
    fn default() -> Self {
        Self {
            gateway_url: env::var("EXEORA_GATEWAY_URL").unwrap_or_else(|_| default_gateway()),
            device_id: None,
            device_name: None,
            projects: Vec::new(),
            workspaces: Vec::new(),
            workspace_root: None,
            mcp_servers: BTreeMap::new(),
            star: StarPrompt::default(),
        }
    }
}

#[derive(Debug)]
pub struct ConfigStore {
    path: PathBuf,
    data: ConfigData,
}

impl ConfigStore {
    pub fn load() -> Result<Self> {
        Self::load_from(config_path()?)
    }

    pub fn load_from(path: PathBuf) -> Result<Self> {
        let data = match fs::read(&path) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .with_context(|| format!("Could not parse {}", path.display()))?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => ConfigData::default(),
            Err(error) => {
                return Err(error).with_context(|| format!("Could not read {}", path.display()));
            }
        };
        Ok(Self { path, data })
    }

    pub fn path(&self) -> &Path {
        &self.path
    }
    pub fn data(&self) -> &ConfigData {
        &self.data
    }
    pub fn data_mut(&mut self) -> &mut ConfigData {
        &mut self.data
    }

    pub fn gateway_url(&self) -> String {
        env::var("EXEORA_GATEWAY_URL").unwrap_or_else(|_| self.data.gateway_url.clone())
    }

    pub fn gateway_source(&self) -> &'static str {
        if env::var_os("EXEORA_GATEWAY_URL").is_some() {
            "env"
        } else if self.data.gateway_url == DEFAULT_GATEWAY {
            "default"
        } else {
            "config"
        }
    }

    pub fn workspace_root(&self) -> Result<PathBuf> {
        if let Some(path) = env::var_os("EXEORA_WORKSPACE_ROOT") {
            return absolute_path(PathBuf::from(path));
        }
        if let Some(path) = &self.data.workspace_root {
            return absolute_path(path.clone());
        }
        default_workspace_root()
    }

    pub fn workspace_root_source(&self) -> &'static str {
        if env::var_os("EXEORA_WORKSPACE_ROOT").is_some() {
            "env"
        } else if self.data.workspace_root.is_some() {
            "config"
        } else {
            "default"
        }
    }

    pub fn find_project(&self, id: &str) -> Option<&ProjectEntry> {
        self.data.projects.iter().find(|entry| entry.id == id)
    }

    pub fn upsert_project(&mut self, project: ProjectEntry) {
        self.data.projects.retain(|entry| entry.id != project.id);
        self.data.projects.push(project);
    }

    pub fn remove_project(&mut self, id: &str) {
        self.data.projects.retain(|entry| entry.id != id);
        self.data.workspaces.retain(|entry| entry.project_id != id);
    }

    pub fn upsert_workspace(&mut self, workspace: WorkspaceEntry) {
        self.data
            .workspaces
            .retain(|entry| entry.id != workspace.id);
        self.data.workspaces.push(workspace);
    }

    pub fn remove_workspace(&mut self, id: &str) {
        self.data.workspaces.retain(|entry| entry.id != id);
    }

    pub fn forget_local_state(&mut self) {
        self.data.device_id = None;
        self.data.device_name = None;
        self.data.projects.clear();
        self.data.workspaces.clear();
    }

    pub fn save(&self) -> Result<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        let _lock = ConfigLock::acquire(&self.path)?;
        let mut file = AtomicWriteFile::options()
            .open(&self.path)
            .with_context(|| format!("Could not open {}", self.path.display()))?;
        file.write_all(&serde_json::to_vec_pretty(&self.data)?)?;
        file.write_all(b"\n")?;
        file.commit()
            .with_context(|| format!("Could not save {}", self.path.display()))?;
        Ok(())
    }
}

struct ConfigLock(PathBuf);

impl ConfigLock {
    fn acquire(config: &Path) -> Result<Self> {
        let lock = config.with_extension("lock");
        for _ in 0..100 {
            match fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&lock)
            {
                Ok(_) => return Ok(Self(lock)),
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                    let stale = fs::metadata(&lock)
                        .and_then(|metadata| metadata.modified())
                        .ok()
                        .and_then(|modified| modified.elapsed().ok())
                        .is_some_and(|age| age.as_secs() >= 30);
                    if stale {
                        let _ = fs::remove_file(&lock);
                    } else {
                        std::thread::sleep(std::time::Duration::from_millis(20));
                    }
                }
                Err(error) => return Err(error.into()),
            }
        }
        anyhow::bail!("Timed out waiting to update {}", config.display())
    }
}

impl Drop for ConfigLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

fn absolute_path(path: PathBuf) -> Result<PathBuf> {
    if path.is_absolute() {
        Ok(path)
    } else {
        Ok(env::current_dir()?.join(path))
    }
}

pub fn default_workspace_root() -> Result<PathBuf> {
    #[cfg(target_os = "windows")]
    {
        let base = env::var_os("LOCALAPPDATA")
            .or_else(|| env::var_os("APPDATA"))
            .context("Neither LOCALAPPDATA nor APPDATA is set")?;
        return Ok(PathBuf::from(base).join("Exeora/workspaces"));
    }
    #[cfg(target_os = "macos")]
    {
        let home = home_dir()?;
        return Ok(home.join("Library/Application Support/Exeora/workspaces"));
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let base = env::var_os("XDG_DATA_HOME")
            .map(PathBuf::from)
            .unwrap_or(home_dir()?.join(".local/share"));
        Ok(base.join("exeora/workspaces"))
    }
}

pub fn config_path() -> Result<PathBuf> {
    if let Some(path) = env::var_os("EXEORA_CONFIG_PATH") {
        return Ok(PathBuf::from(path));
    }

    #[cfg(target_os = "windows")]
    {
        let base = env::var_os("APPDATA")
            .or_else(|| env::var_os("USERPROFILE"))
            .context("Neither APPDATA nor USERPROFILE is set")?;
        return Ok(PathBuf::from(base).join("exeora/config.json"));
    }
    #[cfg(target_os = "macos")]
    {
        return Ok(home_dir()?.join("Library/Preferences/exeora/config.json"));
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let base = env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .unwrap_or(home_dir()?.join(".config"));
        Ok(base.join("exeora/config.json"))
    }
}

pub fn credential_fallback_path() -> Result<PathBuf> {
    if let Some(path) = env::var_os("EXEORA_CREDENTIAL_PATH") {
        return Ok(PathBuf::from(path));
    }
    #[cfg(target_os = "windows")]
    let base = env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .unwrap_or(home_dir()?);
    #[cfg(not(target_os = "windows"))]
    let base = env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .unwrap_or(home_dir()?.join(".config"));
    Ok(base.join("exeora/credentials.json"))
}

fn home_dir() -> Result<PathBuf> {
    env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
        .map(PathBuf::from)
        .context("Could not determine the home directory")
}
