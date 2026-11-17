use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};
use tauri::Manager;

const DOWNLOADER: &str = "yt-dlp.exe";
const RUNTIME: &str = "deno.exe";
const RUNTIME_ARCHIVE: &str = "deno.zip";
const MAX_DOWNLOAD: u64 = 128 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Progress {
    phase: &'static str,
    percent: u8,
}

#[derive(Deserialize)]
struct Release {
    assets: Vec<Asset>,
}

#[derive(Deserialize)]
struct Asset {
    name: String,
    browser_download_url: String,
    size: u64,
    digest: Option<String>,
}

fn directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|path| path.join("link-import-tools"))
        .map_err(|_| "Could not find Snap's local tools folder.".into())
}

pub(crate) fn installed(app: &tauri::AppHandle) -> Option<(PathBuf, PathBuf)> {
    let root = directory(app).ok()?;
    let downloader = root.join(DOWNLOADER);
    let runtime = root.join(RUNTIME);
    (downloader.is_file() && runtime.is_file()).then_some((downloader, runtime))
}

fn asset_digest<'a>(asset: &'a Asset, repo: &str) -> Result<&'a str, &'static str> {
    let checksum = asset
        .digest
        .as_deref()
        .and_then(|value| value.strip_prefix("sha256:"))
        .filter(|hash| hash.len() == 64 && hash.bytes().all(|byte| byte.is_ascii_hexdigit()))
        .ok_or("The official release did not provide a valid checksum.")?;
    if asset.size == 0
        || asset.size > MAX_DOWNLOAD
        || !asset
            .browser_download_url
            .starts_with(&format!("https://github.com/{repo}/releases/download/"))
        || !asset
            .browser_download_url
            .ends_with(&format!("/{}", asset.name))
    {
        return Err("The official release returned unexpected download information.");
    }
    Ok(checksum)
}

fn latest_asset(client: &Client, repo: &str, filename: &str) -> Result<Asset, String> {
    let response = client
        .get(format!(
            "https://api.github.com/repos/{repo}/releases/latest"
        ))
        .header("Accept", "application/vnd.github+json")
        .send()
        .and_then(|response| response.error_for_status())
        .map_err(|_| {
            "Could not check for the latest link downloader. Check your connection and retry."
        })?;
    let release: Release = serde_json::from_reader(response.take(1024 * 1024))
        .map_err(|_| "Could not read the official download information.")?;
    release
        .assets
        .into_iter()
        .find(|asset| asset.name == filename)
        .ok_or_else(|| "The official release did not contain a download for this PC.".into())
}

fn write_verified(
    mut input: impl Read,
    mut output: impl Write,
    size: u64,
    checksum: &str,
    mut progress: impl FnMut(u64) -> Result<(), String>,
) -> Result<(), String> {
    let mut bytes = [0; 64 * 1024];
    let mut sha256 = Sha256::new();
    let mut received = 0;
    loop {
        progress(received)?;
        let count = input
            .read(&mut bytes)
            .map_err(|_| "Download interrupted. Try setup again.")?;
        if count == 0 {
            break;
        }
        received += count as u64;
        if received > size {
            return Err("The download exceeded the expected size.".into());
        }
        sha256.update(&bytes[..count]);
        output
            .write_all(&bytes[..count])
            .map_err(|_| "Could not save the download. Check available disk space.")?;
    }
    if received != size || !format!("{:x}", sha256.finalize()).eq_ignore_ascii_case(checksum) {
        return Err("The download failed verification. Try setup again.".into());
    }
    Ok(())
}

fn download(
    client: &Client,
    repo: &str,
    filename: &str,
    destination: &Path,
    mut progress: impl FnMut(u8) -> Result<(), String>,
) -> Result<(), String> {
    progress(0)?;
    let asset = latest_asset(client, repo, filename)?;
    let checksum = asset_digest(&asset, repo)?;
    progress(0)?;
    let response = client
        .get(&asset.browser_download_url)
        .send()
        .and_then(|response| response.error_for_status())
        .map_err(|_| {
            "Could not download the link import tools. Check your connection and retry."
        })?;
    let mut file = File::create(destination).map_err(|_| "Could not create the download file.")?;
    write_verified(response, &mut file, asset.size, checksum, |received| {
        progress((received * 100 / asset.size) as u8)
    })?;
    file.sync_all()
        .map_err(|_| "Could not save the verified download.".into())
}

struct StagingDirectory(PathBuf);

impl Drop for StagingDirectory {
    fn drop(&mut self) {
        for name in [DOWNLOADER, RUNTIME, RUNTIME_ARCHIVE] {
            let _ = fs::remove_file(self.0.join(name));
        }
        let _ = fs::remove_dir(&self.0);
    }
}

pub(crate) fn install(
    app: &tauri::AppHandle,
    staging_name: &str,
    check_active: impl Fn() -> Result<(), String>,
    send: impl Fn(Progress),
) -> Result<(), String> {
    let (downloader, runtime) = match std::env::consts::ARCH {
        "x86_64" => ("yt-dlp.exe", "deno-x86_64-pc-windows-msvc.zip"),
        "aarch64" => ("yt-dlp_arm64.exe", "deno-aarch64-pc-windows-msvc.zip"),
        _ => return Err("Link downloader setup requires 64-bit Windows.".into()),
    };
    check_active()?;
    let root = directory(app)?;
    fs::create_dir_all(&root).map_err(|_| "Could not create Snap's local tools folder.")?;
    let path = root.join(staging_name);
    fs::create_dir(&path).map_err(|_| "Could not prepare the download folder.")?;
    let staging = StagingDirectory(path);
    let client = Client::builder()
        .https_only(true)
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(300))
        .user_agent("Snap-link-import")
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() < 5
                && attempt.url().scheme() == "https"
                && matches!(
                    attempt.url().host_str(),
                    Some(
                        "github.com"
                            | "release-assets.githubusercontent.com"
                            | "objects.githubusercontent.com"
                    )
                )
            {
                attempt.follow()
            } else {
                attempt.error("Unexpected release download redirect")
            }
        }))
        .build()
        .map_err(|_| "Could not start the setup download.")?;

    for (repo, asset, name, phase, start, span) in [
        (
            "yt-dlp/yt-dlp",
            downloader,
            DOWNLOADER,
            "Downloading video downloader",
            0,
            30u8,
        ),
        (
            "denoland/deno",
            runtime,
            RUNTIME_ARCHIVE,
            "Downloading video link runtime",
            30,
            65u8,
        ),
    ] {
        send(Progress {
            phase,
            percent: start,
        });
        let mut last_update = Instant::now();
        download(&client, repo, asset, &staging.0.join(name), |percent| {
            check_active()?;
            if last_update.elapsed() >= Duration::from_millis(200) {
                send(Progress {
                    phase,
                    percent: start + (u16::from(span) * u16::from(percent) / 100) as u8,
                });
                last_update = Instant::now();
            }
            Ok(())
        })?;
    }

    check_active()?;
    send(Progress {
        phase: "Installing verified tools",
        percent: 96,
    });
    {
        let archive = File::open(staging.0.join(RUNTIME_ARCHIVE))
            .map_err(|_| "Could not open the verified runtime archive.")?;
        let mut archive = zip::ZipArchive::new(archive)
            .map_err(|_| "Could not read the verified runtime archive.")?;
        let runtime = archive
            .by_name(RUNTIME)
            .map_err(|_| "The runtime executable was missing from the archive.")?;
        let mut output = File::create(staging.0.join(RUNTIME))
            .map_err(|_| "Could not prepare the runtime executable.")?;
        if io::copy(&mut runtime.take(256 * 1024 * 1024 + 1), &mut output)
            .map_err(|_| "Could not extract the runtime executable.")?
            > 256 * 1024 * 1024
        {
            return Err("The runtime executable exceeded the expected size.".into());
        }
        output
            .sync_all()
            .map_err(|_| "Could not save the runtime executable.")?;
    }
    check_active()?;
    for name in [RUNTIME, DOWNLOADER] {
        fs::rename(staging.0.join(name), root.join(name)).map_err(|_| {
            "Could not replace the link import tools. Close other Snap windows and retry."
        })?;
    }
    send(Progress {
        phase: "Link importer ready",
        percent: 100,
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn checks_release_url_and_download_contents() {
        let digest = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
        let mut asset = Asset {
            name: DOWNLOADER.into(),
            browser_download_url:
                "https://github.com/yt-dlp/yt-dlp/releases/download/v1/yt-dlp.exe".into(),
            size: 3,
            digest: Some(format!("sha256:{digest}")),
        };
        assert_eq!(asset_digest(&asset, "yt-dlp/yt-dlp"), Ok(digest));
        asset.browser_download_url = "https://example.com/yt-dlp.exe".into();
        assert!(asset_digest(&asset, "yt-dlp/yt-dlp").is_err());
        let mut out = Vec::new();
        write_verified(&b"abc"[..], &mut out, 3, digest, |_| Ok(())).unwrap();
        assert_eq!(out, b"abc");
        assert!(write_verified(&b"abd"[..], io::sink(), 3, digest, |_| Ok(())).is_err());
        assert!(write_verified(&b"abcd"[..], io::sink(), 3, digest, |_| Ok(())).is_err());
        assert_eq!(
            write_verified(&b"abc"[..], io::sink(), 3, digest, |_| Err(
                "cancelled".into()
            )),
            Err("cancelled".into())
        );
    }
}
