use crate::{auth::AuthManager, policy::CommandPolicy};
use anyhow::{Result, bail};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use std::sync::Arc;
use url::Url;

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceView {
    pub id: String,
    pub name: String,
    pub platform: String,
    pub cli_version: Option<String>,
    pub online: Option<bool>,
    pub last_seen_at: Option<u64>,
    pub revoked_at: Option<u64>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectView {
    pub id: String,
    pub slug: String,
    pub name: String,
    pub device_id: String,
    pub local_path: String,
    pub mcp_url: String,
    pub policy: CommandPolicy,
    pub created_at: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceView {
    pub id: String,
    pub project_id: String,
    pub slug: String,
    pub name: String,
    pub branch: Option<String>,
    pub local_path: String,
    pub managed: bool,
    pub created_at: u64,
    pub updated_at: u64,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UserView {
    pub id: String,
    pub email: String,
    pub name: Option<String>,
    pub plan: Option<String>,
    pub limits: Option<serde_json::Value>,
    pub usage: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallView {
    pub id: String,
    pub project_id: String,
    pub workspace_id: Option<String>,
    pub workspace_slug: Option<String>,
    pub tool: String,
    pub status: String,
    pub duration_ms: u64,
    pub error_code: Option<String>,
    pub client_id: Option<String>,
    pub client_name: Option<String>,
    pub created_at: u64,
}

#[derive(Debug, Deserialize)]
struct ToolCallsPage {
    items: Vec<ToolCallView>,
    cursor: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct Registered {
    pub id: String,
    pub name: String,
    pub slug: Option<String>,
}

#[derive(Clone)]
pub struct ApiClient {
    base: Url,
    http: reqwest::Client,
    auth: Arc<AuthManager>,
}

impl ApiClient {
    pub fn new(base: &str, http: reqwest::Client, auth: Arc<AuthManager>) -> Result<Self> {
        Ok(Self {
            base: Url::parse(base)?,
            http,
            auth,
        })
    }

    async fn request<T: DeserializeOwned>(
        &self,
        method: reqwest::Method,
        path: &str,
        body: Option<serde_json::Value>,
    ) -> Result<T> {
        let token = self.auth.access_token().await?;
        let mut request = self
            .http
            .request(method.clone(), self.base.join(path)?)
            .bearer_auth(token);
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request.send().await?;
        if !response.status().is_success() {
            let status = response.status().as_u16();
            let detail = response.text().await.unwrap_or_default();
            if let Ok(value) = serde_json::from_str::<serde_json::Value>(&detail)
                && value.get("error").and_then(|v| v.as_str()) == Some("plan_limit")
            {
                let plan = value
                    .get("plan")
                    .and_then(|v| v.as_str())
                    .unwrap_or("current");
                let max = value.get("max").and_then(|v| v.as_u64()).unwrap_or(0);
                match value.get("limit").and_then(|v| v.as_str()) {
                    Some("devices") => bail!(
                        "Your {plan} plan allows {max} live machines. Revoke one from the dashboard before registering another."
                    ),
                    Some("projects") => bail!(
                        "Your {plan} plan allows {max} projects. Remove one from the dashboard before adding another."
                    ),
                    _ => {}
                }
            }
            bail!(
                "{} {path} failed ({status}): {}",
                method.as_str(),
                detail.chars().take(200).collect::<String>()
            );
        }
        Ok(response.json().await?)
    }

    pub async fn me(&self) -> Result<UserView> {
        self.request(reqwest::Method::GET, "/api/me", None).await
    }
    pub async fn list_devices(&self) -> Result<Vec<DeviceView>> {
        self.request(reqwest::Method::GET, "/api/devices", None)
            .await
    }
    pub async fn register_device(
        &self,
        name: &str,
        platform: &str,
        cli_version: &str,
    ) -> Result<Registered> {
        self.request(reqwest::Method::POST, "/api/devices", Some(serde_json::json!({ "name": name, "platform": platform, "cliVersion": cli_version }))).await
    }
    pub async fn list_projects(&self) -> Result<Vec<ProjectView>> {
        self.request(reqwest::Method::GET, "/api/projects", None)
            .await
    }
    pub async fn add_project(
        &self,
        device_id: &str,
        name: &str,
        slug: &str,
        local_path: &str,
    ) -> Result<Registered> {
        self.request(reqwest::Method::POST, "/api/projects", Some(serde_json::json!({ "deviceId": device_id, "name": name, "slug": slug, "localPath": local_path }))).await
    }
    pub async fn remove_project(&self, id: &str) -> Result<serde_json::Value> {
        self.request(
            reqwest::Method::DELETE,
            &format!("/api/projects/{id}"),
            None,
        )
        .await
    }
    pub async fn list_workspaces(&self, project_id: &str) -> Result<Vec<WorkspaceView>> {
        self.request(
            reqwest::Method::GET,
            &format!("/api/projects/{project_id}/workspaces"),
            None,
        )
        .await
    }
    pub async fn put_workspace(
        &self,
        project_id: &str,
        workspace: &crate::config::WorkspaceEntry,
    ) -> Result<WorkspaceView> {
        self.request(
            reqwest::Method::PUT,
            &format!("/api/projects/{project_id}/workspaces/{}", workspace.id),
            Some(serde_json::json!({
                "slug": workspace.slug,
                "name": workspace.name,
                "branch": workspace.branch,
                "localPath": workspace.root,
                "managed": workspace.managed,
            })),
        )
        .await
    }
    pub async fn remove_workspace(
        &self,
        project_id: &str,
        workspace_id: &str,
    ) -> Result<serde_json::Value> {
        self.request(
            reqwest::Method::DELETE,
            &format!("/api/projects/{project_id}/workspaces/{workspace_id}"),
            None,
        )
        .await
    }
    pub async fn list_tool_calls(&self, limit: usize) -> Result<Vec<ToolCallView>> {
        let mut calls = Vec::new();
        let mut cursor: Option<String> = None;
        loop {
            let path = cursor.as_ref().map_or_else(
                || "/api/tool-calls".to_owned(),
                |cursor| {
                    format!(
                        "/api/tool-calls?cursor={}",
                        url::form_urlencoded::byte_serialize(cursor.as_bytes()).collect::<String>()
                    )
                },
            );
            let page: ToolCallsPage = self.request(reqwest::Method::GET, &path, None).await?;
            let empty = page.items.is_empty();
            calls.extend(page.items);
            cursor = if empty { None } else { page.cursor };
            if cursor.is_none() || calls.len() >= limit {
                break;
            }
        }
        calls.truncate(limit);
        Ok(calls)
    }
}
