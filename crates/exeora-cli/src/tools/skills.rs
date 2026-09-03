use super::files::join_error;
use super::path::{GLOBAL_SKILLS_PREFIX, global_skills_dir, relative_string};
use crate::error::ExeoraError;
use serde_json::{Value, json};
use std::{collections::HashMap, fs, path::Path};

const MAX_DEPTH: usize = 6;
const MAX_DIRECTORIES: usize = 2_000;

struct Skill {
    name: String,
    description: String,
    source: &'static str,
    path: String,
}

pub async fn list_skills(root: &Path, _args: Value) -> Result<Value, ExeoraError> {
    let root = root.to_owned();
    tokio::task::spawn_blocking(move || {
        let mut by_name = HashMap::new();
        if let Some(user) = global_skills_dir() {
            for skill in discover(&user, "user", GLOBAL_SKILLS_PREFIX) {
                by_name.insert(skill.name.clone(), skill);
            }
        }
        let project_dir = root.join(".agents").join("skills");
        for skill in discover(&project_dir, "project", ".agents/skills") {
            by_name.insert(skill.name.clone(), skill);
        }
        let mut skills: Vec<Skill> = by_name.into_values().collect();
        skills.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(json!({
            "skills": skills.iter().map(|skill| json!({
                "name": skill.name,
                "description": skill.description,
                "source": skill.source,
                "path": skill.path,
            })).collect::<Vec<_>>(),
        }))
    })
    .await
    .map_err(join_error)?
}

fn discover(dir: &Path, source: &'static str, display_root: &str) -> Vec<Skill> {
    let mut skills = Vec::new();
    let mut visited = 0usize;
    walk_skills(dir, dir, 0, &mut visited, source, display_root, &mut skills);
    skills
}

fn walk_skills(
    root: &Path,
    dir: &Path,
    depth: usize,
    visited: &mut usize,
    source: &'static str,
    display_root: &str,
    skills: &mut Vec<Skill>,
) {
    if depth > MAX_DEPTH || *visited >= MAX_DIRECTORIES {
        return;
    }
    *visited += 1;
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };

    let skill_md = dir.join("SKILL.md");
    if skill_md.is_file() {
        if let Some(skill) = load_skill(&skill_md, root, source, display_root) {
            skills.push(skill);
        }
        return;
    }

    for entry in entries.flatten() {
        let name = entry.file_name();
        let name_str = name.to_string_lossy();
        if name_str == "node_modules" || name_str == ".git" || name_str.starts_with('.') {
            continue;
        }
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if kind.is_dir() && !kind.is_symlink() {
            walk_skills(
                root,
                &entry.path(),
                depth + 1,
                visited,
                source,
                display_root,
                skills,
            );
        }
    }
}

fn load_skill(
    skill_md: &Path,
    skills_root: &Path,
    source: &'static str,
    display_root: &str,
) -> Option<Skill> {
    let content = fs::read_to_string(skill_md).ok()?;
    let meta = parse_frontmatter(&content)?;
    let description = meta.description?;
    if description.trim().is_empty() {
        return None;
    }
    if meta.disable_model_invocation {
        return None;
    }
    if !valid_skill_description(&description) {
        return None;
    }
    let parent = skill_md
        .parent()?
        .file_name()?
        .to_string_lossy()
        .into_owned();
    let name = meta.name.unwrap_or_else(|| parent.clone());
    if !valid_skill_name(&name) || name != parent {
        return None;
    }
    let relative = skill_md.strip_prefix(skills_root).ok()?;
    let path = format!("{display_root}/{}", relative_string(relative));
    Some(Skill {
        name,
        description,
        source,
        path,
    })
}

struct Frontmatter {
    name: Option<String>,
    description: Option<String>,
    disable_model_invocation: bool,
}

fn parse_frontmatter(content: &str) -> Option<Frontmatter> {
    let rest = content.strip_prefix("---")?;
    let rest = rest
        .strip_prefix('\n')
        .or_else(|| rest.strip_prefix("\r\n"))?;
    let end = rest.find("\n---").or_else(|| rest.find("\r\n---"))?;
    let block = &rest[..end];
    let lines: Vec<&str> = block.lines().collect();
    let mut name = None;
    let mut description = None;
    let mut disable_model_invocation = false;
    let mut index = 0;
    while index < lines.len() {
        let raw = lines[index];
        let trimmed = raw.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            index += 1;
            continue;
        }
        let Some((key, rest)) = trimmed.split_once(':') else {
            index += 1;
            continue;
        };
        let (value, next) = yaml_scalar(rest.trim(), &lines, index, raw);
        index = next;
        match key.trim() {
            "name" => name = Some(value),
            "description" => description = Some(value),
            "disable-model-invocation" => {
                disable_model_invocation = yaml_true(&value);
            }
            _ => {}
        }
    }
    Some(Frontmatter {
        name: name.filter(|value| !value.is_empty()),
        description,
        disable_model_invocation,
    })
}

fn yaml_scalar<'a>(
    rest: &'a str,
    lines: &'a [&'a str],
    index: usize,
    raw: &'a str,
) -> (String, usize) {
    let folded = matches!(rest, ">" | ">-" | ">+");
    let literal = matches!(rest, "|" | "|-" | "|+");
    if !folded && !literal {
        return (unquote(rest), index + 1);
    }
    let key_indent = raw.len() - raw.trim_start().len();
    let mut body = Vec::new();
    let mut next = index + 1;
    let mut block_indent = None;
    while next < lines.len() {
        let line = lines[next];
        if line.trim().is_empty() {
            body.push(String::new());
            next += 1;
            continue;
        }
        let indent = line.len() - line.trim_start().len();
        if indent <= key_indent {
            break;
        }
        let block = *block_indent.get_or_insert(indent);
        if indent < block {
            break;
        }
        body.push(line.get(block..).unwrap_or("").to_owned());
        next += 1;
    }
    while body.last().is_some_and(|line| line.is_empty()) {
        body.pop();
    }
    let value = if folded {
        fold_yaml(&body)
    } else {
        body.join("\n")
    };
    (value, next)
}

fn fold_yaml(lines: &[String]) -> String {
    let mut paragraphs: Vec<String> = Vec::new();
    let mut current = String::new();
    for line in lines {
        if line.is_empty() {
            if !current.is_empty() {
                paragraphs.push(std::mem::take(&mut current));
            }
            continue;
        }
        if !current.is_empty() {
            current.push(' ');
        }
        current.push_str(line);
    }
    if !current.is_empty() {
        paragraphs.push(current);
    }
    paragraphs.join("\n")
}

fn valid_skill_name(name: &str) -> bool {
    let count = name.chars().count();
    if count == 0 || count > 64 {
        return false;
    }
    if name != name.to_lowercase()
        || name.starts_with('-')
        || name.ends_with('-')
        || name.contains("--")
    {
        return false;
    }
    name.chars()
        .all(|character| character.is_alphanumeric() || character == '-')
}

fn valid_skill_description(description: &str) -> bool {
    let count = description.chars().count();
    (1..=1_024).contains(&count)
}

fn yaml_true(value: &str) -> bool {
    matches!(value.to_ascii_lowercase().as_str(), "true" | "yes" | "on")
}

fn unquote(value: &str) -> String {
    if value.len() >= 2 {
        let bytes = value.as_bytes();
        if (bytes[0] == b'"' && bytes[value.len() - 1] == b'"')
            || (bytes[0] == b'\'' && bytes[value.len() - 1] == b'\'')
        {
            return value[1..value.len() - 1].to_owned();
        }
    }
    value.to_owned()
}

#[cfg(test)]
mod tests {
    use super::parse_frontmatter;

    #[test]
    fn reads_name_and_description() {
        let parsed = parse_frontmatter(
            "---\nname: pdf-processing\ndescription: Extract text from PDFs.\n---\n# Body\n",
        )
        .unwrap();
        assert_eq!(parsed.name.as_deref(), Some("pdf-processing"));
        assert_eq!(
            parsed.description.as_deref(),
            Some("Extract text from PDFs.")
        );
        assert!(!parsed.disable_model_invocation);
    }

    #[test]
    fn accepts_a_colon_in_an_unquoted_description() {
        let parsed = parse_frontmatter(
            "---\ndescription: Use this skill when: the user asks about PDFs\n---\n",
        )
        .unwrap();
        assert_eq!(
            parsed.description.as_deref(),
            Some("Use this skill when: the user asks about PDFs")
        );
    }

    #[test]
    fn honors_disable_model_invocation() {
        let parsed =
            parse_frontmatter("---\ndescription: Hidden.\ndisable-model-invocation: True\n---\n")
                .unwrap();
        assert!(parsed.disable_model_invocation);
    }

    #[test]
    fn reads_a_folded_multiline_description() {
        let parsed = parse_frontmatter(
            "---\nname: review\ndescription: >-\n  Run a reviewer subagent against uncommitted local changes.\n  Local and branch modes write a review file.\n---\n# Body\n",
        )
        .unwrap();
        assert_eq!(
            parsed.description.as_deref(),
            Some(
                "Run a reviewer subagent against uncommitted local changes. Local and branch modes write a review file."
            )
        );
    }

    #[test]
    fn ends_a_folded_block_on_a_less_indented_line() {
        let parsed = parse_frontmatter(
            "---\ndescription: >-\n    first line\n  name: not-in-description\n---\n",
        )
        .unwrap();
        assert_eq!(parsed.description.as_deref(), Some("first line"));
    }

    #[test]
    fn does_not_panic_on_a_shorter_utf8_continuation_line() {
        let parsed = parse_frontmatter("---\ndescription: >-\n   foo\n  éxtra\n---\n").unwrap();
        assert_eq!(parsed.description.as_deref(), Some("foo"));
    }

    #[test]
    fn accepts_only_spec_skill_names() {
        assert!(super::valid_skill_name("pdf-processing"));
        assert!(super::valid_skill_name("review"));
        assert!(!super::valid_skill_name("PDF-Processing"));
        assert!(!super::valid_skill_name("-pdf"));
        assert!(!super::valid_skill_name("pdf--processing"));
        assert!(!super::valid_skill_name("pdf-"));
        assert!(!super::valid_skill_name(&"a".repeat(65)));
        assert!(super::valid_skill_description("Search the web."));
        assert!(!super::valid_skill_description(&"x".repeat(1025)));
    }
}
