import { describe, expect, it } from "vitest";
import { audioTrackPath, captionsToSrt, captionsToVtt, chunkCaptionSegments, createAudioTrack, mergeAudioTracks } from "./captions";
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
});
