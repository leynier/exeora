use serde::Serialize;
use thiserror::Error;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
pub enum ErrorCode {
    #[serde(rename = "LOCAL_EXECUTOR_OFFLINE")]
    LocalExecutorOffline,
    #[serde(rename = "TOOL_TIMEOUT")]
    ToolTimeout,
    #[serde(rename = "CANCELLED")]
    Cancelled,
    #[serde(rename = "PATH_ESCAPE")]
    PathEscape,
    #[serde(rename = "PATH_NOT_FOUND")]
    PathNotFound,
    #[serde(rename = "TOOL_FAILED")]
    ToolFailed,
    #[serde(rename = "INVALID_ARGUMENTS")]
    InvalidArguments,
    #[serde(rename = "UNKNOWN_TOOL")]
    UnknownTool,
    #[serde(rename = "UNKNOWN_PROJECT")]
    UnknownProject,
    #[serde(rename = "UNKNOWN_WORKSPACE")]
    UnknownWorkspace,
    #[serde(rename = "WORKSPACE_UNAVAILABLE")]
    WorkspaceUnavailable,
    #[serde(rename = "UNKNOWN_PROCESS")]
    UnknownProcess,
    #[serde(rename = "NO_ACTIVE_PROJECT")]
    NoActiveProject,
    #[serde(rename = "FORBIDDEN")]
    Forbidden,
    #[serde(rename = "APPROVAL_DECLINED")]
    ApprovalDeclined,
    #[serde(rename = "APPROVAL_TIMEOUT")]
    ApprovalTimeout,
    #[serde(rename = "INTERNAL_ERROR")]
    InternalError,
}

impl ErrorCode {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::LocalExecutorOffline => "LOCAL_EXECUTOR_OFFLINE",
            Self::ToolTimeout => "TOOL_TIMEOUT",
            Self::Cancelled => "CANCELLED",
            Self::PathEscape => "PATH_ESCAPE",
            Self::PathNotFound => "PATH_NOT_FOUND",
            Self::ToolFailed => "TOOL_FAILED",
            Self::InvalidArguments => "INVALID_ARGUMENTS",
            Self::UnknownTool => "UNKNOWN_TOOL",
            Self::UnknownProject => "UNKNOWN_PROJECT",
            Self::UnknownWorkspace => "UNKNOWN_WORKSPACE",
            Self::WorkspaceUnavailable => "WORKSPACE_UNAVAILABLE",
            Self::UnknownProcess => "UNKNOWN_PROCESS",
            Self::NoActiveProject => "NO_ACTIVE_PROJECT",
            Self::Forbidden => "FORBIDDEN",
            Self::ApprovalDeclined => "APPROVAL_DECLINED",
            Self::ApprovalTimeout => "APPROVAL_TIMEOUT",
            Self::InternalError => "INTERNAL_ERROR",
        }
    }
}

#[derive(Debug, Error)]
#[error("{message}")]
pub struct ExeoraError {
    pub code: ErrorCode,
    pub message: String,
}

impl ExeoraError {
    pub fn new(code: ErrorCode, message: impl Into<String>) -> Self {
        Self {
            code,
            message: message.into(),
        }
    }

    pub fn tool(message: impl Into<String>) -> Self {
        Self::new(ErrorCode::ToolFailed, message)
    }
}
