//! Where downstream MCP servers are configured, and how the two levels merge.
//!
//! The same file shape at both levels, and the same one the wider ecosystem
//! already uses (`mcpServers` with `command`/`args`/`env`, stdio transport):
//!
//! ```json
//! {
//!   "mcpServers": {
//!     "context7": {
//!       "command": "npx",
//!       "args": ["-y", "@upstash/context7-mcp"],
//!       "env": { "API_KEY": "..." }
//!     }
//!   }
//! }
//! ```
//!
//! User level: `mcp.json` beside the CLI's own `config.json`, applying to every
//! project this machine serves. Project level: `.exeora/mcp.json` at the
//! project root, applying to that project alone and winning on a name clash,
//! because the project is the more specific opinion.
//!
//! A broken file is a warning rather than a failed connect: one unreadable
//! config should not take the machine's sixteen executor tools offline with it.

use serde::Deserialize;
use serde_json::Value;
use std::{collections::BTreeMap, fs, path::Path};

use crate::config::mcp_config_path;

/** Directory inside a project root that holds project-level Exeora config. */
pub const PROJECT_CONFIG_DIR: &str = ".exeora";
pub const CONFIG_FILENAME: &str = "mcp.json";

#[derive(Debug, Clone, Deserialize)]
struct McpConfigFile {
    #[serde(default, rename = "mcpServers")]
    mcp_servers: BTreeMap<String, Value>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct McpServerConfig {
    /** Defaulted rather than required, so a missing command reaches the
     * plain-language "no command to run" warning instead of a serde shape
     * error; every other bad shape still takes the generic path. */
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
}

/** One configured server, its name validated and its level remembered. */
#[derive(Debug, Clone)]
pub struct NamedServer {
    pub name: String,
    pub config: McpServerConfig,
}

/**
 * Reads both levels for one project and merges them.
 *
 * Names are sorted, so the merged set, the announcement and every diagnostic
 * about it are deterministic across runs and machines.
 */
pub fn load_project_config(root: &Path) -> (Vec<NamedServer>, Vec<String>) {
    let user_path = mcp_config_path().unwrap_or_else(|_| "mcp.json".into());
    merge_configs(&user_path, root)
}

/** The same merge, for a caller that knows where both files live. */
pub fn merge_configs(user: &Path, root: &Path) -> (Vec<NamedServer>, Vec<String>) {
    let mut merged: BTreeMap<String, McpServerConfig> = BTreeMap::new();
    let mut warnings = Vec::new();

    read_level(user, &mut merged, &mut warnings, "user");

    let project_path = root.join(PROJECT_CONFIG_DIR).join(CONFIG_FILENAME);
    // Second, so a project-level entry with the same name replaces the user's:
    // the more specific file is the later opinion.
    read_level(&project_path, &mut merged, &mut warnings, "project");

    let servers: Vec<NamedServer> = merged
        .into_iter()
        .map(|(name, config)| NamedServer { name, config })
        .collect();
    (servers, warnings)
}

fn read_level(
    path: &Path,
    merged: &mut BTreeMap<String, McpServerConfig>,
    warnings: &mut Vec<String>,
    level: &str,
) {
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return,
        Err(error) => {
            warnings.push(format!(
                "{level} MCP config {} could not be read: {error}",
                path.display()
            ));
            return;
        }
    };
    let file: McpConfigFile = match serde_json::from_slice(&bytes) {
        Ok(file) => file,
        Err(error) => {
            warnings.push(format!("{level} MCP config is not valid JSON: {error}"));
            return;
        }
    };
    for (name, entry) in file.mcp_servers {
        // Entry by entry, so one server's bad shape is a warning about that
        // server rather than a whole file that never loads: the machine's
        // other servers, and its sixteen executor tools, should not go dark
        // over one missing `command`.
        let config: McpServerConfig = match serde_json::from_value(entry) {
            Ok(config) => config,
            Err(error) => {
                warnings.push(format!(
                    "{level} MCP config gives server `{name}` a shape it cannot use: {error}"
                ));
                continue;
            }
        };
        if !valid_server_name(&name) {
            warnings.push(format!(
                "{level} MCP config names a server `{name}`, which is not a name a tool can carry"
            ));
            continue;
        }
        if config.command.trim().is_empty() {
            warnings.push(format!(
                "{level} MCP config gives server `{name}` no command to run"
            ));
            continue;
        }
        merged.insert(name, config);
    }
}

/**
 * `^[a-z0-9][a-z0-9-]{0,31}$`, written out rather than borrowed from a regex
 * crate: it is one loop, and the bound it enforces — that the prefixed tool
 * name a server produces is one an MCP client will accept — is easier to read
 * here than behind a pattern.
 */
fn valid_server_name(name: &str) -> bool {
    let mut chars = name.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if !first.is_ascii_lowercase() && !first.is_ascii_digit() {
        return false;
    }
    let rest = chars.count();
    rest <= 31
        && name[1..]
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    fn write(path: &std::path::PathBuf, body: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, body).unwrap();
    }

    #[test]
    fn merges_user_and_project_levels_with_the_project_winning() {
        let directory = tempdir().unwrap();
        let user = directory.path().join("user-mcp.json");
        let project = directory.path().join("root");
        write(
            &user,
            r#"{
                "mcpServers": {
                    "shared": { "command": "old-command" },
                    "user-only": { "command": "user-tool" }
                }
            }"#,
        );
        write(
            &project.join(".exeora/mcp.json"),
            r#"{
                "mcpServers": {
                    "shared": { "command": "new-command", "args": ["--flag"] },
                    "project-only": { "command": "project-tool" }
                }
            }"#,
        );

        let (servers, warnings) = merge_configs(&user, &project);

        assert!(warnings.is_empty());
        assert_eq!(
            servers
                .iter()
                .map(|server| (server.name.as_str(), server.config.command.as_str()))
                .collect::<Vec<_>>(),
            vec![
                ("project-only", "project-tool"),
                ("shared", "new-command"),
                ("user-only", "user-tool"),
            ]
        );
        assert_eq!(servers[1].config.args, vec!["--flag"]);
    }

    #[test]
    fn warns_about_broken_files_without_failing_the_rest() {
        let directory = tempdir().unwrap();
        let user = directory.path().join("user-mcp.json");
        let project = directory.path().join("root");
        write(&user, "{ not json");
        write(
            &project.join(".exeora/mcp.json"),
            r#"{
                "mcpServers": {
                    "Bad Name": { "command": "x" },
                    "no-command": { "args": ["y"] },
                    "good": { "command": "fine" }
                }
            }"#,
        );

        let (servers, warnings) = merge_configs(&user, &project);

        assert_eq!(servers.len(), 1);
        assert_eq!(servers[0].name, "good");
        assert_eq!(warnings.len(), 3);
        assert!(warnings[0].contains("not valid JSON"));
        assert!(warnings[1].contains("Bad Name"));
        assert!(warnings[2].contains("no command"));
    }

    #[test]
    fn accepts_the_shape_the_ecosystem_already_uses() {
        let file: McpConfigFile = serde_json::from_str(
            r#"{
                "mcpServers": {
                    "context7": {
                        "command": "npx",
                        "args": ["-y", "@upstash/context7-mcp"],
                        "env": { "DEFAULT_MINIMUM_TOKENS": "10000" }
                    }
                }
            }"#,
        )
        .unwrap();
        let server: McpServerConfig =
            serde_json::from_value(file.mcp_servers["context7"].clone()).unwrap();
        assert_eq!(server.command, "npx");
        assert_eq!(server.args, vec!["-y", "@upstash/context7-mcp"]);
        assert_eq!(
            server.env.get("DEFAULT_MINIMUM_TOKENS").map(String::as_str),
            Some("10000")
        );
    }
}
