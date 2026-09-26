//! The machine token a cloud CLI presents on its relay socket.
//!
//! Read from a file rather than the environment: every command an agent runs
//! inherits the environment, and a token in it would show up in any `env`
//! dump. The file is still readable by that same user, which is the honest
//! limit of a machine that runs the agent's commands as itself; what bounds
//! the damage is that the token opens nothing but this device's relay.

use anyhow::{Context, Result, bail};
use std::path::Path;

const PREFIX: &str = "exm_";
const MAX_BYTES: usize = 512;

/// Reads and checks the token. Re-read on every connection attempt, so a
/// token the gateway replaced takes effect without a restart.
pub fn read(path: &Path) -> Result<String> {
    let raw = std::fs::read_to_string(path)
        .with_context(|| format!("Could not read the machine token at {}", path.display()))?;
    let token = raw.trim();
    if token.is_empty() {
        bail!("The machine token file is empty.");
    }
    if token.len() > MAX_BYTES || !token.starts_with(PREFIX) {
        bail!("The machine token file does not hold a machine token.");
    }
    if token
        .chars()
        .any(|character| character.is_whitespace() || character.is_control())
    {
        bail!("The machine token file holds more than one token.");
    }
    Ok(token.to_owned())
}

#[cfg(test)]
mod tests {
    use super::read;
    use std::io::Write;

    fn file(contents: &str) -> tempfile::NamedTempFile {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        file.write_all(contents.as_bytes()).unwrap();
        file
    }

    #[test]
    fn accepts_a_token_with_a_trailing_newline() {
        let file = file("exm_abc_def\n");
        assert_eq!(read(file.path()).unwrap(), "exm_abc_def");
    }

    #[test]
    fn refuses_anything_that_is_not_one_machine_token() {
        for contents in [
            "",
            "   \n",
            "usr:grant:secret",
            "exm_a b",
            &"exm_".repeat(200),
        ] {
            let file = file(contents);
            assert!(read(file.path()).is_err(), "accepted {contents:?}");
        }
        assert!(read(std::path::Path::new("/nonexistent/exeora/token")).is_err());
    }
}
