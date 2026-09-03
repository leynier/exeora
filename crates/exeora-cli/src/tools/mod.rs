mod files;
mod patch;
pub(crate) mod path;
mod processes;
mod skills;

pub use processes::ProcessRegistry;

use crate::{
    error::{ErrorCode, ExeoraError},
    protocol::ToolName,
};
use anyhow::{Result, anyhow};
use jsonschema::Validator;
use serde_json::Value;
use std::{collections::HashMap, path::Path, sync::Arc};
use tokio_util::sync::CancellationToken;

pub struct ToolEngine {
    validators: HashMap<ToolName, Validator>,
    processes: Arc<ProcessRegistry>,
}

/// Where a call runs, and who started it, when that is known.
pub struct CallScope<'a> {
    pub project: &'a str,
    pub workspace: &'a str,
    pub owner: Option<&'a str>,
}

impl ToolEngine {
    pub fn new() -> Result<Self> {
        let contract: Value = serde_json::from_str(include_str!("../../protocol/contract.json"))?;
        let tools = contract
            .pointer("/schemas/tools")
            .and_then(Value::as_object)
            .ok_or_else(|| anyhow!("generated tool schemas are missing"))?;
        let mut validators = HashMap::new();
        for tool in ToolName::ALL {
            let schema = tools
                .get(tool.as_str())
                .and_then(|value| value.get("input"))
                .ok_or_else(|| anyhow!("schema missing for {tool}"))?;
            validators.insert(tool, jsonschema::validator_for(schema)?);
        }
        Ok(Self {
            validators,
            processes: Arc::new(ProcessRegistry::new()),
        })
    }

    pub async fn execute(
        &self,
        root: &Path,
        tool: ToolName,
        arguments: Value,
        cancel: CancellationToken,
    ) -> Result<Value, ExeoraError> {
        let project = root.to_string_lossy();
        self.execute_scoped(
            root,
            CallScope {
                project: &project,
                workspace: "main",
                owner: None,
            },
            tool,
            arguments,
            cancel,
        )
        .await
    }

    pub async fn execute_for_project(
        &self,
        root: &Path,
        project_scope: &str,
        tool: ToolName,
        arguments: Value,
        cancel: CancellationToken,
    ) -> Result<Value, ExeoraError> {
        self.execute_scoped(
            root,
            CallScope {
                project: project_scope,
                workspace: "main",
                owner: None,
            },
            tool,
            arguments,
            cancel,
        )
        .await
    }

    pub async fn execute_scoped(
        &self,
        root: &Path,
        scope: CallScope<'_>,
        tool: ToolName,
        arguments: Value,
        cancel: CancellationToken,
    ) -> Result<Value, ExeoraError> {
        self.validate(tool, &arguments)?;
        if cancel.is_cancelled() {
            return Err(ExeoraError::new(
                ErrorCode::Cancelled,
                "The call was cancelled before it started.",
            ));
        }

        match tool {
            ToolName::ReadFile => files::read_file(root, arguments).await,
            ToolName::ListFiles => files::list_files(root, arguments).await,
            ToolName::Grep => files::grep(root, arguments).await,
            ToolName::EditFile => files::edit_file(root, arguments).await,
            ToolName::WriteFile => files::write_file(root, arguments).await,
            ToolName::ApplyPatch => patch::apply_patch(root, arguments).await,
            ToolName::ListGitWorkspaces
            | ToolName::CreateWorkspace
            | ToolName::AttachWorkspace
            | ToolName::DetachWorkspace
            | ToolName::RemoveWorkspace => Err(ExeoraError::new(
                ErrorCode::InternalError,
                "Workspace lifecycle tools require the connected executor context.",
            )),
            ToolName::RunCommand => self.processes.run_command(root, arguments, cancel).await,
            ToolName::StartCommand => {
                self.processes
                    .start_command(root, scope.project, scope.workspace, scope.owner, arguments)
                    .await
            }
            ToolName::GetCommandOutput => {
                self.processes
                    .get_output(root, scope.project, scope.workspace, scope.owner, arguments)
                    .await
            }
            ToolName::SendCommandInput => {
                self.processes
                    .send_input(root, scope.project, scope.workspace, scope.owner, arguments)
                    .await
            }
            ToolName::KillCommand => {
                self.processes
                    .kill_command(root, scope.project, scope.workspace, scope.owner, arguments)
                    .await
            }
            ToolName::ListSkills => skills::list_skills(root, arguments).await,
        }
    }

    pub fn validate(&self, tool: ToolName, arguments: &Value) -> Result<(), ExeoraError> {
        let validator = self
            .validators
            .get(&tool)
            .ok_or_else(|| ExeoraError::new(ErrorCode::UnknownTool, "Unsupported tool."))?;
        if let Err(error) = validator.validate(arguments) {
            return Err(ExeoraError::new(
                ErrorCode::InvalidArguments,
                error.to_string(),
            ));
        }
        Ok(())
    }

    pub async fn kill_all(&self) {
        self.processes.kill_all().await;
    }

    pub async fn kill_root(&self, root: &Path) {
        self.processes.kill_root(root).await;
    }
}
