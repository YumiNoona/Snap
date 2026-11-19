import { act, create } from "react-test-renderer";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import MomentStrip from "./MomentStrip";

beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
const lane = () => ({ scrollLeft: 100, scrollWidth: 1200, setPointerCapture: vi.fn(), hasPointerCapture: vi.fn(() => true), releasePointerCapture: vi.fn(), scrollBy: vi.fn(), scrollTo: vi.fn() });
const pointer = (target: ReturnType<typeof lane>, x: number, y = 20, type = "mouse") => ({ currentTarget: target, pointerId: 1, pointerType: type, button: 0, clientX: x, clientY: y, preventDefault: vi.fn() });
const click = () => ({ preventDefault: vi.fn(), stopPropagation: vi.fn() });

it("scrolls when dragging over a card and consumes only the drag's trailing click", async () => {
  let view!: ReturnType<typeof create>;
  await act(async () => { view = create(<MomentStrip><button>Preview</button></MomentStrip>); });
  const strip = () => view.root.findByProps({role:"region"});
  const target = lane();
  await act(async () => { strip().props.onPointerDown(pointer(target,200)); strip().props.onPointerMove(pointer(target,125)); });
  expect(target.scrollLeft).toBe(175);
  expect(target.setPointerCapture).toHaveBeenCalledWith(1);
  expect(strip().props.className).toContain("is-dragging");
  await act(async () => { strip().props.onPointerUp(pointer(target,125)); });
  const draggedClick = click(); strip().props.onClickCapture(draggedClick);
  expect(draggedClick.stopPropagation).toHaveBeenCalledOnce();
  expect(target.releasePointerCapture).toHaveBeenCalledWith(1);
  await act(async () => { await vi.advanceTimersByTimeAsync(0); });
  const regularClick = click(); strip().props.onClickCapture(regularClick);
  expect(regularClick.stopPropagation).not.toHaveBeenCalled();
  await act(async () => view.unmount());
});

it("preserves ordinary card clicks and native touch scrolling", async () => {
  let view!: ReturnType<typeof create>;
  await act(async () => { view = create(<MomentStrip><button>Preview</button></MomentStrip>); });
  const strip=view.root.findByProps({role:"region"}), target=lane();
  await act(async () => { strip.props.onPointerDown(pointer(target,200)); strip.props.onPointerMove(pointer(target,198)); strip.props.onPointerUp(pointer(target,198)); });
  const regularClick=click(); strip.props.onClickCapture(regularClick);
  expect(regularClick.preventDefault).not.toHaveBeenCalled();
  await act(async () => { strip.props.onPointerDown(pointer(target,200,20,"touch")); strip.props.onPointerMove(pointer(target,80,20,"touch")); });
  expect(target.scrollLeft).toBe(100);
  expect(target.setPointerCapture).not.toHaveBeenCalled();
  await act(async () => view.unmount());
});

it("does not turn a vertical gesture into a horizontal drag or block a click after cancellation", async () => {
  let view!: ReturnType<typeof create>;
  await act(async () => { view = create(<MomentStrip>Cards</MomentStrip>); });
  const strip=()=>view.root.findByProps({role:"region"}), target=lane();
  await act(async () => { strip().props.onPointerDown(pointer(target,200)); strip().props.onPointerMove(pointer(target,198,80)); });
  expect(target.scrollLeft).toBe(100);
  await act(async () => { strip().props.onPointerDown(pointer(target,200)); strip().props.onPointerMove(pointer(target,100)); strip().props.onPointerCancel(pointer(target,100)); });
  const nextClick=click(); strip().props.onClickCapture(nextClick);
  expect(nextClick.stopPropagation).not.toHaveBeenCalled();
  expect(strip().props.className).not.toContain("is-dragging");
  await act(async () => view.unmount());
});

it("offers keyboard navigation without stealing arrow keys from card buttons", async () => {
  let view!: ReturnType<typeof create>;
  await act(async () => { view = create(<MomentStrip><button>Preview</button></MomentStrip>); });
  const strip=view.root.findByProps({role:"region"}), target=lane();
  const event={currentTarget:target,target,key:"ArrowRight",preventDefault:vi.fn()};
  strip.props.onKeyDown(event);
  expect(target.scrollBy).toHaveBeenCalledWith({left:236,behavior:"smooth"});
  strip.props.onKeyDown({...event,key:"End"});
  expect(target.scrollTo).toHaveBeenCalledWith({left:1200,behavior:"smooth"});
  target.scrollBy.mockClear(); strip.props.onKeyDown({...event,target:{}});
  expect(target.scrollBy).not.toHaveBeenCalled();
  await act(async () => view.unmount());
});
