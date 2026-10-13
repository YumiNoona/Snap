import { createElement, type ReactNode } from "react";
import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import DonationDialog from "./DonationDialog";

vi.mock("react-dom", async (importOriginal) => ({
  ...await importOriginal<typeof import("react-dom")>(),
  createPortal: (children: ReactNode) => children,
}));

let renderer: ReturnType<typeof create> | undefined;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("document", { body: {}, activeElement: null });
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  if (renderer) await act(async () => renderer!.unmount());
  renderer = undefined;
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it("supports Not now, the close icon, backdrop and Escape without closing the export dialog", async () => {
  const close = vi.fn();
  await act(async () => { renderer = create(createElement(DonationDialog, { afterExport: true, onClose: close })); });
  const root = renderer!.root;
  expect(root.findByType("h2").children).toEqual(["Your video is saved"]);
  const panel = root.findByProps({ className: "donate-modal" });
  expect(panel.props["aria-modal"]).toBe("true");
  const event = { key: "Escape", stopPropagation: vi.fn(), preventDefault: vi.fn() };
  await act(async () => panel.props.onKeyDown(event));
  expect(event.stopPropagation).toHaveBeenCalled();
  expect(event.preventDefault).toHaveBeenCalled();
  await act(async () => root.findByProps({ "aria-label": "Close donation panel" }).props.onClick());
  await act(async () => root.findAllByType("button").find(button => button.children.join("") === "Not now")!.props.onClick());
  const backdrop = root.findByProps({ className: "donate-modal-backdrop" });
  const target = {};
  await act(async () => backdrop.props.onPointerDown({ target, currentTarget: target }));
  expect(close).toHaveBeenCalledTimes(4);
  await act(async () => backdrop.props.onPointerDown({ target: {}, currentTarget: target }));
  expect(close).toHaveBeenCalledTimes(4);
});

it("copies the existing UPI ID and announces success", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText } });
  await act(async () => { renderer = create(createElement(DonationDialog, { onClose: vi.fn() })); });
  await act(async () => renderer!.root.findByProps({ "aria-label": "Copy UPI ID" }).props.onClick());
  expect(writeText).toHaveBeenCalledWith("rushikeshingale2001@okicici");
  expect(renderer!.root.findAllByProps({ "aria-label": "UPI ID copied" })).toHaveLength(1);
  expect(renderer!.root.findAllByProps({ role: "alert" })).toHaveLength(0);
});

it("does not claim that copying worked when both clipboard methods fail", async () => {
  const textarea = { style: {}, select: vi.fn(), remove: vi.fn() };
  vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("Denied")) } });
  vi.stubGlobal("document", { activeElement: null, body: { appendChild: vi.fn() }, createElement: vi.fn(() => textarea), execCommand: vi.fn(() => false) });
  await act(async () => { renderer = create(createElement(DonationDialog, { onClose: vi.fn() })); });
  await act(async () => renderer!.root.findByProps({ "aria-label": "Copy UPI ID" }).props.onClick());
  expect(textarea.remove).toHaveBeenCalled();
  expect(renderer!.root.findByProps({ role: "alert" }).children.join("")).toContain("scan the QR code");
  expect(renderer!.root.findAllByProps({ "aria-label": "UPI ID copied" })).toHaveLength(0);
});
