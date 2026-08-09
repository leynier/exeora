use crate::CLI_VERSION;
use anyhow::{Context, Result, anyhow, bail};
use semver::Version;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{env, fs};
use url::Url;
use uuid::Uuid;

const RELEASES: &str = "https://github.com/leynier/exeora/releases";

pub async fn run(json_output: bool) -> Result<()> {
    let client = reqwest::Client::builder()
        .user_agent(format!("exeora/{CLI_VERSION}"))
        .build()?;
    let release = client
        .get(format!("{RELEASES}/latest"))
        .send()
        .await?
        .error_for_status()?;
    let (tag, latest) = release_from_url(release.url())?;
    let current = Version::parse(CLI_VERSION).context("The compiled CLI version is invalid")?;

    if latest <= current {
        if json_output {
            println!(
                "{}",
                json!({
                    "updated": false,
                    "currentVersion": current.to_string(),
                    "latestVersion": latest.to_string(),
                })
            );
        } else {
            println!("Exeora {current} is already up to date.");
        }
        return Ok(());
    }

    let asset = asset_name()?;
    let base = format!("{RELEASES}/download/{tag}");
    let asset_url = format!("{base}/{asset}");
    let checksums_url = format!("{base}/checksums-sha256.txt");
    let (binary, checksums) = tokio::try_join!(
        download(&client, &asset_url),
        download(&client, &checksums_url),
    )?;
    verify_checksum(asset, &binary, &checksums)?;

    let suffix = if cfg!(windows) { ".exe" } else { "" };
    let temporary = env::temp_dir().join(format!(
        "exeora-upgrade-{}{}",
        Uuid::new_v4().simple(),
        suffix
    ));
    fs::write(&temporary, binary).context("Could not stage the new Exeora executable")?;
    let replacement = self_replace::self_replace(&temporary);
    let _ = fs::remove_file(&temporary);
    replacement.context("Could not replace the current Exeora executable")?;

    if json_output {
        println!(
            "{}",
            json!({
                "updated": true,
                "previousVersion": current.to_string(),
                "version": latest.to_string(),
            })
        );
    } else {
        println!("Exeora was upgraded from {current} to {latest}.");
    }
    Ok(())
}

async fn download(client: &reqwest::Client, url: &str) -> Result<Vec<u8>> {
    Ok(client
        .get(url)
        .send()
        .await?
        .error_for_status()?
        .bytes()
        .await?
        .to_vec())
}

fn release_from_url(url: &Url) -> Result<(String, Version)> {
    let tag = url
        .path_segments()
        .and_then(Iterator::last)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| anyhow!("GitHub did not resolve the latest Exeora release"))?;
    let raw_version = tag
        .strip_prefix("cli-v")
        .ok_or_else(|| anyhow!("Unexpected Exeora release tag: {tag}"))?;
    let version = Version::parse(raw_version)
        .with_context(|| format!("Unexpected Exeora release tag: {tag}"))?;
    Ok((tag.to_owned(), version))
}

fn verify_checksum(asset: &str, binary: &[u8], checksums: &[u8]) -> Result<()> {
    let checksums = std::str::from_utf8(checksums).context("The checksum file is not UTF-8")?;
    let expected = checksums.lines().find_map(|line| {
        let mut fields = line.split_whitespace();
        let digest = fields.next()?;
        let filename = fields.next()?.trim_start_matches('*');
        (filename == asset).then_some(digest)
    });
    let Some(expected) = expected else {
        bail!("The release has no checksum for {asset}.");
    };
    let actual = format!("{:x}", Sha256::digest(binary));
    if !actual.eq_ignore_ascii_case(expected) {
        bail!("Exeora checksum verification failed.");
    }
    Ok(())
}

fn asset_name() -> Result<&'static str> {
    match (env::consts::OS, env::consts::ARCH) {
        ("linux", "x86_64") => Ok("exeora-x86_64-unknown-linux-gnu"),
        ("linux", "aarch64") => Ok("exeora-aarch64-unknown-linux-gnu"),
        ("macos", "x86_64") => Ok("exeora-x86_64-apple-darwin"),
        ("macos", "aarch64") => Ok("exeora-aarch64-apple-darwin"),
        ("windows", "x86_64") => Ok("exeora-x86_64-pc-windows-msvc.exe"),
        (os, architecture) => bail!("Unsupported platform: {os} {architecture}"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_the_cli_release_tag() {
        let url = Url::parse("https://github.com/leynier/exeora/releases/tag/cli-v1.2.3").unwrap();
        let (tag, version) = release_from_url(&url).unwrap();
        assert_eq!(tag, "cli-v1.2.3");
        assert_eq!(version, Version::new(1, 2, 3));
    }

    #[test]
    fn verifies_the_matching_asset_only() {
        let binary = b"native-exeora";
        let digest = format!("{:x}", Sha256::digest(binary));
        let checksums = format!("deadbeef  another-asset\n{digest}  exeora-test\n");
        verify_checksum("exeora-test", binary, checksums.as_bytes()).unwrap();
        assert!(verify_checksum("missing", binary, checksums.as_bytes()).is_err());
    }

    #[test]
    fn rejects_a_mismatched_checksum() {
        assert!(verify_checksum("exeora-test", b"changed", b"deadbeef  exeora-test\n").is_err());
    }
}
