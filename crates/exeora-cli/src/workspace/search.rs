//! Search and replace across the checkout, with the same walker the `grep`
//! tool uses and a matcher that knows about words and case.

use super::{
    files::{hex, is_protected, project_path, write_atomically},
    git::{GitWorkspace, invalid},
};
use crate::error::{ErrorCode, ExeoraError};
use grep_matcher::{Captures, Matcher};
use grep_regex::{RegexMatcher, RegexMatcherBuilder};
use grep_searcher::{BinaryDetection, Searcher, SearcherBuilder, Sink, SinkMatch};
use ignore::{WalkBuilder, overrides::OverrideBuilder};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use std::{collections::HashSet, fs, path::Path};
use tokio_util::sync::CancellationToken;

const MAX_FILE_BYTES: u64 = 5_000_000;
const MAX_RESULTS: usize = 2_000;
const MAX_PER_FILE: usize = 100;
const PREVIEW_CHARS: usize = 200;
const PREVIEW_BEFORE: usize = 60;
/// An estimate of the JSON, kept well under the protocol's result limit.
const RESULT_BUDGET: usize = 700_000;
const CANCEL_EVERY: usize = 64;

pub(super) fn handles(name: &str) -> bool {
    matches!(name, "search" | "replace")
}

pub(super) async fn execute(
    git: &GitWorkspace,
    root: &Path,
    action: Value,
    cancel: CancellationToken,
) -> Result<Value, ExeoraError> {
    let name = action.get("action").and_then(Value::as_str).unwrap_or("");
    let root = root.to_owned();
    if name == "search" {
        let args: SearchArgs = parse(action)?;
        return tokio::task::spawn_blocking(move || search(&root, args, &cancel))
            .await
            .map_err(|error| ExeoraError::tool(format!("Search failed: {error}")))?;
    }
    let args: ReplaceArgs = parse(action)?;
    let _guard = git.operation.lock().await;
    tokio::task::spawn_blocking(move || replace(&root, args))
        .await
        .map_err(|error| ExeoraError::tool(format!("Replace failed: {error}")))?
}

fn parse<T: serde::de::DeserializeOwned>(action: Value) -> Result<T, ExeoraError> {
    serde_json::from_value(action).map_err(|error| invalid(format!("Invalid arguments: {error}")))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Query {
    query: String,
    #[serde(default)]
    regex: bool,
    #[serde(default)]
    case_sensitive: bool,
    #[serde(default)]
    whole_word: bool,
}

impl Query {
    fn matcher(&self) -> Result<RegexMatcher, ExeoraError> {
        if self.query.is_empty() {
            return Err(invalid("A query is required."));
        }
        let pattern = if self.regex {
            self.query.clone()
        } else {
            regex_syntax::escape(&self.query)
        };
        RegexMatcherBuilder::new()
            .case_insensitive(!self.case_sensitive)
            .word(self.whole_word)
            .line_terminator(Some(b'\n'))
            .build(&pattern)
            .map_err(|error| invalid(format!("Invalid pattern: {error}")))
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchArgs {
    #[serde(flatten)]
    query: Query,
    include: Option<String>,
    exclude: Option<String>,
    #[serde(default)]
    include_ignored: bool,
    path: Option<String>,
    max_results: Option<usize>,
    max_per_file: Option<usize>,
}

fn globs(list: Option<&str>) -> impl Iterator<Item = &str> {
    list.unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|glob| !glob.is_empty())
}

fn search(root: &Path, args: SearchArgs, cancel: &CancellationToken) -> Result<Value, ExeoraError> {
    let matcher = args.query.matcher()?;
    let start = project_path(root, args.path.as_deref().unwrap_or("."))?;
    let max_results = args.max_results.unwrap_or(500).clamp(1, MAX_RESULTS);
    let max_per_file = args.max_per_file.unwrap_or(50).clamp(1, MAX_PER_FILE);

    let mut overrides = OverrideBuilder::new(&start.root);
    for glob in globs(args.include.as_deref()) {
        overrides
            .add(glob)
            .map_err(|error| invalid(format!("Invalid include pattern '{glob}': {error}")))?;
    }
    for glob in globs(args.exclude.as_deref()) {
        overrides
            .add(&format!("!{glob}"))
            .map_err(|error| invalid(format!("Invalid exclude pattern '{glob}': {error}")))?;
    }
    let overrides = overrides
        .build()
        .map_err(|error| invalid(format!("Invalid patterns: {error}")))?;
    let honour_ignores = !args.include_ignored;
    let mut walker = WalkBuilder::new(&start.absolute);
    walker
        .hidden(false)
        .follow_links(false)
        .git_ignore(honour_ignores)
        .git_global(honour_ignores)
        .git_exclude(honour_ignores)
        .ignore(honour_ignores)
        .max_filesize(Some(MAX_FILE_BYTES))
        .overrides(overrides)
        .sort_by_file_name(|a, b| a.cmp(b))
        .filter_entry(|entry| !is_protected(entry.file_name()));

    let mut searcher = SearcherBuilder::new()
        .line_number(true)
        .multi_line(false)
        .bom_sniffing(false)
        .binary_detection(BinaryDetection::quit(b'\0'))
        .build();
    let mut files = Vec::new();
    let mut total = 0usize;
    let mut searched = 0usize;
    let mut skipped = 0usize;
    let mut truncated = false;
    let mut budget = 0usize;
    for (index, entry) in walker.build().enumerate() {
        if index % CANCEL_EVERY == 0 && cancel.is_cancelled() {
            return Err(ExeoraError::new(ErrorCode::Cancelled, "Search cancelled."));
        }
        let entry = match entry {
            Ok(entry) => entry,
            Err(_) => {
                skipped += 1;
                continue;
            }
        };
        if !entry.file_type().is_some_and(|kind| kind.is_file()) {
            continue;
        }
        let Ok(relative) = entry.path().strip_prefix(&start.root) else {
            continue;
        };
        let relative = crate::tools::path::relative_string(relative);
        let bytes = match fs::read(entry.path()) {
            Ok(bytes) => bytes,
            Err(_) => {
                skipped += 1;
                continue;
            }
        };
        let mut sink = FileSink {
            matcher: &matcher,
            per_file: max_per_file,
            remaining: max_results - total,
            matches: Vec::new(),
            truncated: false,
            overflow: false,
            binary: false,
            bytes: relative.len() + 120,
        };
        if searcher.search_slice(&matcher, &bytes, &mut sink).is_err() || sink.binary {
            skipped += 1;
            continue;
        }
        searched += 1;
        if !sink.matches.is_empty() {
            total += sink.matches.len();
            budget += sink.bytes;
            files.push(json!({
                "path": relative,
                "token": hex(&Sha256::digest(&bytes)),
                "matches": sink.matches,
                "truncated": sink.truncated || sink.overflow,
            }));
        }
        // A match past the cap, or a result too large to send: what is here
        // is answered, marked as not the whole of it.
        if sink.overflow || budget > RESULT_BUDGET {
            truncated = true;
            break;
        }
    }
    Ok(json!({
        "kind": "search",
        "files": files,
        "totalMatches": total,
        "truncated": truncated,
        "filesSearched": searched,
        "filesSkipped": skipped,
    }))
}

struct FileSink<'a> {
    matcher: &'a RegexMatcher,
    per_file: usize,
    /// What the whole search may still add; zero means one more match is
    /// one too many, and is what makes the result truncated.
    remaining: usize,
    matches: Vec<Value>,
    truncated: bool,
    overflow: bool,
    binary: bool,
    bytes: usize,
}

impl Sink for FileSink<'_> {
    type Error = std::io::Error;

    fn matched(&mut self, _: &Searcher, mat: &SinkMatch<'_>) -> Result<bool, Self::Error> {
        let line = line_body(mat.bytes());
        let number = mat.line_number().unwrap_or(0);
        let mut ranges = Vec::new();
        let _ = self.matcher.find_iter(line, |found| {
            if found.end() > found.start() {
                ranges.push((found.start(), found.end()));
            }
            true
        });
        for (start, end) in ranges {
            if self.remaining == 0 {
                self.overflow = true;
                return Ok(false);
            }
            if self.matches.len() >= self.per_file {
                self.truncated = true;
                return Ok(false);
            }
            let (column, length, preview, offset) = preview(line, start, end);
            self.bytes += preview.len() + 80;
            self.matches.push(json!({
                "line": number,
                "column": column,
                "length": length,
                "preview": preview,
                "previewOffset": offset,
            }));
            self.remaining -= 1;
        }
        Ok(true)
    }

    fn binary_data(&mut self, _: &Searcher, _: u64) -> Result<bool, Self::Error> {
        self.binary = true;
        Ok(false)
    }
}

fn line_body(line: &[u8]) -> &[u8] {
    let line = line.strip_suffix(b"\n").unwrap_or(line);
    line.strip_suffix(b"\r").unwrap_or(line)
}

/// Where a match is in characters, and a window of the line around it:
/// the whole line when it is short, else up to 200 characters that start a
/// little before the match. Leading whitespace is left out of the window.
fn preview(line: &[u8], start: usize, end: usize) -> (usize, usize, String, usize) {
    let before = String::from_utf8_lossy(&line[..start]).chars().count();
    let length = String::from_utf8_lossy(&line[start..end]).chars().count();
    let chars = String::from_utf8_lossy(line).chars().collect::<Vec<_>>();
    let total = chars.len();
    let leading = chars
        .iter()
        .take_while(|c| c.is_whitespace())
        .count()
        .min(before);
    let (window_start, window_len) = if total - leading <= PREVIEW_CHARS {
        (leading, total - leading)
    } else {
        let latest = total - PREVIEW_CHARS;
        (
            before.saturating_sub(PREVIEW_BEFORE).clamp(leading, latest),
            PREVIEW_CHARS,
        )
    };
    let text = chars[window_start..window_start + window_len]
        .iter()
        .collect::<String>();
    (before + 1, length, text, before - window_start)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReplaceArgs {
    #[serde(flatten)]
    query: Query,
    replacement: String,
    #[serde(default)]
    preserve_case: bool,
    targets: Vec<Target>,
}

#[derive(Deserialize)]
struct Target {
    path: String,
    token: String,
    lines: Option<Vec<usize>>,
}

fn replace(root: &Path, args: ReplaceArgs) -> Result<Value, ExeoraError> {
    if args.targets.is_empty() || args.targets.len() > 500 {
        return Err(invalid("Between 1 and 500 targets are required."));
    }
    let matcher = args.query.matcher()?;
    // Only a regex reads `$1` in the replacement; a literal one means a dollar.
    let replacement = if args.query.regex {
        args.replacement.clone()
    } else {
        args.replacement.replace('$', "$$")
    };
    let mut files = Vec::new();
    let mut replaced = 0usize;
    let mut skipped = 0usize;
    for target in &args.targets {
        let located = project_path(root, &target.path)?;
        let bytes = match fs::read(&located.absolute) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                skipped += 1;
                files.push(json!({ "path": located.relative, "replaced": 0, "status": "missing" }));
                continue;
            }
            Err(error) => {
                return Err(ExeoraError::tool(format!(
                    "Could not read '{}': {error}",
                    target.path
                )));
            }
        };
        if hex(&Sha256::digest(&bytes)) != target.token {
            skipped += 1;
            files.push(json!({ "path": located.relative, "replaced": 0, "status": "conflict" }));
            continue;
        }
        let lines = target
            .lines
            .as_ref()
            .map(|lines| lines.iter().copied().collect::<HashSet<_>>());
        let (written, count) = replace_in(
            &bytes,
            &matcher,
            replacement.as_bytes(),
            lines.as_ref(),
            args.preserve_case,
        )?;
        if count == 0 {
            files.push(json!({ "path": located.relative, "replaced": 0, "status": "skipped" }));
            continue;
        }
        write_atomically(&located.absolute, &written, &target.path)?;
        replaced += count;
        files.push(json!({ "path": located.relative, "replaced": count, "status": "ok" }));
    }
    Ok(json!({ "kind": "replace", "files": files, "replaced": replaced, "skipped": skipped }))
}

fn replace_in(
    bytes: &[u8],
    matcher: &RegexMatcher,
    replacement: &[u8],
    lines: Option<&HashSet<usize>>,
    preserve_case: bool,
) -> Result<(Vec<u8>, usize), ExeoraError> {
    let mut captures = matcher
        .new_captures()
        .map_err(|error| invalid(format!("Invalid pattern: {error}")))?;
    let mut out = Vec::with_capacity(bytes.len());
    let mut count = 0usize;
    for (index, line) in bytes.split_inclusive(|byte| *byte == b'\n').enumerate() {
        if lines.is_some_and(|wanted| !wanted.contains(&(index + 1))) {
            out.extend_from_slice(line);
            continue;
        }
        let body = line_body(line);
        let ending = &line[body.len()..];
        let mut last = 0;
        matcher
            .captures_iter(body, &mut captures, |found| {
                let Some(whole) = found.get(0) else {
                    return true;
                };
                if whole.end() == whole.start() {
                    return true;
                }
                out.extend_from_slice(&body[last..whole.start()]);
                let mut text = Vec::new();
                found.interpolate(
                    |name| matcher.capture_index(name),
                    body,
                    replacement,
                    &mut text,
                );
                if preserve_case {
                    text = with_case_of(&body[whole.start()..whole.end()], text);
                }
                out.extend_from_slice(&text);
                last = whole.end();
                count += 1;
                true
            })
            .map_err(|error| invalid(format!("Invalid pattern: {error}")))?;
        out.extend_from_slice(&body[last..]);
        out.extend_from_slice(ending);
    }
    Ok((out, count))
}

/// The replacement in the shape of what it replaces: all caps stays all
/// caps, a capital first letter stays a capital, anything else is as given.
fn with_case_of(matched: &[u8], replacement: Vec<u8>) -> Vec<u8> {
    let matched = String::from_utf8_lossy(matched);
    let letters = matched
        .chars()
        .filter(|c| c.is_alphabetic())
        .collect::<Vec<_>>();
    let Some(first) = letters.first() else {
        return replacement;
    };
    let text = String::from_utf8_lossy(&replacement);
    if letters.len() > 1 && letters.iter().all(|c| c.is_uppercase()) {
        return text.to_uppercase().into_bytes();
    }
    if first.is_uppercase() && letters[1..].iter().all(|c| c.is_lowercase()) {
        let mut chars = text.chars();
        return match chars.next() {
            Some(initial) => {
                let mut capitalized = initial.to_uppercase().collect::<String>();
                capitalized.push_str(chars.as_str());
                capitalized.into_bytes()
            }
            None => replacement,
        };
    }
    replacement
}

#[cfg(test)]
mod tests {
    use super::{Query, preview, replace_in, with_case_of};

    #[test]
    fn previews_a_window_around_a_match_on_a_long_line() {
        let line = format!("{}needle{}", "x".repeat(300), "y".repeat(300));
        let (column, length, text, offset) = preview(line.as_bytes(), 300, 306);
        assert_eq!((column, length), (301, 6));
        assert_eq!(text.len(), 200);
        assert_eq!(&text[offset..offset + 6], "needle");

        let (column, _, text, offset) = preview("   short line".as_bytes(), 9, 13);
        assert_eq!(column, 10);
        assert_eq!(text, "short line");
        assert_eq!(offset, 6);
    }

    #[test]
    fn keeps_the_case_of_what_it_replaces() {
        assert_eq!(with_case_of(b"HELLO", b"world".to_vec()), b"WORLD");
        assert_eq!(with_case_of(b"Hello", b"world".to_vec()), b"World");
        assert_eq!(with_case_of(b"hello", b"World".to_vec()), b"World");
        assert_eq!(with_case_of(b"123", b"x".to_vec()), b"x");
    }

    #[test]
    fn replaces_on_chosen_lines_only_and_interpolates_captures() {
        let query = Query {
            query: "a".to_owned(),
            regex: false,
            case_sensitive: true,
            whole_word: false,
        };
        let matcher = query.matcher().unwrap();
        let lines = [2].into_iter().collect();
        let (out, count) = replace_in(b"a\na\r\na\n", &matcher, b"b", Some(&lines), false).unwrap();
        assert_eq!((out.as_slice(), count), (b"a\nb\r\na\n".as_slice(), 1));

        let regex = Query {
            query: r"(\w+)-(\w+)".to_owned(),
            regex: true,
            case_sensitive: true,
            whole_word: false,
        };
        let matcher = regex.matcher().unwrap();
        let (out, count) = replace_in(b"a-b c-d", &matcher, b"$2-$1", None, false).unwrap();
        assert_eq!((out.as_slice(), count), (b"b-a d-c".as_slice(), 2));
    }
}
