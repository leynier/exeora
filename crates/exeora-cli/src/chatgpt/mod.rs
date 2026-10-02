mod errors;
mod host;
mod id_token;
mod inference;
mod models;
mod oauth;
mod session;
mod store;

use anyhow::{Context, Result, anyhow, bail};
use futures_util::StreamExt;
use jsonwebtoken::jwk::JwkSet;
use reqwest::{Client, Response, Url};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    sync::{Arc, OnceLock, Weak},
    time::{Duration, Instant, SystemTime},
};
use tokio::sync::{Mutex, RwLock};
use tokio_util::sync::CancellationToken;

const AUTHORIZE_ENDPOINT: &str = "https://auth.openai.com/api/accounts/authorize";
const TOKEN_ENDPOINT: &str = "https://auth.openai.com/api/accounts/oauth/token";
const DISCOVERY_ENDPOINT: &str = "https://auth.openai.com/.well-known/openid-configuration";
const MODELS_ENDPOINT: &str = "https://api.openai.com/v1/models";
const RESPONSES_ENDPOINT: &str = "https://api.openai.com/v1/responses";
const RESOURCE: &str = "https://api.openai.com/v1";
const DYNAMIC_CLIENT_ID: &str = "dynamic_agent_client";
const FULL_SCOPE: &str =
    "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";

const MAX_DISCOVERY_BYTES: usize = 64 * 1024;
const MAX_JWKS_BYTES: usize = 1024 * 1024;
const MAX_OAUTH_BYTES: usize = 128 * 1024;
const MAX_API_BYTES: usize = 4 * 1024 * 1024;
const MAX_SSE_BYTES: usize = 8 * 1024 * 1024;
const MAX_OUTPUT_CHARS: usize = 200_000;

#[derive(Debug, Clone)]
pub(crate) struct EndpointConfig {
    authorize: Url,
    token: Url,
    discovery: Url,
    models: Url,
    responses: Url,
    #[cfg(test)]
    revocation_override: Option<Url>,
}

impl EndpointConfig {
    fn official() -> Result<Self> {
        Ok(Self {
            authorize: AUTHORIZE_ENDPOINT.parse()?,
            token: TOKEN_ENDPOINT.parse()?,
            discovery: DISCOVERY_ENDPOINT.parse()?,
            models: MODELS_ENDPOINT.parse()?,
            responses: RESPONSES_ENDPOINT.parse()?,
            #[cfg(test)]
            revocation_override: None,
        })
    }

    #[cfg(test)]
    fn test(base: &str) -> Self {
        let base = Url::parse(base).unwrap();
        Self {
            authorize: base.join("/authorize").unwrap(),
            token: base.join("/token").unwrap(),
            discovery: base.join("/discovery").unwrap(),
            models: base.join("/v1/models").unwrap(),
            responses: base.join("/v1/responses").unwrap(),
            revocation_override: Some(base.join("/revoke").unwrap()),
        }
    }
}

pub struct ChatgptService {
    pub(crate) local: bool,
    pub(crate) store: store::Store,
    pub(crate) http: Client,
    pub(crate) endpoints: EndpointConfig,
    pub(crate) pending: Mutex<Option<oauth::PendingAttempt>>,
    pub(crate) pending_task: Mutex<Option<tokio::task::JoinHandle<()>>>,
    pub(crate) last_error: Mutex<Option<String>>,
    pub(crate) refresh_gate: Mutex<()>,
    pub(crate) models_cache: Mutex<HashMap<String, (Instant, Vec<models::Model>)>>,
    pub(crate) jwks: RwLock<Option<JwkSet>>,
    pub(crate) request_cancel: Mutex<CancellationToken>,
    self_ref: OnceLock<Weak<ChatgptService>>,
}

impl ChatgptService {
    pub fn new(config_path: &std::path::Path, local: bool) -> Result<Arc<Self>> {
        let http = Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(65))
            .build()
            .context("Could not initialize the ChatGPT HTTP client.")?;
        let endpoints = EndpointConfig::official()?;
        let service = Arc::new_cyclic(|weak| {
            let self_ref = OnceLock::new();
            let _ = self_ref.set(weak.clone());
            Self {
                local,
                store: store::Store::new(config_path),
                http,
                endpoints,
                pending: Mutex::new(None),
                pending_task: Mutex::new(None),
                last_error: Mutex::new(None),
                refresh_gate: Mutex::new(()),
                models_cache: Mutex::new(HashMap::new()),
                jwks: RwLock::new(None),
                request_cancel: Mutex::new(CancellationToken::new()),
                self_ref,
            }
        });
        Ok(service)
    }

    #[cfg(test)]
    fn new_test(config_path: &std::path::Path, base: &str) -> Arc<Self> {
        let http = Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(Duration::from_secs(2))
            .timeout(Duration::from_secs(5))
            .build()
            .unwrap();
        let endpoints = EndpointConfig::test(base);
        Arc::new_cyclic(|weak| {
            let self_ref = OnceLock::new();
            let _ = self_ref.set(weak.clone());
            Self {
                local: true,
                store: store::Store::new(config_path),
                http,
                endpoints,
                pending: Mutex::new(None),
                pending_task: Mutex::new(None),
                last_error: Mutex::new(None),
                refresh_gate: Mutex::new(()),
                models_cache: Mutex::new(HashMap::new()),
                jwks: RwLock::new(None),
                request_cancel: Mutex::new(CancellationToken::new()),
                self_ref,
            }
        })
    }

    pub async fn handle(&self, action: Value) -> anyhow::Result<Value> {
        let name = action
            .get("action")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow!("A ChatGPT action is required."))?;
        if !self.local {
            if name == "chatgpt_status" {
                return Ok(json!({
                    "kind": "chatgpt_status",
                    "state": "unavailable_on_cloud",
                }));
            }
            bail!("ChatGPT is unavailable on Exeora Cloud machines.");
        }
        match name {
            "chatgpt_status" => self.status().await,
            "chatgpt_login_start" => {
                let mode = action.get("mode").and_then(Value::as_str);
                oauth::start(self, mode).await
            }
            "chatgpt_login_cancel" => {
                oauth::cancel(self).await?;
                self.status().await
            }
            "chatgpt_logout" => self.logout().await,
            "chatgpt_welcome_ack" => {
                let notice_id = action
                    .get("noticeId")
                    .and_then(Value::as_str)
                    .ok_or_else(|| anyhow!("A ChatGPT welcome notice is required."))?;
                uuid::Uuid::parse_str(notice_id)?;
                let _session_lock = self.store.session_lock().await?;
                let acknowledged = if !self.store.was_logged_out()? {
                    if let Some(account) = self.store.load_active()? {
                        let _record_lock = self.store.lock(&account.client_id).await?;
                        let mut current = self.store.load(&account.client_id)?;
                        if current.welcome_notice_id.as_deref() == Some(notice_id) {
                            current.new_registration = false;
                            // Retain the ID so retries after a lost response are idempotent.
                            self.store.save_record_unlocked(&current)?;
                            true
                        } else {
                            false
                        }
                    } else {
                        false
                    }
                } else {
                    false
                };
                Ok(json!({"kind":"chatgpt_welcome_ack", "acknowledged":acknowledged}))
            }
            "chatgpt_models" => {
                let cancellation = self.request_cancellation().await;
                let revision = session::revision(&self.store)?;
                tokio::select! {
                    models = models::list_for_revision(self, &revision) => {
                        if session::revision(&self.store)? != revision {
                            bail!("The ChatGPT model request was interrupted.");
                        }
                        Ok(json!({
                            "kind": "chatgpt_models",
                            "models": models?,
                        }))
                    }
                    _ = session::changed(self, &revision, &cancellation) => {
                        bail!("The ChatGPT model request was interrupted.")
                    }
                }
            }
            "chatgpt_generate" => {
                let cancellation = self.request_cancellation().await;
                let revision = session::revision(&self.store)?;
                tokio::select! {
                    result = inference::generate_for_revision(self, &action, &revision) => {
                        if session::revision(&self.store)? != revision {
                            return Ok(errors::Failure::new("interrupted", Some("request_cancelled"), None, None, None).value("chatgpt_generation"));
                        }
                        result
                    },
                    _ = session::changed(self, &revision, &cancellation) => Ok(
                        errors::Failure::new(
                            "interrupted",
                            Some("request_cancelled"),
                            None,
                            None,
                            None,
                        )
                        .value("chatgpt_generation")
                    ),
                }
            }
            _ => bail!("Unknown ChatGPT action."),
        }
    }

    async fn status(&self) -> Result<Value> {
        loop {
            let pending = self.pending.lock().await.clone();
            let Some(pending) = pending else {
                break;
            };
            if pending.logout_revision != self.store.logout_revision()? {
                self.retire_pending(&pending.state).await;
                replace_cancellation(&mut *self.request_cancel.lock().await);
                self.models_cache.lock().await.clear();
                continue;
            }
            let active = self.store.load_active()?;
            let authenticated = active
                .as_ref()
                .is_some_and(|account| matches!(account.state(), "ready" | "plan_disabled"));
            let stale = authenticated && pending.active_revision != self.store.active_revision()?;
            if stale {
                self.retire_pending(&pending.state).await;
                let mut cancellation = self.request_cancel.lock().await;
                replace_cancellation(&mut cancellation);
                self.models_cache.lock().await.clear();
                continue;
            }
            return Ok(json!({
                "kind": "chatgpt_status",
                "state": "pending",
                "pending": {
                    "expiresAt": pending.expires_at,
                },
            }));
        }
        let Some(account) = self.store.load_active()? else {
            let mut result = json!({
                "kind": "chatgpt_status",
                "state": "signed_out",
            });
            if let Some(error) = self.last_error.lock().await.clone()
                && !error.is_empty()
            {
                result["loginError"] = Value::String(error);
            }
            return Ok(result);
        };
        let logged_out = self.store.was_logged_out()?;
        let new_registration = account.new_registration && !logged_out;
        let notice_id = if new_registration {
            account.welcome_notice_id.clone()
        } else {
            None
        };
        let state = if logged_out {
            "signed_out"
        } else {
            account.state()
        };
        let plan_usage = account.plan_usage_allowed() && state == "ready";
        let (email, label) =
            id_token::public_profile(account.email.as_deref(), account.label.as_deref());
        let scopes = account.scopes.clone();
        let mut result = json!({
            "kind": "chatgpt_status",
            "state": state,
            "account": {
                "email": email,
                "label": label,
                "scopes": scopes,
                "planUsage": plan_usage,
                "newRegistration": new_registration,
            },
        });
        if let Some(notice_id) = notice_id {
            result["account"]["noticeId"] = Value::String(notice_id);
        }
        if let Some(error) = self.last_error.lock().await.clone()
            && !error.is_empty()
        {
            result["loginError"] = Value::String(error);
        }
        Ok(result)
    }

    #[cfg(test)]
    pub(crate) async fn access_account(&self) -> Result<store::StoredAccount> {
        self.access_account_for_revision(&session::revision(&self.store)?)
            .await
    }

    pub(crate) async fn access_account_for_revision(
        &self,
        expected: &session::Revision,
    ) -> Result<store::StoredAccount> {
        let session_lock = self.store.session_lock().await?;
        session::ensure_current(&self.store, expected)?;
        let Some(account) = self.store.load_active()? else {
            bail!("ChatGPT sign-in is required.");
        };
        if self.store.was_logged_out()? {
            bail!("ChatGPT sign-in is required.");
        }
        match account.state() {
            "ready" => {}
            "plan_disabled" => bail!("ChatGPT plan usage is disabled."),
            "client_invalid" => bail!("The ChatGPT registration is invalid."),
            "reconnect" => bail!("ChatGPT sign-in must be renewed."),
            _ => bail!("ChatGPT sign-in is required."),
        }
        if account.access_token.is_none() {
            bail!("ChatGPT sign-in is required.");
        }
        drop(session_lock);
        let expires_at = account.expires_at.unwrap_or_default();
        let earliest = account.earliest_refresh_at.unwrap_or_default();
        let now = store::now_secs();
        if expires_at <= now.saturating_add(300) && now >= earliest {
            self.refresh_account(&account.client_id, None).await?;
            // Refresh can finish after another CLI process activates a different
            // session. Never switch this request to that session's credentials.
            let _session_lock = self.store.session_lock().await?;
            session::ensure_current(&self.store, expected)?;
            return self.store.load(&account.client_id);
        }
        Ok(account)
    }

    pub(crate) async fn force_refresh(
        &self,
        rejected: &store::StoredAccount,
    ) -> Result<store::StoredAccount> {
        let token = rejected
            .access_token
            .clone()
            .ok_or_else(|| anyhow!("ChatGPT sign-in is required."))?;
        self.refresh_account(&rejected.client_id, Some(token))
            .await?;
        self.store.load(&rejected.client_id)
    }

    #[cfg(test)]
    pub(crate) async fn activate_account(&self, account: &store::StoredAccount) -> Result<bool> {
        self.activate_account_inner(account, None).await
    }

    pub(crate) async fn activate_account_inner(
        &self,
        account: &store::StoredAccount,
        expected_revision: Option<&(Option<String>, Option<String>)>,
    ) -> Result<bool> {
        if let Some(expected) = expected_revision
            && *expected != session::revision(&self.store)?
        {
            return Ok(false);
        }
        let mut cancellation = self.request_cancel.lock().await;
        if let Some(expected) = expected_revision
            && *expected != session::revision(&self.store)?
        {
            return Ok(false);
        }
        replace_cancellation(&mut cancellation);

        let _process_lock = self.refresh_gate.lock().await;
        let _session_lock = self.store.session_lock().await?;
        if let Some(expected) = expected_revision
            && *expected != session::revision(&self.store)?
        {
            return Ok(false);
        }
        let _record_lock = self.store.lock(&account.client_id).await?;
        let mut account = account.clone();
        if let Some(existing) = self.store.load_if_exists(&account.client_id)? {
            if existing.issuer != account.issuer || existing.subject != account.subject {
                return Ok(false);
            }
            account.new_registration |= existing.new_registration;
            account.welcome_notice_id = existing.welcome_notice_id;
        }
        self.store.save_unlocked(&account)?;
        self.models_cache.lock().await.clear();
        Ok(true)
    }

    pub(crate) async fn invalidate_client(&self, client_id: &str) -> Result<bool> {
        let initially_active = self
            .store
            .load_active()?
            .is_some_and(|account| account.client_id == client_id);
        let mut cancellation = self.request_cancel.lock().await;
        if initially_active {
            replace_cancellation(&mut cancellation);
        }
        let _process_lock = self.refresh_gate.lock().await;
        let active_client_id = self.store.load_active()?.map(|account| account.client_id);
        let _record_lock = self.store.lock(client_id).await?;
        let Some(mut account) = self.store.load_if_exists(client_id)? else {
            return Ok(false);
        };
        let is_active = active_client_id.as_deref() == Some(client_id);
        if is_active && !initially_active {
            replace_cancellation(&mut cancellation);
        }
        account.clear_tokens("client_invalid");
        self.store.save_record_unlocked(&account)?;
        if is_active {
            self.models_cache.lock().await.clear();
        }
        Ok(true)
    }

    async fn refresh_account(&self, client_id: &str, rejected_token: Option<String>) -> Result<()> {
        // A rotating refresh token must be persisted even if its model or
        // generation caller is cancelled while OpenAI processes the request.
        let service = self.clone_arc();
        let client_id = client_id.to_owned();
        tokio::spawn(async move {
            service
                .refresh_account_inner(&client_id, rejected_token.as_deref())
                .await
        })
        .await
        .context("The ChatGPT refresh task failed.")?
    }

    async fn refresh_account_inner(
        &self,
        client_id: &str,
        rejected_token: Option<&str>,
    ) -> Result<()> {
        let _process_lock = self.refresh_gate.lock().await;
        let _record_lock = self.store.lock(client_id).await?;
        let mut account = self.store.load(client_id)?;
        if self
            .store
            .load_active()?
            .is_some_and(|active| active.client_id == client_id)
            && self.store.was_logged_out()?
        {
            bail!("ChatGPT sign-in must be renewed.");
        }
        if matches!(
            account.state.as_deref(),
            Some("signed_out" | "reconnect" | "client_invalid")
        ) {
            bail!("ChatGPT sign-in must be renewed.");
        }
        if let Some(rejected) = rejected_token
            && account.access_token.as_deref() != Some(rejected)
        {
            return Ok(());
        }
        let now = store::now_secs();
        if rejected_token.is_none()
            && account
                .expires_at
                .is_some_and(|expires_at| expires_at > now.saturating_add(300))
        {
            return Ok(());
        }
        if rejected_token.is_none() && account.earliest_refresh_at.is_some_and(|at| now < at) {
            return Ok(());
        }
        let Some(refresh_token) = account.refresh_token.clone() else {
            account.clear_tokens("reconnect");
            self.store.save_record_unlocked(&account)?;
            bail!("ChatGPT sign-in must be renewed.");
        };
        let response = self
            .http
            .post(self.endpoints.token.as_str())
            .form(&[
                ("grant_type", "refresh_token"),
                ("client_id", account.client_id.as_str()),
                ("refresh_token", refresh_token.as_str()),
                ("resource", RESOURCE),
            ])
            .send()
            .await;
        let response = match response {
            Ok(response) => response,
            Err(error) => return Err(error.into()),
        };
        let status = response.status();
        let body = read_bounded(response, MAX_OAUTH_BYTES).await?;
        if !status.is_success() {
            let code = parse_oauth_error(&body).unwrap_or_default();
            if status == reqwest::StatusCode::UNAUTHORIZED
                || status == reqwest::StatusCode::BAD_REQUEST
            {
                if code == "invalid_client" {
                    account.clear_tokens("client_invalid");
                } else if matches!(
                    code.as_str(),
                    "invalid_grant"
                        | "invalid_refresh_token"
                        | "token_expired"
                        | "refresh_token_expired"
                        | "refresh_token_invalidated"
                        | "refresh_token_reused"
                ) {
                    account.clear_tokens("reconnect");
                } else {
                    return Err(anyhow!("OpenAI rejected the ChatGPT refresh."));
                }
                self.store.save_record_unlocked(&account)?;
            }
            bail!("ChatGPT token refresh failed (HTTP {}).", status.as_u16());
        }
        let token: oauth::TokenResponse = serde_json::from_slice(&body)
            .context("OpenAI returned an invalid refresh response.")?;
        let Some(access_token) = token.access_token.filter(|value| !value.is_empty()) else {
            bail!("OpenAI returned no refreshed access token.");
        };
        if let Some(response_client_id) = token.client_id.as_deref()
            && response_client_id != account.client_id
        {
            bail!("OpenAI returned a different ChatGPT registration.");
        }
        let Some(refresh_token) = token.refresh_token.filter(|value| !value.is_empty()) else {
            bail!("OpenAI returned no rotated refresh token.");
        };
        let Some(token_type) = token.token_type.filter(|value| {
            !value.is_empty()
                && value.len() <= 32
                && !value
                    .bytes()
                    .any(|byte| byte.is_ascii_control() || byte.is_ascii_whitespace())
        }) else {
            bail!("OpenAI returned no valid token type.");
        };
        let Some(expires_in) = token.expires_in.filter(|seconds| *seconds > 0) else {
            bail!("OpenAI returned no valid access-token expiry.");
        };
        let scopes = token.scope.as_deref().map(parse_scopes).transpose()?;
        account.access_token = Some(access_token);
        account.id_token = token
            .id_token
            .filter(|value| !value.is_empty())
            .or(account.id_token);
        account.expires_at = Some(now.saturating_add(expires_in));
        account.earliest_refresh_at = token.earliest_refresh_at.or(account.earliest_refresh_at);
        if let Some(scopes) = scopes {
            account.scopes = scopes;
        }
        account.refresh_token = Some(refresh_token);
        account.token_type = token_type;
        account.state = None;
        account.saved_at = now;
        self.store.save_record_unlocked(&account)?;
        Ok(())
    }

    async fn logout(&self) -> Result<Value> {
        self.cancel_pending().await;
        let revocation = {
            let mut cancellation = self.request_cancel.lock().await;
            replace_cancellation(&mut cancellation);
            self.models_cache.lock().await.clear();
            let _process_lock = self.refresh_gate.lock().await;
            let _session_lock = self.store.session_lock().await?;
            self.store.record_logout_unlocked()?;
            let active = self.store.load_active()?;
            if let Some(active) = active {
                let client_id = active.client_id.clone();
                let _record_lock = self.store.lock(&client_id).await?;
                let mut account = self.store.load(&client_id)?;
                let refresh_token = account.refresh_token.clone();
                account.clear_tokens("signed_out");
                // Keep the welcome pending until the user explicitly acknowledges it.
                self.store.save_record_unlocked(&account)?;
                Some((client_id, refresh_token))
            } else {
                None
            }
        };
        let Some((client_id, refresh_token)) = revocation else {
            return Ok(json!({
                "kind": "chatgpt_logout",
                "revocationConfirmed": false,
            }));
        };

        let service = self.clone_arc();
        tokio::spawn(async move { service.revoke(client_id, refresh_token).await })
            .await
            .context("The ChatGPT revocation task failed.")
    }

    async fn revoke(&self, client_id: String, refresh_token: Option<String>) -> Value {
        let mut confirmed = false;
        if let Some(refresh_token) = refresh_token {
            let discovery = tokio::time::timeout(Duration::from_secs(15), self.discovery())
                .await
                .ok()
                .and_then(Result::ok);
            if let Some(endpoint) = discovery.and_then(|value| value.revocation_endpoint) {
                #[cfg(test)]
                let endpoint = self
                    .endpoints
                    .revocation_override
                    .clone()
                    .unwrap_or(endpoint);
                for attempt in 0..3 {
                    let response = tokio::time::timeout(
                        Duration::from_secs(15),
                        self.http
                            .post(endpoint.as_str())
                            .form(&[
                                ("token", refresh_token.as_str()),
                                ("token_type_hint", "refresh_token"),
                                ("client_id", client_id.as_str()),
                            ])
                            .send(),
                    )
                    .await;
                    match response {
                        Ok(Ok(response)) if response.status().is_success() => {
                            confirmed = true;
                            break;
                        }
                        Ok(Ok(response)) if !response.status().is_server_error() => break,
                        _ if attempt < 2 => {
                            tokio::time::sleep(Duration::from_millis(100 * (attempt + 1))).await;
                        }
                        _ => {}
                    }
                }
            }
        }
        json!({
            "kind": "chatgpt_logout",
            "revocationConfirmed": confirmed,
        })
    }

    pub(crate) async fn discovery(&self) -> Result<id_token::Discovery> {
        id_token::discover(&self.http, &self.endpoints).await
    }

    pub(crate) async fn verify_id_token(
        &self,
        discovery: &id_token::Discovery,
        token: &str,
        client_id: &str,
        nonce: &str,
    ) -> Result<id_token::VerifiedIdentity> {
        let cached = self.jwks.read().await.clone();
        if let Some(keys) = cached {
            match id_token::verify_with_jwks(token, discovery, &keys, client_id, nonce) {
                Ok(identity) => return Ok(identity),
                Err(id_token::VerifyError::Invalid(error)) => return Err(error),
                Err(id_token::VerifyError::UnknownKid) => {}
            }
        }
        let keys = id_token::fetch_jwks(&self.http, discovery).await?;
        let identity = id_token::verify_with_jwks(token, discovery, &keys, client_id, nonce)
            .map_err(|error| anyhow!(error.to_string()))?;
        *self.jwks.write().await = Some(keys);
        Ok(identity)
    }

    fn clone_arc(&self) -> Arc<Self> {
        self.self_ref
            .get()
            .and_then(Weak::upgrade)
            .expect("ChatGPT service must be created through ChatgptService::new")
    }

    async fn cancel_pending(&self) {
        let mut pending = self.pending.lock().await;
        pending.take();
        if let Some(task) = self.pending_task.lock().await.take() {
            task.abort();
        }
    }

    async fn retire_pending(&self, state: &str) {
        let mut pending = self.pending.lock().await;
        if pending
            .as_ref()
            .is_some_and(|current| current.state == state)
        {
            pending.take();
            if let Some(task) = self.pending_task.lock().await.take() {
                task.abort();
            }
        }
    }

    pub(crate) async fn clear_pending(&self, state: &str) {
        let mut pending = self.pending.lock().await;
        if pending
            .as_ref()
            .is_some_and(|current| current.state == state)
        {
            pending.take();
        }
    }

    pub(crate) async fn set_last_error(&self, value: &str) {
        *self.last_error.lock().await = (!value.is_empty()).then(|| value.to_owned());
    }

    /// Returns the cancellation generation for model and inference requests.
    /// Logout and account activation cancel the previous generation before
    /// replacing credentials, so an in-flight request cannot use an old token.
    pub(crate) async fn request_cancellation(&self) -> CancellationToken {
        self.request_cancel.lock().await.clone()
    }
}

fn replace_cancellation(cancellation: &mut CancellationToken) {
    cancellation.cancel();
    *cancellation = CancellationToken::new();
}

async fn read_bounded(response: Response, max: usize) -> Result<Vec<u8>> {
    let mut bytes =
        Vec::with_capacity(response.content_length().unwrap_or(0).min(max as u64) as usize);
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        if bytes.len().saturating_add(chunk.len()) > max {
            bail!("The OpenAI response is too large.");
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}

fn request_id(response: &Response) -> Option<String> {
    response
        .headers()
        .get("x-request-id")
        .or_else(|| response.headers().get("openai-request-id"))
        .and_then(|value| value.to_str().ok())
        .filter(|value| {
            !value.is_empty()
                && value.len() <= 128
                && !value
                    .bytes()
                    .any(|byte| byte.is_ascii_control() || byte.is_ascii_whitespace())
        })
        .map(str::to_owned)
}

fn parse_oauth_error(body: &[u8]) -> Option<String> {
    #[derive(Deserialize)]
    struct ErrorBody {
        error: Option<String>,
    }
    serde_json::from_slice::<ErrorBody>(body)
        .ok()
        .and_then(|body| body.error)
        .filter(|value| value.len() <= 128 && !value.contains(char::is_whitespace))
}

fn parse_scopes(value: &str) -> Result<Vec<String>> {
    if value.chars().any(|character| {
        character.is_whitespace() && character != ' ' || character.is_control() && character != ' '
    }) {
        bail!("OpenAI returned invalid granted scopes.");
    }
    let scopes = value
        .split(' ')
        .filter(|scope| !scope.is_empty())
        .map(str::to_owned)
        .collect::<Vec<_>>();
    if scopes.len() > 16
        || scopes
            .iter()
            .any(|scope| scope.is_empty() || scope.len() > 128)
    {
        bail!("OpenAI returned too many or invalid granted scopes.");
    }
    Ok(scopes)
}

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        Router,
        extract::State,
        http::{StatusCode, header},
        routing::post,
    };
    use std::sync::atomic::{AtomicUsize, Ordering};
    use tempfile::tempdir;

    fn test_account(
        client_id: &str,
        issuer: &str,
        subject: &str,
        refresh_token: Option<&str>,
    ) -> store::StoredAccount {
        store::StoredAccount {
            email: Some("person@example.test".to_owned()),
            issuer: issuer.to_owned(),
            subject: subject.to_owned(),
            client_id: client_id.to_owned(),
            ext_agent_host_id: "urn:uuid:123e4567-e89b-12d3-a456-426614174000".to_owned(),
            id_token: Some("id".to_owned()),
            access_token: Some("access".to_owned()),
            refresh_token: refresh_token.map(str::to_owned),
            token_type: "Bearer".to_owned(),
            expires_at: Some(store::now_secs() + 3600),
            earliest_refresh_at: None,
            scopes: vec!["chatgpt.tokens.use.direct".to_owned()],
            saved_at: store::now_secs(),
            label: Some("person@example.test".to_owned()),
            state: None,
            new_registration: true,
            welcome_notice_id: None,
        }
    }

    #[tokio::test]
    async fn status_reads_preserve_welcome_until_revision_bound_acknowledgement() {
        let dir = tempdir().unwrap();
        let service =
            ChatgptService::new_test(&dir.path().join("config.json"), "http://127.0.0.1:1");
        let account = test_account("client", "https://auth.openai.com", "subject", None);
        service.activate_account(&account).await.unwrap();
        let status = service.status().await.unwrap();
        let notice_id = status["account"]["noticeId"].as_str().unwrap();
        let other = ChatgptService::new_test(&dir.path().join("config.json"), "http://127.0.0.1:1");
        assert_eq!(
            other.status().await.unwrap()["account"]["newRegistration"],
            true
        );
        assert!(
            service
                .store
                .load_active()
                .unwrap()
                .unwrap()
                .new_registration
        );
        // Reauthentication preserves the same welcome notice.
        let mut reauth = account.clone();
        reauth.new_registration = false;
        other.activate_account(&reauth).await.unwrap();
        assert_eq!(
            other.status().await.unwrap()["account"]["noticeId"],
            notice_id
        );
        // An older UI cannot acknowledge a different registration.
        other
            .activate_account(&test_account(
                "new-client",
                "https://auth.openai.com",
                "new-subject",
                None,
            ))
            .await
            .unwrap();
        let stale = service
            .handle(json!({"action":"chatgpt_welcome_ack", "noticeId":notice_id}))
            .await
            .unwrap();
        assert_eq!(stale["acknowledged"], false);
        let current = other.status().await.unwrap();
        assert_eq!(current["account"]["newRegistration"], true);
        let action =
            json!({"action":"chatgpt_welcome_ack", "noticeId":current["account"]["noticeId"]});
        assert_eq!(
            service.handle(action.clone()).await.unwrap()["acknowledged"],
            true
        );
        assert_eq!(other.handle(action).await.unwrap()["acknowledged"], true);
        assert_eq!(
            other.status().await.unwrap()["account"]["newRegistration"],
            false
        );
        assert!(
            other.status().await.unwrap()["account"]
                .get("noticeId")
                .is_none()
        );
    }

    #[tokio::test]
    async fn logout_and_cloud_reject_welcome_acknowledgement() {
        let dir = tempdir().unwrap();
        let service =
            ChatgptService::new_test(&dir.path().join("config.json"), "http://127.0.0.1:1");
        service
            .activate_account(&test_account(
                "client",
                "https://auth.openai.com",
                "subject",
                None,
            ))
            .await
            .unwrap();
        let status = service.status().await.unwrap();
        service.logout().await.unwrap();
        let action =
            json!({"action":"chatgpt_welcome_ack", "noticeId":status["account"]["noticeId"]});
        assert_eq!(
            service.handle(action.clone()).await.unwrap()["acknowledged"],
            false
        );
        let cloud = ChatgptService::new(&dir.path().join("config.json"), false).unwrap();
        assert!(cloud.handle(action).await.is_err());
        assert!(
            service
                .handle(json!({"action":"chatgpt_welcome_ack", "noticeId":"bad"}))
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn cloud_mode_refuses_tokens_and_status_does_not_expose_any() {
        let dir = tempdir().unwrap();
        let service = ChatgptService::new(&dir.path().join("config.json"), false).unwrap();
        let status = service
            .handle(json!({"action": "chatgpt_status"}))
            .await
            .unwrap();
        assert_eq!(status["state"], "unavailable_on_cloud");
        assert!(
            service
                .handle(json!({"action": "chatgpt_models"}))
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn public_status_bounds_optional_metadata_without_exposing_the_subject() {
        let dir = tempdir().unwrap();
        let service = ChatgptService::new(&dir.path().join("config.json"), true).unwrap();
        let mut account = test_account(
            "client",
            "https://auth.openai.com",
            "private-subject",
            Some("refresh"),
        );
        account.label = Some("x".repeat(257));
        account.email = Some("x".repeat(321));
        service.store.save(&account).unwrap();
        let status = service.status().await.unwrap();
        assert_eq!(status["state"], "ready");
        assert_eq!(status["account"]["label"], "ChatGPT account");
        assert!(status["account"]["email"].is_null());
        assert!(!status.to_string().contains("private-subject"));
    }

    #[tokio::test]
    async fn signed_out_status_reports_login_error_field() {
        let dir = tempdir().unwrap();
        let service = ChatgptService::new(&dir.path().join("config.json"), true).unwrap();
        service.set_last_error("oauth_callback_failed").await;

        let status = service
            .handle(json!({"action": "chatgpt_status"}))
            .await
            .unwrap();

        assert_eq!(status["state"], "signed_out");
        assert_eq!(status["loginError"], "oauth_callback_failed");
        assert!(status.get("error").is_none());
    }

    #[tokio::test(flavor = "current_thread")]
    async fn activation_cancels_old_requests_before_new_requests_can_snapshot() {
        let dir = tempdir().unwrap();
        let service = ChatgptService::new(&dir.path().join("config.json"), true).unwrap();
        let old_token = service.request_cancellation().await;
        let account = test_account(
            "session-transition",
            "https://auth.openai.com",
            "subject",
            Some("refresh"),
        );
        let gate = service.refresh_gate.lock().await;
        let activating = {
            let service = Arc::clone(&service);
            tokio::spawn(async move { service.activate_account(&account).await })
        };
        tokio::task::yield_now().await;
        assert!(old_token.is_cancelled());

        let waiting_for_new_token = {
            let service = Arc::clone(&service);
            tokio::spawn(async move { service.request_cancellation().await })
        };
        tokio::task::yield_now().await;
        assert!(!waiting_for_new_token.is_finished());

        drop(gate);
        assert!(activating.await.unwrap().unwrap());
        let new_token = waiting_for_new_token.await.unwrap();
        assert!(!new_token.is_cancelled());
        assert_eq!(
            service.store.load_active().unwrap().unwrap().subject,
            "subject"
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn activation_rejects_an_issuer_or_subject_collision() {
        let dir = tempdir().unwrap();
        let service = ChatgptService::new(&dir.path().join("config.json"), true).unwrap();
        let existing = test_account(
            "issued-client",
            "https://auth.openai.com",
            "saved-subject",
            Some("old-refresh"),
        );
        service.store.save(&existing).unwrap();
        let candidate = test_account(
            "issued-client",
            "https://auth.openai.com",
            "different-subject",
            Some("new-refresh"),
        );

        assert!(!service.activate_account(&candidate).await.unwrap());
        let saved = service.store.load_active().unwrap().unwrap();
        assert_eq!(saved.subject, "saved-subject");
        assert_eq!(saved.refresh_token.as_deref(), Some("old-refresh"));
    }

    #[tokio::test(flavor = "current_thread")]
    async fn status_retires_pending_login_after_another_service_activates() {
        let dir = tempdir().unwrap();
        let config = dir.path().join("config.json");
        let service = ChatgptService::new(&config, true).unwrap();
        let other_service = ChatgptService::new(&config, true).unwrap();
        let existing = test_account(
            "existing-client",
            "https://auth.openai.com",
            "existing-subject",
            Some("existing-refresh"),
        );
        service.store.save(&existing).unwrap();
        let old_revision = service.store.active_revision().unwrap();
        let old_token = service.request_cancellation().await;
        {
            let mut pending = service.pending.lock().await;
            *pending = Some(oauth::PendingAttempt {
                mode: oauth::LoginMode::Reauth,
                state: "old-login".to_owned(),
                nonce: "nonce".to_owned(),
                verifier: "verifier".to_owned(),
                redirect_uri: "http://127.0.0.1:1455/auth/callback".to_owned(),
                client_id: existing.client_id.clone(),
                active_revision: old_revision,
                logout_revision: service.store.logout_revision().unwrap(),
                expires_at: now_millis() + 60_000,
            });
        }
        let callback_task = tokio::spawn(std::future::pending::<()>());
        *service.pending_task.lock().await = Some(callback_task);

        let replacement = test_account(
            "replacement-client",
            "https://auth.openai.com",
            "replacement-subject",
            Some("replacement-refresh"),
        );
        assert!(other_service.activate_account(&replacement).await.unwrap());

        let status = service
            .handle(json!({"action": "chatgpt_status"}))
            .await
            .unwrap();
        assert_eq!(status["state"], "ready");
        assert_eq!(status["account"]["label"], "person@example.test");
        assert!(service.pending.lock().await.is_none());
        assert!(service.pending_task.lock().await.is_none());
        assert!(old_token.is_cancelled());
        assert_eq!(
            service.store.load_active().unwrap().unwrap().client_id,
            "replacement-client"
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn status_keeps_pending_login_separate_from_refresh() {
        let dir = tempdir().unwrap();
        let config = dir.path().join("config.json");
        let service = ChatgptService::new(&config, true).unwrap();
        let account = test_account(
            "existing-client",
            "https://auth.openai.com",
            "existing-subject",
            Some("existing-refresh"),
        );
        service.store.save(&account).unwrap();
        let revision = service.store.active_revision().unwrap();
        {
            let mut pending = service.pending.lock().await;
            *pending = Some(oauth::PendingAttempt {
                mode: oauth::LoginMode::Reauth,
                state: "pending-login".to_owned(),
                nonce: "nonce".to_owned(),
                verifier: "verifier".to_owned(),
                redirect_uri: "http://127.0.0.1:1455/auth/callback".to_owned(),
                client_id: account.client_id.clone(),
                active_revision: revision,
                logout_revision: service.store.logout_revision().unwrap(),
                expires_at: now_millis() + 60_000,
            });
        }

        let status = service
            .handle(json!({"action": "chatgpt_status"}))
            .await
            .unwrap();
        assert_eq!(status["state"], "pending");
        assert!(status["pending"]["expiresAt"].as_u64().unwrap() > now_millis());
        assert!(
            service
                .store
                .load_active()
                .unwrap()
                .unwrap()
                .access_token
                .is_some()
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn invalidating_a_non_active_or_missing_client_preserves_active_registration() {
        let dir = tempdir().unwrap();
        let config = dir.path().join("config.json");
        let service = ChatgptService::new(&config, true).unwrap();
        let other_service = ChatgptService::new(&config, true).unwrap();
        let active = test_account(
            "active-client",
            "https://auth.openai.com",
            "active-subject",
            Some("active-refresh"),
        );
        let inactive = test_account(
            "inactive-client",
            "https://auth.openai.com",
            "inactive-subject",
            Some("inactive-refresh"),
        );
        service.store.save(&active).unwrap();
        service.store.save_record_unlocked(&inactive).unwrap();
        let active_token = service.request_cancellation().await;

        assert!(
            other_service
                .invalidate_client("inactive-client")
                .await
                .unwrap()
        );
        assert!(!active_token.is_cancelled());
        assert_eq!(
            service.store.load_active().unwrap().unwrap().client_id,
            "active-client"
        );
        let fresh_service = ChatgptService::new(&config, true).unwrap();
        assert_eq!(
            fresh_service.store.load("inactive-client").unwrap().state(),
            "client_invalid"
        );
        assert!(
            !other_service
                .invalidate_client("missing-client")
                .await
                .unwrap()
        );
        assert_eq!(
            service.store.load_active().unwrap().unwrap().client_id,
            "active-client"
        );
    }

    #[tokio::test(flavor = "current_thread")]
    async fn logout_keeps_new_requests_blocked_until_local_tokens_are_cleared() {
        let dir = tempdir().unwrap();
        let service = ChatgptService::new(&dir.path().join("config.json"), true).unwrap();
        let account = test_account("issued-client", "https://auth.openai.com", "subject", None);
        service.store.save(&account).unwrap();
        let old_token = service.request_cancellation().await;
        let gate = service.refresh_gate.lock().await;
        let logout = {
            let service = Arc::clone(&service);
            tokio::spawn(async move { service.handle(json!({"action": "chatgpt_logout"})).await })
        };
        tokio::task::yield_now().await;
        assert!(old_token.is_cancelled());
        let waiting_for_new_token = {
            let service = Arc::clone(&service);
            tokio::spawn(async move { service.request_cancellation().await })
        };
        tokio::task::yield_now().await;
        assert!(!waiting_for_new_token.is_finished());

        drop(gate);
        let result = logout.await.unwrap().unwrap();
        assert_eq!(result["revocationConfirmed"], false);
        assert!(!waiting_for_new_token.await.unwrap().is_cancelled());
        assert_eq!(
            service.store.load_active().unwrap().unwrap().state(),
            "signed_out"
        );
    }

    #[tokio::test]
    async fn a_queued_refresh_preserves_terminal_registration_state() {
        let dir = tempdir().unwrap();
        let service =
            ChatgptService::new_test(&dir.path().join("config.json"), "http://127.0.0.1:1");
        for state in ["signed_out", "reconnect", "client_invalid"] {
            let mut account = test_account(
                "client",
                "https://auth.openai.com",
                "subject",
                Some("refresh"),
            );
            account.clear_tokens(state);
            service.store.save(&account).unwrap();
            assert!(
                service
                    .force_refresh(&service.store.load("client").unwrap())
                    .await
                    .is_err()
            );
            assert_eq!(service.store.load("client").unwrap().state(), state);
        }
    }

    #[tokio::test]
    async fn repeated_logout_never_confirms_a_failed_remote_revocation() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        drop(listener);
        let dir = tempdir().unwrap();
        let service = ChatgptService::new_test(
            &dir.path().join("config.json"),
            &format!("http://{address}"),
        );
        service
            .store
            .save(&test_account(
                "client",
                "https://auth.openai.com",
                "subject",
                Some("refresh"),
            ))
            .unwrap();
        for _ in 0..2 {
            let result = service.logout().await.unwrap();
            assert_eq!(result["revocationConfirmed"], false);
            let saved = service.store.load_active().unwrap().unwrap();
            assert_eq!(saved.state(), "signed_out");
            assert!(saved.refresh_token.is_none());
        }
    }

    #[tokio::test]
    async fn cancellation_after_refresh_request_preserves_rotated_credentials() {
        let received = Arc::new(tokio::sync::Notify::new());
        let release = Arc::new(tokio::sync::Notify::new());
        let app = Router::new().route(
            "/token",
            post({
                let received = received.clone();
                let release = release.clone();
                move || {
                    let received = received.clone();
                    let release = release.clone();
                    async move {
                        received.notify_one();
                        release.notified().await;
                        axum::Json(json!({
                            "access_token":"rotated-access", "refresh_token":"rotated-refresh",
                            "expires_in":3600, "token_type":"Bearer",
                        }))
                    }
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
            .store
            .save(&test_account(
                "client",
                "https://auth.openai.com",
                "subject",
                Some("old-refresh"),
            ))
            .unwrap();
        let caller = {
            let service = service.clone();
            tokio::spawn(async move {
                service
                    .force_refresh(&service.store.load("client").unwrap())
                    .await
            })
        };
        tokio::time::timeout(Duration::from_secs(2), received.notified())
            .await
            .unwrap();
        caller.abort();
        assert!(caller.await.unwrap_err().is_cancelled());
        release.notify_one();
        tokio::time::timeout(Duration::from_secs(2), async {
            loop {
                let saved = service.store.load("client").unwrap();
                if saved.refresh_token.as_deref() == Some("rotated-refresh") {
                    assert_eq!(saved.access_token.as_deref(), Some("rotated-access"));
                    assert_eq!(saved.subject, "subject");
                    break;
                }
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        server.abort();
    }

    #[tokio::test]
    async fn concurrent_refreshes_rotate_once_and_preserve_omitted_scope() {
        let requests = Arc::new(AtomicUsize::new(0));
        let app = Router::new()
            .route(
                "/token",
                post(|State(requests): State<Arc<AtomicUsize>>| async move {
                    requests.fetch_add(1, Ordering::SeqCst);
                    (
                        StatusCode::OK,
                        [(header::CONTENT_TYPE, "application/json")],
                        serde_json::to_string(&json!({
                            "access_token": "rotated-access",
                            "refresh_token": "rotated-refresh",
                            "expires_in": 3600,
                            "token_type": "Bearer"
                        }))
                        .unwrap(),
                    )
                }),
            )
            .with_state(requests.clone());
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
        let account = store::StoredAccount {
            email: Some("person@example.test".to_owned()),
            issuer: "https://auth.openai.com".to_owned(),
            subject: "subject".to_owned(),
            client_id: "client".to_owned(),
            ext_agent_host_id: "urn:uuid:123e4567-e89b-12d3-a456-426614174000".to_owned(),
            id_token: Some("id".to_owned()),
            access_token: Some("old-access".to_owned()),
            refresh_token: Some("old-refresh".to_owned()),
            token_type: "Bearer".to_owned(),
            expires_at: Some(store::now_secs() + 1),
            earliest_refresh_at: None,
            scopes: vec!["chatgpt.tokens.use.direct".to_owned()],
            saved_at: store::now_secs(),
            label: Some("person@example.test".to_owned()),
            state: None,
            new_registration: true,
            welcome_notice_id: None,
        };
        service.store.save(&account).unwrap();
        let first = service.access_account();
        let second = service.access_account();
        let status = service.status();
        let (first, second, status) = tokio::join!(first, second, status);
        assert_eq!(
            first.unwrap().access_token.as_deref(),
            Some("rotated-access")
        );
        assert_eq!(
            second.unwrap().access_token.as_deref(),
            Some("rotated-access")
        );
        assert_eq!(requests.load(Ordering::SeqCst), 1);
        service.store.save(&account).unwrap();
        let other = ChatgptService::new_test(
            &dir.path().join("config.json"),
            &format!("http://{address}"),
        );
        let (first, second) = tokio::join!(
            service.force_refresh(&account),
            other.force_refresh(&account)
        );
        assert_eq!(
            first.unwrap().access_token.as_deref(),
            Some("rotated-access")
        );
        assert_eq!(
            second.unwrap().access_token.as_deref(),
            Some("rotated-access")
        );
        assert_eq!(requests.load(Ordering::SeqCst), 2);
        assert_eq!(status.unwrap()["account"]["newRegistration"], true);
        assert!(
            service
                .store
                .load_active()
                .unwrap()
                .unwrap()
                .new_registration
        );
        assert_eq!(
            service.store.load_active().unwrap().unwrap().scopes,
            vec!["chatgpt.tokens.use.direct"]
        );
        server.abort();
    }

    #[tokio::test]
    async fn logout_from_another_process_closes_pending_callbacks_and_rejects_late_activation() {
        let dir = tempdir().unwrap();
        let config = dir.path().join("config.json");
        let daemon = ChatgptService::new(&config, true).unwrap();
        let terminal = ChatgptService::new(&config, true).unwrap();
        let login = daemon
            .handle(json!({"action":"chatgpt_login_start","mode":"new"}))
            .await
            .unwrap();
        let previous_revision = session::revision(&daemon.store).unwrap();
        let url = Url::parse(login["authorizeUrl"].as_str().unwrap()).unwrap();
        let redirect = url
            .query_pairs()
            .find(|(key, _)| key == "redirect_uri")
            .unwrap()
            .1
            .into_owned();
        let address = Url::parse(&redirect).unwrap();
        terminal.logout().await.unwrap();
        tokio::time::timeout(Duration::from_secs(2), async {
            while daemon.pending.lock().await.is_some()
                || daemon
                    .pending_task
                    .lock()
                    .await
                    .as_ref()
                    .is_some_and(|task| !task.is_finished())
            {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        assert!(
            tokio::net::TcpStream::connect((address.host_str().unwrap(), address.port().unwrap()))
                .await
                .is_err()
        );
        let candidate = test_account(
            "late-client",
            "https://auth.openai.com",
            "subject",
            Some("refresh"),
        );
        assert!(
            !daemon
                .activate_account_inner(&candidate, Some(&previous_revision))
                .await
                .unwrap()
        );
        assert!(daemon.store.load_active().unwrap().is_none());
        assert_eq!(daemon.status().await.unwrap()["state"], "signed_out");
    }

    #[tokio::test]
    async fn logout_from_another_process_interrupts_inflight_generation() {
        let received = Arc::new(tokio::sync::Notify::new());
        let app = Router::new()
            .route(
                "/v1/models",
                axum::routing::get(|| async {
                    axum::Json(json!({"models":[{"slug":"test-model","visibility":"list"}]}))
                }),
            )
            .route(
                "/v1/responses",
                post({
                    let received = received.clone();
                    move || {
                        let received = received.clone();
                        async move {
                            received.notify_one();
                            std::future::pending::<String>().await
                        }
                    }
                }),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        let dir = tempdir().unwrap();
        let config = dir.path().join("config.json");
        let daemon = ChatgptService::new_test(&config, &format!("http://{address}"));
        let terminal = ChatgptService::new_test(&config, &format!("http://{address}"));
        daemon
            .store
            .save(&test_account(
                "client",
                "https://auth.openai.com",
                "subject",
                None,
            ))
            .unwrap();
        let request = {
            let daemon = daemon.clone();
            tokio::spawn(async move {
                daemon.handle(json!({"action":"chatgpt_generate","instructions":"Write a commit", "input":"diff"})).await
            })
        };
        tokio::time::timeout(Duration::from_secs(2), received.notified())
            .await
            .unwrap();
        terminal.logout().await.unwrap();
        let result = tokio::time::timeout(Duration::from_secs(2), request)
            .await
            .unwrap()
            .unwrap()
            .unwrap();
        assert_eq!(result["reason"], "interrupted");
        assert_eq!(
            daemon.store.load_active().unwrap().unwrap().state(),
            "signed_out"
        );
        server.abort();
    }

    #[tokio::test]
    async fn proactive_refresh_cannot_send_requests_using_a_replacement_account() {
        for action in [
            json!({"action":"chatgpt_generate", "instructions":"Commit", "input":"private diff"}),
            json!({"action":"chatgpt_models"}),
        ] {
            let received = Arc::new(tokio::sync::Notify::new());
            let release = Arc::new(tokio::sync::Notify::new());
            let sent = Arc::new(AtomicUsize::new(0));
            let app = Router::new()
                .route("/token", post({
                    let received = received.clone();
                    let release = release.clone();
                    move || {
                        let received = received.clone();
                        let release = release.clone();
                        async move {
                            received.notify_one();
                            release.notified().await;
                            axum::Json(json!({"access_token":"old-rotated", "refresh_token":"rotated-refresh", "expires_in":3600, "token_type":"Bearer"}))
                        }
                    }
                }))
                .route("/v1/models", axum::routing::get({
                    let sent = sent.clone();
                    move || { let sent = sent.clone(); async move {
                        sent.fetch_add(1, Ordering::SeqCst);
                        axum::Json(json!({"models":[{"slug":"test-model", "visibility":"list"}]}))
                    }}
                }))
                .route("/v1/responses", post({
                    let sent = sent.clone();
                    move || { let sent = sent.clone(); async move {
                        sent.fetch_add(1, Ordering::SeqCst);
                        StatusCode::BAD_REQUEST
                    }}
                }));
            let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
            let base = format!("http://{}", listener.local_addr().unwrap());
            let server = tokio::spawn(async move {
                let _ = axum::serve(listener, app).await;
            });
            let dir = tempdir().unwrap();
            let config = dir.path().join("config.json");
            let daemon = ChatgptService::new_test(&config, &base);
            let terminal = ChatgptService::new_test(&config, &base);
            let mut original = test_account(
                "old-client",
                "https://auth.openai.com",
                "old-subject",
                Some("old-refresh"),
            );
            original.expires_at = Some(store::now_secs() + 1);
            daemon.store.save(&original).unwrap();
            let request = {
                let daemon = daemon.clone();
                tokio::spawn(async move { daemon.handle(action).await })
            };
            tokio::time::timeout(Duration::from_secs(2), received.notified())
                .await
                .unwrap();
            let mut replacement = test_account(
                "new-client",
                "https://auth.openai.com",
                "new-subject",
                Some("new-refresh"),
            );
            replacement.access_token = Some("replacement-access".to_owned());
            terminal.activate_account(&replacement).await.unwrap();
            release.notify_one();
            let result = tokio::time::timeout(Duration::from_secs(2), request)
                .await
                .unwrap()
                .unwrap();
            match result {
                Ok(value) => assert_eq!(value["reason"], "interrupted"),
                Err(error) => assert!(error.to_string().contains("interrupted")),
            }
            // Detached refresh still persists rotation for the original account.
            tokio::time::timeout(Duration::from_secs(2), async {
                while daemon
                    .store
                    .load("old-client")
                    .unwrap()
                    .access_token
                    .as_deref()
                    != Some("old-rotated")
                {
                    tokio::time::sleep(Duration::from_millis(5)).await;
                }
            })
            .await
            .unwrap();
            assert_eq!(
                sent.load(Ordering::SeqCst),
                0,
                "superseded requests must stop before model/Responses HTTP"
            );
            assert_eq!(
                daemon.store.load_active().unwrap().unwrap().client_id,
                "new-client"
            );
            server.abort();
        }
    }

    #[tokio::test]
    async fn credentials_cannot_be_selected_after_the_captured_session_changed() {
        let dir = tempdir().unwrap();
        let config = dir.path().join("config.json");
        let daemon = ChatgptService::new_test(&config, "http://127.0.0.1:1");
        let terminal = ChatgptService::new_test(&config, "http://127.0.0.1:1");
        daemon
            .store
            .save(&test_account(
                "client",
                "https://auth.openai.com",
                "subject",
                None,
            ))
            .unwrap();
        let revision = session::revision(&daemon.store).unwrap();
        terminal
            .activate_account(&test_account(
                "client",
                "https://auth.openai.com",
                "subject",
                None,
            ))
            .await
            .unwrap();
        assert!(
            daemon
                .access_account_for_revision(&revision)
                .await
                .unwrap_err()
                .to_string()
                .contains("interrupted")
        );
    }

    #[tokio::test]
    async fn external_activation_interrupts_only_the_superseded_generation() {
        let received = Arc::new(tokio::sync::Notify::new());
        let requests = Arc::new(AtomicUsize::new(0));
        let app = Router::new()
            .route("/v1/models", axum::routing::get(|| async {
                axum::Json(json!({"models":[{"slug":"test-model", "visibility":"list"}]}))
            }))
            .route("/v1/responses", post({
                let received = received.clone(); let requests = requests.clone();
                move || {
                    let received = received.clone(); let requests = requests.clone();
                    async move {
                        if requests.fetch_add(1, Ordering::SeqCst) == 0 {
                            received.notify_one(); std::future::pending::<()>().await;
                        }
                        ([(header::CONTENT_TYPE,"text/event-stream")],
                            "data: {\"type\":\"response.completed\",\"response\":{\"output\":[{\"type\":\"message\",\"content\":[{\"type\":\"output_text\",\"text\":\"Fresh generation\"}]}]}}\n\n")
                    }
                }
            }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        let dir = tempdir().unwrap();
        let config = dir.path().join("config.json");
        let daemon = ChatgptService::new_test(&config, &base);
        let terminal = ChatgptService::new_test(&config, &base);
        daemon
            .store
            .save(&test_account(
                "old-client",
                "https://auth.openai.com",
                "old-subject",
                None,
            ))
            .unwrap();
        let action =
            json!({"action":"chatgpt_generate", "instructions":"Write a commit", "input":"diff"});
        let old = {
            let daemon = daemon.clone();
            let action = action.clone();
            tokio::spawn(async move { daemon.handle(action).await })
        };
        tokio::time::timeout(Duration::from_secs(2), received.notified())
            .await
            .unwrap();
        terminal
            .activate_account(&test_account(
                "new-client",
                "https://auth.openai.com",
                "new-subject",
                None,
            ))
            .await
            .unwrap();
        assert_eq!(
            tokio::time::timeout(Duration::from_secs(2), old)
                .await
                .unwrap()
                .unwrap()
                .unwrap()["reason"],
            "interrupted"
        );
        assert!(!daemon.request_cancellation().await.is_cancelled());
        let fresh = daemon.handle(action).await.unwrap();
        assert_eq!(fresh["outcome"], "completed");
        assert_eq!(fresh["text"], "Fresh generation");
        assert_eq!(requests.load(Ordering::SeqCst), 2);
        server.abort();
    }

    #[tokio::test]
    async fn logout_intent_blocks_usage_even_when_the_record_lock_times_out() {
        let dir = tempdir().unwrap();
        let config = dir.path().join("config.json");
        let daemon = ChatgptService::new_test(&config, "http://127.0.0.1:1");
        let terminal = ChatgptService::new_test(&config, "http://127.0.0.1:1");
        let account = test_account(
            "client",
            "https://auth.openai.com",
            "subject",
            Some("refresh"),
        );
        daemon.store.save(&account).unwrap();
        let guard = daemon.store.lock("client").await.unwrap();
        assert!(terminal.logout().await.is_err());
        let status = tokio::time::timeout(Duration::from_millis(200), daemon.status())
            .await
            .unwrap()
            .unwrap();
        assert_eq!(status["state"], "signed_out");
        assert_eq!(status["account"]["planUsage"], false);
        assert!(daemon.access_account().await.is_err());
        let session_guard = daemon.store.session_lock().await.unwrap();
        let generation = {
            let daemon = daemon.clone();
            tokio::spawn(async move {
                daemon.handle(json!({"action":"chatgpt_generate", "instructions":"Write a commit", "input":"diff"})).await
            })
        };
        tokio::task::yield_now().await;
        assert_eq!(daemon.status().await.unwrap()["state"], "signed_out");
        assert!(!generation.is_finished());
        drop(session_guard);
        let generation = generation.await.unwrap().unwrap();
        assert_eq!(generation["reason"], "signed_out");
        let models_error = models::list(&daemon).await.unwrap_err();
        assert!(
            models_error
                .downcast_ref::<errors::ProviderError>()
                .is_none()
        );
        assert_eq!(
            errors::refresh_failure(&daemon, "client", None).reason,
            "signed_out"
        );
        drop(guard);
        assert!(daemon.force_refresh(&account).await.is_err());
        assert_eq!(
            daemon.store.load_active().unwrap().unwrap().state(),
            "ready"
        );
        assert!(
            daemon
                .activate_account_inner(&account, Some(&session::revision(&daemon.store).unwrap()))
                .await
                .unwrap()
        );
        assert_eq!(daemon.status().await.unwrap()["state"], "ready");
        assert!(daemon.access_account().await.is_ok());
    }

    #[tokio::test]
    async fn an_older_callback_cannot_replace_a_newer_login_or_cancel_its_requests() {
        let dir = tempdir().unwrap();
        let config = dir.path().join("config.json");
        let daemon = ChatgptService::new(&config, true).unwrap();
        let terminal = ChatgptService::new(&config, true).unwrap();
        let old = test_account(
            "old-client",
            "https://auth.openai.com",
            "old-subject",
            Some("old-refresh"),
        );
        daemon.store.save(&old).unwrap();
        let expected = session::revision(&daemon.store).unwrap();
        let replacement = test_account(
            "new-client",
            "https://auth.openai.com",
            "new-subject",
            Some("new-refresh"),
        );
        assert!(terminal.activate_account(&replacement).await.unwrap());
        let request = daemon.request_cancellation().await;
        assert!(
            !daemon
                .activate_account_inner(&old, Some(&expected))
                .await
                .unwrap()
        );
        assert!(!request.is_cancelled());
        assert_eq!(
            daemon.store.load_active().unwrap().unwrap().client_id,
            "new-client"
        );
        assert_eq!(
            daemon
                .store
                .load_active()
                .unwrap()
                .unwrap()
                .refresh_token
                .as_deref(),
            Some("new-refresh")
        );
    }

    #[tokio::test]
    async fn revocation_finishes_after_the_logout_caller_is_cancelled() {
        let received = Arc::new(tokio::sync::Notify::new());
        let release = Arc::new(tokio::sync::Notify::new());
        let revoked = Arc::new(AtomicUsize::new(0));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let app = Router::new()
            .route("/discovery", axum::routing::get({
                let received = received.clone(); let release = release.clone();
                move || {
                    let received = received.clone(); let release = release.clone();
                    async move {
                        received.notify_one(); release.notified().await;
                        axum::Json(json!({"issuer":"https://auth.openai.com", "jwks_uri":"https://auth.openai.com/.well-known/jwks.json",
                            "revocation_endpoint":"https://auth.openai.com/api/accounts/oauth/revoke","id_token_signing_alg_values_supported":["RS256"]}))
                    }
                }
            }))
            .route("/revoke", post({
                let revoked = revoked.clone();
                move || { let revoked = revoked.clone(); async move { revoked.fetch_add(1, Ordering::SeqCst); StatusCode::NO_CONTENT } }
            }));
        let server = tokio::spawn(async move {
            let _ = axum::serve(listener, app).await;
        });
        let dir = tempdir().unwrap();
        let service = ChatgptService::new_test(&dir.path().join("config.json"), &base);
        service
            .store
            .save(&test_account(
                "client",
                "https://auth.openai.com",
                "subject",
                Some("refresh"),
            ))
            .unwrap();
        let caller = {
            let service = service.clone();
            tokio::spawn(async move { service.logout().await })
        };
        tokio::time::timeout(Duration::from_secs(2), received.notified())
            .await
            .unwrap();
        assert!(
            service
                .store
                .load_active()
                .unwrap()
                .unwrap()
                .refresh_token
                .is_none()
        );
        caller.abort();
        assert!(caller.await.unwrap_err().is_cancelled());
        release.notify_one();
        tokio::time::timeout(Duration::from_secs(2), async {
            while revoked.load(Ordering::SeqCst) == 0 {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        assert_eq!(revoked.load(Ordering::SeqCst), 1);
        assert_eq!(service.status().await.unwrap()["state"], "signed_out");
        server.abort();
    }

    #[tokio::test]
    async fn refresh_transport_failure_keeps_old_credentials() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        drop(listener);
        let dir = tempdir().unwrap();
        let service = ChatgptService::new_test(
            &dir.path().join("config.json"),
            &format!("http://{address}"),
        );
        let account = store::StoredAccount {
            email: Some("person@example.test".to_owned()),
            issuer: "https://auth.openai.com".to_owned(),
            subject: "subject".to_owned(),
            client_id: "client".to_owned(),
            ext_agent_host_id: "urn:uuid:123e4567-e89b-12d3-a456-426614174000".to_owned(),
            id_token: Some("id".to_owned()),
            access_token: Some("old-access".to_owned()),
            refresh_token: Some("old-refresh".to_owned()),
            token_type: "Bearer".to_owned(),
            expires_at: Some(store::now_secs() + 1),
            earliest_refresh_at: None,
            scopes: vec!["chatgpt.tokens.use.direct".to_owned()],
            saved_at: store::now_secs(),
            label: Some("person@example.test".to_owned()),
            state: None,
            new_registration: false,
            welcome_notice_id: None,
        };
        service.store.save(&account).unwrap();
        assert!(service.access_account().await.is_err());
        let saved = service.store.load_active().unwrap().unwrap();
        assert_eq!(saved.access_token.as_deref(), Some("old-access"));
        assert_eq!(saved.refresh_token.as_deref(), Some("old-refresh"));
    }

    #[tokio::test]
    async fn malformed_rotation_response_keeps_old_credentials() {
        let app = Router::new().route(
            "/token",
            post(|| async {
                (
                    StatusCode::OK,
                    [(header::CONTENT_TYPE, "application/json")],
                    r#"{"access_token":"new-access","expires_in":3600,"token_type":"Bearer"}"#,
                )
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
        let account = store::StoredAccount {
            email: Some("person@example.test".to_owned()),
            issuer: "https://auth.openai.com".to_owned(),
            subject: "subject".to_owned(),
            client_id: "client".to_owned(),
            ext_agent_host_id: "urn:uuid:123e4567-e89b-12d3-a456-426614174000".to_owned(),
            id_token: Some("id".to_owned()),
            access_token: Some("old-access".to_owned()),
            refresh_token: Some("old-refresh".to_owned()),
            token_type: "Bearer".to_owned(),
            expires_at: Some(store::now_secs() + 1),
            earliest_refresh_at: None,
            scopes: vec!["chatgpt.tokens.use.direct".to_owned()],
            saved_at: store::now_secs(),
            label: Some("person@example.test".to_owned()),
            state: None,
            new_registration: false,
            welcome_notice_id: None,
        };
        service.store.save(&account).unwrap();

        assert!(service.access_account().await.is_err());
        let saved = service.store.load_active().unwrap().unwrap();
        assert_eq!(saved.access_token.as_deref(), Some("old-access"));
        assert_eq!(saved.refresh_token.as_deref(), Some("old-refresh"));
        server.abort();
    }
}
