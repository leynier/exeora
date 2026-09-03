use crate::{
    CLI_VERSION,
    config::{ConfigStore, McpServerConfig, ProjectEntry},
};
use anyhow::{Context, Result, anyhow, bail};
use http::{HeaderName, HeaderValue, header::AUTHORIZATION};
use rmcp::{
    ClientLifecycleMode, ClientServiceExt,
    model::{
        CallToolRequestParams, ClientCapabilities, ClientInfo, Implementation, ProtocolVersion,
    },
    service::{RoleClient, RunningService},
    transport::{
        StreamableHttpClientTransport, TokioChildProcess,
        streamable_http_client::StreamableHttpClientTransportConfig,
    },
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, HashMap, HashSet},
    env, fs,
    path::{Path, PathBuf},
    sync::Arc,
};
use tokio::{process::Command, sync::Mutex};

const MAX_MCP_TOOLS_PER_PROJECT: usize = 256;
const MAX_MCP_CATALOG_BYTES: usize = 1_500_000;
const MAX_EXPOSED_NAME_LEN: usize = 128;

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpToolDescriptor {
    pub exposed_name: String,
    pub server: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub input_schema: Value,
}

#[derive(Debug, Default, Deserialize)]
struct ProjectConfigFile {
    #[serde(default)]
    mcp: ProjectMcpConfig,
}

#[derive(Debug, Default, Deserialize)]
struct ProjectMcpConfig {
    #[serde(default)]
    servers: BTreeMap<String, McpServerConfig>,
}

#[derive(Debug, Clone, Hash, PartialEq, Eq)]
struct ClientKey {
    project_id: String,
    root: PathBuf,
    server: String,
}

type McpClient = RunningService<RoleClient, ClientInfo>;

/// Upstream MCP client pool owned by `exeora connect`.
///
/// Project roots are connected eagerly so their tool catalog can be advertised
/// immediately. Workspace-specific stdio clients are opened lazily, preserving
/// the selected workspace as the child process working directory without
/// multiplying idle MCP processes.
pub struct McpManager {
    servers: HashMap<String, BTreeMap<String, McpServerConfig>>,
    catalogs: HashMap<String, Vec<McpToolDescriptor>>,
    clients: Mutex<HashMap<ClientKey, Arc<McpClient>>>,
    warnings: Vec<String>,
}

impl McpManager {
    pub async fn load(config: &ConfigStore, projects: &[ProjectEntry]) -> Self {
        let mut manager = Self {
            servers: HashMap::new(),
            catalogs: HashMap::new(),
            clients: Mutex::new(HashMap::new()),
            warnings: Vec::new(),
        };

        for project in projects {
            let servers = match effective_servers(&config.data().mcp_servers, &project.root) {
                Ok(servers) => servers,
                Err(error) => {
                    manager.warnings.push(format!(
                        "Could not read MCP configuration for {}: {error}",
                        project.slug
                    ));
                    enabled_servers(&config.data().mcp_servers)
                }
            };
            manager.servers.insert(project.id.clone(), servers.clone());

            let mut discovered = Vec::new();
            for (server_name, server) in &servers {
                match manager
                    .connect_and_discover(project, &project.root, server_name, server)
                    .await
                {
                    Ok(mut tools) => discovered.append(&mut tools),
                    Err(error) => manager.warnings.push(format!(
                        "MCP server `{server_name}` for {} is unavailable: {error}",
                        project.slug
                    )),
                }
            }
            resolve_exposed_name_collisions(&mut discovered);
            if discovered.len() > MAX_MCP_TOOLS_PER_PROJECT {
                manager.warnings.push(format!(
                    "{} exposes more than {MAX_MCP_TOOLS_PER_PROJECT} MCP tools; only the first {MAX_MCP_TOOLS_PER_PROJECT} are published.",
                    project.slug
                ));
                discovered.truncate(MAX_MCP_TOOLS_PER_PROJECT);
            }
            discovered.sort_by(|a, b| a.exposed_name.cmp(&b.exposed_name));
            let discovered_count = discovered.len();
            discovered = bounded_catalog(discovered);
            if discovered.len() < discovered_count {
                manager.warnings.push(format!(
                    "{} has MCP tool schemas larger than the catalog budget; {} tool(s) were omitted.",
                    project.slug,
                    discovered_count - discovered.len()
                ));
            }
            manager.catalogs.insert(project.id.clone(), discovered);
        }
        manager
    }

    pub fn catalog(&self, project_id: &str) -> &[McpToolDescriptor] {
        self.catalogs.get(project_id).map_or(&[], Vec::as_slice)
    }

    pub fn warnings(&self) -> &[String] {
        &self.warnings
    }

    pub async fn kill_root(&self, root: &Path) {
        let root = fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
        let removed = {
            let mut clients = self.clients.lock().await;
            let keys = clients
                .keys()
                .filter(|key| key.root == root)
                .cloned()
                .collect::<Vec<_>>();
            keys.into_iter()
                .filter_map(|key| clients.remove(&key))
                .collect::<Vec<_>>()
        };
        for client in removed {
            client.cancellation_token().cancel();
        }
    }

    pub async fn call(
        &self,
        project: &ProjectEntry,
        root: &Path,
        server_name: &str,
        tool_name: &str,
        arguments: Value,
    ) -> Result<Value> {
        let configured = self
            .servers
            .get(&project.id)
            .and_then(|servers| servers.get(server_name))
            .ok_or_else(|| {
                anyhow!("MCP server `{server_name}` is not configured for this project")
            })?;
        let known = self
            .catalog(&project.id)
            .iter()
            .any(|tool| tool.server == server_name && tool.name == tool_name);
        if !known {
            bail!("MCP tool `{server_name}/{tool_name}` is not exposed for this project");
        }

        let client = self
            .client_for(project, root, server_name, configured)
            .await?;
        let args = match arguments {
            Value::Object(args) => args,
            Value::Null => Map::new(),
            _ => bail!("MCP tool arguments must be an object"),
        };
        let result = client
            .call_tool(CallToolRequestParams::new(tool_name.to_owned()).with_arguments(args))
            .await
            .with_context(|| format!("MCP tool `{server_name}/{tool_name}` failed"))?;
        serde_json::to_value(result).context("Could not encode the MCP tool result")
    }

    async fn connect_and_discover(
        &self,
        project: &ProjectEntry,
        root: &Path,
        server_name: &str,
        config: &McpServerConfig,
    ) -> Result<Vec<McpToolDescriptor>> {
        let client = self.client_for(project, root, server_name, config).await?;
        let tools = client
            .list_all_tools()
            .await
            .with_context(|| format!("Could not list tools from `{server_name}`"))?;

        tools
            .into_iter()
            .map(|tool| {
                let name = tool.name.to_string();
                Ok(McpToolDescriptor {
                    exposed_name: exposed_name(server_name, &name),
                    server: server_name.to_owned(),
                    name,
                    title: tool.title,
                    description: tool.description.map(|value| value.into_owned()),
                    input_schema: serde_json::to_value(&*tool.input_schema)
                        .context("Could not encode an upstream tool schema")?,
                })
            })
            .collect()
    }

    async fn client_for(
        &self,
        project: &ProjectEntry,
        root: &Path,
        server_name: &str,
        config: &McpServerConfig,
    ) -> Result<Arc<McpClient>> {
        let root = fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
        let key = ClientKey {
            project_id: project.id.clone(),
            root: root.clone(),
            server: server_name.to_owned(),
        };
        let mut clients = self.clients.lock().await;
        if let Some(client) = clients.get(&key)
            && !client.is_closed()
        {
            return Ok(client.clone());
        }

        validate_server(server_name, config)?;
        let client = Arc::new(connect_server(config, &root).await?);
        clients.insert(key, client.clone());
        Ok(client)
    }
}

fn bounded_catalog(tools: Vec<McpToolDescriptor>) -> Vec<McpToolDescriptor> {
    let mut bytes = 2usize;
    let mut kept = Vec::with_capacity(tools.len());
    for tool in tools {
        let encoded =
            serde_json::to_vec(&tool).map_or(MAX_MCP_CATALOG_BYTES + 1, |value| value.len());
        let next = bytes.saturating_add(encoded).saturating_add(1);
        if next > MAX_MCP_CATALOG_BYTES {
            continue;
        }
        bytes = next;
        kept.push(tool);
    }
    kept
}

async fn connect_server(config: &McpServerConfig, root: &Path) -> Result<McpClient> {
    let info = ClientInfo::new(
        ClientCapabilities::default(),
        Implementation::new("exeora", CLI_VERSION),
    );
    let lifecycle = || ClientLifecycleMode::Auto {
        preferred_versions: vec![ProtocolVersion::V_2026_07_28],
        legacy_version: Some(ProtocolVersion::V_2025_11_25),
    };

    if let Some(program) = &config.command {
        let mut command = Command::new(expand_env(program)?);
        command.current_dir(root);
        for arg in &config.args {
            command.arg(expand_env(arg)?);
        }
        for (key, value) in &config.env {
            command.env(key, expand_env(value)?);
        }
        let transport = TokioChildProcess::new(command).context("Could not start MCP server")?;
        return info
            .serve_with_lifecycle(transport, lifecycle())
            .await
            .context("Could not initialize stdio MCP server");
    }

    let url = expand_env(config.url.as_deref().context("MCP server has no URL")?)?;
    let mut headers = HashMap::new();
    let mut bearer = None;
    for (name, value) in &config.headers {
        let name = HeaderName::from_bytes(name.as_bytes())
            .with_context(|| format!("Invalid MCP HTTP header name `{name}`"))?;
        let value = expand_env(value)?;
        if name == AUTHORIZATION {
            bearer = value.strip_prefix("Bearer ").map(str::to_owned);
            if bearer.is_none() {
                bail!("MCP HTTP Authorization currently supports Bearer tokens only");
            }
            continue;
        }
        headers.insert(
            name,
            HeaderValue::from_str(&value).context("Invalid MCP HTTP header value")?,
        );
    }
    let mut transport_config = StreamableHttpClientTransportConfig::with_uri(url);
    if let Some(token) = bearer {
        transport_config = transport_config.auth_header(token);
    }
    if !headers.is_empty() {
        transport_config = transport_config.custom_headers(headers);
    }
    let transport = StreamableHttpClientTransport::from_config(transport_config);
    info.serve_with_lifecycle(transport, lifecycle())
        .await
        .context("Could not initialize HTTP MCP server")
}

fn effective_servers(
    global: &BTreeMap<String, McpServerConfig>,
    root: &Path,
) -> Result<BTreeMap<String, McpServerConfig>> {
    let mut servers = global.clone();
    let path = root.join("exeora.toml");
    match fs::read_to_string(&path) {
        Ok(text) => {
            let project: ProjectConfigFile = toml::from_str(&text)
                .with_context(|| format!("{} is not valid TOML", path.display()))?;
            for (name, config) in project.mcp.servers {
                servers.insert(name, config);
            }
        }
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(error).with_context(|| format!("Could not read {}", path.display()));
        }
    }
    Ok(enabled_servers(&servers))
}

fn enabled_servers(
    servers: &BTreeMap<String, McpServerConfig>,
) -> BTreeMap<String, McpServerConfig> {
    servers
        .iter()
        .filter(|(_, config)| config.enabled)
        .map(|(name, config)| (name.clone(), config.clone()))
        .collect()
}

fn validate_server(name: &str, config: &McpServerConfig) -> Result<()> {
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

fn exposed_name(server: &str, tool: &str) -> String {
    let server = sanitize_name(server);
    let tool = sanitize_name(tool);
    let base = format!("mcp__{server}__{tool}");
    if base.len() <= MAX_EXPOSED_NAME_LEN {
        return base;
    }
    with_hash_suffix(&base, server.as_bytes(), tool.as_bytes())
}

fn sanitize_name(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-') {
            out.push(char::from(byte));
        } else {
            out.push('_');
        }
    }
    if out.is_empty() {
        "unnamed".to_owned()
    } else {
        out
    }
}

fn resolve_exposed_name_collisions(tools: &mut [McpToolDescriptor]) {
    let mut counts = HashMap::<String, usize>::new();
    for tool in tools.iter() {
        *counts.entry(tool.exposed_name.clone()).or_default() += 1;
    }
    let mut used = HashSet::new();
    for tool in tools {
        let base = tool.exposed_name.clone();
        if counts.get(&base).copied().unwrap_or_default() > 1 || !used.insert(base.clone()) {
            tool.exposed_name =
                with_hash_suffix(&base, tool.server.as_bytes(), tool.name.as_bytes());
            used.insert(tool.exposed_name.clone());
        }
    }
}

fn with_hash_suffix(base: &str, server: &[u8], tool: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(server);
    hasher.update([0]);
    hasher.update(tool);
    let digest = format!("{:x}", hasher.finalize());
    let suffix = &digest[..10];
    let keep = MAX_EXPOSED_NAME_LEN - suffix.len() - 2;
    let prefix = &base[..base.len().min(keep)];
    format!("{prefix}__{suffix}")
}

fn expand_env(value: &str) -> Result<String> {
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
            enabled: true,
            command: Some(command.to_owned()),
            ..Default::default()
        }
    }

    #[test]
    fn project_servers_override_and_disable_global_servers() {
        let dir = tempdir().expect("tempdir");
        let mut global = BTreeMap::new();
        global.insert("shared".to_owned(), stdio("global"));
        global.insert("kept".to_owned(), stdio("kept"));
        fs::write(
            dir.path().join("exeora.toml"),
            "[mcp.servers.shared]\ncommand = \"project\"\n\n[mcp.servers.kept]\nenabled = false\n",
        )
        .expect("write");

        let effective = effective_servers(&global, dir.path()).expect("config");
        assert_eq!(effective.len(), 1);
        assert_eq!(effective["shared"].command.as_deref(), Some("project"));
    }

    #[test]
    fn exposed_names_are_prefixed_bounded_and_collision_safe() {
        let mut tools = vec![
            McpToolDescriptor {
                exposed_name: exposed_name("git.hub", "create/issue"),
                server: "git.hub".to_owned(),
                name: "create/issue".to_owned(),
                title: None,
                description: None,
                input_schema: serde_json::json!({ "type": "object" }),
            },
            McpToolDescriptor {
                exposed_name: exposed_name("git/hub", "create.issue"),
                server: "git/hub".to_owned(),
                name: "create.issue".to_owned(),
                title: None,
                description: None,
                input_schema: serde_json::json!({ "type": "object" }),
            },
        ];
        assert_eq!(tools[0].exposed_name, tools[1].exposed_name);
        resolve_exposed_name_collisions(&mut tools);
        assert_ne!(tools[0].exposed_name, tools[1].exposed_name);
        assert!(
            tools
                .iter()
                .all(|tool| tool.exposed_name.starts_with("mcp__"))
        );
        assert!(tools.iter().all(|tool| tool.exposed_name.len() <= 128));
    }

    #[test]
    fn validates_transport_shape() {
        let mut both = stdio("npx");
        both.url = Some("https://example.com/mcp".to_owned());
        assert!(validate_server("bad", &both).is_err());

        let remote = McpServerConfig {
            enabled: true,
            url: Some("https://example.com/mcp".to_owned()),
            args: vec!["nope".to_owned()],
            ..Default::default()
        };
        assert!(validate_server("remote", &remote).is_err());
    }
}
