import { afterEach, expect, it, vi } from "vitest";
import { clearInputLogCache, INPUT_LOG_WARNING, loadInputLog } from "./inputLog";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
afterEach(() => { clearInputLogCache(); vi.resetAllMocks(); vi.restoreAllMocks(); });

it("opens ordinary uploaded videos without any cursor sidecar", async () => {
  expect(await loadInputLog("")).toMatchObject({ allEvents: [], source: "imported" });
  expect(invoke).not.toHaveBeenCalled();
  invoke.mockResolvedValue([]);
  expect(await loadInputLog("missing/events.json")).toEqual({ allEvents: [], mouseMoveEvents: [], clickEvents: [], region: null, source: "imported", platform: null });
});
it("keeps video editing and export available when optional cursor data cannot be read", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  invoke.mockRejectedValue(new Error("Input log contains invalid JSON"));
  const result = await loadInputLog("broken.json");
  expect(result).toMatchObject({ allEvents: [], mouseMoveEvents: [], clickEvents: [], warning: INPUT_LOG_WARNING });
});
it("can recover cursor data after a temporary read failure without retaining the failed cache entry", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  invoke.mockRejectedValueOnce(new Error("File is locked")).mockResolvedValueOnce([{ type: "mousedown", ts: 50, x: 20, y: 40 }]);
  expect((await loadInputLog("events.json")).warning).toBe(INPUT_LOG_WARNING);
  const recovered = await loadInputLog("events.json");
  expect(recovered.warning).toBeUndefined();
  expect(recovered.clickEvents).toHaveLength(1);
  expect(invoke).toHaveBeenCalledTimes(2);
});
it("aligns legacy array responses and shares the decoded log without applying offsets twice", async () => {
  invoke.mockResolvedValue([[{ type: "meta", captureStartMs: 100, captureElapsedMs: 1000, videoDurationMs: 2000, x: 100, y: 50, w: 1920, h: 1080, source: "desktop" }, { type: "mousemove", ts: 150, x: 120, y: 80 }, { type: "mousedown", ts: 200, x: 150, y: 90 }]]);
  const first = loadInputLog("legacy.json"), second = loadInputLog("legacy.json");
  expect(first).toBe(second);
  const result = await first;
  expect(result.allEvents.map(event => event.ts)).toEqual([100, 200]);
  expect(result.region).toEqual({ x: 100, y: 50, w: 1920, h: 1080 });
  expect(result.clickEvents).toHaveLength(1);
  expect(invoke).toHaveBeenCalledTimes(1);
});
it("keeps valid events while rejecting null, metadata and invalid coordinate records", async () => {
  invoke.mockResolvedValue([null, 20, { title: "Video metadata" }, { type: "mousemove", ts: "bad", x: 0, y: 0 }, { type: "mousemove", ts: 10, x: "bad", y: 0 }, { type: "keydown", ts: 10, key: 42 }, { type: "mousedown", ts: 50, x: 20, y: 40 }]);
  const result = await loadInputLog("mixed.json");
  expect(result.allEvents).toHaveLength(1);
  expect(result.clickEvents[0]).toMatchObject({ ts: 50, x: 20, y: 40 });
  expect(result.warning).toBe(INPUT_LOG_WARNING);
});
it("does not throw when an older backend returns an unexpected cursor-data response", async () => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  invoke.mockResolvedValue(null);
  expect(await loadInputLog("invalid.json")).toMatchObject({ allEvents: [], warning: INPUT_LOG_WARNING });
});
