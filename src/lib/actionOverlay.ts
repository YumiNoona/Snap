import type { ActionOverlayConfig, InputEvent } from "./types";

export interface DisplayAction { id: string; ts: number; label: string; kind: "keyboard" | "mouse" | "scroll" }
export interface ResolvedDisplayAction extends DisplayAction { sourceTs: number; durationMs: number; hidden: boolean }

const KEY_LABELS: Record<string, string> = { ControlLeft: "Ctrl", ControlRight: "Ctrl", ShiftLeft: "Shift", ShiftRight: "Shift", Alt: "Alt", AltGr: "Alt", MetaLeft: "Win", MetaRight: "Win", Return: "Enter", Escape: "Esc", UpArrow: "↑", DownArrow: "↓", LeftArrow: "←", RightArrow: "→" };
const prettyKey = (value: string) => KEY_LABELS[value] ?? (/^Key[A-Z]$/.test(value) ? value.slice(3) : value.replace(/([a-z])([A-Z])/g, "$1 $2"));

export function buildDisplayActions(events: InputEvent[]): DisplayAction[] {
  const actions: DisplayAction[] = [];
  let typingStart = -1, typingEnd = -1, typingCount = 0;
  const flush = () => { if (typingStart >= 0) actions.push({ id: `key-${typingStart}`, ts: typingEnd, label: typingCount > 1 ? `Typing ×${typingCount}` : "Typing", kind: "keyboard" }); typingStart = -1; typingEnd = -1; typingCount = 0; };
  for (const event of [...events].sort((a, b) => a.ts - b.ts)) {
    if (event.type === "keydown") {
      const key = event.key || "Typing";
      if (key === "Typing") { if (typingStart < 0 || event.ts - typingEnd > 650) flush(); if (typingStart < 0) typingStart = event.ts; typingEnd = event.ts; typingCount++; continue; }
      flush();
      if (["Ctrl", "Shift", "Alt", "Win"].includes(key)) continue;
      actions.push({ id: `key-${event.ts}-${key}`, ts: event.ts, label: key.split("+").map(prettyKey).join(" + "), kind: "keyboard" });
    } else if (event.type === "mousedown") {
      flush(); const button = event.button?.toLowerCase() ?? "left"; const label = button.includes("right") ? "Right click" : button.includes("middle") ? "Middle click" : "Click";
      actions.push({ id: `mouse-${event.ts}-${button}`, ts: event.ts, label, kind: "mouse" });
    } else if (event.type === "wheel") {
      flush(); const direction = (event.y ?? 0) > 0 ? "Scroll up" : "Scroll down"; const previous = actions[actions.length - 1];
      if (previous?.kind === "scroll" && previous.label === direction && event.ts - previous.ts < 300) previous.ts = event.ts;
      else actions.push({ id: `scroll-${event.ts}`, ts: event.ts, label: direction, kind: "scroll" });
    }
  }
  flush(); return actions;
}

export function resolveDisplayActions(actions: DisplayAction[], config: ActionOverlayConfig): ResolvedDisplayAction[] {
  return actions.map((action) => {
    const edit = config.eventEdits?.[action.id];
    return {
      ...action,
      sourceTs: action.ts,
      ts: Math.max(0, action.ts + (edit?.offsetMs ?? 0)),
      durationMs: Math.max(150, edit?.durationMs ?? config.holdMs),
      label: edit?.label?.trim() || action.label,
      hidden: edit?.hidden ?? config.hiddenEventIds.includes(action.id),
    };
  }).sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));
}

export function visibleActions(actions: DisplayAction[], timeMs: number, config: ActionOverlayConfig) {
  return resolveDisplayActions(actions, config).filter((action) => action.ts <= timeMs && timeMs - action.ts <= action.durationMs + config.fadeMs && !action.hidden)
    .filter((action) => action.kind === "keyboard" ? config.showKeyboard : action.kind === "mouse" ? config.showMouse : config.showScroll).slice(-config.maxItems)
    .map((action) => ({ ...action, opacity: timeMs - action.ts <= action.durationMs ? 1 : Math.max(0, 1 - (timeMs - action.ts - action.durationMs) / Math.max(1, config.fadeMs)) }));
}

export function drawActionOverlay(ctx: CanvasRenderingContext2D, actions: DisplayAction[], timeMs: number, config: ActionOverlayConfig, area: { x: number; y: number; w: number; h: number }) {
  if (!config.enabled) return;
  const visible = visibleActions(actions, timeMs, config); if (!visible.length) return;
  const scale = Math.max(.6, Math.min(2, config.scale)) * Math.max(.65, Math.min(1.5, area.w / 1280));
  const fontSize = 18 * scale, padX = 15 * scale, padY = 9 * scale, gap = 8 * scale;
  ctx.save(); ctx.font = `600 ${fontSize}px "Segoe UI Variable", "Segoe UI", sans-serif`;
  const cards = visible.map((item) => ({ ...item, w: ctx.measureText(item.label).width + padX * 2, h: fontSize + padY * 2 }));
  const totalW = cards.reduce((sum, card) => sum + card.w, 0) + gap * (cards.length - 1), maxH = Math.max(...cards.map((card) => card.h)), margin = 24 * scale;
  let x = config.position.endsWith("right") ? area.x + area.w - totalW - margin : config.position.endsWith("left") ? area.x + margin : area.x + (area.w - totalW) / 2;
  const y = config.position.startsWith("top") ? area.y + margin : area.y + area.h - maxH - margin;
  for (const card of cards) { ctx.save(); ctx.globalAlpha = card.opacity; ctx.fillStyle = config.backgroundColor; ctx.beginPath(); ctx.roundRect(x, y, card.w, card.h, config.style === "minimal" ? 7 * scale : 11 * scale); ctx.fill(); if (config.style !== "minimal") { ctx.strokeStyle = card.kind === "keyboard" ? config.accentColor : "rgba(255,255,255,.18)"; ctx.lineWidth = 1.5 * scale; ctx.stroke(); } ctx.fillStyle = config.textColor; ctx.textBaseline = "middle"; ctx.textAlign = "center"; ctx.fillText(card.label, x + card.w / 2, y + card.h / 2); ctx.restore(); x += card.w + gap; }
  ctx.restore();
}
