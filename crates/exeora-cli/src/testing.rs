//! A gateway that lives for one test and answers what the test tells it to.
//!
//! The commands talk to the gateway through `ApiClient`, and what matters
//! about them is what they send and what they do with the answer. This stands
//! in for the gateway on a loopback port, with a session already in the
//! client's hand, so no test reaches for a keychain or for the network.

use crate::{api::ApiClient, auth::AuthManager, protocol::now_ms};
use axum::{
    Router,
    body::{Body, to_bytes},
    extract::Request,
    http::{StatusCode, header::CONTENT_TYPE},
    response::Response,
};
use serde_json::Value;
use std::sync::{Arc, Mutex};

/// A project as `GET /api/projects` lists it, with the fields every listing
/// carries filled in and the ones a test is about given by the test.
pub(crate) fn listed_project(id: &str, slug: &str, fields: Value) -> Value {
    let mut project = serde_json::json!({
        "id": id,
        "slug": slug,
        "name": slug,
        "deviceId": "dev_elsewhere",
        "localPath": format!("/elsewhere/{slug}"),
        "repoUrl": null,
        "defaultBranch": null,
        "locations": [],
        "mcpUrl": format!("https://exeora.test/p/{id}/mcp"),
        "policy": { "mode": "allow_all" },
        "createdAt": 1,
        "cloud": null,
    });
    if let (Some(project), Some(fields)) = (project.as_object_mut(), fields.as_object()) {
        project.extend(fields.clone());
    }
    project
}

/// A location of a project as the gateway lists it.
pub(crate) fn listed_location(device: Option<&str>, name: &str, fields: Value) -> Value {
    let mut location = serde_json::json!({
        "id": format!("loc_{name}"),
        "kind": "local",
        "deviceId": device,
        "name": name,
        "slug": name,
        "localPath": null,
        "status": "ready",
        "error": null,
        "errorCode": null,
        "default": false,
        "online": true,
        "state": "online",
    });
    if let (Some(location), Some(fields)) = (location.as_object_mut(), fields.as_object()) {
        location.extend(fields.clone());
    }
    location
}

/// A request as the gateway received it.
#[derive(Debug, Clone)]
pub(crate) struct Received {
    pub method: String,
    pub path: String,
    pub body: Value,
}

pub(crate) struct Gateway {
    pub url: String,
    received: Arc<Mutex<Vec<Received>>>,
}

impl Gateway {
    /// Starts a gateway that answers every request with what `answer` says
    /// for its method, its path with the query, and its body.
    pub async fn start(
        answer: impl Fn(&str, &str, &Value) -> (u16, Value) + Send + Sync + 'static,
    ) -> Self {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .expect("loopback port");
        let url = format!("http://{}", listener.local_addr().expect("address"));
        let received = Arc::new(Mutex::new(Vec::new()));
        let answer = Arc::new(answer);
        let log = received.clone();
        let app = Router::new().fallback(move |request: Request| {
            let answer = answer.clone();
            let log = log.clone();
            async move {
                let method = request.method().to_string();
                let path = request
                    .uri()
                    .path_and_query()
                    .map_or_else(|| request.uri().path().to_owned(), ToString::to_string);
                let bytes = to_bytes(request.into_body(), 1_000_000)
                    .await
                    .unwrap_or_default();
                let body = serde_json::from_slice(&bytes).unwrap_or(Value::Null);
                let (status, value) = answer(&method, &path, &body);
                log.lock()
                    .expect("log")
                    .push(Received { method, path, body });
                Response::builder()
                    .status(StatusCode::from_u16(status).unwrap_or(StatusCode::OK))
                    .header(CONTENT_TYPE, "application/json")
                    .body(Body::from(value.to_string()))
                    .expect("response")
            }
        });
        tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        Self { url, received }
    }

    /// A gateway that is not there: an address nothing listens on, which is
    /// what a machine without a network sees.
    ///
    /// Not a port that was bound and let go: tests run beside each other,
    /// and another test's gateway took such a port between the two, so a
    /// machine that was meant to be offline got that test's refusals. Port 1
    /// is below anything a system hands out on its own, and nothing listens
    /// on it.
    pub fn gone() -> Self {
        Self {
            url: "http://127.0.0.1:1".to_owned(),
            received: Arc::new(Mutex::new(Vec::new())),
        }
    }

    /// A client of this gateway that is already signed in.
    pub async fn api(&self) -> ApiClient {
        let http = reqwest::Client::builder()
            .no_proxy()
            .build()
            .expect("http client");
        let auth = Arc::new(AuthManager::new(self.url.clone(), http.clone()));
        auth.cache_access_token("test-session".to_owned(), now_ms() + 3_600_000)
            .await;
        ApiClient::new(&self.url, http, auth).expect("api client")
    }

    pub fn received(&self) -> Vec<Received> {
        self.received.lock().expect("log").clone()
    }

    /// The requests of one kind, in the order they arrived.
    pub fn received_as(&self, method: &str, path: &str) -> Vec<Received> {
        self.received()
            .into_iter()
            .filter(|request| request.method == method && request.path == path)
            .collect()
    }
}
