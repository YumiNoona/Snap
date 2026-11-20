import { act, create } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), editor: vi.fn(() => null), library: vi.fn(() => null) }));
vi.mock("./components/Editor/Editor", () => ({ default: mocks.editor }));
vi.mock("./components/LibraryWindow", () => ({ default: mocks.library }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ close: vi.fn() }) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen, emit: vi.fn(async () => {}) }));
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.resetAllMocks(); });

it.each(["", "?window=editor"])("starts the editor edition in its workspace at URL %s without asking for a recording", async search => {
  vi.resetModules();
  vi.stubEnv("VITE_SNAP_EDITION", "editor");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("document", { fonts: { ready: Promise.resolve() } });
  vi.stubGlobal("window", Object.assign(new EventTarget(), { location: { search }, setTimeout }));
  mocks.invoke.mockImplementation(async command => {
    if (command === "get_pending_editor_paths") throw new Error("No pending media");
  });
  mocks.listen.mockResolvedValue(() => {});
  const { default: App } = await import("./App");
  let view!: ReturnType<typeof create>;
  await act(async () => { view = create(<App />); });
  expect(view.root.findByType(mocks.editor).props.videoPath).toBe("");
  expect(mocks.library).not.toHaveBeenCalled();
  expect(mocks.invoke.mock.calls.some(call => call[0] === "list_recordings")).toBe(false);
  const open = mocks.listen.mock.calls.find(call => call[0] === "editor-open")![1];
  await act(async () => open({ payload: ["handoff.mp4", "handoff/events.json"] }));
  expect(view.root.findByType(mocks.editor).props.videoPath).toBe("handoff.mp4");
  await act(async () => view.root.findByType(mocks.editor).props.onClose());
  expect(view.root.findByType(mocks.editor).props.videoPath).toBe("");
  expect(view.root.findByType(mocks.editor).props.inputLogPath).toBe("");
  await act(async () => view.unmount());
});
