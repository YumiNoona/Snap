//! Seekable, bounded editor read-ahead instead of the asset handler's 1 MB cap.
//! Disk work is off the UI thread; never read an entire large recording into RAM.
use std::{
    fs::File,
    io::{Read, Seek, SeekFrom},
    path::PathBuf,
    sync::Mutex,
};
use tauri::http::{Request, Response};

const READ_AHEAD: u64 = 32 * 1024 * 1024;
static READ_GATE: Mutex<()> = Mutex::new(());

fn decode_path(encoded: &str) -> Result<PathBuf, ()> {
    let encoded = encoded.strip_prefix('/').unwrap_or(encoded);
    let mut bytes = Vec::with_capacity(encoded.len());
    let mut chars = encoded.bytes();
    while let Some(byte) = chars.next() {
        if byte == b'%' {
            let hex = |c: u8| (c as char).to_digit(16).map(|n| n as u8).ok_or(());
            bytes.push(hex(chars.next().ok_or(())?)? * 16 + hex(chars.next().ok_or(())?)?);
        } else {
            bytes.push(byte);
        }
    }
    let text = String::from_utf8(bytes).map_err(|_| ())?;
    if text.contains('\0') {
        return Err(());
    }
    let path = PathBuf::from(text);
    if !path.is_absolute()
        || path
            .components()
            .any(|c| matches!(c, std::path::Component::ParentDir))
    {
        return Err(());
    }
    Ok(path)
}

fn byte_range(header: &str, len: u64) -> Result<(u64, u64), ()> {
    if len == 0 {
        return Err(());
    }
    let (start, end) = header
        .strip_prefix("bytes=")
        .ok_or(())?
        .split_once('-')
        .ok_or(())?;
    let (start, end) = if start.is_empty() {
        let suffix = end.parse::<u64>().map_err(|_| ())?;
        if suffix == 0 {
            return Err(());
        }
        (len.saturating_sub(suffix), len - 1)
    } else {
        let start = start.parse::<u64>().map_err(|_| ())?;
        let end = if end.is_empty() {
            len - 1
        } else {
            end.parse::<u64>().map_err(|_| ())?.min(len - 1)
        };
        (start, end)
    };
    if start >= len || end < start {
        return Err(());
    }
    Ok((start, end.min(start.saturating_add(READ_AHEAD - 1))))
}

fn media_type(path: &std::path::Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "mp4" | "m4v" => Some("video/mp4"),
        "mov" => Some("video/quicktime"),
        "webm" => Some("video/webm"),
        "mkv" => Some("video/x-matroska"),
        "avi" => Some("video/x-msvideo"),
        "wav" => Some("audio/wav"),
        "mp3" => Some("audio/mpeg"),
        "m4a" => Some("audio/mp4"),
        "ogg" => Some("audio/ogg"),
        "flac" => Some("audio/flac"),
        _ => None,
    }
}

fn empty(status: u16) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .body(Vec::new())
        .expect("valid media response")
}

pub fn respond(app: &tauri::AppHandle, request: Request<Vec<u8>>) -> Response<Vec<u8>> {
    let origin = request
        .headers()
        .get("origin")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("*");
    if ![
        "*",
        "http://tauri.localhost",
        "https://tauri.localhost",
        "tauri://localhost",
        "http://localhost:1420",
        "http://127.0.0.1:1420",
    ]
    .contains(&origin)
    {
        return empty(403);
    }
    let result = (|| {
        if !matches!(request.method().as_str(), "GET" | "HEAD") {
            return empty(405);
        }
        let Ok(path) = decode_path(request.uri().path()) else {
            return empty(400);
        };
        if crate::access::require(app, &path).is_err() {
            return empty(403);
        }
        let Some(mime) = media_type(&path) else {
            return empty(415);
        };
        let Ok(_guard) = READ_GATE.lock() else {
            return empty(503);
        };
        let Ok(file) = File::open(&path) else {
            return empty(404);
        };
        serve_file(file, &request, mime)
    })();
    let (mut parts, body) = result.into_parts();
    for (key, value) in [
        ("access-control-allow-origin", origin),
        (
            "access-control-expose-headers",
            "Content-Range, Content-Length, Accept-Ranges",
        ),
        ("accept-ranges", "bytes"),
        ("cache-control", "private, no-cache"),
        ("x-content-type-options", "nosniff"),
    ] {
        if let Ok(value) = value.parse() {
            parts.headers.insert(key, value);
        }
    }
    Response::from_parts(parts, body)
}

fn serve_file(mut file: File, request: &Request<Vec<u8>>, mime: &str) -> Response<Vec<u8>> {
    let Ok(metadata) = file.metadata() else {
        return empty(500);
    };
    if !metadata.is_file() {
        return empty(404);
    }
    let len = metadata.len();
    let range = request.headers().get("range");
    let (start, end) = if let Some(range) = range {
        let Ok(range) = range
            .to_str()
            .map_err(|_| ())
            .and_then(|r| byte_range(r, len))
        else {
            return Response::builder()
                .status(416)
                .header("content-range", format!("bytes */{len}"))
                .body(Vec::new())
                .expect("valid range response");
        };
        range
    } else {
        // Browsers use Range for media. Do not allocate gigabytes if a malformed
        // or arbitrary client omits it; HEAD can always inspect the full length.
        if len > READ_AHEAD && request.method() != "HEAD" {
            return empty(400);
        }
        (0, len.saturating_sub(1))
    };
    let length = if len == 0 { 0 } else { end - start + 1 };
    let mut response = Response::builder()
        .status(if range.is_some() { 206 } else { 200 })
        .header("content-type", mime)
        .header("content-length", length);
    if range.is_some() {
        response = response.header("content-range", format!("bytes {start}-{end}/{len}"));
    }
    let mut body = Vec::new();
    if request.method() != "HEAD"
        && (file.seek(SeekFrom::Start(start)).is_err()
            || file.take(length).read_to_end(&mut body).is_err()
            || body.len() as u64 != length)
    {
        return empty(500);
    }
    response.body(body).expect("valid media response")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn ranges_are_seekable_bounded_and_reject_invalid_requests() {
        assert_eq!(byte_range("bytes=0-", 100_000_000), Ok((0, READ_AHEAD - 1)));
        assert_eq!(
            byte_range("bytes=99900000-", 100_000_000),
            Ok((99_900_000, 99_999_999))
        );
        assert_eq!(byte_range("bytes=120-130", 200), Ok((120, 130)));
        assert_eq!(byte_range("bytes=-10", 200), Ok((190, 199)));
        for r in [
            "bytes=200-",
            "bytes=10-2",
            "bytes=-0",
            "bytes=0-1,3-4",
            "bytes=NaN-",
            "bytes=18446744073709551616-",
        ] {
            assert!(byte_range(r, 200).is_err());
        }
        assert!(byte_range("bytes=0-", 0).is_err());
    }
    #[test]
    fn only_absolute_decoded_media_paths_are_accepted() {
        assert_eq!(
            decode_path("/C%3A%5CTest%20video%23%25.mp4"),
            Ok(PathBuf::from("C:\\Test video#%.mp4"))
        );
        for path in [
            "/relative.mp4",
            "/C%3A%5Ctest%5C..%5Csecret.mp4",
            "/C%3A%5Cbad%00.mp4",
            "/C%3A%5Cbad%ZZ.mp4",
        ] {
            assert!(decode_path(path).is_err());
        }
        assert_eq!(media_type(std::path::Path::new("secret.json")), None);
    }
    #[test]
    fn disk_response_preserves_range_bytes_and_head_metadata() {
        let file = std::env::current_exe().unwrap();
        let request = Request::builder()
            .header("range", "bytes=0-1")
            .body(Vec::new())
            .unwrap();
        let response = serve_file(File::open(&file).unwrap(), &request, "video/mp4");
        assert_eq!(response.status(), 206);
        assert_eq!(response.body(), b"MZ");
        let head = Request::builder().method("HEAD").body(Vec::new()).unwrap();
        let response = serve_file(File::open(file).unwrap(), &head, "video/mp4");
        assert!(response.body().is_empty());
        assert!(
            response.headers()["content-length"]
                .to_str()
                .unwrap()
                .parse::<u64>()
                .unwrap()
                > 0
        );
    }
}
