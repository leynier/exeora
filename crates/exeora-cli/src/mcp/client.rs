//! The MCP client: JSON-RPC 2.0 over stdio, spoken to one downstream server.
//!
//! Hand-rolled on purpose. The surface Exeora needs is three calls —
//! `initialize`, `tools/list`, `tools/call` — plus the discipline around them:
//! route responses by id, ignore notifications, and answer a server's requests
//! with "method not found" rather than silence, because a server blocked on a
//! sampling request it will never get is a hang that looks like nobody's fault.
//!
//! The 2026-07-28 revision made the protocol stateless and retired the
//! handshake, but a stdio server is a process on the user's machine, and nearly
//! every one in the wild speaks a 2025 revision and expects `initialize`. The
//! client therefore offers the oldest widely supported version, then adopts
//! whatever the server answers with, which is the negotiation the handshake has
//! always specified.

use crate::CLI_VERSION;
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    sync::{
        Arc,
        atomic::{AtomicU64, Ordering},
    },
    time::Duration,
};
use tokio::{
    io::{AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader},
    sync::{Mutex, oneshot},
    time::timeout,
};
use tokio_util::sync::CancellationToken;

use super::OFFERED_PROTOCOL_VERSION;

/** Largest stdio frame accepted from a downstream server. */
const MAX_LINE_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug)]
pub enum McpError {
    Transport(String),
    Protocol(String),
    Timeout,
    Cancelled,
}

impl std::fmt::Display for McpError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Transport(reason) => write!(f, "the MCP server connection failed: {reason}"),
            Self::Protocol(reason) => write!(f, "the MCP server refused the call: {reason}"),
            Self::Timeout => write!(f, "the MCP server did not answer in time"),
            Self::Cancelled => write!(f, "the call was cancelled"),
        }
    }
}

/** One downstream tool, as `tools/list` described it. */
#[derive(Debug, Clone)]
pub struct McpTool {
    pub name: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub input_schema: Value,
    pub annotations: Option<Value>,
}

struct Shared {
    writer: Mutex<Box<dyn AsyncWrite + Send + Unpin>>,
    pending: Mutex<HashMap<u64, oneshot::Sender<Answer>>>,
}

/** What came back for one request, or the fact that nothing ever will. */
enum Answer {
    Result(Value),
    Error(Value),
    Closed,
}

pub struct McpClient {
    next_id: AtomicU64,
    shared: Arc<Shared>,
    protocol_version: String,
}

impl McpClient {
    /**
     * Over any reader/writer pair, which is what makes the client testable
     * against a scripted peer: the relay's own tests fake the executor, and
     * here a duplex stream fakes the server without spawning a process.
     */
    pub fn new(
        reader: Box<dyn AsyncRead + Send + Unpin>,
        writer: Box<dyn AsyncWrite + Send + Unpin>,
    ) -> Self {
        let shared = Arc::new(Shared {
            writer: Mutex::new(writer),
            pending: Mutex::new(HashMap::new()),
        });
        let reader_shared = shared.clone();
        tokio::spawn(async move {
            read_loop(reader, reader_shared).await;
        });
        Self {
            next_id: AtomicU64::new(1),
            shared,
            protocol_version: OFFERED_PROTOCOL_VERSION.to_owned(),
        }
    }

    /** The revision the handshake settled on, which is what to speak from here. */
    pub fn protocol_version(&self) -> &str {
        &self.protocol_version
    }

    pub async fn initialize(&mut self, budget: Duration) -> Result<Value, McpError> {
        let result = self
            .request(
                "initialize",
                json!({
                    "protocolVersion": OFFERED_PROTOCOL_VERSION,
                    "capabilities": {},
                    "clientInfo": { "name": "exeora", "version": CLI_VERSION },
                }),
                budget,
            )
            .await?;
        // The server's answer is the version to speak from here on; whatever it
        // said, it is a server that answered an `initialize`, so it is a server
        // that still runs the handshake.
        if let Some(version) = result.get("protocolVersion").and_then(Value::as_str) {
            self.protocol_version = version.to_owned();
        }
        self.notify("notifications/initialized", json!({})).await?;
        Ok(result)
    }

    /**
     * Every tool the server offers, following the pagination cursor until it
     * ends, with the count of entries skipped for names or schemas no client
     * could republish.
     */
    pub async fn list_tools(
        &mut self,
        budget: Duration,
        max_tools: usize,
    ) -> Result<(Vec<McpTool>, usize), McpError> {
        let mut tools = Vec::new();
        let mut skipped = 0;
        let mut cursor: Option<String> = None;
        loop {
            let params = match &cursor {
                Some(cursor) => json!({ "cursor": cursor }),
                None => json!({}),
            };
            let result = self.request("tools/list", params, budget).await?;
            for entry in result
                .get("tools")
                .and_then(Value::as_array)
                .map(std::borrow::ToOwned::to_owned)
                .unwrap_or_default()
            {
                match parse_tool(&entry) {
                    Some(tool) => {
                        if tools.len() < max_tools {
                            tools.push(tool);
                        } else {
                            skipped += 1;
                        }
                    }
                    None => skipped += 1,
                }
            }
            cursor = result
                .get("nextCursor")
                .and_then(Value::as_str)
                .map(str::to_owned);
            if cursor.is_none() {
                return Ok((tools, skipped));
            }
        }
    }

    /**
     * Runs one tool. A result with `isError: true` is a result, not an error
     * here: MCP gives the model the server's own words about what went wrong,
     * and the caller can still read them.
     */
    pub async fn call_tool(
        &mut self,
        name: &str,
        arguments: Value,
        budget: Duration,
        cancel: CancellationToken,
    ) -> Result<Value, McpError> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let frame = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": "tools/call",
            "params": { "name": name, "arguments": arguments },
        });
        self.roundtrip(id, &frame, budget, Some(cancel)).await
    }

    async fn request(
        &mut self,
        method: &str,
        params: Value,
        budget: Duration,
    ) -> Result<Value, McpError> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let frame = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });
        self.roundtrip(id, &frame, budget, None).await
    }

    /**
     * Sends one frame and waits for its answer, giving up on the budget or the
     * cancellation, whichever comes first.
     *
     * The pending entry is removed on every path that leaves without an
     * answer, so a late response finds nothing to wake and is dropped by the
     * reader rather than leaking a channel.
     */
    async fn roundtrip(
        &mut self,
        id: u64,
        frame: &Value,
        budget: Duration,
        cancel: Option<CancellationToken>,
    ) -> Result<Value, McpError> {
        let (tx, rx) = oneshot::channel();
        self.shared.pending.lock().await.insert(id, tx);
        if let Err(error) = self.write(frame).await {
            self.shared.pending.lock().await.remove(&id);
            return Err(error);
        }
        let answer = if let Some(cancel) = cancel.as_ref() {
            tokio::select! {
                _ = cancel.cancelled() => {
                    self.shared.pending.lock().await.remove(&id);
                    // The spec's way to say stop; the server may ignore it, but
                    // a server that honours it stops work nobody will read.
                    let _ = self.notify("notifications/cancelled", json!({ "requestId": id })).await;
                    return Err(McpError::Cancelled);
                }
                answer = timeout(budget, rx) => answer,
            }
        } else {
            timeout(budget, rx).await
        };
        let answer = match answer {
            Ok(Ok(answer)) => answer,
            // The sender is dropped only when the reader task ended, which is
            // the connection closing under the request.
            Ok(Err(_)) => {
                self.shared.pending.lock().await.remove(&id);
                return Err(McpError::Transport("the connection closed".into()));
            }
            Err(_) => {
                self.shared.pending.lock().await.remove(&id);
                return Err(McpError::Timeout);
            }
        };
        self.shared.pending.lock().await.remove(&id);
        match answer {
            Answer::Error(error) => Err(McpError::Protocol(
                error
                    .get("message")
                    .and_then(Value::as_str)
                    .map_or_else(
                        || format!("error {}", error.get("code").and_then(Value::as_i64).unwrap_or(0)),
                        str::to_owned,
                    ),
            )),
            Answer::Closed => Err(McpError::Transport("the connection closed".into())),
            Answer::Result(result) => Ok(result),
        }
    }

    async fn notify(&mut self, method: &str, params: Value) -> Result<(), McpError> {
        self.write(&json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params,
        }))
        .await
    }

    async fn write(&mut self, frame: &Value) -> Result<(), McpError> {
        let mut writer = self.shared.writer.lock().await;
        let mut line = serde_json::to_vec(frame).map_err(|error| McpError::Transport(error.to_string()))?;
        line.push(b'\n');
        writer
            .write_all(&line)
            .await
            .map_err(|error| McpError::Transport(error.to_string()))?;
        writer
            .flush()
            .await
            .map_err(|error| McpError::Transport(error.to_string()))
    }
}

async fn read_loop(
    reader: Box<dyn AsyncRead + Send + Unpin>,
    shared: Arc<Shared>,
) {
    let mut reader = BufReader::new(reader);
    loop {
        let line = match read_bounded_line(&mut reader).await {
            Ok(Some(line)) => line,
            Ok(None) => break,
            Err(_) => break,
        };
        let Ok(message) = serde_json::from_str::<Value>(&line) else {
            continue;
        };
        let id = message.get("id").cloned();
        let is_request = message.get("method").is_some();
        match id {
            // A response to something we asked. An unknown id is a late answer
            // to a request that already timed out; dropping it is the whole
            // timeout behaviour.
            Some(id) if !is_request => {
                if let Ok(id) = serde_json::from_value::<u64>(id) {
                    let answer = if message.get("error").is_some() {
                        Answer::Error(message.get("error").cloned().unwrap_or_else(|| json!({})))
                    } else {
                        Answer::Result(message.get("result").cloned().unwrap_or_else(|| json!({})))
                    };
                    if let Some(sender) = shared.pending.lock().await.remove(&id) {
                        let _ = sender.send(answer);
                    }
                }
            }
            // A request from the server: sampling, roots, elicitation. This is
            // a client and implements none of them, and saying so beats silence.
            Some(id) => {
                let reply = json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "error": { "code": -32601, "message": "exeora is an MCP client and does not implement server requests" },
                });
                let mut line = serde_json::to_vec(&reply).unwrap_or_default();
                line.push(b'\n');
                let mut writer = shared.writer.lock().await;
                let _ = writer.write_all(&line).await;
                let _ = writer.flush().await;
            }
            // A notification: progress ticks, logging, tool lists changing.
            // Nothing here acts on one, and ignoring it is what a client that
            // re-lists on reconnect is allowed to do.
            None => {}
        }
    }
    // The pipe is closed. Wake every pending request so each fails as a
    // transport error rather than waiting out its budget.
    let pending = std::mem::take(&mut *shared.pending.lock().await);
    for (_id, sender) in pending {
        let _ = sender.send(Answer::Closed);
    }
}

/**
 * One line, refusing to buffer past a bound.
 *
 * `read_line` into a String has no ceiling, and a wedged or hostile server
 * writing one endless line is then a memory leak in the CLI. A real frame is
 * at most a tool result, which the protocol already caps below this.
 */
async fn read_bounded_line(
    reader: &mut BufReader<Box<dyn AsyncRead + Send + Unpin>>,
) -> std::io::Result<Option<String>> {
    let mut bytes = Vec::with_capacity(1024);
    let mut byte = [0u8; 1];
    loop {
        let read = reader.read(&mut byte).await?;
        if read == 0 {
            return if bytes.is_empty() {
                Ok(None)
            } else {
                Ok(Some(String::from_utf8_lossy(&bytes).into_owned()))
            };
        }
        if byte[0] == b'\n' {
            bytes.pop_if(|last| *last == b'\r');
            return Ok(Some(String::from_utf8_lossy(&bytes).into_owned()));
        }
        bytes.push(byte[0]);
        if bytes.len() > MAX_LINE_BYTES {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "a single MCP frame exceeded the size limit",
            ));
        }
    }
}

/**
 * One `tools/list` entry, or None when it could not be republished: a name
 * outside `^[a-zA-Z0-9_-]{1,64}$` cannot survive in a tool name, and a missing
 * or non-object schema leaves a caller nothing to send.
 */
fn parse_tool(entry: &Value) -> Option<McpTool> {
    let name = entry.get("name")?.as_str()?;
    if name.is_empty() || name.len() > 64 || !name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-') {
        return None;
    }
    let input_schema = entry.get("inputSchema")?;
    if !input_schema.is_object() {
        return None;
    }
    Some(McpTool {
        name: name.to_owned(),
        title: entry
            .get("title")
            .and_then(Value::as_str)
            .map(str::to_owned),
        description: entry
            .get("description")
            .and_then(Value::as_str)
            .map(str::to_owned),
        input_schema: input_schema.clone(),
        annotations: entry.get("annotations").cloned(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncBufReadExt as _, duplex, split};

    /**
     * A scripted downstream server on the other end of a duplex pipe, ending
     * the conversation at `stop_after` rather than at EOF.
     *
     * The reason is structural: the client's reader task holds the client's
     * write half for as long as it reads, so EOF on this side would only ever
     * arrive after the client is dropped — which a test that awaits this task
     * first would wait for forever.
     */
    async fn fake_server(
        server_end: tokio::io::DuplexStream,
        script: Vec<(String, String)>,
        stop_after: &str,
    ) -> Vec<Value> {
        let (reader, mut writer) = split(server_end);
        let mut reader = BufReader::new(reader);
        let mut seen = Vec::new();
        let mut line = String::new();
        loop {
            line.clear();
            let read = reader.read_line(&mut line).await.unwrap_or(0);
            if read == 0 {
                break;
            }
            let message: Value = serde_json::from_str(line.trim()).unwrap();
            seen.push(message.clone());
            let method = message.get("method").and_then(Value::as_str).unwrap_or("");
            // A notification has no id to answer and never earns one.
            if let Some(id) = message.get("id").cloned() {
                // The tuple is (method, response): the second element is the
                // JSON this server answers with.
                let scripted = script.iter().find(|(matches, _)| matches == method).cloned();
                let reply = if let Some((_, result)) = scripted {
                    Some(json!({
                        "jsonrpc": "2.0", "id": id,
                        "result": serde_json::from_str::<Value>(&result).unwrap()
                    }))
                } else if method == "initialize" {
                    // Answered even when not scripted, because every client
                    // here starts with a handshake and repeating one default
                    // response per test is noise.
                    Some(json!({
                        "jsonrpc": "2.0", "id": id,
                        "result": { "protocolVersion": "2025-06-18", "serverInfo": { "name": "fake", "version": "1" } }
                    }))
                } else {
                    None
                };
                if let Some(reply) = reply {
                    writer.write_all(format!("{}\n", reply).as_bytes()).await.unwrap();
                }
            }
            if method == stop_after {
                break;
            }
        }
        seen
    }

    fn tool_entry(name: &str) -> Value {
        json!({
            "name": name,
            "description": "A tool.",
            "inputSchema": { "type": "object", "properties": {} },
        })
    }

    #[tokio::test]
    async fn handshakes_and_adopts_the_servers_protocol_version() {
        let (server_end, client_end) = duplex(64 * 1024);
        let server = tokio::spawn(fake_server(
            server_end,
            vec![(
                "initialize".into(),
                r#"{ "protocolVersion": "2025-11-25", "serverInfo": { "name": "fake", "version": "1" } }"#.into(),
            )],
            "notifications/initialized",
        ));
        let (reader, writer) = split(client_end);
        let mut client = McpClient::new(Box::new(reader), Box::new(writer));
        client.initialize(Duration::from_secs(5)).await.unwrap();
        assert_eq!(client.protocol_version(), "2025-11-25");
        let seen = server.await.unwrap();
        assert_eq!(seen[0].get("method").and_then(Value::as_str), Some("initialize"));
        assert_eq!(seen[1].get("method").and_then(Value::as_str), Some("notifications/initialized"));
    }

    #[tokio::test]
    async fn lists_tools_across_pages_and_skips_unpublishable_ones() {
        let (server_end, client_end) = duplex(64 * 1024);
        let server = tokio::spawn(async move {
            let (reader, mut writer) = split(server_end);
            let mut reader = BufReader::new(reader);
            let mut line = String::new();
            let mut pages = 0;
            while reader.read_line(&mut line).await.unwrap_or(0) > 0 {
                let message: Value = serde_json::from_str(line.trim()).unwrap();
                line.clear();
                let method = message.get("method").and_then(Value::as_str);
                if method == Some("initialize") {
                    let reply = json!({
                        "jsonrpc": "2.0",
                        "id": message.get("id").cloned(),
                        "result": { "protocolVersion": "2025-06-18", "serverInfo": { "name": "fake", "version": "1" } },
                    });
                    writer
                        .write_all(format!("{}\n", reply).as_bytes())
                        .await
                        .unwrap();
                    continue;
                }
                if method != Some("tools/list") {
                    continue;
                }
                let cursor = message.pointer("/params/cursor").and_then(Value::as_str);
                let (tools, next) = if cursor.is_none() {
                    (
                        vec![tool_entry("first"), json!({ "name": "not a name", "inputSchema": {} }), tool_entry("second")],
                        Some("page-2"),
                    )
                } else {
                    (vec![tool_entry("third")], None)
                };
                let reply = json!({
                    "jsonrpc": "2.0",
                    "id": message.get("id").cloned(),
                    "result": { "tools": tools, "nextCursor": next },
                });
                writer
                    .write_all(format!("{}\n", reply).as_bytes())
                    .await
                    .unwrap();
                pages += 1;
                // The second page is the end of the conversation; waiting for
                // EOF instead would hang, for the reason `fake_server` explains.
                if cursor.is_some() {
                    break;
                }
            }
            pages
        });
        let (reader, writer) = split(client_end);
        let mut client = McpClient::new(Box::new(reader), Box::new(writer));
        client.initialize(Duration::from_secs(5)).await.unwrap();
        let (tools, skipped) = client.list_tools(Duration::from_secs(5), 64).await.unwrap();
        assert_eq!(server.await.unwrap(), 2);
        assert_eq!(
            tools.iter().map(|tool| tool.name.as_str()).collect::<Vec<_>>(),
            vec!["first", "second", "third"]
        );
        assert_eq!(skipped, 1);
    }

    #[tokio::test]
    async fn runs_a_tool_and_passes_its_result_through() {
        let (server_end, client_end) = duplex(64 * 1024);
        let server = tokio::spawn(fake_server(
            server_end,
            vec![(
                "tools/call".into(),
                r#"{ "content": [ { "type": "text", "text": "42" } ] }"#.into(),
            )],
            "tools/call",
        ));
        let (reader, writer) = split(client_end);
        let mut client = McpClient::new(Box::new(reader), Box::new(writer));
        client.initialize(Duration::from_secs(5)).await.unwrap();
        let result = client
            .call_tool(
                "compute",
                json!({ "n": 41 }),
                Duration::from_secs(5),
                CancellationToken::new(),
            )
            .await
            .unwrap();
        assert_eq!(
            result.pointer("/content/0/text").and_then(Value::as_str),
            Some("42")
        );
        let seen = server.await.unwrap();
        let call = seen
            .iter()
            .find(|message| message.get("method").and_then(Value::as_str) == Some("tools/call"))
            .unwrap();
        assert_eq!(call.pointer("/params/name").and_then(Value::as_str), Some("compute"));
        assert_eq!(call.pointer("/params/arguments/n").and_then(Value::as_i64), Some(41));
    }

    #[tokio::test]
    async fn surfaces_a_jsonrpc_error_as_a_protocol_error() {
        let (server_end, client_end) = duplex(64 * 1024);
        let (reader, mut writer) = split(server_end);
        let server = tokio::spawn(async move {
            let mut reader = BufReader::new(reader);
            let mut line = String::new();
            while reader.read_line(&mut line).await.unwrap_or(0) > 0 {
                let message: Value = serde_json::from_str(line.trim()).unwrap();
                line.clear();
                let method = message.get("method").and_then(Value::as_str);
                if method == Some("initialize") {
                    let reply = json!({
                        "jsonrpc": "2.0",
                        "id": message.get("id").cloned(),
                        "result": { "protocolVersion": "2025-06-18", "serverInfo": { "name": "fake", "version": "1" } },
                    });
                    writer
                        .write_all(format!("{}\n", reply).as_bytes())
                        .await
                        .unwrap();
                } else if method == Some("tools/call") {
                    let reply = json!({
                        "jsonrpc": "2.0",
                        "id": message.get("id").cloned(),
                        "error": { "code": -32602, "message": "unknown tool" },
                    });
                    writer
                        .write_all(format!("{}\n", reply).as_bytes())
                        .await
                        .unwrap();
                    // The error is the last message this conversation owes.
                    break;
                }
            }
        });
        let (client_reader, client_writer) = split(client_end);
        let mut client = McpClient::new(Box::new(client_reader), Box::new(client_writer));
        client.initialize(Duration::from_secs(5)).await.unwrap();
        let error = client
            .call_tool(
                "nope",
                json!({}),
                Duration::from_secs(5),
                CancellationToken::new(),
            )
            .await
            .unwrap_err();
        assert!(matches!(error, McpError::Protocol(message) if message == "unknown tool"));
        server.await.unwrap();
    }
}
