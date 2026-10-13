import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import LibraryWindow from "./LibraryWindow";

type Payload = { type: "enter" | "drop"; paths: string[] } | { type: "over" | "leave" };
const native = vi.hoisted(() => ({
  invoke: vi.fn(), browse: vi.fn(), stop: vi.fn(),
  drop: undefined as undefined | ((event: { payload: Payload }) => void),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: native.invoke, convertFileSrc: (path: string) => `asset:${path}` }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: native.browse }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({
  close: vi.fn(),
  onDragDropEvent: (handler: typeof native.drop) => { native.drop = handler; return Promise.resolve(native.stop); },
}) }));

let renderer: ReturnType<typeof create> | undefined;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(console, "error").mockImplementation(() => {});
  native.invoke.mockReset(); native.browse.mockReset(); native.stop.mockReset();
  native.invoke.mockImplementation((command: string) => Promise.resolve(command === "list_recordings" ? [] : "C:\\Videos\\video_data\\events.json"));
});
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = undefined;
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
const mount = async (onOpen = vi.fn()) => {
  await act(async () => { renderer = create(createElement(LibraryWindow, { onOpen })); });
  return onOpen;
};
const drop = async (payload: Payload) => { await act(async () => native.drop!({ payload })); };
const title = () => renderer!.root.findByProps({ className: "import-card-label" }).children.join("");
const choose = () => renderer!.root.findByProps({ "aria-label": "Import video" });

it("highlights an accepted native drag without hiding the library and clears on leave", async () => {
  await mount();
  expect(title()).toBe("Drag and drop");
  await drop({ type: "enter", paths: ["C:\\Videos\\demo.MP4"] });
  expect(title()).toBe("Drag and drop");
  expect(renderer!.root.findByProps({ "aria-label": "Import video" }).props.className).toContain("is-drag-over");
  await drop({ type: "over" });
  expect(title()).toBe("Drag and drop");
  await drop({ type: "leave" });
  expect(title()).toBe("Drag and drop");
});

it.each(["MP4", "mov", "mkv", "webm", "avi"])("opens a dropped %s video exactly once with its input log", async extension => {
  const onOpen = await mount();
  const path = `C:\\Videos\\demo.${extension}`;
  await drop({ type: "drop", paths: ["C:\\Videos\\notes.txt", path] });
  expect(native.invoke).toHaveBeenCalledWith("resolve_recording_log_path", { videoPath: path });
  expect(onOpen).toHaveBeenCalledExactlyOnceWith(path, "C:\\Videos\\video_data\\events.json");
  expect(title()).toBe("Drag and drop");
});

it("rejects non-video drops with a useful message instead of a misleading highlight", async () => {
  const onOpen = await mount();
  await drop({ type: "enter", paths: ["C:\\Pictures\\image.png"] });
  expect(title()).toBe("Drag and drop");
  await drop({ type: "drop", paths: ["C:\\Pictures\\image.png"] });
  expect(onOpen).not.toHaveBeenCalled();
  expect(renderer!.root.findByProps({ role: "alert" }).children.join("")).toContain("Choose an MP4");
});

it("lets the file picker import a video, and restores the drop zone after cancelling", async () => {
  const onOpen = await mount();
  native.browse.mockResolvedValueOnce(null).mockResolvedValueOnce("C:\\Videos\\selected.mov");
  await act(async () => choose().props.onClick());
  expect(onOpen).not.toHaveBeenCalled();
  expect(choose().props.disabled).toBe(false);
  expect(title()).toBe("Drag and drop");
  await act(async () => choose().props.onClick());
  expect(native.browse).toHaveBeenCalledWith(expect.objectContaining({ filters: [{ name: "Video", extensions: ["mp4", "mov", "mkv", "webm", "avi"] }] }));
  expect(onOpen).toHaveBeenCalledExactlyOnceWith("C:\\Videos\\selected.mov", "C:\\Videos\\video_data\\events.json");
});

it("prevents duplicate file pickers and competing drops while an import is pending", async () => {
  let finish!: (path: string | null) => void;
  native.browse.mockImplementation(() => new Promise<string | null>(resolve => { finish = resolve; }));
  const onOpen = await mount();
  await act(async () => { choose().props.onClick(); choose().props.onClick(); });
  expect(native.browse).toHaveBeenCalledTimes(1);
  expect(choose().props.disabled).toBe(true);
  expect(choose().props["aria-busy"]).toBe(true);
  await drop({ type: "drop", paths: ["C:\\Videos\\other.mp4"] });
  expect(onOpen).not.toHaveBeenCalled();
  await act(async () => finish("C:\\Videos\\selected.mp4"));
  expect(onOpen).toHaveBeenCalledTimes(1);
  expect(choose().props.disabled).toBe(false);
});

it("handles a failed drop/handoff inside the drop zone and allows another attempt", async () => {
  const onOpen = vi.fn().mockRejectedValueOnce(new Error("Source file missing")).mockResolvedValue(undefined);
  await mount(onOpen);
  await drop({ type: "drop", paths: ["C:\\Videos\\missing.mp4"] });
  expect(renderer!.root.findByProps({ role: "alert" }).children.join("")).toContain("source file is unavailable");
  expect(choose().props.disabled).toBe(false);
  await drop({ type: "drop", paths: ["C:\\Videos\\valid.mp4"] });
  expect(renderer!.root.findAllByProps({ role: "alert" })).toHaveLength(0);
  expect(onOpen).toHaveBeenCalledTimes(2);
  await act(async () => renderer!.unmount());
  renderer = undefined;
  expect(native.stop).toHaveBeenCalledTimes(1);
});
