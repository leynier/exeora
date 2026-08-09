use crate::protocol::ToolName;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{collections::HashSet, fs, path::Path};

pub const POLICY_FILENAME: &str = "exeora.toml";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PolicyMode {
    AllowAll,
    AllowList,
    ReadOnly,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandPolicy {
    pub mode: PolicyMode,
    #[serde(default)]
    pub allow: Vec<String>,
    #[serde(default)]
    pub deny: Vec<String>,
    #[serde(default)]
    pub shell: bool,
    #[serde(default)]
    pub approve: bool,
    #[serde(default)]
    pub tools: Option<Vec<ToolName>>,
}

impl Default for CommandPolicy {
    fn default() -> Self {
        Self {
            mode: PolicyMode::AllowAll,
            allow: vec![],
            deny: vec![],
            shell: false,
            approve: false,
            tools: None,
        }
    }
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct LocalCommandPolicy {
    pub mode: Option<PolicyMode>,
    pub allow: Option<Vec<String>>,
    pub deny: Option<Vec<String>>,
    pub shell: Option<bool>,
    pub approve: Option<bool>,
    pub tools: Option<Vec<ToolName>>,
}

#[derive(Debug, Clone)]
pub struct PolicyVerdict {
    pub allowed: bool,
    pub reason: Option<String>,
}

impl PolicyVerdict {
    fn yes() -> Self {
        Self {
            allowed: true,
            reason: None,
        }
    }
    fn no(reason: impl Into<String>) -> Self {
        Self {
            allowed: false,
            reason: Some(reason.into()),
        }
    }
}

pub fn effective_policy(
    root: &Path,
    remote: Option<CommandPolicy>,
) -> (CommandPolicy, Option<String>) {
    let account = remote.unwrap_or_default();
    let path = root.join(POLICY_FILENAME);
    let text = match fs::read_to_string(&path) {
        Ok(text) => text,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return (account, None),
        Err(_) => {
            return (
                account,
                Some(format!(
                    "{POLICY_FILENAME} could not be read; the account's policy applies."
                )),
            );
        }
    };
    let local: LocalCommandPolicy = match toml::from_str(&text) {
        Ok(policy) => policy,
        Err(_) => {
            return (
                account,
                Some(format!(
                    "{POLICY_FILENAME} is not valid TOML; the account's policy applies."
                )),
            );
        }
    };
    (narrow_policy(&account, &local), None)
}

pub fn narrow_policy(remote: &CommandPolicy, local: &LocalCommandPolicy) -> CommandPolicy {
    let mode = local
        .mode
        .map_or(remote.mode, |mode| stricter(remote.mode, mode));
    let approve = remote.approve || local.approve.unwrap_or(false);
    let mut deny = remote.deny.clone();
    for rule in local.deny.as_deref().unwrap_or_default() {
        if !deny.contains(rule) {
            deny.push(rule.clone());
        }
    }
    let tools = match (&remote.tools, &local.tools) {
        (remote, None) => remote.clone(),
        (None, Some(local)) => Some(local.clone()),
        (Some(remote), Some(local)) => Some(
            remote
                .iter()
                .copied()
                .filter(|tool| local.contains(tool))
                .collect(),
        ),
    };
    let shell = local
        .shell
        .map_or(remote.shell, |shell| remote.shell && shell);
    let allow = if mode != PolicyMode::AllowList {
        Vec::new()
    } else {
        let mut lists: Vec<&[String]> = Vec::new();
        if remote.mode == PolicyMode::AllowList {
            lists.push(&remote.allow);
        }
        if local.mode == Some(PolicyMode::AllowList)
            && let Some(list) = &local.allow
        {
            lists.push(list);
        }
        lists.split_first().map_or_else(Vec::new, |(first, rest)| {
            first
                .iter()
                .filter(|item| rest.iter().all(|list| list.contains(item)))
                .cloned()
                .collect()
        })
    };
    CommandPolicy {
        mode,
        allow,
        deny,
        shell,
        approve,
        tools,
    }
}

pub fn policy_allows(policy: &CommandPolicy, tool: ToolName, args: &Value) -> PolicyVerdict {
    if let Some(tools) = &policy.tools
        && !tools.contains(&tool)
    {
        let permitted = if tools.is_empty() {
            "nothing".to_owned()
        } else {
            tools
                .iter()
                .map(ToString::to_string)
                .collect::<Vec<_>>()
                .join(", ")
        };
        return PolicyVerdict::no(format!(
            "This project does not offer `{tool}`. Permitted: {permitted}."
        ));
    }
    if !tool.read_only() && policy.mode == PolicyMode::ReadOnly {
        return PolicyVerdict::no("This project is read only. It allows no tool that changes it.");
    }
    if !matches!(tool, ToolName::RunCommand | ToolName::StartCommand) {
        return PolicyVerdict::yes();
    }
    let Some(command) = args.get("command").and_then(Value::as_str) else {
        return PolicyVerdict::no("No command was given.");
    };
    command_allowed(policy, command)
}

pub fn command_allowed(policy: &CommandPolicy, command: &str) -> PolicyVerdict {
    if policy.mode == PolicyMode::ReadOnly {
        return PolicyVerdict::no("This project is read only. It runs no commands.");
    }
    let words = tokenize(command);
    let Some(program) = words.first() else {
        return PolicyVerdict::no("No command was given.");
    };
    let readable = policy.mode == PolicyMode::AllowList || !policy.deny.is_empty();
    if readable && !policy.shell && command.chars().any(is_shell_syntax) {
        return PolicyVerdict::no(
            "This project allows only plain commands. Shell syntax (pipes, redirection, substitution, chaining) is not permitted.",
        );
    }
    if policy.deny.iter().any(|rule| matches_rule(rule, &words)) {
        return PolicyVerdict::no(format!("`{program}` is on this project's deny list."));
    }
    if policy.mode == PolicyMode::AllowAll {
        return PolicyVerdict::yes();
    }
    if !policy.allow.iter().any(|rule| matches_rule(rule, &words)) {
        let permitted = if policy.allow.is_empty() {
            "nothing".to_owned()
        } else {
            policy.allow.join(", ")
        };
        return PolicyVerdict::no(format!(
            "`{program}` is not on this project's allow list. Permitted: {permitted}."
        ));
    }
    PolicyVerdict::yes()
}

pub fn matches_rule(rule: &str, words: &[&str]) -> bool {
    let parts = tokenize(rule);
    if parts.is_empty() {
        return false;
    }
    let wildcard = parts.last() == Some(&"*");
    let fixed = if wildcard {
        &parts[..parts.len() - 1]
    } else {
        &parts[..]
    };
    if !wildcard && fixed.len() == 1 {
        return words.first() == fixed.first();
    }
    if words.len() < fixed.len() || (!wildcard && words.len() != fixed.len()) {
        return false;
    }
    fixed.iter().zip(words).all(|(a, b)| a == b)
}

pub fn render_policy_toml(local: &LocalCommandPolicy) -> String {
    let mut lines = vec![
        "# What agents may do in this project, on this machine.".to_owned(),
        "#".to_owned(),
        "# This file can only narrow what the project's policy already allows,".to_owned(),
        "# never widen it. Every key is optional: leaving one out means this file".to_owned(),
        "# has no opinion about it, which is not the same as asking for the".to_owned(),
        "# strictest value.".to_owned(),
        String::new(),
    ];
    if let Some(mode) = local.mode {
        lines.push(format!("mode = \"{}\"", mode_name(mode)));
    }
    if let Some(values) = &local.allow {
        lines.push(format!("allow = {}", render_list(values)));
    }
    if let Some(values) = &local.deny {
        lines.push(format!("deny = {}", render_list(values)));
    }
    if let Some(value) = local.shell {
        lines.push(format!("shell = {value}"));
    }
    if let Some(value) = local.approve {
        lines.push(format!("approve = {value}"));
    }
    if let Some(values) = &local.tools {
        lines.push(format!(
            "tools = {}",
            render_list(&values.iter().map(ToString::to_string).collect::<Vec<_>>())
        ));
    }
    format!("{}\n", lines.join("\n"))
}

fn render_list(values: &[String]) -> String {
    format!(
        "[{}]",
        values
            .iter()
            .map(|value| format!("{:?}", value))
            .collect::<Vec<_>>()
            .join(", ")
    )
}
fn mode_name(mode: PolicyMode) -> &'static str {
    match mode {
        PolicyMode::AllowAll => "allow_all",
        PolicyMode::AllowList => "allow_list",
        PolicyMode::ReadOnly => "read_only",
    }
}
fn stricter(a: PolicyMode, b: PolicyMode) -> PolicyMode {
    if rank(a) >= rank(b) { a } else { b }
}
fn rank(mode: PolicyMode) -> u8 {
    match mode {
        PolicyMode::AllowAll => 0,
        PolicyMode::AllowList => 1,
        PolicyMode::ReadOnly => 2,
    }
}
fn tokenize(value: &str) -> Vec<&str> {
    value.split_whitespace().collect()
}
fn is_shell_syntax(c: char) -> bool {
    ";&|<>$`(){}[]!*?~\n\r\\\"'".contains(c)
}

pub fn validate_tool_set(tools: &[ToolName]) -> bool {
    let unique: HashSet<_> = tools.iter().collect();
    unique.len() == tools.len()
}
