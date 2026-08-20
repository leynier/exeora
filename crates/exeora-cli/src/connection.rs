use crate::{
    CLI_VERSION,
    api::ApiClient,
    auth::AuthManager,
    config::{ConfigStore, ProjectEntry, WorktreeSyncState},
    error::{ErrorCode, ExeoraError},
    policy::{CommandPolicy, effective_policy, policy_allows},
    protocol::{
        HEARTBEAT_INTERVAL_MS, HEARTBEAT_REQUEST, HEARTBEAT_TIMEOUT_MS, MAX_RESULT_BYTES,
        PRESENCE_SIGNAL_INTERVAL_MS, PROTOCOL_VERSION, ToolName, now_ms,
    },
    tools::ToolEngine,
};
use anyhow::{Context, Result, anyhow};
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
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

type InFlight = Arc<Mutex<HashMap<String, ActiveCall>>>;

pub async fn connect_forever(
    config: &ConfigStore,
    _api: &ApiClient,
    auth: Arc<AuthManager>,
    device_id: String,
    projects: Vec<ProjectEntry>,
    json_output: bool,
) -> Result<()> {
    let _awake = acquire_keep_awake(json_output);
    let engine = Arc::new(ToolEngine::new()?);
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
        match connect_once(
            &gateway,
            &device_id,
            &projects,
            config_path.clone(),
            auth.clone(),
            engine.clone(),
            stop.clone(),
            json_output,
        )
        .await
        {
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
    engine: Arc<ToolEngine>,
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
        "capabilities": { "prompt": can_prompt, "tools": ToolName::ALL.iter().map(ToString::to_string).collect::<Vec<_>>(), "worktreeRouting": true },
    }))?.into())).await?;
    emit_event(json_output, "open", json!({}));
    if !json_output {
        println!("✓ Connected. Waiting for tool calls.");
    }

    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<Value>();
    let in_flight: InFlight = Arc::new(Mutex::new(HashMap::new()));
    let mut tick = tokio::time::interval(Duration::from_millis(HEARTBEAT_INTERVAL_MS));
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut heartbeat_auto = false;
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
                                return Ok(ConnectOutcome::Rejected(reason.to_owned()));
                            }
                            Some("tool.call") => {
                                spawn_tool_call(message, config_path.clone(), engine.clone(), in_flight.clone(), out_tx.clone(), json_output).await;
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
                reconcile_roots(&config_path, &engine, &in_flight, &mut known_roots).await;
            }
        }
    }
    cancel_all(&in_flight).await;
    engine.kill_all().await;
    Ok(ConnectOutcome::Disconnected)
}

async fn spawn_tool_call(
    message: Value,
    config_path: PathBuf,
    engine: Arc<ToolEngine>,
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
    let Ok(config) = ConfigStore::load_from(config_path) else {
        send_error(
            ErrorCode::InternalError,
            "Could not reload the local Exeora configuration.",
        );
        return;
    };
    let Some(project) = config.find_project(project_id).cloned() else {
        send_error(
            ErrorCode::UnknownProject,
            "This machine does not serve that project. Run `exeora project add` there.",
        );
        return;
    };
    let (root, worktree_slug) =
        if let Some(worktree_id) = message.get("worktreeId").and_then(Value::as_str) {
            let Some(worktree) = config.data().worktrees.iter().find(|entry| {
                entry.id == worktree_id
                    && entry.project_id == project.id
                    && entry.sync_state == WorktreeSyncState::Active
            }) else {
                send_error(
                    ErrorCode::WorktreeUnavailable,
                    "That worktree is no longer connected or available on this machine.",
                );
                return;
            };
            if !worktree.root.is_dir() {
                send_error(
                    ErrorCode::WorktreeUnavailable,
                    "That worktree is registered but its directory is unavailable.",
                );
                return;
            }
            (worktree.root.clone(), Some(worktree.slug.clone()))
        } else {
            (project.root.clone(), None)
        };
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
        json!({ "tool": tool_name, "project": project.slug, "worktree": worktree_slug, "client": describe_client(message.get("client")) }),
    );
    if !json_output {
        println!(
            "→ {tool_name} ({}/{})",
            project.slug,
            worktree_slug.as_deref().unwrap_or("main")
        );
    }
    tokio::spawn(async move {
        let result = engine
            .execute_for_project(&root, &project.id, tool, arguments, cancel)
            .await;
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
            .worktrees
            .iter()
            .filter(|entry| entry.sync_state == WorktreeSyncState::Active)
            .filter_map(|entry| std::fs::canonicalize(&entry.root).ok()),
    );
    allowed
}

async fn reconcile_roots(
    config_path: &std::path::Path,
    engine: &ToolEngine,
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
    use super::{awake_event, handshake_rejection, result_frame};
    use crate::protocol::MAX_RESULT_BYTES;
    use serde_json::json;

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
}
