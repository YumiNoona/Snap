import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { emitTo } from "@tauri-apps/api/event";
import WindowPickerWindow from "./WindowPickerWindow";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/event", () => ({ emitTo: vi.fn() }));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => ({ close: vi.fn() }) }));

it("selects a preview card directly without search or a confirmation footer", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(invoke).mockResolvedValue([{ id: "1", name: "Apex Legends", target_type: "window" }, { id: "2", name: "Browser", target_type: "window" }]);
  vi.mocked(emitTo).mockResolvedValue();
  const quiet = vi.spyOn(console, "error").mockImplementation(() => {});
  let renderer!: ReturnType<typeof create>;
  try {
    await act(async () => { renderer = create(createElement(WindowPickerWindow)); });
    expect(renderer.root.findAllByType("input")).toHaveLength(0);
    expect(renderer.root.findAllByType("footer")).toHaveLength(0);
    await act(async () => { await renderer.root.findAllByProps({ className: "window-picker-option" })[0].props.onClick(); });
    expect(emitTo).toHaveBeenCalledWith("main", "window-target-selected", "1");
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    quiet.mockRestore();
    vi.unstubAllGlobals();
  }
});
