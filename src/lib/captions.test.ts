import { describe, expect, it } from "vitest";
import { audioTrackPath, captionsToSrt, captionsToVtt, chunkCaptionSegments, createAudioTrack, findAvailableCaptionStart, mergeAudioTracks, normalizeCaptionTimeline, updateCaptionTiming } from "./captions";
import type { AudioTrack, CaptionTrack } from "./types";

describe("caption audio source selection", () => {
  it("keeps microphone transcription independent from system audio", () => {
    const mic = createAudioTrack("C:\\Videos\\Snap\\demo.mp4", "microphone");
    const system = createAudioTrack("C:\\Videos\\Snap\\demo.mp4", "system");
    expect(mic.path).toBe("C:\\Videos\\Snap\\demo\\mic_audio.wav");
    expect(system.path).toBe("C:\\Videos\\Snap\\demo\\system_audio.wav");
    expect(mic.path).not.toBe(system.path);
  });

  it("resolves device audio without falling back to the final video mix", () => {
    expect(audioTrackPath("D:\\recording.mp4", "device")).toBe("D:\\recording\\device_audio.wav");
  });

  it("refreshes file paths while preserving saved per-track controls", () => {
    const discovered = createAudioTrack("D:\\new-location\\recording.mp4", "microphone");
    const saved: AudioTrack = {
      ...createAudioTrack("D:\\old-location\\recording.mp4", "microphone"),
      id: "saved-mic",
      muted: true,
      volume: 0.65,
    };
    expect(mergeAudioTracks([discovered], [saved])).toEqual([{
      ...discovered,
      id: "saved-mic",
      muted: true,
      volume: 0.65,
    }]);
  });

  it("exports trimmed Unicode captions with rebased timestamps", () => {
    const track = {
      visible: true,
      segments: [{ id: "one", startMs: 4_000, endMs: 6_500, text: "नमस्ते world", language: "hi", sourceTrackIds: ["audio-microphone"], userEdited: true }],
    } as CaptionTrack;
    const srt = captionsToSrt([track], 5, 10);
    expect(srt).toContain("00:00:00,000 --> 00:00:01,500");
    expect(srt).toContain("नमस्ते world");
    expect(captionsToVtt([track], 5, 10)).toContain("00:00:00.000 --> 00:00:01.500");
  });

  it("retimes exported captions with the clip playback rate", () => {
    const track = {
      visible: true,
      segments: [{ id: "speed", startMs: 2_000, endMs: 6_000, text: "Faster clip", language: "en", sourceTrackIds: ["audio-system"], userEdited: false }],
    } as CaptionTrack;
    expect(captionsToSrt([track], 2, 8, 2)).toContain("00:00:00,000 --> 00:00:02,000");
    expect(captionsToVtt([track], 2, 8, 0.5)).toContain("00:00:00.000 --> 00:00:08.000");
  });

  it("splits long transcription phrases into short, continuous caption cards", () => {
    const chunks = chunkCaptionSegments([{ startMs: 1_000, endMs: 9_000, text: "This is a deliberately long automatic subtitle phrase that should never appear as one giant block on the screen" }]);
    expect(chunks.length).toBeGreaterThan(2);
    expect(chunks.every((chunk) => chunk.text.length <= 42)).toBe(true);
    expect(chunks[0].startMs).toBe(1_000);
    expect(chunks[chunks.length - 1]?.endMs).toBe(9_000);
    expect(chunks.slice(1).every((chunk, index) => chunk.startMs === chunks[index].endMs)).toBe(true);
  });

  it("removes transcription overlaps so a later caption cannot disappear", () => {
    const normalized = normalizeCaptionTimeline([
      { startMs: 1_000, endMs: 2_200, text: "First phrase" },
      { startMs: 2_000, endMs: 3_000, text: "Second phrase" },
      { startMs: 3_400, endMs: 4_200, text: "Third phrase" },
    ]);
    expect(normalized).toEqual([
      { startMs: 1_000, endMs: 2_000, text: "First phrase" },
      { startMs: 2_000, endMs: 3_000, text: "Second phrase" },
      { startMs: 3_400, endMs: 4_200, text: "Third phrase" },
    ]);
    expect(normalized.slice(1).every((segment, index) => segment.startMs >= normalized[index].endMs)).toBe(true);
  });

  it("keeps imported audio tracks when recorded sidecars are rediscovered", () => {
    const imported: AudioTrack = { id: "music", kind: "imported", path: "D:\\project\\music.mp3", label: "Music", muted: false, volume: .6 };
    expect(mergeAudioTracks([createAudioTrack("D:\\project\\recording.mp4", "system")], [imported])).toContainEqual(imported);
  });

  it("never deletes short spoken words and merges them into readable cards", () => {
    const normalized = normalizeCaptionTimeline([
      { startMs: 21_920, endMs: 22_260, text: "they had" },
      { startMs: 22_260, endMs: 22_360, text: "to" },
      { startMs: 22_360, endMs: 23_500, text: "make it work" },
      { startMs: 25_952, endMs: 26_080, text: "all" },
      { startMs: 26_080, endMs: 26_520, text: "entitled" },
    ]);
    expect(normalized.map((segment) => segment.text).join(" ")).toBe("they had to make it work all entitled");
    expect(normalized[0]).toEqual({ startMs: 21_920, endMs: 23_500, text: "they had to make it work" });
    expect(normalized.every((segment) => segment.endMs > segment.startMs)).toBe(true);
  });

  it("places duplicate captions in a real gap instead of on top of another caption", () => {
    const segments = [
      { id: "source", startMs: 1_000, endMs: 2_000 },
      { id: "occupied", startMs: 2_100, endMs: 4_000 },
    ];
    expect(findAvailableCaptionStart(segments, "source", 1_000, 0, 8_000, 2_100)).toBe(4_100);
    expect(findAvailableCaptionStart(segments, "source", 4_000, 0, 4_000, 2_100)).toBeNull();
  });

  it("clamps inspector timing edits between neighboring captions", () => {
    const segments = [
      { id: "one", startMs: 1_000, endMs: 2_000, text: "one", language: "en", sourceTrackIds: [], userEdited: false },
      { id: "two", startMs: 2_000, endMs: 3_000, text: "two", language: "en", sourceTrackIds: [], userEdited: false },
      { id: "three", startMs: 3_000, endMs: 4_000, text: "three", language: "en", sourceTrackIds: [], userEdited: false },
    ];
    expect(updateCaptionTiming(segments, "two", "start", 1_200)[1].startMs).toBe(2_000);
    expect(updateCaptionTiming(segments, "two", "end", 3_800)[1].endMs).toBe(3_000);
    expect(updateCaptionTiming(segments, "two", "start", 2_400)[1]).toMatchObject({ startMs: 2_400, userEdited: true });
  });
});
