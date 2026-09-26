//! The Sprite runtime's local API, over its unix socket.
//!
//! One request is all cloud mode needs: refreshing the task that keeps the
//! machine awake. A minimal HTTP/1.1 exchange written by hand is smaller than
//! any client crate that speaks unix sockets, and it is testable against a
//! listener in the test itself.

use anyhow::{Context, Result, bail};
use std::path::PathBuf;

#[cfg(unix)]
const TIMEOUT: std::time::Duration = std::time::Duration::from_secs(5);

#[derive(Clone)]
pub struct SpriteApi {
    /// Read only where a unix socket can be dialled; on Windows the field
    /// stays, since the type and its callers are the same on every target.
    #[cfg_attr(not(unix), allow(dead_code))]
    socket: PathBuf,
}

impl SpriteApi {
    pub fn new(socket: PathBuf) -> Self {
        Self { socket }
    }

    /// `PUT /v1/tasks/{name}`: creates or refreshes a task that holds the
    /// machine awake until `expire` (seconds, or a duration such as `3m`).
    pub async fn put_task(&self, name: &str, expire: &str) -> Result<u16> {
        let body = format!(r#"{{"expire":"{expire}"}}"#);
        let request = format!(
            "PUT /v1/tasks/{name} HTTP/1.1\r\nHost: sprite\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
            body.len()
        );
        let reply = self.exchange(request.as_bytes()).await?;
        let status = parse_status(&reply)?;
        if !(200..300).contains(&status) {
            bail!("the Sprite runtime answered {status}");
        }
        Ok(status)
    }

    #[cfg(unix)]
    async fn exchange(&self, request: &[u8]) -> Result<Vec<u8>> {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let mut stream =
            tokio::time::timeout(TIMEOUT, tokio::net::UnixStream::connect(&self.socket))
                .await
                .map_err(|_| anyhow::anyhow!("timed out connecting to {}", self.socket.display()))?
                .with_context(|| format!("could not connect to {}", self.socket.display()))?;
        stream.write_all(request).await?;
        let mut reply = Vec::new();
        // `Connection: close` asks the server to end the stream after the
        // response, so reading to the end is reading the whole response.
        tokio::time::timeout(TIMEOUT, stream.read_to_end(&mut reply))
            .await
            .map_err(|_| anyhow::anyhow!("timed out waiting for the Sprite runtime"))??;
        Ok(reply)
    }

    #[cfg(not(unix))]
    async fn exchange(&self, _request: &[u8]) -> Result<Vec<u8>> {
        bail!("the Sprite runtime socket exists only on Linux")
    }
}

/// The status code out of an HTTP/1.x status line.
pub fn parse_status(reply: &[u8]) -> Result<u16> {
    let text = std::str::from_utf8(reply).context("the reply was not UTF-8")?;
    let line = text.lines().next().unwrap_or_default();
    let mut parts = line.split_whitespace();
    match (parts.next(), parts.next()) {
        (Some(version), Some(code)) if version.starts_with("HTTP/") => code
            .parse::<u16>()
            .with_context(|| format!("unreadable status line: {line}")),
        _ => bail!("unreadable status line: {line}"),
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::{SpriteApi, parse_status};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[test]
    fn reads_the_status_out_of_the_first_line() {
        assert_eq!(parse_status(b"HTTP/1.1 200 OK\r\n\r\n{}").unwrap(), 200);
        assert_eq!(parse_status(b"HTTP/1.0 409 Conflict\r\n").unwrap(), 409);
        assert!(parse_status(b"nonsense").is_err());
    }

    #[tokio::test]
    async fn refreshes_a_task_over_the_unix_socket() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("api.sock");
        let listener = tokio::net::UnixListener::bind(&path).unwrap();
        let server = tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut buffer = vec![0_u8; 4096];
            let read = stream.read(&mut buffer).await.unwrap();
            let request = String::from_utf8_lossy(&buffer[..read]).into_owned();
            stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}")
                .await
                .unwrap();
            request
        });

        let status = SpriteApi::new(path).put_task("exeora", "3m").await.unwrap();
        assert_eq!(status, 200);
        let request = server.await.unwrap();
        assert!(request.starts_with("PUT /v1/tasks/exeora HTTP/1.1\r\n"));
        assert!(request.ends_with("{\"expire\":\"3m\"}"));
    }

    #[tokio::test]
    async fn reports_a_refusal() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("api.sock");
        let listener = tokio::net::UnixListener::bind(&path).unwrap();
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut buffer = vec![0_u8; 4096];
            let _ = stream.read(&mut buffer).await;
            let _ = stream
                .write_all(b"HTTP/1.1 500 Internal Server Error\r\nConnection: close\r\n\r\n")
                .await;
        });
        let error = SpriteApi::new(path)
            .put_task("exeora", "3m")
            .await
            .unwrap_err();
        assert!(error.to_string().contains("500"));
    }
}
