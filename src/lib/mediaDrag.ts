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
  let ghost: HTMLElement | null = null;
  const origin = event.currentTarget as HTMLElement;
  let last = { clientX: x, clientY: y };
  const send = (phase: MediaDragDetail["phase"], ev: PointerEvent) =>
    window.dispatchEvent(
      new CustomEvent<MediaDragDetail>("snap-media-drag", {
        detail: { phase, items, x: ev.clientX, y: ev.clientY },
      }),
    );
  const move = (ev: PointerEvent) => {
    if (ev.pointerId !== event.pointerId) return;
    last = ev;
    if (!dragging && Math.hypot(ev.clientX - x, ev.clientY - y) < 6) return;
    dragging = true;
    ev.preventDefault();
    document.body.classList.add("media-pointer-dragging");
    if (!ghost) {
      ghost = origin.cloneNode(true) as HTMLElement;
      ghost.className = "media-drag-ghost";
      ghost.setAttribute("aria-hidden", "true");
      ghost.removeAttribute("tabindex");
      ghost.querySelectorAll("button,.media-card-actions").forEach(node => node.remove());
      if (items.length > 1) { const badge = document.createElement("span"); badge.className = "media-drag-count"; badge.textContent = String(items.length); ghost.append(badge); }
      document.body.append(ghost);
    }
    ghost.style.left = `${Math.min(window.innerWidth - 160, ev.clientX + 16)}px`;
    ghost.style.top = `${Math.min(window.innerHeight - 110, ev.clientY + 16)}px`;
    send("move", ev);
  };
  const up = (ev: PointerEvent) => {
    if (ev.pointerId !== event.pointerId) return;
    cleanup();
    if (dragging) {
      send("drop", ev);
      send("end", ev);
      const suppress = (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
      };
      window.addEventListener("click", suppress, { once: true, capture: true });
      setTimeout(() => window.removeEventListener("click", suppress, true), 0);
    }
  };
  const cleanup = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    window.removeEventListener("pointercancel", cancel);
    window.removeEventListener("blur", cancel);
    window.removeEventListener("keydown", key);
    document.body.classList.remove("media-pointer-dragging");
    ghost?.remove(); ghost = null;
  };
  const cancel = () => { cleanup(); if (dragging) send("end", last as PointerEvent); };
  const key = (ev: KeyboardEvent) => { if (ev.key === "Escape") { ev.preventDefault(); cancel(); } };
  window.addEventListener("pointermove", move, { passive: false });
  window.addEventListener("pointerup", up);
  window.addEventListener("pointercancel", cancel);
  window.addEventListener("blur", cancel);
  window.addEventListener("keydown", key);
}
