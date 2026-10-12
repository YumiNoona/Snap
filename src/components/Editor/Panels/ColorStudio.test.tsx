import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { act, create } from "react-test-renderer";
import { expect, it, vi } from "vitest";
import ColorStudio from "./ColorStudio";
import ColorTools from "./ColorTools";
import { CheckRow, SelectRow } from "./PanelControls";
import { DEFAULT_EDITOR_CONFIG } from "../../../lib/types";

function props(): ComponentProps<typeof ColorStudio> {
  return {
    config: { ...DEFAULT_EDITOR_CONFIG, trimEnd: 10 },
    onChange: vi.fn(), position: 0, length: 10,
    comparison: { enabled: false, split: .5, reverse: false },
    onComparison: vi.fn(),
  };
}

it("starts at Film looks and places grade controls below tone adjustments, before the LUT", () => {
  const markup = renderToStaticMarkup(createElement(ColorStudio, props()));
  const labels = ["Film looks</h4>", 'aria-label="Vignette"', 'aria-label="Apply to"',
    "Compare original</span>", "Adjustment layers</h4>", "Enable look</span>",
    "Custom LUT</h4>", "RGB curves</h4>"];
  let previous = -1;
  for (const label of labels) {
    const index = markup.indexOf(label);
    expect(index, label).toBeGreaterThan(previous);
    previous = index;
  }
  expect(markup).not.toContain("<details");
  expect(markup).not.toContain("<summary");
});

it("keeps relocated scope, comparison and enable controls working", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(console, "error").mockImplementation(() => {});
  const p = props();
  let renderer!: ReturnType<typeof create>;
  try {
    await act(async () => { renderer = create(createElement(ColorStudio, p)); });
    await act(async () => {
      renderer.root.findAllByType(CheckRow).find(n => n.props.label === "Compare original")!.props.onChange(true);
    });
    expect(p.onComparison).toHaveBeenCalledWith({ ...p.comparison, enabled: true });
    await act(async () => {
      renderer.root.findAllByType(CheckRow).find(n => n.props.label === "Enable look")!.props.onChange(false);
    });
    expect(p.onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      colorGrade: expect.objectContaining({ enabled: false }),
    }));
    // A missing selected clip disables grading, not the selector needed to recover.
    await act(async () => {
      renderer.root.findAllByType(SelectRow).find(n => n.props.label === "Apply to")!.props.onChange("clip");
    });
    expect(renderer.root.findByType(ColorTools).props.disabled).toBe(true);
    const scope = renderer.root.findAllByType("button").find(n => n.props["aria-label"] === "Apply to")!;
    expect(scope.props.disabled).toBe(false);
    await act(async () => {
      renderer.root.findAllByType(SelectRow).find(n => n.props.label === "Apply to")!.props.onChange("project");
    });
    expect(renderer.root.findByType(ColorTools).props.disabled).toBeFalsy();
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    vi.restoreAllMocks(); vi.unstubAllGlobals();
  }
});
