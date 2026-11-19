import { create, act } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
import App from "./App";
import Editor from "./components/Editor/Editor";
import type { EditorRoute } from "./lib/clipWorkspace";
vi.mock("./components/Editor/Editor", () => ({ default: () => null }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => {}) }));
vi.mock("@tauri-apps/api/window", () => ({
  getCurrentWindow: () => ({ close: vi.fn() }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  emit: vi.fn(async () => {}),
  listen: vi.fn(async () => () => {}),
}));
afterEach(() => vi.unstubAllGlobals());
it("returns from clips to the original saved project and playhead and retains sibling clips", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "window",
    Object.assign(new EventTarget(), {
      location: { search: "?window=editor&preview=1&previewVideo=source.mp4" },
    }),
  );
  let view!: ReturnType<typeof create>;
  await act(async () => {
    view = create(<App />);
  });
  const original: EditorRoute = {
    projectPath: "original.snap.json",
    videoPath: "source.mp4",
    inputLogPath: "events.json",
    label: "Original timeline",
    position: 36,
  };
  const a: EditorRoute = {
      ...original,
      projectPath: "clip-a.snap.json",
      label: "Clip A",
      position: 0,
    },
    b = { ...a, projectPath: "clip-b.snap.json", label: "Clip B" };
  await act(async () =>
    view.root.findByType(Editor).props.onOpenClip(a, original, [a, b]),
  );
  expect(view.root.findByType(Editor).props.initialProjectPath).toBe(
    a.projectPath,
  );
  await act(async () =>
    view.root.findByType(Editor).props.onNavigateTimeline(original),
  );
  expect(view.root.findByType(Editor).props).toMatchObject({
    initialProjectPath: original.projectPath,
    initialPosition: 36,
    clipWorkspace: { original, clips: [a, b] },
  });
  await act(async () =>
    view.root
      .findByType(Editor)
      .props.onNavigateTimeline(b, { ...original, position: 72 }),
  );
  expect(view.root.findByType(Editor).props.initialProjectPath).toBe(
    b.projectPath,
  );
  const savedOriginal =
    view.root.findByType(Editor).props.clipWorkspace.original;
  await act(async () =>
    view.root.findByType(Editor).props.onNavigateTimeline(savedOriginal),
  );
  expect(view.root.findByType(Editor).props.initialPosition).toBe(72);
  await act(async () =>
    view.root
      .findByType(Editor)
      .props.onOpenProject("another.snap.json", "another.mp4", "other.json"),
  );
  expect(view.root.findByType(Editor).props.clipWorkspace).toBeNull();
  await act(async () => view.unmount());
});
