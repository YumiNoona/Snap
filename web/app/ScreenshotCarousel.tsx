"use client";

import Image from "next/image";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { productShots, screenshotSrc } from "../lib/screenshots";

const wrap = (index: number) => (index + productShots.length) % productShots.length;
const motionDuration = 820;

export default function ScreenshotCarousel() {
  const stage = useRef<HTMLDivElement>(null);
  const dots = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const [incoming, setIncoming] = useState<number | null>(null);
  const [offset, setOffset] = useState(0);
  const [direction, setDirection] = useState(1);
  const [width, setWidth] = useState(0);
  const [animating, setAnimating] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [error, setError] = useState("");
  const activeRef = useRef(0);
  const reducedRef = useRef(false);
  const mounted = useRef(true);
  const generation = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frames = useRef<number[]>([]);
  const decoded = useRef(new Set<number>());
  const loads = useRef(new Map<number, Promise<void>>());
  const drag = useRef<{ x: number; y: number; engaged: boolean } | null>(null);
  const motion = useRef({ busy: false, to: null as number | null, commit: false, offset: 0, direction: 1 });

  const load = useCallback((index: number) => {
    const existing = loads.current.get(index);
    if (existing) return existing;
    const image = new window.Image();
    image.src = screenshotSrc(productShots[index].file);
    const promise = image.decode().then(() => { decoded.current.add(index); }).catch(error => {
      loads.current.delete(index); throw error;
    });
    loads.current.set(index, promise);
    return promise;
  }, []);

  const finish = useCallback(() => {
    generation.current++;
    if (timer.current) clearTimeout(timer.current);
    for (const frame of frames.current) cancelAnimationFrame(frame);
    frames.current = [];
    const state = motion.current;
    if (state.commit && state.to !== null) { activeRef.current = state.to; setActive(state.to); }
    motion.current = { busy: false, to: null, commit: false, offset: 0, direction: 1 };
    setIncoming(null); setOffset(0); setAnimating(false); setCommitting(false); setDragging(false);
  }, []);

  const settle = useCallback((commit: boolean) => {
    const state = motion.current;
    state.busy = true; state.commit = commit;
    if (reducedRef.current || (!commit && Math.abs(state.offset) < 1)) { finish(); return; }
    const end = commit ? -state.direction * (stage.current?.clientWidth ?? 0) : 0;
    setAnimating(true); setCommitting(commit); state.offset = end; setOffset(end);
    // Covers background tabs, interrupted transitions and browsers omitting transitionend.
    timer.current = setTimeout(finish, motionDuration + 120);
  }, [finish]);

  const show = useCallback(async (requested: number, requestedDirection?: number) => {
    const current = activeRef.current, next = wrap(requested);
    if (next === current || motion.current.busy || drag.current) return;
    const request = ++generation.current;
    motion.current.busy = true; setError("");
    try { await load(next); } catch {
      if (mounted.current && request === generation.current) { motion.current.busy = false; setError("Couldn't load this screenshot. Please try again."); }
      return;
    }
    if (!mounted.current || request !== generation.current) return;
    const dir = requestedDirection ?? (next > current ? 1 : -1);
    const currentWidth = stage.current?.clientWidth ?? 0;
    motion.current = { busy: true, to: next, commit: true, offset: 0, direction: dir };
    setDirection(dir); setWidth(currentWidth); setIncoming(next); setOffset(0);
    if (reducedRef.current) { finish(); return; }
    // Mount the already-decoded incoming image offscreen, then move both layers.
    // Reusing its keyed DOM node at completion prevents a source-swap flash.
    frames.current.push(requestAnimationFrame(() => {
      frames.current.push(requestAnimationFrame(() => settle(true)));
    }));
  }, [finish, load, settle]);

  useEffect(() => {
    mounted.current = true;
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => { reducedRef.current = preference.matches; setReduced(preference.matches); if (preference.matches) finish(); };
    update(); preference.addEventListener("change", update);
    const resize = new ResizeObserver(() => { if (motion.current.to !== null) { drag.current = null; finish(); } });
    if (stage.current) resize.observe(stage.current);
    return () => {
      mounted.current = false; preference.removeEventListener("change", update); resize.disconnect();
      if (timer.current) clearTimeout(timer.current);
      for (const frame of frames.current) cancelAnimationFrame(frame);
    };
  }, [finish]);

  useEffect(() => {
    // Only warm the neighbours, not every screenshot at initial page load.
    void load(wrap(active + 1)).catch(() => {});
    void load(wrap(active - 1)).catch(() => {});
  }, [active, load]);

  useEffect(() => {
    if (paused || hovered || reduced) return;
    const rotation = setInterval(() => {
      if (document.hidden || document.activeElement?.closest(".showcase-carousel")) return;
      void show(activeRef.current + 1, 1);
    }, 6000);
    return () => clearInterval(rotation);
  }, [active, hovered, paused, reduced, show]);

  const selected = animating && committing && incoming !== null ? incoming : active;
  useEffect(() => {
    const strip = dots.current, button = strip?.children[selected] as HTMLElement | undefined;
    if (!strip || !button) return;
    strip.scrollTo({ left: button.offsetLeft - strip.offsetLeft - (strip.clientWidth - button.clientWidth) / 2, behavior: reduced ? "instant" : "smooth" });
  }, [selected, reduced]);

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button > 0 || motion.current.busy) return;
    drag.current = { x: event.clientX, y: event.clientY, engaged: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start || motion.current.busy) return;
    const dx = event.clientX - start.x, dy = event.clientY - start.y;
    if (!start.engaged && (Math.abs(dx) < 6 || Math.abs(dx) < Math.abs(dy))) return;
    start.engaged = true; setDragging(true);
    if (reducedRef.current) return;
    const dir = dx < 0 ? 1 : -1, next = wrap(activeRef.current + dir), currentWidth = event.currentTarget.clientWidth;
    const ready = decoded.current.has(next);
    const distance = ready ? Math.max(-currentWidth * .98, Math.min(currentWidth * .98, dx)) : Math.max(-45, Math.min(45, dx * .12));
    motion.current = { busy: false, to: ready ? next : null, commit: false, offset: distance, direction: dir };
    setDirection(dir); setWidth(currentWidth); setIncoming(ready ? next : null); setOffset(distance);
  };
  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start) return;
    drag.current = null; setDragging(false);
    const dx = event.clientX - start.x, dir = dx < 0 ? 1 : -1;
    const commit = event.type !== "pointercancel" && start.engaged && Math.abs(dx) >= Math.min(110, event.currentTarget.clientWidth * .14);
    if (commit && motion.current.to !== null) settle(true);
    else if (commit) { finish(); void show(activeRef.current + dir, dir); }
    else settle(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };

  return (
    <div className="showcase-carousel" id="product" role="region" aria-roledescription="carousel" aria-label="Snap screenshots" aria-describedby="showcase-help" tabIndex={0}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      onKeyDown={event => { if (event.target === event.currentTarget && event.key === " ") { event.preventDefault(); setPaused(value => !value); } }}>
      <p className="visually-hidden" id="showcase-help">Swipe or use the dots to browse screenshots. Hovering or focusing pauses rotation. Press Space while this carousel is focused to pause or resume automatic rotation.</p>
      <div ref={stage} className={`showcase-stage${animating ? " is-transitioning" : ""}${dragging ? " is-dragging" : ""}`} data-phase={animating ? "moving" : dragging ? "dragging" : "idle"}
        role="tabpanel" id="product-preview" aria-labelledby={`feature-${productShots[selected].id}`}
        onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={endDrag} onPointerCancel={endDrag}
        onTransitionEnd={event => { if (event.propertyName === "transform" && motion.current.busy) finish(); }}>
        {[active, incoming].map(index => index === null ? null : <Image key={productShots[index].id}
          className={`showcase-slide${index === selected ? " is-active" : ""}`} src={screenshotSrc(productShots[index].file)}
          alt={index === selected ? productShots[index].alt : ""} aria-hidden={index !== selected}
          width={1920} height={1032} priority={index === 0} unoptimized sizes="(max-width: 900px) 96vw, 1280px" draggable={false}
          onLoad={() => { decoded.current.add(index); }}
          style={{ transform: `translate3d(${index === active ? offset : direction * width + offset}px,0,0)` }} />)}
      </div>
      <div className="showcase-navigation">
        <div ref={dots} className="showcase-dots" role="tablist" aria-label="Choose a screenshot" onKeyDown={event => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === "Home" ? 0 : event.key === "End" ? productShots.length - 1 : wrap(activeRef.current + (event.key === "ArrowRight" ? 1 : -1));
          void show(next); document.getElementById(`feature-${productShots[next].id}`)?.focus({ preventScroll: true });
        }}>
          {productShots.map((shot, index) => <button key={shot.id} id={`feature-${shot.id}`} role="tab" type="button"
            aria-label={`Show screenshot ${index + 1}: ${shot.label}`} aria-controls="product-preview" aria-selected={index === selected}
            tabIndex={index === selected ? 0 : -1} className={index === selected ? "is-active" : ""} onClick={() => void show(index)}><span aria-hidden="true" /></button>)}
        </div>
      </div>
      {error && <p className="showcase-error" role="status">{error}</p>}
    </div>
  );
}
