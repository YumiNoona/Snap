import { invoke } from "@tauri-apps/api/core";
import type { AudioTrack, AudioTrackKind, CaptionSegment, CaptionTrack } from "./types";
import { recordingDataPaths } from "./recordingPaths";

export type TranscriptionLanguage = "auto" | "en" | "hi";

export interface TranscriptionEnvironment {
  available: boolean;
  executablePath: string | null;
  modelPath: string | null;
  message: string;
}

interface NativeTranscriptionResult {
  language: string;
  sourcePath: string;
  segments: Array<{ startMs: number; endMs: number; text: string }>;
}

const MAX_CAPTION_WORDS = 7;
const MAX_CAPTION_CHARS = 42;
const MAX_CAPTION_DURATION_MS = 3_500;
const MIN_READABLE_CAPTION_MS = 650;
const SHORT_CAPTION_MERGE_GAP_MS = 250;

/** Turns Whisper's variable-length phrases into readable, movable subtitle cards. */
export function chunkCaptionSegments(segments: NativeTranscriptionResult["segments"]): NativeTranscriptionResult["segments"] {
  const chunked = segments.flatMap((segment) => {
    const words = segment.text.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0 || segment.endMs <= segment.startMs) return [];
    const chunks: string[] = [];
    let current = "";
    for (const word of words) {
      const candidate = current ? `${current} ${word}` : word;
      if (current && (candidate.length > MAX_CAPTION_CHARS || current.split(/\s+/).length >= MAX_CAPTION_WORDS)) {
        chunks.push(current);
        current = word;
      } else {
        current = candidate;
      }
    }
    if (current) chunks.push(current);

    const duration = segment.endMs - segment.startMs;
    const timed: typeof segments = [];
    for (const chunk of chunks) {
      const subdivisions = Math.max(1, Math.ceil((duration * chunk.split(/\s+/).length / words.length) / MAX_CAPTION_DURATION_MS));
      if (subdivisions === 1) timed.push({ startMs: 0, endMs: 0, text: chunk });
      else {
        const subWords = chunk.split(/\s+/);
        const per = Math.ceil(subWords.length / subdivisions);
        for (let i = 0; i < subWords.length; i += per) timed.push({ startMs: 0, endMs: 0, text: subWords.slice(i, i + per).join(" ") });
      }
    }
    let cursor = segment.startMs;
    const totalWeight = timed.reduce((sum, item) => sum + item.text.length, 0);
    return timed.map((item, index) => {
      const endMs = index === timed.length - 1 ? segment.endMs : Math.min(segment.endMs, cursor + Math.max(350, Math.round(duration * item.text.length / totalWeight)));
      const result = { ...item, startMs: cursor, endMs };
      cursor = endMs;
      return result;
    });
  });
  return normalizeCaptionTimeline(chunked);
}

const AUDIO_FILENAMES: Record<Exclude<AudioTrackKind, "imported">, string> = {
  microphone: "mic_audio.wav",
  system: "system_audio.wav",
  device: "device_audio.wav",
};

interface DirectoryEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
}

export function audioTrackPath(videoPath: string, kind: AudioTrackKind): string {
  if (kind === "imported") return recordingDataPaths(videoPath).dataDir;
  return `${recordingDataPaths(videoPath).dataDir}\\${AUDIO_FILENAMES[kind]}`;
}

export function createAudioTrack(videoPath: string, kind: AudioTrackKind): AudioTrack {
  const labels: Record<AudioTrackKind, string> = { microphone: "Microphone", system: "System audio", device: "Device audio", imported: "Imported audio" };
  return { id: `audio-${kind}`, kind, path: audioTrackPath(videoPath, kind), label: labels[kind], muted: false, volume: 1 };
}

/**
 * Find the editable WAV sidecars that actually exist for a recording.
 *
 * This is intentionally the single discovery path used by playback, the
 * timeline, captions, project persistence, and export UI. A 44-byte WAV is
 * only a header and therefore is not exposed as a playable track.
 */
export async function discoverAudioTracks(videoPath: string): Promise<AudioTrack[]> {
  const dataDir = recordingDataPaths(videoPath).dataDir;
  let entries: DirectoryEntry[];
  try {
    entries = await invoke<DirectoryEntry[]>("list_directory", { path: dataDir });
  } catch {
    return [];
  }

  const files = new Map(
    entries
      .filter((entry) => !entry.is_dir && entry.size > 44)
      .map((entry) => [entry.name.toLowerCase(), entry] as const)
  );

  // A mobile/device capture can retain an embedded stream and an extracted
  // device WAV. It is the primary desktop-equivalent track and must replace,
  // not stack with, system audio to avoid doubled playback/export.
  const primaryKind: Exclude<AudioTrackKind, "imported" | "microphone"> = files.has(AUDIO_FILENAMES.device) ? "device" : "system";
  return ([primaryKind, "microphone"] as Array<Exclude<AudioTrackKind, "imported">>)
    .flatMap((kind) => {
      const entry = files.get(AUDIO_FILENAMES[kind]);
      if (!entry) return [];
      return [{ ...createAudioTrack(videoPath, kind), path: entry.path }];
    });
}

export function mergeAudioTracks(discovered: AudioTrack[], saved: AudioTrack[]): AudioTrack[] {
  const savedByKind = new Map(saved.map((track) => [track.kind, track]));
  const refreshed = discovered.map((track) => {
    const previous = savedByKind.get(track.kind);
    return previous
      ? { ...track, id: previous.id || track.id, label: previous.label || track.label, muted: previous.muted, volume: previous.volume }
      : track;
  });
  const imported = saved.filter((track) => track.kind === "imported" && track.path.trim());
  return [...refreshed, ...imported.filter((track, index) => imported.findIndex((candidate) => candidate.path.toLowerCase() === track.path.toLowerCase()) === index)];
}

/**
 * Whisper can return adjacent phrases with slightly overlapping timestamps.
 * Canvas lookup intentionally draws one caption at a time, so an overlap can
 * hide the newer phrase completely. Keep the speech-aligned starts, trim the
 * previous phrase at the hand-off. Very short word-level results are merged
 * into a neighboring card instead of being discarded: losing a 100 ms card
 * means losing an actual spoken word.
 */
export function normalizeCaptionTimeline(
  segments: NativeTranscriptionResult["segments"],
): NativeTranscriptionResult["segments"] {
  const ordered = segments
    .filter((segment) => segment.text.trim() && segment.endMs > segment.startMs)
    .map((segment) => ({ ...segment, startMs: Math.max(0, Math.round(segment.startMs)), endMs: Math.max(0, Math.round(segment.endMs)) }))
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const result: NativeTranscriptionResult["segments"] = [];
  for (const segment of ordered) {
    const current = { ...segment };
    const previous = result[result.length - 1];
    if (previous && current.startMs < previous.endMs) {
      if (current.startMs > previous.startMs) {
        previous.endMs = current.startMs;
      } else {
        current.startMs = previous.endMs;
      }
    }
    if (current.endMs <= current.startMs) {
      if (previous) {
        previous.text = `${previous.text.trim()} ${current.text.trim()}`;
        previous.endMs = Math.max(previous.endMs, current.endMs);
      }
      continue;
    }

    const updatedPrevious = result[result.length - 1];
    if (updatedPrevious) {
      const gap = current.startMs - updatedPrevious.endMs;
      const previousDuration = updatedPrevious.endMs - updatedPrevious.startMs;
      const currentDuration = current.endMs - current.startMs;
      if (gap <= SHORT_CAPTION_MERGE_GAP_MS
        && (previousDuration < MIN_READABLE_CAPTION_MS || currentDuration < MIN_READABLE_CAPTION_MS)) {
        updatedPrevious.text = `${updatedPrevious.text.trim()} ${current.text.trim()}`;
        updatedPrevious.endMs = Math.max(updatedPrevious.endMs, current.endMs);
        continue;
      }
    }
    result.push(current);
  }
  return result;
}

/** Finds a non-overlapping slot for a duplicated caption, preferring later time. */
export function findAvailableCaptionStart(
  segments: Array<{ id: string; startMs: number; endMs: number }>,
  excludedId: string,
  durationMs: number,
  rangeStartMs: number,
  rangeEndMs: number,
  preferredStartMs: number,
  gapMs = 100,
): number | null {
  const duration = Math.max(100, Math.round(durationMs));
  const start = Math.max(0, Math.round(rangeStartMs));
  const end = Math.max(start, Math.round(rangeEndMs));
  const occupied = segments
    .filter((segment) => segment.id !== excludedId && segment.endMs > start && segment.startMs < end)
    .map((segment) => ({ startMs: Math.max(start, segment.startMs), endMs: Math.min(end, segment.endMs) }))
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  const search = (from: number, until: number): number | null => {
    let cursor = Math.max(start, from);
    for (const segment of occupied) {
      if (segment.endMs + gapMs <= cursor) continue;
      if (segment.startMs - gapMs >= cursor + duration && cursor + duration <= until) return cursor;
      cursor = Math.max(cursor, segment.endMs + gapMs);
      if (cursor + duration > until) return null;
    }
    return cursor + duration <= until ? cursor : null;
  };

  const preferred = Math.max(start, Math.min(end, Math.round(preferredStartMs)));
  return search(preferred, end) ?? search(start, preferred);
}

/** Applies inspector timing edits without crossing neighboring captions. */
export function updateCaptionTiming(
  segments: CaptionSegment[],
  segmentId: string,
  edge: "start" | "end",
  requestedMs: number,
  rangeStartMs = 0,
  rangeEndMs = Number.POSITIVE_INFINITY,
): CaptionSegment[] {
  const ordered = [...segments].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const index = ordered.findIndex((segment) => segment.id === segmentId);
  if (index < 0 || !Number.isFinite(requestedMs)) return ordered;
  const current = ordered[index];
  const previous = index > 0 ? ordered[index - 1] : null;
  const next = index < ordered.length - 1 ? ordered[index + 1] : null;
  const minimumStart = Math.max(0, rangeStartMs, previous?.endMs ?? 0);
  const maximumEnd = Math.min(rangeEndMs, next?.startMs ?? Number.POSITIVE_INFINITY);
  if (edge === "start") {
    const latestStart = current.endMs - 100;
    if (latestStart < minimumStart) return ordered;
    ordered[index] = {
      ...current,
      startMs: Math.round(Math.max(minimumStart, Math.min(latestStart, requestedMs))),
      userEdited: true,
    };
  } else {
    const earliestEnd = current.startMs + 100;
    if (maximumEnd < earliestEnd) return ordered;
    ordered[index] = {
      ...current,
      endMs: Math.round(Math.max(earliestEnd, Math.min(maximumEnd, requestedMs))),
      userEdited: true,
    };
  }
  return ordered;
}

export async function getTranscriptionEnvironment(): Promise<TranscriptionEnvironment> {
  return invoke("transcription_environment");
}

export async function transcribeTrack(track: AudioTrack, language: TranscriptionLanguage): Promise<CaptionTrack> {
  const result = await invoke<NativeTranscriptionResult>("transcribe_audio", {
    request: { audioPath: track.path, language },
  });
  const sourceTrackIds = [track.id];
  const segments: CaptionSegment[] = chunkCaptionSegments(result.segments).map((segment, index) => ({
    ...segment,
    id: `caption-${segment.startMs}-${index}`,
    language: result.language || language,
    sourceTrackIds,
    userEdited: false,
  }));
  return {
    id: `captions-${Date.now()}`,
    name: `${track.label} captions`,
    language: result.language || language,
    sourceTrackIds,
    visible: true,
    burnedIn: true,
    style: {
      fontFamily: "Arial", fontSize: 42, fontWeight: 700, color: "#ffffff",
      backgroundColor: "rgba(0,0,0,0.68)", outlineColor: "#000000", outlineWidth: 2,
      shadow: true, align: "center", x: 0.5, y: 0.86, maxWidth: 0.82,
      fontStyle: "normal", letterSpacing: 0, lineHeight: 1.22,
      backgroundRadius: .18, backgroundPadding: .4, shadowBlur: .18,
      animation: "reveal", animationDurationMs: 520,
    },
    segments,
  };
}

function subtitleTime(milliseconds: number, separator: "," | "."): string {
  const value = Math.max(0, Math.round(milliseconds));
  const hours = Math.floor(value / 3_600_000);
  const minutes = Math.floor(value % 3_600_000 / 60_000);
  const seconds = Math.floor(value % 60_000 / 1000);
  const millis = value % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}${separator}${String(millis).padStart(3, "0")}`;
}

export function captionsToSrt(tracks: CaptionTrack[], trimStartSeconds = 0, trimEndSeconds = Number.POSITIVE_INFINITY, playbackRate = 1): string {
  const offset = trimStartSeconds * 1000;
  const end = trimEndSeconds * 1000;
  const rate = Math.max(0.5, Math.min(2, playbackRate || 1));
  return tracks.flatMap((track) => track.visible ? track.segments : [])
    .filter((segment) => segment.endMs > offset && segment.startMs < end)
    .sort((a, b) => a.startMs - b.startMs)
    .map((segment, index) => `${index + 1}\n${subtitleTime((Math.max(segment.startMs, offset) - offset) / rate, ",")} --> ${subtitleTime((Math.min(segment.endMs, end) - offset) / rate, ",")}\n${segment.text.trim()}\n`)
    .join("\n");
}

export function captionsToVtt(tracks: CaptionTrack[], trimStartSeconds = 0, trimEndSeconds = Number.POSITIVE_INFINITY, playbackRate = 1): string {
  const srt = captionsToSrt(tracks, trimStartSeconds, trimEndSeconds, playbackRate);
  return `WEBVTT\n\n${srt.replace(/^(\d+)\n/gm, "").replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2")}`;
}
