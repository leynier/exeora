use crate::CLI_VERSION;
use anyhow::{Context, Result, anyhow, bail};
use futures_util::StreamExt;
use semver::Version;
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{env, fs};
use url::Url;
use uuid::Uuid;

const RELEASES: &str = "https://github.com/leynier/exeora/releases";
const MAX_RELEASE_BINARY_BYTES: usize = 128 * 1024 * 1024;
const MAX_CHECKSUM_BYTES: usize = 1024 * 1024;

pub async fn run(json_output: bool) -> Result<()> {
    let client = reqwest::Client::builder()
        .user_agent(format!("exeora/{CLI_VERSION}"))
        .redirect(github_redirect_policy())
        .build()?;
    let release = client
        .get(format!("{RELEASES}/latest"))
        .send()
        .await?
        .error_for_status()?;
    require_github_release_url(release.url())?;
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
        download(&client, &asset_url, MAX_RELEASE_BINARY_BYTES),
        download(&client, &checksums_url, MAX_CHECKSUM_BYTES),
    )?;
    verify_checksum(asset, &binary, &checksums)?;

    let suffix = if cfg!(windows) { ".exe" } else { "" };
    let temporary = env::temp_dir().join(format!(
        "exeora-upgrade-{}{}",
        Uuid::new_v4().simple(),
        suffix
    ));
    crate::private::write(&temporary, &binary, 0o700)
        .context("Could not stage the new Exeora executable")?;
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

async fn download(client: &reqwest::Client, url: &str, limit: usize) -> Result<Vec<u8>> {
    let response = client.get(url).send().await?.error_for_status()?;
    require_github_download_url(response.url())?;
    if response
        .content_length()
        .is_some_and(|length| length > limit as u64)
    {
        bail!("The GitHub release asset is larger than the supported download limit.");
    }
    let mut body = Vec::with_capacity(
        response
            .content_length()
            .unwrap_or(0)
            .try_into()
            .unwrap_or(0)
            .min(limit),
    );
    let mut stream = response.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk?;
        if chunk.len() > limit.saturating_sub(body.len()) {
            bail!("The GitHub release asset is larger than the supported download limit.");
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

fn release_from_url(url: &Url) -> Result<(String, Version)> {
    require_github_release_url(url)?;
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

fn require_github_release_url(url: &Url) -> Result<()> {
    if url.scheme() != "https"
        || url.host_str() != Some("github.com")
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || !url.path().starts_with("/leynier/exeora/releases/tag/")
    {
        bail!("GitHub did not resolve the latest Exeora release.");
    }
    Ok(())
}

fn require_github_download_url(url: &Url) -> Result<()> {
    let host = url.host_str().unwrap_or_default();
    if url.scheme() != "https"
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || !matches!(
            host,
            "github.com" | "objects.githubusercontent.com" | "release-assets.githubusercontent.com"
        )
        || (host == "github.com" && url.query().is_some())
    {
        bail!("GitHub redirected the release asset to an untrusted host.");
    }
    Ok(())
}

fn github_redirect_policy() -> reqwest::redirect::Policy {
    reqwest::redirect::Policy::custom(|attempt| match require_github_download_url(attempt.url()) {
        Ok(()) => attempt.follow(),
        Err(error) => attempt.error(error),
    })
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
    fn rejects_release_metadata_from_an_untrusted_origin() {
        for value in [
            "http://github.com/leynier/exeora/releases/tag/cli-v1.2.3",
            "https://evil.example/leynier/exeora/releases/tag/cli-v1.2.3",
            "https://github.com/other/repo/releases/tag/cli-v1.2.3",
            "https://github.com/leynier/exeora/releases/tag/cli-v1.2.3?redirect=evil",
        ] {
            let url = Url::parse(value).unwrap();
            assert!(release_from_url(&url).is_err(), "accepted {value}");
        }
    }

    #[test]
    fn accepts_only_github_release_asset_origins() {
        for value in [
            "https://github.com/leynier/exeora/releases/download/cli-v1.2.3/cli",
            "https://objects.githubusercontent.com/release/asset",
            "https://release-assets.githubusercontent.com/release/asset",
            "https://release-assets.githubusercontent.com/release/asset?X-Amz-Signature=signed",
        ] {
            require_github_download_url(&Url::parse(value).unwrap()).unwrap();
        }
        assert!(
            require_github_download_url(
                &Url::parse("https://evil.example/asset?token=secret").unwrap()
            )
            .is_err()
        );
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
