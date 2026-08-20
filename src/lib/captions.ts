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

/** Turns Whisper's variable-length phrases into readable, movable subtitle cards. */
export function chunkCaptionSegments(segments: NativeTranscriptionResult["segments"]): NativeTranscriptionResult["segments"] {
  return segments.flatMap((segment) => {
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
}

const AUDIO_FILENAMES: Record<AudioTrackKind, string> = {
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
  return `${recordingDataPaths(videoPath).dataDir}\\${AUDIO_FILENAMES[kind]}`;
}

export function createAudioTrack(videoPath: string, kind: AudioTrackKind): AudioTrack {
  const labels: Record<AudioTrackKind, string> = { microphone: "Microphone", system: "System audio", device: "Device audio" };
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
  const primaryKind: AudioTrackKind = files.has(AUDIO_FILENAMES.device) ? "device" : "system";
  return ([primaryKind, "microphone"] as AudioTrackKind[])
    .flatMap((kind) => {
      const entry = files.get(AUDIO_FILENAMES[kind]);
      if (!entry) return [];
      return [{ ...createAudioTrack(videoPath, kind), path: entry.path }];
    });
}

export function mergeAudioTracks(discovered: AudioTrack[], saved: AudioTrack[]): AudioTrack[] {
  const savedByKind = new Map(saved.map((track) => [track.kind, track]));
  return discovered.map((track) => {
    const previous = savedByKind.get(track.kind);
    return previous
      ? { ...track, id: previous.id || track.id, label: previous.label || track.label, muted: previous.muted, volume: previous.volume }
      : track;
  });
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
