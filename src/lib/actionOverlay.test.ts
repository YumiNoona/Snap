import { describe, expect, it } from "vitest";
import { buildDisplayActions, resolveDisplayActions, visibleActions } from "./actionOverlay";
import { DEFAULT_EDITOR_CONFIG } from "./types";

describe("action overlay", () => {
  it("preserves shortcut intent without exposing ordinary typed text", () => {
    const actions = buildDisplayActions([
      { ts: 10, type: "keydown", key: "Typing", x: null, y: null, button: null },
      { ts: 80, type: "keydown", key: "Typing", x: null, y: null, button: null },
      { ts: 900, type: "keydown", key: "Ctrl", x: null, y: null, button: null },
      { ts: 920, type: "keydown", key: "Ctrl+KeyC", x: null, y: null, button: null },
    ]);
    expect(actions.map((action) => action.label)).toEqual(["Typing ×2", "Ctrl + C"]);
  });

  it("filters content and applies a deterministic fade", () => {
    const config = { ...DEFAULT_EDITOR_CONFIG.actionOverlay, enabled: true, holdMs: 500, fadeMs: 500, showMouse: false };
    const actions = buildDisplayActions([{ ts: 0, type: "keydown", key: "Return", x: null, y: null, button: null }, { ts: 100, type: "mousedown", button: "Left", x: 2, y: 3, key: null }]);
    const visible = visibleActions(actions, 750, config);
    expect(visible).toHaveLength(1);
    expect(visible[0].label).toBe("Enter");
    expect(visible[0].opacity).toBeCloseTo(.5);
  });

  it("applies non-destructive timeline timing, label, and visibility edits", () => {
    const actions = buildDisplayActions([{ ts: 500, type: "keydown", key: "Return", x: null, y: null, button: null }]);
    const config = {
      ...DEFAULT_EDITOR_CONFIG.actionOverlay,
      eventEdits: { [actions[0].id]: { offsetMs: 250, durationMs: 1800, label: "Confirm", hidden: true } },
    };
    expect(resolveDisplayActions(actions, config)[0]).toMatchObject({ sourceTs: 500, ts: 750, durationMs: 1800, label: "Confirm", hidden: true });
  });
});
