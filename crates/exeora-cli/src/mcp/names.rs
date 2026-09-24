use crate::protocol::{MAX_MCP_CATALOG_BYTES, MAX_MCP_TOOL_NAME_LENGTH, MAX_MCP_TOOLS_PER_PROJECT};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};

/// What an upstream server claims about a tool. Hints, never contracts.
#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct McpToolAnnotations {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub read_only_hint: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub destructive_hint: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub idempotent_hint: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub open_world_hint: Option<bool>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct McpToolDescriptor {
    pub exposed_name: String,
    pub server: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub input_schema: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub annotations: Option<McpToolAnnotations>,
}

/// `mcp__server__tool`, sanitized to the characters every client accepts and
/// shortened with a stable hash when it would pass the name-length limit.
pub fn exposed_name(server: &str, tool: &str) -> String {
    let server = sanitize_name(server);
    let tool = sanitize_name(tool);
    let base = format!("mcp__{server}__{tool}");
    if base.len() <= MAX_MCP_TOOL_NAME_LENGTH {
        return base;
    }
    with_hash_suffix(&base, server.as_bytes(), tool.as_bytes())
}

fn sanitize_name(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-') {
            out.push(char::from(byte));
        } else {
            out.push('_');
        }
    }
    if out.is_empty() {
        "unnamed".to_owned()
    } else {
        out
    }
}

/// Two tools that sanitize to the same name both get a hashed suffix, so
/// neither silently shadows the other.
pub fn resolve_exposed_name_collisions(tools: &mut [McpToolDescriptor]) {
    let mut counts = HashMap::<String, usize>::new();
    for tool in tools.iter() {
        *counts.entry(tool.exposed_name.clone()).or_default() += 1;
    }
    let mut used = HashSet::new();
    for tool in tools {
        let base = tool.exposed_name.clone();
        if counts.get(&base).copied().unwrap_or_default() > 1 || !used.insert(base.clone()) {
            tool.exposed_name =
                with_hash_suffix(&base, tool.server.as_bytes(), tool.name.as_bytes());
            used.insert(tool.exposed_name.clone());
        }
    }
}

fn with_hash_suffix(base: &str, server: &[u8], tool: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(server);
    hasher.update([0]);
    hasher.update(tool);
    let digest = format!("{:x}", hasher.finalize());
    let suffix = &digest[..10];
    let keep = MAX_MCP_TOOL_NAME_LENGTH - suffix.len() - 2;
    // Sanitized names are ASCII, so any byte offset is a character boundary.
    let prefix = &base[..base.len().min(keep)];
    format!("{prefix}__{suffix}")
}

/// A project's catalog as it is published: unique names, sorted, and inside
/// the tool-count and byte budgets the relay enforces. Returns what was left
/// out, for the warning.
pub fn publishable_catalog(mut tools: Vec<McpToolDescriptor>) -> (Vec<McpToolDescriptor>, usize) {
    resolve_exposed_name_collisions(&mut tools);
    tools.sort_by(|a, b| a.exposed_name.cmp(&b.exposed_name));
    let total = tools.len();
    tools.truncate(MAX_MCP_TOOLS_PER_PROJECT);

    let mut bytes = 2usize;
    let mut kept = Vec::with_capacity(tools.len());
    for tool in tools {
        let encoded =
            serde_json::to_vec(&tool).map_or(MAX_MCP_CATALOG_BYTES + 1, |value| value.len());
        let next = bytes.saturating_add(encoded).saturating_add(1);
        if next > MAX_MCP_CATALOG_BYTES {
            continue;
        }
        bytes = next;
        kept.push(tool);
    }
    let omitted = total - kept.len();
    (kept, omitted)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn descriptor(server: &str, name: &str) -> McpToolDescriptor {
        McpToolDescriptor {
            exposed_name: exposed_name(server, name),
            server: server.to_owned(),
            name: name.to_owned(),
            title: None,
            description: None,
            input_schema: serde_json::json!({ "type": "object" }),
            annotations: None,
        }
    }

    fn valid(name: &str) -> bool {
        let Some(rest) = name.strip_prefix("mcp__") else {
            return false;
        };
        name.len() <= MAX_MCP_TOOL_NAME_LENGTH
            && rest.contains("__")
            && rest
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
    }

    #[test]
    fn exposed_names_are_prefixed_sanitized_and_collision_safe() {
        let mut tools = vec![
            descriptor("git.hub", "create/issue"),
            descriptor("git/hub", "create.issue"),
        ];
        assert_eq!(tools[0].exposed_name, tools[1].exposed_name);
        resolve_exposed_name_collisions(&mut tools);
        assert_ne!(tools[0].exposed_name, tools[1].exposed_name);
        assert!(tools.iter().all(|tool| valid(&tool.exposed_name)));
    }

    #[test]
    fn long_names_are_capped_at_the_client_limit_and_stay_distinct() {
        let long_tool = "a_really_descriptive_tool_name_that_goes_on_and_on_forever";
        let first = exposed_name("github", long_tool);
        let second = exposed_name("github", &format!("{long_tool}_again"));
        let long_server = exposed_name(&"s".repeat(64), "t");

        for name in [&first, &second, &long_server] {
            assert_eq!(name.len(), MAX_MCP_TOOL_NAME_LENGTH);
            assert!(valid(name), "{name}");
        }
        assert_ne!(first, second);
        assert_eq!(first, exposed_name("github", long_tool));
        assert_eq!(exposed_name("fs", "read"), "mcp__fs__read");
    }

    #[test]
    fn the_published_catalog_respects_the_tool_budget() {
        let tools = (0..MAX_MCP_TOOLS_PER_PROJECT + 5)
            .map(|index| descriptor("demo", &format!("tool{index}")))
            .collect::<Vec<_>>();
        let (kept, omitted) = publishable_catalog(tools);
        assert_eq!(kept.len(), MAX_MCP_TOOLS_PER_PROJECT);
        assert_eq!(omitted, 5);
        assert!(
            kept.windows(2)
                .all(|pair| pair[0].exposed_name < pair[1].exposed_name)
        );
    }
}
