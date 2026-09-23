import { invoke } from "@tauri-apps/api/core";
import type { AudioTrack, CaptionTrack, EditorConfig, ExportSettings, Keyframe } from "./types";
import { createExportCompositor } from "./exportCompositor";
import { captionsToSrt, captionsToVtt } from "./captions";
import { createIvfHeader, wrapIvfFrame, type IvfCodec } from "./ivf";

export interface ExportProgress {
  phase: "preparing" | "recording" | "finalizing" | "done" | "error";
  progress: number; // 0-1
  message: string;
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
  audioTracks: AudioTrack[],
  cameraMedia: { path: string; startOffsetMs: number } | null,
  exportSettings: ExportSettings,
  trimStart: number,
  trimEnd: number,
  onProgress: (p: ExportProgress) => void,
  signal?: AbortSignal
): Promise<string> {
  const throwIfAborted = () => {
    if (signal?.aborted) throw new DOMException("Export cancelled", "AbortError");
  };
  throwIfAborted();
  onProgress({ phase: "preparing", progress: 0, message: "Preparing export…" });

  const compositor = await createExportCompositor(
    videoPath,
    inputLogPath,
    keyframes,
    config,
    exportSettings.captions === "burned" || exportSettings.captions === "burned-srt" ? captionTracks : [],
    cameraMedia,
    exportSettings.width,
    exportSettings.height,
    signal
  );

  const tempWebmPath = exportSettings.outputPath.replace(/\.(mp4|gif)$/i, "") + ".snapexport.ivf";

  let sinkOpen = false;
  let completed = false;
  let encoder: VideoEncoder | null = null;
  let writeQueue: Promise<void> = Promise.resolve();
  try {
    throwIfAborted();
    await invoke("open_export_sink", { path: tempWebmPath, outputPath: exportSettings.outputPath });
    sinkOpen = true;

    if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined") {
      throw new Error("This WebView2 version does not support frame-accurate video export. Update Microsoft Edge WebView2 Runtime and try again.");
    }

    const playbackRate = Math.max(0.5, Math.min(2, config.playbackRate || 1));
    const totalMs = Math.max(1, ((trimEnd - trimStart) / playbackRate) * 1000);
    const fps = Math.max(1, Math.round(exportSettings.fps));
    const totalFrames = Math.max(1, Math.ceil((totalMs / 1000) * fps));
    const pixelsComparedWith1080p = (exportSettings.width * exportSettings.height) / (1920 * 1080);
    const qualityBitrate = exportSettings.quality === "high" ? 12_000_000 : exportSettings.quality === "medium" ? 8_000_000 : 4_000_000;
    const bitrate = Math.round(Math.max(1_000_000, Math.min(50_000_000, qualityBitrate * pixelsComparedWith1080p * (fps / 60))));
    const candidates: Array<{ config: VideoEncoderConfig; fourCc: IvfCodec }> = [
      { config: { codec: "vp8", width: exportSettings.width, height: exportSettings.height, bitrate, framerate: fps, hardwareAcceleration: "prefer-hardware", latencyMode: "quality" }, fourCc: "VP80" },
      { config: { codec: "vp09.00.10.08", width: exportSettings.width, height: exportSettings.height, bitrate, framerate: fps, hardwareAcceleration: "prefer-hardware", latencyMode: "quality" }, fourCc: "VP90" },
    ];
    let selected: { config: VideoEncoderConfig; fourCc: IvfCodec } | null = null;
    for (const candidate of candidates) {
      try {
        const support = await VideoEncoder.isConfigSupported(candidate.config);
        if (support.supported) { selected = candidate; break; }
      } catch { /* try the next Chromium-supported codec */ }
    }
    if (!selected) throw new Error("No WebCodecs VP8/VP9 encoder is available. Update your display driver and Microsoft Edge WebView2 Runtime.");

    let writeError: string | null = null;
    const CHUNK_BYTES = 256 * 1024;
    const BATCH_BYTES = 1024 * 1024;
    let pendingParts: Uint8Array[] = [];
    let pendingBytes = 0;
    const flushPendingBytes = () => {
      if (pendingBytes === 0) return;
      const combined = new Uint8Array(pendingBytes);
      let offset = 0;
      for (const part of pendingParts) { combined.set(part, offset); offset += part.byteLength; }
      pendingParts = [];
      pendingBytes = 0;
      writeQueue = writeQueue.then(async () => {
        if (writeError) return;
        try {
          for (let index = 0; index < combined.length; index += CHUNK_BYTES) {
            const slice = combined.subarray(index, Math.min(combined.length, index + CHUNK_BYTES));
            await invoke("write_export_chunk", { bytes: Array.from(slice) });
          }
        } catch (err) {
          writeError = String(err);
        }
      });
    };
    const queueBytes = (bytes: Uint8Array) => {
      pendingParts.push(bytes);
      pendingBytes += bytes.byteLength;
      if (pendingBytes >= BATCH_BYTES) flushPendingBytes();
    };
    queueBytes(createIvfHeader(exportSettings.width, exportSettings.height, fps, totalFrames, selected.fourCc));

    let encoderError: Error | null = null;
    let encodedFrames = 0;
    encoder = new VideoEncoder({
      output: (chunk) => {
        const payload = new Uint8Array(chunk.byteLength);
        chunk.copyTo(payload);
        const frameIndex = Math.max(0, Math.round((chunk.timestamp * fps) / 1_000_000));
        queueBytes(wrapIvfFrame(payload, frameIndex));
        encodedFrames += 1;
      },
      error: (error) => { encoderError = error; },
    });
    encoder.configure(selected.config);

    // Install the listener before seeking; seeking to the current time may emit nothing.
    if (Math.abs(compositor.video.currentTime - trimStart) > 0.001) {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => { clearTimeout(timeout); compositor.video.removeEventListener("seeked", done); };
        const done = () => { cleanup(); resolve(); };
        const timeout = setTimeout(() => { cleanup(); reject(new Error("Video seek timed out")); }, 15000);
        compositor.video.addEventListener("seeked", done, { once: true });
        compositor.video.currentTime = trimStart;
      });
    }

    compositor.video.defaultPlaybackRate = playbackRate;
    compositor.video.playbackRate = playbackRate;
    let submittedFrames = 0;
    const submitFramesThrough = (targetExclusive: number) => {
      const cappedTarget = Math.min(totalFrames, Math.max(0, targetExclusive));
      while (submittedFrames < cappedTarget) {
        const timestamp = Math.round((submittedFrames * 1_000_000) / fps);
        const duration = Math.round(1_000_000 / fps);
        const frame = new VideoFrame(compositor.canvas, { timestamp, duration });
        encoder!.encode(frame, { keyFrame: submittedFrames % Math.max(1, fps * 2) === 0 });
        frame.close();
        submittedFrames += 1;
      }
    };
    compositor.setFrameConsumer(() => {
      const sourceElapsed = Math.max(0, compositor.video.currentTime - trimStart);
      const exportElapsed = sourceElapsed / playbackRate;
      submitFramesThrough(Math.floor(exportElapsed * fps) + 1);
    });
    await compositor.video.play();

    await new Promise<void>((resolve, reject) => {
      let lastTime = compositor.video.currentTime;
      let lastAdvance = performance.now();
      let heldForEncoder = false;
      const check = () => {
        if (signal?.aborted) {
          reject(new DOMException("Export cancelled", "AbortError"));
          return;
        }
        if (encoderError) {
          reject(encoderError);
          return;
        }
        if (!heldForEncoder && encoder!.encodeQueueSize > 24) {
          compositor.video.pause();
          heldForEncoder = true;
        }
        if (heldForEncoder) {
          lastAdvance = performance.now();
          if (encoder!.encodeQueueSize <= 6) {
            heldForEncoder = false;
            void compositor.video.play().catch((error) => { encoderError = error instanceof Error ? error : new Error(String(error)); });
          }
          requestAnimationFrame(check);
          return;
        }
        if (compositor.video.currentTime !== lastTime) { lastTime = compositor.video.currentTime; lastAdvance = performance.now(); }
        if (compositor.video.error || performance.now() - lastAdvance > 15000) {
          reject(new Error("Export stopped because video playback stalled. Check that the source file is readable."));
          return;
        }
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

    submitFramesThrough(totalFrames);
    await encoder.flush();
    flushPendingBytes();
    await writeQueue;

    if (encoderError) throw encoderError;
    if (writeError) throw new Error(`Export write failed: ${writeError}`);
    if (encodedFrames !== totalFrames) throw new Error(`Video encoder returned ${encodedFrames} of ${totalFrames} requested frames.`);
    await invoke("close_export_sink");
    sinkOpen = false;

    onProgress({ phase: "finalizing", progress: 0.98, message: "Muxing audio & encoding final video…" });
    throwIfAborted();

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
        audioTracks,
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
    completed = true;
    return result;
  } finally {
    compositor.setFrameConsumer(null);
    if (encoder && encoder.state !== "closed") encoder.close();
    await writeQueue.catch(() => {});
    if (sinkOpen) await invoke("close_export_sink").catch(() => {});
    if (!completed) {
      await invoke("discard_canvas_export", {
        tempWebmPath,
        outputPath: exportSettings.outputPath,
      }).catch(() => {});
    }
    compositor.destroy();
  }
}
