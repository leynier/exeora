//! Downstream MCP servers: configuration, the client that talks to them, and
//! the registry that keeps one set per project.
//!
//! Exeora is an MCP *client* here, not a server: each configured server is a
//! local process the CLI launches and speaks JSON-RPC 2.0 to over stdio, the
//! transport nearly every existing MCP server speaks. Its tools are then
//! republished through the gateway's own MCP endpoint under a prefixed name,
//! so one connection reaches the project's files, its commands and its other
//! MCP servers at once. The gateway never learns how to reach a downstream
//! server directly — it only ever sees the announcement and forwards calls
//! through the relay, which keeps the outbound-only property intact.

pub mod client;
pub mod config;
pub mod registry;

use serde_json::Value;
use std::time::Duration;

pub use client::{McpClient, McpError, McpTool};
pub use config::{load_project_config, McpServerConfig, NamedServer};
pub use registry::McpRegistry;

/** The MCP protocol revision this client offers a downstream server. */
pub const OFFERED_PROTOCOL_VERSION: &str = "2025-06-18";

/** How long a downstream server gets to answer any one request. */
pub const REQUEST_BUDGET: Duration = Duration::from_secs(30);

/**
 * The limits the relay enforces on an announcement, read from the generated
 * contract so the two sides cannot drift.
 */
pub struct McpLimits {
    pub servers: usize,
    pub tools_per_server: usize,
    pub input_schema_bytes: usize,
    pub announcement_bytes: usize,
}

impl McpLimits {
    pub fn from_contract() -> Self {
        let contract: Value =
            serde_json::from_str(include_str!("../../protocol/contract.json"))
                .expect("generated contract is valid JSON");
        let limits = contract
            .get("limits")
            .cloned()
            .unwrap_or_else(|| serde_json::json!({}));
        let read = |name: &str, fallback: usize| {
            limits
                .get(name)
                .and_then(Value::as_u64)
                .map_or(fallback, |value| value as usize)
        };
        Self {
            servers: read("MAX_MCP_SERVERS", 16),
            tools_per_server: read("MAX_MCP_TOOLS_PER_SERVER", 64),
            input_schema_bytes: read("MAX_MCP_INPUT_SCHEMA_BYTES", 16_384),
            announcement_bytes: read("MAX_MCP_ANNOUNCEMENT_BYTES", 100_000),
        }
    }
}
