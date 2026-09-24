mod config;
mod names;
mod transport;

pub use config::{MCP_CONFIG_FILENAME, McpServerConfig, McpUserConfig, user_config_path};
pub use names::{McpToolAnnotations, McpToolDescriptor};

use crate::config::ProjectEntry;
use anyhow::{Context, Result, anyhow, bail};
use config::{ResolvedServer, effective_servers, validate_server};
use futures_util::future::join_all;
use names::{exposed_name, publishable_catalog};
use rmcp::model::CallToolRequestParams;
use serde_json::{Map, Value};
use std::{
    collections::{BTreeMap, HashMap},
    fs,
    future::Future,
    path::{Path, PathBuf},
    sync::{Arc, Mutex as SyncMutex},
    time::{Duration, Instant},
};
use tokio::sync::Mutex;
use transport::{McpClient, connect_server};

const MCP_CONNECT_TIMEOUT: Duration = Duration::from_secs(20);
const MCP_DISCOVERY_TIMEOUT: Duration = Duration::from_secs(20);
const MCP_TOOL_CALL_TIMEOUT: Duration = Duration::from_secs(300);
/// How soon a server that failed is tried again, on the next reconnect.
const MCP_RETRY_AFTER: Duration = Duration::from_secs(30);

/// A stdio server runs in the directory it serves, so each workspace gets its
/// own process. An HTTP server has no working directory, so one session per
/// project and server is enough, whatever workspace the call names.
#[derive(Debug, Clone, Hash, PartialEq, Eq)]
struct ClientKey {
    project_id: String,
    server: String,
    root: Option<PathBuf>,
}

struct ProjectServers {
    project: ProjectEntry,
    servers: BTreeMap<String, ResolvedServer>,
}

type ServerKey = (String, String);

#[derive(Default)]
struct Discovered {
    tools: HashMap<ServerKey, Vec<McpToolDescriptor>>,
    failures: HashMap<ServerKey, (String, Instant)>,
}

/// Upstream MCP clients owned by `exeora connect`.
///
/// Discovery runs in the background and never holds up the connection: native
/// tools work from the first second, and proxied ones appear once their server
/// answered. A server that failed is retried on a later reconnect. No lock is
/// held while an upstream server is being called, so one slow tool does not
/// queue the others behind it.
pub struct McpManager {
    projects: Vec<ProjectServers>,
    discovered: SyncMutex<Discovered>,
    discovery: Mutex<()>,
    clients: Mutex<HashMap<ClientKey, Arc<McpClient>>>,
    warnings: Vec<String>,
}

impl McpManager {
    /// Reads `mcp.json` beside `config_path` and each project's `exeora.toml`.
    pub fn load(config_path: &Path, projects: &[ProjectEntry]) -> Self {
        match McpUserConfig::load(config_path) {
            Ok(user) => Self::new(&user, projects),
            Err(error) => {
                let mut manager = Self::new(&McpUserConfig::default(), projects);
                manager.warnings.insert(0, format!("{error:#}"));
                manager
            }
        }
    }

    pub fn new(user: &McpUserConfig, projects: &[ProjectEntry]) -> Self {
        let mut warnings = Vec::new();
        let projects = projects
            .iter()
            .map(|project| {
                let (mut servers, problems) = effective_servers(user, &project.root);
                warnings.extend(problems);
                servers.retain(|name, server| match validate_server(name, &server.config) {
                    Ok(()) => true,
                    Err(error) => {
                        warnings.push(format!("{}: {error}", project.slug));
                        false
                    }
                });
                ProjectServers {
                    project: project.clone(),
                    servers,
                }
            })
            .collect();
        Self {
            projects,
            discovered: SyncMutex::new(Discovered::default()),
            discovery: Mutex::new(()),
            clients: Mutex::new(HashMap::new()),
            warnings,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.projects.iter().all(|entry| entry.servers.is_empty())
    }

    pub fn warnings(&self) -> &[String] {
        &self.warnings
    }

    /// Connects every server not yet discovered, in parallel, and lists its
    /// tools. Returns a message for each failure that is new or changed.
    pub async fn discover(&self) -> Vec<String> {
        let _running = self.discovery.lock().await;
        let pending = {
            let discovered = self.discovered();
            self.projects
                .iter()
                .flat_map(|entry| {
                    entry
                        .servers
                        .iter()
                        .map(move |(name, server)| (entry, name, server))
                })
                .filter(|(entry, name, _)| {
                    let key = (entry.project.id.clone(), (*name).clone());
                    !discovered.tools.contains_key(&key)
                        && discovered
                            .failures
                            .get(&key)
                            .is_none_or(|(_, at)| at.elapsed() >= MCP_RETRY_AFTER)
                })
                .collect::<Vec<_>>()
        };

        let outcomes = join_all(pending.into_iter().map(|(entry, name, server)| async move {
            let result = self.list_tools(&entry.project, name, server).await;
            ((entry.project.id.clone(), name.clone()), entry, result)
        }))
        .await;

        let mut messages = Vec::new();
        let mut discovered = self.discovered();
        for (key, entry, result) in outcomes {
            match result {
                Ok(tools) => {
                    discovered.failures.remove(&key);
                    discovered.tools.insert(key, tools);
                }
                Err(error) => {
                    let message = format!(
                        "MCP server `{}` for {} is unavailable: {error:#}",
                        key.1, entry.project.slug
                    );
                    let changed = discovered
                        .failures
                        .get(&key)
                        .is_none_or(|(previous, _)| previous != &message);
                    if changed {
                        messages.push(message.clone());
                    }
                    discovered.failures.insert(key, (message, Instant::now()));
                }
            }
        }
        messages
    }

    /// Every project's publishable catalog, and a warning for each one that
    /// had to leave tools out to fit the relay's budgets.
    pub fn catalogs(&self) -> (Vec<(String, Vec<McpToolDescriptor>)>, Vec<String>) {
        let discovered = self.discovered();
        let mut warnings = Vec::new();
        let catalogs = self
            .projects
            .iter()
            .map(|entry| {
                let tools = entry
                    .servers
                    .keys()
                    .filter_map(|name| {
                        discovered
                            .tools
                            .get(&(entry.project.id.clone(), name.clone()))
                    })
                    .flatten()
                    .cloned()
                    .collect();
                let (tools, omitted) = publishable_catalog(tools);
                if omitted > 0 {
                    warnings.push(format!(
                        "{} has more MCP tools than one project can publish; {omitted} were left out.",
                        entry.project.slug
                    ));
                }
                (entry.project.id.clone(), tools)
            })
            .collect();
        (catalogs, warnings)
    }

    /// The published descriptor of one upstream tool, if this project offers it.
    pub fn tool(&self, project_id: &str, server: &str, name: &str) -> Option<McpToolDescriptor> {
        let (catalogs, _) = self.catalogs();
        catalogs
            .into_iter()
            .find(|(id, _)| id == project_id)?
            .1
            .into_iter()
            .find(|tool| tool.server == server && tool.name == name)
    }

    /// Calls one upstream tool, in `root` for a stdio server.
    pub async fn call(
        &self,
        project_id: &str,
        root: &Path,
        server_name: &str,
        tool_name: &str,
        arguments: Value,
    ) -> Result<Value> {
        let (project, server) = self
            .projects
            .iter()
            .find(|entry| entry.project.id == project_id)
            .and_then(|entry| {
                entry
                    .servers
                    .get(server_name)
                    .map(|server| (&entry.project, server))
            })
            .ok_or_else(|| {
                anyhow!("MCP server `{server_name}` is not configured for this project")
            })?;
        if self.tool(project_id, server_name, tool_name).is_none() {
            bail!("MCP tool `{server_name}/{tool_name}` is not exposed for this project");
        }
        let args = match arguments {
            Value::Object(args) => args,
            Value::Null => Map::new(),
            _ => bail!("MCP tool arguments must be an object"),
        };

        let client = self.client_for(project, root, server_name, server).await?;
        let result = bounded(MCP_TOOL_CALL_TIMEOUT, async {
            client
                .call_tool(CallToolRequestParams::new(tool_name.to_owned()).with_arguments(args))
                .await
                .map_err(anyhow::Error::from)
        })
        .await
        .with_context(|| format!("MCP tool `{server_name}/{tool_name}` failed"))?;
        serde_json::to_value(result).context("Could not encode the MCP tool result")
    }

    /// Stops the stdio servers started in a workspace that is going away.
    pub async fn kill_root(&self, root: &Path) {
        let root = fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
        let removed = {
            let mut clients = self.clients.lock().await;
            let keys = clients
                .keys()
                .filter(|key| key.root.as_deref() == Some(root.as_path()))
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

    /// Ends every upstream session and the processes behind them.
    pub async fn shutdown(&self) {
        let clients = std::mem::take(&mut *self.clients.lock().await);
        for client in clients.into_values() {
            client.cancellation_token().cancel();
        }
    }

    fn discovered(&self) -> std::sync::MutexGuard<'_, Discovered> {
        self.discovered
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }

    async fn list_tools(
        &self,
        project: &ProjectEntry,
        server_name: &str,
        server: &ResolvedServer,
    ) -> Result<Vec<McpToolDescriptor>> {
        let client = self
            .client_for(project, &project.root, server_name, server)
            .await?;
        let tools = match bounded(MCP_DISCOVERY_TIMEOUT, async {
            client.list_all_tools().await.map_err(anyhow::Error::from)
        })
        .await
        {
            Ok(tools) => tools,
            Err(error) => {
                // A session that cannot list its tools is not worth keeping:
                // the retry should start the server afresh.
                self.forget_client(&client).await;
                return Err(error)
                    .with_context(|| format!("Could not list tools from `{server_name}`"));
            }
        };

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
                    annotations: tool.annotations.map(|hints| McpToolAnnotations {
                        read_only_hint: hints.read_only_hint,
                        destructive_hint: hints.destructive_hint,
                        idempotent_hint: hints.idempotent_hint,
                        open_world_hint: hints.open_world_hint,
                    }),
                })
            })
            .collect()
    }

    async fn client_for(
        &self,
        project: &ProjectEntry,
        root: &Path,
        server_name: &str,
        server: &ResolvedServer,
    ) -> Result<Arc<McpClient>> {
        let root = fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
        let key = ClientKey {
            project_id: project.id.clone(),
            server: server_name.to_owned(),
            root: server.config.command.is_some().then(|| root.clone()),
        };
        {
            let clients = self.clients.lock().await;
            if let Some(client) = clients.get(&key)
                && !client.is_closed()
            {
                return Ok(client.clone());
            }
        }

        // Connected outside the lock: a server that takes twenty seconds to
        // start must not hold up calls to every other one.
        let client = Arc::new(
            bounded(MCP_CONNECT_TIMEOUT, connect_server(server, &root))
                .await
                .with_context(|| format!("Could not connect to MCP server `{server_name}`"))?,
        );
        let mut clients = self.clients.lock().await;
        if let Some(existing) = clients.get(&key)
            && !existing.is_closed()
        {
            client.cancellation_token().cancel();
            return Ok(existing.clone());
        }
        clients.insert(key, client.clone());
        Ok(client)
    }

    async fn forget_client(&self, client: &Arc<McpClient>) {
        self.clients
            .lock()
            .await
            .retain(|_, candidate| !Arc::ptr_eq(candidate, client));
        client.cancellation_token().cancel();
    }
}

async fn bounded<T>(duration: Duration, future: impl Future<Output = Result<T>>) -> Result<T> {
    tokio::time::timeout(duration, future).await.map_err(|_| {
        anyhow!(
            "MCP operation timed out after {} seconds",
            duration.as_secs()
        )
    })?
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[tokio::test]
    async fn bounds_a_pending_upstream_operation() {
        let result = bounded(Duration::from_millis(10), async {
            std::future::pending::<Result<()>>().await
        })
        .await;

        assert!(result.unwrap_err().to_string().contains("timed out"));
    }

    #[tokio::test]
    async fn a_server_that_fails_is_reported_once_and_not_retried_at_once() {
        let dir = tempdir().expect("tempdir");
        let mut servers = BTreeMap::new();
        servers.insert(
            "missing".to_owned(),
            McpServerConfig {
                command: Some("exeora-test-no-such-mcp-server".to_owned()),
                ..Default::default()
            },
        );
        let user = McpUserConfig {
            mcp_servers: servers,
            trust_project_servers: false,
        };
        let project = ProjectEntry {
            id: "prj_a".to_owned(),
            slug: "a".to_owned(),
            name: "A".to_owned(),
            root: dir.path().to_path_buf(),
        };
        let manager = McpManager::new(&user, &[project]);

        let first = manager.discover().await;
        assert_eq!(first.len(), 1);
        assert!(first[0].contains("`missing`"));
        assert!(manager.discover().await.is_empty());
        let (catalogs, warnings) = manager.catalogs();
        assert_eq!(catalogs, vec![("prj_a".to_owned(), Vec::new())]);
        assert!(warnings.is_empty());
    }
}
