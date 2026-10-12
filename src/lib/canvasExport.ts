import { invoke } from "@tauri-apps/api/core";
import type { AudioTrack, CaptionTrack, EditorConfig, ExportSettings, Keyframe } from "./types";
import { createExportCompositor } from "./exportCompositor";
import { captionsToSrt, captionsToVtt } from "./captions";
import { createIvfHeader, wrapIvfFrame, type IvfCodec } from "./ivf";
import { exportPlaybackRate } from "./exportTiming";
import { exportFramePosition, motionSourceFps } from "./exportFramePlan";
import { seekMediaFrame } from "./mediaSeek";
import { ExportWriteBudget } from "./exportWriteBudget";
import { retainedClips, sequenceDuration, sequenceTime, clipSpeed, mapCaptionTracks } from "./videoEditing";

export interface ExportProgress {
  phase: "preparing" | "recording" | "finalizing" | "done" | "error";
  progress: number; // 0-1
  message: string;
}

function canvasToJpeg(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Export frame encoding timed out")), 15_000);
    try { canvas.toBlob((blob) => {
      clearTimeout(timeout);
      if (!blob) {
        reject(new Error("Could not encode an export frame"));
        return;
      }
      void blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject);
    }, "image/jpeg", 0.94); }
    catch (error) { clearTimeout(timeout); reject(error); }
  });
}

async function withTimeout<T>(promise: Promise<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), 30_000);
    })]);
  } finally { clearTimeout(timer); }
}

/**
 * Decodes and composes each output timestamp before encoding it, so slow
 * rendering cannot skip source frames. WebCodecs (or JPEG staging) streams
 * bytes to Rust for final encoding and edited audio/caption delivery.
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
  signal?: AbortSignal,
  renderSourcePath?: string
): Promise<string> {
  const throwIfAborted = () => {
    if (signal?.aborted) throw new DOMException("Export cancelled", "AbortError");
  };
  throwIfAborted();
  onProgress({ phase: "preparing", progress: 0, message: "Preparing export…" });
  const clips = retainedClips(config.videoClips, trimStart, trimEnd);
  if (!clips.length) throw new Error("Keep at least one footage segment before exporting");
  const editedDuration = sequenceDuration(clips);
  const outputCaptions = mapCaptionTracks(captionTracks, clips);

  if (!renderSourcePath && exportSettings.motionInterpolation === "optical-flow" && exportSettings.format !== "gif") {
    const jobId = crypto.randomUUID();
    const cancel = () => { void invoke("cancel_export_motion", { jobId }).catch(() => {}); };
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      onProgress({ phase: "preparing", progress: .01, message: "Analyzing motion for optical flow…" });
      const prepared = await invoke<string>("prepare_export_motion", {
        inputVideo: videoPath, fps: motionSourceFps(clips, exportSettings.fps, exportPlaybackRate(config.playbackRate)), jobId,
      });
      throwIfAborted();
      return await runCanvasExport(videoPath, inputLogPath, keyframes, config, captionTracks, audioTracks, cameraMedia, exportSettings, trimStart, trimEnd, onProgress, signal, prepared);
    } finally {
      signal?.removeEventListener("abort", cancel);
      await invoke("discard_export_motion", { jobId }).catch(() => {});
    }
  }

  const compositor = await createExportCompositor(
    renderSourcePath ?? videoPath,
    inputLogPath,
    keyframes,
    config,
    exportSettings.captions === "burned" || exportSettings.captions === "burned-srt" ? captionTracks : [],
    cameraMedia,
    exportSettings.width,
    exportSettings.height,
    signal,
    exportSettings.captions === "burned" || exportSettings.captions === "burned-srt",
    false,
    true
  );

  const stagingBasePath = exportSettings.outputPath.replace(/\.(mp4|webm|gif)$/i, "");
  let tempWebmPath = stagingBasePath + ".snapexport.ivf";

  let sinkOpen = false;
  let completed = false;
  let encoder: VideoEncoder | null = null;
  let writeQueue: Promise<void> = Promise.resolve();
  try {
    throwIfAborted();
    const hasWebCodecs = typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined";

    const playbackRate = exportPlaybackRate(config.playbackRate);
    const totalMs = editedDuration / playbackRate * 1000;
    const fps = Math.max(1, Math.round(exportSettings.fps));
    const totalFrames = Math.max(1, Math.ceil((totalMs / 1000) * fps));
    const pixelsComparedWith1080p = (exportSettings.width * exportSettings.height) / (1920 * 1080);
    const qualityBitrate = exportSettings.quality === "high" ? 24_000_000 : exportSettings.quality === "medium" ? 8_000_000 : 4_000_000;
    const bitrate = Math.round(Math.max(1_000_000, Math.min(100_000_000, qualityBitrate * pixelsComparedWith1080p * (fps / 60))));
    type EncoderChoice =
      | { config: VideoEncoderConfig; format: "annexb" }
      | { config: VideoEncoderConfig; format: "ivf"; fourCc: IvfCodec };
    const baseConfig = { width: exportSettings.width, height: exportSettings.height, bitrate, framerate: fps };
    const h264Codec = exportSettings.width > 1920 || exportSettings.height > 1080
      ? "avc1.640034"
      : "avc1.64002A";
    const candidates: EncoderChoice[] = [
      { config: { ...baseConfig, codec: h264Codec, avc: { format: "annexb" }, hardwareAcceleration: "prefer-hardware", latencyMode: "quality" }, format: "annexb" },
      { config: { ...baseConfig, codec: h264Codec, avc: { format: "annexb" } }, format: "annexb" },
      { config: { ...baseConfig, codec: "avc1.42002A", avc: { format: "annexb" } }, format: "annexb" },
      { config: { ...baseConfig, codec: "vp8" }, format: "ivf", fourCc: "VP80" },
      { config: { ...baseConfig, codec: "vp09.00.10.08" }, format: "ivf", fourCc: "VP90" },
    ];
    let selected: EncoderChoice | null = null;
    if (hasWebCodecs) {
      for (const candidate of candidates) {
        try {
          const support = await VideoEncoder.isConfigSupported(candidate.config);
          if (support.supported) { selected = candidate; break; }
        } catch { /* try the next Chromium-supported codec */ }
      }
    }
    const exportMode: EncoderChoice | { format: "mjpeg" } = selected ?? { format: "mjpeg" };

    const stagingExtension = exportMode.format === "annexb" ? "h264" : exportMode.format;
    tempWebmPath = `${stagingBasePath}.snapexport.${stagingExtension}`;
    await invoke("open_export_sink", { path: tempWebmPath, outputPath: exportSettings.outputPath });
    sinkOpen = true;

    let writeError: string | null = null;
    const CHUNK_BYTES = 256 * 1024;
    const BATCH_BYTES = 1024 * 1024;
    const writeBudget = new ExportWriteBudget();
    let lastWriteAdvance = performance.now();
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
        try {
          if (writeError || signal?.aborted) return;
          for (let index = 0; index < combined.length; index += CHUNK_BYTES) {
            throwIfAborted();
            const slice = combined.subarray(index, Math.min(combined.length, index + CHUNK_BYTES));
            await withTimeout(invoke("write_export_chunk", slice), "The export destination stopped responding");
            lastWriteAdvance = performance.now();
          }
        } catch (err) {
          writeError = String(err);
        } finally {
          writeBudget.release(combined.byteLength);
        }
      });
    };
    const queueBytes = (bytes: Uint8Array) => {
      if (writeError || signal?.aborted) return;
      const wasEmpty = writeBudget.bytes === 0;
      if (!writeBudget.reserve(bytes.byteLength)) {
        writeError = "The export destination cannot keep up. Choose a faster local drive or lower export quality.";
        return;
      }
      if (wasEmpty) lastWriteAdvance = performance.now();
      pendingParts.push(bytes);
      pendingBytes += bytes.byteLength;
      if (pendingBytes >= BATCH_BYTES) flushPendingBytes();
    };
    if (exportMode.format === "ivf") {
      queueBytes(createIvfHeader(exportSettings.width, exportSettings.height, fps, totalFrames, exportMode.fourCc));
    }

    let encoderError: Error | null = null;
    let encodedFrames = 0;
    if (exportMode.format !== "mjpeg") {
      encoder = new VideoEncoder({
        output: (chunk) => {
          const payload = new Uint8Array(chunk.byteLength);
          chunk.copyTo(payload);
          if (exportMode.format === "ivf") {
            const frameIndex = Math.max(0, Math.round((chunk.timestamp * fps) / 1_000_000));
            queueBytes(wrapIvfFrame(payload, frameIndex));
          } else {
            queueBytes(payload);
          }
          encodedFrames += 1;
        },
        error: (error) => { encoderError = error; },
      });
      encoder.configure(exportMode.config);
    }

    // Decode and draw each timestamp once: rendering speed cannot change
    // motion cadence, even when composition takes longer than a frame.
    let lastClipId = "";
    let lastProgress = -1;
    for (let index = 0; index < totalFrames; index++) {
      throwIfAborted();
      if (encoderError) throw encoderError;
      if (writeError) throw new Error(writeError);
      const position = exportFramePosition(clips, index, fps, playbackRate);
      if (lastClipId !== position.clip.id) {
        compositor.setClip?.(position.clip.id);
        await compositor.prepareClip?.(position.clip.id);
        lastClipId = position.clip.id;
      }
      if (compositor.renderAt) await compositor.renderAt(position.source, position.clip.id, position.sequence);
      else {
        if (!position.clip.gap) await seekMediaFrame(compositor.video, position.source, signal);
        else compositor.setGapTime?.(position.sequence);
        compositor.renderFrame();
      }
      if (index === 0) {
        try { compositor.canvas.getContext("2d")?.getImageData(0, 0, 1, 1); }
        catch { throw new Error("A local video or image could not be prepared for export"); }
      }
      if (exportMode.format === "mjpeg") {
        const payload = await canvasToJpeg(compositor.canvas);
        queueBytes(payload); encodedFrames++;
      } else {
        const frame = new VideoFrame(compositor.canvas, {
          timestamp: Math.round(index * 1_000_000 / fps), duration: Math.round(1_000_000 / fps),
        });
        try { encoder!.encode(frame, { keyFrame: index % Math.max(1, fps * 2) === 0 }); }
        finally { frame.close(); }
      }
      if (encoder && encoder.encodeQueueSize > 12) await withTimeout(encoder.flush(), "The video encoder stopped responding");
      if (writeBudget.shouldPause) { flushPendingBytes(); await writeQueue; }
      if (writeBudget.bytes > 0 && performance.now() - lastWriteAdvance > 30_000) throw new Error("The export destination stopped responding");
      const progress = Math.floor((index + 1) / totalFrames * 96);
      if (progress !== lastProgress) {
        lastProgress = progress;
        onProgress({ phase: "recording", progress: progress / 100, message: "Rendering video frames…" });
      }
    }

    if (encoder) await withTimeout(encoder.flush(), "The video encoder stopped responding");
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
        captionSrt: exportSettings.captions === "embedded" ? captionsToSrt(outputCaptions, 0, editedDuration, playbackRate) : null,
        clickTimesMs: config.cursorStyle.clickSound
          ? clips.filter(c=>!c.gap).flatMap(c => compositor.clickTimesMs.filter(time => time >= c.start * 1000 && time < c.end * 1000).map(time => (sequenceTime(clips, c.start, c.id) * 1000 + (time - c.start * 1000) / clipSpeed(c)) / playbackRate))
          : [],
        audioMix: config.audio,
        audioTracks,
        trimStartSeconds: trimStart,
        exportDurationSeconds: Math.max(0.01, editedDuration / playbackRate),
        sourceSegments: clips.map(c => ({ start: c.start, end: c.end, speed: clipSpeed(c), gap: c.gap ?? false })),
        playbackRate,
      },
    });

    const basePath = exportSettings.outputPath.replace(/\.(mp4|webm|gif)$/i, "");
    if (exportSettings.captions === "srt" || exportSettings.captions === "burned-srt") {
      await invoke("write_text_file_atomic", { path: `${basePath}.srt`, contents: captionsToSrt(outputCaptions, 0, editedDuration, playbackRate) });
    } else if (exportSettings.captions === "vtt") {
      await invoke("write_text_file_atomic", { path: `${basePath}.vtt`, contents: captionsToVtt(outputCaptions, 0, editedDuration, playbackRate) });
    }

    onProgress({ phase: "done", progress: 1, message: result });
    completed = true;
    return result;
  } finally {
    compositor.setFrameConsumer(null);
    compositor.destroy();
    if (encoder && encoder.state !== "closed") encoder.close();
    await writeQueue.catch(() => {});
    if (sinkOpen) await invoke("close_export_sink").catch(() => {});
    if (!completed) {
      await invoke("discard_canvas_export", {
        tempWebmPath,
        outputPath: exportSettings.outputPath,
      }).catch(() => {});
    }
  }
}
