import { createElement, type ComponentProps, type ReactNode } from "react";
import { act, create } from "react-test-renderer";
import { expect, it, vi } from "vitest";
import ExportModal from "./ExportModal";
import { DEFAULT_EDITOR_CONFIG } from "../../lib/types";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn().mockResolvedValue("C:\\Videos\\Exports") }));
vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: vi.fn() }));
vi.mock("react-dom", async (importOriginal) => ({
  ...await importOriginal<typeof import("react-dom")>(),
  createPortal: (children: ReactNode) => children,
}));

it("keeps export success when opening fails, reveals the saved file, and allows retry", async () => {
  const { revealItemInDir } = await import("@tauri-apps/plugin-opener");
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("document", { activeElement: null, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.spyOn(console, "error").mockImplementation(() => {});
  const onOpenFile = vi.fn().mockRejectedValueOnce("No default application").mockResolvedValue(undefined);
  const props: ComponentProps<typeof ExportModal> = {
    videoPath: "C:\\Videos\\recording.mp4", duration: 5,
    config: { ...DEFAULT_EDITOR_CONFIG, trimEnd: 5 }, captionTrackCount: 0,
    status: "Export Saved", progress: 1, exportedPath: "C:\\Videos\\Exports\\finished.mp4",
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
    status: "Export Saved", progress: 1, exportedPath: "C:\\Videos\\Exports\\finished.mp4",
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

function exportProps(format: "mp4" | "webm" | "gif" = "mp4"): ComponentProps<typeof ExportModal> {
  return {
    videoPath: "C:\\Videos\\recording.mp4", duration: 5,
    config: { ...DEFAULT_EDITOR_CONFIG, trimEnd: 5, exportDefaults: { format, fps: 60, quality: "high", captions: "none", normalizeAudio: false, audioMode: "mixed", deliveryPackage: false, loop: true, motionInterpolation: "none" } }, captionTrackCount: 0,
    status: "", progress: 0, exportedPath: "",
    onClose: vi.fn(), onCancel: vi.fn(), onOpenFile: vi.fn().mockResolvedValue(undefined),
    onExport: vi.fn().mockResolvedValue(true),
  };
}

function setupDonationTest() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("document", { body: {}, activeElement: null, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.spyOn(console, "error").mockImplementation(() => {});
}

it.each(["mp4", "webm", "gif"] as const)("prompts only after a saved %s export and keeps the file actions available", async (format) => {
  setupDonationTest();
  const props = exportProps(format);
  let finish!: (saved: boolean) => void;
  props.onExport = vi.fn(() => new Promise<boolean>(resolve => { finish = resolve; }));
  let renderer!: ReturnType<typeof create>;
  const donations = () => renderer.root.findAllByProps({ className: "donate-modal" });
  try {
    await act(async () => { renderer = create(createElement(ExportModal, props)); });
    await act(async () => {
      const start = renderer.root.findByProps({ className: "export-start-button" });
      start.props.onClick(); start.props.onClick();
    });
    expect(props.onExport).toHaveBeenCalledTimes(1);
    expect(props.onExport).toHaveBeenCalledWith(expect.objectContaining({ format }));
    expect(renderer.root.findByProps({ className: "export-start-button" }).props.disabled).toBe(true);
    expect(donations()).toHaveLength(0);
    // A progress callback alone must not display the thank-you before saving completes.
    await act(async () => renderer.update(createElement(ExportModal, { ...props, status: "Finalizing...", progress: 1 })));
    expect(donations()).toHaveLength(0);
    const savedProps = { ...props, status: "Export Saved", progress: 1, exportedPath: `C:\\Videos\\finished.${format}` };
    await act(async () => { renderer.update(createElement(ExportModal, savedProps)); finish(true); });
    expect(donations()).toHaveLength(1);
    expect(donations()[0].findByType("h2").children).toEqual(["Your video is saved"]);
    await act(async () => renderer.root.findAllByType("button").find(button => button.children.join("") === "Not now")!.props.onClick());
    expect(donations()).toHaveLength(0);
    expect(renderer.root.findByProps({ className: "export-open-button" }).props.disabled).toBe(false);
    expect(renderer.root.findByProps({ className: "export-progress done" }).findByType("span").children).toEqual(["Export Saved"]);
    // Repeating the same filename still prompts after the next successful attempt.
    await act(async () => renderer.root.findByProps({ className: "export-secondary-button export-again-button" }).props.onClick());
    expect(donations()).toHaveLength(0);
    await act(async () => finish(true));
    expect(donations()).toHaveLength(1);
    const event = { key: "Escape", preventDefault: vi.fn(), stopPropagation: vi.fn() };
    await act(async () => donations()[0].props.onKeyDown(event));
    expect(donations()).toHaveLength(0);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(event.stopPropagation).toHaveBeenCalled();
    expect(props.onClose).not.toHaveBeenCalled();
    // Reopening a completed export is not another completed attempt.
    await act(async () => renderer.unmount());
    await act(async () => { renderer = create(createElement(ExportModal, savedProps)); });
    expect(donations()).toHaveLength(0);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    vi.restoreAllMocks(); vi.unstubAllGlobals();
  }
});

it.each(["Export cancelled", "Export failed: Encoder unavailable", ""])("does not request a donation when export is not saved (%s)", async (status) => {
  setupDonationTest();
  const props = { ...exportProps(), status, onExport: vi.fn().mockResolvedValue(false) };
  let renderer!: ReturnType<typeof create>;
  try {
    await act(async () => { renderer = create(createElement(ExportModal, props)); });
    await act(async () => renderer.root.findByProps({ className: "export-start-button" }).props.onClick());
    expect(renderer.root.findAllByProps({ className: "donate-modal" })).toHaveLength(0);
    expect(renderer.root.findByProps({ className: "export-start-button" }).props.disabled).toBe(false);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    vi.restoreAllMocks(); vi.unstubAllGlobals();
  }
});

it("preserves delivery-package warnings, but still prompts for the successfully saved video", async () => {
  setupDonationTest();
  const props = { ...exportProps(), status: "Export Saved — delivery package incomplete. Export again to retry.", exportedPath: "C:\\Videos\\finished.mp4" };
  let renderer!: ReturnType<typeof create>;
  try {
    await act(async () => { renderer = create(createElement(ExportModal, props)); });
    expect(renderer.root.findAllByProps({ className: "donate-modal" })).toHaveLength(0);
    await act(async () => renderer.root.findByProps({ className: "export-secondary-button export-again-button" }).props.onClick());
    expect(renderer.root.findAllByProps({ className: "donate-modal" })).toHaveLength(1);
    expect(renderer.root.findByProps({ className: "export-progress done" }).findByType("span").children).toEqual([props.status]);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    vi.restoreAllMocks(); vi.unstubAllGlobals();
  }
});

it("does not prompt for a rejected request or a request that resolves after the dialog unmounts", async () => {
  setupDonationTest();
  const props = { ...exportProps(), onExport: vi.fn().mockRejectedValueOnce(new Error("Unexpected request failure")) };
  let finish!: (saved: boolean) => void;
  let renderer!: ReturnType<typeof create>;
  try {
    await act(async () => { renderer = create(createElement(ExportModal, props)); });
    await act(async () => renderer.root.findByProps({ className: "export-start-button" }).props.onClick());
    expect(renderer.root.findAllByProps({ className: "donate-modal" })).toHaveLength(0);
    props.onExport.mockImplementation(() => new Promise<boolean>(resolve => { finish = resolve; }));
    await act(async () => renderer.root.findByProps({ className: "export-start-button" }).props.onClick());
    await act(async () => renderer.unmount());
    await act(async () => finish(true));
    await act(async () => { renderer = create(createElement(ExportModal, { ...props, status: "Export Saved", exportedPath: "C:\\Videos\\finished.mp4" })); });
    expect(renderer.root.findAllByProps({ className: "donate-modal" })).toHaveLength(0);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    vi.restoreAllMocks(); vi.unstubAllGlobals();
  }
});
