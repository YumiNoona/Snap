import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { expect, it, vi } from "vitest";
import PreviewPlayer, { playerTime, clampDockOffset } from "./PreviewPlayer";

it("formats long recordings and invalid timestamps", () => {
  expect(playerTime(3661)).toBe("1:01:01");
  expect(playerTime(65.9)).toBe("1:05");
  expect(playerTime(NaN)).toBe("0:00");
  expect(playerTime(-1)).toBe("0:00");
});

it("bounds skip/seek actions, exposes keyboard labels, and retains mute/volume controls", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.spyOn(console, "error").mockImplementation(() => {});
  const p = { position: 2, duration: 4, playing: false, muted: true, volume: 80,
    onSeek: vi.fn(), onToggle: vi.fn(), onMute: vi.fn(), onVolume: vi.fn(), onActivity: vi.fn() };
  let renderer!: ReturnType<typeof create>;
  try {
    await act(async () => { renderer = create(createElement(PreviewPlayer, p)); });
    renderer.root.findByProps({ "aria-label": "Back 5 seconds" }).props.onClick();
    expect(p.onSeek).toHaveBeenLastCalledWith(0);
    renderer.root.findByProps({ "aria-label": "Forward 5 seconds" }).props.onClick();
    expect(p.onSeek).toHaveBeenLastCalledWith(4);
    renderer.root.findByProps({ "aria-label": "Preview position" }).props.onChange({ target: { value: "99" } });
    expect(p.onSeek).toHaveBeenLastCalledWith(4);
    renderer.root.findByProps({ "aria-label": "Play preview" }).props.onClick();
    expect(p.onToggle).toHaveBeenCalledOnce();
    expect(renderer.root.findByProps({ "aria-label": "Preview volume" }).props.value).toBe(0);
    renderer.root.findByProps({ "aria-label": "Unmute preview" }).props.onClick();
    expect(p.onMute).toHaveBeenCalledOnce();
    renderer.root.findByProps({ "aria-label": "Preview volume" }).props.onChange({ target: { value: "45" } });
    expect(p.onVolume).toHaveBeenCalledWith(45);
    renderer.root.findByProps({ role: "group" }).props.onFocusCapture();
    expect(p.onActivity).toHaveBeenCalledOnce();
    expect(renderer.root.findByProps({ "aria-label": "Preview captions" }).props.disabled).toBe(true);
    const onCaptions = vi.fn();
    await act(async () => renderer.update(createElement(PreviewPlayer, { ...p, hasCaptions: true, captionsVisible: true, onCaptions })));
    const cc = renderer.root.findByProps({ "aria-label": "Preview captions" });
    expect(cc.props["aria-pressed"]).toBe(true); expect(cc.props.disabled).toBe(false);
    cc.props.onClick(); expect(onCaptions).toHaveBeenCalledOnce();
    expect(renderer.root.findAllByType("small")).toHaveLength(0);
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    vi.restoreAllMocks(); vi.unstubAllGlobals();
  }
});
it("keeps the draggable dock inside its resized preview area", () => {
  expect(clampDockOffset({ x: 30, y: 20 }, { left: -10, right: 490, top: 460, bottom: 540 }, { left: 0, right: 800, top: 0, bottom: 500 })).toEqual({ x: 48, y: -28 });
});
