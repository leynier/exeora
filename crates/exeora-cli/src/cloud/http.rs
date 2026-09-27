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
    // The request that reached this handler is what resumed the machine, so
    // the clock is looked at here and now rather than at the next tick. The
    // tick looks at the same clock: what is seen here it will not see again.
    let resumed = runtime.observe_resume();
    let gap_ms = resumed.unwrap_or(0);
    let forced = connected_epoch.is_none() || resumed.is_some();
    if resumed.is_some() {
        // The tick would have dropped the socket for this pause, and now
        // will not. It is dropped from here, whatever was asked a moment ago.
        runtime.reconnect_now();
    } else if forced {
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

#[cfg(test)]
mod tests {
    use super::wake;
    use crate::cloud::{CloudConfig, CloudRuntime, hooks::HookSettings};
    use axum::{extract::State, http::StatusCode};
    use std::{sync::Arc, time::Duration};

    fn runtime(home: &std::path::Path) -> Arc<CloudRuntime> {
        CloudRuntime::new(
            CloudConfig {
                token_file: home.join("token"),
                cgroup_root: None,
                http_port: 0,
                sprite_socket: home.join("api.sock"),
                memory_max: 1 << 30,
                memory_total: 1 << 30,
            },
            None,
            HookSettings::new(home.join("hooks"), home.join("workspace")),
            true,
        )
    }

    /// Stands in for the connection loop: dials again when asked to.
    fn reconnects_when_asked(runtime: &Arc<CloudRuntime>) {
        let runtime = runtime.clone();
        tokio::spawn(async move {
            loop {
                runtime.reconnect_requested().await;
                runtime.mark_connected();
            }
        });
    }

    #[tokio::test]
    async fn a_pause_seen_by_the_wake_request_and_by_the_tick_is_one_pause() {
        let home = tempfile::tempdir().unwrap();
        let runtime = runtime(home.path());
        runtime.mark_connected();
        reconnects_when_asked(&runtime);
        assert_eq!(runtime.generation(), 1);

        runtime.pause_for_test(Duration::from_secs(60));
        let (status, _, body) = wake(State(runtime.clone())).await;
        assert_eq!(status, StatusCode::OK);
        let body: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(body["reconnected"], true);
        assert!(body["gapMs"].as_u64().unwrap() >= 60_000, "{body}");
        assert_eq!(runtime.generation(), 2);

        // The tick of the connection comes a moment later and looks at the
        // same clock. The pause has been seen.
        assert_eq!(runtime.observe_resume(), None);
        assert_eq!(runtime.generation(), 2);
    }

    #[tokio::test]
    async fn the_tick_seeing_it_first_leaves_nothing_for_the_wake_request() {
        let home = tempfile::tempdir().unwrap();
        let runtime = runtime(home.path());
        runtime.mark_connected();
        reconnects_when_asked(&runtime);

        runtime.pause_for_test(Duration::from_secs(60));
        assert!(runtime.observe_resume().is_some_and(|gap| gap >= 60_000));
        assert_eq!(runtime.generation(), 2);

        let (status, _, body) = wake(State(runtime.clone())).await;
        assert_eq!(status, StatusCode::OK);
        let body: serde_json::Value = serde_json::from_str(&body).unwrap();
        assert_eq!(body["reconnected"], false);
        assert_eq!(runtime.generation(), 2);
    }

    #[tokio::test]
    async fn every_pause_is_a_generation_of_its_own() {
        let home = tempfile::tempdir().unwrap();
        let runtime = runtime(home.path());
        for expected in 2..5 {
            runtime.pause_for_test(Duration::from_secs(30));
            assert!(runtime.observe_resume().is_some());
            assert_eq!(runtime.generation(), expected);
        }
        // A second that passed is not a pause.
        assert_eq!(runtime.observe_resume(), None);
        assert_eq!(runtime.generation(), 4);
    }

    #[tokio::test]
    async fn a_frame_read_as_the_machine_thaws_does_not_hide_the_pause() {
        let home = tempfile::tempdir().unwrap();
        let runtime = runtime(home.path());
        runtime.pause_for_test(Duration::from_secs(60));
        runtime.mark_heard();
        assert!(runtime.observe_resume().is_some());
        assert_eq!(runtime.generation(), 2);
        // Heard from with no pause behind it, the mark moves as before.
        runtime.mark_heard();
        assert_eq!(runtime.observe_resume(), None);
    }
}
