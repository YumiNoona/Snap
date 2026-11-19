import { useEffect, useRef, useState, type PropsWithChildren, type PointerEvent } from "react";

/** Native touch/trackpad scrolling, with grab-to-scroll for a mouse or pen. */
export default function MomentStrip({ children }: PropsWithChildren) {
  const drag = useRef<{ id: number; x: number; y: number; left: number; active: boolean } | null>(null);
  const suppressClick = useRef(false);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [dragging, setDragging] = useState(false);
  useEffect(() => () => clearTimeout(clickTimer.current), []);
  const finish = (e: PointerEvent<HTMLDivElement>, cancelled = false) => {
    if (drag.current?.id !== e.pointerId) return;
    const moved = drag.current.active;
    drag.current = null;
    setDragging(false);
    suppressClick.current = moved && !cancelled;
    clearTimeout(clickTimer.current);
    clickTimer.current = setTimeout(() => { suppressClick.current = false; }, 0);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };
  return <div
    className={`ac-moments-list${dragging ? " is-dragging" : ""}`}
    role="region"
    aria-label="Suggested moments"
    tabIndex={0}
    onPointerDown={e => {
      if (e.button !== 0 || e.pointerType === "touch") return;
      suppressClick.current = false;
      drag.current = { id: e.pointerId, x: e.clientX, y: e.clientY, left: e.currentTarget.scrollLeft, active: false };
    }}
    onPointerMove={e => {
      const d = drag.current;
      if (!d || d.id !== e.pointerId) return;
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (!d.active) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 6) return;
        if (Math.abs(dy) > Math.abs(dx)) { drag.current = null; return; }
        d.active = true;
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragging(true);
      }
      e.preventDefault();
      e.currentTarget.scrollLeft = d.left - dx;
    }}
    onPointerUp={e => finish(e)}
    onPointerCancel={e => finish(e, true)}
    onLostPointerCapture={e => { if (drag.current) finish(e, true); }}
    onClickCapture={e => {
      if (suppressClick.current) {
        e.preventDefault();
        e.stopPropagation();
        suppressClick.current = false;
      }
    }}
    onKeyDown={e => {
      if (e.target !== e.currentTarget) return;
      const lane = e.currentTarget;
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        lane.scrollBy({ left: (e.key === "ArrowRight" ? 1 : -1) * 236, behavior: "smooth" });
      } else if (e.key === "Home" || e.key === "End") {
        e.preventDefault();
        lane.scrollTo({ left: e.key === "Home" ? 0 : lane.scrollWidth, behavior: "smooth" });
      }
    }}
  >{children}</div>;
}
