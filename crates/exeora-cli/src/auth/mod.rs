use crate::config::credential_fallback_path;
use anyhow::{Context, Result, anyhow, bail};
use axum::{
    Router,
    extract::{Query, State},
    http::StatusCode,
    response::Html,
    routing::get,
};
use keyring::Entry;
use oauth2::{
    AuthUrl, ClientId, CsrfToken, PkceCodeChallenge, RedirectUrl, Scope, TokenUrl,
    basic::BasicClient,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs,
    io::ErrorKind,
    path::Path,
    sync::{Arc, Mutex},
};
use tokio::sync::{Mutex as AsyncMutex, oneshot};
use url::Url;

const SERVICE: &str = "exeora";
const ACCOUNT: &str = "refresh-token";
const EARLY_REFRESH_MS: u64 = 60_000;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredCredentials {
    pub refresh_token: String,
    pub issuer: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliClientInfo {
    pub client_id: String,
    pub authorization_endpoint: String,
    pub token_endpoint: String,
    #[serde(default)]
    pub device_code_endpoint: Option<String>,
    #[serde(default)]
    pub device_token_endpoint: Option<String>,
    pub scopes: Vec<String>,
}

#[derive(Debug, Clone)]
struct CachedToken {
    token: String,
    expires_at: u64,
}

pub struct AuthManager {
    gateway: String,
    http: reqwest::Client,
    cached: AsyncMutex<Option<CachedToken>>,
}

impl AuthManager {
    pub fn new(gateway: String, http: reqwest::Client) -> Self {
        Self {
            gateway,
            http,
            cached: AsyncMutex::new(None),
        }
    }

    pub async fn discover_client(&self) -> Result<CliClientInfo> {
        discover_client(&self.http, &self.gateway).await
    }

    pub async fn access_token(&self) -> Result<String> {
        {
            let cached = self.cached.lock().await;
            if let Some(cached) = cached.as_ref()
                && cached.expires_at.saturating_sub(EARLY_REFRESH_MS) > crate::protocol::now_ms()
            {
                return Ok(cached.token.clone());
            }
        }

        let credentials = load_credentials()?
            .ok_or_else(|| anyhow!("Not signed in. Run `exeora login` first."))?;
        let origin = Url::parse(&self.gateway)?.origin().ascii_serialization();
        if credentials.issuer != origin {
            bail!(
                "You are signed in to {}, but the configured gateway is {}. Run `exeora login` again.",
                credentials.issuer,
                self.gateway
            );
        }
        let client = self.discover_client().await?;
        let response = self
            .http
            .post(&client.token_endpoint)
            .form(&[
                ("grant_type", "refresh_token"),
                ("client_id", client.client_id.as_str()),
                ("refresh_token", credentials.refresh_token.as_str()),
            ])
            .send()
            .await?;
        if matches!(response.status().as_u16(), 400 | 401) {
            clear_credentials()?;
            bail!("Not signed in. Run `exeora login` first.");
        }
        if !response.status().is_success() {
            bail!(
                "Could not refresh the session ({}).",
                response.status().as_u16()
            );
        }
        let token: RefreshResponse = response.json().await?;
        let access = token
            .access_token
            .ok_or_else(|| anyhow!("The gateway returned no access token."))?;
        let expires_at = crate::protocol::now_ms() + token.expires_in.unwrap_or(3600) * 1000;
        *self.cached.lock().await = Some(CachedToken {
            token: access.clone(),
            expires_at,
        });
        Ok(access)
    }

    pub async fn cache_access_token(&self, token: String, expires_at: u64) {
        *self.cached.lock().await = Some(CachedToken { token, expires_at });
    }

    pub async fn forget_access_token(&self) {
        *self.cached.lock().await = None;
    }

    pub async fn login_browser(&self) -> Result<LoginResult> {
        let info = self.discover_client().await?;
        let state = CsrfToken::new_random();
        let expected_state = state.secret().clone();
        let (redirect_uri, callback) = start_loopback(expected_state).await?;
        let oauth = BasicClient::new(ClientId::new(info.client_id.clone()))
            .set_auth_uri(AuthUrl::new(info.authorization_endpoint.clone())?)
            .set_token_uri(TokenUrl::new(info.token_endpoint.clone())?)
            .set_redirect_uri(RedirectUrl::new(redirect_uri.clone())?);
        let (challenge, verifier) = PkceCodeChallenge::new_random_sha256();
        let mut request = oauth
            .authorize_url(move || state)
            .set_pkce_challenge(challenge);
        for scope in &info.scopes {
            request = request.add_scope(Scope::new(scope.clone()));
        }
        let (authorize_url, _) = request.url();
        open::that(authorize_url.as_str()).context("Could not open the browser")?;
        println!("\nIf your browser did not open, visit:\n{authorize_url}\n");
        let returned = tokio::time::timeout(std::time::Duration::from_secs(300), callback)
            .await
            .map_err(|_| {
                anyhow!("Timed out waiting for the browser. Try `exeora login` again.")
            })???;

        self.finish_login(
            &info,
            returned.code,
            &redirect_uri,
            verifier.secret(),
            returned.issuer,
        )
        .await
    }

    /// Sign in from a machine with no browser: print a code, wait for another device.
    pub async fn login_code(&self) -> Result<LoginResult> {
        let info = self.discover_client().await?;
        let device_code_endpoint = info.device_code_endpoint.as_deref().ok_or_else(|| {
            anyhow!(
                "This Exeora does not support code sign-in. Upgrade the gateway, or run `exeora login` on a machine with a browser."
            )
        })?;
        let device_token_endpoint = info.device_token_endpoint.as_deref().ok_or_else(|| {
            anyhow!(
                "This Exeora does not support code sign-in. Upgrade the gateway, or run `exeora login` on a machine with a browser."
            )
        })?;
        let (challenge, verifier) = PkceCodeChallenge::new_random_sha256();
        let scope = info.scopes.join(" ");
        let response = self
            .http
            .post(device_code_endpoint)
            .form(&[
                ("client_id", info.client_id.as_str()),
                ("code_challenge", challenge.as_str()),
                ("code_challenge_method", "S256"),
                ("scope", scope.as_str()),
            ])
            .send()
            .await?;
        if !response.status().is_success() {
            let status = response.status().as_u16();
            let detail = response.text().await.unwrap_or_default();
            bail!(
                "Could not start code sign-in ({status}): {}",
                detail.chars().take(200).collect::<String>()
            );
        }
        let started: DeviceCodeResponse = response.json().await?;
        println!(
            "\nOn another device, visit:\n{}\n",
            started.verification_uri
        );
        println!("Enter this code:\n\n  {}\n", started.user_code);
        println!("Waiting for authorization...\n");

        let deadline =
            tokio::time::Instant::now() + std::time::Duration::from_secs(started.expires_in.max(1));
        let mut interval = started.interval.unwrap_or(5).max(1);
        loop {
            tokio::time::sleep(std::time::Duration::from_secs(interval)).await;
            if tokio::time::Instant::now() >= deadline {
                bail!("Timed out waiting for authorization. Try `exeora login --code` again.");
            }
            let poll = self
                .http
                .post(device_token_endpoint)
                .form(&[
                    ("client_id", info.client_id.as_str()),
                    ("device_code", started.device_code.as_str()),
                ])
                .send()
                .await?;
            let status = poll.status();
            if status.as_u16() == 429 {
                interval = retry_after_secs(&poll)
                    .unwrap_or(interval.saturating_add(5))
                    .max(1);
                continue;
            }
            if status.as_u16() == 400 {
                let body: DevicePollResponse = match poll.json().await {
                    Ok(body) => body,
                    Err(_) => bail!("Code sign-in failed (400)."),
                };
                match body.error.as_deref() {
                    Some("authorization_pending") => {}
                    Some("slow_down") => interval = interval.saturating_add(5),
                    Some("access_denied") => bail!("Authorization was declined."),
                    Some("expired_token") => {
                        bail!("The code expired. Try `exeora login --code` again.")
                    }
                    Some(other) => bail!("Code sign-in failed ({other})."),
                    None => bail!("Code sign-in failed (400)."),
                }
                continue;
            }
            if !status.is_success() {
                bail!("Code sign-in failed ({}).", status.as_u16());
            }
            let body: DevicePollResponse = match poll.json().await {
                Ok(body) => body,
                Err(_) => bail!("Code sign-in failed ({}).", status.as_u16()),
            };
            let code = body
                .authorization_code
                .ok_or_else(|| anyhow!("The gateway returned no authorization code."))?;
            let redirect_uri = body
                .redirect_uri
                .ok_or_else(|| anyhow!("The gateway returned no redirect URI."))?;
            return self
                .finish_login(&info, code, &redirect_uri, verifier.secret(), body.iss)
                .await;
        }
    }

    async fn finish_login(
        &self,
        info: &CliClientInfo,
        code: String,
        redirect_uri: &str,
        code_verifier: &str,
        issuer: Option<String>,
    ) -> Result<LoginResult> {
        let expected_issuer = Url::parse(&self.gateway)?.origin().ascii_serialization();
        if let Some(issuer) = issuer
            && issuer != expected_issuer
        {
            bail!(
                "The authorization came back from {issuer}, not {}. Aborting.",
                self.gateway
            );
        }
        let response = self
            .http
            .post(&info.token_endpoint)
            .form(&[
                ("grant_type", "authorization_code"),
                ("client_id", info.client_id.as_str()),
                ("code", code.as_str()),
                ("redirect_uri", redirect_uri),
                ("code_verifier", code_verifier),
            ])
            .send()
            .await?;
        if !response.status().is_success() {
            let status = response.status().as_u16();
            let detail = response.text().await.unwrap_or_default();
            bail!(
                "Token exchange failed ({status}): {}",
                detail.chars().take(200).collect::<String>()
            );
        }
        let token: LoginTokenResponse = response.json().await?;
        save_credentials(&StoredCredentials {
            refresh_token: token.refresh_token,
            issuer: expected_issuer,
        })?;
        let result = LoginResult {
            access_token: token.access_token,
            expires_at: crate::protocol::now_ms() + token.expires_in * 1000,
        };
        self.cache_access_token(result.access_token.clone(), result.expires_at)
            .await;
        Ok(result)
    }
}

#[derive(Debug, Deserialize)]
struct RefreshResponse {
    access_token: Option<String>,
    expires_in: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct LoginTokenResponse {
    access_token: String,
    refresh_token: String,
    expires_in: u64,
}

pub struct LoginResult {
    pub access_token: String,
    pub expires_at: u64,
}

#[derive(Debug, Deserialize)]
struct DeviceCodeResponse {
    device_code: String,
    user_code: String,
    verification_uri: String,
    expires_in: u64,
    interval: Option<u64>,
}

#[derive(Debug, Deserialize)]
struct DevicePollResponse {
    authorization_code: Option<String>,
    redirect_uri: Option<String>,
    iss: Option<String>,
    error: Option<String>,
}

fn retry_after_secs(response: &reqwest::Response) -> Option<u64> {
    let header = response.headers().get("retry-after")?.to_str().ok()?;
    header.parse().ok()
}

pub async fn discover_client(http: &reqwest::Client, gateway: &str) -> Result<CliClientInfo> {
    let url = Url::parse(gateway)?.join("/oauth/cli-client")?;
    let response = http
        .get(url)
        .send()
        .await
        .with_context(|| format!("Could not reach the Exeora gateway at {gateway}"))?;
    if !response.status().is_success() {
        bail!(
            "Could not reach the Exeora gateway at {gateway} ({}).",
            response.status().as_u16()
        );
    }
    Ok(response.json().await?)
}

pub fn save_credentials(credentials: &StoredCredentials) -> Result<()> {
    let serialized = serde_json::to_string(credentials)?;
    if let Ok(entry) = Entry::new(SERVICE, ACCOUNT)
        && entry.set_password(&serialized).is_ok()
    {
        let _ = fs::remove_file(credential_fallback_path()?);
        return Ok(());
    }
    let path = credential_fallback_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    write_secret_file(&path, serialized.as_bytes())?;
    Ok(())
}

pub fn load_credentials() -> Result<Option<StoredCredentials>> {
    if let Ok(entry) = Entry::new(SERVICE, ACCOUNT)
        && let Ok(value) = entry.get_password()
        && !value.is_empty()
    {
        return Ok(Some(serde_json::from_str(&value)?));
    }
    match fs::read(credential_fallback_path()?) {
        Ok(bytes) => Ok(Some(serde_json::from_slice(&bytes)?)),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error.into()),
    }
}

pub fn clear_credentials() -> Result<()> {
    if let Ok(entry) = Entry::new(SERVICE, ACCOUNT) {
        let _ = entry.delete_credential();
    }
    match fs::remove_file(credential_fallback_path()?) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.into()),
    }
}

pub fn using_file_fallback() -> bool {
    Entry::new(SERVICE, ACCOUNT)
        .and_then(|entry| entry.get_password())
        .is_err()
}

#[cfg(unix)]
fn write_secret_file(path: &Path, bytes: &[u8]) -> Result<()> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    let mut file = fs::OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .mode(0o600)
        .open(path)?;
    file.write_all(bytes)?;
    Ok(())
}

#[cfg(not(unix))]
fn write_secret_file(path: &Path, bytes: &[u8]) -> Result<()> {
    fs::write(path, bytes).map_err(Into::into)
}

#[derive(Clone)]
struct CallbackState {
    expected_state: String,
    result: Arc<Mutex<Option<oneshot::Sender<Result<CallbackResult>>>>>,
    shutdown: Arc<Mutex<Option<oneshot::Sender<()>>>>,
}

struct CallbackResult {
    code: String,
    issuer: Option<String>,
}

async fn start_loopback(
    expected_state: String,
) -> Result<(String, oneshot::Receiver<Result<CallbackResult>>)> {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let port = listener.local_addr()?.port();
    let (result_tx, result_rx) = oneshot::channel();
    let (shutdown_tx, shutdown_rx) = oneshot::channel();
    let state = CallbackState {
        expected_state,
        result: Arc::new(Mutex::new(Some(result_tx))),
        shutdown: Arc::new(Mutex::new(Some(shutdown_tx))),
    };
    let app = Router::new()
        .route("/callback", get(callback))
        .with_state(state);
    tokio::spawn(async move {
        let _ = axum::serve(listener, app)
            .with_graceful_shutdown(async {
                let _ = shutdown_rx.await;
            })
            .await;
    });
    Ok((format!("http://127.0.0.1:{port}/callback"), result_rx))
}

async fn callback(
    State(state): State<CallbackState>,
    Query(query): Query<HashMap<String, String>>,
) -> (StatusCode, Html<&'static str>) {
    let result = if let Some(error) = query.get("error") {
        Err(anyhow!("Authorization was declined ({error})."))
    } else if query.get("state") != Some(&state.expected_state) {
        Err(anyhow!(
            "The authorization response did not match this login attempt."
        ))
    } else if let Some(code) = query.get("code") {
        Ok(CallbackResult {
            code: code.clone(),
            issuer: query.get("iss").cloned(),
        })
    } else {
        Err(anyhow!("No authorization code was returned."))
    };
    let ok = result.is_ok();
    if let Some(sender) = state.result.lock().expect("callback result lock").take() {
        let _ = sender.send(result);
    }
    if let Some(sender) = state
        .shutdown
        .lock()
        .expect("callback shutdown lock")
        .take()
    {
        let _ = sender.send(());
    }
    if ok {
        (
            StatusCode::OK,
            Html(
                "<!doctype html><meta charset=utf-8><title>Exeora</title><p>Signed in. You can close this tab and return to the terminal.</p>",
            ),
        )
    } else {
        (
            StatusCode::BAD_REQUEST,
            Html(
                "<!doctype html><meta charset=utf-8><title>Exeora</title><p>Authorization failed. You can close this tab.</p>",
            ),
        )
    }
}
