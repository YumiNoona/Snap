import { invoke } from "@tauri-apps/api/core";
import type { CaptionTrack, EditorConfig, ExportSettings, Keyframe } from "./types";
import { createExportCompositor } from "./exportCompositor";
import { captionsToSrt, captionsToVtt } from "./captions";

export interface ExportProgress {
  phase: "preparing" | "recording" | "finalizing" | "done" | "error";
  progress: number; // 0-1
  message: string;
}

function pickMimeType(): string {
  const candidates = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
  for (const c of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported?.(c)) return c;
  }
  return "video/webm";
}

/**
 * Runs the full canvas-accurate export: plays the recording in real time
 * through the same compositor Preview uses, captures the composited canvas
 * via MediaRecorder, streams the encoded bytes to a temp file on disk, then
 * asks Rust to mux the original audio in and transcode to the requested
 * output format. The result is a true match of what the editor shows —
 * cursor, background, pan/zoom, and styling are all already baked into the
 * recorded frames.
 */
export async function runCanvasExport(
  videoPath: string,
  inputLogPath: string,
  keyframes: Keyframe[],
  config: EditorConfig,
  captionTracks: CaptionTrack[],
  exportSettings: ExportSettings,
  trimStart: number,
  trimEnd: number,
  onProgress: (p: ExportProgress) => void
): Promise<string> {
  onProgress({ phase: "preparing", progress: 0, message: "Preparing export…" });

  const compositor = await createExportCompositor(
    videoPath,
    inputLogPath,
    keyframes,
    config,
    exportSettings.captions === "burned" || exportSettings.captions === "burned-srt" ? captionTracks : [],
    exportSettings.width,
    exportSettings.height
  );

  const tempWebmPath = exportSettings.outputPath.replace(/\.(mp4|gif)$/i, "") + ".snapexport.webm";

  let sinkOpen = false;
  try {
    await invoke("open_export_sink", { path: tempWebmPath });
    sinkOpen = true;

    const stream = compositor.canvas.captureStream(exportSettings.fps);
    const recorder = new MediaRecorder(stream, {
      mimeType: pickMimeType(),
      videoBitsPerSecond: 12_000_000,
    });

    // Chunks must land on disk in the order they were produced — chain
    // each write onto the previous one instead of firing them in parallel.
    let writeQueue: Promise<void> = Promise.resolve();
    let writeError: string | null = null;
    const CHUNK_BYTES = 256 * 1024;

    recorder.ondataavailable = (e: BlobEvent) => {
      if (e.data.size === 0) return;
      writeQueue = writeQueue.then(async () => {
        if (writeError) return;
        try {
          const buf = new Uint8Array(await e.data.arrayBuffer());
          for (let i = 0; i < buf.length; i += CHUNK_BYTES) {
            const slice = buf.subarray(i, Math.min(buf.length, i + CHUNK_BYTES));
            await invoke("write_export_chunk", { bytes: Array.from(slice) });
          }
        } catch (err) {
          writeError = String(err);
        }
      });
    };

    const stopped = new Promise<void>((resolve, reject) => {
      recorder.addEventListener("stop", () => resolve(), { once: true });
      recorder.addEventListener("error", (e: Event) => {
        const err = (e as unknown as { error?: Error }).error;
        reject(err ?? new Error("MediaRecorder error"));
      }, { once: true });
    });

    const playbackRate = Math.max(0.5, Math.min(2, config.playbackRate || 1));

    // Seek to the trim start before recording begins.
    compositor.video.currentTime = trimStart;
    await new Promise<void>((resolve) => {
      compositor.video.addEventListener("seeked", () => resolve(), { once: true });
    });

    compositor.video.defaultPlaybackRate = playbackRate;
    compositor.video.playbackRate = playbackRate;
    recorder.start(250);
    await compositor.video.play();

    const totalMs = Math.max(1, (trimEnd - trimStart) * 1000);

    await new Promise<void>((resolve, reject) => {
      const check = () => {
        if (writeError) {
          reject(new Error(writeError));
          return;
        }
        if (compositor.video.ended || compositor.video.currentTime >= trimEnd) {
          compositor.video.pause();
          resolve();
          return;
        }
        const elapsedMs = Math.max(0, (compositor.video.currentTime - trimStart) * 1000);
        onProgress({
          phase: "recording",
          progress: Math.min(0.97, elapsedMs / totalMs),
          message: "Recording composited frames…",
        });
        requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    });

    recorder.stop();
    await stopped;
    await writeQueue;

    if (writeError) throw new Error(`Export write failed: ${writeError}`);

    await invoke("close_export_sink");
    sinkOpen = false;

    onProgress({ phase: "finalizing", progress: 0.98, message: "Muxing audio & encoding final video…" });

    const result = await invoke<string>("finalize_canvas_export", {
      request: {
        tempWebmPath,
        inputVideo: videoPath,
        exportSettings,
        captionSrt: exportSettings.captions === "embedded" ? captionsToSrt(captionTracks, trimStart, trimEnd, playbackRate) : null,
        clickTimesMs: config.cursorStyle.clickSound
          ? compositor.clickTimesMs.filter((time) => time >= trimStart * 1000 && time <= trimEnd * 1000).map((time) => (time - trimStart * 1000) / playbackRate)
          : [],
        audioMix: config.audio,
        trimStartSeconds: trimStart,
        exportDurationSeconds: Math.max(0.01, (trimEnd - trimStart) / playbackRate),
        playbackRate,
      },
    });

    const basePath = exportSettings.outputPath.replace(/\.(mp4|gif)$/i, "");
    if (exportSettings.captions === "srt" || exportSettings.captions === "burned-srt") {
      await invoke("write_text_file_atomic", { path: `${basePath}.srt`, contents: captionsToSrt(captionTracks, trimStart, trimEnd, playbackRate) });
    } else if (exportSettings.captions === "vtt") {
      await invoke("write_text_file_atomic", { path: `${basePath}.vtt`, contents: captionsToVtt(captionTracks, trimStart, trimEnd, playbackRate) });
    }

    onProgress({ phase: "done", progress: 1, message: result });
    return result;
  } finally {
    if (sinkOpen) await invoke("close_export_sink").catch(() => {});
    compositor.destroy();
  }
}
