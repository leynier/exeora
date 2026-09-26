use super::config::ResolvedServer;
use crate::CLI_VERSION;
use anyhow::{Context, Result};
use http::{HeaderName, HeaderValue, header::AUTHORIZATION};
#[cfg(windows)]
use process_wrap::tokio::JobObject;
#[cfg(unix)]
use process_wrap::tokio::ProcessGroup;
use process_wrap::tokio::{CommandWrap, KillOnDrop};
use rmcp::{
    ClientLifecycleMode, ClientServiceExt,
    model::{ClientCapabilities, ClientInfo, Implementation, ProtocolVersion},
    service::{RoleClient, RunningService},
    transport::{
        StreamableHttpClientTransport, TokioChildProcess,
        streamable_http_client::StreamableHttpClientTransportConfig,
    },
};
use std::{
    collections::HashMap,
    ffi::OsStr,
    path::{Path, PathBuf},
};
use tokio::process::Command;

pub type McpClient = RunningService<RoleClient, ClientInfo>;

/// Opens one upstream server: a child process in `root` for a `command`, or a
/// Streamable HTTP session for a `url`.
pub async fn connect_server(server: &ResolvedServer, root: &Path) -> Result<McpClient> {
    let config = &server.config;
    let info = ClientInfo::new(
        ClientCapabilities::default(),
        Implementation::new("exeora", CLI_VERSION),
    );
    let lifecycle = || ClientLifecycleMode::Auto {
        preferred_versions: vec![ProtocolVersion::V_2026_07_28],
        legacy_version: Some(ProtocolVersion::V_2025_11_25),
    };

    if let Some(program) = &config.command {
        let program = server.expand(program)?;
        let mut command = Command::new(resolve_program(&program));
        crate::cgroup::drop_oom_exemption(&mut command);
        command.current_dir(root);
        for arg in &config.args {
            command.arg(server.expand(arg)?);
        }
        for (key, value) in &config.env {
            command.env(key, server.expand(value)?);
        }
        let transport = TokioChildProcess::new(wrap_stdio_command(command))
            .context("Could not start MCP server")?;
        return info
            .serve_with_lifecycle(transport, lifecycle())
            .await
            .context("Could not initialize stdio MCP server");
    }

    let url = server.expand(config.url.as_deref().context("MCP server has no URL")?)?;
    let mut headers = HashMap::new();
    let mut bearer = None;
    for (name, value) in &config.headers {
        let name = HeaderName::from_bytes(name.as_bytes())
            .with_context(|| format!("Invalid MCP HTTP header name `{name}`"))?;
        let value = server.expand(value)?;
        // The transport owns the Authorization header so it can refresh it;
        // a bearer token is handed to it rather than set as a raw header.
        if name == AUTHORIZATION
            && let Some(token) = value.strip_prefix("Bearer ")
        {
            bearer = Some(token.to_owned());
            continue;
        }
        headers.insert(
            name,
            HeaderValue::from_str(&value).context("Invalid MCP HTTP header value")?,
        );
    }
    let mut transport_config = StreamableHttpClientTransportConfig::with_uri(url);
    if let Some(token) = bearer {
        transport_config = transport_config.auth_header(token);
    }
    if !headers.is_empty() {
        transport_config = transport_config.custom_headers(headers);
    }
    let transport = StreamableHttpClientTransport::from_config(transport_config);
    info.serve_with_lifecycle(transport, lifecycle())
        .await
        .context("Could not initialize HTTP MCP server")
}

/// Ends the whole process tree with the client, not just its first process:
/// `npx` and `uvx` launch the real server as a grandchild.
pub fn wrap_stdio_command(command: Command) -> CommandWrap {
    let mut wrapped = CommandWrap::from(command);
    wrapped.wrap(KillOnDrop);
    #[cfg(unix)]
    wrapped.wrap(ProcessGroup::leader());
    #[cfg(windows)]
    wrapped.wrap(JobObject);
    wrapped
}

/// The program to spawn for a configured `command`.
///
/// On Windows, `npx`, `uvx` and most other launchers are `.cmd` shims, and
/// spawning a bare name only finds `.exe` files. The name is resolved against
/// `PATH` and `PATHEXT` there, the way a shell would. Elsewhere it is left for
/// the operating system to resolve.
fn resolve_program(program: &str) -> PathBuf {
    if cfg!(windows)
        && let (Some(path), pathext) = (
            std::env::var_os("PATH"),
            std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".to_owned()),
        )
        && let Some(found) = find_in_path(program, &path, &pathext)
    {
        return found;
    }
    PathBuf::from(program)
}

fn find_in_path(program: &str, path: &OsStr, pathext: &str) -> Option<PathBuf> {
    let candidate = Path::new(program);
    // A path, or a name that already carries an extension, means what it says.
    if candidate.components().count() > 1 || candidate.extension().is_some() {
        return None;
    }
    let extensions = pathext
        .split(';')
        .map(str::trim)
        .filter(|ext| !ext.is_empty())
        .collect::<Vec<_>>();
    std::env::split_paths(path).find_map(|dir| {
        extensions.iter().find_map(|ext| {
            let file = dir.join(format!("{program}{ext}"));
            file.is_file().then_some(file)
        })
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn stdio_servers_are_wrapped_for_process_tree_cleanup() {
        let wrapped = wrap_stdio_command(Command::new("does-not-run"));
        assert!(wrapped.has_wrap::<KillOnDrop>());
        #[cfg(unix)]
        assert!(wrapped.has_wrap::<ProcessGroup>());
        #[cfg(windows)]
        assert!(wrapped.has_wrap::<JobObject>());
    }

    #[test]
    fn resolves_launcher_shims_through_pathext() {
        let first = tempdir().expect("tempdir");
        let second = tempdir().expect("tempdir");
        std::fs::write(second.path().join("npx.CMD"), "").expect("write");
        let path = std::env::join_paths([first.path(), second.path()]).expect("joined search path");

        assert_eq!(
            find_in_path("npx", &path, ".COM;.EXE;.BAT;.CMD"),
            Some(second.path().join("npx.CMD"))
        );
        assert_eq!(find_in_path("npx.cmd", &path, ".CMD"), None);
        assert_eq!(find_in_path("missing", &path, ".CMD"), None);
    }
}
