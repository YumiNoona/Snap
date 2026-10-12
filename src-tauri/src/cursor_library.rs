//! User cursor images are validated, copied and named in Snap's local library.
use crate::{CursorPack, CursorPackState};
use serde::{Deserialize, Serialize};
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::Manager;

const MAX_FILE_BYTES: u64 = 2 * 1024 * 1024;
static IMPORT_LOCK: Mutex<()> = Mutex::new(());

#[derive(Serialize, Deserialize)]
struct CursorMetadata { label: String }

fn library_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_local_data_dir().map_err(|e| e.to_string())?.join("cursors"))
}

pub(crate) fn grant_scope(app: &tauri::AppHandle) -> Result<(), String> {
    app.asset_protocol_scope().allow_directory(library_dir(app)?, true).map_err(|e| e.to_string())
}

fn validate_name(name: &str) -> Result<String, String> {
    let label = name.trim();
    if label.is_empty() || label.chars().count() > 48 || label.chars().any(char::is_control) {
        return Err("[cursor-name] Enter a cursor name between 1 and 48 characters".into());
    }
    Ok(label.to_string())
}

fn validate_png(bytes: &[u8]) -> Result<(), String> {
    if bytes.len() as u64 > MAX_FILE_BYTES { return Err("[cursor-size] Choose a PNG smaller than 2 MB".into()); }
    let mut decoder = png::Decoder::new(Cursor::new(bytes));
    decoder.set_limits(png::Limits { bytes: 4 * 1024 * 1024 });
    let mut reader = decoder.read_info().map_err(|_| "[cursor-format] Choose a valid PNG cursor image".to_string())?;
    let info = reader.info();
    if info.width == 0 || info.height == 0 || info.width > 512 || info.height > 512 || info.animation_control.is_some() {
        return Err("[cursor-size] Use a static PNG up to 512 × 512 pixels".into());
    }
    let size = reader.output_buffer_size().filter(|size| *size <= 4 * 1024 * 1024)
        .ok_or("[cursor-size] Cursor image is too large")?;
    reader.next_frame(&mut vec![0; size]).map_err(|_| "[cursor-format] The PNG cursor image is damaged".to_string())?;
    Ok(())
}

fn pack_for(dir: &Path, label: String) -> CursorPack {
    let path = dir.join("pointer.png").to_string_lossy().into_owned();
    CursorPack {
        name: format!("custom-{}", dir.file_name().unwrap_or_default().to_string_lossy()),
        label, pointer_path: path.clone(), pointer_url: path.clone(),
        states: vec![CursorPackState { name: "pointer.png".into(), path: path.clone(), url: path }],
    }
}

pub(crate) fn list(app: &tauri::AppHandle) -> Result<Vec<CursorPack>, String> {
    let root = library_dir(app)?;
    list_at(&root)
}

fn list_at(root: &Path) -> Result<Vec<CursorPack>, String> {
    if !root.exists() { return Ok(Vec::new()); }
    let mut packs = Vec::new();
    for entry in std::fs::read_dir(root).map_err(|e| e.to_string())?.flatten() {
        if !entry.file_type().is_ok_and(|kind| kind.is_dir() && !kind.is_symlink()) { continue; }
        let dir = entry.path();
        let metadata = dir.join("cursor.json");
        if !dir.join("pointer.png").is_file() { continue; }
        let Ok(file) = std::fs::File::open(metadata) else { continue };
        let Ok(metadata) = serde_json::from_reader::<_, CursorMetadata>(file.take(4096)) else { continue };
        if let Ok(label) = validate_name(&metadata.label) { packs.push(pack_for(&dir, label)); }
    }
    packs.sort_by_key(|pack| pack.label.to_lowercase());
    Ok(packs)
}

fn store(root: &Path, label: &str, bytes: &[u8]) -> Result<CursorPack, String> {
    let slug: String = label.chars().map(|c| if c.is_ascii_alphanumeric() { c.to_ascii_lowercase() } else { '-' }).collect();
    let slug = slug.trim_matches('-');
    let slug = if slug.is_empty() { "cursor" } else { slug };
    let nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?.as_nanos();
    std::fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let dir = root.join(format!("{slug}-{nonce}"));
    std::fs::create_dir(&dir).map_err(|e| e.to_string())?;
    let result = (|| -> Result<(), String> {
        std::fs::write(dir.join("pointer.png"), bytes).map_err(|e| e.to_string())?;
        let metadata = serde_json::to_vec_pretty(&CursorMetadata { label: label.into() }).map_err(|e| e.to_string())?;
        std::fs::write(dir.join("cursor.json"), metadata).map_err(|e| e.to_string())?;
        Ok(())
    })();
    if result.is_err() {
        // Only remove files in the directory created by this import attempt.
        let _ = std::fs::remove_file(dir.join("pointer.png"));
        let _ = std::fs::remove_file(dir.join("cursor.json"));
        let _ = std::fs::remove_dir(&dir);
    }
    result?;
    Ok(pack_for(&dir, label.into()))
}

#[tauri::command]
pub async fn import_custom_cursor(app: tauri::AppHandle, source_path: String, name: String) -> Result<CursorPack, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = IMPORT_LOCK.lock().map_err(|e| e.to_string())?;
        let label = validate_name(&name)?;
        let source = PathBuf::from(source_path);
        crate::access::require(&app, &source)?;
        if !source.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("png")) { return Err("[cursor-format] Choose a PNG cursor image".into()); }
        if list(&app)?.iter().any(|pack| pack.label.eq_ignore_ascii_case(&label)) { return Err("[cursor-exists] A custom cursor already uses this name".into()); }
        let mut bytes = Vec::new();
        std::fs::File::open(source).map_err(|e| e.to_string())?.take(MAX_FILE_BYTES + 1).read_to_end(&mut bytes).map_err(|e| e.to_string())?;
        validate_png(&bytes)?;
        store(&library_dir(&app)?, &label, &bytes)
    }).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn names_preserve_user_spelling_but_paths_cannot_escape_the_library() {
        assert_eq!(validate_name("  My Pink Cursor  ").unwrap(), "My Pink Cursor");
        assert!(validate_name(" ").is_err());
        assert!(validate_name("bad\nname").is_err());
        assert!(validate_name(&"a".repeat(49)).is_err());
        let root = std::env::temp_dir().join(format!("snap-cursor-store-test-{}", std::process::id()));
        let pack = store(&root, "../../CON", b"fixture").unwrap();
        let file = PathBuf::from(&pack.pointer_path);
        assert!(file.starts_with(&root));
        assert_eq!(pack.label, "../../CON");
        assert_eq!(std::fs::read(&file).unwrap(), b"fixture");
        let reopened = list_at(&root).unwrap();
        assert_eq!(reopened.len(), 1);
        assert_eq!(reopened[0].name, pack.name);
        assert_eq!(reopened[0].label, "../../CON");
        let dir = file.parent().unwrap();
        std::fs::remove_file(&file).unwrap();
        std::fs::remove_file(dir.join("cursor.json")).unwrap();
        std::fs::remove_dir(dir).unwrap();
        std::fs::remove_dir(root).unwrap();
    }
    #[test]
    fn png_validation_rejects_fake_and_oversized_images() {
        assert!(validate_png(b"not a PNG").is_err());
        assert!(validate_png(&vec![0; MAX_FILE_BYTES as usize + 1]).is_err());
        let mut bytes = Vec::new();
        { let mut encoder = png::Encoder::new(&mut bytes, 2, 2); encoder.set_color(png::ColorType::Rgba); let mut writer = encoder.write_header().unwrap(); writer.write_image_data(&[255; 16]).unwrap(); }
        validate_png(&bytes).unwrap();
        assert!(validate_png(&bytes[..bytes.len() / 2]).is_err());
        let mut too_wide = Vec::new();
        { let mut encoder = png::Encoder::new(&mut too_wide, 513, 1); encoder.set_color(png::ColorType::Rgba); let mut writer = encoder.write_header().unwrap(); writer.write_image_data(&vec![0; 513 * 4]).unwrap(); }
        assert!(validate_png(&too_wide).unwrap_err().contains("[cursor-size]"));
    }
}
