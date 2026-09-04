use crate::{
    CLI_VERSION,
    api::ApiClient,
    auth::AuthManager,
    config::{ConfigStore, ProjectEntry, WorkspaceEntry, WorkspaceSyncState},
    error::{ErrorCode, ExeoraError},
    mcp::McpManager,
    policy::{CommandPolicy, effective_policy, policy_allows},
    protocol::{
        HEARTBEAT_INTERVAL_MS, HEARTBEAT_REQUEST, HEARTBEAT_TIMEOUT_MS, MAX_RESULT_BYTES,
        PRESENCE_SIGNAL_INTERVAL_MS, PROTOCOL_VERSION, ToolName, now_ms,
    },
    tools::{CallScope, ToolEngine},
    workspace::WorkspaceEngine,
    workspaces::{self, CreateWorkspace, PublicWorkspace},
};
use anyhow::{Context, Result, anyhow};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};
use tokio::sync::{Mutex, mpsc};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{Error as WebSocketError, Message, client::IntoClientRequest, http::HeaderValue},
};
use tokio_util::sync::CancellationToken;
use url::Url;

struct ActiveCall {
    cancel: CancellationToken,
    root: PathBuf,
}

#[derive(Debug)]
struct ResolvedTarget {
    project: ProjectEntry,
    root: PathBuf,
    workspace_id: Option<String>,
    workspace_slug: Option<String>,
}

type InFlight = Arc<Mutex<HashMap<String, ActiveCall>>>;
type LifecycleLock = Arc<Mutex<()>>;

pub async fn connect_forever(
    config: &ConfigStore,
    api: &ApiClient,
    auth: Arc<AuthManager>,
    device_id: String,
    projects: Vec<ProjectEntry>,
    json_output: bool,
) -> Result<()> {
    let _awake = acquire_keep_awake(json_output);
    let engine = Arc::new(ToolEngine::new()?);
    let workspace = Arc::new(WorkspaceEngine::new());
    let mcp = Arc::new(McpManager::load(config, &projects).await);
    for warning in mcp.warnings() {
        emit_event(json_output, "notice", json!({ "message": warning }));
        if !json_output {
            eprintln!("warning: {warning}");
        }
    }
    let lifecycle_lock = Arc::new(Mutex::new(()));
    let config_path = config.path().to_path_buf();
    let gateway = config.gateway_url();
    let mut delay = Duration::from_secs(1);
    let stop = CancellationToken::new();
    let signal_stop = stop.clone();
    tokio::spawn(async move {
        let _ = tokio::signal::ctrl_c().await;
        signal_stop.cancel();
    });

    loop {
        if stop.is_cancelled() {
            break;
        }
        let outcome = connect_once(
            &gateway,
            &device_id,
            &projects,
            config_path.clone(),
            auth.clone(),
            api.clone(),
            engine.clone(),
            workspace.clone(),
            mcp.clone(),
            lifecycle_lock.clone(),
            stop.clone(),
            json_output,
        )
        .await;
        // Local work must never outlive the authenticated relay that opened it.
        workspace.kill_all().await;
        engine.kill_all().await;
        match outcome {
            Ok(ConnectOutcome::Stopped) => break,
            Ok(ConnectOutcome::Rejected(reason)) => return Err(anyhow!(reason)),
            Ok(ConnectOutcome::Disconnected) => {
                delay = Duration::from_secs(1);
                emit_event(
                    json_output,
                    "close",
                    json!({ "reason": format!("Disconnected. Reconnecting in {}s.", delay.as_secs()) }),
                );
                tokio::select! { _ = tokio::time::sleep(delay) => {}, _ = stop.cancelled() => break }
            }
            Err(error) => {
                emit_event(
                    json_output,
                    "close",
                    json!({ "reason": format!("{error}. Reconnecting in {}s.", delay.as_secs()) }),
                );
                tokio::select! { _ = tokio::time::sleep(delay) => {}, _ = stop.cancelled() => break }
                delay = (delay * 2).min(Duration::from_secs(30));
            }
        }
    }
    engine.kill_all().await;
    workspace.kill_all().await;
    if !json_output {
        println!("Disconnected.");
    }
    Ok(())
}

fn acquire_keep_awake(json_output: bool) -> Option<keepawake::KeepAwake> {
    match keepawake::Builder::default()
        .idle(true)
        .display(true)
        .reason("Exeora is serving remote tool calls")
        .app_name("Exeora")
        .app_reverse_domain("dev.exeora.cli")
        .create()
    {
        Ok(awake) => {
            emit_event(json_output, "awake", awake_event(true, None));
            if !json_output {
                println!("✓ Keeping the system and display awake while connect runs.");
            }
            Some(awake)
        }
        Err(error) => {
            let reason = error.to_string();
            emit_event(json_output, "awake", awake_event(false, Some(&reason)));
            if !json_output {
                eprintln!(
                    "warning: Could not keep the system and display awake: {reason}. Continuing to connect."
                );
            }
            None
        }
    }
}

fn awake_event(active: bool, reason: Option<&str>) -> Value {
    let mut fields = json!({
        "active": active,
        "system": active,
        "display": active,
    });
    if let (Some(fields), Some(reason)) = (fields.as_object_mut(), reason) {
        fields.insert("reason".to_owned(), json!(reason));
    }
    fields
}

enum ConnectOutcome {
    Stopped,
    Rejected(String),
    Disconnected,
}

fn handshake_rejection(status: u16, body: Option<&[u8]>) -> String {
    let detail = body
        .and_then(|bytes| std::str::from_utf8(bytes).ok())
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(|text| {
            serde_json::from_str::<Value>(text)
                .ok()
                .and_then(|value| {
                    let error = value.get("error")?.as_str()?;
                    let scopes = value
                        .get("requiredScopes")
                        .and_then(Value::as_array)
                        .map(|entries| {
                            entries
                                .iter()
                                .filter_map(Value::as_str)
                                .collect::<Vec<_>>()
                                .join(", ")
                        })
                        .filter(|scopes| !scopes.is_empty());
                    Some(scopes.map_or_else(
                        || error.to_owned(),
                        |scopes| format!("{error}; required scopes: {scopes}"),
                    ))
                })
                .unwrap_or_else(|| text.chars().take(200).collect())
        })
        .unwrap_or_else(|| "the gateway refused this machine".to_owned());

    format!("Relay rejected the connection ({status}): {detail}")
}

#[allow(clippy::too_many_arguments)]
async fn connect_once(
    gateway: &str,
    device_id: &str,
    projects: &[ProjectEntry],
    config_path: PathBuf,
    auth: Arc<AuthManager>,
    api: crate::api::ApiClient,
    engine: Arc<ToolEngine>,
    workspace: Arc<WorkspaceEngine>,
    mcp: Arc<McpManager>,
    lifecycle_lock: LifecycleLock,
    stop: CancellationToken,
    json_output: bool,
) -> Result<ConnectOutcome> {
    let token = auth.access_token().await?;
    let mut url = Url::parse(gateway)?.join(&format!("/api/relay/{device_id}"))?;
    url.set_scheme(if url.scheme() == "https" { "wss" } else { "ws" })
        .map_err(|_| anyhow!("invalid relay URL"))?;
    let mut request = url.as_str().into_client_request()?;
    request.headers_mut().insert(
        "authorization",
        HeaderValue::from_str(&format!("Bearer {token}"))?,
    );
    let (mut socket, _) = match connect_async(request).await {
        Ok(connection) => connection,
        Err(WebSocketError::Http(response))
            if matches!(response.status().as_u16(), 401 | 403 | 404) =>
        {
            return Ok(ConnectOutcome::Rejected(handshake_rejection(
                response.status().as_u16(),
                response.body().as_deref(),
            )));
        }
        Err(error) => return Err(error).context("Could not connect to the Exeora relay"),
    };
    let can_prompt = !json_output
        && std::io::IsTerminal::is_terminal(&std::io::stdin())
        && std::io::IsTerminal::is_terminal(&std::io::stdout());
    socket.send(Message::Text(serde_json::to_string(&json!({
        "type": "hello", "protocolVersion": PROTOCOL_VERSION, "deviceId": device_id,
        "cliVersion": CLI_VERSION, "platform": platform(),
        "projects": projects.iter().map(|project| json!({ "id": project.id, "slug": project.slug })).collect::<Vec<_>>(),
        "capabilities": {
            "prompt": can_prompt,
            "tools": ToolName::ALL.iter().map(ToString::to_string).collect::<Vec<_>>(),
            "features": ["source-control-v1", "terminal-v1", "mcp-proxy-v1"],
            "workspaceRouting": true,
        },
    }))?.into())).await?;
    emit_event(json_output, "open", json!({}));
    if !json_output {
        println!("✓ Connected. Waiting for tool calls.");
    }

    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<Value>();
    let (terminal_tx, mut terminal_rx) = mpsc::channel::<Value>(256);
    let in_flight: InFlight = Arc::new(Mutex::new(HashMap::new()));
    let mut tick = tokio::time::interval(Duration::from_millis(HEARTBEAT_INTERVAL_MS));
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut heartbeat_auto = false;
    let mut mcp_catalog_sent = false;
    let mut last_ack = now_ms();
    let mut last_presence = now_ms();
    let mut roots_tick = tokio::time::interval(Duration::from_secs(1));
    roots_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut known_roots = served_roots(&config_path);

    loop {
        tokio::select! {
            _ = stop.cancelled() => {
                let _ = socket.close(None).await;
                cancel_all(&in_flight).await;
                engine.kill_all().await;
                workspace.kill_all().await;
                return Ok(ConnectOutcome::Stopped);
            }
            _ = tick.tick() => {
                let now = now_ms();
                if heartbeat_auto && now.saturating_sub(last_ack) > HEARTBEAT_TIMEOUT_MS {
                    let _ = socket.close(None).await;
                    break;
                }
                let frame = if heartbeat_auto { HEARTBEAT_REQUEST.to_owned() } else { json!({ "type": "heartbeat", "at": now }).to_string() };
                socket.send(Message::Text(frame.into())).await?;
                if heartbeat_auto && now.saturating_sub(last_presence) >= PRESENCE_SIGNAL_INTERVAL_MS {
                    socket.send(Message::Text(json!({ "type": "presence", "at": now }).to_string().into())).await?;
                    last_presence = now;
                }
            }
            Some(outgoing) = out_rx.recv() => {
                socket.send(Message::Text(outgoing.to_string().into())).await?;
            }
            Some(outgoing) = terminal_rx.recv() => {
                socket.send(Message::Text(outgoing.to_string().into())).await?;
            }
            incoming = socket.next() => {
                let Some(incoming) = incoming else { break; };
                match incoming? {
                    Message::Text(text) => {
                        let Ok(message) = serde_json::from_str::<Value>(&text) else { continue; };
                        match message.get("type").and_then(Value::as_str) {
                            Some("heartbeat.ack") => last_ack = now_ms(),
                            Some("hello.ack") => {
                                heartbeat_auto = message.get("heartbeatMode").and_then(Value::as_str) == Some("auto");
                                last_ack = now_ms();
                                if !mcp_catalog_sent {
                                    for project in projects {
                                        socket.send(Message::Text(json!({
                                            "type": "mcp.catalog",
                                            "projectId": project.id,
                                            "tools": mcp.catalog(&project.id),
                                        }).to_string().into())).await?;
                                    }
                                    mcp_catalog_sent = true;
                                }
                                if let Some(latest) = message.get("latestCliVersion").and_then(Value::as_str)
                                    && is_outdated(CLI_VERSION, latest) {
                                        let notice = format!("A newer Exeora CLI is available ({CLI_VERSION} → {latest}). Run `exeora upgrade`.");
                                        emit_event(json_output, "notice", json!({ "message": notice }));
                                        if !json_output { println!("{notice}"); }
                                }
                            }
                            Some("cancel") => {
                                if let Some(id) = message.get("requestId").and_then(Value::as_str)
                                    && let Some(call) = in_flight.lock().await.get(id) {
                                    call.cancel.cancel();
                                }
                            }
                            Some("approval.request") => {
                                let tx = out_tx.clone();
                                tokio::spawn(handle_approval(message, tx, can_prompt, json_output));
                            }
                            Some("approval.resolved") => {}
                            Some("shutdown") => {
                                let reason = message.get("reason").and_then(Value::as_str).unwrap_or("The gateway closed the connection.");
                                cancel_all(&in_flight).await;
                                engine.kill_all().await;
                                workspace.kill_all().await;
                                return Ok(ConnectOutcome::Rejected(reason.to_owned()));
                            }
                            Some("tool.call") => {
                                spawn_tool_call(message, config_path.clone(), api.clone(), engine.clone(), workspace.clone(), mcp.clone(), lifecycle_lock.clone(), in_flight.clone(), out_tx.clone(), json_output).await;
                            }
                            Some("mcp.call") => {
                                spawn_mcp_call(message, config_path.clone(), mcp.clone(), in_flight.clone(), out_tx.clone(), json_output).await;
                            }
                            Some("workspace.call") => {
                                spawn_workspace_call(message, config_path.clone(), api.clone(), workspace.clone(), lifecycle_lock.clone(), in_flight.clone(), out_tx.clone()).await;
                            }
                            Some("terminal.open") | Some("terminal.input") | Some("terminal.resize") | Some("terminal.close") => {
                                handle_terminal_message(message, config_path.clone(), workspace.clone(), terminal_tx.clone()).await;
                            }
                            _ => {}
                        }
                    }
                    Message::Ping(data) => socket.send(Message::Pong(data)).await?,
                    Message::Close(frame) => {
                        if let Some(frame) = frame
                            && frame.code == tokio_tungstenite::tungstenite::protocol::frame::coding::CloseCode::Policy {
                                return Ok(ConnectOutcome::Rejected(frame.reason.to_string()));
                        }
                        break;
                    }
                    _ => {}
                }
            }
            _ = roots_tick.tick() => {
                reconcile_roots(&config_path, &engine, &workspace, &mcp, &in_flight, &mut known_roots).await;
            }
        }
    }
    cancel_all(&in_flight).await;
    engine.kill_all().await;
    workspace.kill_all().await;
    Ok(ConnectOutcome::Disconnected)
}

#[allow(clippy::too_many_arguments)]
async fn spawn_tool_call(
    message: Value,
    config_path: PathBuf,
    api: ApiClient,
    engine: Arc<ToolEngine>,
    workspace: Arc<WorkspaceEngine>,
    mcp: Arc<McpManager>,
    lifecycle_lock: LifecycleLock,
    in_flight: InFlight,
    outgoing: mpsc::UnboundedSender<Value>,
    json_output: bool,
) {
    let Some(request_id) = message
        .get("requestId")
        .and_then(Value::as_str)
        .map(str::to_owned)
    else {
        return;
    };
    let Some(project_id) = message.get("projectId").and_then(Value::as_str) else {
        return;
    };
    let started = now_ms();
    let send_error = |code: ErrorCode, text: &str| {
        let _ = outgoing.send(result_frame(
            &request_id,
            started,
            Err(ExeoraError::new(code, text)),
        ));
    };
    if message
        .get("expiresAt")
        .and_then(Value::as_u64)
        .is_some_and(|expires| now_ms() > expires)
    {
        send_error(
            ErrorCode::ToolTimeout,
            "The request expired before it was received.",
        );
        return;
    }
    let target = match resolve_target(
        &config_path,
        project_id,
        message.get("workspaceId").and_then(Value::as_str),
        message.get("workspaceSlug").and_then(Value::as_str),
    ) {
        Ok(target) => target,
        Err(error) => {
            send_error(error.code, &error.message);
            return;
        }
    };
    let ResolvedTarget {
        project,
        root,
        workspace_id,
        workspace_slug,
    } = target;
    let Some(tool_name) = message
        .get("tool")
        .and_then(Value::as_str)
        .map(str::to_owned)
    else {
        send_error(ErrorCode::UnknownTool, "Unsupported tool.");
        return;
    };
    let Ok(tool) = tool_name.parse::<ToolName>() else {
        send_error(ErrorCode::UnknownTool, "Unsupported tool.");
        return;
    };
    let arguments = message
        .get("arguments")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let remote = message
        .get("policy")
        .cloned()
        .and_then(|value| serde_json::from_value::<CommandPolicy>(value).ok());
    let (policy, problem) = effective_policy(&root, remote);
    if let Some(problem) = problem {
        emit_event(json_output, "error", json!({ "message": problem }));
    }
    let verdict = policy_allows(&policy, tool, &arguments);
    if !verdict.allowed {
        send_error(
            ErrorCode::Forbidden,
            verdict
                .reason
                .as_deref()
                .unwrap_or("This project does not allow that."),
        );
        return;
    }

    if matches!(tool, ToolName::DetachWorkspace | ToolName::RemoveWorkspace) {
        cancel_root(&in_flight, &root).await;
        engine.kill_root(&root).await;
        workspace.kill_root(&root).await;
        mcp.kill_root(&root).await;
    }

    let cancel = CancellationToken::new();
    in_flight.lock().await.insert(
        request_id.clone(),
        ActiveCall {
            cancel: cancel.clone(),
            root: root.clone(),
        },
    );
    emit_event(
        json_output,
        "call",
        json!({ "tool": tool_name, "project": project.slug, "workspace": workspace_slug, "client": describe_client(message.get("client")) }),
    );
    if !json_output {
        println!(
            "→ {tool_name} ({}/{})",
            project.slug,
            workspace_slug.as_deref().unwrap_or("main")
        );
    }
    let workspace_key = workspace_id.clone().unwrap_or_else(|| "main".to_owned());
    let owner_client_id = message
        .get("client")
        .and_then(Value::as_object)
        .and_then(|client| client.get("id"))
        .and_then(Value::as_str)
        .map(str::to_owned);
    tokio::spawn(async move {
        let result = if tool.is_workspace_tool() {
            execute_workspace_tool(
                &config_path,
                &api,
                &engine,
                &lifecycle_lock,
                &project,
                &root,
                workspace_id.as_deref(),
                tool,
                arguments,
                cancel,
            )
            .await
        } else {
            engine
                .execute_scoped(
                    &root,
                    CallScope {
                        project: &project.id,
                        workspace: &workspace_key,
                        owner: owner_client_id.as_deref(),
                    },
                    tool,
                    arguments,
                    cancel,
                )
                .await
        };
        in_flight.lock().await.remove(&request_id);
        let elapsed = now_ms().saturating_sub(started);
        let frame = result_frame(&request_id, started, result);
        let ok = frame
            .pointer("/result/ok")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let _ = outgoing.send(frame);
        emit_event(
            json_output,
            "result",
            json!({ "tool": tool_name, "ok": ok, "durationMs": elapsed }),
        );
        if !json_output {
            println!("{} {tool_name} {elapsed}ms", if ok { "✓" } else { "✗" });
        }
    });
}

async fn spawn_mcp_call(
    message: Value,
    config_path: PathBuf,
    mcp: Arc<McpManager>,
    in_flight: InFlight,
    outgoing: mpsc::UnboundedSender<Value>,
    json_output: bool,
) {
    let Some(request_id) = message
        .get("requestId")
        .and_then(Value::as_str)
        .map(str::to_owned)
    else {
        return;
    };
    let started = now_ms();
    let send_error = |code: ErrorCode, text: &str| {
        let _ = outgoing.send(mcp_result_frame(
            &request_id,
            started,
            Err(ExeoraError::new(code, text)),
        ));
    };
    if message
        .get("expiresAt")
        .and_then(Value::as_u64)
        .is_some_and(|expires| now_ms() > expires)
    {
        send_error(
            ErrorCode::ToolTimeout,
            "The MCP request expired before it was received.",
        );
        return;
    }
    let Some(project_id) = message.get("projectId").and_then(Value::as_str) else {
        return;
    };
    let target = match resolve_target(
        &config_path,
        project_id,
        message.get("workspaceId").and_then(Value::as_str),
        message.get("workspaceSlug").and_then(Value::as_str),
    ) {
        Ok(target) => target,
        Err(error) => {
            send_error(error.code, &error.message);
            return;
        }
    };
    let Some(server) = message
        .get("server")
        .and_then(Value::as_str)
        .map(str::to_owned)
    else {
        send_error(ErrorCode::UnknownTool, "The MCP server was not specified.");
        return;
    };
    let Some(tool) = message
        .get("tool")
        .and_then(Value::as_str)
        .map(str::to_owned)
    else {
        send_error(ErrorCode::UnknownTool, "The MCP tool was not specified.");
        return;
    };
    let arguments = message
        .get("arguments")
        .cloned()
        .unwrap_or_else(|| json!({}));
    let ResolvedTarget {
        project,
        root,
        workspace_slug,
        ..
    } = target;
    let cancel = CancellationToken::new();
    in_flight.lock().await.insert(
        request_id.clone(),
        ActiveCall {
            cancel: cancel.clone(),
            root: root.clone(),
        },
    );
    let exposed = format!("mcp__{server}__{tool}");
    emit_event(
        json_output,
        "call",
        json!({ "tool": exposed, "project": project.slug, "workspace": workspace_slug, "client": describe_client(message.get("client")) }),
    );
    if !json_output {
        println!(
            "→ MCP {server}/{tool} ({}/{})",
            project.slug,
            workspace_slug.as_deref().unwrap_or("main")
        );
    }
    tokio::spawn(async move {
        let result = tokio::select! {
            _ = cancel.cancelled() => Err(ExeoraError::new(
                ErrorCode::Cancelled,
                "The MCP call was cancelled.",
            )),
            result = mcp.call(&project, &root, &server, &tool, arguments) => result.map_err(|error| {
                ExeoraError::new(
                    ErrorCode::ToolFailed,
                    format!("Upstream MCP call failed: {error:#}"),
                )
            }),
        };
        in_flight.lock().await.remove(&request_id);
        let elapsed = now_ms().saturating_sub(started);
        let frame = mcp_result_frame(&request_id, started, result);
        let ok = frame
            .pointer("/result/ok")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let _ = outgoing.send(frame);
        emit_event(
            json_output,
            "result",
            json!({ "tool": exposed, "ok": ok, "durationMs": elapsed }),
        );
        if !json_output {
            println!(
                "{} MCP {server}/{tool} {elapsed}ms",
                if ok { "✓" } else { "✗" }
            );
        }
    });
}

#[allow(clippy::too_many_arguments)]
async fn execute_workspace_tool(
    config_path: &Path,
    api: &ApiClient,
    engine: &ToolEngine,
    lifecycle_lock: &LifecycleLock,
    project: &ProjectEntry,
    source_root: &Path,
    workspace_id: Option<&str>,
    tool: ToolName,
    arguments: Value,
    cancel: CancellationToken,
) -> Result<Value, ExeoraError> {
    engine.validate(tool, &arguments)?;
    if cancel.is_cancelled() {
        return Err(ExeoraError::new(
            ErrorCode::Cancelled,
            "The call was cancelled before it started.",
        ));
    }
    let _guard = lifecycle_lock.lock().await;
    let mut config = ConfigStore::load_from(config_path.to_path_buf()).map_err(|error| {
        ExeoraError::new(
            ErrorCode::InternalError,
            format!("Could not reload the local Exeora configuration: {error}"),
        )
    })?;
    let project = config.find_project(&project.id).cloned().ok_or_else(|| {
        ExeoraError::new(
            ErrorCode::UnknownProject,
            "This machine no longer serves that project.",
        )
    })?;
    let record = arguments.as_object().ok_or_else(|| {
        ExeoraError::new(
            ErrorCode::InvalidArguments,
            "Tool arguments must be an object.",
        )
    })?;

    match tool {
        ToolName::ListGitWorkspaces => {
            let workspaces = workspaces::discover(&config, &project).map_err(workspace_error)?;
            Ok(json!({ "workspaces": workspaces }))
        }
        ToolName::CreateWorkspace => {
            let branch = string_argument(record, "branch")?;
            let from = optional_string_argument(record, "from")?;
            let reuse_existing_branch = record
                .get("reuseExistingBranch")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            if from.is_some() && reuse_existing_branch {
                return Err(ExeoraError::new(
                    ErrorCode::InvalidArguments,
                    "from cannot be used with reuseExistingBranch.",
                ));
            }
            let entry = workspaces::create(
                &config,
                &project,
                CreateWorkspace {
                    branch,
                    from,
                    reuse_existing_branch,
                    name: optional_string_argument(record, "name")?,
                    slug: optional_string_argument(record, "slug")?,
                    path: None,
                    source: Some(source_root.to_path_buf()),
                },
            )
            .map_err(workspace_error)?;
            let outcome = workspaces::persist(&mut config, api, entry)
                .await
                .map_err(workspace_internal_error)?;
            Ok(json!({
                "workspace": PublicWorkspace::from(&outcome.entry),
                "outcome": outcome.outcome,
            }))
        }
        ToolName::AttachWorkspace => {
            let path = optional_string_argument(record, "path")?;
            let branch = optional_string_argument(record, "branch")?;
            let path = match (path, branch) {
                (Some(path), None) => {
                    let path = PathBuf::from(path);
                    if !path.is_absolute() {
                        return Err(ExeoraError::new(
                            ErrorCode::InvalidArguments,
                            "path must be absolute.",
                        ));
                    }
                    path
                }
                (None, Some(branch)) => workspaces::path_for_branch(&config, &project, &branch)
                    .map_err(workspace_error)?,
                _ => {
                    return Err(ExeoraError::new(
                        ErrorCode::InvalidArguments,
                        "Pass exactly one of path or branch.",
                    ));
                }
            };
            let entry = workspaces::attach(
                &config,
                &project,
                &path,
                optional_string_argument(record, "name")?,
                optional_string_argument(record, "slug")?,
            )
            .map_err(workspace_error)?;
            let outcome = workspaces::persist(&mut config, api, entry)
                .await
                .map_err(workspace_internal_error)?;
            Ok(json!({
                "workspace": PublicWorkspace::from(&outcome.entry),
                "outcome": outcome.outcome,
            }))
        }
        ToolName::DetachWorkspace => {
            let entry = active_workspace(&config, &project.id, workspace_id)?;
            let outcome = workspaces::detach(&mut config, api, entry)
                .await
                .map_err(workspace_internal_error)?;
            Ok(json!({
                "workspace": PublicWorkspace::from(&outcome.entry),
                "outcome": outcome.outcome,
            }))
        }
        ToolName::RemoveWorkspace => {
            let entry = active_workspace(&config, &project.id, workspace_id)?;
            let outcome = workspaces::remove(
                &mut config,
                api,
                &project,
                entry,
                record
                    .get("force")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                record
                    .get("deleteBranch")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
            )
            .await
            .map_err(workspace_error)?;
            Ok(json!({
                "workspace": PublicWorkspace::from(&outcome.entry),
                "outcome": outcome.outcome,
                "branchDeleted": outcome.branch_deleted,
            }))
        }
        _ => Err(ExeoraError::new(
            ErrorCode::InternalError,
            "The workspace tool dispatcher received a different tool.",
        )),
    }
}

fn active_workspace(
    config: &ConfigStore,
    project_id: &str,
    workspace_id: Option<&str>,
) -> Result<WorkspaceEntry, ExeoraError> {
    let workspace_id = workspace_id.ok_or_else(|| {
        ExeoraError::new(
            ErrorCode::InvalidArguments,
            "A connected workspace slug or id is required.",
        )
    })?;
    config
        .data()
        .workspaces
        .iter()
        .find(|entry| {
            entry.id == workspace_id
                && entry.project_id == project_id
                && entry.sync_state == WorkspaceSyncState::Active
        })
        .cloned()
        .ok_or_else(|| {
            ExeoraError::new(
                ErrorCode::WorkspaceUnavailable,
                "That workspace is no longer connected or available on this machine.",
            )
        })
}

fn string_argument(
    record: &serde_json::Map<String, Value>,
    name: &str,
) -> Result<String, ExeoraError> {
    optional_string_argument(record, name)?.ok_or_else(|| {
        ExeoraError::new(
            ErrorCode::InvalidArguments,
            format!("A {name} is required."),
        )
    })
}

fn optional_string_argument(
    record: &serde_json::Map<String, Value>,
    name: &str,
) -> Result<Option<String>, ExeoraError> {
    match record.get(name) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(value)) => Ok(Some(value.clone())),
        Some(_) => Err(ExeoraError::new(
            ErrorCode::InvalidArguments,
            format!("{name} must be a string."),
        )),
    }
}

fn workspace_error(error: anyhow::Error) -> ExeoraError {
    let message = error.to_string();
    let code = if message.starts_with("git ") || message.starts_with("Could not") {
        ErrorCode::ToolFailed
    } else {
        ErrorCode::InvalidArguments
    };
    ExeoraError::new(code, message)
}

fn workspace_internal_error(error: anyhow::Error) -> ExeoraError {
    ExeoraError::new(ErrorCode::InternalError, error.to_string())
}

async fn cancel_root(in_flight: &InFlight, root: &Path) {
    let root = std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    for call in in_flight.lock().await.values() {
        let call_root =
            std::fs::canonicalize(&call.root).unwrap_or_else(|_| call.root.to_path_buf());
        if call_root == root {
            call.cancel.cancel();
        }
    }
}

async fn handle_approval(
    message: Value,
    outgoing: mpsc::UnboundedSender<Value>,
    can_prompt: bool,
    json_output: bool,
) {
    let Some(id) = message.get("id").and_then(Value::as_str).map(str::to_owned) else {
        return;
    };
    if !can_prompt {
        let _ = outgoing.send(json!({ "type": "approval.answer", "id": id, "approved": false }));
        return;
    }
    let prompt = message
        .get("prompt")
        .and_then(Value::as_str)
        .unwrap_or("Allow this tool call?")
        .to_owned();
    let approved = tokio::task::spawn_blocking(move || {
        cliclack::confirm(prompt)
            .initial_value(false)
            .interact()
            .unwrap_or(false)
    })
    .await
    .unwrap_or(false);
    emit_event(
        json_output,
        "approval",
        json!({ "id": id, "approved": approved }),
    );
    let _ = outgoing.send(json!({ "type": "approval.answer", "id": id, "approved": approved }));
}

async fn spawn_workspace_call(
    message: Value,
    config_path: PathBuf,
    api: crate::api::ApiClient,
    workspace: Arc<WorkspaceEngine>,
    lifecycle_lock: LifecycleLock,
    in_flight: InFlight,
    outgoing: mpsc::UnboundedSender<Value>,
) {
    let Some(request_id) = message
        .get("requestId")
        .and_then(Value::as_str)
        .map(str::to_owned)
    else {
        return;
    };
    let Some(project_id) = message.get("projectId").and_then(Value::as_str) else {
        return;
    };
    let started = now_ms();
    let send_error = |error: ExeoraError| {
        let _ = outgoing.send(workspace_result_frame(&request_id, started, Err(error)));
    };
    if message
        .get("expiresAt")
        .and_then(Value::as_u64)
        .is_some_and(|expires| started > expires)
    {
        send_error(ExeoraError::new(
            ErrorCode::ToolTimeout,
            "The workspace request expired before it was received.",
        ));
        return;
    }
    let target = match resolve_target(
        &config_path,
        project_id,
        message.get("workspaceId").and_then(Value::as_str),
        message.get("workspaceSlug").and_then(Value::as_str),
    ) {
        Ok(target) => target,
        Err(error) => {
            send_error(error);
            return;
        }
    };
    let action = message.get("action").cloned().unwrap_or_else(|| json!({}));
    let cancel = CancellationToken::new();
    in_flight.lock().await.insert(
        request_id.clone(),
        ActiveCall {
            cancel: cancel.clone(),
            root: target.root.clone(),
        },
    );
    let create_workspace = action.get("action").and_then(Value::as_str) == Some("workspace_create");
    tokio::spawn(async move {
        let result = if create_workspace {
            let _guard = lifecycle_lock.lock().await;
            create_and_connect_workspace(
                &config_path,
                &api,
                &target.project.id,
                &target.root,
                action,
                workspace.as_ref(),
                cancel,
            )
            .await
        } else {
            workspace.execute(&target.root, action, cancel).await
        };
        in_flight.lock().await.remove(&request_id);
        let _ = outgoing.send(workspace_result_frame(&request_id, started, result));
    });
}

async fn create_and_connect_workspace(
    config_path: &std::path::Path,
    api: &crate::api::ApiClient,
    project_id: &str,
    source_root: &Path,
    action: Value,
    workspace: &WorkspaceEngine,
    cancel: CancellationToken,
) -> Result<Value, ExeoraError> {
    let branch = action
        .get("branch")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            ExeoraError::new(ErrorCode::InvalidArguments, "A branch name is required.")
        })?;
    let mut config = ConfigStore::load_from(config_path.to_path_buf()).map_err(|_| {
        ExeoraError::new(
            ErrorCode::InternalError,
            "Could not reload the local Exeora configuration.",
        )
    })?;
    let project = config.find_project(project_id).cloned().ok_or_else(|| {
        ExeoraError::new(
            ErrorCode::UnknownProject,
            "This machine does not serve that project. Run `exeora project add` there.",
        )
    })?;
    let entry = crate::workspaces::create(
        &config,
        &project,
        crate::workspaces::CreateWorkspace {
            branch: branch.to_owned(),
            from: action
                .get("from")
                .and_then(Value::as_str)
                .map(str::to_owned),
            reuse_existing_branch: action
                .get("reuseExistingBranch")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            name: action
                .get("name")
                .and_then(Value::as_str)
                .map(str::to_owned),
            slug: action
                .get("slug")
                .and_then(Value::as_str)
                .map(str::to_owned),
            path: None,
            source: Some(source_root.to_path_buf()),
        },
    )
    .map_err(|error| ExeoraError::new(ErrorCode::InvalidArguments, error.to_string()))?;
    let outcome = crate::workspaces::persist(&mut config, api, entry)
        .await
        .map_err(|error| {
            ExeoraError::new(
                ErrorCode::InternalError,
                format!("Could not save the created workspace: {error}"),
            )
        })?;
    let entry = outcome.entry;
    let status = workspace
        .execute(source_root, json!({ "action": "status" }), cancel)
        .await?;
    Ok(json!({
        "kind": "mutation",
        "stdout": "",
        "stderr": "",
        "status": status,
        "workspace": {
            "id": entry.id,
            "slug": entry.slug,
            "name": entry.name,
            "branch": entry.branch,
            "localPath": entry.root,
        }
    }))
}

async fn handle_terminal_message(
    message: Value,
    config_path: PathBuf,
    workspace: Arc<WorkspaceEngine>,
    outgoing: mpsc::Sender<Value>,
) {
    let Some(kind) = message.get("type").and_then(Value::as_str) else {
        return;
    };
    let Some(session_id) = message
        .get("sessionId")
        .and_then(Value::as_str)
        .map(str::to_owned)
    else {
        return;
    };
    let result = match kind {
        "terminal.open" => {
            let Some(project_id) = message.get("projectId").and_then(Value::as_str) else {
                send_terminal_error(&outgoing, &session_id, "A terminal project is required.")
                    .await;
                return;
            };
            let target = match resolve_target(
                &config_path,
                project_id,
                message.get("workspaceId").and_then(Value::as_str),
                message.get("workspaceSlug").and_then(Value::as_str),
            ) {
                Ok(target) => target,
                Err(error) => {
                    send_terminal_error(&outgoing, &session_id, &error.message).await;
                    return;
                }
            };
            let cols = message
                .get("cols")
                .and_then(Value::as_u64)
                .and_then(|value| u16::try_from(value).ok());
            let rows = message
                .get("rows")
                .and_then(Value::as_u64)
                .and_then(|value| u16::try_from(value).ok());
            match (cols, rows) {
                (Some(cols), Some(rows)) => {
                    workspace
                        .terminal_open(
                            session_id.clone(),
                            &target.root,
                            cols,
                            rows,
                            outgoing.clone(),
                        )
                        .await
                }
                _ => Err(ExeoraError::new(
                    ErrorCode::InvalidArguments,
                    "Invalid terminal size.",
                )),
            }
        }
        "terminal.input" => match message
            .get("data")
            .and_then(Value::as_str)
            .and_then(|data| STANDARD.decode(data).ok())
        {
            Some(data) => workspace.terminal_input(&session_id, &data).await,
            None => Err(ExeoraError::new(
                ErrorCode::InvalidArguments,
                "Invalid terminal input encoding.",
            )),
        },
        "terminal.resize" => {
            let cols = message
                .get("cols")
                .and_then(Value::as_u64)
                .and_then(|value| u16::try_from(value).ok());
            let rows = message
                .get("rows")
                .and_then(Value::as_u64)
                .and_then(|value| u16::try_from(value).ok());
            match (cols, rows) {
                (Some(cols), Some(rows)) => {
                    workspace.terminal_resize(&session_id, cols, rows).await
                }
                _ => Err(ExeoraError::new(
                    ErrorCode::InvalidArguments,
                    "Invalid terminal size.",
                )),
            }
        }
        "terminal.close" => {
            workspace.terminal_close(&session_id).await;
            Ok(())
        }
        _ => return,
    };
    if let Err(error) = result {
        send_terminal_error(&outgoing, &session_id, &error.message).await;
    }
}

async fn send_terminal_error(outgoing: &mpsc::Sender<Value>, session_id: &str, message: &str) {
    let _ = outgoing
        .send(json!({ "type": "terminal.error", "sessionId": session_id, "message": message }))
        .await;
}

fn resolve_target(
    config_path: &Path,
    project_id: &str,
    workspace_id: Option<&str>,
    workspace_slug: Option<&str>,
) -> Result<ResolvedTarget, ExeoraError> {
    let config = ConfigStore::load_from(config_path.to_path_buf()).map_err(|_| {
        ExeoraError::new(
            ErrorCode::InternalError,
            "Could not reload the local Exeora configuration.",
        )
    })?;
    let project = config.find_project(project_id).cloned().ok_or_else(|| {
        ExeoraError::new(
            ErrorCode::UnknownProject,
            "This machine does not serve that project. Run `exeora project add` there.",
        )
    })?;
    let Some(workspace_id) = workspace_id else {
        if workspace_slug.is_some() {
            return Err(ExeoraError::new(
                ErrorCode::WorkspaceUnavailable,
                "The workspace target is incomplete.",
            ));
        }
        if !project.root.is_dir() {
            return Err(ExeoraError::new(
                ErrorCode::PathNotFound,
                "The project directory is unavailable on this machine.",
            ));
        }
        return Ok(ResolvedTarget {
            root: std::fs::canonicalize(&project.root).unwrap_or_else(|_| project.root.clone()),
            project,
            workspace_id: None,
            workspace_slug: None,
        });
    };
    let workspace = config
        .data()
        .workspaces
        .iter()
        .find(|entry| {
            entry.id == workspace_id
                && entry.project_id == project.id
                && entry.sync_state == WorkspaceSyncState::Active
                && workspace_slug.is_none_or(|slug| slug == entry.slug)
        })
        .ok_or_else(|| {
            ExeoraError::new(
                ErrorCode::WorkspaceUnavailable,
                "That workspace is no longer connected or available on this machine.",
            )
        })?;
    if !workspace.root.is_dir() {
        return Err(ExeoraError::new(
            ErrorCode::WorkspaceUnavailable,
            "That workspace is registered but its directory is unavailable.",
        ));
    }
    Ok(ResolvedTarget {
        project,
        root: std::fs::canonicalize(&workspace.root).unwrap_or_else(|_| workspace.root.clone()),
        workspace_id: Some(workspace.id.clone()),
        workspace_slug: Some(workspace.slug.clone()),
    })
}

fn workspace_result_frame(
    request_id: &str,
    started: u64,
    result: Result<Value, ExeoraError>,
) -> Value {
    let result = match result {
        Ok(value)
            if serde_json::to_vec(&value).is_ok_and(|bytes| bytes.len() <= MAX_RESULT_BYTES) =>
        {
            json!({ "ok": true, "value": value })
        }
        Ok(_) => json!({
            "ok": false,
            "error": {
                "code": ErrorCode::ToolFailed.as_str(),
                "message": "Workspace result exceeded the protocol limit.",
            }
        }),
        Err(error) => {
            json!({ "ok": false, "error": { "code": error.code.as_str(), "message": error.message } })
        }
    };
    json!({ "type": "workspace.result", "requestId": request_id, "durationMs": now_ms().saturating_sub(started), "result": result })
}

fn mcp_result_frame(request_id: &str, started: u64, result: Result<Value, ExeoraError>) -> Value {
    let mut frame = result_frame(request_id, started, result);
    frame["type"] = json!("mcp.result");
    frame
}

fn result_frame(request_id: &str, started: u64, result: Result<Value, ExeoraError>) -> Value {
    let result = match result {
        Ok(value)
            if serde_json::to_vec(&value).is_ok_and(|bytes| bytes.len() <= MAX_RESULT_BYTES) =>
        {
            json!({ "ok": true, "value": value })
        }
        Ok(_) => json!({
            "ok": false,
            "error": {
                "code": ErrorCode::ToolFailed.as_str(),
                "message": format!("Tool result exceeded the {MAX_RESULT_BYTES}-byte protocol limit. Narrow the request and try again."),
            }
        }),
        Err(error) => {
            json!({ "ok": false, "error": { "code": error.code.as_str(), "message": error.message } })
        }
    };
    json!({ "type": "tool.result", "requestId": request_id, "durationMs": now_ms().saturating_sub(started), "result": result })
}

async fn cancel_all(in_flight: &InFlight) {
    let mut calls = in_flight.lock().await;
    for call in calls.values() {
        call.cancel.cancel();
    }
    calls.clear();
}

fn served_roots(config_path: &std::path::Path) -> HashSet<PathBuf> {
    let Ok(config) = ConfigStore::load_from(config_path.to_path_buf()) else {
        return HashSet::new();
    };
    let mut allowed: HashSet<PathBuf> = config
        .data()
        .projects
        .iter()
        .filter_map(|entry| std::fs::canonicalize(&entry.root).ok())
        .collect();
    allowed.extend(
        config
            .data()
            .workspaces
            .iter()
            .filter(|entry| entry.sync_state == WorkspaceSyncState::Active)
            .filter_map(|entry| std::fs::canonicalize(&entry.root).ok()),
    );
    allowed
}

async fn reconcile_roots(
    config_path: &std::path::Path,
    engine: &ToolEngine,
    workspace: &WorkspaceEngine,
    mcp: &McpManager,
    in_flight: &InFlight,
    known_roots: &mut HashSet<PathBuf>,
) {
    let allowed = served_roots(config_path);
    let mut removed: HashSet<PathBuf> = known_roots.difference(&allowed).cloned().collect();
    removed.extend({
        let calls = in_flight.lock().await;
        calls
            .values()
            .map(|call| std::fs::canonicalize(&call.root).unwrap_or_else(|_| call.root.clone()))
            .filter(|root| !allowed.contains(root))
            .collect::<Vec<_>>()
    });
    *known_roots = allowed;
    if removed.is_empty() {
        return;
    }
    {
        let calls = in_flight.lock().await;
        for call in calls.values() {
            let root = std::fs::canonicalize(&call.root).unwrap_or_else(|_| call.root.clone());
            if removed.contains(&root) {
                call.cancel.cancel();
            }
        }
    }
    for root in removed {
        engine.kill_root(&root).await;
        workspace.kill_root(&root).await;
        mcp.kill_root(&root).await;
    }
}

fn describe_client(value: Option<&Value>) -> Option<String> {
    let value = value?;
    match (
        value.get("name").and_then(Value::as_str),
        value.get("version").and_then(Value::as_str),
    ) {
        (Some(name), Some(version)) => Some(format!("{name} {version}")),
        (Some(name), None) => Some(name.to_owned()),
        (None, Some(version)) => Some(version.to_owned()),
        _ => None,
    }
}

fn emit_event(json_output: bool, event: &str, fields: Value) {
    if !json_output {
        return;
    }
    let mut value = json!({ "at": now_ms(), "event": event });
    if let (Some(target), Some(source)) = (value.as_object_mut(), fields.as_object()) {
        target.extend(source.clone());
    }
    println!("{value}");
}

fn is_outdated(current: &str, latest: &str) -> bool {
    match (
        semver::Version::parse(current),
        semver::Version::parse(latest),
    ) {
        (Ok(current), Ok(latest)) => current < latest,
        _ => false,
    }
}

fn platform() -> &'static str {
    if cfg!(target_os = "windows") {
        "win32"
    } else if cfg!(target_os = "macos") {
        "darwin"
    } else {
        "linux"
    }
}

#[cfg(test)]
mod tests {
    use super::{awake_event, handshake_rejection, resolve_target, result_frame};
    use crate::{
        config::{ConfigStore, ProjectEntry, WorkspaceEntry, WorkspaceSyncState},
        error::ErrorCode,
        protocol::MAX_RESULT_BYTES,
    };
    use serde_json::json;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn rejects_an_oversized_tool_result_before_it_reaches_the_socket() {
        let frame = result_frame(
            "req_test",
            0,
            Ok(json!({ "content": "x".repeat(MAX_RESULT_BYTES) })),
        );
        assert_eq!(frame["result"]["ok"], false);
        assert_eq!(frame["result"]["error"]["code"], "TOOL_FAILED");
    }

    #[test]
    fn explains_a_rejected_relay_handshake_instead_of_hiding_it_in_retries() {
        let message = handshake_rejection(
            403,
            Some(br#"{"error":"insufficient_scope","requiredScopes":["executor:connect"]}"#),
        );

        assert_eq!(
            message,
            "Relay rejected the connection (403): insufficient_scope; required scopes: executor:connect"
        );
    }

    #[test]
    fn reports_keep_awake_state_without_breaking_json_streams() {
        assert_eq!(
            awake_event(true, None),
            json!({ "active": true, "system": true, "display": true })
        );
        assert_eq!(
            awake_event(false, Some("not supported")),
            json!({
                "active": false,
                "system": false,
                "display": false,
                "reason": "not supported",
            })
        );
    }

    #[test]
    fn resolves_only_the_active_workspace_with_the_matching_stable_identity() {
        let directory = tempdir().unwrap();
        let main = directory.path().join("main");
        let feature = directory.path().join("feature");
        let pending = directory.path().join("pending");
        fs::create_dir_all(&main).unwrap();
        fs::create_dir_all(&feature).unwrap();
        fs::create_dir_all(&pending).unwrap();
        let config_path = directory.path().join("config.json");
        let mut config = ConfigStore::load_from(config_path.clone()).unwrap();
        config.upsert_project(ProjectEntry {
            id: "prj_1".to_owned(),
            slug: "project".to_owned(),
            name: "Project".to_owned(),
            root: main.clone(),
        });
        for (id, slug, root, sync_state) in [
            (
                "wsp_active",
                "feature",
                feature.clone(),
                WorkspaceSyncState::Active,
            ),
            (
                "wsp_pending",
                "pending",
                pending,
                WorkspaceSyncState::PendingUpsert,
            ),
        ] {
            config.upsert_workspace(WorkspaceEntry {
                id: id.to_owned(),
                project_id: "prj_1".to_owned(),
                slug: slug.to_owned(),
                name: slug.to_owned(),
                branch: Some(slug.to_owned()),
                git_root: main.clone(),
                root,
                managed: true,
                sync_state,
            });
        }
        config.save().unwrap();

        let resolved =
            resolve_target(&config_path, "prj_1", Some("wsp_active"), Some("feature")).unwrap();
        assert_eq!(resolved.root, fs::canonicalize(feature).unwrap());
        assert_eq!(resolved.workspace_id.as_deref(), Some("wsp_active"));
        assert_eq!(resolved.workspace_slug.as_deref(), Some("feature"));

        for (id, slug) in [
            ("wsp_active", Some("renamed")),
            ("wsp_pending", Some("pending")),
            ("wsp_missing", None),
        ] {
            let error = resolve_target(&config_path, "prj_1", Some(id), slug).unwrap_err();
            assert_eq!(error.code, ErrorCode::WorkspaceUnavailable);
        }
    }
}
