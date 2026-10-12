import { createElement, type ComponentProps } from "react";
import { act, create } from "react-test-renderer";
import { expect, it, vi } from "vitest";
import ExportModal from "./ExportModal";
import { DEFAULT_EDITOR_CONFIG } from "../../lib/types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue("C:\\Videos\\Exports") }));
vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: vi.fn() }));

it("keeps export success when opening fails, reveals the saved file, and allows retry", async () => {
  const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("document", { activeElement: null, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.spyOn(console, "error").mockImplementation(() => {});
  const onOpenFile = vi.fn().mockRejectedValueOnce("No default application").mockResolvedValue(undefined);
  const props: ComponentProps<typeof ExportModal> = {
    videoPath: "C:\\Videos\\recording.mp4", duration: 5,
    config: { ...DEFAULT_EDITOR_CONFIG, trimEnd: 5 }, captionTrackCount: 0,
    status: "Done — export saved", progress: 1, exportedPath: "C:\\Videos\\Exports\\finished.mp4",
    onClose: vi.fn(), onCancel: vi.fn(), onOpenFile, onExport: vi.fn(),
  };
  let renderer!: ReturnType<typeof create>;
  const button = (className: string) => renderer.root.findAllByType("button").find(node => node.props.className === className)!;
  try {
    await act(async () => { renderer = create(createElement(ExportModal, props)); });
    await act(async () => { button("export-open-button").props.onClick(); });
    expect(onOpenFile).toHaveBeenCalledTimes(1);
    expect(renderer.root.findByProps({ role: "alert" }).children.join("")).toContain("Use Show in folder");
    expect(renderer.root.findByProps({ className: "export-progress done" }).findByType("span").children).toEqual([props.status]);
    await act(async () => { button("export-secondary-button").props.onClick(); });
    expect(revealItemInDir).toHaveBeenCalledWith(props.exportedPath);
    expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(0);
    await act(async () => { button("export-open-button").props.onClick(); });
    expect(onOpenFile).toHaveBeenCalledTimes(2);
    expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(0);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    vi.restoreAllMocks(); vi.unstubAllGlobals();
  }
});

it("ignores repeated open clicks and stale failures after a new export begins", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("document", { activeElement: null, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.spyOn(console, "error").mockImplementation(() => {});
  let reject!: (reason: string) => void;
  const onOpenFile = vi.fn(() => new Promise<void>((_, fail) => { reject = fail; }));
  const props: ComponentProps<typeof ExportModal> = {
    videoPath: "C:\\Videos\\recording.mp4", duration: 5,
    config: { ...DEFAULT_EDITOR_CONFIG, trimEnd: 5 }, captionTrackCount: 0,
    status: "Done — export saved", progress: 1, exportedPath: "C:\\Videos\\Exports\\finished.mp4",
    onClose: vi.fn(), onCancel: vi.fn(), onOpenFile, onExport: vi.fn(),
  };
  let renderer!: ReturnType<typeof create>;
  try {
    await act(async () => { renderer = create(createElement(ExportModal, props)); });
    await act(async () => {
      const open = renderer.root.findByProps({ className: "export-open-button" });
      open.props.onClick(); open.props.onClick();
    });
    expect(onOpenFile).toHaveBeenCalledTimes(1);
    expect(renderer.root.findByProps({ className: "export-open-button" }).props.disabled).toBe(true);
    await act(async () => renderer.update(createElement(ExportModal, { ...props, exportedPath: "", status: "Exporting..." })));
    await act(async () => reject("Old open failed"));
    expect(renderer.root.findAllByProps({ role: "alert" })).toHaveLength(0);
    expect(renderer.root.findAllByProps({ className: "export-open-button" })).toHaveLength(0);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    vi.restoreAllMocks(); vi.unstubAllGlobals();
  }
});
