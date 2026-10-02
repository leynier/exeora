use crate::{
    CLI_VERSION,
    api::ApiClient,
    auth::AuthManager,
    cloud::hooks::gate::{self, Gate},
    config::{ConfigStore, ProjectEntry, WorkspaceEntry, WorkspaceSyncState},
    error::{ErrorCode, ExeoraError},
    mcp::McpManager,
    policy::{CommandPolicy, effective_policy, mcp_policy_allows, policy_allows},
    protocol::{
        CLOUD_FEATURE, CLOUD_HOOKS_FEATURE, HEARTBEAT_INTERVAL_MS, HEARTBEAT_REQUEST,
        HEARTBEAT_TIMEOUT_MS, MAX_RESULT_BYTES, PRESENCE_SIGNAL_INTERVAL_MS, PROJECT_CLONE_FEATURE,
        PROTOCOL_VERSION, REJECTED_BACKOFF_MAX_MS, REJECTED_BACKOFF_MIN_MS,
        SOURCE_CONTROL_V1_FEATURE, SOURCE_CONTROL_V2_FEATURE, ToolName, WORKSPACE_V2_FEATURE,
        now_ms,
    },
    tools::{CallScope, ToolEngine},
    workspace::{
        WorkspaceEngine,
        clone::{CloneContext, Repository, prepare_project},
    },
    workspaces::{self, CreateWorkspace, PublicWorkspace},
};
use anyhow::{Context, Result, anyhow};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex as StdMutex,
        atomic::{AtomicBool, Ordering},
    },
    time::{Duration, Instant},
};
use tokio::sync::{Mutex, mpsc};
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::{
    connect_async_with_config,
    tungstenite::{Error as WebSocketError, Message, client::IntoClientRequest, http::HeaderValue},
};
use tokio_util::sync::CancellationToken;
use url::Url;

pub struct ActiveCall {
    cancel: CancellationToken,
    /// The directory the call works in. None for the one call that has none
    /// yet: preparing a project is what makes the directory, so there is no
    /// served root whose removal should end it.
    root: Option<PathBuf>,
}

#[derive(Debug)]
struct ResolvedTarget {
    project: ProjectEntry,
    root: PathBuf,
    workspace_id: Option<String>,
    workspace_slug: Option<String>,
}

pub type InFlight = Arc<Mutex<HashMap<String, ActiveCall>>>;
type LifecycleLock = Arc<Mutex<()>>;
/// The frames of terminals whose opening waits at the gate, by session, in
/// the order they came.
type HeldTerminals = Arc<StdMutex<HashMap<String, Vec<Value>>>>;

/// Where the CLI runs, which decides what a lost connection means.
///
/// On a laptop, work started through the relay must not outlive it, so a
/// disconnect kills every process and terminal. On a cloud machine the CLI is
/// the machine's only tenant and its socket drops every time the machine is
/// paused; killing a dev server for that would make the pause visible in the
/// worst way. There the work survives, and only a stop ends it.
pub enum ConnectMode {
    Local,
    Cloud(Arc<crate::cloud::CloudRuntime>),
}

impl ConnectMode {
    fn is_local(&self) -> bool {
        matches!(self, Self::Local)
    }

    fn cloud(&self) -> Option<&Arc<crate::cloud::CloudRuntime>> {
        match self {
            Self::Cloud(runtime) => Some(runtime),
            Self::Local => None,
        }
    }
}

const CLOUD_WORKSPACE_MESSAGE: &str =
    "Cloud workspaces are machines, managed from the dashboard and the gateway, not from here.";
const CLOUD_PREPARE_MESSAGE: &str = "A cloud machine holds the one repository it was created for. Projects are put on Exeora Cloud from the dashboard and the gateway, not cloned from here.";
/// The largest valid relay frame is a little above the protocol's 1 MiB
/// result cap (MCP catalogs are larger), while still bounding JSON buffering
/// if a gateway or proxy sends an unexpected message.
const MAX_SOCKET_MESSAGE_BYTES: usize = 4 * 1024 * 1024;
const MAX_SOCKET_FRAME_BYTES: usize = MAX_SOCKET_MESSAGE_BYTES;

fn relay_websocket_config() -> WebSocketConfig {
    WebSocketConfig::default()
        .max_message_size(Some(MAX_SOCKET_MESSAGE_BYTES))
        .max_frame_size(Some(MAX_SOCKET_FRAME_BYTES))
        .max_write_buffer_size(MAX_SOCKET_MESSAGE_BYTES)
}

/// A frame that is work, and so a reason to keep a cloud machine awake. The
/// acknowledgements are deliberately not: an idle CLI receives those forever.
fn is_work_frame(kind: Option<&str>) -> bool {
    matches!(
        kind,
        Some("tool.call")
            | Some("mcp.call")
            | Some("workspace.call")
            | Some("cancel")
            | Some("approval.request")
            | Some("terminal.open")
            | Some("terminal.input")
            | Some("terminal.resize")
            | Some("terminal.close")
            | Some("cloud.hook.run")
    )
}

/// The tools that start something, and so wait for a script of the project
/// that is making the checkout ready. Every other tool tells the truth about
/// a checkout in any state, and goes straight through.
fn waits_for_scripts(tool: ToolName) -> bool {
    matches!(tool, ToolName::RunCommand | ToolName::StartCommand)
}

/// Holds a call while a script of the project runs, for as long as the gate
/// allows. Called from the task of the call, once the call is in flight, so
/// a cancel still reaches it and the machine is still held awake for it.
async fn wait_at_gate(
    gate: Option<&Gate>,
    expires_at: Option<u64>,
    cancel: &CancellationToken,
    json_output: bool,
) {
    let Some(gate) = gate.filter(|gate| gate.is_closed()) else {
        return;
    };
    let started = Instant::now();
    let opened = tokio::select! {
        opened = gate.wait(gate::bound(expires_at, now_ms())) => opened,
        _ = cancel.cancelled() => return,
    };
    emit_event(
        json_output,
        "gate",
        json!({ "opened": opened, "waitedMs": started.elapsed().as_millis() as u64 }),
    );
}

/// Ctrl-C on a laptop; the service runtime's SIGTERM on a machine.
fn spawn_signal_watchers(stop: CancellationToken) {
    let interrupt = stop.clone();
    tokio::spawn(async move {
        let _ = tokio::signal::ctrl_c().await;
        interrupt.cancel();
    });
    #[cfg(unix)]
    tokio::spawn(async move {
        if let Ok(mut terminate) =
            tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
        {
            terminate.recv().await;
            stop.cancel();
        }
    });
}

/// Waits out a reconnect delay, unless a stop or a wake request cuts it short.
///
/// A cloud machine goes on looking at the clock while it waits. Without
/// that, the first look of the next connection would find the whole wait
/// since the last one and take it for a pause, and a machine that had only
/// been unable to reach the gateway would run its resume script. A pause
/// that does happen during the wait is seen here, and ends the wait.
async fn wait_before_reconnect(
    delay: Duration,
    stop: &CancellationToken,
    mode: &ConnectMode,
    json_output: bool,
) -> bool {
    let wait = tokio::time::sleep(delay);
    tokio::pin!(wait);
    let mut clock = tokio::time::interval(Duration::from_secs(1));
    clock.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        tokio::select! {
            _ = &mut wait => return true,
            _ = stop.cancelled() => return false,
            _ = async {
                match mode.cloud() {
                    Some(runtime) => runtime.reconnect_requested().await,
                    None => std::future::pending::<()>().await,
                }
            } => return true,
            _ = clock.tick(), if !mode.is_local() => {
                if let Some(gap_ms) = mode.cloud().and_then(|runtime| runtime.observe_resume()) {
                    emit_event(json_output, "resume", json!({ "gapMs": gap_ms, "source": "clock" }));
                    return true;
                }
            }
        }
    }
}

pub async fn connect_forever(
    config: &ConfigStore,
    api: &ApiClient,
    auth: Arc<AuthManager>,
    device_id: String,
    projects: Vec<ProjectEntry>,
    json_output: bool,
    mode: ConnectMode,
) -> Result<()> {
    let _awake = if mode.is_local() {
        acquire_keep_awake(json_output)
    } else {
        None
    };
    let limits = mode.cloud().and_then(|runtime| runtime.limits.clone());
    let engine = Arc::new(ToolEngine::with_limits(limits.clone())?);
    let workspace = Arc::new(WorkspaceEngine::with_limits(limits));
    let mcp = Arc::new(McpManager::load(config.path(), &projects));
    for warning in mcp.warnings() {
        mcp_notice(json_output, warning);
    }
    // Started now rather than on the first `hello.ack`, so upstream servers
    // boot while the relay connects. Nothing waits for it.
    if !mcp.is_empty() {
        let mcp = mcp.clone();
        tokio::spawn(async move {
            for message in mcp.discover().await {
                mcp_notice(json_output, &message);
            }
        });
    }
    let lifecycle_lock = Arc::new(Mutex::new(()));
    let config_path = config.path().to_path_buf();
    let gateway = config.gateway_url();
    let mut delay = Duration::from_secs(1);
    let mut rejected_delay = Duration::from_millis(REJECTED_BACKOFF_MIN_MS);
    let stop = CancellationToken::new();
    spawn_signal_watchers(stop.clone());

    // Created once, above the connection loop, so a terminal or a call that
    // spans a reconnect keeps its channel and its handle.
    let (terminal_tx, mut terminal_rx) = mpsc::channel::<Value>(256);
    let in_flight: InFlight = Arc::new(Mutex::new(HashMap::new()));
    let acked = Arc::new(AtomicBool::new(false));
    if let Some(runtime) = mode.cloud() {
        runtime.spawn_http_server();
        runtime.spawn_keepalive(engine.clone(), workspace.clone(), in_flight.clone());
        runtime.spawn_hook_requests();
    }

    loop {
        if stop.is_cancelled() {
            break;
        }
        if let Some(runtime) = mode.cloud() {
            runtime.mark_connecting();
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
            &mode,
            in_flight.clone(),
            terminal_tx.clone(),
            &mut terminal_rx,
            acked.clone(),
        )
        .await;
        if let Some(runtime) = mode.cloud() {
            runtime.mark_down();
        }
        // A session that was acknowledged proves the way in works; the next
        // failure starts the backoff over rather than continuing it.
        if acked.swap(false, Ordering::SeqCst) {
            delay = Duration::from_secs(1);
            rejected_delay = Duration::from_millis(REJECTED_BACKOFF_MIN_MS);
        }
        // Local work must never outlive the authenticated relay that opened it.
        // A cloud machine keeps its background processes through a blip, but
        // not its terminals: the gateway forgets every terminal when the
        // executor reconnects, and a shell nobody can reach would count as
        // work and hold the machine awake for good.
        workspace.kill_all().await;
        if mode.is_local() {
            engine.kill_all().await;
        }
        match outcome {
            Ok(ConnectOutcome::Stopped) => break,
            Ok(ConnectOutcome::Rejected(reason)) if mode.is_local() => return Err(anyhow!(reason)),
            Ok(ConnectOutcome::Rejected(reason)) => {
                // A machine has nobody to read an exit, and the runtime would
                // only start it again at once. Wait, then ask again: the
                // refusal may be a revocation that gets undone, or a device
                // row that is not there yet.
                emit_event(
                    json_output,
                    "rejected",
                    json!({ "reason": reason, "retryInSecs": rejected_delay.as_secs() }),
                );
                if !json_output {
                    eprintln!("{reason} Retrying in {}s.", rejected_delay.as_secs());
                }
                if !wait_before_reconnect(rejected_delay, &stop, &mode, json_output).await {
                    break;
                }
                rejected_delay =
                    (rejected_delay * 2).min(Duration::from_millis(REJECTED_BACKOFF_MAX_MS));
            }
            Ok(ConnectOutcome::Resumed) => {
                emit_event(
                    json_output,
                    "close",
                    json!({ "reason": "Resumed. Reconnecting now." }),
                );
            }
            Ok(ConnectOutcome::Disconnected) => {
                delay = Duration::from_secs(1);
                emit_event(
                    json_output,
                    "close",
                    json!({ "reason": format!("Disconnected. Reconnecting in {}s.", delay.as_secs()) }),
                );
                if !wait_before_reconnect(delay, &stop, &mode, json_output).await {
                    break;
                }
            }
            Err(error) => {
                emit_event(
                    json_output,
                    "close",
                    json!({ "reason": format!("{error}. Reconnecting in {}s.", delay.as_secs()) }),
                );
                if !wait_before_reconnect(delay, &stop, &mode, json_output).await {
                    break;
                }
                delay = (delay * 2).min(Duration::from_secs(30));
            }
        }
    }
    engine.kill_all().await;
    workspace.kill_all().await;
    mcp.shutdown().await;
    if let Some(runtime) = mode.cloud() {
        runtime.hooks.stop().await;
    }
    if !json_output {
        println!("Disconnected.");
    }
    Ok(())
}

fn mcp_notice(json_output: bool, message: &str) {
    emit_event(json_output, "notice", json!({ "message": message }));
    if !json_output {
        eprintln!("warning: {message}");
    }
}

/// Publishes every project's MCP catalog on this connection.
///
/// Run on each `hello.ack`, because the relay forgets catalogs whenever a new
/// executor session says hello. Discovery first retries servers that failed,
/// then the catalogs go out through the same queue as every other frame. The
/// connection loop never waits for it.
fn publish_mcp_catalogs(
    mcp: Arc<McpManager>,
    outgoing: mpsc::UnboundedSender<Value>,
    json_output: bool,
) {
    if mcp.is_empty() {
        return;
    }
    tokio::spawn(publish_catalogs(mcp, outgoing, json_output, None));
}

/// Discovers what is not discovered yet and sends the catalogs: every
/// project's, or only those of the projects named.
async fn publish_catalogs(
    mcp: Arc<McpManager>,
    outgoing: mpsc::UnboundedSender<Value>,
    json_output: bool,
    only: Option<Vec<String>>,
) {
    for message in mcp.discover().await {
        mcp_notice(json_output, &message);
    }
    let (catalogs, warnings) = mcp.catalogs();
    for warning in warnings {
        mcp_notice(json_output, &warning);
    }
    for (project_id, tools) in catalogs {
        if only.as_ref().is_some_and(|ids| !ids.contains(&project_id)) {
            continue;
        }
        if outgoing
            .send(catalog_frame(&project_id, json!(tools)))
            .is_err()
        {
            return;
        }
    }
}

fn catalog_frame(project_id: &str, tools: Value) -> Value {
    json!({ "type": "mcp.catalog", "projectId": project_id, "tools": tools })
}

/// Follows the projects of the config while the connection is up.
///
/// A project appears when the gateway asks this machine to clone it, and
/// when somebody runs `exeora project add` in another terminal; it goes when
/// it is removed. Either way the relay has to hear about its proxied tools
/// now, not at the next reconnect, which on a healthy connection is days
/// away. The catalog of a project that came is discovered and published the
/// way every catalog is at `hello.ack`. For one that went, an empty catalog
/// replaces what the relay holds, so nothing is offered that nobody serves.
///
/// A config that cannot be read changes nothing: not having been able to
/// look is not the same as having seen the projects gone.
async fn reconcile_projects(
    config_path: &Path,
    mcp: &Arc<McpManager>,
    outgoing: &mpsc::UnboundedSender<Value>,
    json_output: bool,
) -> Option<tokio::task::JoinHandle<()>> {
    let config = ConfigStore::load_from(config_path.to_path_buf()).ok()?;
    let changes = mcp.reconcile(&config.data().projects).await;
    if changes.is_empty() {
        return None;
    }
    for warning in &changes.warnings {
        mcp_notice(json_output, warning);
    }
    for project_id in &changes.removed {
        // One that only moved is published again below, with what its new
        // directory offers.
        if !changes.added.contains(project_id) {
            let _ = outgoing.send(catalog_frame(project_id, json!([])));
        }
    }
    // A project with no server has no catalog, as at connect time. One that
    // moved is the exception: what was published from its old directory has
    // to be replaced even when the new one offers nothing.
    let publish: Vec<String> = changes
        .added
        .iter()
        .filter(|id| mcp.serves(id) || changes.removed.contains(id))
        .cloned()
        .collect();
    if publish.is_empty() {
        return None;
    }
    Some(tokio::spawn(publish_catalogs(
        mcp.clone(),
        outgoing.clone(),
        json_output,
        Some(publish),
    )))
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
    /// The machine was paused and is back; the socket is not to be trusted.
    Resumed,
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
    mode: &ConnectMode,
    in_flight: InFlight,
    terminal_tx: mpsc::Sender<Value>,
    terminal_rx: &mut mpsc::Receiver<Value>,
    acked: Arc<AtomicBool>,
) -> Result<ConnectOutcome> {
    let gateway_url = validate_gateway_url(gateway, mode.cloud().is_some())?;
    let token = auth.access_token().await?;
    let mut url = gateway_url.join(&format!("/api/relay/{device_id}"))?;
    url.set_scheme(if url.scheme() == "https" { "wss" } else { "ws" })
        .map_err(|_| anyhow!("invalid relay URL"))?;
    let mut request = url.as_str().into_client_request()?;
    request.headers_mut().insert(
        "authorization",
        HeaderValue::from_str(&format!("Bearer {token}"))?,
    );
    // A cloud machine looks at the clock while it dials too, for the reason
    // given at `wait_before_reconnect`. A pause in the middle of dialling
    // leaves an attempt that belongs to before the pause; it is made again.
    let dialled = {
        let websocket = relay_websocket_config();
        let dialling = connect_async_with_config(request, Some(websocket), false);
        tokio::pin!(dialling);
        let mut clock = tokio::time::interval(Duration::from_secs(1));
        clock.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            tokio::select! {
                dialled = &mut dialling => break dialled,
                _ = clock.tick(), if !mode.is_local() => {
                    if let Some(gap_ms) = mode.cloud().and_then(|runtime| runtime.observe_resume()) {
                        emit_event(json_output, "resume", json!({ "gapMs": gap_ms, "source": "clock" }));
                        return Ok(ConnectOutcome::Resumed);
                    }
                }
            }
        }
    };
    let (mut socket, _) = match dialled {
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
    let can_prompt = mode.is_local()
        && !json_output
        && std::io::IsTerminal::is_terminal(&std::io::stdin())
        && std::io::IsTerminal::is_terminal(&std::io::stdout());
    let features = announced_features(mode.is_local());
    let projects = announced_projects(&config_path, projects);
    socket.send(Message::Text(serde_json::to_string(&json!({
        "type": "hello", "protocolVersion": PROTOCOL_VERSION, "deviceId": device_id,
        "cliVersion": CLI_VERSION, "platform": platform(),
        "projects": projects.iter().map(|project| json!({ "id": project.id, "slug": project.slug })).collect::<Vec<_>>(),
        "capabilities": {
            "prompt": can_prompt,
            "tools": ToolName::ALL.iter().map(ToString::to_string).collect::<Vec<_>>(),
            "features": features,
            "workspaceRouting": true,
        },
    }))?.into())).await?;
    emit_event(json_output, "open", json!({}));
    if !json_output {
        println!("✓ Connected. Waiting for tool calls.");
    }

    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<Value>();
    let mut tick = tokio::time::interval(Duration::from_millis(HEARTBEAT_INTERVAL_MS));
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut heartbeat_auto = false;
    // Monotonic on purpose: a wall clock that jumps after a pause must not
    // read as a timeout, and one that stands still must not hide one.
    let mut last_ack = Instant::now();
    let mut last_presence = now_ms();
    // A pause is noticed by the clock, once a second, in both modes; on a
    // laptop that is a lid closed, which deserves the same fresh session.
    let mut local_resume = crate::cloud::clock::ResumeDetector::new();
    let mut resume_tick = tokio::time::interval(Duration::from_secs(1));
    resume_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut roots_tick = tokio::time::interval(Duration::from_secs(1));
    roots_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    let mut known_roots = served_roots(&config_path);
    let gate = mode.cloud().map(|runtime| runtime.hooks.gate());
    let held_terminals: HeldTerminals = Arc::new(StdMutex::new(HashMap::new()));
    // Ends with this connection, however it ends: a terminal that was still
    // waiting at the gate is one the gateway has forgotten by then.
    let connection = CancellationToken::new();
    let _ended = connection.clone().drop_guard();

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
                if heartbeat_auto && last_ack.elapsed().as_millis() as u64 > HEARTBEAT_TIMEOUT_MS {
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
            _ = resume_tick.tick() => {
                let gap = match mode.cloud() {
                    Some(runtime) => runtime.observe_resume(),
                    None => local_resume.check(),
                };
                if let Some(gap_ms) = gap {
                    emit_event(json_output, "resume", json!({ "gapMs": gap_ms, "source": "clock" }));
                    let _ = socket.close(None).await;
                    cancel_all(&in_flight).await;
                    return Ok(ConnectOutcome::Resumed);
                }
            }
            _ = async {
                match mode.cloud() {
                    Some(runtime) => runtime.reconnect_requested().await,
                    None => std::future::pending::<()>().await,
                }
            } => {
                emit_event(json_output, "resume", json!({ "source": "wake" }));
                let _ = socket.close(None).await;
                cancel_all(&in_flight).await;
                return Ok(ConnectOutcome::Resumed);
            }
            incoming = socket.next() => {
                let Some(incoming) = incoming else { break; };
                match incoming? {
                    Message::Text(text) => {
                        let Ok(message) = serde_json::from_str::<Value>(&text) else { continue; };
                        let kind = message.get("type").and_then(Value::as_str);
                        if let Some(runtime) = mode.cloud() && is_work_frame(kind) {
                            runtime.keepalive.touch();
                        }
                        match kind {
                            Some("heartbeat.ack") => {
                                last_ack = Instant::now();
                                match mode.cloud() {
                                    Some(runtime) => runtime.mark_heard(),
                                    None => local_resume.mark(),
                                }
                            }
                            Some("hello.ack") => {
                                heartbeat_auto = message.get("heartbeatMode").and_then(Value::as_str) == Some("auto");
                                last_ack = Instant::now();
                                acked.store(true, Ordering::SeqCst);
                                match mode.cloud() {
                                    Some(runtime) => {
                                        runtime.mark_heard();
                                        // Before the link reads as connected: that is
                                        // what lets the gateway send work, and the gate
                                        // has to be closed by the time it does.
                                        runtime.hooks.hello(message.get("cloudHooks").filter(|hooks| !hooks.is_null()), out_tx.clone());
                                        runtime.mark_connected();
                                    }
                                    None => local_resume.mark(),
                                }
                                publish_mcp_catalogs(mcp.clone(), out_tx.clone(), json_output);
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
                                if mode.is_local() {
                                    engine.kill_all().await;
                                    workspace.kill_all().await;
                                }
                                return Ok(ConnectOutcome::Rejected(reason.to_owned()));
                            }
                            Some("cloud.hook.run") => {
                                if let Some(runtime) = mode.cloud() {
                                    runtime.hooks.run_requested(&message, out_tx.clone());
                                }
                            }
                            Some("tool.call") => {
                                spawn_tool_call(message, config_path.clone(), api.clone(), engine.clone(), workspace.clone(), mcp.clone(), lifecycle_lock.clone(), in_flight.clone(), out_tx.clone(), json_output, !mode.is_local(), gate.clone()).await;
                            }
                            Some("mcp.call") => {
                                spawn_mcp_call(message, config_path.clone(), mcp.clone(), in_flight.clone(), out_tx.clone(), json_output, gate.clone()).await;
                            }
                            Some("workspace.call") => {
                                spawn_workspace_call(message, config_path.clone(), api.clone(), workspace.clone(), lifecycle_lock.clone(), in_flight.clone(), out_tx.clone(), json_output, !mode.is_local()).await;
                            }
                            Some("terminal.open") | Some("terminal.input") | Some("terminal.resize") | Some("terminal.close") => {
                                route_terminal_message(message, config_path.clone(), workspace.clone(), terminal_tx.clone(), gate.clone(), held_terminals.clone(), connection.clone()).await;
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
            // A cloud machine's roots are written once by the bootstrap and
            // never removed, so there is nothing to reconcile there.
            _ = roots_tick.tick(), if mode.is_local() => {
                reconcile_roots(&config_path, &engine, &workspace, &mcp, &in_flight, &mut known_roots).await;
                // Not waited for: discovery starts servers, and the loop has
                // a socket to keep alive.
                let _ = reconcile_projects(&config_path, &mcp, &out_tx, json_output).await;
            }
        }
    }
    cancel_all(&in_flight).await;
    if mode.is_local() {
        engine.kill_all().await;
        workspace.kill_all().await;
    }
    Ok(ConnectOutcome::Disconnected)
}

/// The machine token or personal bearer token is sent during both HTTP
/// discovery and the websocket handshake. Production/cloud connections must
/// therefore use TLS; plain HTTP remains available only for a loopback local
/// gateway used during development.
fn validate_gateway_url(gateway: &str, cloud: bool) -> Result<Url> {
    let url = Url::parse(gateway).context("The gateway URL is invalid")?;
    let host = url.host_str().unwrap_or_default();
    let host_for_ip = host.trim_matches(['[', ']']);
    let loopback = host.eq_ignore_ascii_case("localhost")
        || host_for_ip
            .parse::<std::net::IpAddr>()
            .is_ok_and(|address| address.is_loopback());
    if url.username().is_empty()
        && url.password().is_none()
        && url.fragment().is_none()
        && url.query().is_none()
        && (url.scheme() == "https" || (url.scheme() == "http" && loopback))
    {
        return Ok(url);
    }
    if cloud {
        Err(anyhow!(
            "Cloud relay connections require an HTTPS gateway URL."
        ))
    } else {
        Err(anyhow!(
            "The local gateway URL must use HTTPS, or HTTP on loopback."
        ))
    }
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
    cloud: bool,
    gate: Option<Gate>,
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
    // A cloud project's workspaces are machines the gateway creates and
    // destroys, never checkouts this machine could make. What this machine
    // still owns is the checkout's own `exeora.toml`, applied above: the
    // gateway asks with the tool and acts on the answer, or not at all.
    if cloud && tool.is_workspace_tool() {
        // What a removal does here on a laptop, before the checkout goes:
        // stop everything running in it. The gateway asks what the checkout
        // holds only after this answer, and a command still writing would
        // make that answer stale before it was acted on.
        if matches!(tool, ToolName::DetachWorkspace | ToolName::RemoveWorkspace) {
            cancel_root(&in_flight, &root).await;
            engine.kill_root(&root).await;
            workspace.kill_root(&root).await;
            mcp.kill_root(&root).await;
        }
        let _ = outgoing.send(result_frame(
            &request_id,
            started,
            Ok(json!({ "verdict": "allowed" })),
        ));
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
            root: Some(root.clone()),
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
    let expires_at = message.get("expiresAt").and_then(Value::as_u64);
    tokio::spawn(async move {
        if waits_for_scripts(tool) {
            wait_at_gate(gate.as_ref(), expires_at, &cancel, json_output).await;
        }
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
    gate: Option<Gate>,
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
    // The catalog this process published is the authority on what the tool
    // is, including whether it changes anything, not the frame that named it.
    let Some(descriptor) = mcp.tool(&project.id, &server, &tool) else {
        send_error(
            ErrorCode::UnknownTool,
            "That MCP tool is not exposed for this project.",
        );
        return;
    };
    let remote = message
        .get("policy")
        .cloned()
        .and_then(|value| serde_json::from_value::<CommandPolicy>(value).ok());
    let (policy, problem) = effective_policy(&root, remote);
    if let Some(problem) = problem {
        emit_event(json_output, "error", json!({ "message": problem }));
    }
    let read_only = descriptor
        .annotations
        .as_ref()
        .and_then(|hints| hints.read_only_hint);
    let verdict = mcp_policy_allows(&policy, read_only);
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
            root: Some(root.clone()),
        },
    );
    let exposed = descriptor.exposed_name;
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
    let expires_at = message.get("expiresAt").and_then(Value::as_u64);
    tokio::spawn(async move {
        // A proxied tool may start anything, so it waits like a command.
        wait_at_gate(gate.as_ref(), expires_at, &cancel, json_output).await;
        let result = tokio::select! {
            _ = cancel.cancelled() => Err(ExeoraError::new(
                ErrorCode::Cancelled,
                "The MCP call was cancelled.",
            )),
            result = mcp.call(&project.id, &root, &server, &tool, arguments) => result.map_err(|error| {
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
        if call.canonical_root().as_ref() == Some(&root) {
            call.cancel.cancel();
        }
    }
}

impl ActiveCall {
    fn canonical_root(&self) -> Option<PathBuf> {
        self.root
            .as_ref()
            .map(|root| std::fs::canonicalize(root).unwrap_or_else(|_| root.clone()))
    }
}

/// The projects a hello names: the ones the config holds when the hello is
/// said, not the ones it held when `connect` started. A connection that is
/// made again after a project was cloned or removed says what is true now.
/// What `connect` started with stands in when the config cannot be read.
fn announced_projects(config_path: &Path, at_start: &[ProjectEntry]) -> Vec<ProjectEntry> {
    ConfigStore::load_from(config_path.to_path_buf())
        .map(|config| config.data().projects.clone())
        .unwrap_or_else(|_| at_start.to_vec())
}

/// What this CLI tells the gateway it can do beyond the tools. A machine of
/// Exeora Cloud does not clone projects: it holds the repository it was
/// created for, so only a person's own machine announces that.
fn announced_features(local: bool) -> Vec<&'static str> {
    let mut features = vec![
        SOURCE_CONTROL_V1_FEATURE,
        SOURCE_CONTROL_V2_FEATURE,
        WORKSPACE_V2_FEATURE,
        "terminal-v1",
        "mcp-proxy-v1",
    ];
    if local {
        features.push(PROJECT_CLONE_FEATURE);
    } else {
        // The scripts of a project run in its instances and nowhere else.
        features.extend([CLOUD_FEATURE, CLOUD_HOOKS_FEATURE]);
    }
    features
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

#[allow(clippy::too_many_arguments)]
async fn spawn_workspace_call(
    message: Value,
    config_path: PathBuf,
    api: crate::api::ApiClient,
    workspace: Arc<WorkspaceEngine>,
    lifecycle_lock: LifecycleLock,
    in_flight: InFlight,
    outgoing: mpsc::UnboundedSender<Value>,
    json_output: bool,
    cloud: bool,
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
    let action = message.get("action").cloned().unwrap_or_else(|| json!({}));
    // Answered before the project is looked up: preparing a project is how a
    // machine comes to have one the config does not know yet.
    if action.get("action").and_then(Value::as_str) == Some("project_prepare") {
        if cloud {
            send_error(ExeoraError::new(
                ErrorCode::Forbidden,
                CLOUD_PREPARE_MESSAGE,
            ));
            return;
        }
        let repository = match action
            .get("repository")
            .ok_or_else(|| {
                ExeoraError::new(ErrorCode::InvalidArguments, "A repository is required.")
            })
            .and_then(Repository::from_value)
        {
            Ok(repository) => repository,
            Err(error) => {
                send_error(error);
                return;
            }
        };
        spawn_project_prepare(
            request_id,
            project_id.to_owned(),
            repository,
            started,
            config_path,
            api,
            lifecycle_lock,
            in_flight,
            outgoing,
            json_output,
        )
        .await;
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
    if cloud && action.get("action").and_then(Value::as_str) == Some("workspace_create") {
        send_error(ExeoraError::new(
            ErrorCode::Forbidden,
            CLOUD_WORKSPACE_MESSAGE,
        ));
        return;
    }
    let cancel = CancellationToken::new();
    in_flight.lock().await.insert(
        request_id.clone(),
        ActiveCall {
            cancel: cancel.clone(),
            root: Some(target.root.clone()),
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

/// Clones the project onto this machine, or takes the checkout that is
/// already in its projects folder, and answers with where it is.
///
/// The call waits for the clone but does not own it. When the gateway gives
/// up on the call, or the connection drops, the call ends and the clone goes
/// on: it reports to the gateway how it ended, and the next call finds the
/// project in the config.
#[allow(clippy::too_many_arguments)]
async fn spawn_project_prepare(
    request_id: String,
    project_id: String,
    repository: Repository,
    started: u64,
    config_path: PathBuf,
    api: ApiClient,
    lifecycle_lock: LifecycleLock,
    in_flight: InFlight,
    outgoing: mpsc::UnboundedSender<Value>,
    json_output: bool,
) {
    let cancel = CancellationToken::new();
    in_flight.lock().await.insert(
        request_id.clone(),
        ActiveCall {
            cancel: cancel.clone(),
            root: None,
        },
    );
    emit_event(
        json_output,
        "call",
        json!({ "tool": "project_prepare", "project": repository.slug }),
    );
    if !json_output {
        println!("→ project_prepare ({})", repository.slug);
    }
    tokio::spawn(async move {
        let slug = repository.slug.clone();
        let result = match CloneContext::for_machine(
            &config_path,
            &api,
            &project_id,
            Some(lifecycle_lock),
        ) {
            Ok(context) => prepare_project(context, &project_id, repository, cancel)
                .await
                .map(|prepared| prepared.to_value()),
            Err(error) => Err(error),
        };
        in_flight.lock().await.remove(&request_id);
        let elapsed = now_ms().saturating_sub(started);
        let ok = result.is_ok();
        let _ = outgoing.send(workspace_result_frame(&request_id, started, result));
        emit_event(
            json_output,
            "result",
            json!({ "tool": "project_prepare", "project": slug, "ok": ok, "durationMs": elapsed }),
        );
        if !json_output {
            println!(
                "{} project_prepare ({slug}) {elapsed}ms",
                if ok { "✓" } else { "✗" }
            );
        }
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

/// Hands a terminal frame on, or holds it while a script of the project is
/// making the checkout ready.
///
/// Only an opening waits at the gate. It waits in a task of its own, since
/// this is called from the loop that keeps the socket alive, and what
/// arrives for the same terminal in the meantime is kept and handed on
/// after it in the order it came: input that overtook the opening would be
/// input for a terminal that does not exist.
async fn route_terminal_message(
    message: Value,
    config_path: PathBuf,
    workspace: Arc<WorkspaceEngine>,
    outgoing: mpsc::Sender<Value>,
    gate: Option<Gate>,
    held: HeldTerminals,
    connection: CancellationToken,
) {
    let session = message
        .get("sessionId")
        .and_then(Value::as_str)
        .map(str::to_owned);
    let opening = message.get("type").and_then(Value::as_str) == Some("terminal.open");
    // Decided with the lock held and acted on once it is let go: what is
    // handed on is awaited, and a lock of this kind must not be held then.
    let waiting = {
        let mut held = held.lock().unwrap_or_else(|poison| poison.into_inner());
        if let Some(frames) = session.as_ref().and_then(|session| held.get_mut(session)) {
            // The task that holds this terminal hands the frame on in its turn.
            frames.push(message);
            return;
        }
        match (session, gate.filter(|gate| opening && gate.is_closed())) {
            (Some(session), Some(gate)) => {
                held.insert(session.clone(), vec![message]);
                Ok((session, gate))
            }
            _ => Err(message),
        }
    };
    let (session, gate) = match waiting {
        Ok(waiting) => waiting,
        Err(message) => {
            handle_terminal_message(message, config_path, workspace, outgoing).await;
            return;
        }
    };
    tokio::spawn(async move {
        let opened = tokio::select! {
            _ = gate.wait(gate::bound(None, now_ms())) => true,
            _ = connection.cancelled() => false,
        };
        loop {
            let frames = {
                let mut held = held.lock().unwrap_or_else(|poison| poison.into_inner());
                match held.get_mut(&session) {
                    Some(frames) if !frames.is_empty() => std::mem::take(frames),
                    _ => {
                        held.remove(&session);
                        break;
                    }
                }
            };
            for frame in frames {
                // A connection that ended took its terminals with it.
                if opened && !connection.is_cancelled() {
                    handle_terminal_message(
                        frame,
                        config_path.clone(),
                        workspace.clone(),
                        outgoing.clone(),
                    )
                    .await;
                }
            }
        }
    });
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
    crate::workspace::send_control(
        outgoing,
        json!({ "type": "terminal.error", "sessionId": session_id, "message": message }),
    );
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
            .filter_map(ActiveCall::canonical_root)
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
            if call
                .canonical_root()
                .is_some_and(|root| removed.contains(&root))
            {
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

pub(crate) fn emit_event(json_output: bool, event: &str, fields: Value) {
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
    use super::{
        HeldTerminals, MAX_SOCKET_MESSAGE_BYTES, announced_features, announced_projects,
        awake_event, execute_workspace_tool, handshake_rejection, is_work_frame,
        reconcile_projects, relay_websocket_config, resolve_target, result_frame,
        route_terminal_message, spawn_workspace_call, validate_gateway_url, waits_for_scripts,
    };
    #[cfg(unix)]
    use super::{InFlight, spawn_tool_call};
    use crate::cloud::hooks::gate::Gate;
    use crate::{
        config::{ConfigStore, ProjectEntry, WorkspaceEntry, WorkspaceSyncState},
        error::ErrorCode,
        mcp::McpManager,
        protocol::{MAX_RESULT_BYTES, ToolName},
        testing::Gateway,
        tools::ToolEngine,
        workspace::WorkspaceEngine,
    };
    use serde_json::{Value, json};
    use std::sync::Mutex as StdMutex;
    use std::{collections::HashMap, fs, path::Path, process::Command, sync::Arc, time::Duration};
    use tempfile::tempdir;
    use tokio::sync::{Mutex, mpsc};
    use tokio_util::sync::CancellationToken;

    fn git(cwd: &Path, args: &[&str]) {
        let output = Command::new("git")
            .arg("-C")
            .arg(cwd)
            .args(args)
            .output()
            .expect("git");
        assert!(
            output.status.success(),
            "git {}: {}",
            args.join(" "),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    /// Sends one `workspace.call` through the same door the relay uses and
    /// answers with the result frame.
    async fn workspace_call(
        gateway: &Gateway,
        config_path: &Path,
        project_id: &str,
        action: Value,
        cloud: bool,
    ) -> Value {
        let (outgoing, mut results) = mpsc::unbounded_channel();
        spawn_workspace_call(
            json!({
                "type": "workspace.call",
                "requestId": "req_test",
                "projectId": project_id,
                "action": action,
            }),
            config_path.to_path_buf(),
            gateway.api().await,
            Arc::new(WorkspaceEngine::new()),
            Arc::new(Mutex::new(())),
            Arc::new(Mutex::new(HashMap::new())),
            outgoing,
            true,
            cloud,
        )
        .await;
        tokio::time::timeout(Duration::from_secs(30), results.recv())
            .await
            .expect("an answer in time")
            .expect("an answer")
    }

    /// An MCP server that offers one tool, `echo`, written for the shell
    /// every unix has, so the test needs nothing installed.
    #[cfg(unix)]
    const MCP_SERVER: &str = r#"
while IFS= read -r line; do
  id=$(printf '%s' "$line" | sed -n 's/.*"id":\([0-9][0-9]*\).*/\1/p')
  version=$(printf '%s' "$line" | sed -n 's/.*"protocolVersion":"\([^"]*\)".*/\1/p')
  case "$line" in
    *'"method":"initialize"'*)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"protocolVersion":"%s","capabilities":{"tools":{}},"serverInfo":{"name":"fixture","version":"1"}}}\n' "$id" "$version" ;;
    *'"method":"tools/list"'*)
      printf '{"jsonrpc":"2.0","id":%s,"result":{"tools":[{"name":"echo","description":"Says it back","inputSchema":{"type":"object"}}]}}\n' "$id" ;;
    *'"method":"notifications/'*) ;;
    *) if [ -n "$id" ]; then printf '{"jsonrpc":"2.0","id":%s,"error":{"code":-32601,"message":"Method not found"}}\n' "$id"; fi ;;
  esac
done
"#;

    #[cfg(unix)]
    fn frames(results: &mut mpsc::UnboundedReceiver<Value>) -> Vec<Value> {
        let mut frames = Vec::new();
        while let Ok(frame) = results.try_recv() {
            frames.push(frame);
        }
        frames
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_project_that_appears_while_connected_gets_its_catalog_published() {
        let directory = tempdir().unwrap();
        let script = directory.path().join("server.sh");
        fs::write(&script, MCP_SERVER).unwrap();
        fs::write(
            directory.path().join("mcp.json"),
            json!({ "mcpServers": { "fixture": { "command": "sh", "args": [script] } } })
                .to_string(),
        )
        .unwrap();
        let root = |name: &str| {
            let path = directory.path().join(name);
            fs::create_dir_all(&path).unwrap();
            path
        };
        let project = |id: &str, slug: &str| {
            ProjectEntry::directory(id.to_owned(), slug.to_owned(), slug.to_owned(), root(slug))
        };
        let config_path = directory.path().join("config.json");
        let mut config = ConfigStore::load_from(config_path.clone()).unwrap();
        config.upsert_project(project("prj_a", "a"));
        config.save().unwrap();

        // What `connect` does at start, with the projects it started with.
        let mcp = Arc::new(McpManager::load(&config_path, &config.data().projects));
        assert_eq!(mcp.discover().await, Vec::<String>::new());
        let (outgoing, mut results) = mpsc::unbounded_channel();

        // A look that finds nothing new says nothing.
        assert!(
            reconcile_projects(&config_path, &mcp, &outgoing, true)
                .await
                .is_none()
        );
        assert!(frames(&mut results).is_empty());

        // The gateway had this machine clone a project, or somebody ran
        // `exeora project add` in another terminal.
        config.upsert_project(project("prj_b", "b"));
        config.save().unwrap();
        let publishing = reconcile_projects(&config_path, &mcp, &outgoing, true)
            .await
            .expect("a catalog to publish");
        publishing.await.unwrap();
        let sent = frames(&mut results);
        assert_eq!(sent.len(), 1, "{sent:?}");
        assert_eq!(sent[0]["type"], "mcp.catalog");
        assert_eq!(sent[0]["projectId"], "prj_b");
        assert_eq!(sent[0]["tools"].as_array().map(Vec::len), Some(1));
        assert_eq!(sent[0]["tools"][0]["server"], "fixture");
        assert_eq!(sent[0]["tools"][0]["name"], "echo");
        // And it can be called, which is what the catalog promises.
        assert!(mcp.tool("prj_b", "fixture", "echo").is_some());

        // The project is removed: what the relay holds for it is replaced
        // with nothing, and nothing of it can be called.
        config.remove_project("prj_a");
        config.save().unwrap();
        assert!(
            reconcile_projects(&config_path, &mcp, &outgoing, true)
                .await
                .is_none()
        );
        assert_eq!(
            frames(&mut results),
            [json!({ "type": "mcp.catalog", "projectId": "prj_a", "tools": [] })]
        );
        assert!(mcp.tool("prj_a", "fixture", "echo").is_none());
        assert!(mcp.tool("prj_b", "fixture", "echo").is_some());

        // A config that cannot be read is not a config without projects.
        let saved = fs::read(&config_path).unwrap();
        fs::write(&config_path, "{ not json").unwrap();
        assert!(
            reconcile_projects(&config_path, &mcp, &outgoing, true)
                .await
                .is_none()
        );
        assert!(frames(&mut results).is_empty());
        assert!(mcp.tool("prj_b", "fixture", "echo").is_some());
        fs::write(&config_path, saved).unwrap();

        // A project that moved is published once, from where it is now.
        let mut config = ConfigStore::load_from(config_path.clone()).unwrap();
        config.upsert_project(ProjectEntry {
            root: root("b-moved"),
            ..project("prj_b", "b")
        });
        config.save().unwrap();
        let publishing = reconcile_projects(&config_path, &mcp, &outgoing, true)
            .await
            .expect("a catalog to publish");
        publishing.await.unwrap();
        let sent = frames(&mut results);
        assert_eq!(sent.len(), 1, "{sent:?}");
        assert_eq!(sent[0]["projectId"], "prj_b");
        assert_eq!(sent[0]["tools"][0]["name"], "echo");
        mcp.shutdown().await;
    }

    #[tokio::test]
    async fn a_project_without_servers_has_no_catalog_to_publish() {
        let directory = tempdir().unwrap();
        let config_path = directory.path().join("config.json");
        let mut config = ConfigStore::load_from(config_path.clone()).unwrap();
        config.save().unwrap();
        let mcp = Arc::new(McpManager::load(&config_path, &[]));
        let (outgoing, mut results) = mpsc::unbounded_channel();

        config.upsert_project(ProjectEntry::directory(
            "prj_a".to_owned(),
            "a".to_owned(),
            "A".to_owned(),
            directory.path().to_path_buf(),
        ));
        config.save().unwrap();
        assert!(
            reconcile_projects(&config_path, &mcp, &outgoing, true)
                .await
                .is_none()
        );
        assert!(results.try_recv().is_err());

        // Gone again, the relay is told so: an empty catalog costs nothing
        // and leaves nothing behind whatever was there.
        config.remove_project("prj_a");
        config.save().unwrap();
        assert!(
            reconcile_projects(&config_path, &mcp, &outgoing, true)
                .await
                .is_none()
        );
        assert_eq!(
            results.try_recv().ok(),
            Some(json!({ "type": "mcp.catalog", "projectId": "prj_a", "tools": [] }))
        );
    }

    #[test]
    fn a_hello_names_the_projects_the_config_holds_now() {
        let directory = tempdir().unwrap();
        let config_path = directory.path().join("config.json");
        let at_start = [ProjectEntry::directory(
            "prj_a".to_owned(),
            "a".to_owned(),
            "A".to_owned(),
            directory.path().to_path_buf(),
        )];
        let mut config = ConfigStore::load_from(config_path.clone()).unwrap();
        config.upsert_project(at_start[0].clone());
        config.upsert_project(ProjectEntry::directory(
            "prj_b".to_owned(),
            "b".to_owned(),
            "B".to_owned(),
            directory.path().to_path_buf(),
        ));
        config.save().unwrap();
        let ids = |projects: Vec<ProjectEntry>| {
            projects
                .into_iter()
                .map(|project| project.id)
                .collect::<Vec<_>>()
        };
        assert_eq!(
            ids(announced_projects(&config_path, &at_start)),
            ["prj_a", "prj_b"]
        );
        fs::write(&config_path, "{ not json").unwrap();
        assert_eq!(ids(announced_projects(&config_path, &at_start)), ["prj_a"]);
    }

    #[test]
    fn announces_project_cloning_only_from_a_machine_of_the_person() {
        assert!(announced_features(true).contains(&"project-clone-v1"));
        assert!(!announced_features(true).contains(&"cloud-v1"));
        assert!(announced_features(false).contains(&"cloud-v1"));
        assert!(!announced_features(false).contains(&"project-clone-v1"));
    }

    #[test]
    fn announces_every_workspace_feature_from_either_kind_of_machine() {
        for local in [true, false] {
            let features = announced_features(local);
            assert!(features.contains(&"source-control-v1"), "{features:?}");
            assert!(features.contains(&"source-control-v2"), "{features:?}");
            assert!(features.contains(&"workspace-v2"), "{features:?}");
        }
    }

    #[test]
    fn announces_the_scripts_only_from_an_instance() {
        assert!(announced_features(false).contains(&"cloud-hooks-v1"));
        assert!(!announced_features(true).contains(&"cloud-hooks-v1"));
    }

    #[test]
    fn a_request_to_run_a_script_is_work() {
        assert!(is_work_frame(Some("cloud.hook.run")));
        assert!(is_work_frame(Some("tool.call")));
        assert!(!is_work_frame(Some("hello.ack")));
        assert!(!is_work_frame(Some("heartbeat.ack")));
    }

    /// A machine that serves one project, and the door the relay's calls
    /// come through, with a gate the test holds.
    #[cfg(unix)]
    struct Served {
        _directory: tempfile::TempDir,
        config_path: std::path::PathBuf,
        api: crate::api::ApiClient,
        gate: Gate,
        outgoing: mpsc::UnboundedSender<Value>,
        results: mpsc::UnboundedReceiver<Value>,
    }

    #[cfg(unix)]
    impl Served {
        async fn new() -> Self {
            let directory = tempdir().unwrap();
            let root = directory.path().join("project");
            fs::create_dir(&root).unwrap();
            fs::write(root.join("notes.txt"), "hello\n").unwrap();
            let config_path = directory.path().join("config.json");
            let mut config = ConfigStore::load_from(config_path.clone()).unwrap();
            config.upsert_project(ProjectEntry::directory(
                "prj_1".to_owned(),
                "project".to_owned(),
                "Project".to_owned(),
                fs::canonicalize(&root).unwrap(),
            ));
            config.save().unwrap();
            let (outgoing, results) = mpsc::unbounded_channel();
            Self {
                _directory: directory,
                config_path,
                api: Gateway::gone().api().await,
                gate: Gate::new(),
                outgoing,
                results,
            }
        }

        async fn call(&self, id: &str, tool: &str, arguments: Value, expires_at: Option<u64>) {
            let mut message = json!({
                "type": "tool.call",
                "requestId": id,
                "projectId": "prj_1",
                "tool": tool,
                "arguments": arguments,
            });
            if let Some(expires_at) = expires_at {
                message["expiresAt"] = json!(expires_at);
            }
            spawn_tool_call(
                message,
                self.config_path.clone(),
                self.api.clone(),
                Arc::new(ToolEngine::new().unwrap()),
                Arc::new(WorkspaceEngine::new()),
                Arc::new(McpManager::load(&self.config_path, &[])),
                Arc::new(Mutex::new(())),
                Arc::new(Mutex::new(HashMap::new())),
                self.outgoing.clone(),
                true,
                true,
                Some(self.gate.clone()),
            )
            .await;
        }

        async fn answer(&mut self, within: Duration) -> Option<Value> {
            tokio::time::timeout(within, self.results.recv())
                .await
                .ok()
                .flatten()
        }
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_command_waits_for_the_scripts_and_a_read_does_not() {
        let mut served = Served::new().await;
        let hold = served.gate.hold();

        // A read tells the truth about a checkout in any state.
        served
            .call(
                "req_read",
                "read_file",
                json!({ "path": "notes.txt" }),
                None,
            )
            .await;
        let read = served
            .answer(Duration::from_secs(10))
            .await
            .expect("a read does not wait");
        assert_eq!(read["requestId"], "req_read");
        assert_eq!(read["result"]["ok"], true, "{read}");

        // A command does not start while a script is making the checkout.
        served
            .call(
                "req_run",
                "run_command",
                json!({ "command": "echo ran" }),
                None,
            )
            .await;
        assert_eq!(served.answer(Duration::from_millis(500)).await, None);

        drop(hold);
        let ran = served
            .answer(Duration::from_secs(10))
            .await
            .expect("the command runs once the script is over");
        assert_eq!(ran["requestId"], "req_run");
        assert_eq!(ran["result"]["value"]["stdout"], "ran\n", "{ran}");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_command_goes_ahead_when_the_script_outlasts_its_wait() {
        let mut served = Served::new().await;
        let _hold = served.gate.hold();

        // Its deadline leaves it a fraction of a second to wait, less the
        // margin it keeps for itself.
        let started = std::time::Instant::now();
        served
            .call(
                "req_run",
                "run_command",
                json!({ "command": "echo ran" }),
                Some(crate::protocol::now_ms() + 5_300),
            )
            .await;
        let ran = served
            .answer(Duration::from_secs(10))
            .await
            .expect("the command runs beside the script");
        assert_eq!(ran["result"]["value"]["stdout"], "ran\n", "{ran}");
        assert!(started.elapsed() >= Duration::from_millis(250));
        // The script is still running.
        assert!(served.gate.is_closed());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn a_command_that_is_cancelled_at_the_gate_does_not_go_on_waiting() {
        let mut served = Served::new().await;
        let _hold = served.gate.hold();
        let in_flight: InFlight = Arc::new(Mutex::new(HashMap::new()));
        spawn_tool_call(
            json!({
                "type": "tool.call",
                "requestId": "req_run",
                "projectId": "prj_1",
                "tool": "run_command",
                "arguments": { "command": "echo ran" },
            }),
            served.config_path.clone(),
            served.api.clone(),
            Arc::new(ToolEngine::new().unwrap()),
            Arc::new(WorkspaceEngine::new()),
            Arc::new(McpManager::load(&served.config_path, &[])),
            Arc::new(Mutex::new(())),
            in_flight.clone(),
            served.outgoing.clone(),
            true,
            true,
            Some(served.gate.clone()),
        )
        .await;
        // In flight while it waits, so a cancel finds it and the machine
        // is held awake for it.
        assert_eq!(served.answer(Duration::from_millis(300)).await, None);
        let call = in_flight.lock().await;
        call.get("req_run").expect("in flight").cancel.cancel();
        drop(call);

        let answer = served
            .answer(Duration::from_secs(10))
            .await
            .expect("an answer");
        assert_eq!(answer["result"]["ok"], false);
        assert_eq!(answer["result"]["error"]["code"], "CANCELLED", "{answer}");
        assert!(in_flight.lock().await.is_empty());
    }

    /// The messages of the errors a terminal's frames were answered with,
    /// in the order they were answered.
    async fn terminal_errors(frames: &mut mpsc::Receiver<Value>, count: usize) -> Vec<String> {
        let mut errors = Vec::new();
        while errors.len() < count {
            let Ok(Some(frame)) =
                tokio::time::timeout(Duration::from_secs(10), frames.recv()).await
            else {
                break;
            };
            errors.push(frame["message"].as_str().unwrap_or_default().to_owned());
        }
        errors
    }

    #[tokio::test]
    async fn a_terminal_waits_for_the_scripts_with_what_was_typed_behind_it() {
        let directory = tempdir().unwrap();
        let config_path = directory.path().join("config.json");
        let workspace = Arc::new(WorkspaceEngine::new());
        let (outgoing, mut frames) = mpsc::channel(16);
        let held: HeldTerminals = Arc::new(StdMutex::new(HashMap::new()));
        let connection = CancellationToken::new();
        let gate = Gate::new();
        let hold = gate.hold();
        let send = |message: Value| {
            route_terminal_message(
                message,
                config_path.clone(),
                workspace.clone(),
                outgoing.clone(),
                Some(gate.clone()),
                held.clone(),
                connection.clone(),
            )
        };

        // Neither can succeed, and each fails in words of its own, which is
        // what tells the order they were handled in.
        send(json!({ "type": "terminal.open", "sessionId": "term_1", "cols": 80, "rows": 24 }))
            .await;
        send(json!({ "type": "terminal.input", "sessionId": "term_1", "data": "not base64!" }))
            .await;
        tokio::time::sleep(Duration::from_millis(200)).await;
        assert!(
            frames.try_recv().is_err(),
            "handled while the gate was closed"
        );

        // A terminal that is not waiting is not held up by one that is.
        send(json!({ "type": "terminal.input", "sessionId": "term_2", "data": "not base64!" }))
            .await;
        assert_eq!(
            terminal_errors(&mut frames, 1).await,
            ["Invalid terminal input encoding."]
        );

        drop(hold);
        assert_eq!(
            terminal_errors(&mut frames, 2).await,
            [
                "A terminal project is required.",
                "Invalid terminal input encoding."
            ]
        );
        tokio::time::sleep(Duration::from_millis(50)).await;
        assert!(held.lock().unwrap().is_empty());
    }

    #[tokio::test]
    async fn a_terminal_still_waiting_when_the_connection_ends_is_never_opened() {
        let directory = tempdir().unwrap();
        let (outgoing, mut frames) = mpsc::channel(16);
        let held: HeldTerminals = Arc::new(StdMutex::new(HashMap::new()));
        let connection = CancellationToken::new();
        let gate = Gate::new();
        let _hold = gate.hold();
        route_terminal_message(
            json!({ "type": "terminal.open", "sessionId": "term_1", "cols": 80, "rows": 24 }),
            directory.path().join("config.json"),
            Arc::new(WorkspaceEngine::new()),
            outgoing,
            Some(gate.clone()),
            held.clone(),
            connection.clone(),
        )
        .await;
        assert!(held.lock().unwrap().contains_key("term_1"));

        connection.cancel();
        tokio::time::sleep(Duration::from_millis(200)).await;
        assert!(held.lock().unwrap().is_empty());
        assert!(frames.try_recv().is_err());
    }

    #[tokio::test]
    async fn a_terminal_opens_at_once_when_no_script_is_running() {
        let directory = tempdir().unwrap();
        let (outgoing, mut frames) = mpsc::channel(16);
        let held: HeldTerminals = Arc::new(StdMutex::new(HashMap::new()));
        for gate in [None, Some(Gate::new())] {
            route_terminal_message(
                json!({ "type": "terminal.open", "sessionId": "term_1", "cols": 80, "rows": 24 }),
                directory.path().join("config.json"),
                Arc::new(WorkspaceEngine::new()),
                outgoing.clone(),
                gate,
                held.clone(),
                CancellationToken::new(),
            )
            .await;
            // Handled before the call returned, as it always was.
            assert_eq!(
                frames.try_recv().unwrap()["message"],
                "A terminal project is required."
            );
            assert!(held.lock().unwrap().is_empty());
        }
    }

    #[test]
    fn only_what_starts_something_waits_for_the_scripts() {
        for tool in ToolName::ALL {
            assert_eq!(
                waits_for_scripts(tool),
                matches!(tool, ToolName::RunCommand | ToolName::StartCommand),
                "{tool}"
            );
        }
    }

    #[tokio::test]
    async fn prepares_a_project_the_config_has_never_heard_of() {
        let directory = tempdir().unwrap();
        let root = directory.path().join("projects");
        let checkout = root.join("api");
        fs::create_dir_all(&checkout).unwrap();
        git(&checkout, &["init", "--quiet"]);
        git(
            &checkout,
            &["remote", "add", "origin", "git@github.com:Acme/API.git"],
        );
        let config_path = directory.path().join("config.json");
        let mut config = ConfigStore::load_from(config_path.clone()).unwrap();
        config.data_mut().device_id = Some("dev_laptop".to_owned());
        config.data_mut().projects_root = Some(root.clone());
        config.save().unwrap();
        let gateway = Gateway::start(|_, _, _| (200, json!({ "locations": [] }))).await;

        let frame = workspace_call(
            &gateway,
            &config_path,
            "prj_new",
            json!({
                "action": "project_prepare",
                "repository": {
                    "url": "https://github.com/acme/api.git",
                    "slug": "api",
                    "name": "API",
                    "credential": "machine",
                },
            }),
            false,
        )
        .await;

        assert_eq!(frame["type"], "workspace.result");
        assert_eq!(frame["requestId"], "req_test");
        assert_eq!(frame["result"]["ok"], true, "{frame}");
        assert_eq!(frame["result"]["value"]["kind"], "prepared");
        assert_eq!(frame["result"]["value"]["adopted"], true);
        assert_eq!(
            frame["result"]["value"]["localPath"],
            json!(checkout.to_string_lossy())
        );

        // The project is served from the next call on, from the checkout.
        let resolved = resolve_target(&config_path, "prj_new", None, None).unwrap();
        assert_eq!(resolved.root, fs::canonicalize(&checkout).unwrap());
        assert_eq!(
            resolved.project.repo_url.as_deref(),
            Some("https://github.com/acme/api.git")
        );
        // And the gateway was told where the copy is.
        let reports = gateway.received_as("PUT", "/api/projects/prj_new/locations/dev_laptop");
        assert_eq!(reports.len(), 1);
        assert_eq!(reports[0].body["status"], "ready");
        assert_eq!(
            reports[0].body["localPath"],
            json!(checkout.to_string_lossy())
        );
    }

    #[tokio::test]
    async fn answers_a_prepare_it_cannot_do_with_the_reason() {
        let directory = tempdir().unwrap();
        let config_path = directory.path().join("config.json");
        let mut config = ConfigStore::load_from(config_path.clone()).unwrap();
        config.data_mut().projects_root = Some(directory.path().join("projects"));
        config.save().unwrap();
        let gateway = Gateway::start(|_, _, _| (200, json!({}))).await;
        let repository =
            json!({ "url": "https://github.com/acme/api.git", "slug": "api", "name": "API" });

        // A cloud machine holds one repository and clones no other.
        let frame = workspace_call(
            &gateway,
            &config_path,
            "prj_new",
            json!({ "action": "project_prepare", "repository": repository }),
            true,
        )
        .await;
        assert_eq!(frame["result"]["error"]["code"], "FORBIDDEN");

        for action in [
            json!({ "action": "project_prepare" }),
            json!({ "action": "project_prepare", "repository": { "url": "https://github.com/acme/api.git", "slug": "../api", "name": "API" } }),
            json!({ "action": "project_prepare", "repository": { "url": "file:///srv/api.git", "slug": "api", "name": "API" } }),
        ] {
            let frame = workspace_call(&gateway, &config_path, "prj_new", action, false).await;
            assert_eq!(
                frame["result"]["error"]["code"], "INVALID_ARGUMENTS",
                "{frame}"
            );
        }

        // Every other action still needs a project this machine serves.
        let frame = workspace_call(
            &gateway,
            &config_path,
            "prj_new",
            json!({ "action": "status" }),
            false,
        )
        .await;
        assert_eq!(frame["result"]["error"]["code"], "UNKNOWN_PROJECT");
        assert!(gateway.received().is_empty());
    }

    #[tokio::test]
    async fn ignores_where_in_the_arguments_of_a_workspace_tool() {
        let directory = tempdir().unwrap();
        let repository = directory.path().join("repository");
        fs::create_dir(&repository).unwrap();
        git(&repository, &["init", "--quiet"]);
        git(&repository, &["config", "user.email", "test@example.com"]);
        git(&repository, &["config", "user.name", "Exeora Test"]);
        fs::write(repository.join("tracked.txt"), "main\n").unwrap();
        git(&repository, &["add", "tracked.txt"]);
        git(&repository, &["commit", "--quiet", "-m", "initial"]);
        let config_path = directory.path().join("config.json");
        let mut config = ConfigStore::load_from(config_path.clone()).unwrap();
        config.data_mut().device_id = Some("dev_laptop".to_owned());
        config.data_mut().workspace_root = Some(directory.path().join("workspaces"));
        let project = ProjectEntry {
            id: "prj_1".to_owned(),
            slug: "repository".to_owned(),
            name: "Repository".to_owned(),
            root: fs::canonicalize(&repository).unwrap(),
            repo_url: None,
            default_branch: None,
        };
        config.upsert_project(project.clone());
        config.save().unwrap();
        // The gateway files the workspace under a slug of its own choosing.
        let gateway = Gateway::start(|_, path, body| {
            (
                200,
                json!({
                    "id": path.rsplit('/').next().unwrap_or_default(),
                    "projectId": "prj_1",
                    "slug": "feature-laptop",
                    "name": body["name"],
                    "branch": body["branch"],
                    "localPath": body["localPath"],
                    "managed": true,
                    "createdAt": 1,
                    "updatedAt": 1,
                }),
            )
        })
        .await;
        let api = gateway.api().await;
        let engine = ToolEngine::new().unwrap();
        let lock = Arc::new(Mutex::new(()));

        let listed = execute_workspace_tool(
            &config_path,
            &api,
            &engine,
            &lock,
            &project,
            &project.root,
            None,
            ToolName::ListGitWorkspaces,
            json!({ "where": "laptop" }),
            CancellationToken::new(),
        )
        .await
        .unwrap();
        assert_eq!(listed["workspaces"].as_array().map(Vec::len), Some(1));

        let created = execute_workspace_tool(
            &config_path,
            &api,
            &engine,
            &lock,
            &project,
            &project.root,
            None,
            ToolName::CreateWorkspace,
            json!({ "branch": "feature", "where": "laptop" }),
            CancellationToken::new(),
        )
        .await
        .unwrap();
        // What the caller is told is the slug later calls are routed by.
        assert_eq!(created["workspace"]["slug"], "feature-laptop");
        assert_eq!(created["outcome"], "active");
        let sent = gateway.received();
        assert_eq!(sent.len(), 1);
        assert_eq!(sent[0].body["deviceId"], "dev_laptop");
        assert_eq!(sent[0].body["slug"], "feature");
        assert!(sent[0].body.get("where").is_none());
        let id = created["workspace"]["id"].as_str().unwrap();
        let resolved =
            resolve_target(&config_path, "prj_1", Some(id), Some("feature-laptop")).unwrap();
        assert!(resolved.root.join("tracked.txt").is_file());
    }

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
    fn relay_accepts_a_single_frame_at_the_message_limit() {
        use std::io::Cursor;
        use tokio_tungstenite::tungstenite::protocol::{Role, WebSocket};

        let payload = vec![b'x'; MAX_SOCKET_MESSAGE_BYTES];
        let mut wire = Vec::with_capacity(payload.len() + 10);
        wire.push(0x81); // FIN + text
        wire.push(127); // 64-bit payload length follows
        wire.extend_from_slice(&(payload.len() as u64).to_be_bytes());
        wire.extend_from_slice(&payload);

        let mut socket = WebSocket::from_raw_socket(
            Cursor::new(wire),
            Role::Client,
            Some(relay_websocket_config()),
        );
        let message = socket.read().expect("message at the configured limit");
        assert_eq!(message.into_data().len(), MAX_SOCKET_MESSAGE_BYTES);
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
    fn restricts_plaintext_gateway_connections_to_local_development() {
        assert!(validate_gateway_url("http://127.0.0.1:8787", false).is_ok());
        assert!(validate_gateway_url("http://[::1]:8787", false).is_ok());
        assert!(validate_gateway_url("http://gateway.example", false).is_err());
        assert!(validate_gateway_url("http://127.0.0.1:8787", true).is_ok());
        assert!(validate_gateway_url("wss://gateway.example", true).is_err());
        assert!(validate_gateway_url("https://gateway.example", true).is_ok());
        assert!(validate_gateway_url("https://user:pass@gateway.example", true).is_err());
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
            repo_url: None,
            default_branch: None,
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
