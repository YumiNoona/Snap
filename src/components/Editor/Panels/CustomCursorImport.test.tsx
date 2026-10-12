import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { expect, it, vi } from "vitest";
import CustomCursorImport from "./CustomCursorImport";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));
vi.mock("../../../lib/canvasDraw", () => ({ assetSrc: (path: string) => path }));

it("asks for a name, saves through the native library, then selects the returned cursor", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(open).mockResolvedValue("C:\\Downloads\\pink.png");
  const pack = { name: "custom-my-pink", label: "My Pink", pointer_url: "C:\\AppData\\cursors\\my-pink\\pointer.png" };
  vi.mocked(invoke).mockResolvedValue(pack);
  const onImported = vi.fn();
  let renderer!: ReturnType<typeof create>;
  try {
    await act(async () => { renderer = create(createElement(CustomCursorImport, { onImported })); });
    await act(async () => renderer.root.findByType("button").props.onClick());
    expect(renderer.root.findByType("input").props.value).toBe("pink");
    expect(invoke).not.toHaveBeenCalled();
    await act(async () => renderer.root.findByType("input").props.onChange({ target: { value: "My Pink" } }));
    await act(async () => renderer.root.findByType("form").props.onSubmit({ preventDefault: vi.fn() }));
    expect(invoke).toHaveBeenCalledWith("import_custom_cursor", { sourcePath: "C:\\Downloads\\pink.png", name: "My Pink" });
    expect(onImported).toHaveBeenCalledWith(pack);
    expect(renderer.root.findAllByType("input")).toHaveLength(0);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    vi.resetAllMocks(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  }
});

it("keeps the name form and reports errors without selecting a failed import", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(open).mockResolvedValue("C:\\Downloads\\cursor.png");
  vi.mocked(invoke).mockRejectedValue("[cursor-exists] A custom cursor already uses this name");
  const onImported = vi.fn();
  let renderer!: ReturnType<typeof create>;
  try {
    await act(async () => { renderer = create(createElement(CustomCursorImport, { onImported })); });
    await act(async () => renderer.root.findByType("button").props.onClick());
    await act(async () => renderer.root.findByType("form").props.onSubmit({ preventDefault: vi.fn() }));
    expect(renderer.root.findByProps({ role: "alert" }).children.join("")).toContain("already uses");
    expect(onImported).not.toHaveBeenCalled();
    expect(renderer.root.findByType("input").props.value).toBe("cursor");
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    vi.resetAllMocks(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  }
});
