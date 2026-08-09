mod files;
mod path;
mod processes;

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
        let validator = self
            .validators
            .get(&tool)
            .ok_or_else(|| ExeoraError::new(ErrorCode::UnknownTool, "Unsupported tool."))?;
        if let Err(error) = validator.validate(&arguments) {
            return Err(ExeoraError::new(
                ErrorCode::InvalidArguments,
                error.to_string(),
            ));
        }
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
            ToolName::RunCommand => self.processes.run_command(root, arguments, cancel).await,
            ToolName::StartCommand => self.processes.start_command(root, arguments).await,
            ToolName::GetCommandOutput => self.processes.get_output(root, arguments).await,
            ToolName::SendCommandInput => self.processes.send_input(root, arguments).await,
            ToolName::KillCommand => self.processes.kill_command(root, arguments).await,
        }
    }

    pub async fn kill_all(&self) {
        self.processes.kill_all().await;
    }
}
