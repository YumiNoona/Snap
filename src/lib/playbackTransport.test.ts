import { describe, expect, it } from "vitest";
import { clampPlaybackTime, isAtPlaybackBoundary, isAuthoritativeTransportCommand, shouldRebuildForSeek, shouldRecoverStalledPlayback, shouldResyncSidecar } from "./playbackTransport";

describe("editor playback transport", () => {
  it("keeps seeks inside the active trim range", () => {
    expect(clampPlaybackTime(-2, 1.5, 8)).toBe(1.5);
    expect(clampPlaybackTime(4, 1.5, 8)).toBe(4);
    expect(clampPlaybackTime(20, 1.5, 8)).toBe(8);
    expect(clampPlaybackTime(Number.NaN, 1.5, 8)).toBe(1.5);
  });

  it("does not let an old play promise override a newer command", () => {
    expect(isAuthoritativeTransportCommand(7, 8)).toBe(false);
    expect(isAuthoritativeTransportCommand(8, 8)).toBe(true);
  });

  it("resynchronizes independent audio only after meaningful drift", () => {
    expect(shouldResyncSidecar(5.08, 5)).toBe(false);
    expect(shouldResyncSidecar(5.25, 5)).toBe(true);
    expect(shouldResyncSidecar(5, 5, true)).toBe(true);
  });

  it("rebuilds playback at natural and trimmed ends", () => {
    expect(isAtPlaybackBoundary(10, true, 0, 10)).toBe(true);
    expect(isAtPlaybackBoundary(9.99, false, 0, 10)).toBe(true);
    expect(isAtPlaybackBoundary(4, false, 1, 10)).toBe(false);
    expect(isAtPlaybackBoundary(.2, false, 1, 10)).toBe(true);
  });

  it("recovers only an actively requested decoder that stopped progressing", () => {
    expect(shouldRecoverStalledPlayback({ wantsPlayback: true, paused: false, seeking: false, stalledForMs: 1_600 })).toBe(true);
    expect(shouldRecoverStalledPlayback({ wantsPlayback: false, paused: false, seeking: false, stalledForMs: 4_000 })).toBe(false);
    expect(shouldRecoverStalledPlayback({ wantsPlayback: true, paused: true, seeking: false, stalledForMs: 4_000 })).toBe(false);
    expect(shouldRecoverStalledPlayback({ wantsPlayback: true, paused: false, seeking: true, stalledForMs: 4_000 })).toBe(false);
  });

  it("rebuilds the decoder when returning from the end to the beginning", () => {
    expect(shouldRebuildForSeek({ currentTime: 100, targetTime: 0, start: 0, end: 100, ended: true })).toBe(true);
    expect(shouldRebuildForSeek({ currentTime: 99.95, targetTime: 0.03, start: 0, end: 100, ended: false })).toBe(true);
    expect(shouldRebuildForSeek({ currentTime: 60, targetTime: 10, start: 0, end: 100, ended: false })).toBe(false);
    expect(shouldRebuildForSeek({ currentTime: 20, targetTime: 0, start: 0, end: 100, ended: false })).toBe(false);
  });
});
