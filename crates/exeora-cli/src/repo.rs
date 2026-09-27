//! What makes a project one project: its repository.
//!
//! The same repository is written many ways, `git@github.com:acme/api.git` on
//! one machine and `https://github.com/acme/api` on another, and a project
//! that lives on both has to recognise itself. This is the Rust side of
//! `packages/protocol/src/repository.ts`, and it has to give the same answer
//! as the gateway for every input: a key that differed by one character would
//! make this machine clone a repository it already holds. The patterns are
//! the TypeScript ones, run by an engine that reads them the way a browser
//! does, rather than a translation that could drift.

use regress::Regex;
use std::{
    path::Path,
    process::{Command, Stdio},
    sync::LazyLock,
};

static SCP_LIKE: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::new(r"^(?:[^@/\s]+@)?([^:/\s]+):(?!\/)(.+)$").ok());
static WITH_SCHEME: LazyLock<Option<Regex>> = LazyLock::new(|| {
    Regex::with_flags(
        r"^([a-z][a-z0-9+.-]*):\/\/(?:[^@/?#]*@)?([^/:?#]+)(?::\d+)?(\/[^?#]*)?(?:[?#].*)?$",
        "i",
    )
    .ok()
});
static ANY_SCHEME: LazyLock<Option<Regex>> =
    LazyLock::new(|| Regex::with_flags(r"^[a-z][a-z0-9+.-]*:\/\/", "i").ok());
const SCHEMES: [&str; 5] = ["https", "http", "ssh", "git", "git+ssh"];

struct Parts {
    host: String,
    /// As written, without the slashes around it or a trailing `.git`.
    path: String,
}

/// What JavaScript calls white space, which is not quite what Rust does.
fn is_js_whitespace(character: char) -> bool {
    matches!(
        character,
        '\u{0009}'..='\u{000D}'
            | '\u{0020}'
            | '\u{00A0}'
            | '\u{1680}'
            | '\u{2000}'..='\u{200A}'
            | '\u{2028}'
            | '\u{2029}'
            | '\u{202F}'
            | '\u{205F}'
            | '\u{3000}'
            | '\u{FEFF}'
    )
}

/// `decodeURIComponent`, including what it does with input it cannot read:
/// the caller keeps the text as it was.
fn decoded(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut output = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] != b'%' {
            output.push(bytes[index]);
            index += 1;
            continue;
        }
        let byte = bytes
            .get(index + 1..index + 3)
            .and_then(|pair| std::str::from_utf8(pair).ok())
            .filter(|pair| pair.bytes().all(|digit| digit.is_ascii_hexdigit()))
            .and_then(|pair| u8::from_str_radix(pair, 16).ok());
        match byte {
            Some(byte) => output.push(byte),
            None => return value.to_owned(),
        }
        index += 3;
    }
    String::from_utf8(output).unwrap_or_else(|_| value.to_owned())
}

fn strip_git_suffix(path: &str) -> &str {
    let length = path.len();
    if length >= 4
        && path.is_char_boundary(length - 4)
        && path[length - 4..].eq_ignore_ascii_case(".git")
    {
        &path[..length - 4]
    } else {
        path
    }
}

fn parts(url: &str) -> Option<Parts> {
    let text = url.trim_matches(is_js_whitespace);
    if text.is_empty() {
        return None;
    }

    let (host, raw) = if let Some(schemed) = WITH_SCHEME.as_ref()?.find(text) {
        let scheme = schemed.group(1).map(|range| text[range].to_lowercase())?;
        if !SCHEMES.contains(&scheme.as_str()) {
            return None;
        }
        (
            schemed.group(2).map_or("", |range| &text[range]).to_owned(),
            decoded(schemed.group(3).map_or("", |range| &text[range])),
        )
    } else {
        if ANY_SCHEME.as_ref()?.find(text).is_some() {
            return None;
        }
        let scp = SCP_LIKE.as_ref()?.find(text)?;
        let host = &text[scp.group(1)?];
        let raw = &text[scp.group(2)?];
        // A drive letter reads like a host, and a path is not a repository on one.
        if raw.is_empty() || host.encode_utf16().count() < 2 {
            return None;
        }
        (host.to_owned(), raw.to_owned())
    };

    let path = strip_git_suffix(raw.trim_matches('/')).trim_end_matches('/');
    let lowered = host.to_lowercase();
    let place = lowered.strip_prefix("www.").unwrap_or(&lowered);
    if place.is_empty() || path.is_empty() || path.contains("..") || path.contains(is_js_whitespace)
    {
        return None;
    }
    Some(Parts {
        host: place.to_owned(),
        path: path.to_owned(),
    })
}

/// `host/owner/name`, lowercased, with no scheme, user, port or `.git`.
///
/// None for anything that does not name a repository on a host: a local path,
/// a `file://` URL, an empty string. Those stay what they are today, a
/// directory on one machine.
pub fn repository_key(url: &str) -> Option<String> {
    parts(url).map(|found| format!("{}/{}", found.host, found.path.to_lowercase()))
}

/// The https address of a repository, which is the form the gateway stores.
/// The path keeps the case it was written in: hosts that care are rare, and
/// one that does would refuse the lowercased form.
pub fn https_repository_url(url: &str) -> Option<String> {
    parts(url).map(|found| format!("https://{}/{}.git", found.host, found.path))
}

/// The ssh address of the same repository, for a machine whose git speaks ssh.
pub fn ssh_repository_url(url: &str) -> Option<String> {
    parts(url).map(|found| format!("git@{}:{}.git", found.host, found.path))
}

/// The host a repository is on, which is what git scopes a credential by.
pub fn repository_host(url: &str) -> Option<String> {
    parts(url).map(|found| found.host)
}

/// The last segment of the path, which is what a clone would call its folder.
pub fn repository_name(url: &str) -> Option<String> {
    parts(url).and_then(|found| found.path.rsplit('/').next().map(str::to_owned))
}

/// Reads one answer from git about a directory, or nothing when git has none.
/// Never waits for a person: these run from commands that may have no terminal.
fn git_line(path: &Path, args: &[&str]) -> Option<String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(path)
        .args(args)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_OPTIONAL_LOCKS", "0")
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8(output.stdout).ok()?;
    let line = text.lines().next()?.trim();
    (!line.is_empty()).then(|| line.to_owned())
}

/// Where the checkout at `path` came from: its `origin`, or the first remote
/// of a checkout that calls it something else.
pub fn origin_of(path: &Path) -> Option<String> {
    git_line(path, &["remote", "get-url", "origin"]).or_else(|| {
        let first = git_line(path, &["remote"])?;
        git_line(path, &["remote", "get-url", &first])
    })
}

/// The branch the remote calls its default, as the checkout last heard it.
pub fn default_branch_of(path: &Path) -> Option<String> {
    let head = git_line(
        path,
        &["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
    )?;
    let branch = head.strip_prefix("origin/").unwrap_or(&head);
    (!branch.is_empty()).then(|| branch.to_owned())
}

/// The top of the checkout `path` is in, when it is in one.
pub fn checkout_root(path: &Path) -> Option<std::path::PathBuf> {
    git_line(path, &["rev-parse", "--show-toplevel"]).map(std::path::PathBuf::from)
}

#[cfg(test)]
mod tests {
    use super::{
        default_branch_of, https_repository_url, origin_of, repository_host, repository_key,
        repository_name, ssh_repository_url,
    };
    use std::{collections::HashSet, path::Path, process::Command};
    use tempfile::tempdir;

    // The cases of `packages/protocol/src/repository.test.ts`, one for one.

    #[test]
    fn reduces_every_spelling_of_one_repository_to_the_same_key() {
        let spellings = [
            "https://github.com/Acme/API.git",
            "https://github.com/acme/api",
            "https://github.com/acme/api/",
            "https://user@github.com/acme/api.git",
            "https://www.github.com/acme/api",
            "git@github.com:acme/api.git",
            "git@github.com:Acme/api",
            "ssh://git@github.com/acme/api.git",
            "ssh://git@github.com:22/acme/api.git",
            "git://github.com/acme/api.git",
            "  https://github.com/acme/api.git  ",
        ];
        let keys: HashSet<_> = spellings.iter().map(|url| repository_key(url)).collect();
        assert_eq!(
            keys,
            HashSet::from([Some("github.com/acme/api".to_owned())])
        );
    }

    #[test]
    fn keeps_groups_and_other_hosts_apart() {
        assert_eq!(
            repository_key("https://gitlab.com/group/sub/project.git").as_deref(),
            Some("gitlab.com/group/sub/project")
        );
        assert_eq!(
            repository_key("git@bitbucket.org:team/repo.git").as_deref(),
            Some("bitbucket.org/team/repo")
        );
        assert_ne!(
            repository_key("https://github.com/acme/api"),
            repository_key("https://github.com/acme/api-docs")
        );
    }

    #[test]
    fn is_none_for_what_is_not_a_repository_on_a_host() {
        for value in [
            "",
            "   ",
            "/home/me/code/api",
            "./api",
            "C:\\code\\api",
            "file:///home/me/code/api.git",
            "https://github.com",
            "https://github.com/",
            "not a url",
        ] {
            assert_eq!(repository_key(value), None, "{value:?}");
        }
    }

    #[test]
    fn writes_the_https_and_ssh_forms_of_whatever_it_was_given() {
        assert_eq!(
            https_repository_url("git@github.com:Acme/API.git").as_deref(),
            Some("https://github.com/Acme/API.git")
        );
        assert_eq!(
            https_repository_url("https://github.com/acme/api").as_deref(),
            Some("https://github.com/acme/api.git")
        );
        assert_eq!(
            ssh_repository_url("https://github.com/Acme/API").as_deref(),
            Some("git@github.com:Acme/API.git")
        );
        assert_eq!(ssh_repository_url("/home/me/code"), None);
    }

    // What the TypeScript does at its edges, which a port has to do too.

    #[test]
    fn reads_the_edges_the_way_the_gateway_does() {
        // Percent escapes are read in an address with a scheme, and only there.
        assert_eq!(
            repository_key("https://github.com/acme/my%20api"),
            None,
            "a decoded space is white space in the path"
        );
        assert_eq!(
            repository_key("https://github.com/acme/caf%C3%A9").as_deref(),
            Some("github.com/acme/café")
        );
        assert_eq!(
            repository_key("https://github.com/acme/100%").as_deref(),
            Some("github.com/acme/100%"),
            "an escape that cannot be read leaves the path as written"
        );
        assert_eq!(
            repository_key("git@github.com:acme/a%2Fb").as_deref(),
            Some("github.com/acme/a%2fb")
        );
        // Queries, fragments, ports and the case of the scheme.
        assert_eq!(
            repository_key("HTTPS://GitHub.com:443/Acme/Api.GIT?ref=main#readme").as_deref(),
            Some("github.com/acme/api")
        );
        assert_eq!(repository_key("ftp://github.com/acme/api"), None);
        assert_eq!(repository_key("https://github.com/acme/../api"), None);
        assert_eq!(repository_key("github.com:/acme/api"), None);
        assert_eq!(
            repository_key("github.com:acme/api").as_deref(),
            Some("github.com/acme/api")
        );
        assert_eq!(
            repository_key("https://github.com//acme/api.git//").as_deref(),
            Some("github.com/acme/api")
        );
    }

    /// Answers taken from running the TypeScript on the same inputs.
    #[test]
    fn agrees_with_the_typescript_on_inputs_nobody_should_write() {
        for (input, key) in [
            (
                "\u{FEFF}https://github.com/acme/api",
                Some("github.com/acme/api"),
            ),
            ("\u{0085}https://github.com/acme/api", None),
            (
                "https://github.com/acme/api.git.git",
                Some("github.com/acme/api.git"),
            ),
            (
                "https://github.com/acme/api.git/",
                Some("github.com/acme/api"),
            ),
            ("C:acme/api", None),
            ("ab:acme", Some("ab/acme")),
            ("git@github.com:acme/api.git\n", Some("github.com/acme/api")),
            ("git@github.com:acme/a\nb", None),
            ("https://WWW.www.github.com/x/y", Some("www.github.com/x/y")),
            ("https://github.com/%E0%A4%A", Some("github.com/%e0%a4%a")),
            ("https://github.com/a/%C3", Some("github.com/a/%c3")),
            (
                "https://user:pass@github.com/acme/api",
                Some("github.com/acme/api"),
            ),
            ("ssh://git@github.com:acme/api.git", None),
        ] {
            assert_eq!(repository_key(input).as_deref(), key, "{input:?}");
        }
        assert_eq!(
            https_repository_url("https://user:pass@github.com/acme/api").as_deref(),
            Some("https://github.com/acme/api.git"),
            "what is cloned from never carries what was written before the host"
        );
    }

    #[test]
    fn names_the_host_and_the_folder() {
        assert_eq!(
            repository_host("git@GitHub.com:acme/api.git").as_deref(),
            Some("github.com")
        );
        assert_eq!(
            repository_name("https://gitlab.com/group/sub/Project.git").as_deref(),
            Some("Project")
        );
    }

    fn git(cwd: &Path, args: &[&str]) {
        let status = Command::new("git")
            .arg("-C")
            .arg(cwd)
            .args(args)
            .status()
            .expect("git");
        assert!(status.success(), "git {}", args.join(" "));
    }

    #[test]
    fn reads_the_origin_and_falls_back_to_the_first_remote() {
        let temp = tempdir().expect("temp directory");
        git(temp.path(), &["init", "--quiet"]);
        assert_eq!(origin_of(temp.path()), None);
        assert_eq!(default_branch_of(temp.path()), None);

        git(
            temp.path(),
            &["remote", "add", "upstream", "git@github.com:acme/api.git"],
        );
        assert_eq!(
            origin_of(temp.path()).as_deref(),
            Some("git@github.com:acme/api.git")
        );

        git(
            temp.path(),
            &[
                "remote",
                "add",
                "origin",
                "https://github.com/acme/fork.git",
            ],
        );
        assert_eq!(
            origin_of(temp.path()).as_deref(),
            Some("https://github.com/acme/fork.git")
        );

        git(
            temp.path(),
            &[
                "symbolic-ref",
                "refs/remotes/origin/HEAD",
                "refs/remotes/origin/trunk",
            ],
        );
        assert_eq!(default_branch_of(temp.path()).as_deref(), Some("trunk"));
    }
}
