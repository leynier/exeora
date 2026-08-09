use anyhow::{Context, Result};
use atomic_write_file::AtomicWriteFile;
use serde::{Deserialize, Serialize};
use std::{
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

    pub fn find_project(&self, id: &str) -> Option<&ProjectEntry> {
        self.data.projects.iter().find(|entry| entry.id == id)
    }

    pub fn upsert_project(&mut self, project: ProjectEntry) {
        self.data.projects.retain(|entry| entry.id != project.id);
        self.data.projects.push(project);
    }

    pub fn remove_project(&mut self, id: &str) {
        self.data.projects.retain(|entry| entry.id != id);
    }

    pub fn forget_local_state(&mut self) {
        self.data.device_id = None;
        self.data.device_name = None;
        self.data.projects.clear();
    }

    pub fn save(&self) -> Result<()> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
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

pub fn config_path() -> Result<PathBuf> {
    if let Some(path) = env::var_os("EXEORA_CONFIG_PATH") {
        return Ok(PathBuf::from(path));
    }

    #[cfg(target_os = "windows")]
    {
        let base = env::var_os("APPDATA")
            .or_else(|| env::var_os("USERPROFILE"))
            .context("Neither APPDATA nor USERPROFILE is set")?;
        return Ok(PathBuf::from(base).join("exeora-nodejs/Config/config.json"));
    }
    #[cfg(target_os = "macos")]
    {
        return Ok(home_dir()?.join("Library/Preferences/exeora-nodejs/config.json"));
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let base = env::var_os("XDG_CONFIG_HOME")
            .map(PathBuf::from)
            .unwrap_or(home_dir()?.join(".config"));
        Ok(base.join("exeora-nodejs/config.json"))
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
