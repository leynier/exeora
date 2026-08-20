mod git;
mod terminal;

use crate::error::ExeoraError;
use serde_json::Value;
use std::{path::Path, sync::Arc};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

pub struct WorkspaceEngine {
    git: git::GitWorkspace,
    terminals: terminal::TerminalRegistry,
}

impl WorkspaceEngine {
    pub fn new() -> Self {
        Self {
            git: git::GitWorkspace::new(),
            terminals: terminal::TerminalRegistry::new(),
        }
    }

    pub async fn execute(
        &self,
        root: &Path,
        action: Value,
        cancel: CancellationToken,
    ) -> Result<Value, ExeoraError> {
        self.git.execute(root, action, cancel).await
    }

    pub async fn terminal_open(
        &self,
        session_id: String,
        root: &Path,
        cols: u16,
        rows: u16,
        outgoing: mpsc::Sender<Value>,
    ) -> Result<(), ExeoraError> {
        self.terminals
            .open(session_id, root, cols, rows, outgoing)
            .await
    }

    pub async fn terminal_input(&self, session_id: &str, data: &[u8]) -> Result<(), ExeoraError> {
        self.terminals.input(session_id, data).await
    }

    pub async fn terminal_resize(
        &self,
        session_id: &str,
        cols: u16,
        rows: u16,
    ) -> Result<(), ExeoraError> {
        self.terminals.resize(session_id, cols, rows).await
    }

    pub async fn terminal_close(&self, session_id: &str) {
        self.terminals.close(session_id).await;
    }

    pub async fn kill_all(&self) {
        self.terminals.kill_all().await;
    }

    pub async fn kill_root(&self, root: &Path) {
        self.terminals.kill_root(root).await;
    }
}

impl Default for WorkspaceEngine {
    fn default() -> Self {
        Self::new()
    }
}

pub type SharedWorkspaceEngine = Arc<WorkspaceEngine>;
