import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createProject, type SnapProject } from "../../../lib/project";
import { DEFAULT_EDITOR_CONFIG } from "../../../lib/types";
import { useProjectPersistence } from "./useProjectPersistence";

const mocks = vi.hoisted(() => ({ load: vi.fn(), save: vi.fn() }));
vi.mock("../../../lib/project", async (original) => ({
  ...await original<typeof import("../../../lib/project")>(),
  loadProjectAtPath: mocks.load, saveProjectAtPath: mocks.save,
}));

type Options = Parameters<typeof useProjectPersistence>[0];
let result: ReturnType<typeof useProjectPersistence>;
let renderer: ReactTestRenderer;
let options: Options;
function Harness(props: Options) { result = useProjectPersistence(props); return null; }
async function mount() { await act(async () => { renderer = create(createElement(Harness, options)); }); }
async function update(patch: Partial<Options>) {
  options = { ...options, ...patch };
  await act(async () => { renderer.update(createElement(Harness, options)); });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("window", { setTimeout, clearTimeout });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(console, "error").mockImplementation(() => {});
  mocks.load.mockReset().mockResolvedValue(null);
  mocks.save.mockReset().mockImplementation(async (project) => ({ ...project, updatedAt: "saved" }));
  options = { disabled: false, videoPath: "C:\\Videos\\Snap\\one.mp4", inputLogPath: "C:\\Videos\\Snap\\one\\events.json",
    duration: 10, config: structuredClone(DEFAULT_EDITOR_CONFIG), keyframes: [], captions: [], audioTracks: [], restore: vi.fn() };
});
afterEach(async () => {
  if (renderer) await act(async () => { renderer.unmount(); });
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});

describe("project save safety", () => {
  it("never autosaves over a failed recovery, including a differently cased Save As path", async () => {
    mocks.load.mockRejectedValue(new Error("Unsupported Snap project version"));
    await mount();
    await act(async () => { await vi.advanceTimersByTimeAsync(2_000); });
    expect(mocks.save).not.toHaveBeenCalled();
    await act(async () => { await expect(result.saveProjectAs(result.projectPath.toUpperCase())).rejects.toThrow(/Save As/); });
    await act(async () => { await result.saveProjectAs("C:\\Videos\\Snap\\recovered.snap"); });
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(result.projectPath).toBe("C:\\Videos\\Snap\\recovered.snap");
  });

  it("keeps edits made during a pending write dirty and then autosaves them", async () => {
    await mount();
    const pending = deferred<SnapProject>();
    let saved!: SnapProject;
    mocks.save.mockImplementationOnce((project) => { saved = project; return pending.promise; });
    let operation!: Promise<SnapProject>;
    await act(async () => { operation = result.saveProjectNow(); });
    await update({ config: { ...options.config, padding: 111 } });
    await act(async () => { pending.resolve(saved); await operation; });
    expect(result.projectDirty).toBe(true);
    expect(result.projectStatus).toBe("Unsaved changes");
    await act(async () => { await vi.advanceTimersByTimeAsync(1_600); });
    expect(mocks.save.mock.calls[mocks.save.mock.calls.length - 1][0].editor.padding).toBe(111);
    expect(result.projectDirty).toBe(false);
  });

  it("does not let a late save change the identity of a newly opened project", async () => {
    await mount();
    const pending = deferred<SnapProject>();
    mocks.save.mockImplementationOnce(() => pending.promise);
    let operation!: Promise<SnapProject>;
    await act(async () => { operation = result.saveProjectNow(); });
    await update({ videoPath: "C:\\Videos\\Snap\\two.mp4", inputLogPath: "C:\\Videos\\Snap\\two\\events.json" });
    const newPath = result.projectPath;
    await act(async () => { pending.resolve(createProject("C:\\Videos\\Snap\\one.mp4", "old")); await operation; });
    expect(result.projectPath).toBe(newPath);
    expect(result.projectSaving).toBe(false);
    expect(result.projectPath).toContain("two");
  });
});
