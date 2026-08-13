use crate::error::{ErrorCode, ExeoraError};
use serde::{Deserialize, Serialize, Serializer};
use serde_json::Value;
use std::{fmt, str::FromStr};

pub const PROTOCOL_VERSION: u32 = 1;
pub const HEARTBEAT_REQUEST: &str = r#"{"type":"heartbeat"}"#;
pub const HEARTBEAT_INTERVAL_MS: u64 = 30_000;
pub const HEARTBEAT_TIMEOUT_MS: u64 = 90_000;
pub const PRESENCE_SIGNAL_INTERVAL_MS: u64 = 5 * 60_000;
pub const MAX_RESULT_BYTES: usize = 1_000_000;
pub const MAX_READ_BYTES: usize = 500_000;
pub const MAX_LIST_ENTRIES: usize = 1_000;
pub const MAX_GREP_MATCHES: usize = 200;
pub const MAX_COMMAND_OUTPUT_BYTES: usize = 200_000;
pub const DEFAULT_COMMAND_TIMEOUT_MS: u64 = 60_000;
pub const MAX_COMMAND_TIMEOUT_MS: u64 = 300_000;
pub const MAX_PROCESS_BUFFER_BYTES: usize = 256_000;
pub const MAX_PROCESS_CHUNK_BYTES: usize = 100_000;
pub const MAX_PROCESSES_PER_PROJECT: usize = 8;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ToolName {
    ReadFile,
    ListFiles,
    Grep,
    EditFile,
    WriteFile,
    RunCommand,
    StartCommand,
    GetCommandOutput,
    SendCommandInput,
    KillCommand,
}

impl ToolName {
    pub const ALL: [Self; 10] = [
        Self::ReadFile,
        Self::ListFiles,
        Self::Grep,
        Self::EditFile,
        Self::WriteFile,
        Self::RunCommand,
        Self::StartCommand,
        Self::GetCommandOutput,
        Self::SendCommandInput,
        Self::KillCommand,
    ];

    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ReadFile => "read_file",
            Self::ListFiles => "list_files",
            Self::Grep => "grep",
            Self::EditFile => "edit_file",
            Self::WriteFile => "write_file",
            Self::RunCommand => "run_command",
            Self::StartCommand => "start_command",
            Self::GetCommandOutput => "get_command_output",
            Self::SendCommandInput => "send_command_input",
            Self::KillCommand => "kill_command",
        }
    }

    pub const fn read_only(self) -> bool {
        matches!(
            self,
            Self::ReadFile | Self::ListFiles | Self::Grep | Self::GetCommandOutput
        )
    }
}

impl fmt::Display for ToolName {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl FromStr for ToolName {
    type Err = ExeoraError;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        Self::ALL
            .into_iter()
            .find(|tool| tool.as_str() == value)
            .ok_or_else(|| {
                ExeoraError::new(ErrorCode::UnknownTool, format!("Unknown tool: {value}"))
            })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectHello {
    pub id: String,
    pub slug: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExecutorCapabilities {
    pub prompt: bool,
    pub tools: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type")]
pub enum ExecutorMessage {
    #[serde(rename = "hello")]
    Hello {
        #[serde(rename = "protocolVersion")]
        protocol_version: u32,
        #[serde(rename = "deviceId")]
        device_id: String,
        #[serde(rename = "cliVersion")]
        cli_version: String,
        platform: String,
        projects: Vec<ProjectHello>,
        capabilities: ExecutorCapabilities,
    },
    #[serde(rename = "heartbeat")]
    Heartbeat { at: u64 },
    #[serde(rename = "presence")]
    Presence { at: u64 },
    #[serde(rename = "tool.result")]
    ToolResult {
        #[serde(rename = "requestId")]
        request_id: String,
        #[serde(rename = "durationMs")]
        duration_ms: u64,
        result: ToolResult,
    },
    #[serde(rename = "approval.answer")]
    ApprovalAnswer { id: String, approved: bool },
}

#[derive(Debug, Clone)]
pub enum ToolResult {
    Ok { value: Value },
    Err { error: WireError },
}

impl Serialize for ToolResult {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Ok { value } => {
                serde_json::json!({ "ok": true, "value": value }).serialize(serializer)
            }
            Self::Err { error } => {
                serde_json::json!({ "ok": false, "error": error }).serialize(serializer)
            }
        }
    }
}

impl ToolResult {
    pub fn ok(value: Value) -> Self {
        Self::Ok { value }
    }
    pub fn err(error: WireError) -> Self {
        Self::Err { error }
    }
    pub fn is_ok(&self) -> bool {
        matches!(self, Self::Ok { .. })
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct WireError {
    pub code: &'static str,
    pub message: String,
}

impl From<ExeoraError> for WireError {
    fn from(error: ExeoraError) -> Self {
        Self {
            code: error.code.as_str(),
            message: error.message,
        }
    }
}

impl WireError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code: code.as_str(),
            message: message.into(),
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientInfo {
    pub name: Option<String>,
    pub version: Option<String>,
}

impl ClientInfo {
    pub fn describe(&self) -> Option<String> {
        match (&self.name, &self.version) {
            (Some(name), Some(version)) => Some(format!("{name} {version}")),
            (Some(name), None) => Some(name.clone()),
            (None, Some(version)) => Some(version.clone()),
            (None, None) => None,
        }
    }
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
