use sha2::Digest;
use std::io::{Read, Write};
use std::path::Path;
use std::time::{Duration, Instant};

pub const ENGINE_HASH: &str = "7d8be46ecd31828e1eb7a2ecdd0d6b314feafd82163038ab6092594b0a063539";
pub const MODEL_HASH: &str = "465707469ff3a37a2b9b8d8f89f2f99de7299dac";

pub fn checksum(path: &Path, sha256: bool) -> Result<String, String> {
    let mut file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut h256 = sha2::Sha256::new();
    let mut h1 = sha1::Sha1::new();
    let mut bytes = [0u8; 65536];
    loop {
        let count = file.read(&mut bytes).map_err(|e| e.to_string())?;
        if count == 0 {
            break;
        }
        if sha256 {
            h256.update(&bytes[..count]);
        } else {
            h1.update(&bytes[..count]);
        }
    }
    Ok(if sha256 {
        format!("{:x}", h256.finalize())
    } else {
        format!("{:x}", h1.finalize())
    })
}

fn download(
    url: &str,
    path: &Path,
    hash: &str,
    start: u8,
    end: u8,
    progress: &impl Fn(u8, &str, Option<u64>, Option<u64>),
) -> Result<(), String> {
    if path.is_file() && checksum(path, hash.len() == 64)? == hash {
        return Ok(());
    }
    let partial = path.with_extension("download");
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .timeout(Duration::from_secs(1800))
        .user_agent("Snap-offline-captions")
        .build()
        .map_err(|e| e.to_string())?;
    let mut response = client
        .get(url)
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("Download could not start. Check your connection and retry: {e}"))?;
    let total = response.content_length();
    let mut file = std::fs::File::create(&partial).map_err(|e| e.to_string())?;
    let mut bytes = [0u8; 65536];
    let mut downloaded = 0u64;
    let mut last = Instant::now();
    loop {
        let count = response
            .read(&mut bytes)
            .map_err(|e| format!("Download interrupted. Retry installation: {e}"))?;
        if count == 0 {
            break;
        }
        file.write_all(&bytes[..count])
            .map_err(|e| format!("Cannot save download. Check disk space: {e}"))?;
        downloaded += count as u64;
        if last.elapsed() > Duration::from_millis(250) {
            let percent = total
                .filter(|n| *n > 0)
                .map(|n| start + ((end - start) as u64 * downloaded.min(n) / n) as u8)
                .unwrap_or(start);
            progress(
                percent.min(end - 1),
                "Downloading offline captions",
                Some(downloaded),
                total,
            );
            last = Instant::now();
        }
    }
    file.sync_all().map_err(|e| e.to_string())?;
    drop(file);
    if checksum(&partial, hash.len() == 64)? != hash {
        return Err("Download checksum mismatch. Retry for a clean copy.".into());
    }
    if path.exists() {
        std::fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    std::fs::rename(partial, path).map_err(|e| e.to_string())?;
    progress(end, "Download verified", Some(downloaded), total);
    Ok(())
}

pub fn install(
    root: &Path,
    progress: impl Fn(u8, &str, Option<u64>, Option<u64>),
) -> Result<(), String> {
    static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _guard = LOCK
        .try_lock()
        .map_err(|_| "Caption installation is already running")?;
    let models = root.join("models");
    std::fs::create_dir_all(&models).map_err(|e| e.to_string())?;
    let marker = root.join("engine.sha256");
    let ready = root.join("whisper-cli.exe").is_file()
        && std::fs::read_to_string(&marker).is_ok_and(|s| s == ENGINE_HASH);
    if !ready {
        let archive = root.join("whisper.zip");
        download(
            "https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.1/whisper-bin-x64.zip",
            &archive,
            ENGINE_HASH,
            1,
            20,
            &progress,
        )?;
        progress(20, "Installing caption engine", None, None);
        let file = std::fs::File::open(archive).map_err(|e| e.to_string())?;
        let mut zip = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
        for index in 0..zip.len() {
            let mut entry = zip.by_index(index).map_err(|e| e.to_string())?;
            let path = entry
                .enclosed_name()
                .ok_or("Invalid caption archive path")?;
            let Some(name) = path.file_name() else {
                continue;
            };
            if !matches!(
                path.extension().and_then(|e| e.to_str()),
                Some("exe" | "dll")
            ) {
                continue;
            }
            let mut out = std::fs::File::create(root.join(name)).map_err(|e| e.to_string())?;
            std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
            out.sync_all().map_err(|e| e.to_string())?;
        }
        if !root.join("whisper-cli.exe").is_file() {
            return Err("Caption engine not found in verified archive".into());
        }
        std::fs::write(marker, ENGINE_HASH).map_err(|e| e.to_string())?;
    }
    download(
        "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.bin?download=true",
        &models.join("ggml-base.bin"),
        MODEL_HASH,
        21,
        99,
        &progress,
    )?;
    progress(100, "Offline captions ready on this PC", None, None);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn verified_cache_skips_network() {
        let root = std::env::temp_dir().join(format!("snap-hash-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        let file = root.join("fixture.bin");
        std::fs::write(&file, b"abc").unwrap();
        let hash = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
        assert_eq!(checksum(&file, true).unwrap(), hash);
        assert_eq!(
            checksum(&file, false).unwrap(),
            "a9993e364706816aba3e25717850c26c9cd0d89d"
        );
        download(
            "invalid://network-must-not-run",
            &file,
            hash,
            1,
            99,
            &|_, _, _, _| {},
        )
        .unwrap();
        std::fs::remove_file(file).unwrap();
        std::fs::remove_dir(root).unwrap();
    }

    #[test]
    #[ignore = "Downloads the offline model to this PC; run only when requested"]
    fn install_local_caption_cache() {
        let root = std::path::PathBuf::from(std::env::var_os("LOCALAPPDATA").unwrap())
            .join("Snap/transcription");
        install(&root, |percent, phase, _, _| {
            eprintln!("{percent}% {phase}")
        })
        .unwrap();
        let modified = std::fs::metadata(root.join("models/ggml-base.bin"))
            .unwrap()
            .modified()
            .unwrap();
        install(&root, |_, _, _, _| {}).unwrap();
        assert_eq!(
            modified,
            std::fs::metadata(root.join("models/ggml-base.bin"))
                .unwrap()
                .modified()
                .unwrap()
        );
    }
}
