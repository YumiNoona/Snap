import { act, create } from "react-test-renderer";
import { afterEach, expect, it, vi } from "vitest";
import EmptyEditor from "./EmptyEditor";

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), open: vi.fn(), drop: vi.fn(), project: vi.fn(), listen: vi.fn(), emit: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ onDragDropEvent: mocks.drop }) }));
vi.mock("@tauri-apps/api/event", () => ({ listen: mocks.listen, emit: mocks.emit }));
vi.mock("../../lib/project", () => ({ loadProjectAtPath: mocks.project }));
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });

async function mount() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
  vi.stubGlobal("document", { body: { dataset: {} } });
  vi.stubGlobal("window", new EventTarget());
  mocks.drop.mockResolvedValue(() => {});
  mocks.listen.mockResolvedValue(() => {});
  mocks.invoke.mockResolvedValue("events.json");
  const onOpen = vi.fn();
  let view!: ReturnType<typeof create>;
  await act(async () => { view = create(<EmptyEditor onOpenProject={onOpen} />); });
  return { view, onOpen };
}
it("opens an empty editor without scanning recordings, opening a dialog or initializing media", async () => {
  const { view } = await mount();
  expect(view.root.findByType("h1").children).toEqual(["Start an edit"]);
  expect(view.root.findByProps({ "aria-label": "Empty timeline" })).toBeTruthy();
  expect(mocks.invoke).not.toHaveBeenCalled();
  expect(mocks.open).not.toHaveBeenCalled();
  await act(async () => view.unmount());
});
it("imports an arbitrary video and opens saved projects directly from the editor", async () => {
  const { view, onOpen } = await mount();
  mocks.open.mockResolvedValueOnce("D:\\Videos\\upload.mp4");
  await act(async () => view.root.findByProps({ className: "empty-editor-primary" }).props.onClick());
  expect(mocks.invoke).toHaveBeenLastCalledWith("open_editor_window", { video: "D:\\Videos\\upload.mp4", log: "events.json" });
  expect(onOpen).not.toHaveBeenCalled();
  mocks.open.mockResolvedValueOnce("D:\\Projects\\edit.snap.json");
  mocks.project.mockResolvedValue({ media: { videoPath: "other.mp4", inputLogPath: "other.json" } });
  await act(async () => view.root.findByProps({ "aria-label": "Open project" }).props.onClick());
  expect(onOpen).toHaveBeenLastCalledWith("D:\\Projects\\edit.snap.json", "other.mp4", "other.json");
  await act(async () => view.unmount());
});
it("accepts native file drops and leaves the workspace usable after a cancelled import", async () => {
  const { view, onOpen } = await mount();
  mocks.open.mockResolvedValueOnce(null);
  await act(async () => view.root.findByProps({ className: "empty-editor-primary" }).props.onClick());
  expect(onOpen).not.toHaveBeenCalled();
  await act(async () => mocks.drop.mock.calls[0][0]({ payload: { type: "drop", paths: ["clip.mp4"] } }));
  expect(mocks.invoke).toHaveBeenLastCalledWith("open_editor_window", { video: "clip.mp4", log: "events.json" });
  await act(async () => view.unmount());
});
it("keeps heavy imports out of a recording started from the recorder", async () => {
  const { view } = await mount();
  const starting = mocks.listen.mock.calls.find(call => call[0] === "recording-starting")![1];
  starting({ payload: "idle" });
  expect(mocks.emit).toHaveBeenLastCalledWith("editor-suspended", { requestId: "idle", ready: true });
  let finish!: (path: null) => void;
  mocks.open.mockImplementation(() => new Promise<null>(resolve => { finish = resolve; }));
  await act(async () => view.root.findByProps({ className: "empty-editor-primary" }).props.onClick());
  starting({ payload: "importing" });
  expect(mocks.emit).toHaveBeenLastCalledWith("editor-suspended", { requestId: "importing", ready: false, reason: "media-import" });
  await act(async () => finish(null));
  await act(async () => view.unmount());
});
