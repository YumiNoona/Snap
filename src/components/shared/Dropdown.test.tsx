import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { expect, it, vi } from "vitest";
import Dropdown from "./Dropdown";
vi.mock("react-dom", () => ({ createPortal: (node: unknown) => node }));
vi.mock("morphicons/react", () => ({ MorphIcon: () => null }));

it("keeps a portalled submenu open through pointerdown and selects its item", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const handlers = new Map<string, (event: unknown) => void>();
  vi.stubGlobal("document", { activeElement: null, body: {}, addEventListener: (name: string, fn: (event: unknown) => void) => handlers.set(name, fn), removeEventListener: vi.fn() });
  vi.stubGlobal("window", { innerWidth: 480, innerHeight: 320, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.spyOn(console, "error").mockImplementation(() => {});
  const anchor = { getBoundingClientRect: () => ({ left: 360, right: 460, top: 240, bottom: 280, width: 100 }), focus: vi.fn(), contains: () => false };
  const menu = { getBoundingClientRect: () => ({ width: 180, height: 100 }), querySelector: () => ({ focus: vi.fn() }) };
  const change = vi.fn();
  let renderer!: ReturnType<typeof create>;
  try {
    await act(async () => { renderer = create(createElement(Dropdown, { options: [{ value: "group", label: "Audio", children: [{ value: "mic", label: "Microphone" }] }], value: "", onChange: change }), { createNodeMock: node => node.type === "button" ? anchor : menu }); });
    await act(async () => renderer.root.findByProps({ "aria-expanded": false }).props.onClick());
    const parent = renderer.root.findAllByType("button").find(button => button.children.some(child => typeof child !== "string" && child.props.className === "dd-item-label" && child.children[0] === "Audio"))!;
    await act(async () => parent.props.onClick({ currentTarget: anchor }));
    const submenu = renderer.root.findByProps({ className: "dd-sub-panel" });
    expect(submenu.props.style.left).toBe(176);
    expect(submenu.props.style.top).toBe(212);
    const owner = submenu.props["data-dropdown-owner"];
    await act(async () => handlers.get("pointerdown")!({ target: { closest: () => ({ getAttribute: () => owner }) } }));
    expect(renderer.root.findAllByProps({ className: "dd-sub-panel" })).toHaveLength(1);
    await act(async () => renderer.root.findByProps({ className: "dd-sub-panel" }).findByType("button").props.onClick({ currentTarget: anchor }));
    expect(change).toHaveBeenCalledWith("mic");
    expect(renderer.root.findAllByProps({ className: "dd-sub-panel" })).toHaveLength(0);
    expect(anchor.focus).toHaveBeenCalled();
  } finally {
    if (renderer) await act(async () => renderer.unmount());
    vi.restoreAllMocks(); vi.unstubAllGlobals();
  }
});
