use crate::policy::POLICY_FILENAME;
use anyhow::{Context, Result, anyhow, bail};
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    env, fs,
    path::{Path, PathBuf},
};

/// The file, next to `config.json`, that lists the user's own MCP servers.
pub const MCP_CONFIG_FILENAME: &str = "mcp.json";

/// One upstream MCP server Exeora connects to and re-exposes.
///
/// The ecosystem's `mcpServers` entry shape, so an existing entry can be
/// pasted in, plus `enabled`. Unknown keys such as `type` are ignored: the
/// transport is decided by whether the entry has a `command` or a `url`.
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

/// `mcp.json`: the servers this user runs, and whether projects may add more.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpUserConfig {
    #[serde(default)]
    pub mcp_servers: BTreeMap<String, McpServerConfig>,
    /// Whether `[mcp.servers.*]` in a project's `exeora.toml` is loaded.
    ///
    /// Off by default because that file travels with the repository: loading
    /// it would let anyone who can commit to a project start processes on this
    /// machine, and nothing else in `exeora.toml` can do that.
    #[serde(default)]
    pub trust_project_servers: bool,
}

impl McpUserConfig {
    /// Reads `mcp.json` beside the CLI's own config. A missing file is no servers.
    pub fn load(config_path: &Path) -> Result<Self> {
        let path = user_config_path(config_path);
        match fs::read_to_string(&path) {
            Ok(text) => serde_json::from_str(&text)
                .with_context(|| format!("{} is not valid MCP configuration", path.display())),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(error) => Err(error).with_context(|| format!("Could not read {}", path.display())),
        }
    }
}

pub fn user_config_path(config_path: &Path) -> PathBuf {
    config_path.with_file_name(MCP_CONFIG_FILENAME)
}

/// Where a server's definition came from, which decides what it may do.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServerOrigin {
    /// `mcp.json`, written by the person running the CLI.
    User,
    /// A project's `exeora.toml`, admitted only with `trustProjectServers`.
    Project,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ResolvedServer {
    pub config: McpServerConfig,
    pub origin: ServerOrigin,
}

impl ResolvedServer {
    /// A value with `${VAR}` replaced from this process's environment.
    ///
    /// Only for the user's own configuration. A project file expanding
    /// variables could send `${GITHUB_TOKEN}` to any URL it names.
    pub fn expand(&self, value: &str) -> Result<String> {
        match self.origin {
            ServerOrigin::User => expand_env(value),
            ServerOrigin::Project => Ok(value.to_owned()),
        }
    }
}

#[derive(Debug, Default, Deserialize)]
struct ProjectConfigFile {
    #[serde(default)]
    mcp: ProjectMcpConfig,
}

#[derive(Debug, Default, Deserialize)]
struct ProjectMcpConfig {
    #[serde(default)]
    servers: BTreeMap<String, ProjectServerEntry>,
}

/// A project entry. Every field is optional so `enabled = false` alone can
/// switch a user server off for one project, which needs no trust: it only
/// ever narrows what runs.
#[derive(Debug, Default, Deserialize)]
struct ProjectServerEntry {
    enabled: Option<bool>,
    command: Option<String>,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default)]
    env: BTreeMap<String, String>,
    url: Option<String>,
    #[serde(default)]
    headers: BTreeMap<String, String>,
}

impl ProjectServerEntry {
    fn defines_server(&self) -> bool {
        self.command.is_some() || self.url.is_some()
    }
}

/// The servers one project runs: the user's, overridden or disabled by name
/// in the project's `exeora.toml`.
///
/// Returns warnings rather than failing, so one project's broken file costs
/// that project its project-level servers and nothing else.
pub fn effective_servers(
    user: &McpUserConfig,
    root: &Path,
) -> (BTreeMap<String, ResolvedServer>, Vec<String>) {
    let mut warnings = Vec::new();
    let mut servers: BTreeMap<String, ResolvedServer> = user
        .mcp_servers
        .iter()
        .map(|(name, config)| {
            let resolved = ResolvedServer {
                config: config.clone(),
                origin: ServerOrigin::User,
            };
            (name.clone(), resolved)
        })
        .collect();

    let path = root.join(POLICY_FILENAME);
    let project = match fs::read_to_string(&path) {
        Ok(text) => match toml::from_str::<ProjectConfigFile>(&text) {
            Ok(file) => file.mcp.servers,
            Err(error) => {
                warnings.push(format!(
                    "{} has invalid MCP servers: {error}",
                    path.display()
                ));
                BTreeMap::new()
            }
        },
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => BTreeMap::new(),
        Err(error) => {
            warnings.push(format!("Could not read {}: {error}", path.display()));
            BTreeMap::new()
        }
    };

    let mut skipped = Vec::new();
    for (name, entry) in project {
        if entry.defines_server() {
            if !user.trust_project_servers {
                skipped.push(name);
                continue;
            }
            let config = McpServerConfig {
                enabled: entry.enabled.unwrap_or(true),
                command: entry.command,
                args: entry.args,
                env: entry.env,
                url: entry.url,
                headers: entry.headers,
            };
            servers.insert(
                name,
                ResolvedServer {
                    config,
                    origin: ServerOrigin::Project,
                },
            );
        } else if entry.enabled == Some(false) {
            servers.remove(&name);
        }
    }
    if !skipped.is_empty() {
        warnings.push(format!(
            "{} defines MCP servers ({}) that were not started. Set \"trustProjectServers\": true in {MCP_CONFIG_FILENAME} to allow project files to start servers.",
            path.display(),
            skipped.join(", ")
        ));
    }

    servers.retain(|_, server| server.config.enabled);
    (servers, warnings)
}

pub fn validate_server(name: &str, config: &McpServerConfig) -> Result<()> {
    if name.is_empty() || name.len() > 64 {
        bail!("MCP server names must contain 1-64 characters");
    }
    match (&config.command, &config.url) {
        (Some(_), None) => Ok(()),
        (None, Some(_)) => {
            if !config.args.is_empty() || !config.env.is_empty() {
                bail!(
                    "HTTP MCP server `{name}` cannot define command args or environment variables"
                );
            }
            Ok(())
        }
        (Some(_), Some(_)) => {
            bail!("MCP server `{name}` must define either command or url, not both")
        }
        (None, None) => bail!("MCP server `{name}` must define command or url"),
    }
}

pub fn expand_env(value: &str) -> Result<String> {
    let mut output = String::with_capacity(value.len());
    let mut rest = value;
    while let Some(start) = rest.find("${") {
        output.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        let end = after
            .find('}')
            .ok_or_else(|| anyhow!("Unclosed environment variable in MCP configuration"))?;
        let name = &after[..end];
        if name.is_empty() {
            bail!("Empty environment variable in MCP configuration");
        }
        let replacement =
            env::var(name).with_context(|| format!("Environment variable `{name}` is not set"))?;
        output.push_str(&replacement);
        rest = &after[end + 1..];
    }
    output.push_str(rest);
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    fn stdio(command: &str) -> McpServerConfig {
        McpServerConfig {
            command: Some(command.to_owned()),
            ..Default::default()
        }
    }

    fn user(trust: bool) -> McpUserConfig {
        let mut servers = BTreeMap::new();
        servers.insert("shared".to_owned(), stdio("global"));
        servers.insert("kept".to_owned(), stdio("kept"));
        McpUserConfig {
            mcp_servers: servers,
            trust_project_servers: trust,
        }
    }

    const PROJECT_FILE: &str = "mode = \"allow_all\"\n\n[mcp.servers.shared]\ncommand = \"project\"\n\n[mcp.servers.kept]\nenabled = false\n\n[mcp.servers.extra]\nurl = \"https://example.com/mcp\"\n";

    #[test]
    fn reads_the_ecosystem_shape_from_mcp_json() {
        let dir = tempdir().expect("tempdir");
        let config_path = dir.path().join("config.json");
        fs::write(
            dir.path().join(MCP_CONFIG_FILENAME),
            r#"{"mcpServers":{"fs":{"type":"stdio","command":"npx","args":["-y","server"],"env":{"A":"b"}},"web":{"url":"https://example.com/mcp","enabled":false}},"trustProjectServers":true}"#,
        )
        .expect("write");

        let loaded = McpUserConfig::load(&config_path).expect("config");
        assert!(loaded.trust_project_servers);
        assert_eq!(loaded.mcp_servers["fs"].args, ["-y", "server"]);
        assert!(!loaded.mcp_servers["web"].enabled);
        assert!(
            McpUserConfig::load(&dir.path().join("missing").join("config.json"))
                .expect("missing file")
                .mcp_servers
                .is_empty()
        );
    }

    #[test]
    fn untrusted_project_files_can_only_disable_servers() {
        let dir = tempdir().expect("tempdir");
        fs::write(dir.path().join(POLICY_FILENAME), PROJECT_FILE).expect("write");

        let (servers, warnings) = effective_servers(&user(false), dir.path());
        assert_eq!(servers.len(), 1);
        assert_eq!(servers["shared"].config.command.as_deref(), Some("global"));
        assert_eq!(servers["shared"].origin, ServerOrigin::User);
        assert_eq!(warnings.len(), 1);
        assert!(warnings[0].contains("extra, shared"));
        assert!(warnings[0].contains("trustProjectServers"));
    }

    #[test]
    fn trusted_project_files_override_and_add_servers() {
        let dir = tempdir().expect("tempdir");
        fs::write(dir.path().join(POLICY_FILENAME), PROJECT_FILE).expect("write");

        let (servers, warnings) = effective_servers(&user(true), dir.path());
        assert!(warnings.is_empty());
        assert_eq!(
            servers.keys().map(String::as_str).collect::<Vec<_>>(),
            ["extra", "shared"]
        );
        assert_eq!(servers["shared"].config.command.as_deref(), Some("project"));
        assert_eq!(servers["shared"].origin, ServerOrigin::Project);
    }

    #[test]
    fn only_user_servers_expand_environment_variables() {
        // PATH is set on every platform the tests run on, so nothing has to
        // mutate the process environment under parallel tests.
        let path = env::var("PATH").expect("PATH is set");
        let user = ResolvedServer {
            config: stdio("x"),
            origin: ServerOrigin::User,
        };
        let project = ResolvedServer {
            origin: ServerOrigin::Project,
            ..user.clone()
        };
        assert_eq!(
            user.expand("Bearer ${PATH}").expect("expand"),
            format!("Bearer {path}")
        );
        assert_eq!(
            project.expand("Bearer ${PATH}").expect("verbatim"),
            "Bearer ${PATH}"
        );
        assert!(expand_env("${EXEORA_MCP_TEST_UNSET_VARIABLE}").is_err());
    }

    #[test]
    fn validates_transport_shape() {
        let mut both = stdio("npx");
        both.url = Some("https://example.com/mcp".to_owned());
        assert!(validate_server("bad", &both).is_err());

        let remote = McpServerConfig {
            url: Some("https://example.com/mcp".to_owned()),
            args: vec!["nope".to_owned()],
            ..Default::default()
        };
        assert!(validate_server("remote", &remote).is_err());
        assert!(validate_server("", &stdio("npx")).is_err());
    }
}
