import { convertFileSrc } from "@tauri-apps/api/core";
import type { InputEvent } from "./types";

interface ActivityCandidate {
  ts: number;
  x: number;
  y: number;
  score: number;
}

const cache = new Map<string, Promise<InputEvent[]>>();

function waitFor(video: HTMLVideoElement, event: "loadedmetadata" | "seeked", timeoutMs = 3500): Promise<void> {
  return new Promise((resolve, reject) => {
    if (event === "loadedmetadata" && video.readyState >= HTMLMediaElement.HAVE_METADATA) {
      resolve();
      return;
    }
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for mobile video ${event}.`));
    }, timeoutMs);
    const cleanup = () => {
      window.clearTimeout(timer);
      video.removeEventListener(event, done);
      video.removeEventListener("error", failed);
    };
    const done = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error("Unable to decode mobile video for Auto Zoom.")); };
    video.addEventListener(event, done, { once: true });
    video.addEventListener("error", failed, { once: true });
  });
}

async function seek(video: HTMLVideoElement, seconds: number): Promise<void> {
  if (Math.abs(video.currentTime - seconds) < 0.01 && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) return;
  const ready = waitFor(video, "seeked");
  video.currentTime = seconds;
  await ready;
}

/**
 * Detect localized visual activity in a mobile recording when the capture
 * transport cannot expose touch telemetry (notably iPhone/iPad over UVC).
 * The result is used only by Auto Zoom; it never enters the cursor/click
 * renderer, so analysis anchors cannot appear as fake pointer effects.
 */
export function analyzeMobileVisualActivity(
  videoPath: string,
  sourceWidth: number,
  sourceHeight: number,
  durationMs: number,
): Promise<InputEvent[]> {
  const key = `${videoPath}:${sourceWidth}x${sourceHeight}:${Math.round(durationMs)}`;
  const existing = cache.get(key);
  if (existing) return existing;

  const analysis = (async () => {
    if (durationMs < 1200 || sourceWidth <= 0 || sourceHeight <= 0) return [];
    const video = document.createElement("video");
    video.muted = true;
    video.preload = "auto";
    video.playsInline = true;
    video.src = convertFileSrc(videoPath);
    await waitFor(video, "loadedmetadata");

    const sampleWidth = 96;
    const sampleHeight = Math.max(54, Math.round(sampleWidth * sourceHeight / sourceWidth));
    const canvas = document.createElement("canvas");
    canvas.width = sampleWidth;
    canvas.height = sampleHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return [];

    const durationSeconds = Math.min(video.duration || durationMs / 1000, durationMs / 1000);
    const sampleCount = Math.max(12, Math.min(72, Math.ceil(durationSeconds / 0.45)));
    const candidates: ActivityCandidate[] = [];
    let previous: Uint8ClampedArray | null = null;

    try {
      for (let index = 0; index <= sampleCount; index++) {
        const seconds = Math.min(Math.max(0, durationSeconds - 0.05), (index / sampleCount) * durationSeconds);
        await seek(video, seconds);
        context.drawImage(video, 0, 0, sampleWidth, sampleHeight);
        const pixels = context.getImageData(0, 0, sampleWidth, sampleHeight).data;
        const gray = new Uint8ClampedArray(sampleWidth * sampleHeight);
        for (let pixel = 0, slot = 0; pixel < pixels.length; pixel += 4, slot++) {
          gray[slot] = Math.round(pixels[pixel] * 0.299 + pixels[pixel + 1] * 0.587 + pixels[pixel + 2] * 0.114);
        }
        if (previous) {
          let weight = 0;
          let weightedX = 0;
          let weightedY = 0;
          let changed = 0;
          for (let slot = 0; slot < gray.length; slot++) {
            const difference = Math.abs(gray[slot] - previous[slot]);
            if (difference < 20) continue;
            const x = slot % sampleWidth;
            const y = Math.floor(slot / sampleWidth);
            const localWeight = difference - 19;
            weight += localWeight;
            weightedX += x * localWeight;
            weightedY += y * localWeight;
            changed++;
          }
          const changedRatio = changed / gray.length;
          if (weight > 0 && changedRatio >= 0.0015) {
            const cx = weightedX / weight;
            const cy = weightedY / weight;
            let variance = 0;
            for (let slot = 0; slot < gray.length; slot++) {
              const difference = Math.abs(gray[slot] - previous[slot]);
              if (difference < 20) continue;
              const x = (slot % sampleWidth) - cx;
              const y = Math.floor(slot / sampleWidth) - cy;
              variance += (x * x / (sampleWidth * sampleWidth) + y * y / (sampleHeight * sampleHeight)) * (difference - 19);
            }
            variance /= weight;
            const localization = 1 / (1 + variance * 12);
            const score = (weight / gray.length) * localization * Math.min(1, changedRatio / 0.025);
            candidates.push({
              ts: seconds * 1000,
              x: (cx / sampleWidth) * sourceWidth,
              y: (cy / sampleHeight) * sourceHeight,
              score,
            });
          }
        }
        previous = gray;
      }
    } finally {
      video.removeAttribute("src");
      video.load();
    }

    const ranked = [...candidates].sort((a, b) => b.score - a.score);
    const scoreFloor = ranked[Math.min(ranked.length - 1, Math.max(2, Math.floor(ranked.length * 0.45)))]?.score ?? Infinity;
    const selected: ActivityCandidate[] = [];
    for (const candidate of ranked) {
      if (candidate.score < scoreFloor || candidate.ts < 350 || candidate.ts > durationMs - 450) continue;
      const conflicts = selected.some((current) =>
        Math.abs(current.ts - candidate.ts) < 1800
        || (Math.abs(current.ts - candidate.ts) < 3200
          && Math.hypot(current.x - candidate.x, current.y - candidate.y) < Math.min(sourceWidth, sourceHeight) * 0.12)
      );
      if (!conflicts) selected.push(candidate);
      if (selected.length >= Math.max(2, Math.min(8, Math.ceil(durationSeconds / 7)))) break;
    }

    return selected
      .sort((a, b) => a.ts - b.ts)
      .map((candidate): InputEvent => ({
        ts: candidate.ts,
        type: "mousedown",
        x: candidate.x,
        y: candidate.y,
        key: null,
        button: "left",
      }));
  })().catch(() => []);
  cache.set(key, analysis);
  return analysis;
}
