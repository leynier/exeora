use crate::{auth::AuthManager, policy::CommandPolicy};
use anyhow::{Result, bail};
use serde::{Deserialize, Serialize, de::DeserializeOwned};
use serde_json::{Value, json};
use std::{fmt, sync::Arc};
use url::Url;

/// A refusal from the gateway, kept in its parts so a command can tell one
/// refusal from another by its code instead of by reading the sentence.
#[derive(Debug)]
pub struct ApiError {
    pub status: u16,
    /// The `error` of the body: `slug_taken`, `no_repository`, `not_a_location`.
    pub code: Option<String>,
    /// The `message` of the body, when the gateway wrote a sentence for a person.
    pub message: Option<String>,
    summary: String,
}

impl fmt::Display for ApiError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.message.as_deref().unwrap_or(&self.summary))
    }
}

impl std::error::Error for ApiError {}

/// The code of a gateway refusal, when that is what the error is.
pub fn error_code(error: &anyhow::Error) -> Option<&str> {
    error
        .downcast_ref::<ApiError>()
        .and_then(|error| error.code.as_deref())
}

/// Whether the request failed for want of a gateway to talk to: the network
/// is down, the gateway did not answer in time, or what answered was a server
/// that could not serve. A refusal is not that. Somebody who is signed out,
/// or not allowed, has to be told so and not shown something else instead.
pub fn is_unreachable(error: &anyhow::Error) -> bool {
    error.chain().any(|cause| {
        if let Some(refusal) = cause.downcast_ref::<ApiError>() {
            return refusal.status >= 500;
        }
        cause.downcast_ref::<reqwest::Error>().is_some_and(|error| {
            error.is_connect() || error.is_timeout() || error.is_request() || error.is_body()
        })
    })
}

/// Whether the gateway answered that it has no such route or no such thing.
pub fn is_not_found(error: &anyhow::Error) -> bool {
    error
        .downcast_ref::<ApiError>()
        .is_some_and(|error| error.status == 404)
}

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
    /// The machine of the default location.
    pub device_id: String,
    pub local_path: String,
    #[serde(default)]
    pub repo_url: Option<String>,
    #[serde(default)]
    pub default_branch: Option<String>,
    /// Empty from a gateway older than locations, where the project is on
    /// `device_id` and nowhere else.
    #[serde(default)]
    pub locations: Vec<LocationView>,
    pub mcp_url: String,
    pub policy: CommandPolicy,
    pub created_at: u64,
    #[serde(default)]
    pub cloud: Option<ProjectCloudView>,
}

impl ProjectView {
    /// The copy of this project on a machine, when it has one there.
    pub fn location_on(&self, device_id: &str) -> Option<&LocationView> {
        self.locations
            .iter()
            .find(|location| location.device_id.as_deref() == Some(device_id))
    }
}

/// One place a project lives: a machine of the person, or Exeora Cloud.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocationView {
    pub id: String,
    pub kind: String,
    #[serde(default)]
    pub device_id: Option<String>,
    pub name: String,
    pub slug: String,
    #[serde(default)]
    pub local_path: Option<String>,
    pub status: String,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub error_code: Option<String>,
    #[serde(default, rename = "default")]
    pub is_default: bool,
    #[serde(default)]
    pub online: bool,
    #[serde(default)]
    pub state: String,
}

impl LocationView {
    pub fn is_cloud(&self) -> bool {
        self.kind == "cloud"
    }
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectCloudView {
    pub repo_url: String,
    pub default_branch: String,
    #[serde(default)]
    pub has_credential: bool,
}

#[derive(Debug, Deserialize)]
struct Locations {
    locations: Vec<LocationView>,
}

/// What `POST /api/projects` answers. `location` says what happened: the
/// project was `created`, this machine `joined` one that existed, or the same
/// registration was `updated`. Absent from a gateway older than locations.
#[derive(Debug, Clone, Deserialize)]
pub struct ProjectAdded {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub slug: Option<String>,
    #[serde(default)]
    pub location: Option<String>,
}

/// What this machine sends when it registers a directory.
#[derive(Debug, Clone)]
pub struct ProjectRegistration<'a> {
    pub device_id: &'a str,
    pub name: &'a str,
    pub slug: &'a str,
    pub local_path: &'a str,
    pub repo_url: Option<&'a str>,
    pub default_branch: Option<&'a str>,
}

/// A machine of the account as `GET /api/machines` lists it: one the person
/// owns, holding copies of projects, or one Exeora Cloud runs for a workspace.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MachineView {
    pub device_id: String,
    pub kind: String,
    pub name: String,
    #[serde(default)]
    pub platform: String,
    #[serde(default)]
    pub state: String,
    #[serde(default)]
    pub revoked_at: Option<u64>,
    #[serde(default)]
    pub projects: Vec<MachineProjectView>,
    #[serde(default)]
    pub project: Option<MachineCloudProjectView>,
    #[serde(default)]
    pub workspace: Option<MachineCloudWorkspaceView>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MachineProjectView {
    pub slug: String,
    #[serde(default)]
    pub status: String,
    #[serde(default, rename = "default")]
    pub is_default: bool,
    #[serde(default)]
    pub workspaces: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MachineCloudProjectView {
    pub slug: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct MachineCloudWorkspaceView {
    pub slug: String,
    #[serde(default)]
    pub branch: Option<String>,
}

/// Whether the account is connected to GitHub, which decides whose
/// credentials a clone tries first.
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubStatus {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub connected: bool,
    #[serde(default)]
    pub connect_url: Option<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GithubRepositoryView {
    pub full_name: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub private: bool,
    #[serde(default)]
    pub default_branch: Option<String>,
    pub url: String,
    #[serde(default)]
    pub project_id: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GithubRepositories {
    #[serde(default)]
    repositories: Vec<GithubRepositoryView>,
}

/// A short-lived credential for one repository. It has no `Debug`, so that no
/// log line or error chain can ever carry the password by accident.
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitCredential {
    pub host: String,
    pub username: String,
    pub password: String,
    #[serde(default)]
    pub expires_at: Option<u64>,
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
    /// The machine that holds this checkout. Absent from a gateway older than
    /// locations, where it is the project's machine.
    #[serde(default)]
    pub device_id: Option<String>,
    /// The name of that machine.
    #[serde(default)]
    pub machine: Option<String>,
    /// Whether that machine is one Exeora Cloud runs for this workspace alone.
    #[serde(default)]
    pub cloud: bool,
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
}

/// A machine of a cloud project, as `GET /api/cloud/projects` lists it.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudMachineView {
    pub device_id: String,
    #[serde(default)]
    pub workspace_id: Option<String>,
    pub workspace_slug: String,
    #[serde(default)]
    pub branch: Option<String>,
    pub status: String,
    #[serde(default)]
    pub step: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub online: bool,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudProjectView {
    pub project_id: String,
    pub slug: String,
    pub name: String,
    pub repo_url: String,
    pub default_branch: String,
    #[serde(default)]
    pub has_credential: bool,
    #[serde(default)]
    pub machines: Vec<CloudMachineView>,
}

#[derive(Debug, Deserialize)]
struct CloudProjects {
    projects: Vec<CloudProjectView>,
}

/// What a create answers: the rows exist, the machine is on its way.
///
/// Or there is no machine at all. A repository that is already a project of
/// the account is put on Exeora Cloud as one more of its locations, and that
/// starts nothing: the answer names the project, says `joined`, and carries
/// no device.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CloudCreated {
    #[serde(default)]
    pub project_id: Option<String>,
    #[serde(default)]
    pub workspace_id: Option<String>,
    #[serde(default)]
    pub device_id: Option<String>,
    #[serde(default)]
    pub slug: Option<String>,
    #[serde(default)]
    pub status: Option<String>,
    #[serde(default)]
    pub location: Option<String>,
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
                    Some("cloudMachines") => bail!(
                        "Your {plan} plan allows {max} cloud machines. Remove one before creating another."
                    ),
                    _ => {}
                }
            }
            let body = serde_json::from_str::<Value>(&detail).ok();
            let field = |name: &str| {
                body.as_ref()
                    .and_then(|value| value.get(name))
                    .and_then(Value::as_str)
                    .filter(|text| !text.is_empty())
                    .map(str::to_owned)
            };
            return Err(ApiError {
                status,
                code: field("error"),
                message: field("message"),
                summary: format!(
                    "{} {path} failed ({status}): {}",
                    method.as_str(),
                    detail.chars().take(200).collect::<String>()
                ),
            }
            .into());
        }
        Ok(response.json().await?)
    }

    pub async fn me(&self) -> Result<UserView> {
        self.request(reqwest::Method::GET, "/api/me", None).await
    }
    pub async fn cloud_projects(&self) -> Result<Vec<CloudProjectView>> {
        let page: CloudProjects = self
            .request(reqwest::Method::GET, "/api/cloud/projects", None)
            .await?;
        Ok(page.projects)
    }
    pub async fn cloud_add_project(&self, body: serde_json::Value) -> Result<CloudCreated> {
        self.request(reqwest::Method::POST, "/api/cloud/projects", Some(body))
            .await
    }
    pub async fn cloud_add_workspace(
        &self,
        project_id: &str,
        body: serde_json::Value,
    ) -> Result<CloudCreated> {
        self.request(
            reqwest::Method::POST,
            &format!("/api/cloud/projects/{project_id}/workspaces"),
            Some(body),
        )
        .await
    }
    pub async fn cloud_set_credential(
        &self,
        project_id: &str,
        body: serde_json::Value,
    ) -> Result<serde_json::Value> {
        self.request(
            reqwest::Method::PUT,
            &format!("/api/cloud/projects/{project_id}/credential"),
            Some(body),
        )
        .await
    }
    pub async fn cloud_remove_project(&self, project_id: &str) -> Result<serde_json::Value> {
        self.request(
            reqwest::Method::DELETE,
            &format!("/api/cloud/projects/{project_id}"),
            None,
        )
        .await
    }
    pub async fn cloud_remove_workspace(
        &self,
        project_id: &str,
        workspace_id: &str,
    ) -> Result<serde_json::Value> {
        self.request(
            reqwest::Method::DELETE,
            &format!("/api/cloud/projects/{project_id}/workspaces/{workspace_id}"),
            None,
        )
        .await
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
    /// The same listing as the gateway wrote it, for `--json`.
    pub async fn list_projects_raw(&self) -> Result<Vec<Value>> {
        self.request(reqwest::Method::GET, "/api/projects", None)
            .await
    }
    pub async fn add_project(&self, project: ProjectRegistration<'_>) -> Result<ProjectAdded> {
        let mut body = json!({
            "deviceId": project.device_id,
            "name": project.name,
            "slug": project.slug,
            "localPath": project.local_path,
        });
        if let Some(repo_url) = project.repo_url {
            body["repoUrl"] = json!(repo_url);
        }
        if let Some(default_branch) = project.default_branch {
            body["defaultBranch"] = json!(default_branch);
        }
        self.request(reqwest::Method::POST, "/api/projects", Some(body))
            .await
    }
    pub async fn list_locations(&self, project_id: &str) -> Result<Vec<LocationView>> {
        let page: Locations = self
            .request(
                reqwest::Method::GET,
                &format!("/api/projects/{project_id}/locations"),
                None,
            )
            .await?;
        Ok(page.locations)
    }
    pub async fn add_location(&self, project_id: &str, body: Value) -> Result<Vec<LocationView>> {
        let page: Locations = self
            .request(
                reqwest::Method::POST,
                &format!("/api/projects/{project_id}/locations"),
                Some(body),
            )
            .await?;
        Ok(page.locations)
    }
    pub async fn remove_location(&self, project_id: &str, location_id: &str) -> Result<Value> {
        self.request(
            reqwest::Method::DELETE,
            &format!("/api/projects/{project_id}/locations/{location_id}"),
            None,
        )
        .await
    }
    pub async fn set_default_location(
        &self,
        project_id: &str,
        location_id: &str,
    ) -> Result<Vec<LocationView>> {
        let page: Locations = self
            .request(
                reqwest::Method::PUT,
                &format!("/api/projects/{project_id}/default-location"),
                Some(json!({ "locationId": location_id })),
            )
            .await?;
        Ok(page.locations)
    }
    /// What this machine says about its own copy of a project: that it is
    /// cloning, where the copy ended up, or why there is none.
    pub async fn report_location(
        &self,
        project_id: &str,
        device_id: &str,
        body: Value,
    ) -> Result<Value> {
        self.request(
            reqwest::Method::PUT,
            &format!("/api/projects/{project_id}/locations/{device_id}"),
            Some(body),
        )
        .await
    }
    /// Makes a workspace wherever the project lives, through the gateway.
    pub async fn create_workspace_at(&self, project_id: &str, body: Value) -> Result<Value> {
        self.request(
            reqwest::Method::POST,
            &format!("/api/projects/{project_id}/workspaces"),
            Some(body),
        )
        .await
    }
    pub async fn list_machines_raw(&self) -> Result<Vec<Value>> {
        let page: Value = self
            .request(reqwest::Method::GET, "/api/machines", None)
            .await?;
        Ok(page
            .get("machines")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default())
    }
    pub async fn list_machines(&self) -> Result<Vec<MachineView>> {
        self.list_machines_raw()
            .await?
            .into_iter()
            .map(|machine| Ok(serde_json::from_value(machine)?))
            .collect()
    }
    /// Whether the account is connected to GitHub. A gateway without the
    /// route, or without a GitHub App, is one where nothing is connected.
    pub async fn github(&self) -> Result<GithubStatus> {
        match self
            .request(reqwest::Method::GET, "/api/github", None)
            .await
        {
            Ok(status) => Ok(status),
            Err(error) if is_not_found(&error) => Ok(GithubStatus::default()),
            Err(error) => Err(error),
        }
    }
    pub async fn github_repositories(
        &self,
        query: &str,
        limit: usize,
    ) -> Result<Vec<GithubRepositoryView>> {
        let page: GithubRepositories = self
            .request(
                reqwest::Method::GET,
                &format!(
                    "/api/github/repositories?q={}&limit={limit}",
                    url::form_urlencoded::byte_serialize(query.as_bytes()).collect::<String>()
                ),
                None,
            )
            .await?;
        Ok(page.repositories)
    }
    /// A short-lived credential for the repository of a project, for git.
    pub async fn git_credential(
        &self,
        project_id: &str,
        device_id: Option<&str>,
    ) -> Result<GitCredential> {
        let body = device_id.map_or_else(|| json!({}), |id| json!({ "deviceId": id }));
        self.request(
            reqwest::Method::POST,
            &format!("/api/projects/{project_id}/git-credential"),
            Some(body),
        )
        .await
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
    /// Tells the gateway about a checkout on this machine. `device_id` is
    /// the machine reporting it, which is where it is: without it the gateway
    /// would file the checkout under the project's default location.
    pub async fn put_workspace(
        &self,
        project_id: &str,
        workspace: &crate::config::WorkspaceEntry,
        device_id: Option<&str>,
    ) -> Result<WorkspaceView> {
        let mut body = json!({
            "slug": workspace.slug,
            "name": workspace.name,
            "branch": workspace.branch,
            "localPath": workspace.root,
            "managed": workspace.managed,
        });
        if let Some(device_id) = device_id {
            body["deviceId"] = json!(device_id);
        }
        self.request(
            reqwest::Method::PUT,
            &format!("/api/projects/{project_id}/workspaces/{}", workspace.id),
            Some(body),
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
