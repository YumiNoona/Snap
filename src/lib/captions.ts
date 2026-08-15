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

export function audioTrackPath(videoPath: string, kind: AudioTrackKind): string {
  return `${recordingDataPaths(videoPath).dataDir}\\${AUDIO_FILENAMES[kind]}`;
}

export function createAudioTrack(videoPath: string, kind: AudioTrackKind): AudioTrack {
  const labels: Record<AudioTrackKind, string> = { microphone: "Microphone", system: "System audio", device: "Device audio" };
  return { id: `audio-${kind}`, kind, path: audioTrackPath(videoPath, kind), label: labels[kind], muted: false, volume: 1 };
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

export function captionsToSrt(tracks: CaptionTrack[], trimStartSeconds = 0, trimEndSeconds = Number.POSITIVE_INFINITY): string {
  const offset = trimStartSeconds * 1000;
  const end = trimEndSeconds * 1000;
  return tracks.flatMap((track) => track.visible ? track.segments : [])
    .filter((segment) => segment.endMs > offset && segment.startMs < end)
    .sort((a, b) => a.startMs - b.startMs)
    .map((segment, index) => `${index + 1}\n${subtitleTime(Math.max(segment.startMs, offset) - offset, ",")} --> ${subtitleTime(Math.min(segment.endMs, end) - offset, ",")}\n${segment.text.trim()}\n`)
    .join("\n");
}

export function captionsToVtt(tracks: CaptionTrack[], trimStartSeconds = 0, trimEndSeconds = Number.POSITIVE_INFINITY): string {
  const srt = captionsToSrt(tracks, trimStartSeconds, trimEndSeconds);
  return `WEBVTT\n\n${srt.replace(/^(\d+)\n/gm, "").replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2")}`;
}
