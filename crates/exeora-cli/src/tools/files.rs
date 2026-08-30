use super::path::{relative_string, resolve_in_project};
use crate::{
    error::{ErrorCode, ExeoraError},
    protocol::{MAX_GREP_MATCHES, MAX_LIST_ENTRIES, MAX_READ_BYTES},
};
use aho_corasick::{AhoCorasick, AhoCorasickKind, Input, MatchKind};
use cap_std::{
    ambient_authority,
    fs::{Dir, OpenOptions},
};
use globset::{Glob, GlobMatcher};
use grep_matcher::{Match, Matcher, NoCaptures, NoError};
use grep_searcher::{BinaryDetection, Searcher, SearcherBuilder, sinks};
use ignore::gitignore::{Gitignore, GitignoreBuilder};
use memchr::{memchr, memmem};
use regex_syntax::{
    ParserBuilder,
    hir::literal::{ExtractKind, Extractor, Literal},
};
use regress::Regex;
use serde::Deserialize;
use serde_json::{Value, json};
use similar::TextDiff;
use std::{
    collections::VecDeque,
    fs,
    io::{Cursor, Read, Write},
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
        let mut file = dir.open(&relative).map_err(|error| {
            ExeoraError::tool(format!(
                "Could not read {}: {:?}.",
                relative_string(&relative),
                error.kind()
            ))
        })?;
        let size = file
            .metadata()
            .map(|metadata| metadata.len())
            .unwrap_or_default();
        let mut prefix = [0u8; 8192];
        let prefix_len = file
            .read(&mut prefix)
            .map_err(|error| ExeoraError::tool(error.to_string()))?;
        if memchr(0, &prefix[..prefix_len]).is_some() {
            return Err(ExeoraError::tool(format!(
                "{} is a binary file ({size} bytes). read_file only returns text.",
                relative_string(&relative)
            )));
        }
        let offset = args.offset.unwrap_or(1);
        if offset == 0 {
            return Err(ExeoraError::new(
                ErrorCode::InvalidArguments,
                "offset must be at least 1.",
            ));
        }
        let start = offset - 1;
        let window = scan_text_window(
            Cursor::new(&prefix[..prefix_len]).chain(file),
            start,
            args.limit,
            MAX_READ_BYTES,
        )
        .map_err(|error| ExeoraError::tool(error.to_string()))?;
        if start > 0 && start >= window.total_lines {
            return Err(ExeoraError::tool(format!(
                "Offset {offset} is past the end of {}, which has {} lines.",
                relative_string(&relative),
                window.total_lines
            )));
        }
        let requested_end = args
            .limit
            .map_or(usize::MAX, |limit| start.saturating_add(limit));
        Ok(json!({
            "path": relative_string(&relative),
            "content": window.content,
            "truncated": window.byte_limit_reached || requested_end < window.total_lines,
            "totalLines": window.total_lines,
        }))
    })
    .await
    .map_err(join_error)?
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
        let matcher = RegressMatcher::new(&args.pattern, args.case_insensitive.unwrap_or(false))?;
        let glob = compile_glob(args.glob.as_deref())?;
        let limit = args.max_results.unwrap_or(MAX_GREP_MATCHES);
        let mut rows = Vec::new();
        let mut truncated = false;
        // One searcher for the whole walk: it owns the line buffer, and a repo
        // is thousands of files to build and throw one away for.
        let mut searcher = SearcherBuilder::new()
            .line_number(true)
            .bom_sniffing(false)
            .binary_detection(BinaryDetection::quit(b'\0'))
            .build();
        for entry in walk(&real_root, &start, true, 50_000)? {
            if entry.directory
                || entry.symlink
                || glob
                    .as_ref()
                    .is_some_and(|glob| !glob.is_match(&entry.relative))
            {
                continue;
            }

            let Ok((file_rows, exceeded)) =
                search_path(&mut searcher, &matcher, &entry, limit - rows.len())
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
        let replaced = replace_unique(&raw, &args.old_string, &args.new_string, &relative)?;
        let mut options = OpenOptions::new();
        options.write(true).truncate(true);
        let mut file = dir
            .open_with(&relative, &options)
            .map_err(|error| ExeoraError::tool(error.to_string()))?;
        file.write_all(replaced.written.as_bytes())
            .map_err(|error| ExeoraError::tool(error.to_string()))?;
        let path = relative_string(&relative);
        Ok(json!({ "path": path, "replacements": 1, "diff": replaced.diff }))
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

/**
 * The JavaScript regex the contract promises, with something to skip on.
 *
 * `regress` matches what a browser would, which is the whole reason it is here,
 * but it is a backtracking engine with no literal prefilter: a pattern with no
 * anchor is attempted at every byte of every line. `prefilter` holds the set of
 * literals a match has to start with, when that can be proven, so a buffer with
 * none of them is skipped in one SIMD pass instead of being walked.
 */
#[derive(Clone)]
struct RegressMatcher {
    regex: Arc<Regex>,
    prefilter: Option<Arc<Prefilter>>,
}

/**
 * One required literal, or a set of them.
 *
 * The split is about what it costs to build, not to search. A grep call
 * compiles its prefilter and throws it away, and an Aho-Corasick automaton for
 * a single needle costs more to construct than the scan it saves; `memmem`
 * builds in the length of the needle.
 */
enum Prefilter {
    /// Boxed: a `Finder` carries its shift table, and the enum is behind an
    /// `Arc` cloned into every search anyway.
    Single(Box<memmem::Finder<'static>>),
    Set(AhoCorasick),
}

impl Prefilter {
    fn find(&self, haystack: &[u8], at: usize) -> Option<usize> {
        match self {
            Self::Single(finder) => finder.find(&haystack[at..]).map(|start| at + start),
            Self::Set(set) => set
                .find(Input::new(haystack).span(at..haystack.len()))
                .map(|found| found.start()),
        }
    }
}

impl RegressMatcher {
    fn new(pattern: &str, case_insensitive: bool) -> Result<Self, ExeoraError> {
        let flags = if case_insensitive { "i" } else { "" };
        let regex = Regex::with_flags(pattern, flags).map_err(|error| {
            ExeoraError::new(
                ErrorCode::InvalidArguments,
                format!("Not a valid regular expression: {error}"),
            )
        })?;
        Ok(Self {
            regex: Arc::new(regex),
            prefilter: prefilter(pattern, case_insensitive).map(Arc::new),
        })
    }

    /// Where the next match could begin, or `None` when there cannot be one.
    fn candidate(&self, text: &str, at: usize) -> Option<usize> {
        let Some(prefilter) = &self.prefilter else {
            return Some(at);
        };
        // A literal is valid UTF-8, so its first byte is never a continuation
        // byte, so a hit is always on a character boundary of the haystack.
        prefilter.find(text.as_bytes(), at)
    }
}

impl Matcher for RegressMatcher {
    type Captures = NoCaptures;
    type Error = NoError;
    fn find_at(&self, haystack: &[u8], at: usize) -> Result<Option<Match>, NoError> {
        match std::str::from_utf8(haystack) {
            Ok(text) => {
                let Some(from) = self.candidate(text, at) else {
                    return Ok(None);
                };
                Ok(self
                    .regex
                    .find_from(text, from)
                    .next()
                    .map(|found| Match::new(found.start(), found.end())))
            }
            Err(_) => {
                let text = String::from_utf8_lossy(&haystack[at..]);
                Ok(self
                    .regex
                    .find(&text)
                    .map(|_| Match::new(at, haystack.len())))
            }
        }
    }
    fn new_captures(&self) -> Result<NoCaptures, NoError> {
        Ok(NoCaptures::new())
    }
}

/**
 * Literals every match has to begin with, when `regex-syntax` can prove a set.
 *
 * This never changes what matches, only what is skipped, which rests on the set
 * being an over-approximation of the JavaScript one. Where the two engines read
 * a pattern differently, Rust reads it wider: `\d` is every Unicode digit
 * rather than `[0-9]`, `\w` and `.` likewise. The one exception is `\s`, which
 * in JavaScript also covers U+FEFF; `limit_class` is pinned below the 25
 * characters of Unicode `White_Space`, so a pattern starting with `\s` is
 * declined here rather than prefiltered against a set missing a character.
 *
 * Everything unparseable is declined the same way: JavaScript lookbehind and
 * backreferences do not parse at all, and an unbounded prefix yields no
 * literals. Both leave `regress` searching every buffer, as it did before.
 */
fn prefilter(pattern: &str, case_insensitive: bool) -> Option<Prefilter> {
    if !escapes_agree(pattern) {
        return None;
    }
    let hir = ParserBuilder::new().build().parse(pattern).ok()?;
    let sequence = Extractor::new()
        .kind(ExtractKind::Prefix)
        .limit_class(10)
        .extract(&hir);
    let literals = sequence.literals()?;
    if literals.is_empty() || literals.iter().any(|literal| literal.is_empty()) {
        return None;
    }
    // Without the `u` flag, JavaScript never folds a non-ASCII character onto an
    // ASCII one, so ASCII-insensitive matching is exact for an ASCII literal and
    // the only case to decline is a literal that is not.
    if case_insensitive && !literals.iter().all(|literal| literal.as_bytes().is_ascii()) {
        return None;
    }

    if let ([literal], false) = (literals, case_insensitive) {
        return Some(Prefilter::Single(Box::new(
            memmem::Finder::new(literal.as_bytes()).into_owned(),
        )));
    }
    AhoCorasick::builder()
        .match_kind(MatchKind::LeftmostFirst)
        // Building a DFA costs more than the scan it saves for a filter that
        // lives exactly as long as one call.
        .kind(Some(AhoCorasickKind::ContiguousNFA))
        .ascii_case_insensitive(case_insensitive)
        .build(literals.iter().map(Literal::as_bytes))
        .ok()
        .map(Prefilter::Set)
}

/**
 * Whether every escape in the pattern means the same to both parsers.
 *
 * The over-approximation the prefilter rests on only holds where the Rust
 * parse reads a construct the same way or wider. Escapes are where it does
 * neither: without the `u` flag JavaScript reads `\a`, `\A`, `\z`, `\<` and
 * `\>` as the character itself, while `regex-syntax` reads them as a bell, two
 * anchors and two word boundaries. The prefix extracted from the Rust parse is
 * then a literal the JavaScript pattern never requires, and grep answers
 * nothing at all for `\<div`. The braced `\u{...}`, `\x{...}` and `\b{...}`
 * diverge the same way.
 *
 * Only the escapes that agree are allowed through. `\d`, `\w`, `\s` and their
 * negations stay because Rust reads them as Unicode classes far too large for
 * `limit_class`, which declines them before they can narrow anything.
 */
fn escapes_agree(pattern: &str) -> bool {
    let bytes = pattern.as_bytes();
    let mut index = 0;

    while let Some(offset) = memchr(b'\\', &bytes[index..]) {
        let escape = index + offset + 1;
        let Some(&character) = bytes.get(escape) else {
            return false;
        };
        let braced = bytes.get(escape + 1) == Some(&b'{');
        let agrees = match character {
            b'd' | b'D' | b'w' | b'W' | b's' | b'S' | b'n' | b'r' | b't' | b'f' | b'v' | b'B' => {
                true
            }
            b'b' | b'u' | b'x' => !braced,
            b'<' | b'>' => false,
            // Escaping punctuation is the character itself on both sides; a
            // letter or a digit is a construct one of them has and the other
            // reads as the letter, and a digit is a backreference besides.
            _ => !character.is_ascii_alphanumeric(),
        };
        if !agrees {
            return false;
        }
        index = escape + 1;
    }
    true
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
    searcher: &mut Searcher,
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
    searcher
        .search_path(matcher, &entry.absolute, sink)
        .map_err(|error| ExeoraError::tool(error.to_string()))?;
    Ok((rows, exceeded))
}

pub(crate) struct Replaced {
    pub written: String,
    pub diff: String,
}

/// Unique byte-for-byte replacement. No NFKC, no trimming, no newline rewriting.
pub(crate) fn replace_exact(
    raw: &str,
    old_string: &str,
    new_string: &str,
    path: &Path,
) -> Result<Replaced, ExeoraError> {
    let finder = memmem::Finder::new(old_string);
    let hits: Vec<usize> = finder.find_iter(raw.as_bytes()).take(2).collect();
    match hits.as_slice() {
        [index] => {
            let mut written =
                String::with_capacity(raw.len() - old_string.len() + new_string.len());
            written.push_str(&raw[..*index]);
            written.push_str(new_string);
            written.push_str(&raw[index + old_string.len()..]);
            let display = relative_string(path);
            let diff = TextDiff::from_lines(raw, &written)
                .unified_diff()
                .header(&display, &display)
                .to_string();
            Ok(Replaced { written, diff })
        }
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

/// Unique text replacement, preserving BOM and CRLF the way `edit_file` does.
pub(crate) fn replace_unique(
    raw: &str,
    old_string: &str,
    new_string: &str,
    path: &Path,
) -> Result<Replaced, ExeoraError> {
    let (bom, content) = raw
        .strip_prefix('\u{feff}')
        .map_or(("", raw), |text| ("\u{feff}", text));
    let crlf = content
        .find("\r\n")
        .is_some_and(|crlf| content.find('\n') == Some(crlf + 1));
    let normalized = content.replace("\r\n", "\n").replace('\r', "\n");
    let old = old_string.replace("\r\n", "\n").replace('\r', "\n");
    let (base, index, length) = unique_match(&normalized, &old, path)?;
    let mut changed = base.clone();
    changed.replace_range(index..index + length, new_string);
    let restored = if crlf {
        changed.replace('\n', "\r\n")
    } else {
        changed.clone()
    };
    let display = relative_string(path);
    let diff = TextDiff::from_lines(&base, &changed)
        .unified_diff()
        .header(&display, &display)
        .to_string();
    Ok(Replaced {
        written: format!("{bom}{restored}"),
        diff,
    })
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

struct TextWindow {
    content: String,
    total_lines: usize,
    byte_limit_reached: bool,
}

/// Scans the entire file to preserve an exact line count while retaining only
/// the requested, bounded window in memory.
fn scan_text_window(
    mut reader: impl Read,
    start: usize,
    limit: Option<usize>,
    max_bytes: usize,
) -> std::io::Result<TextWindow> {
    let end = limit.map_or(usize::MAX, |limit| start.saturating_add(limit));
    let mut buffer = [0u8; 8192];
    let mut selected = Vec::with_capacity(max_bytes.min(8192));
    let mut line = 0usize;
    let mut bytes_read = 0usize;
    let mut newline_count = 0usize;
    let mut ended_with_newline = false;
    let mut byte_limit_reached = false;

    loop {
        let count = reader.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        for &byte in &buffer[..count] {
            bytes_read += 1;
            if line >= start && line < end && !byte_limit_reached {
                if selected.len() < max_bytes {
                    selected.push(byte);
                } else {
                    byte_limit_reached = true;
                }
            }
            if byte == b'\n' {
                newline_count += 1;
                line += 1;
                ended_with_newline = true;
            } else {
                ended_with_newline = false;
            }
        }
    }

    if byte_limit_reached {
        selected.truncate(memchr::memrchr(b'\n', &selected).unwrap_or(0));
    } else if selected.last() == Some(&b'\n') {
        selected.pop();
    }

    Ok(TextWindow {
        content: String::from_utf8_lossy(&selected).into_owned(),
        total_lines: if bytes_read == 0 {
            0
        } else {
            newline_count + usize::from(!ended_with_newline)
        },
        byte_limit_reached,
    })
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
pub(crate) fn open_root(root: &Path) -> Result<Dir, ExeoraError> {
    Dir::open_ambient_dir(root, ambient_authority())
        .map_err(|error| ExeoraError::tool(error.to_string()))
}
pub(crate) fn parse<T: for<'de> Deserialize<'de>>(value: Value) -> Result<T, ExeoraError> {
    serde_json::from_value(value)
        .map_err(|error| ExeoraError::new(ErrorCode::InvalidArguments, error.to_string()))
}
pub(crate) fn join_error(error: tokio::task::JoinError) -> ExeoraError {
    ExeoraError::tool(error.to_string())
}

#[cfg(test)]
mod tests {
    use super::scan_text_window;
    use std::io::Cursor;

    #[test]
    fn scans_only_the_requested_lines_but_counts_the_whole_file() {
        let window = scan_text_window(Cursor::new(b"one\ntwo\nthree\n"), 1, Some(1), 100)
            .expect("scan succeeds");
        assert_eq!(window.content, "two");
        assert_eq!(window.total_lines, 3);
        assert!(!window.byte_limit_reached);
    }

    #[test]
    fn a_byte_limit_returns_only_complete_lines() {
        let input = format!("short\n{}\nlast", "x".repeat(50));
        let window = scan_text_window(Cursor::new(input), 0, None, 10).expect("scan succeeds");
        assert_eq!(window.content, "short");
        assert_eq!(window.total_lines, 3);
        assert!(window.byte_limit_reached);
    }
}
