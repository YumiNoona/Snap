//! Optional editor telemetry: current JSONL and legacy JSON array sidecars.
use serde_json::Value;
use std::io::{BufRead, BufReader};
use std::path::Path;

const MAX_BYTES: u64 = 512 * 1024 * 1024;
const MAX_EVENTS: usize = 5_000_000;

pub(crate) fn read(path: &Path) -> Result<Vec<Value>, String> {
    let file = match std::fs::File::open(path) {
        Ok(file) => file,
        Err(error)
            if matches!(
                error.kind(),
                std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory
            ) =>
        {
            return Ok(Vec::new())
        }
        Err(error) => return Err(format!("Cannot read input log: {error}")),
    };
    let metadata = file.metadata().map_err(|error| error.to_string())?;
    if !metadata.is_file() || metadata.len() > MAX_BYTES {
        return Err("Input log is not a regular file or exceeds 512 MiB".into());
    }
    let mut reader = BufReader::new(file);
    if reader
        .fill_buf()
        .map_err(|error| error.to_string())?
        .starts_with(&[0xef, 0xbb, 0xbf])
    {
        reader.consume(3);
    }
    let mut events = Vec::new();
    let mut complete_value = false;
    // A stream accepts JSONL as well as pretty-printed legacy arrays without
    // mistaking each line of an array or unrelated video metadata for an event.
    for value in serde_json::Deserializer::from_reader(reader).into_iter::<Value>() {
        let value = match value {
            Ok(value) => {
                complete_value = true;
                value
            }
            Err(error) if complete_value && error.is_eof() => break,
            Err(error) => return Err(format!("Input log contains invalid JSON: {error}")),
        };
        match value {
            Value::Array(items) => {
                for event in items {
                    append_event(&mut events, event)?;
                }
            }
            Value::Object(mut object) if object.get("events").is_some_and(Value::is_array) => {
                if let Some(Value::Array(items)) = object.remove("events") {
                    for event in items {
                        append_event(&mut events, event)?;
                    }
                }
            }
            event => append_event(&mut events, event)?,
        }
    }
    Ok(events)
}

fn append_event(events: &mut Vec<Value>, event: Value) -> Result<(), String> {
    let Some(kind) = event.get("type").and_then(Value::as_str) else {
        return Ok(());
    };
    if kind.is_empty() || (kind != "meta" && !event.get("ts").is_some_and(Value::is_number)) {
        return Ok(());
    }
    if events.len() >= MAX_EVENTS {
        return Err("Input log contains too many events".into());
    }
    events.push(event);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn with_log(contents: &[u8], check: impl FnOnce(&Path)) {
        let path = std::env::temp_dir().join(format!(
            "snap-input-log-{}-{}.json",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        std::fs::write(&path, contents).unwrap();
        check(&path);
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn imported_video_without_support_folder_has_no_events() {
        let path = std::env::temp_dir()
            .join(format!("snap-no-sidecar-{}", std::process::id()))
            .join("events.json");
        assert!(read(&path).unwrap().is_empty());
        with_log(b"not a directory", |path| {
            assert!(read(&path.join("events.json")).unwrap().is_empty())
        });
    }
    #[test]
    fn reads_jsonl_and_keeps_complete_events_after_a_recording_crash() {
        with_log(b"{\"type\":\"meta\",\"captureStartMs\":100}\n{\"type\":\"mousedown\",\"ts\":125,\"x\":20,\"y\":40}\n{\"type\":", |path| {
            let events = read(path).unwrap();
            assert_eq!(events.len(), 2);
            assert_eq!(events[1]["ts"], 125);
        });
    }
    #[test]
    fn reads_pretty_legacy_arrays_with_a_utf8_bom() {
        with_log(b"\xef\xbb\xbf[\n {\"type\":\"meta\",\"captureStartMs\":100},\n {\"type\":\"mousemove\",\"ts\":150,\"x\":20,\"y\":40}\n]", |path| {
            let events = read(path).unwrap();
            assert_eq!(events.len(), 2);
            assert_eq!(events[1]["type"], "mousemove");
        });
    }
    #[test]
    fn ignores_unrelated_metadata_and_invalid_event_shapes() {
        with_log(
            b"{\n \"title\":\"Uploaded video\",\n \"duration\":10\n}",
            |path| assert!(read(path).unwrap().is_empty()),
        );
        with_log(b"{\"events\":[null,25,{}, {\"type\":\"mousemove\",\"ts\":\"bad\"}, {\"type\":\"keydown\",\"ts\":20,\"key\":\"a\"}]}", |path| {
            let events = read(path).unwrap();
            assert_eq!(events.len(), 1);
            assert_eq!(events[0]["key"], "a");
        });
    }
    #[test]
    fn reports_middle_corruption_without_modifying_the_sidecar() {
        let data = b"{\"type\":\"meta\"}\ninvalid\n{\"type\":\"keydown\",\"ts\":20}";
        with_log(data, |path| {
            assert!(read(path).unwrap_err().contains("invalid JSON"));
            assert_eq!(std::fs::read(path).unwrap(), data);
        });
    }
}
