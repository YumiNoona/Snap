export interface MediaDragItem {
  path: string;
  name: string;
  kind: string;
  duration?: number;
}
export interface MediaDragDetail {
  phase: "move" | "drop" | "end";
  items: MediaDragItem[];
  x: number;
  y: number;
}
/** Pointer-based library dragging also works when WebView2 owns native OS drops. */
export function beginMediaDrag(
  event: import("react").PointerEvent,
  items: MediaDragItem[],
) {
  if (event.button !== 0 || (event.target as Element).closest("button,input"))
    return;
  const x = event.clientX,
    y = event.clientY;
  let dragging = false;
  const send = (phase: MediaDragDetail["phase"], ev: PointerEvent) =>
    window.dispatchEvent(
      new CustomEvent<MediaDragDetail>("snap-media-drag", {
        detail: { phase, items, x: ev.clientX, y: ev.clientY },
      }),
    );
  const move = (ev: PointerEvent) => {
    if (!dragging && Math.hypot(ev.clientX - x, ev.clientY - y) < 6) return;
    dragging = true;
    ev.preventDefault();
    document.body.classList.add("media-pointer-dragging");
    send("move", ev);
  };
  const up = (ev: PointerEvent) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointercancel", cancel);
    document.body.classList.remove("media-pointer-dragging");
    if (dragging) {
      send("drop", ev);
      send("end", ev);
      const suppress = (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
      };
      window.addEventListener("click", suppress, { once: true, capture: true });
    }
  };
  const cancel = (ev: PointerEvent) => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    document.body.classList.remove("media-pointer-dragging");
    send("end", ev);
  };
  window.addEventListener("pointermove", move, { passive: false });
  window.addEventListener("pointerup", up, { once: true });
  window.addEventListener("pointercancel", cancel, { once: true });
}
