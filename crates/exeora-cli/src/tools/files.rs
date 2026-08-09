use super::path::{relative_string, resolve_in_project};
use crate::{
    error::{ErrorCode, ExeoraError},
    protocol::{MAX_GREP_MATCHES, MAX_LIST_ENTRIES, MAX_READ_BYTES},
};
use cap_std::{
    ambient_authority,
    fs::{Dir, OpenOptions},
};
use globset::{Glob, GlobMatcher};
use grep_matcher::{Match, Matcher, NoCaptures, NoError};
use grep_searcher::{BinaryDetection, SearcherBuilder, sinks};
use ignore::gitignore::{Gitignore, GitignoreBuilder};
use memchr::{memchr, memmem};
use regress::Regex;
use serde::Deserialize;
use serde_json::{Value, json};
use similar::TextDiff;
use std::{
    collections::VecDeque,
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Arc,
};
use unicode_normalization::UnicodeNormalization;

const ALWAYS_SKIP: [&str; 5] = [".git", "node_modules", ".wrangler", "dist", ".astro"];

#[derive(Deserialize)]
struct ReadArgs {
    path: String,
    offset: Option<usize>,
    limit: Option<usize>,
}

pub async fn read_file(root: &Path, args: Value) -> Result<Value, ExeoraError> {
    let root = root.to_owned();
    tokio::task::spawn_blocking(move || {
        let args: ReadArgs = parse(args)?;
        let (real_root, relative) = resolve_in_project(&root, &args.path)?;
        let dir = open_root(&real_root)?;
        let mut file = dir.open(&relative).map_err(|error| ExeoraError::tool(format!("Could not read {}: {:?}.", relative_string(&relative), error.kind())))?;
        let mut bytes = Vec::new();
        file.read_to_end(&mut bytes).map_err(|error| ExeoraError::tool(error.to_string()))?;
        if memchr(0, &bytes[..bytes.len().min(8192)]).is_some() {
            return Err(ExeoraError::tool(format!("{} is a binary file ({} bytes). read_file only returns text.", relative_string(&relative), bytes.len())));
        }
        let text = String::from_utf8_lossy(&bytes);
        let lines: Vec<&str> = text.split('\n').collect();
        let total = if text.is_empty() { 0 } else if text.ends_with('\n') { lines.len() - 1 } else { lines.len() };
        let start = args.offset.map_or(0, |offset| offset - 1);
        if start > 0 && start >= total {
            return Err(ExeoraError::tool(format!("Offset {} is past the end of {}, which has {total} lines.", args.offset.unwrap_or_default(), relative_string(&relative))));
        }
        let end = args.limit.map_or(total, |limit| (start + limit).min(total));
        let selected = lines[start..end].join("\n");
        let (content, cut) = truncate_complete_lines(&selected, MAX_READ_BYTES);
        Ok(json!({ "path": relative_string(&relative), "content": content, "truncated": cut || end < total, "totalLines": total }))
    }).await.map_err(join_error)?
}

#[derive(Deserialize)]
struct ListArgs {
    path: Option<String>,
    recursive: Option<bool>,
    glob: Option<String>,
}

pub async fn list_files(root: &Path, args: Value) -> Result<Value, ExeoraError> {
    let root = root.to_owned();
    tokio::task::spawn_blocking(move || {
        let args: ListArgs = parse(args)?;
        let (real_root, start) = resolve_in_project(&root, args.path.as_deref().unwrap_or("."))?;
        let glob = compile_glob(args.glob.as_deref())?;
        let mut seen = 0usize;
        let mut output = Vec::new();
        for entry in walk(&real_root, &start, args.recursive.unwrap_or(false), MAX_LIST_ENTRIES + 1)? {
            if glob.as_ref().is_some_and(|glob| !glob.is_match(&entry.relative)) { continue; }
            seen += 1;
            if output.len() >= MAX_LIST_ENTRIES { continue; }
            let mut value = json!({
                "path": relative_string(&entry.relative),
                "type": if entry.symlink { "symlink" } else if entry.directory { "directory" } else { "file" },
            });
            if !entry.directory
                && let Ok(metadata) = fs::metadata(&entry.absolute) { value["size"] = json!(metadata.len()); }
            output.push(value);
        }
        Ok(json!({ "path": if start.as_os_str().is_empty() { ".".to_owned() } else { relative_string(&start) }, "entries": output, "truncated": seen > MAX_LIST_ENTRIES }))
    }).await.map_err(join_error)?
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GrepArgs {
    pattern: String,
    path: Option<String>,
    glob: Option<String>,
    case_insensitive: Option<bool>,
    max_results: Option<usize>,
}

pub async fn grep(root: &Path, args: Value) -> Result<Value, ExeoraError> {
    let root = root.to_owned();
    tokio::task::spawn_blocking(move || {
        let args: GrepArgs = parse(args)?;
        let (real_root, start) = resolve_in_project(&root, args.path.as_deref().unwrap_or("."))?;
        let flags = if args.case_insensitive.unwrap_or(false) {
            "i"
        } else {
            ""
        };
        let regex = Regex::with_flags(&args.pattern, flags).map_err(|error| {
            ExeoraError::new(
                ErrorCode::InvalidArguments,
                format!("Not a valid regular expression: {error}"),
            )
        })?;
        let matcher = RegressMatcher(Arc::new(regex));
        let glob = compile_glob(args.glob.as_deref())?;
        let limit = args.max_results.unwrap_or(MAX_GREP_MATCHES);
        let mut rows = Vec::new();
        let mut truncated = false;
        for entry in walk(&real_root, &start, true, 50_000)? {
            if entry.directory
                || entry.symlink
                || glob
                    .as_ref()
                    .is_some_and(|glob| !glob.is_match(&entry.relative))
            {
                continue;
            }

            let Ok((file_rows, exceeded)) = search_path(&matcher, &entry, limit - rows.len())
            else {
                continue;
            };
            rows.extend(file_rows);
            if exceeded {
                truncated = true;
                break;
            }
        }
        Ok(json!({ "matches": rows, "truncated": truncated }))
    })
    .await
    .map_err(join_error)?
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EditArgs {
    path: String,
    old_string: String,
    new_string: String,
}

pub async fn edit_file(root: &Path, args: Value) -> Result<Value, ExeoraError> {
    let root = root.to_owned();
    tokio::task::spawn_blocking(move || {
        let args: EditArgs = parse(args)?;
        let (real_root, relative) = resolve_in_project(&root, &args.path)?;
        let dir = open_root(&real_root)?;
        let mut raw = String::new();
        dir.open(&relative)
            .and_then(|mut file| file.read_to_string(&mut raw))
            .map_err(|error| {
                ExeoraError::tool(format!(
                    "Could not edit {}: {:?}.",
                    relative_string(&relative),
                    error.kind()
                ))
            })?;
        let (bom, content) = raw
            .strip_prefix('\u{feff}')
            .map_or(("", raw.as_str()), |text| ("\u{feff}", text));
        let crlf = content
            .find("\r\n")
            .is_some_and(|crlf| content.find('\n') == Some(crlf + 1));
        let normalized = content.replace("\r\n", "\n").replace('\r', "\n");
        let old = args.old_string.replace("\r\n", "\n").replace('\r', "\n");
        let (base, index, length) = unique_match(&normalized, &old, &relative)?;
        let mut changed = base.clone();
        changed.replace_range(index..index + length, &args.new_string);
        let restored = if crlf {
            changed.replace('\n', "\r\n")
        } else {
            changed.clone()
        };
        let mut options = OpenOptions::new();
        options.write(true).truncate(true);
        let mut file = dir
            .open_with(&relative, &options)
            .map_err(|error| ExeoraError::tool(error.to_string()))?;
        file.write_all(format!("{bom}{restored}").as_bytes())
            .map_err(|error| ExeoraError::tool(error.to_string()))?;
        let path = relative_string(&relative);
        let diff = TextDiff::from_lines(&base, &changed)
            .unified_diff()
            .header(&path, &path)
            .to_string();
        Ok(json!({ "path": path, "replacements": 1, "diff": diff }))
    })
    .await
    .map_err(join_error)?
}

#[derive(Deserialize)]
struct WriteArgs {
    path: String,
    content: String,
}

pub async fn write_file(root: &Path, args: Value) -> Result<Value, ExeoraError> {
    let root = root.to_owned();
    tokio::task::spawn_blocking(move || {
        let args: WriteArgs = parse(args)?;
        let (real_root, relative) = resolve_in_project(&root, &args.path)?;
        let dir = open_root(&real_root)?;
        let existed = dir.metadata(&relative).is_ok();
        if let Some(parent) = relative.parent() { dir.create_dir_all(parent).map_err(|error| ExeoraError::tool(error.to_string()))?; }
        let mut options = OpenOptions::new();
        options.write(true).create(true).truncate(true);
        let mut file = dir.open_with(&relative, &options)
            .map_err(|error| ExeoraError::tool(error.to_string()))?;
        file.write_all(args.content.as_bytes()).map_err(|error| ExeoraError::tool(error.to_string()))?;
        Ok(json!({ "path": relative_string(&relative), "bytesWritten": args.content.len(), "created": !existed }))
    }).await.map_err(join_error)?
}

#[derive(Clone)]
struct RegressMatcher(Arc<Regex>);

impl Matcher for RegressMatcher {
    type Captures = NoCaptures;
    type Error = NoError;
    fn find_at(&self, haystack: &[u8], at: usize) -> Result<Option<Match>, NoError> {
        match std::str::from_utf8(haystack) {
            Ok(text) => Ok(self
                .0
                .find_from(text, at)
                .next()
                .map(|found| Match::new(found.start(), found.end()))),
            Err(_) => {
                let text = String::from_utf8_lossy(&haystack[at..]);
                Ok(self.0.find(&text).map(|_| Match::new(at, haystack.len())))
            }
        }
    }
    fn new_captures(&self) -> Result<NoCaptures, NoError> {
        Ok(NoCaptures::new())
    }
}

struct WalkEntry {
    absolute: PathBuf,
    relative: PathBuf,
    directory: bool,
    symlink: bool,
}

fn walk(
    root: &Path,
    start: &Path,
    recursive: bool,
    limit: usize,
) -> Result<Vec<WalkEntry>, ExeoraError> {
    let ignores = load_ignore(root);
    let mut queue = VecDeque::from([root.join(start)]);
    let mut output = Vec::new();
    while let Some(directory) = queue.pop_front() {
        let Ok(entries) = fs::read_dir(&directory) else {
            continue;
        };
        for result in entries {
            if output.len() >= limit {
                return Ok(output);
            }
            let Ok(entry) = result else {
                continue;
            };
            let name = entry.file_name();
            if ALWAYS_SKIP.iter().any(|skip| name == *skip) {
                continue;
            }
            let absolute = entry.path();
            let relative = absolute
                .strip_prefix(root)
                .unwrap_or(&absolute)
                .to_path_buf();
            let Ok(kind) = entry.file_type() else {
                continue;
            };
            let directory_entry = kind.is_dir();
            if ignores
                .matched_path_or_any_parents(&relative, directory_entry)
                .is_ignore()
            {
                continue;
            }
            output.push(WalkEntry {
                absolute: absolute.clone(),
                relative,
                directory: directory_entry,
                symlink: kind.is_symlink(),
            });
            if recursive && directory_entry && !kind.is_symlink() {
                queue.push_back(absolute);
            }
        }
    }
    Ok(output)
}

fn load_ignore(root: &Path) -> Gitignore {
    let mut builder = GitignoreBuilder::new(root);
    let _ = builder.add(root.join(".gitignore"));
    builder.build().unwrap_or_else(|_| Gitignore::empty())
}

fn search_path(
    matcher: &RegressMatcher,
    entry: &WalkEntry,
    limit: usize,
) -> Result<(Vec<Value>, bool), ExeoraError> {
    let path = relative_string(&entry.relative);
    let mut rows = Vec::new();
    let mut exceeded = false;
    let sink = sinks::Bytes(|line_number: u64, bytes: &[u8]| {
        if rows.len() >= limit {
            exceeded = true;
            return Ok(false);
        }
        let bytes = bytes.strip_suffix(b"\n").unwrap_or(bytes);
        let text = String::from_utf8_lossy(bytes);
        rows.push(json!({ "path": path, "line": line_number, "text": utf16_prefix(&text, 500) }));
        Ok(true)
    });
    SearcherBuilder::new()
        .line_number(true)
        .bom_sniffing(false)
        .binary_detection(BinaryDetection::quit(b'\0'))
        .build()
        .search_path(matcher, &entry.absolute, sink)
        .map_err(|error| ExeoraError::tool(error.to_string()))?;
    Ok((rows, exceeded))
}

fn unique_match(
    content: &str,
    old: &str,
    path: &Path,
) -> Result<(String, usize, usize), ExeoraError> {
    let finder = memmem::Finder::new(old);
    let hits: Vec<usize> = finder.find_iter(content.as_bytes()).take(2).collect();
    if hits.len() == 1 {
        return Ok((content.to_owned(), hits[0], old.len()));
    }
    let fuzzy_content: String = content
        .nfkc()
        .collect::<String>()
        .lines()
        .map(str::trim_end)
        .collect::<Vec<_>>()
        .join("\n");
    let fuzzy_old: String = old
        .nfkc()
        .collect::<String>()
        .lines()
        .map(str::trim_end)
        .collect::<Vec<_>>()
        .join("\n");
    let fuzzy_hits: Vec<usize> = memmem::Finder::new(&fuzzy_old)
        .find_iter(fuzzy_content.as_bytes())
        .take(2)
        .collect();
    match fuzzy_hits.as_slice() {
        [index] => Ok((fuzzy_content, *index, fuzzy_old.len())),
        [] => Err(ExeoraError::tool(format!(
            "Could not find the requested text in {}.",
            relative_string(path)
        ))),
        _ => Err(ExeoraError::tool(format!(
            "The requested text appears more than once in {}. Include surrounding lines to make it unique.",
            relative_string(path)
        ))),
    }
}

fn truncate_complete_lines(text: &str, max: usize) -> (String, bool) {
    if text.len() <= max {
        return (text.to_owned(), false);
    }
    let mut end = 0;
    for (index, line) in text.split('\n').enumerate() {
        let cost = line.len() + usize::from(index > 0);
        if end + cost > max {
            break;
        }
        end += cost;
    }
    (text[..end].to_owned(), true)
}

fn utf16_prefix(text: &str, max: usize) -> String {
    let mut units = 0;
    text.chars()
        .take_while(|ch| {
            let next = units + ch.len_utf16();
            if next > max {
                false
            } else {
                units = next;
                true
            }
        })
        .collect()
}
fn compile_glob(pattern: Option<&str>) -> Result<Option<GlobMatcher>, ExeoraError> {
    pattern
        .map(|value| {
            Glob::new(value)
                .map(|glob| glob.compile_matcher())
                .map_err(|error| ExeoraError::new(ErrorCode::InvalidArguments, error.to_string()))
        })
        .transpose()
}
fn open_root(root: &Path) -> Result<Dir, ExeoraError> {
    Dir::open_ambient_dir(root, ambient_authority())
        .map_err(|error| ExeoraError::tool(error.to_string()))
}
fn parse<T: for<'de> Deserialize<'de>>(value: Value) -> Result<T, ExeoraError> {
    serde_json::from_value(value)
        .map_err(|error| ExeoraError::new(ErrorCode::InvalidArguments, error.to_string()))
}
fn join_error(error: tokio::task::JoinError) -> ExeoraError {
    ExeoraError::tool(error.to_string())
}
