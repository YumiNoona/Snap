//! Editor-only, bounded cached derivatives. Never used by capture loops.
use crate::{access, process::background_command, recording_session};
use std::{
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
    time::{Duration, Instant, SystemTime},
};
use tauri::Manager;
static CACHE_GATE: Mutex<()> = Mutex::new(());
static GENERATION: AtomicU64 = AtomicU64::new(0);
#[tauri::command]
pub fn cancel_editor_cached_media() {
    GENERATION.fetch_add(1, Ordering::Relaxed);
}
fn recording_active() -> bool {
    recording_session::get_recording_session_state()
        .ok()
        .flatten()
        .is_some()
}

// FFprobe emits one selected metadata value. Drain a bounded amount of output
// on a reader thread while polling cancellation; never wait indefinitely.
fn probe_output(command: &mut std::process::Command, generation: u64) -> Result<Vec<u8>, String> {
    probe_output_with_timeout(command, generation, Duration::from_secs(15))
}

fn probe_output_with_timeout(command: &mut std::process::Command, generation: u64, timeout: Duration) -> Result<Vec<u8>, String> {
    use std::io::Read;
    use std::process::Stdio;
    let mut child = command.stdout(Stdio::piped()).stderr(Stdio::null()).spawn()
        .map_err(|_| "Media metadata is unavailable".to_string())?;
    let stdout = child.stdout.take().ok_or("Metadata output is unavailable")?;
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        // Drain the entire pipe even after the bounded capture fills. Closing
        // early would break FFmpeg's metadata writer on long recordings.
        let mut stream=stdout;
        let mut buffer=[0u8;8192];
        loop {let count=stream.read(&mut buffer)?;if count==0 {break;}let remaining=(1024*1024usize).saturating_sub(bytes.len());bytes.extend_from_slice(&buffer[..count.min(remaining)]);}
        Ok::<_,std::io::Error>(bytes)
    });
    let started = Instant::now();
    let result = loop {
        if generation != GENERATION.load(Ordering::Relaxed) || recording_active() {
            break Err("Metadata preparation cancelled".to_string());
        }
        if started.elapsed() >= timeout {
            break Err("Media metadata preparation timed out".to_string());
        }
        match child.try_wait() {
            Ok(Some(status)) => break if status.success() { Ok(()) } else { Err("Media metadata is unavailable".into()) },
            Ok(None) => std::thread::sleep(Duration::from_millis(50)),
            Err(_) => break Err("Media metadata preparation failed".into()),
        }
    };
    if result.is_err() { let _ = child.kill(); }
    let _ = child.wait();
    let bytes = reader.join().map_err(|_| "Metadata reader failed".to_string())?
        .map_err(|_| "Metadata output is unavailable".to_string())?;
    result.map(|_| bytes)
}

#[tauri::command]
pub fn editor_media_fingerprint(app: tauri::AppHandle, path: String) -> Result<String, String> {
    access::require(&app, Path::new(&path))?;
    let metadata = std::fs::metadata(path).map_err(|_| "Media is unavailable")?;
    let modified = metadata.modified().map_err(|_| "Media modification time is unavailable")?
        .duration_since(SystemTime::UNIX_EPOCH).map_err(|_| "Media modification time is unavailable")?;
    Ok(format!("{}:{}", metadata.len(), modified.as_nanos()))
}

#[tauri::command]
pub async fn editor_source_frame_rate(app: tauri::AppHandle, path: String) -> Result<f64, String> {
    access::require(&app, Path::new(&path))?;
    let generation = GENERATION.load(Ordering::Relaxed);
    tauri::async_runtime::spawn_blocking(move || {
        let output = probe_output(background_command("ffprobe")
            .args([
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "stream=avg_frame_rate",
                "-of",
                "default=noprint_wrappers=1:nokey=1",
            ])
            .arg(path), generation)?;
        let text = String::from_utf8_lossy(&output);
        let mut parts = text.trim().split('/');
        let numerator = parts
            .next()
            .and_then(|s| s.parse::<f64>().ok())
            .unwrap_or(0.0);
        let denominator = parts
            .next()
            .and_then(|s| s.parse::<f64>().ok())
            .unwrap_or(1.0);
        let rate = numerator / denominator;
        if !rate.is_finite() || !(1.0..=240.0).contains(&rate) {
            Err("Frame rate is unavailable".into())
        } else {
            Ok(rate)
        }
    })
    .await
    .map_err(|_| "Frame rate worker failed".to_string())?
}

#[tauri::command]
pub async fn editor_cached_media(
    app: tauri::AppHandle,
    path: String,
    kind: String,
    voice: Option<VoicePolish>,
) -> Result<String, String> {
    let generation = GENERATION.load(Ordering::Relaxed);
    let source = PathBuf::from(path);
    access::require(&app, &source)?;
    if !["proxy", "thumbnails", "voice"].contains(&kind.as_str()) || !source.is_file() {
        return Err("This preview media request is not supported".into());
    }
    tauri::async_runtime::spawn_blocking(move|| {
        let _guard=CACHE_GATE.lock().map_err(|_|"Preview cache is unavailable")?;
        if recording_active()||generation!=GENERATION.load(Ordering::Relaxed) {return Err("Preview preparation is paused while recording".into());}
        let metadata=source.metadata().map_err(|e|e.to_string())?;
        let mut hasher=std::collections::hash_map::DefaultHasher::new();
        source.hash(&mut hasher);metadata.len().hash(&mut hasher);metadata.modified().ok().hash(&mut hasher);kind.hash(&mut hasher);"v3".hash(&mut hasher);
        let cache=app.path().app_cache_dir().map_err(|e|e.to_string())?.join("editor-media");std::fs::create_dir_all(&cache).map_err(|e|e.to_string())?;
        let voice_filter=voice.as_ref().map(voice_filter).transpose()?;
        voice_filter.hash(&mut hasher);
        let extension=if kind=="proxy" {"mp4"} else if kind=="voice" {"wav"} else {"jpg"};
        let output=cache.join(format!("{}-{:016x}.{extension}",kind,hasher.finish()));
        if !output.is_file() {
            let temporary=output.with_extension(format!("part.{extension}"));
            let mut command=background_command("ffmpeg");
            command.args(["-y","-v","error","-threads","2","-i"]).arg(&source);
            if kind=="proxy" {command.args(["-map","0:v:0","-map","0:a:0?","-c:a","aac","-b:a","128k","-vf","scale='min(960,iw)':-2","-c:v","libx264","-preset","veryfast","-crf","24","-pix_fmt","yuv420p","-threads","2","-movflags","+faststart"]);}
            else if kind=="voice" {
                let filter=voice_filter.as_ref().ok_or("Voice settings are missing")?;
                command.args(["-vn","-map","0:a:0","-af"]).arg(filter).args(["-ar","48000","-c:a","pcm_s16le"]);
            } else {
                let probe=probe_output(background_command("ffprobe").args(["-v","error","-show_entries","format=duration","-of","default=noprint_wrappers=1:nokey=1"]).arg(&source),generation)?;
                let duration=String::from_utf8_lossy(&probe).trim().parse::<f64>().ok().filter(|d|d.is_finite()&&*d>0.0).ok_or("Thumbnail duration is unavailable")?;
                command.args(["-an","-vf"]).arg(format!("fps={:.9},scale=160:-2,tile=10x1",10.0/duration)).args(["-frames:v","1","-q:v","4"]);
            }
            let mut child=command.stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null()).arg(&temporary).spawn().map_err(|_|"Unable to start preview preparation. Install FFmpeg in recorder settings.")?;
            let started=Instant::now();
            let deadline=Duration::from_secs(if kind=="proxy" || kind=="voice" {3600} else {120});
            let completed=loop {
                if started.elapsed()>=deadline {let _=child.kill();let _=child.wait();break Err("Preview preparation timed out. Continue using the original video.".to_string());}
                if recording_active()||generation!=GENERATION.load(Ordering::Relaxed) {let _=child.kill();let _=child.wait();break Err("Preview preparation stopped".to_string());}
                match child.try_wait(){Ok(Some(status))=>break if status.success(){Ok(())}else{Err("The preview could not be prepared. Continue using the original video.".into())},Ok(None)=>std::thread::sleep(Duration::from_millis(100)),Err(_)=>{let _=child.kill();let _=child.wait();break Err("Preview preparation stopped unexpectedly".into());}}
            };
            if let Err(error)=completed {let _=std::fs::remove_file(&temporary);return Err(error);}
            std::fs::rename(&temporary,&output).map_err(|e|e.to_string())?;
            prune_cache(&cache,&output);
        }
        app.asset_protocol_scope().allow_file(&output).map_err(|e|e.to_string())?;
        Ok(output.to_string_lossy().into_owned())
    }).await.map_err(|_|"Preview preparation worker failed".to_string())?
}

#[derive(serde::Deserialize)]
#[serde(rename_all="camelCase")]
pub struct VoicePolish { strength:f64, hum:String, room_tail:bool, loudness:bool }
fn voice_filter(settings:&VoicePolish)->Result<String,String> {
    if !settings.strength.is_finite() || !["off","50","60"].contains(&settings.hum.as_str()) {return Err("Invalid voice settings".into());}
    let strength=settings.strength.clamp(0.0,1.0);
    let mut filters=vec!["highpass=f=70".to_string(),format!("afftdn=nr={:.2}:nf=-40:tn=1:gs=6",3.0+15.0*strength),format!("deesser=i={:.3}:m=0.35",strength*0.4),format!("acompressor=threshold=0.125:ratio={:.3}:attack=15:release=180:makeup=1.4",1.0+strength*2.0)];
    if settings.hum!="off" {filters.push(format!("bandreject=f={}:t=h:w=8",settings.hum));}
    // Gentle downward expansion attenuates quiet room tails; this is not a
    // de-reverberation model and does not pretend to reconstruct dry speech.
    if settings.room_tail {filters.push("agate=threshold=0.015:ratio=1.5:attack=10:release=220:range=0.3".into());}
    if settings.loudness {filters.push("loudnorm=I=-16:TP=-1.5:LRA=11".into());}
    filters.push("alimiter=limit=0.95:level=0".into());
    Ok(filters.join(","))
}

#[derive(serde::Serialize)]
pub struct SilenceRange { start:f64, end:f64 }
fn parse_silence_metadata(text:&str)->Vec<SilenceRange> {
    let mut start=None;
    let mut ranges=Vec::new();
    for line in text.lines(){
        if let Some(value)=line.strip_prefix("lavfi.silence_start=").and_then(|s|s.parse::<f64>().ok()).filter(|n|n.is_finite()&&*n>=0.0){start=Some(value);}
        if let Some(end)=line.strip_prefix("lavfi.silence_end=").and_then(|s|s.parse::<f64>().ok()).filter(|n|n.is_finite()&&*n>=0.0){
            if let Some(start)=start.take(){if end-start>=0.8 {ranges.push(SilenceRange{start:start+0.15,end:end-0.15});}}
        }
        if ranges.len()>=500 {break;}
    }
    ranges
}
#[tauri::command]
pub async fn editor_silence_ranges(app:tauri::AppHandle,path:String)->Result<Vec<SilenceRange>,String>{
    let source=PathBuf::from(path);access::require(&app,&source)?;
    let generation=GENERATION.load(Ordering::Relaxed);
    tauri::async_runtime::spawn_blocking(move||{
        let _guard=CACHE_GATE.lock().map_err(|_|"Analysis cache unavailable")?;
        let mut command=background_command("ffmpeg");
        command.args(["-v","error","-threads","2","-i"]).arg(source).args(["-vn","-map","0:a:0","-af","silencedetect=n=-35dB:d=0.8,ametadata=print:file=-","-f","null","NUL"]);
        let output=probe_output_with_timeout(&mut command,generation,Duration::from_secs(600))?;
        Ok(parse_silence_metadata(&String::from_utf8_lossy(&output)))
    }).await.map_err(|_|"Silence analysis worker failed".to_string())?
}
fn prune_cache(cache: &Path, current: &Path) {
    let mut files = std::fs::read_dir(cache)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter_map(|e| e.metadata().ok().map(|m| (e.path(), m)))
        .filter(|(p, m)| m.is_file() && p != current)
        .collect::<Vec<_>>();
    files.sort_by_key(|(_, m)| m.modified().ok());
    let mut bytes = files.iter().map(|(_, m)| m.len()).sum::<u64>();
    let count = files.len();
    for (i, (path, metadata)) in files.into_iter().enumerate() {
        if bytes < 2 * 1024 * 1024 * 1024 && count - i < 32 {
            break;
        }
        if std::fs::remove_file(&path).is_ok() {
            bytes = bytes.saturating_sub(metadata.len());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    #[ignore = "Requires FFmpeg on PATH; validates the complete voice-polish chain"]
    fn voice_polish_chain_renders_with_ffmpeg(){
        for hum in ["off","50","60"] {
            let filter=voice_filter(&VoicePolish{strength:0.7,hum:hum.into(),room_tail:true,loudness:true}).unwrap();
            let result=background_command("ffmpeg").args(["-v","error","-f","lavfi","-i","sine=frequency=440:duration=2","-af",&filter,"-ar","48000","-f","null","NUL"]).output().unwrap();
            assert!(result.status.success(),"{}",String::from_utf8_lossy(&result.stderr));
        }
    }
    #[test]
    #[ignore = "Requires FFmpeg on PATH; validates silence metadata extraction"]
    fn silence_analysis_reads_real_ffmpeg_metadata(){
        let result=background_command("ffmpeg").args(["-v","error","-f","lavfi","-i","sine=frequency=440:duration=4","-af","volume=enable='between(t,1,3)':volume=0,silencedetect=n=-35dB:d=0.8,ametadata=print:file=-","-f","null","NUL"]).output().unwrap();
        assert!(result.status.success(),"{}",String::from_utf8_lossy(&result.stderr));
        let ranges=parse_silence_metadata(&String::from_utf8_lossy(&result.stdout));
        assert_eq!(ranges.len(),1);assert!((ranges[0].start-1.15).abs()<0.06);assert!((ranges[0].end-2.85).abs()<0.06);
    }
    #[test]
    fn silence_metadata_keeps_breathing_margins(){
        let ranges=parse_silence_metadata("lavfi.silence_start=1\nlavfi.silence_end=3\nlavfi.silence_start=NaN\nlavfi.silence_end=4");
        assert_eq!(ranges.len(),1);assert_eq!(ranges[0].start,1.15);assert_eq!(ranges[0].end,2.85);
    }
    #[test]
    fn voice_settings_are_validated_and_filter_strength_bounded(){
        let filter=voice_filter(&VoicePolish{strength:2.0,hum:"50".into(),room_tail:true,loudness:true}).unwrap();
        assert!(filter.contains("nr=18.00"));assert!(filter.contains("bandreject=f=50"));assert!(filter.contains("loudnorm"));
        assert!(voice_filter(&VoicePolish{strength:f64::NAN,hum:"off".into(),room_tail:false,loudness:false}).is_err());
    }
    #[test]
    fn metadata_probe_times_out_and_reaps_the_process() {
        let started = Instant::now();
        let mut command = background_command("powershell.exe");
        command.args(["-NoProfile", "-NonInteractive", "-Command", "Start-Sleep -Seconds 10"]);
        let result = probe_output_with_timeout(&mut command, GENERATION.load(Ordering::Relaxed), Duration::from_millis(100));
        assert!(result.unwrap_err().contains("timed out"));
        assert!(started.elapsed() < Duration::from_secs(3));
    }
    #[test]
    fn stale_metadata_generation_cancels_before_waiting() {
        let mut command = background_command("powershell.exe");
        command.args(["-NoProfile", "-NonInteractive", "-Command", "Start-Sleep -Seconds 10"]);
        let result = probe_output(&mut command, GENERATION.load(Ordering::Relaxed).wrapping_add(1));
        assert!(result.unwrap_err().contains("cancelled"));
    }
}
