//! Cloud mode: the CLI as the service inside an Exeora Cloud machine.
//!
//! The machine was bootstrapped by the gateway, which wrote `config.json` and
//! a machine token before the service ever started. So there is no sign-in,
//! no device registration and no browser: the CLI reads what is on disk and
//! dials the relay. What it adds over a laptop is everything a paused VM
//! needs (see `http`, `keepalive`, `clock`) and what a shared VM needs (a
//! memory cap per command, in `cgroup`).

pub mod clock;
pub mod commands;
pub mod http;
pub mod keepalive;
pub mod sprite;
pub mod token;

use crate::{
    CLI_VERSION,
    api::ApiClient,
    auth::AuthManager,
    cgroup::{CommandLimits, format_size, parse_size},
    config::ConfigStore,
    connection::{ConnectMode, connect_forever, emit_event},
    protocol::WAKE_PORT,
    tools::ToolEngine,
    workspace::WorkspaceEngine,
};
use anyhow::{Context, Result, anyhow, bail};
use clock::ResumeDetector;
use keepalive::{Busy, Keepalive};
use serde_json::json;
use sprite::SpriteApi;
use std::{
    path::PathBuf,
    sync::{
        Arc, Mutex as StdMutex,
        atomic::{AtomicU64, Ordering},
    },
    time::{Duration, Instant},
};
use tokio::sync::{Notify, watch};

/// The service sets `EXEORA_CLOUD=1`; `--cloud` says the same on the command line.
pub fn enabled_by_env() -> bool {
    std::env::var("EXEORA_CLOUD").is_ok_and(|value| value == "1")
}

#[derive(Debug, Clone)]
pub struct CloudConfig {
    pub token_file: PathBuf,
    pub cgroup_root: Option<PathBuf>,
    pub http_port: u16,
    pub sprite_socket: PathBuf,
    pub memory_max: u64,
    pub memory_total: u64,
}

impl CloudConfig {
    pub fn from_env() -> Result<Self> {
        let token_file = std::env::var_os("EXEORA_MACHINE_TOKEN_FILE")
            .map(PathBuf::from)
            .ok_or_else(|| {
                anyhow!("EXEORA_MACHINE_TOKEN_FILE is not set; this machine was not bootstrapped.")
            })?;
        let size = |name: &str, default: &str| -> Result<u64> {
            let text = std::env::var(name).unwrap_or_else(|_| default.to_owned());
            parse_size(&text).ok_or_else(|| anyhow!("{name} is not a size: {text}"))
        };
        Ok(Self {
            token_file,
            cgroup_root: std::env::var_os("EXEORA_CGROUP_ROOT").map(PathBuf::from),
            http_port: match std::env::var("EXEORA_CLOUD_HTTP_PORT") {
                Ok(value) => value
                    .parse()
                    .context("EXEORA_CLOUD_HTTP_PORT is not a port")?,
                Err(_) => WAKE_PORT,
            },
            sprite_socket: std::env::var_os("EXEORA_SPRITE_API_SOCKET")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("/.sprite/api.sock")),
            memory_max: size("EXEORA_COMMAND_MEMORY_MAX", "6G")?,
            memory_total: size("EXEORA_COMMAND_MEMORY_TOTAL", "7G")?,
        })
    }
}

/// Whether the relay socket is up, as the wake endpoint needs to know it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LinkState {
    Down,
    Connecting,
    /// Counted up on every acknowledged hello, so a waiter can tell a fresh
    /// connection from the one it asked to replace.
    Connected {
        epoch: u64,
    },
}

pub struct CloudRuntime {
    pub config: CloudConfig,
    pub limits: Option<Arc<CommandLimits>>,
    pub keepalive: Arc<Keepalive>,
    json_output: bool,
    link: watch::Sender<LinkState>,
    epoch: AtomicU64,
    reconnect: Notify,
    last_reconnect_request: StdMutex<Option<Instant>>,
    resume: StdMutex<ResumeDetector>,
}

impl CloudRuntime {
    pub fn new(
        config: CloudConfig,
        limits: Option<Arc<CommandLimits>>,
        json_output: bool,
    ) -> Arc<Self> {
        let keepalive = Keepalive::new(SpriteApi::new(config.sprite_socket.clone()));
        let (link, _) = watch::channel(LinkState::Down);
        Arc::new(Self {
            config,
            limits,
            keepalive,
            json_output,
            link,
            epoch: AtomicU64::new(0),
            reconnect: Notify::new(),
            last_reconnect_request: StdMutex::new(None),
            resume: StdMutex::new(ResumeDetector::new()),
        })
    }

    pub fn link(&self) -> watch::Receiver<LinkState> {
        self.link.subscribe()
    }

    pub fn mark_down(&self) {
        self.link.send_replace(LinkState::Down);
    }

    pub fn mark_connecting(&self) {
        self.link.send_replace(LinkState::Connecting);
    }

    pub fn mark_connected(&self) {
        let epoch = self.epoch.fetch_add(1, Ordering::SeqCst) + 1;
        self.link.send_replace(LinkState::Connected { epoch });
    }

    /// The connection was just heard from; a gap is measured from here.
    pub fn mark_heard(&self) {
        if let Ok(mut resume) = self.resume.lock() {
            resume.mark();
        }
    }

    pub fn resume_gap_ms(&self) -> u64 {
        self.resume
            .lock()
            .map(|resume| resume.gap_ms())
            .unwrap_or(0)
    }

    /// Reports a gap past the threshold and marks, for the once-a-second check.
    pub fn resume_check(&self) -> Option<u64> {
        self.resume
            .lock()
            .ok()
            .and_then(|mut resume| resume.check())
    }

    /// Asks the connection loop to drop its socket and dial again. At most
    /// once every few seconds: a wake request that arrives while a reconnect
    /// is already under way must not start another.
    pub fn request_reconnect(&self) -> bool {
        let mut last = self
            .last_reconnect_request
            .lock()
            .unwrap_or_else(|poison| poison.into_inner());
        if last.is_some_and(|at| at.elapsed() < Duration::from_secs(5)) {
            return false;
        }
        *last = Some(Instant::now());
        self.reconnect.notify_one();
        true
    }

    pub async fn reconnect_requested(&self) {
        self.reconnect.notified().await;
    }

    pub fn report_wake(&self, connected: bool, forced: bool, waited_ms: u64) {
        emit_event(
            self.json_output,
            "wake",
            json!({ "connected": connected, "reconnected": forced, "waitedMs": waited_ms }),
        );
    }

    pub fn spawn_http_server(self: &Arc<Self>) {
        let runtime = self.clone();
        let json_output = self.json_output;
        tokio::spawn(async move {
            if let Err(error) = http::serve(runtime, json_output).await {
                emit_event(
                    json_output,
                    "error",
                    json!({ "message": error.to_string() }),
                );
                if !json_output {
                    eprintln!("error: {error}");
                }
                std::process::exit(1);
            }
        });
    }

    pub fn spawn_keepalive(
        self: &Arc<Self>,
        engine: Arc<ToolEngine>,
        workspace: Arc<WorkspaceEngine>,
        in_flight: crate::connection::InFlight,
    ) {
        let json_output = self.json_output;
        let busy: Busy = Arc::new(move || {
            let engine = engine.clone();
            let workspace = workspace.clone();
            let in_flight = in_flight.clone();
            Box::pin(async move {
                !in_flight.lock().await.is_empty()
                    || engine.running_processes().await > 0
                    || workspace.open_terminals().await > 0
            })
        });
        let keepalive = self.keepalive.clone();
        tokio::spawn(keepalive.run(busy, move |ok, error| {
            let mut fields = json!({ "ok": ok });
            if let (Some(fields), Some(error)) = (fields.as_object_mut(), error.as_ref()) {
                fields.insert("error".to_owned(), json!(error));
            }
            emit_event(json_output, "keepalive", fields);
            if !json_output && !ok {
                eprintln!(
                    "warning: could not keep the machine awake: {}",
                    error.unwrap_or_default()
                );
            }
        }));
    }
}

/// `exeora connect --cloud`. Everything it needs is on disk; nothing here
/// asks a person anything.
pub async fn connect(config: ConfigStore, json_output: bool) -> Result<()> {
    match run(config, json_output).await {
        Ok(()) => Ok(()),
        Err(error) => {
            // The runtime restarts the service the moment it exits. A pause
            // first keeps a broken machine from spinning through restarts.
            tokio::time::sleep(fatal_delay()).await;
            Err(error)
        }
    }
}

async fn run(config: ConfigStore, json_output: bool) -> Result<()> {
    let cloud = CloudConfig::from_env()?;
    let device_id = config.data().device_id.clone().ok_or_else(|| {
        anyhow!("config.json names no device; this machine was not bootstrapped.")
    })?;
    let projects = config.data().projects.clone();
    if projects.is_empty() {
        bail!("config.json names no project; this machine was not bootstrapped.");
    }
    // Checked now so a machine without a token fails at start-up with a clear
    // message, rather than on the first connection attempt with a 401.
    token::read(&cloud.token_file)?;

    let http = reqwest::Client::builder()
        .user_agent(format!("exeora/{CLI_VERSION}"))
        .build()?;
    let gateway = config.gateway_url();
    let auth = Arc::new(AuthManager::with_machine_token(
        gateway.clone(),
        http.clone(),
        cloud.token_file.clone(),
    ));
    let api = ApiClient::new(&gateway, http, auth.clone())?;

    let limits = match cloud.cgroup_root.clone() {
        Some(root) => {
            CommandLimits::new(root, cloud.memory_max, cloud.memory_total)
                .init()
                .await
        }
        None => Err("EXEORA_CGROUP_ROOT is not set".to_owned()),
    };
    let (limits, limits_reason) = match limits {
        Ok(limits) => (Some(Arc::new(limits)), None),
        Err(reason) => (None, Some(reason)),
    };
    emit_event(
        json_output,
        "cloud",
        json!({
            "deviceId": device_id,
            "httpPort": cloud.http_port,
            "cgroup": {
                "enabled": limits.is_some(),
                "memoryMax": format_size(cloud.memory_max),
                "reason": limits_reason,
            },
        }),
    );
    if !json_output {
        println!(
            "✓ Cloud mode. Serving {} project(s) as {device_id}.",
            projects.len()
        );
        if let Some(reason) = &limits_reason {
            eprintln!("warning: commands run without a memory limit: {reason}");
        }
    }

    let runtime = CloudRuntime::new(cloud, limits, json_output);
    connect_forever(
        &config,
        &api,
        auth,
        device_id,
        projects,
        json_output,
        ConnectMode::Cloud(runtime),
    )
    .await
}

fn fatal_delay() -> Duration {
    std::env::var("EXEORA_CLOUD_FATAL_DELAY_MS")
        .ok()
        .and_then(|value| value.parse::<u64>().ok())
        .map_or(Duration::from_secs(5), Duration::from_millis)
}
