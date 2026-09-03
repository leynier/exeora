//! One set of downstream MCP servers per project, and the announcement that
//! publishes them to the gateway.
//!
//! The registry owns the server processes for the whole life of `connect`, not
//! per connection: a reconnect is seconds, and respawning every server — npx
//! downloads and all — would cost far more than the outage did. They are not
//! work a tool call started, so they do not owe the relay the lifetime a
//! started process does; they owe it to `connect` itself, and die with it.

use crate::{
    config::ProjectEntry,
    connection::emit_event,
    error::{ErrorCode, ExeoraError},
};
#[cfg(windows)]
use process_wrap::tokio::JobObject;
#[cfg(unix)]
use process_wrap::tokio::ProcessGroup;
use process_wrap::tokio::{ChildWrapper, CommandWrap, KillOnDrop};
use serde_json::{Value, json};
use std::{
    collections::{BTreeMap, HashSet},
    path::Path,
    process::Stdio,
    sync::Arc,
    time::Duration,
};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

use super::{
    McpClient, McpLimits, McpServerConfig, McpTool, NamedServer, REQUEST_BUDGET,
    config::load_project_config,
};

/** How long `announce_frames` waits for servers still warming up. */
const WARMUP_BUDGET: Duration = Duration::from_secs(20);

enum ServerState {
    Ready {
        client: McpClient,
        tools: Vec<McpTool>,
    },
    Error(String),
}

struct ServerHandle {
    name: String,
    /// Held for its `Drop`: the wrapper kills the process group, so a server
    /// that started children takes them with it when the registry goes.
    #[allow(dead_code)]
    child: Option<Box<dyn ChildWrapper>>,
    state: ServerState,
}

struct Project {
    servers: Vec<ServerHandle>,
}

pub struct McpRegistry {
    projects: Mutex<BTreeMap<String, Project>>,
    /** Project ids whose servers are still starting, for the announcement. */
    starting: Mutex<HashSet<String>>,
    limits: McpLimits,
    json_output: bool,
}

impl McpRegistry {
    /**
     * Starts every configured server without waiting for any of them: the
     * relay connection opens immediately, and the announcement follows once
     * the servers have said what they are.
     */
    pub async fn start(projects: &[ProjectEntry], json_output: bool) -> Arc<Self> {
        let registry = Arc::new(Self {
            projects: Mutex::new(BTreeMap::new()),
            starting: Mutex::new(HashSet::new()),
            limits: McpLimits::from_contract(),
            json_output,
        });
        for project in projects {
            let (servers, warnings) = load_project_config(&project.root);
            for warning in warnings {
                registry.warn(&warning);
            }
            if servers.len() > registry.limits.servers {
                registry.warn(&format!(
                    "This project configures {} MCP servers; only the first {} are served",
                    servers.len(),
                    registry.limits.servers
                ));
            }
            let servers: Vec<NamedServer> =
                servers.into_iter().take(registry.limits.servers).collect();
            if servers.is_empty() {
                // Entered anyway, as an empty server list: an empty frame is
                // what clears whatever the relay remembered of a config that
                // has since been emptied.
                registry.projects.lock().await.insert(
                    project.id.clone(),
                    Project {
                        servers: Vec::new(),
                    },
                );
                continue;
            }
            registry.starting.lock().await.insert(project.id.clone());
            let entry = registry.clone();
            let root = project.root.clone();
            let project_id = project.id.clone();
            tokio::spawn(async move {
                entry.warm_project(&project_id, &root, servers).await;
            });
        }
        registry
    }

    fn warn(&self, warning: &str) {
        emit_event(self.json_output, "mcp", json!({ "warning": warning }));
        if !self.json_output {
            eprintln!("warning: {warning}");
        }
    }

    async fn warm_project(&self, project_id: &str, root: &Path, servers: Vec<NamedServer>) {
        let mut handles = Vec::new();
        for NamedServer { name, config } in servers {
            let (child, state) = match spawn_and_list(
                &name,
                &config,
                root,
                self.limits.tools_per_server,
                self.json_output,
            )
            .await
            {
                Ok((child, client, tools)) => (Some(child), ServerState::Ready { client, tools }),
                Err(reason) => (None, ServerState::Error(reason)),
            };
            handles.push(ServerHandle { name, child, state });
        }
        self.projects
            .lock()
            .await
            .insert(project_id.to_owned(), Project { servers: handles });
        self.starting.lock().await.remove(project_id);
    }

    /**
     * The `mcp.tools` frames for every project, ready to send as they are.
     *
     * Waits for servers still warming, up to a budget, so a normal announcement
     * reflects reality rather than a race with npx. A server still warming at
     * the budget is announced as an error naming the reason, which is the
     * honest answer and the one a reconnect retries.
     */
    pub async fn announce_frames(&self) -> Vec<Value> {
        let deadline = tokio::time::Instant::now() + WARMUP_BUDGET;
        loop {
            if self.starting.lock().await.is_empty() || tokio::time::Instant::now() >= deadline {
                break;
            }
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
        let projects = self.projects.lock().await;
        projects
            .iter()
            .map(|(project_id, project)| {
                json!({
                    "type": "mcp.tools",
                    "projectId": project_id,
                    "servers": self.announce_servers(project),
                })
            })
            .collect()
    }

    /**
     * One project's servers as the announcement carries them.
     *
     * In name order, and under the byte budget: a server whose share does not
     * fit is reported as an error rather than quietly shortened, because an
     * agent that can see three of nine tools has no way to know it was shown a
     * subset.
     */
    fn announce_servers(&self, project: &Project) -> Vec<Value> {
        let mut servers = Vec::new();
        let mut spent = 0;
        for handle in &project.servers {
            let frame = match &handle.state {
                ServerState::Ready { tools, .. } => match self.tool_descriptors(tools) {
                    Ok(descriptors) => {
                        json!({ "name": handle.name, "status": "ready", "tools": descriptors })
                    }
                    Err(reason) => error_frame(&handle.name, &reason),
                },
                ServerState::Error(reason) => error_frame(&handle.name, reason),
            };
            let size = serde_json::to_vec(&frame).map_or(usize::MAX, |bytes| bytes.len());
            if spent + size > self.limits.announcement_bytes {
                servers.push(error_frame(
                    &handle.name,
                    "did not fit the MCP announcement size budget",
                ));
                continue;
            }
            spent += size;
            servers.push(frame);
        }
        servers
    }

    /** One server's tools, or the reason none of them can be published. */
    fn tool_descriptors(&self, tools: &[McpTool]) -> Result<Vec<Value>, String> {
        let mut descriptors = Vec::with_capacity(tools.len());
        for tool in tools {
            let schema =
                serde_json::to_vec(&tool.input_schema).map_err(|error| error.to_string())?;
            if schema.len() > self.limits.input_schema_bytes {
                return Err(format!(
                    "its tool `{}` has an input schema larger than the protocol allows",
                    tool.name
                ));
            }
            descriptors.push(json!({
                "name": tool.name,
                "title": tool.title,
                "description": tool.description,
                "inputSchema": tool.input_schema,
                "annotations": annotations(&tool.annotations),
            }));
        }
        Ok(descriptors)
    }

    /**
     * Whether a downstream tool claimed to be read only, for the policy check
     * that runs before the call is placed.
     *
     * None covers every way the answer could be unknown — no such server, no
     * such tool, no annotation — and the caller reads it as "changes
     * something", which is the safe direction.
     */
    pub async fn tool_is_read_only(
        &self,
        project_id: &str,
        server: &str,
        tool: &str,
    ) -> Option<bool> {
        let projects = self.projects.lock().await;
        let handle = projects
            .get(project_id)?
            .servers
            .iter()
            .find(|handle| handle.name == server)?;
        match &handle.state {
            ServerState::Ready { tools, .. } => tools
                .iter()
                .find(|candidate| candidate.name == tool)?
                .annotations
                .as_ref()?
                .get("readOnlyHint")?
                .as_bool(),
            ServerState::Error(_) => None,
        }
    }

    /**
     * Runs one downstream tool.
     *
     * An unconfigured server and an offered-but-unknown tool get the same
     * `UNKNOWN_TOOL` shape the executor gives, for the same reason: a caller
     * should not be able to probe which servers exist by name.
     */
    pub async fn call(
        &self,
        project_id: &str,
        server: &str,
        tool: &str,
        arguments: Value,
        budget: Duration,
        cancel: CancellationToken,
    ) -> Result<Value, ExeoraError> {
        let mut projects = self.projects.lock().await;
        let Some(project) = projects.get_mut(project_id) else {
            return Err(ExeoraError::new(
                ErrorCode::UnknownProject,
                "This machine does not serve that project.",
            ));
        };
        let Some(handle) = project
            .servers
            .iter_mut()
            .find(|handle| handle.name == server)
        else {
            return Err(ExeoraError::new(
                ErrorCode::UnknownTool,
                "That MCP server is not configured for this project.",
            ));
        };
        match &mut handle.state {
            ServerState::Ready { client, tools } => {
                if !tools.iter().any(|candidate| candidate.name == tool) {
                    return Err(ExeoraError::new(
                        ErrorCode::UnknownTool,
                        format!("That MCP server offers no tool `{tool}`."),
                    ));
                }
                client
                    .call_tool(tool, arguments, budget, cancel)
                    .await
                    .map_err(|error| {
                        ExeoraError::tool(format!("The MCP server `{server}` failed: {error}"))
                    })
            }
            ServerState::Error(reason) => Err(ExeoraError::tool(format!(
                "The MCP server `{server}` is not available: {reason}"
            ))),
        }
    }

    /** Drops every server process; the wrappers kill on the way down. */
    pub async fn kill_all(&self) {
        self.projects.lock().await.clear();
    }
}

fn error_frame(name: &str, reason: &str) -> Value {
    json!({ "name": name, "status": "error", "error": reason, "tools": [] })
}

/** The four annotation hints the announcement carries, and no others. */
fn annotations(annotations: &Option<Value>) -> Value {
    let Some(annotations) = annotations else {
        return json!({});
    };
    let mut kept = serde_json::Map::new();
    for key in [
        "readOnlyHint",
        "destructiveHint",
        "idempotentHint",
        "openWorldHint",
    ] {
        if let Some(hint) = annotations.get(key).and_then(Value::as_bool) {
            kept.insert(key.to_owned(), json!(hint));
        }
    }
    Value::Object(kept)
}

async fn spawn_and_list(
    name: &str,
    config: &McpServerConfig,
    root: &Path,
    max_tools: usize,
    json_output: bool,
) -> Result<(Box<dyn ChildWrapper>, McpClient, Vec<McpTool>), String> {
    let mut wrapped = CommandWrap::with_new(&config.command, |command| {
        command
            .args(&config.args)
            .current_dir(root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            // The server's own logs, where it writes them, next to `connect`.
            .stderr(Stdio::inherit());
        for (key, value) in &config.env {
            command.env(key, value);
        }
    });
    #[cfg(unix)]
    wrapped.wrap(ProcessGroup::leader());
    #[cfg(windows)]
    wrapped.wrap(JobObject);
    wrapped.wrap(KillOnDrop);
    let mut child = wrapped
        .spawn()
        .map_err(|error| format!("could not start `{}`: {error}", config.command))?;
    let stdin = child
        .stdin()
        .take()
        .ok_or_else(|| "the server closed its input".to_owned())?;
    let stdout = child
        .stdout()
        .take()
        .ok_or_else(|| "the server closed its output".to_owned())?;
    let mut client = McpClient::new(Box::new(stdout), Box::new(stdin));
    client
        .initialize(REQUEST_BUDGET)
        .await
        .map_err(|error| format!("the handshake failed: {error}"))?;
    let (tools, skipped) = client
        .list_tools(REQUEST_BUDGET, max_tools)
        .await
        .map_err(|error| format!("it would not list its tools: {error}"))?;
    if skipped > 0 {
        emit_event(
            json_output,
            "mcp",
            json!({ "warning": format!("{skipped} of {name}'s tools could not be republished") }),
        );
        if !json_output {
            eprintln!("warning: {skipped} of {name}'s tools could not be republished");
        }
    }
    Ok((child, client, tools))
}
