use anyhow::{Context, Result, anyhow, bail};
use axum::{
    Router,
    extract::{Query, State},
    http::{HeaderValue, StatusCode, header},
    response::{Html, IntoResponse, Response},
    routing::get,
};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use reqwest::StatusCode as ReqwestStatus;
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex as StdMutex},
    time::Duration,
};
use tokio::sync::oneshot;
use uuid::Uuid;

use super::{
    ChatgptService, DYNAMIC_CLIENT_ID, FULL_SCOPE, MAX_OAUTH_BYTES, now_millis,
    store::{StoredAccount, now_secs},
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum LoginMode {
    New,
    Reauth,
    EnablePlan,
}

impl LoginMode {
    fn from_requested(value: Option<&str>, has_registration: bool) -> Result<Self> {
        match value {
            Some("new") => Ok(Self::New),
            Some("reauth") => Ok(Self::Reauth),
            Some("enable_plan") => Ok(Self::EnablePlan),
            Some(_) => bail!("Unknown ChatGPT login mode."),
            None if has_registration => Ok(Self::Reauth),
            None => Ok(Self::New),
        }
    }

    fn as_str(self) -> &'static str {
        match self {
            Self::New => "new",
            Self::Reauth => "reauth",
            Self::EnablePlan => "enable_plan",
        }
    }
}

#[derive(Debug, Clone)]
pub(crate) struct PendingAttempt {
    pub mode: LoginMode,
    pub state: String,
    pub nonce: String,
    pub verifier: String,
    pub redirect_uri: String,
    pub client_id: String,
    pub active_revision: Option<String>,
    pub logout_revision: Option<String>,
    pub expires_at: u64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
pub(crate) struct TokenResponse {
    pub(crate) access_token: Option<String>,
    pub(crate) refresh_token: Option<String>,
    pub(crate) id_token: Option<String>,
    pub(crate) token_type: Option<String>,
    pub(crate) expires_in: Option<u64>,
    pub(crate) scope: Option<String>,
    pub(crate) client_id: Option<String>,
    #[serde(default)]
    pub(crate) earliest_refresh_at: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct OAuthError {
    #[serde(default)]
    error: Option<String>,
}

struct CallbackState {
    expected_state: String,
    sender: StdMutex<Option<oneshot::Sender<HashMap<String, String>>>>,
}

pub(crate) async fn start(service: &ChatgptService, requested_mode: Option<&str>) -> Result<Value> {
    let session_lock = service.store.session_lock().await?;
    let logout_revision = service.store.logout_revision()?;
    let active = service.store.load_active()?;
    let active_revision = service.store.active_revision()?;
    let mode = LoginMode::from_requested(requested_mode, active.is_some())?;
    if !matches!(mode, LoginMode::New) && active.is_none() {
        bail!("No saved ChatGPT registration is available for this login mode.");
    }
    service.cancel_pending().await;
    service.set_last_error("").await;
    drop(session_lock);
    let host = super::host::load_or_create(&service.store)?;
    let client_id = match mode {
        LoginMode::New => service
            .store
            .provisional_client_id()?
            .unwrap_or_else(|| DYNAMIC_CLIENT_ID.to_owned()),
        LoginMode::Reauth | LoginMode::EnablePlan => active
            .as_ref()
            .map(|account| account.client_id.clone())
            .ok_or_else(|| anyhow!("No saved ChatGPT registration is available."))?,
    };
    let state = random_string();
    let nonce = random_string();
    let verifier = random_string();
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));

    let preferred_address = if cfg!(test) {
        "127.0.0.1:0"
    } else {
        "127.0.0.1:1455"
    };
    let listener = match tokio::net::TcpListener::bind(preferred_address).await {
        Ok(listener) => listener,
        Err(_) => tokio::net::TcpListener::bind("127.0.0.1:0")
            .await
            .context("Could not bind the ChatGPT loopback callback.")?,
    };
    let port = listener.local_addr()?.port();
    let redirect_uri = format!("http://127.0.0.1:{port}/auth/callback");
    let mut authorize = service.endpoints.authorize.clone();
    {
        let mut query = authorize.query_pairs_mut();
        query
            .append_pair("response_type", "code")
            .append_pair("client_id", &client_id)
            .append_pair("ext_agent_host_id", &host.ext_agent_host_id)
            .append_pair("redirect_uri", &redirect_uri)
            .append_pair("scope", FULL_SCOPE)
            .append_pair("resource", super::RESOURCE)
            .append_pair("state", &state)
            .append_pair("nonce", &nonce)
            .append_pair("code_challenge", &challenge)
            .append_pair("code_challenge_method", "S256");
        if matches!(mode, LoginMode::New) && client_id == DYNAMIC_CLIENT_ID {
            query.append_pair("agent_name_hint", "Exeora");
        }
        if matches!(mode, LoginMode::EnablePlan) {
            query.append_pair("prompt", "consent");
        }
        if matches!(mode, LoginMode::Reauth | LoginMode::EnablePlan)
            && let Some(email) = active.as_ref().and_then(|account| account.email.as_deref())
            && valid_login_hint(email)
        {
            query.append_pair("login_hint", email);
        }
    }

    let (callback_tx, callback_rx) = oneshot::channel();
    let callback_state = Arc::new(CallbackState {
        expected_state: state.clone(),
        sender: StdMutex::new(Some(callback_tx)),
    });
    let app = Router::new()
        .route("/auth/callback", get(callback))
        .with_state(callback_state);
    let pending = PendingAttempt {
        mode,
        state,
        nonce,
        verifier,
        redirect_uri,
        client_id,
        active_revision,
        logout_revision,
        expires_at: now_millis() + 10 * 60 * 1000,
    };
    // Pair the attempt and its task atomically. Concurrent starts can both
    // pass the initial cancellation before binding their listeners.
    let mut current = service.pending.lock().await;
    let mut current_task = service.pending_task.lock().await;
    if let Some(previous) = current_task.take() {
        previous.abort();
    }
    *current = Some(pending.clone());
    let owned = service.clone_arc();
    let expires_at = pending.expires_at;
    let task = tokio::spawn(async move {
        // Keep the listener in this task. A previous implementation spawned a
        // second detached server task, so aborting the pending task left the
        // loopback port open until the process exited. Dropping this single
        // select future closes the listener on callback, timeout, and cancel.
        let expected_revision = (
            pending.active_revision.clone(),
            pending.logout_revision.clone(),
        );
        let callback = tokio::select! {
            result = callback_rx => result.ok(),
            result = axum::serve(listener, app) => {
                let _ = result;
                None
            },
            _ = tokio::time::sleep(Duration::from_secs(600)) => None,
            _ = super::session::superseded(&owned.store, &expected_revision) => {
                owned.clear_pending(&pending.state).await;
                return;
            },
        };
        if finish(owned.clone(), pending.clone(), callback)
            .await
            .is_err()
        {
            owned.set_last_error("temporarily_unavailable").await;
            owned.clear_pending(&pending.state).await;
        }
    });
    *current_task = Some(task);

    Ok(json!({
        "kind": "chatgpt_login",
        "authorizeUrl": authorize.to_string(),
        "expiresAt": expires_at,
        "mode": mode.as_str(),
    }))
}

pub(crate) async fn cancel(service: &ChatgptService) -> Result<()> {
    service.cancel_pending().await;
    Ok(())
}

async fn finish(
    service: Arc<ChatgptService>,
    pending: PendingAttempt,
    callback: Option<HashMap<String, String>>,
) -> Result<()> {
    if service.store.logout_revision()? != pending.logout_revision {
        service.clear_pending(&pending.state).await;
        return Ok(());
    }
    let Some(callback) = callback else {
        service.set_last_error("login_timeout").await;
        service.clear_pending(&pending.state).await;
        return Ok(());
    };

    // The callback handler already filters the one-shot sender by state. Keep
    // this check as a second boundary so direct/unit callers cannot bypass
    // the CSRF validation.
    let returned_state = callback
        .get("state")
        .map(String::as_str)
        .unwrap_or_default();
    if !constant_time_eq(returned_state.as_bytes(), pending.state.as_bytes()) {
        service.set_last_error("state_mismatch").await;
        service.clear_pending(&pending.state).await;
        return Ok(());
    }
    if callback.get("error").map(String::as_str) == Some("access_denied") {
        // Consent was not completed. Preserve the selected account exactly as
        // it was, especially when a new registration was started while an
        // existing account was active.
        service.set_last_error("plan_disabled").await;
        service.clear_pending(&pending.state).await;
        return Ok(());
    }
    if let Some(error) = callback.get("error") {
        let failure = classify_oauth_error(error);
        if failure == "client_invalid" && matches!(pending.mode, LoginMode::New) {
            service
                .store
                .forget_provisional_client(&pending.client_id)
                .await?;
        }
        if failure == "client_invalid"
            && !matches!(pending.mode, LoginMode::New)
            && !service.invalidate_client(&pending.client_id).await?
        {
            service.set_last_error("reconnect").await;
            service.clear_pending(&pending.state).await;
            return Ok(());
        }
        service.set_last_error(failure).await;
        service.clear_pending(&pending.state).await;
        return Ok(());
    }
    let Some(code) = callback.get("code").filter(|code| !code.is_empty()) else {
        service.set_last_error("missing_code").await;
        service.clear_pending(&pending.state).await;
        return Ok(());
    };
    let callback_client = callback.get("client_id").map(String::as_str);
    match pending.mode {
        LoginMode::New
            if pending.client_id == DYNAMIC_CLIENT_ID
                && (callback_client.is_none()
                    || callback_client.is_some_and(|client_id| {
                        client_id.is_empty()
                            || constant_time_eq(client_id.as_bytes(), DYNAMIC_CLIENT_ID.as_bytes())
                    })) =>
        {
            service.set_last_error("registration_incomplete").await;
            service.clear_pending(&pending.state).await;
            return Ok(());
        }
        _ if pending.client_id != DYNAMIC_CLIENT_ID
            && callback_client.is_some_and(|client_id| {
                !constant_time_eq(client_id.as_bytes(), pending.client_id.as_bytes())
            }) =>
        {
            service.set_last_error("client_mismatch").await;
            service.clear_pending(&pending.state).await;
            return Ok(());
        }
        _ => {}
    }

    let exchange_client_id = match pending.mode {
        LoginMode::New if pending.client_id == DYNAMIC_CLIENT_ID => {
            callback_client.expect("new registration was checked above")
        }
        _ => pending.client_id.as_str(),
    };
    if matches!(pending.mode, LoginMode::New) {
        service
            .store
            .remember_provisional_client(exchange_client_id)
            .await?;
    }
    let discovery = match service.discovery().await {
        Ok(discovery) => discovery,
        Err(_) => {
            service.set_last_error("temporarily_unavailable").await;
            service.clear_pending(&pending.state).await;
            return Ok(());
        }
    };
    let response = service
        .http
        .post(service.endpoints.token.as_str())
        .form(&[
            ("grant_type", "authorization_code"),
            ("client_id", exchange_client_id),
            ("code", code.as_str()),
            ("code_verifier", pending.verifier.as_str()),
            ("redirect_uri", pending.redirect_uri.as_str()),
            ("resource", super::RESOURCE),
        ])
        .send()
        .await;
    let response = match response {
        Ok(response) => response,
        Err(_) => {
            service.set_last_error("temporarily_unavailable").await;
            service.clear_pending(&pending.state).await;
            return Ok(());
        }
    };
    let status = response.status();
    let bytes = match super::read_bounded(response, MAX_OAUTH_BYTES).await {
        Ok(bytes) => bytes,
        Err(_) => {
            service.set_last_error("temporarily_unavailable").await;
            service.clear_pending(&pending.state).await;
            return Ok(());
        }
    };
    if bytes.len() > MAX_OAUTH_BYTES || !status.is_success() {
        let code = serde_json::from_slice::<OAuthError>(&bytes)
            .ok()
            .and_then(|error| error.error)
            .unwrap_or_else(|| {
                if status == ReqwestStatus::BAD_REQUEST {
                    "invalid_grant".to_owned()
                } else {
                    "temporarily_unavailable".to_owned()
                }
            });
        let failure = classify_oauth_error(&code);
        if failure == "client_invalid" && matches!(pending.mode, LoginMode::New) {
            service
                .store
                .forget_provisional_client(exchange_client_id)
                .await?;
        }
        if failure == "client_invalid"
            && !matches!(pending.mode, LoginMode::New)
            && !service.invalidate_client(&pending.client_id).await?
        {
            service.set_last_error("reconnect").await;
            service.clear_pending(&pending.state).await;
            return Ok(());
        }
        service.set_last_error(failure).await;
        service.clear_pending(&pending.state).await;
        return Ok(());
    }
    let token: TokenResponse = match serde_json::from_slice(&bytes) {
        Ok(token) => token,
        Err(_) => {
            service.set_last_error("invalid_token_response").await;
            service.clear_pending(&pending.state).await;
            return Ok(());
        }
    };
    // The callback's issued ID is authoritative for a new registration. A
    // returning callback may omit it, in which case the pending saved ID is
    // authoritative. A token response may repeat the ID, but may never
    // replace either authoritative value.
    let issued_client_id = exchange_client_id.to_owned();
    if let Some(token_client_id) = token.client_id.as_deref()
        && !constant_time_eq(token_client_id.as_bytes(), issued_client_id.as_bytes())
    {
        service.set_last_error("client_mismatch").await;
        service.clear_pending(&pending.state).await;
        return Ok(());
    }
    let Some(id_token) = token.id_token.as_deref() else {
        service.set_last_error("invalid_id_token").await;
        service.clear_pending(&pending.state).await;
        return Ok(());
    };
    let identity = match service
        .verify_id_token(&discovery, id_token, &issued_client_id, &pending.nonce)
        .await
    {
        Ok(identity) => identity,
        Err(_) => {
            service.set_last_error("invalid_id_token").await;
            service.clear_pending(&pending.state).await;
            return Ok(());
        }
    };

    if !matches!(pending.mode, LoginMode::New)
        && !service.store.account_path(&issued_client_id).exists()
    {
        service.set_last_error("reconnect").await;
        service.clear_pending(&pending.state).await;
        return Ok(());
    }
    let Some(token_type) = token.token_type.filter(|value| {
        !value.is_empty()
            && value.len() <= 32
            && !value
                .bytes()
                .any(|byte| byte.is_ascii_control() || byte.is_ascii_whitespace())
    }) else {
        service.set_last_error("invalid_token_response").await;
        service.clear_pending(&pending.state).await;
        return Ok(());
    };
    let Some(expires_in) = token.expires_in.filter(|seconds| *seconds > 0) else {
        service.set_last_error("invalid_token_response").await;
        service.clear_pending(&pending.state).await;
        return Ok(());
    };
    let scopes = match token.scope.as_deref().map(super::parse_scopes).transpose() {
        Ok(scopes) => scopes.unwrap_or_default(),
        Err(_) => {
            service.set_last_error("invalid_token_response").await;
            service.clear_pending(&pending.state).await;
            return Ok(());
        }
    };
    let Some(access_token) = token.access_token.filter(|value| !value.is_empty()) else {
        service.set_last_error("invalid_token_response").await;
        service.clear_pending(&pending.state).await;
        return Ok(());
    };
    let expires_at = Some(now_secs().saturating_add(expires_in));
    // Only honor the explicit absolute `earliest_refresh_at` field. A refresh
    // token lifetime is not the server-advised time at which refresh may begin.
    let earliest_refresh_at = token.earliest_refresh_at;
    let subject = identity.subject.clone();
    let (email, label) =
        super::id_token::public_profile(identity.email.as_deref(), identity.label.as_deref());
    let account = StoredAccount {
        email,
        issuer: identity.issuer,
        subject,
        client_id: issued_client_id,
        ext_agent_host_id: match super::host::load_or_create(&service.store) {
            Ok(host) => host.ext_agent_host_id,
            Err(_) => {
                service.set_last_error("temporarily_unavailable").await;
                service.clear_pending(&pending.state).await;
                return Ok(());
            }
        },
        id_token: Some(id_token.to_owned()),
        access_token: Some(access_token),
        refresh_token: token.refresh_token,
        token_type,
        expires_at,
        earliest_refresh_at,
        scopes,
        saved_at: now_secs(),
        label: Some(label),
        state: None,
        new_registration: matches!(pending.mode, LoginMode::New),
    };
    match service
        .activate_account_inner(
            &account,
            Some(&(
                pending.active_revision.clone(),
                pending.logout_revision.clone(),
            )),
        )
        .await
    {
        Ok(true) => {}
        Ok(false) => {
            if super::session::revision(&service.store)?
                == (
                    pending.active_revision.clone(),
                    pending.logout_revision.clone(),
                )
            {
                service.set_last_error("subject_mismatch").await;
            }
            service.clear_pending(&pending.state).await;
            return Ok(());
        }
        Err(_) => {
            service.set_last_error("temporarily_unavailable").await;
            service.clear_pending(&pending.state).await;
            return Ok(());
        }
    }
    service
        .store
        .forget_provisional_client(&account.client_id)
        .await?;
    service.set_last_error("").await;
    service.clear_pending(&pending.state).await;
    Ok(())
}

async fn callback(
    State(state): State<Arc<CallbackState>>,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let returned_state = params.get("state").map(String::as_str).unwrap_or_default();
    if !constant_time_eq(returned_state.as_bytes(), state.expected_state.as_bytes()) {
        // Do not consume the one-shot channel on a forged or stale callback;
        // the browser can still deliver the real callback for this attempt.
        return callback_response(StatusCode::BAD_REQUEST);
    }
    if let Ok(mut sender) = state.sender.lock()
        && let Some(sender) = sender.take()
    {
        let _ = sender.send(params);
    }
    callback_response(StatusCode::OK)
}

fn callback_response(status: StatusCode) -> Response {
    (
        status,
        [
            (header::CACHE_CONTROL, HeaderValue::from_static("no-store")),
            (
                header::REFERRER_POLICY,
                HeaderValue::from_static("no-referrer"),
            ),
        ],
        Html("<!doctype html><title>Exeora</title><p>You can close this tab.</p>"),
    )
        .into_response()
}

fn random_string() -> String {
    let first = Uuid::new_v4();
    let second = Uuid::new_v4();
    let mut bytes = Vec::with_capacity(32);
    bytes.extend_from_slice(first.as_bytes());
    bytes.extend_from_slice(second.as_bytes());
    URL_SAFE_NO_PAD.encode(bytes)
}

fn valid_login_hint(value: &str) -> bool {
    value.len() <= 320
        && value.contains('@')
        && !value
            .bytes()
            .any(|byte| byte.is_ascii_control() || byte == b' ')
}

fn classify_oauth_error(value: &str) -> &'static str {
    match value {
        "access_denied" => "plan_disabled",
        "invalid_grant" | "invalid_request" => "reconnect",
        "invalid_client" => "client_invalid",
        _ => "temporarily_unavailable",
    }
}

fn constant_time_eq(left: &[u8], right: &[u8]) -> bool {
    let mut difference = left.len() ^ right.len();
    for index in 0..left.len().max(right.len()) {
        difference |= usize::from(
            left.get(index).copied().unwrap_or_default()
                ^ right.get(index).copied().unwrap_or_default(),
        );
    }
    difference == 0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chatgpt::{ChatgptService, store::Store};
    use axum::{
        Router,
        body::{Body, to_bytes},
        extract::Request,
        http::header::CONTENT_TYPE,
        response::IntoResponse,
        routing::{get, post},
    };
    use serde_json::json;
    use std::{
        sync::atomic::{AtomicBool, Ordering},
        sync::{Arc, Mutex},
        time::Instant,
    };
    use tempfile::tempdir;
    use tokio::time::{Duration, sleep};
    use url::Url;

    #[test]
    fn login_mode_defaults_to_reauth_for_a_saved_registration() {
        assert_eq!(
            LoginMode::from_requested(None, true).unwrap(),
            LoginMode::Reauth
        );
        assert_eq!(
            LoginMode::from_requested(None, false).unwrap(),
            LoginMode::New
        );
    }

    #[test]
    fn callback_state_must_match_before_other_parameters() {
        assert!(!constant_time_eq(b"wrong", b"expected"));
        assert!(!constant_time_eq(b"", b"expected"));
        assert!(!constant_time_eq(&[0; 256], &[]));
        let dir = tempdir().unwrap();
        let store = Store::for_test(dir.path());
        assert!(store.load_active().unwrap().is_none());
    }

    #[test]
    fn login_hint_rejects_control_and_space() {
        assert!(valid_login_hint("person@example.test"));
        assert!(!valid_login_hint("person @example.test"));
        assert!(!valid_login_hint("person@example.test\n"));
    }

    fn account(client_id: &str, subject: &str) -> StoredAccount {
        StoredAccount {
            email: Some("person@example.test".to_owned()),
            issuer: "https://auth.openai.com".to_owned(),
            subject: subject.to_owned(),
            client_id: client_id.to_owned(),
            ext_agent_host_id: "urn:uuid:123e4567-e89b-12d3-a456-426614174000".to_owned(),
            id_token: Some("retained-id-token".to_owned()),
            access_token: Some("access".to_owned()),
            refresh_token: Some("refresh".to_owned()),
            token_type: "Bearer".to_owned(),
            expires_at: Some(now_secs() + 3600),
            earliest_refresh_at: None,
            scopes: vec!["openid".to_owned()],
            saved_at: now_secs(),
            label: Some("person@example.test".to_owned()),
            state: None,
            new_registration: false,
        }
    }

    const TEST_KID: &str = "openai-test-key";
    // AWS-LC's RSA signer expects a PKCS#1 DER key. This fixture is test-only.
    const TEST_RSA_PRIVATE_DER_B64: &str = "MIIEpQIBAAKCAQEAlPWZd19WJMoXD7/tc45DIasahGQhRHY2gtDoqQAQAVaFpC6+1SO7az8lLdFzuFGwCNv1KTMwRbIBRO8sAu5bq3P33zRxS4mdmjMousEy7SbUiW6m8lnPD/wNV6JALqadJN3V4FV6pGh5DMYAuRZhUYMUliCVyijqFaf38zVMSneS7U8x2Qa6Dw5cFqxg8S+lpTh/pFdjsTEz+83OHgbPOfvSk3/seYoLxdYojvkdrsGJrxmLly0B/L+z2GO/Ct2MQVtwcHLPqYdwjerJaqA2lc2gypkHYTDU+6yqQhhfgivXws5QnG//djWWFaXjr1N+5VCFZTGox7kTMPU8fymxTwIDAQABAoIBAAEIcJ7yPT5WL3zfadoCtBLTlFdgzp2LvyNg3G7/lqRaysZ1SEro6ZVWVqUxosJFC+zB65w/xCd1sSLqEIFcsrr7aSD7taVroVsZNwRipD48xDn07iDbo/0/F/ryEIGGE6xtL77bGOSgY24Jt5bcSTkv1fzUDyMJC/OxyawoFtCkbs7lk0vMlIZFgzNOimJTNx9B59TNx6A5tJLukfvzlNxM9EUdGvVH7ccFkvsGZ3OEHhsmNXgpZZmhe55+pTAIO5Sy7TGUqp1tqaSEpsZI/vanDQki4kf7yVs06XPFs0m5O1lV80qaaxpVjsiybayN6G82Or1SBkqN2CuC/Q2rNYECgYEAxXf0m9QetGnK9+piySAZVkB5RyVENAy2Ls+3JC18z/NJqCSsdnJqEYGVSwZM4vNIwOPZRCFZ9Rwqqgx2xjUTj0t7TkAEJmKl7w9Y4wlVsldiclyMPGgMljVzygIVTX+tRkYOKCePMRp5O0luht1dEd52yehU7Iqk2Ul6ErhkRWECgYEAwRy75NW5yEOPkU4ZMQI4SVydAjgvxXm3NOzRsO91U9YkSszzGPdiHXNWu6n0l8DzMtdEb9/252La2F86FxH1BDBv7uAxL2twHIeumHMMUJ5vdzidlstPoEtF9SMhwJ+ok1rAVb0Cs/TpHp0k/uR9DyeLj7z6gqfUVPlAZR2AxK8CgYEAwmRoRM74uxo6WPw/60bSKnql6UficGrjHgoVfGPbLsuNgx03OhNAH6O1WHoHTpO410p2I//BEu57gZNriYvOiY4BAPM8Ip2SRFiTZE1YM4yauYIp+31ihqxwJDkQx44dAcUNQrJO4EPzfE25pMJeUKzzu6gfkgyaY91VcwBalYECgYEAtbh7W5h/beOdqyep7wNewjJDkX4b/iFOdKBRpsV/S/gcSMNaE2lfy8TonkoNX+xzLqmBviEsb4sH00qxGFqOjXWjL0+LGUtpwX8wnkbNFOQykicVrHv/nyCWYVrA/UmA0cE5crUdYQibgnJwCOgsguE8pHM57U9PMPMoVL6RmQMCgYEAkuxQsSyfAQQ1R/ZnCqt1LpBlTIhK6zp2V++Zfhrmi9lTZVMvkahKwCzJAEDNcvN+Y/ypKagL/LZ69dnFRTmmRCEXTfcY8V8gx8MHbJV2S1I/rZ1MLF/JCUCzmZJovS8tHLw5miLPfb6WPjJLPR5IpFeLLiUHza9k6d2L0ucpTWE=";

    fn test_signing_key() -> jsonwebtoken::EncodingKey {
        let der = base64::engine::general_purpose::STANDARD
            .decode(TEST_RSA_PRIVATE_DER_B64)
            .unwrap();
        jsonwebtoken::EncodingKey::from_rsa_der(&der)
    }

    fn test_jwks() -> jsonwebtoken::jwk::JwkSet {
        let mut jwk = jsonwebtoken::jwk::Jwk::from_encoding_key(
            &test_signing_key(),
            jsonwebtoken::Algorithm::RS256,
        )
        .unwrap();
        jwk.common.key_id = Some(TEST_KID.to_owned());
        jsonwebtoken::jwk::JwkSet { keys: vec![jwk] }
    }

    fn signed_id_token(client_id: &str, nonce: &str, subject: &str, issuer: &str) -> String {
        let now = jsonwebtoken::get_current_timestamp();
        let mut header = jsonwebtoken::Header::new(jsonwebtoken::Algorithm::RS256);
        header.kid = Some(TEST_KID.to_owned());
        jsonwebtoken::encode(
            &header,
            &json!({
                "iss": issuer,
                "sub": subject,
                "aud": client_id,
                "exp": now + 60,
                "iat": now,
                "nonce": nonce,
                "email": "person@example.test",
                "name": "Person"
            }),
            &test_signing_key(),
        )
        .unwrap()
    }

    struct OAuthMock {
        base: String,
        requests: Arc<Mutex<Vec<String>>>,
        token_response: Arc<Mutex<Value>>,
        token_status: Arc<Mutex<StatusCode>>,
        server: tokio::task::JoinHandle<()>,
    }

    impl OAuthMock {
        async fn start() -> Self {
            let requests = Arc::new(Mutex::new(Vec::new()));
            let token_response = Arc::new(Mutex::new(json!({
                "access_token": "access",
                "refresh_token": "refresh",
                "token_type": "Bearer",
                "expires_in": 3600,
                "id_token": "malformed"
            })));
            let token_status = Arc::new(Mutex::new(StatusCode::OK));
            let request_log = requests.clone();
            let response_body = token_response.clone();
            let response_status = token_status.clone();
            let app = Router::new()
                .route(
                    "/discovery",
                    get(|| async {
                        (
                            StatusCode::OK,
                            [(CONTENT_TYPE, "application/json")],
                            Body::from(
                                json!({
                                    "issuer": "https://auth.openai.com",
                                    "jwks_uri": "https://auth.openai.com/.well-known/jwks.json",
                                    "id_token_signing_alg_values_supported": ["RS256"]
                                })
                                .to_string(),
                            ),
                        )
                            .into_response()
                    }),
                )
                .route(
                    "/token",
                    post(move |request: Request| {
                        let request_log = request_log.clone();
                        let response_body = response_body.clone();
                        let response_status = response_status.clone();
                        async move {
                            let bytes = to_bytes(request.into_body(), MAX_OAUTH_BYTES)
                                .await
                                .unwrap();
                            request_log
                                .lock()
                                .unwrap()
                                .push(String::from_utf8(bytes.to_vec()).unwrap());
                            (
                                *response_status.lock().unwrap(),
                                [(CONTENT_TYPE, "application/json")],
                                Body::from(response_body.lock().unwrap().to_string()),
                            )
                                .into_response()
                        }
                    }),
                );
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let address = listener.local_addr().unwrap();
            let server = tokio::spawn(async move {
                let _ = axum::serve(listener, app).await;
            });
            Self {
                base: format!("http://{address}"),
                requests,
                token_response,
                token_status,
                server,
            }
        }

        fn set_token_response(&self, response: Value) {
            *self.token_response.lock().unwrap() = response;
        }

        fn set_token_status(&self, status: StatusCode) {
            *self.token_status.lock().unwrap() = status;
        }

        async fn stop(self) {
            self.server.abort();
            let _ = self.server.await;
        }
    }

    fn query(url: &str) -> HashMap<String, String> {
        Url::parse(url)
            .unwrap()
            .query_pairs()
            .map(|(key, value)| (key.into_owned(), value.into_owned()))
            .collect()
    }

    async fn callback_request(redirect_uri: &str, params: &[(&str, &str)]) -> reqwest::Response {
        let mut callback = Url::parse(redirect_uri).unwrap();
        {
            let mut query = callback.query_pairs_mut();
            for (key, value) in params {
                query.append_pair(key, value);
            }
        }
        reqwest::Client::new().get(callback).send().await.unwrap()
    }

    async fn wait_for_pending_to_clear(service: &ChatgptService) {
        for _ in 0..100 {
            if service.pending.lock().await.is_none() {
                return;
            }
            sleep(Duration::from_millis(10)).await;
        }
        panic!("OAuth attempt did not finish");
    }

    #[tokio::test]
    async fn authorization_parameters_follow_new_returning_and_enable_plan_modes() {
        let dir = tempdir().unwrap();
        let service =
            ChatgptService::new_test(&dir.path().join("config.json"), "http://127.0.0.1:1");

        let new = start(&service, Some("new")).await.unwrap();
        let new_query = query(new["authorizeUrl"].as_str().unwrap());
        assert_eq!(new_query["client_id"], DYNAMIC_CLIENT_ID);
        assert_eq!(new_query["agent_name_hint"], "Exeora");
        assert_eq!(new_query["code_challenge_method"], "S256");
        assert_eq!(new_query["resource"], super::super::RESOURCE);
        assert_eq!(new_query["scope"], FULL_SCOPE);
        assert!(!new_query.contains_key("prompt"));
        assert!(!new_query.contains_key("login_hint"));
        cancel(&service).await.unwrap();

        service
            .activate_account(&account("oaiapp_saved", "subject"))
            .await
            .unwrap();

        let reauth = start(&service, Some("reauth")).await.unwrap();
        let reauth_query = query(reauth["authorizeUrl"].as_str().unwrap());
        assert_eq!(reauth_query["client_id"], "oaiapp_saved");
        assert_eq!(reauth_query["login_hint"], "person@example.test");
        assert!(!reauth_query.contains_key("agent_name_hint"));
        assert!(!reauth_query.contains_key("prompt"));
        cancel(&service).await.unwrap();

        let enable = start(&service, Some("enable_plan")).await.unwrap();
        let enable_query = query(enable["authorizeUrl"].as_str().unwrap());
        assert_eq!(enable_query["client_id"], "oaiapp_saved");
        assert_eq!(enable_query["prompt"], "consent");
        assert_eq!(enable_query["login_hint"], "person@example.test");
        assert!(!enable_query.contains_key("agent_name_hint"));
        cancel(&service).await.unwrap();
    }

    #[tokio::test]
    async fn concurrent_starts_close_the_superseded_callback_listener() {
        let dir = tempdir().unwrap();
        let service =
            ChatgptService::new_test(&dir.path().join("config.json"), "http://127.0.0.1:1");
        let barrier = Arc::new(tokio::sync::Barrier::new(2));
        let spawn_attempt = || {
            let service = service.clone();
            let barrier = barrier.clone();
            tokio::spawn(async move {
                barrier.wait().await;
                start(&service, Some("new")).await
            })
        };
        let (first, second) = tokio::join!(spawn_attempt(), spawn_attempt());
        let first = query(first.unwrap().unwrap()["authorizeUrl"].as_str().unwrap());
        let second = query(second.unwrap().unwrap()["authorizeUrl"].as_str().unwrap());
        let active_state = service.pending.lock().await.as_ref().unwrap().state.clone();
        let superseded = if active_state == first["state"] {
            second
        } else {
            assert_eq!(active_state, second["state"]);
            first
        };
        let callback = Url::parse(&superseded["redirect_uri"]).unwrap();
        let address = format!("127.0.0.1:{}", callback.port().unwrap());
        let mut closed = false;
        for _ in 0..100 {
            if let Ok(listener) = tokio::net::TcpListener::bind(&address).await {
                drop(listener);
                closed = true;
                break;
            }
            sleep(Duration::from_millis(10)).await;
        }
        cancel(&service).await.unwrap();
        assert!(closed, "The superseded login left its callback port open");
    }

    #[tokio::test]
    async fn wrong_state_does_not_consume_callback_and_decline_preserves_active_account() {
        let dir = tempdir().unwrap();
        let service =
            ChatgptService::new_test(&dir.path().join("config.json"), "http://127.0.0.1:1");
        let saved = account("oaiapp_saved", "subject");
        service.activate_account(&saved).await.unwrap();

        let login = start(&service, Some("new")).await.unwrap();
        let authorize_url = login["authorizeUrl"].as_str().unwrap();
        let authorize_query = query(authorize_url);
        let redirect_uri = authorize_query["redirect_uri"].clone();

        let wrong = callback_request(
            &redirect_uri,
            &[("state", "attacker-state"), ("error", "access_denied")],
        )
        .await;
        assert_eq!(wrong.status(), reqwest::StatusCode::BAD_REQUEST);
        assert!(service.pending.lock().await.is_some());

        let valid = callback_request(
            &redirect_uri,
            &[
                ("state", &authorize_query["state"]),
                ("error", "access_denied"),
            ],
        )
        .await;
        assert_eq!(valid.status(), reqwest::StatusCode::OK);
        wait_for_pending_to_clear(&service).await;
        let active = service.store.load_active().unwrap().unwrap();
        assert_eq!(active.client_id, saved.client_id);
        assert_eq!(active.subject, saved.subject);
        assert_eq!(active.state, saved.state);
        assert_eq!(
            service.last_error.lock().await.as_deref(),
            Some("plan_disabled")
        );
    }

    #[tokio::test]
    async fn returning_callback_invalid_client_persists_for_the_next_cli_process() {
        let dir = tempdir().unwrap();
        let config_path = dir.path().join("config.json");
        let service = ChatgptService::new_test(&config_path, "http://127.0.0.1:1");
        let mut saved = account("oaiapp_saved", "subject");
        saved.scopes = FULL_SCOPE.split(' ').map(str::to_owned).collect();
        service.activate_account(&saved).await.unwrap();

        let login = start(&service, Some("reauth")).await.unwrap();
        let authorize_query = query(login["authorizeUrl"].as_str().unwrap());
        let response = callback_request(
            &authorize_query["redirect_uri"],
            &[
                ("state", &authorize_query["state"]),
                ("error", "invalid_client"),
            ],
        )
        .await;
        assert_eq!(response.status(), reqwest::StatusCode::OK);
        wait_for_pending_to_clear(&service).await;

        let saved = service.store.load_active().unwrap().unwrap();
        assert_eq!(saved.state.as_deref(), Some("client_invalid"));
        assert!(saved.access_token.is_none());
        assert!(saved.refresh_token.is_none());
        assert_eq!(
            service.last_error.lock().await.as_deref(),
            Some("client_invalid")
        );

        let reopened = ChatgptService::new_test(&config_path, "http://127.0.0.1:1");
        let status = reopened
            .handle(json!({"action": "chatgpt_status"}))
            .await
            .unwrap();
        assert_eq!(status["state"], "client_invalid");
    }

    #[tokio::test]
    async fn invalid_grant_reuses_the_issued_registration_after_restart_without_activating_it() {
        let mock = OAuthMock::start().await;
        let dir = tempdir().unwrap();
        let config = dir.path().join("config.json");
        let service = ChatgptService::new_test(&config, &mock.base);
        let saved = account("oaiapp_saved", "saved-subject");
        service.activate_account(&saved).await.unwrap();
        let first = start(&service, Some("new")).await.unwrap();
        let first_query = query(first["authorizeUrl"].as_str().unwrap());
        mock.set_token_response(json!({"error":"invalid_grant"}));
        mock.set_token_status(StatusCode::BAD_REQUEST);
        callback_request(
            &first_query["redirect_uri"],
            &[
                ("state", &first_query["state"]),
                ("code", "expired-code"),
                ("client_id", "oaiapp_issued"),
            ],
        )
        .await;
        wait_for_pending_to_clear(&service).await;
        let active = service.store.load_active().unwrap().unwrap();
        assert_eq!(active.client_id, saved.client_id);
        assert_eq!(active.access_token, saved.access_token);
        assert!(
            service
                .store
                .load_if_exists("oaiapp_issued")
                .unwrap()
                .is_none()
        );
        assert_eq!(
            service.store.provisional_client_id().unwrap().as_deref(),
            Some("oaiapp_issued")
        );

        let reopened = ChatgptService::new_test(&config, &mock.base);
        let retry = start(&reopened, Some("new")).await.unwrap();
        let retry_query = query(retry["authorizeUrl"].as_str().unwrap());
        assert_eq!(retry_query["client_id"], "oaiapp_issued");
        assert!(!retry_query.contains_key("agent_name_hint"));
        for key in ["state", "nonce", "code_challenge"] {
            assert_ne!(retry_query[key], first_query[key]);
        }
        *reopened.jwks.write().await = Some(test_jwks());
        mock.set_token_status(StatusCode::OK);
        mock.set_token_response(json!({
            "access_token":"verified-access", "refresh_token":"verified-refresh",
            "token_type":"Bearer", "expires_in":3600,
            "scope":"openid chatgpt.tokens.use.direct",
            "id_token":signed_id_token("oaiapp_issued", &retry_query["nonce"], "verified-subject", "https://auth.openai.com"),
        }));
        callback_request(
            &retry_query["redirect_uri"],
            &[("state", &retry_query["state"]), ("code", "fresh-code")],
        )
        .await;
        wait_for_pending_to_clear(&reopened).await;
        let active = reopened.store.load_active().unwrap().unwrap();
        assert_eq!(active.client_id, "oaiapp_issued");
        assert_eq!(active.subject, "verified-subject");
        assert_eq!(active.access_token.as_deref(), Some("verified-access"));
        assert!(active.new_registration);
        assert!(reopened.store.provisional_client_id().unwrap().is_none());
        mock.stop().await;
    }

    #[tokio::test]
    async fn invalid_client_discards_only_the_provisional_registration() {
        let mock = OAuthMock::start().await;
        let dir = tempdir().unwrap();
        let service = ChatgptService::new_test(&dir.path().join("config.json"), &mock.base);
        let saved = account("oaiapp_saved", "saved-subject");
        service.activate_account(&saved).await.unwrap();
        service
            .store
            .remember_provisional_client("oaiapp_issued")
            .await
            .unwrap();
        let login = start(&service, Some("new")).await.unwrap();
        let q = query(login["authorizeUrl"].as_str().unwrap());
        callback_request(
            &q["redirect_uri"],
            &[("state", &q["state"]), ("error", "invalid_client")],
        )
        .await;
        wait_for_pending_to_clear(&service).await;
        assert!(service.store.provisional_client_id().unwrap().is_none());
        assert_eq!(
            service.store.load_active().unwrap().unwrap().access_token,
            saved.access_token
        );
        let retry = start(&service, Some("new")).await.unwrap();
        assert_eq!(
            query(retry["authorizeUrl"].as_str().unwrap())["client_id"],
            DYNAMIC_CLIENT_ID
        );
        cancel(&service).await.unwrap();
        mock.stop().await;
    }

    #[tokio::test]
    async fn new_registration_token_invalid_client_preserves_existing_active_account() {
        let mock = OAuthMock::start().await;
        let dir = tempdir().unwrap();
        let service = ChatgptService::new_test(&dir.path().join("config.json"), &mock.base);
        let saved = account("oaiapp_saved", "subject");
        service.activate_account(&saved).await.unwrap();

        let login = start(&service, Some("new")).await.unwrap();
        let authorize_query = query(login["authorizeUrl"].as_str().unwrap());
        mock.set_token_response(json!({"error": "invalid_client"}));
        mock.set_token_status(StatusCode::UNAUTHORIZED);
        let response = callback_request(
            &authorize_query["redirect_uri"],
            &[
                ("state", &authorize_query["state"]),
                ("code", "new-registration-code"),
                ("client_id", "oaiapp_issued"),
            ],
        )
        .await;
        assert_eq!(response.status(), reqwest::StatusCode::OK);
        wait_for_pending_to_clear(&service).await;

        let active = service.store.load_active().unwrap().unwrap();
        assert_eq!(active.client_id, saved.client_id);
        assert_eq!(active.subject, saved.subject);
        assert_eq!(active.access_token, saved.access_token);
        assert_eq!(active.refresh_token, saved.refresh_token);
        assert_eq!(active.state, saved.state);
        assert_eq!(
            service.last_error.lock().await.as_deref(),
            Some("client_invalid")
        );
        mock.stop().await;
    }

    #[tokio::test]
    async fn cancellation_closes_the_loopback_listener() {
        let dir = tempdir().unwrap();
        let service =
            ChatgptService::new_test(&dir.path().join("config.json"), "http://127.0.0.1:1");
        let login = start(&service, Some("new")).await.unwrap();
        let redirect_uri = query(login["authorizeUrl"].as_str().unwrap())["redirect_uri"].clone();
        let callback = Url::parse(&redirect_uri).unwrap();
        let address = format!(
            "{}:{}",
            callback.host_str().unwrap(),
            callback.port().unwrap()
        );

        cancel(&service).await.unwrap();
        for _ in 0..100 {
            if tokio::net::TcpStream::connect(&address).await.is_err() {
                return;
            }
            sleep(Duration::from_millis(10)).await;
        }
        panic!("OAuth callback listener remained bound after cancellation");
    }

    #[tokio::test]
    async fn returning_callback_without_client_id_exchanges_the_saved_id_and_exact_pkce_fields() {
        let requests = Arc::new(Mutex::new(Vec::<String>::new()));
        let request_log = requests.clone();
        let app = Router::new()
            .route(
                "/discovery",
                get(|| async {
                    (
                        StatusCode::OK,
                        [(CONTENT_TYPE, "application/json")],
                        Body::from(
                            json!({
                                "issuer": "https://auth.openai.com",
                                "jwks_uri": "https://auth.openai.com/.well-known/jwks.json",
                                "id_token_signing_alg_values_supported": ["RS256"]
                            })
                            .to_string(),
                        ),
                    )
                        .into_response()
                }),
            )
            .route(
                "/token",
                post(move |request: Request| {
                    let request_log = request_log.clone();
                    async move {
                        let bytes = to_bytes(request.into_body(), MAX_OAUTH_BYTES)
                            .await
                            .unwrap();
                        request_log
                            .lock()
                            .unwrap()
                            .push(String::from_utf8(bytes.to_vec()).unwrap());
                        (
                            StatusCode::OK,
                            [(CONTENT_TYPE, "application/json")],
                            Body::from(
                                json!({
                                    "access_token": "access",
                                    "token_type": "Bearer",
                                    "expires_in": 3600,
                                    "id_token": "malformed"
                                })
                                .to_string(),
                            ),
                        )
                            .into_response()
                    }
                }),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });

        let dir = tempdir().unwrap();
        let service = ChatgptService::new_test(
            &dir.path().join("config.json"),
            &format!("http://{address}"),
        );
        service
            .activate_account(&account("oaiapp_saved", "subject"))
            .await
            .unwrap();
        // Make malformed test ID tokens fail locally without a network fetch.
        *service.jwks.write().await = Some(jsonwebtoken::jwk::JwkSet { keys: vec![] });

        let login = start(&service, Some("reauth")).await.unwrap();
        let authorize_query = query(login["authorizeUrl"].as_str().unwrap());
        let pending = service.pending.lock().await.clone().unwrap();
        let expected_challenge =
            URL_SAFE_NO_PAD.encode(Sha256::digest(pending.verifier.as_bytes()));
        assert_eq!(authorize_query["code_challenge"], expected_challenge);
        assert_eq!(authorize_query["redirect_uri"], pending.redirect_uri);

        let response = callback_request(
            &authorize_query["redirect_uri"],
            &[
                ("state", &authorize_query["state"]),
                ("code", "one-time-code"),
            ],
        )
        .await;
        assert_eq!(response.status(), reqwest::StatusCode::OK);
        wait_for_pending_to_clear(&service).await;
        let body = requests.lock().unwrap().first().cloned().unwrap();
        let fields = url::form_urlencoded::parse(body.as_bytes())
            .map(|(key, value)| (key.into_owned(), value.into_owned()))
            .collect::<HashMap<_, _>>();
        assert_eq!(fields["grant_type"], "authorization_code");
        assert_eq!(fields["client_id"], "oaiapp_saved");
        assert_eq!(fields["code"], "one-time-code");
        assert_eq!(fields["code_verifier"], pending.verifier);
        assert_eq!(fields["redirect_uri"], pending.redirect_uri);
        assert_eq!(fields["resource"], super::super::RESOURCE);
        assert_eq!(
            service.last_error.lock().await.as_deref(),
            Some("invalid_id_token")
        );
        server.abort();
        let _ = server.await;
    }

    #[tokio::test]
    async fn new_registration_validates_and_persists_the_issued_identity_and_grant() {
        let mock = OAuthMock::start().await;
        let dir = tempdir().unwrap();
        let service = ChatgptService::new_test(&dir.path().join("config.json"), &mock.base);
        *service.jwks.write().await = Some(test_jwks());

        let login = start(&service, Some("new")).await.unwrap();
        let authorize_query = query(login["authorizeUrl"].as_str().unwrap());
        let pending = service.pending.lock().await.clone().unwrap();
        let issued_client_id = "oaiapp_new";
        let id_token = signed_id_token(
            issued_client_id,
            &pending.nonce,
            "new-subject",
            "https://auth.openai.com",
        );
        mock.set_token_response(json!({
            "access_token": "new-access",
            "refresh_token": "new-refresh",
            "id_token": id_token,
            "client_id": issued_client_id,
            "token_type": "Bearer",
            "expires_in": 3600,
            "earliest_refresh_at": 1_234_567_890,
            "refresh_token_expires_in": 1,
            "scope": FULL_SCOPE
        }));

        let response = callback_request(
            &authorize_query["redirect_uri"],
            &[
                ("state", &authorize_query["state"]),
                ("code", "new-registration-code"),
                ("client_id", issued_client_id),
            ],
        )
        .await;
        assert_eq!(response.status(), reqwest::StatusCode::OK);
        wait_for_pending_to_clear(&service).await;

        let saved = service.store.load_active().unwrap().unwrap();
        assert_eq!(saved.client_id, issued_client_id);
        assert_eq!(saved.subject, "new-subject");
        assert_eq!(saved.issuer, "https://auth.openai.com");
        assert_eq!(saved.access_token.as_deref(), Some("new-access"));
        assert_eq!(saved.refresh_token.as_deref(), Some("new-refresh"));
        assert_eq!(saved.earliest_refresh_at, Some(1_234_567_890));
        assert!(saved.plan_usage_allowed());
        assert!(saved.new_registration);
        assert_eq!(mock.requests.lock().unwrap().len(), 1);
        assert!(service.last_error.lock().await.is_none());
        mock.stop().await;
    }

    #[tokio::test(flavor = "current_thread")]
    async fn activation_waits_for_record_lock_without_blocking_current_thread() {
        let mock = OAuthMock::start().await;
        let dir = tempdir().unwrap();
        let service = ChatgptService::new_test(&dir.path().join("config.json"), &mock.base);
        *service.jwks.write().await = Some(test_jwks());

        let login = start(&service, Some("new")).await.unwrap();
        let authorize_query = query(login["authorizeUrl"].as_str().unwrap());
        let pending = service.pending.lock().await.clone().unwrap();
        let issued_client_id = "oaiapp_lock_regression";
        let id_token = signed_id_token(
            issued_client_id,
            &pending.nonce,
            "lock-subject",
            "https://auth.openai.com",
        );
        mock.set_token_response(json!({
            "access_token": "lock-access",
            "refresh_token": "lock-refresh",
            "id_token": id_token,
            "client_id": issued_client_id,
            "token_type": "Bearer",
            "expires_in": 3600,
            "scope": FULL_SCOPE
        }));

        let record_lock = service.store.lock(issued_client_id).await.unwrap();
        let release = Arc::new(AtomicBool::new(false));
        let holder_release = release.clone();
        let holder = std::thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_millis(400);
            while !holder_release.load(Ordering::Acquire) && Instant::now() < deadline {
                std::thread::sleep(Duration::from_millis(5));
            }
            drop(record_lock);
        });

        let response = callback_request(
            &authorize_query["redirect_uri"],
            &[
                ("state", &authorize_query["state"]),
                ("code", "lock-regression-code"),
                ("client_id", issued_client_id),
            ],
        )
        .await;
        assert_eq!(response.status(), reqwest::StatusCode::OK);

        for _ in 0..100 {
            if mock.requests.lock().unwrap().len() == 1 {
                break;
            }
            sleep(Duration::from_millis(1)).await;
        }
        assert_eq!(mock.requests.lock().unwrap().len(), 1);
        let started = Instant::now();
        let (heartbeat_tx, heartbeat_rx) = tokio::sync::oneshot::channel();
        tokio::spawn(async move {
            sleep(Duration::from_millis(30)).await;
            let _ = heartbeat_tx.send(Instant::now());
        });
        tokio::task::yield_now().await;

        let heartbeat_at = tokio::time::timeout(Duration::from_millis(200), heartbeat_rx).await;
        release.store(true, Ordering::Release);
        holder.join().unwrap();
        let heartbeat_at = heartbeat_at
            .expect("callback lock wait blocked the current-thread runtime")
            .expect("heartbeat task was cancelled");
        assert!(heartbeat_at.duration_since(started) < Duration::from_millis(200));

        wait_for_pending_to_clear(&service).await;
        assert_eq!(
            service.store.load_active().unwrap().unwrap().subject,
            "lock-subject"
        );
        mock.stop().await;
    }

    #[tokio::test]
    async fn new_registration_rejects_an_issued_client_collision_before_overwrite() {
        let mock = OAuthMock::start().await;
        let dir = tempdir().unwrap();
        let service = ChatgptService::new_test(&dir.path().join("config.json"), &mock.base);
        *service.jwks.write().await = Some(test_jwks());
        let existing = account("oaiapp_collision", "existing-subject");
        service.activate_account(&existing).await.unwrap();

        let login = start(&service, Some("new")).await.unwrap();
        let authorize_query = query(login["authorizeUrl"].as_str().unwrap());
        let pending = service.pending.lock().await.clone().unwrap();
        let id_token = signed_id_token(
            "oaiapp_collision",
            &pending.nonce,
            "different-subject",
            "https://auth.openai.com",
        );
        mock.set_token_response(json!({
            "access_token": "attacker-access",
            "refresh_token": "attacker-refresh",
            "id_token": id_token,
            "client_id": "oaiapp_collision",
            "token_type": "Bearer",
            "expires_in": 3600,
            "scope": FULL_SCOPE
        }));

        let response = callback_request(
            &authorize_query["redirect_uri"],
            &[
                ("state", &authorize_query["state"]),
                ("code", "collision-code"),
                ("client_id", "oaiapp_collision"),
            ],
        )
        .await;
        assert_eq!(response.status(), reqwest::StatusCode::OK);
        wait_for_pending_to_clear(&service).await;

        let saved = service.store.load("oaiapp_collision").unwrap();
        assert_eq!(saved.subject, existing.subject);
        assert_eq!(saved.access_token, existing.access_token);
        assert_eq!(saved.refresh_token, existing.refresh_token);
        assert_eq!(saved.id_token, existing.id_token);
        assert_eq!(
            service.last_error.lock().await.as_deref(),
            Some("subject_mismatch")
        );
        mock.stop().await;
    }

    #[tokio::test]
    async fn returning_identity_mismatch_preserves_the_selected_account() {
        let mock = OAuthMock::start().await;
        let dir = tempdir().unwrap();
        let service = ChatgptService::new_test(&dir.path().join("config.json"), &mock.base);
        *service.jwks.write().await = Some(test_jwks());
        let existing = account("oaiapp_saved", "existing-subject");
        service.activate_account(&existing).await.unwrap();

        let login = start(&service, Some("reauth")).await.unwrap();
        let authorize_query = query(login["authorizeUrl"].as_str().unwrap());
        let pending = service.pending.lock().await.clone().unwrap();
        let id_token = signed_id_token(
            "oaiapp_saved",
            &pending.nonce,
            "different-subject",
            "https://auth.openai.com",
        );
        mock.set_token_response(json!({
            "access_token": "different-access",
            "refresh_token": "different-refresh",
            "id_token": id_token,
            "client_id": "oaiapp_saved",
            "token_type": "Bearer",
            "expires_in": 3600,
            "scope": FULL_SCOPE
        }));

        let response = callback_request(
            &authorize_query["redirect_uri"],
            &[
                ("state", &authorize_query["state"]),
                ("code", "reauth-code"),
            ],
        )
        .await;
        assert_eq!(response.status(), reqwest::StatusCode::OK);
        wait_for_pending_to_clear(&service).await;

        let saved = service.store.load_active().unwrap().unwrap();
        assert_eq!(saved.subject, existing.subject);
        assert_eq!(saved.access_token, existing.access_token);
        assert_eq!(saved.refresh_token, existing.refresh_token);
        assert_eq!(saved.id_token, existing.id_token);
        assert_eq!(
            service.last_error.lock().await.as_deref(),
            Some("subject_mismatch")
        );
        mock.stop().await;
    }
}
