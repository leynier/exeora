use crate::error::{ErrorCode, ExeoraError};
use base64::{Engine as _, engine::general_purpose::STANDARD};
use portable_pty::{ChildKiller, CommandBuilder, MasterPty, PtySize, native_pty_system};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, Mutex as StdMutex},
};
use tokio::sync::{Mutex, mpsc};

const OUTPUT_CHUNK_BYTES: usize = 16 * 1024;

struct TerminalSession {
    id: Arc<StdMutex<String>>,
    root: PathBuf,
    master: StdMutex<Box<dyn MasterPty + Send>>,
    writer: StdMutex<Box<dyn Write + Send>>,
    killer: StdMutex<Box<dyn ChildKiller + Send + Sync>>,
}

#[derive(Clone)]
pub struct TerminalRegistry {
    sessions: Arc<Mutex<HashMap<String, Arc<TerminalSession>>>>,
    opening: Arc<Mutex<()>>,
}

impl TerminalRegistry {
    pub fn new() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            opening: Arc::new(Mutex::new(())),
        }
    }

    pub async fn open(
        &self,
        session_id: String,
        root: &Path,
        cols: u16,
        rows: u16,
        outgoing: mpsc::Sender<Value>,
    ) -> Result<(), ExeoraError> {
        let _opening = self.opening.lock().await;
        validate_size(cols, rows)?;
        let root = std::fs::canonicalize(root).map_err(|_| {
            ExeoraError::new(ErrorCode::PathNotFound, "Project root was not found.")
        })?;
        if self
            .attach(&session_id, &root, cols, rows, outgoing.clone())
            .await?
        {
            return Ok(());
        }

        let open_root = root.clone();
        let opened = tokio::task::spawn_blocking(move || {
            let pair = native_pty_system()
                .openpty(PtySize {
                    rows,
                    cols,
                    pixel_width: 0,
                    pixel_height: 0,
                })
                .map_err(|error| ExeoraError::tool(format!("Could not open a PTY: {error}")))?;
            let mut command = CommandBuilder::new_default_prog();
            command.cwd(&open_root);
            command.env("TERM", "xterm-256color");
            command.env("COLORTERM", "truecolor");
            let child = pair.slave.spawn_command(command).map_err(|error| {
                ExeoraError::tool(format!("Could not start the shell: {error}"))
            })?;
            drop(pair.slave);
            let reader = pair.master.try_clone_reader().map_err(|error| {
                ExeoraError::tool(format!("Could not read from the PTY: {error}"))
            })?;
            let writer = pair.master.take_writer().map_err(|error| {
                ExeoraError::tool(format!("Could not write to the PTY: {error}"))
            })?;
            let killer = child.clone_killer();
            Ok::<_, ExeoraError>((pair.master, reader, writer, killer, child))
        })
        .await
        .map_err(|error| ExeoraError::tool(format!("PTY startup failed: {error}")))??;

        let (master, mut reader, writer, killer, mut child) = opened;
        let session_key = Arc::new(StdMutex::new(session_id.clone()));
        let wait_id = session_key.clone();
        let session = Arc::new(TerminalSession {
            id: session_key.clone(),
            root,
            master: StdMutex::new(master),
            writer: StdMutex::new(writer),
            killer: StdMutex::new(killer),
        });
        self.sessions
            .lock()
            .await
            .insert(session_id.clone(), session);

        if outgoing
            .send(json!({ "type": "terminal.opened", "sessionId": session_id }))
            .await
            .is_err()
        {
            self.close(&session_id).await;
            return Err(ExeoraError::tool(
                "Relay connection closed while opening the terminal.",
            ));
        }

        let read_outgoing = outgoing.clone();
        tokio::task::spawn_blocking(move || {
            let mut buffer = vec![0_u8; OUTPUT_CHUNK_BYTES];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(count) => {
                        let id = session_key.lock().map(|id| id.clone()).unwrap_or_default();
                        if read_outgoing
                            .blocking_send(json!({
                                "type": "terminal.output",
                                "sessionId": id,
                                "data": STANDARD.encode(&buffer[..count]),
                            }))
                            .is_err()
                        {
                            break;
                        }
                    }
                }
            }
        });

        let wait_outgoing = outgoing;
        let sessions = self.sessions.clone();
        tokio::task::spawn_blocking(move || {
            let exit_code = child.wait().ok().map(|status| status.exit_code());
            let session_id = wait_id.lock().map(|id| id.clone()).unwrap_or_default();
            let _ = wait_outgoing.blocking_send(json!({
                "type": "terminal.exit",
                "sessionId": session_id,
                "exitCode": exit_code,
            }));
            tokio::runtime::Handle::current().spawn(async move {
                sessions.lock().await.remove(&session_id);
            });
        });
        Ok(())
    }

    async fn attach(
        &self,
        session_id: &str,
        root: &Path,
        cols: u16,
        rows: u16,
        outgoing: mpsc::Sender<Value>,
    ) -> Result<bool, ExeoraError> {
        let mut sessions = self.sessions.lock().await;
        let existing_id = sessions
            .iter()
            .find(|(_, session)| session.root == root)
            .map(|(id, _)| id.clone());
        let Some(existing_id) = existing_id else {
            if sessions.contains_key(session_id) {
                return Err(invalid("That terminal session is already open."));
            }
            return Ok(false);
        };
        let session = sessions
            .remove(&existing_id)
            .expect("the matched terminal session exists");
        if existing_id != session_id {
            if let Ok(mut id) = session.id.lock() {
                *id = session_id.to_owned();
            }
        }
        sessions.insert(session_id.to_owned(), session);
        drop(sessions);
        let _ = self.resize(session_id, cols, rows).await;
        let _ = outgoing
            .send(json!({ "type": "terminal.opened", "sessionId": session_id }))
            .await;
        Ok(true)
    }

    pub async fn input(&self, session_id: &str, data: &[u8]) -> Result<(), ExeoraError> {
        if data.len() > 96_000 {
            return Err(invalid("Terminal input is too large."));
        }
        let session = self.session(session_id).await?;
        let mut writer = session
            .writer
            .lock()
            .map_err(|_| ExeoraError::tool("Terminal writer is unavailable."))?;
        writer
            .write_all(data)
            .and_then(|_| writer.flush())
            .map_err(|error| ExeoraError::tool(format!("Could not write to the terminal: {error}")))
    }

    pub async fn resize(&self, session_id: &str, cols: u16, rows: u16) -> Result<(), ExeoraError> {
        validate_size(cols, rows)?;
        let session = self.session(session_id).await?;
        session
            .master
            .lock()
            .map_err(|_| ExeoraError::tool("Terminal PTY is unavailable."))?
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| ExeoraError::tool(format!("Could not resize the terminal: {error}")))
    }

    pub async fn close(&self, session_id: &str) {
        let session = self.sessions.lock().await.remove(session_id);
        if let Some(session) = session
            && let Ok(mut killer) = session.killer.lock()
        {
            let _ = killer.kill();
        }
    }

    pub async fn kill_all(&self) {
        let sessions = {
            let mut sessions = self.sessions.lock().await;
            sessions
                .drain()
                .map(|(_, session)| session)
                .collect::<Vec<_>>()
        };
        for session in sessions {
            if let Ok(mut killer) = session.killer.lock() {
                let _ = killer.kill();
            }
        }
    }

    pub async fn kill_root(&self, root: &Path) {
        let canonical = std::fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
        let sessions = {
            let mut sessions = self.sessions.lock().await;
            let ids = sessions
                .iter()
                .filter(|(_, session)| session.root == canonical)
                .map(|(id, _)| id.clone())
                .collect::<Vec<_>>();
            ids.into_iter()
                .filter_map(|id| sessions.remove(&id))
                .collect::<Vec<_>>()
        };
        for session in sessions {
            if let Ok(mut killer) = session.killer.lock() {
                let _ = killer.kill();
            }
        }
    }

    async fn session(&self, session_id: &str) -> Result<Arc<TerminalSession>, ExeoraError> {
        self.sessions
            .lock()
            .await
            .get(session_id)
            .cloned()
            .ok_or_else(|| invalid("Terminal session was not found."))
    }
}

fn validate_size(cols: u16, rows: u16) -> Result<(), ExeoraError> {
    if !(20..=500).contains(&cols) || !(5..=300).contains(&rows) {
        return Err(invalid("Terminal size is outside the supported range."));
    }
    Ok(())
}

fn invalid(message: impl Into<String>) -> ExeoraError {
    ExeoraError::new(ErrorCode::InvalidArguments, message)
}

#[cfg(test)]
mod tests {
    use super::TerminalRegistry;
    use base64::{Engine as _, engine::general_purpose::STANDARD};
    use tempfile::tempdir;
    use tokio::sync::mpsc;

    #[tokio::test]
    async fn opens_an_interactive_pty_at_the_project_root() {
        let directory = tempdir().unwrap();
        let registry = TerminalRegistry::new();
        let (outgoing, mut incoming) = mpsc::channel(32);
        registry
            .open(
                "session_test".to_owned(),
                directory.path(),
                80,
                24,
                outgoing,
            )
            .await
            .unwrap();
        assert_eq!(incoming.recv().await.unwrap()["type"], "terminal.opened");

        registry
            .input("session_test", b"printf 'EXEORA_PTY_OK\\n'; exit\n")
            .await
            .unwrap();
        let mut output = Vec::new();
        tokio::time::timeout(std::time::Duration::from_secs(5), async {
            while let Some(message) = incoming.recv().await {
                if message["type"] == "terminal.output" {
                    let chunk = message["data"].as_str().unwrap();
                    output.extend(STANDARD.decode(chunk).unwrap());
                }
                if message["type"] == "terminal.exit" {
                    break;
                }
            }
        })
        .await
        .unwrap();

        assert!(String::from_utf8_lossy(&output).contains("EXEORA_PTY_OK"));
        registry.kill_all().await;
    }

    #[tokio::test]
    async fn kills_only_sessions_attached_to_a_removed_root() {
        let first = tempdir().unwrap();
        let second = tempdir().unwrap();
        let registry = TerminalRegistry::new();
        let (outgoing, mut incoming) = mpsc::channel(32);
        registry
            .open("first".to_owned(), first.path(), 80, 24, outgoing.clone())
            .await
            .unwrap();
        registry
            .open("second".to_owned(), second.path(), 80, 24, outgoing)
            .await
            .unwrap();
        assert_eq!(incoming.recv().await.unwrap()["type"], "terminal.opened");
        assert_eq!(incoming.recv().await.unwrap()["type"], "terminal.opened");

        registry.kill_root(first.path()).await;
        assert!(registry.input("first", b"pwd\n").await.is_err());
        assert!(registry.input("second", b"printf ok\n").await.is_ok());
        registry.kill_all().await;
    }

    #[tokio::test]
    async fn attaches_a_second_open_for_the_same_root() {
        let directory = tempdir().unwrap();
        let registry = TerminalRegistry::new();
        let (outgoing, mut incoming) = mpsc::channel(32);
        registry
            .open(
                "first".to_owned(),
                directory.path(),
                80,
                24,
                outgoing.clone(),
            )
            .await
            .unwrap();
        registry
            .open("second".to_owned(), directory.path(), 100, 30, outgoing)
            .await
            .unwrap();
        assert_eq!(incoming.recv().await.unwrap()["type"], "terminal.opened");
        assert_eq!(incoming.recv().await.unwrap()["type"], "terminal.opened");
        assert!(registry.input("first", b"pwd\n").await.is_err());
        assert!(registry.input("second", b"printf ok\n").await.is_ok());
        registry.kill_all().await;
    }
}
