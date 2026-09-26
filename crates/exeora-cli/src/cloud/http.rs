//! The one inbound door of a cloud machine.
//!
//! The Sprite proxy routes requests for the machine's URL to this port, and a
//! request arriving is what resumes a paused machine. The gateway uses that:
//! before it dispatches to a machine that may be asleep it fetches `/wake`,
//! and dispatches only on a 200, which this answers once the relay socket is
//! connected and acknowledged. Anything else is 503, and the gateway asks
//! again a second later.

use super::{CloudRuntime, LinkState};
use crate::{CLI_VERSION, protocol::WAKE_TIMEOUT_MS};
use axum::{
    Router,
    extract::State,
    http::{StatusCode, header::CONTENT_TYPE},
    routing::get,
};
use serde_json::json;
use std::{sync::Arc, time::Duration};

type Reply = (
    StatusCode,
    [(axum::http::HeaderName, &'static str); 1],
    String,
);

/// Binds the loopback port and serves until the process ends. The bind is
/// retried for half a minute: the runtime may start the service before the
/// previous instance has let the port go.
pub async fn serve(runtime: Arc<CloudRuntime>, json_output: bool) -> anyhow::Result<()> {
    let address = format!("127.0.0.1:{}", runtime.config.http_port);
    let mut attempts = 0;
    let listener = loop {
        match tokio::net::TcpListener::bind(&address).await {
            Ok(listener) => break listener,
            Err(error) if attempts < 15 => {
                attempts += 1;
                crate::connection::emit_event(
                    json_output,
                    "notice",
                    json!({ "message": format!("Could not bind {address} ({error}); retrying.") }),
                );
                tokio::time::sleep(Duration::from_secs(2)).await;
            }
            Err(error) => {
                anyhow::bail!("Could not bind {address}: {error}. Is another exeora running here?")
            }
        }
    };
    let app = Router::new()
        .route("/wake", get(wake))
        .route("/healthz", get(healthz))
        .with_state(runtime);
    axum::serve(listener, app).await?;
    Ok(())
}

async fn wake(State(runtime): State<Arc<CloudRuntime>>) -> Reply {
    let started = tokio::time::Instant::now();
    let mut link = runtime.link();
    let connected_epoch = match *link.borrow() {
        LinkState::Connected { epoch } => Some(epoch),
        _ => None,
    };
    // The request that reached this handler is what resumed the machine, so a
    // gap is measured here and now rather than waiting for the next tick.
    let gap_ms = runtime.resume_gap_ms();
    let forced = connected_epoch.is_none() || gap_ms > crate::protocol::RESUME_GAP_MS;
    if forced {
        runtime.request_reconnect();
    }
    runtime.keepalive.touch();

    let ready = |state: &LinkState| match (state, connected_epoch, forced) {
        (LinkState::Connected { .. }, _, false) => true,
        (LinkState::Connected { epoch }, Some(before), true) => *epoch > before,
        (LinkState::Connected { .. }, None, true) => true,
        _ => false,
    };
    let waited = tokio::time::timeout(Duration::from_millis(WAKE_TIMEOUT_MS), link.wait_for(ready));
    let connected = waited.await.is_ok_and(|result| result.is_ok());
    let waited_ms = started.elapsed().as_millis() as u64;
    runtime.report_wake(connected, forced, waited_ms);
    if connected {
        reply(
            StatusCode::OK,
            json!({ "ok": true, "reconnected": forced, "waitedMs": waited_ms, "gapMs": gap_ms }),
        )
    } else {
        reply(
            StatusCode::SERVICE_UNAVAILABLE,
            json!({ "ok": false, "link": "connecting", "waitedMs": waited_ms }),
        )
    }
}

async fn healthz(State(runtime): State<Arc<CloudRuntime>>) -> Reply {
    let link = match *runtime.link().borrow() {
        LinkState::Down => "down",
        LinkState::Connecting => "connecting",
        LinkState::Connected { .. } => "connected",
    };
    reply(
        StatusCode::OK,
        json!({ "ok": true, "link": link, "version": CLI_VERSION }),
    )
}

fn reply(status: StatusCode, body: serde_json::Value) -> Reply {
    (
        status,
        [(CONTENT_TYPE, "application/json")],
        body.to_string(),
    )
}
