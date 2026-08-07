import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { MousePointer, MousePointer2, Check, Type, Square, Circle, Minus, ArrowRight, Hand, PenLine, Slash, Radio, Disc3, LocateFixed, Sparkles, PartyPopper, Snowflake, ScanSearch, Blend, Search, type LucideIcon } from "lucide-react";
import type { EditorConfig, CursorPackInfo, Layer, TextLayer, ShapeLayer, MaskLayer, ClickEffect, MovementSpeed } from "../../../lib/types";
import { GRADIENT_PRESETS, COLOR_PRESETS, WALLPAPER_PRESETS, gradientToCss } from "../../../lib/wallpapers";
import type { SidebarToolTab } from "../Editor";
import Slider, { ColorInput } from "../../shared/Slider";
import "./Panels.css";

interface Props {
  config: EditorConfig;
  onConfigChange: (cfg: EditorConfig) => void;
  duration: number;
  currentTime: number;
  keyframesCount: number;
  layers: Layer[];
  selectedLayerId: string | null;
  onAddLayer: (layer: Layer) => void;
  onSelectLayer: (id: string | null) => void;
  activeTab: SidebarToolTab;
  onAddManualZoom: () => void;
  onRegenerateAutoZoom: () => void;
  onZoomModeChange: (mode: "auto" | "manual") => void;
}

const CLICK_EFFECTS: { value: ClickEffect; label: string }[] = [
  { value: "none", label: "None" },
  { value: "default", label: "Default" },
  { value: "ripple", label: "Ripple" },
  { value: "ring", label: "Ring" },
  { value: "diffusion", label: "Diffusion" },
  { value: "spotlight", label: "Spotlight" },
  { value: "sparkle", label: "Sparkle" },
  { value: "firework", label: "Firework" },
  { value: "christmas", label: "Christmas" },
];

const CLICK_EFFECT_ICONS: Record<ClickEffect, LucideIcon> = {
  none: Slash,
  default: MousePointer2,
  ripple: Radio,
  ring: Circle,
  diffusion: Disc3,
  spotlight: LocateFixed,
  sparkle: Sparkles,
  firework: PartyPopper,
  christmas: Snowflake,
};

export default function Panels({
  config, onConfigChange, duration, currentTime, keyframesCount,
  layers, selectedLayerId, onAddLayer, onSelectLayer,
  activeTab, onAddManualZoom, onRegenerateAutoZoom, onZoomModeChange,
}: Props) {
  const [cursorPacks, setCursorPacks] = useState<CursorPackInfo[]>([]);
  const [cursorPacksError, setCursorPacksError] = useState("");
  const [bgCategory, setBgCategory] = useState<"gradient" | "color" | "image">("gradient");

  const update = (patch: Partial<EditorConfig>) => onConfigChange({ ...config, ...patch });
  const updateCursor = (patch: Partial<EditorConfig["cursorStyle"]>) =>
    onConfigChange({ ...config, cursorStyle: { ...config.cursorStyle, ...patch } });
  const updateShadow = (patch: Partial<EditorConfig["shadow"]>) =>
    onConfigChange({ ...config, shadow: { ...config.shadow, ...patch } });
  const updateBlur = (patch: Partial<EditorConfig["motionBlur"]>) =>
    onConfigChange({ ...config, motionBlur: { ...config.motionBlur, ...patch } });
  const updateCursorMov = (patch: Partial<EditorConfig["cursorMovement"]>) =>
    onConfigChange({ ...config, cursorMovement: { ...config.cursorMovement, ...patch } });
  const updateZoomMov = (patch: Partial<EditorConfig["zoomMovement"]>) =>
    onConfigChange({ ...config, zoomMovement: { ...config.zoomMovement, ...patch } });
  const updateAudio = (patch: Partial<EditorConfig["audio"]>) =>
    onConfigChange({ ...config, audio: { ...config.audio, ...patch } });

  useEffect(() => {
    let alive = true;
    (async () => {
      try { const packs = await invoke<CursorPackInfo[]>("list_cursor_packs"); if (alive) setCursorPacks(packs); }
      catch (e) { if (alive) setCursorPacksError(`Failed to load cursor packs: ${e}`); }
    })();
    return () => { alive = false; };
  }, []);

  const packHotspotOrDefault = (packId: string): { x: number; y: number } => {
    const stored = config.cursorHotspots[packId];
    if (stored) return stored;
    return /\bhand\b/i.test(packId) ? { x: 20, y: 0 } : { x: 10, y: 10 };
  };

  const selectPack = (pack: CursorPackInfo) => {
    onConfigChange({
      ...config,
      cursorStyle: { ...config.cursorStyle, pack: { id: pack.name, label: pack.label, imageUrl: pack.pointer_url } },
      cursorHotspots: { ...config.cursorHotspots, [pack.name]: packHotspotOrDefault(pack.name) },
    });
  };

  const clearPack = () => updateCursor({ pack: null });

  const addLayer = (layer: Layer) => {
    onAddLayer(layer);
    onSelectLayer(layer.id);
  };

  const genId = () => `layer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const layerTiming = () => {
    const clipEnd = config.trimEnd > 0 ? Math.min(duration, config.trimEnd) : duration;
    const start = Math.max(config.trimStart, currentTime - 0.15);
    return { start, end: Math.max(start, Math.min(clipEnd, currentTime + 3)) };
  };

  const makeTextLayer = (style: TextLayer["style"]): TextLayer => {
    const timing = layerTiming();
    return {
      id: genId(), type: "text", ...timing, x: 0.2, y: 0.4, w: 0.6, h: 0.16,
      content: style === "badge" ? "1" : "Text", style, color: "#ffffff", fontSize: 24,
    };
  };

  const makeShapeLayer = (shape: ShapeLayer["shape"], color: string): ShapeLayer => {
    const timing = layerTiming();
    return {
      id: genId(), type: "shape", ...timing, x: 0.3, y: 0.3, w: 0.4, h: 0.4,
      shape, color, strokeWidth: 3,
    };
  };

  const makeMaskLayer = (mask: MaskLayer["mask"]): MaskLayer => {
    const timing = layerTiming();
    return {
      id: genId(), type: "mask", ...timing, x: 0.32, y: 0.28, w: 0.36, h: 0.34,
      mask, intensity: mask === "blur" ? 12 : mask === "magnifier" ? 2.0 : 1,
    };
  };

  // ── Layers list ───────────────────────────────────────────────────
  const deleteLayer = (id: string) => {
    onConfigChange({ ...config, layers: config.layers.filter((l) => l.id !== id) });
    if (selectedLayerId === id) onSelectLayer(null);
  };
  const selectedLayer = layers.find((layer) => layer.id === selectedLayerId) ?? null;
  const updateSelectedLayer = (patch: Partial<Layer>) => {
    if (!selectedLayer) return;
    onConfigChange({ ...config, layers: config.layers.map((layer) => layer.id === selectedLayer.id ? ({ ...layer, ...patch } as Layer) : layer) });
  };

  return (
    <aside className="ss-panels-drawer">
      {/* ═══ CANVAS TAB ═══════════════════════════════════════════════ */}
      {activeTab === "canvas" && (
        <div className="ss-drawer-content">
          <Section title="Canvas Styling">
            <Slider label="Padding" value={config.padding} min={0} max={160} step={4} unit="px" onChange={(v) => update({ padding: v })} defaultValue={48} onReset={() => update({ padding: 48 })} />
            <div className="field-row">
              <label>Inset</label>
              <div style={{ display: "flex", gap: "var(--space-2)", alignItems: "center", flex: 1 }}>
                <div style={{ flex: 1 }}>
                  <Slider value={config.inset} min={0} max={40} step={1} unit="px" onChange={(v) => update({ inset: v })} defaultValue={0} onReset={() => update({ inset: 0 })} compact />
                </div>
                <input type="color" value={config.insetColor} onChange={(e) => update({ insetColor: e.target.value })} className="color-swatch" style={{ width: 28, height: 28, padding: 0, border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-sm)", cursor: "pointer" }} />
              </div>
            </div>
            <Slider label="Roundness" value={config.borderRadius} min={0} max={60} step={1} unit="px" onChange={(v) => update({ borderRadius: v })} defaultValue={14} onReset={() => update({ borderRadius: 14 })} />
            <Slider label="Shadow" value={config.shadow.blur} min={0} max={100} step={2} unit="px" onChange={(v) => updateShadow({ blur: v })} defaultValue={40} onReset={() => updateShadow({ blur: 40 })} />
          </Section>

          <Section title="Background">
            <div className="ss-subtab-segmented">
              {(["gradient", "color", "image"] as const).map((cat) => (
                <button key={cat} className={`subtab-btn ${bgCategory === cat ? "active" : ""}`} onClick={() => setBgCategory(cat)}>
                  {cat === "gradient" ? "Gradients" : cat === "color" ? "Colors" : "Images"}
                </button>
              ))}
            </div>
            {bgCategory === "gradient" && (
              <div className="ss-wallpaper-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)" }}>
                {GRADIENT_PRESETS.map((preset) => (
                  <div
                    key={preset.id}
                    className={`ss-wallpaper-card ${config.bgType === "gradient" && config.wallpaperUrl === preset.id ? "active" : ""}`}
                    style={{ background: gradientToCss(preset), width: 32, height: 32, aspectRatio: "unset" }}
                    onClick={() => update({ bgType: "gradient", wallpaperUrl: preset.id })}
                    title={preset.name}
                  />
                ))}
              </div>
            )}
            {bgCategory === "color" && (
              <div className="ss-wallpaper-grid" style={{ gridTemplateColumns: "repeat(4, 1fr)", marginTop: "var(--space-2)" }}>
                {COLOR_PRESETS.map((preset) => (
                  <div
                    key={preset.id}
                    className={`ss-wallpaper-card ${config.bgType === "color" && config.backgroundColor === preset.color ? "active" : ""}`}
                    style={{ background: preset.color, width: 32, height: 32, aspectRatio: "unset", border: "1px solid var(--border-subtle)" }}
                    onClick={() => update({ bgType: "color", backgroundColor: preset.color })}
                    title={preset.name}
                  />
                ))}
              </div>
            )}
            {bgCategory === "image" && (
              <>
                <div className="ss-wallpaper-grid image-grid">
                  {WALLPAPER_PRESETS.map((preset) => (
                    <div
                      key={preset.id}
                      className={`ss-wallpaper-card ${config.bgType === "image" && config.wallpaperUrl === preset.id ? "active" : ""}`}
                      style={{ backgroundImage: `url(${preset.url})` }}
                      onClick={() => update({ bgType: "image", wallpaperUrl: preset.id })}
                      title={preset.name}
                    />
                  ))}
                </div>
                <Slider label="Blur Radius" value={config.bgBlur} min={0} max={100} step={2} unit="px" onChange={(v) => update({ bgBlur: v })} />
              </>
            )}
          </Section>
        </div>
      )}

      {/* ═══ CURSOR TAB ═══════════════════════════════════════════════ */}
      {activeTab === "cursor" && (
        <div className="ss-drawer-content">
          <Section title="Cursor">
            <CheckRow label="Show Cursor" checked={config.showCursor} onChange={(v) => update({ showCursor: v })} />
            <Slider label="Cursor Size" value={config.cursorStyle.size} min={8} max={40} step={1} unit="px" onChange={(v) => updateCursor({ size: v })} defaultValue={16} onReset={() => updateCursor({ size: 16 })} />

            <div className="cursor-pack-grid">
              <div className={`cursor-pack-card ${!config.cursorStyle.pack ? "active" : ""}`} onClick={clearPack} title="Built-in cursor">
                <div className="cursor-pack-thumb default-thumb"><MousePointer size={16} /></div>
                <span className="cursor-pack-label">Default</span>
              </div>
              {cursorPacks.map((pack) => (
                <div
                  key={pack.name}
                  className={`cursor-pack-card ${config.cursorStyle.pack?.id === pack.name ? "active" : ""}`}
                  onClick={() => selectPack(pack)}
                  title={pack.label}
                >
                  <div className="cursor-pack-thumb"><img src={pack.pointer_url} alt={pack.label} draggable={false} /></div>
                  <span className="cursor-pack-label">{pack.label}</span>
                </div>
              ))}
            </div>
            {cursorPacksError && <p className="cursor-pack-error">{cursorPacksError}</p>}

            {!config.cursorStyle.pack && (
              <ColorInput label="Cursor Color" value={config.cursorStyle.color} onChange={(v) => updateCursor({ color: v })} />
            )}
          </Section>

          <Section title="Click Effect">
            <div className="effect-grid">
              {CLICK_EFFECTS.map((eff) => (
                <div
                  key={eff.value}
                  className={`effect-card ${config.cursorStyle.clickEffect === eff.value ? "active" : ""}`}
                  onClick={() => updateCursor({ clickEffect: eff.value })}
                  title={eff.label}
                >
                  <EffectThumbnail effect={eff.value} />
                  <span className="effect-label">{eff.label}</span>
                </div>
              ))}
            </div>
          </Section>

          <CheckRow label="Cursor Click Sound" checked={config.cursorStyle.clickSound} onChange={(v) => updateCursor({ clickSound: v })} />
          <CheckRow label="Hide Cursor When Idle" checked={config.cursorStyle.hideWhenIdle} onChange={(v) => updateCursor({ hideWhenIdle: v })} />
        </div>
      )}

      {/* ═══ ANNOTATIONS TAB ═══════════════════════════════════════════ */}
      {activeTab === "annotations" && (
        <div className="ss-drawer-content">
          <Section title="Text">
            <div className="annotation-card-grid">
              {(["plain", "boxed", "pill", "badge"] as TextLayer["style"][]).map((style) => (
                <div key={style} className="annotation-card" onClick={() => addLayer(makeTextLayer(style))}>
                  <div className="annotation-preview" style={{ background: style === "pill" ? "#7c3aed" : style === "badge" ? "#2563eb" : style === "boxed" ? "#1e293b" : "transparent", border: style === "plain" ? "1px dashed var(--border-default)" : "none" }}>
                    <Type size={14} color="#fff" />
                  </div>
                  <span className="card-title-text" style={{ fontSize: "var(--text-xs)" }}>{style === "badge" ? "1" : "Text"}</span>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Shape">
            <div className="annotation-card-grid">
              {([
                { shape: "line" as const, color: "#ef4444", icon: <Minus size={16} color="#ef4444" /> },
                { shape: "dashedLine" as const, color: "#ef4444", icon: <PenLine size={16} color="#ef4444" /> },
                { shape: "arrow" as const, color: "#ef4444", icon: <ArrowRight size={16} color="#ef4444" /> },
                { shape: "rectangle" as const, color: "#ef4444", icon: <Square size={16} color="#ef4444" /> },
                { shape: "roundedRect" as const, color: "#eab308", icon: <Square size={16} color="#eab308" /> },
                { shape: "circle" as const, color: "#8b5cf6", icon: <Circle size={16} color="#8b5cf6" /> },
                { shape: "blob" as const, color: "#ef4444", icon: <Circle size={16} color="#ef4444" /> },
                { shape: "downArrow" as const, color: "#ec4899", icon: <ArrowRight size={16} color="#ec4899" style={{ transform: "rotate(90deg)" }} /> },
                { shape: "pointer" as const, color: "#ec4899", icon: <Hand size={16} color="#ec4899" /> },
              ]).map(({ shape, color, icon }) => (
                <div key={shape} className="annotation-card" onClick={() => addLayer(makeShapeLayer(shape, color))}>
                  <div className="annotation-preview">{icon}</div>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Mask">
            <div className="annotation-card-grid">
              {([
                { mask: "spotlight" as const, label: "Spotlight", icon: <ScanSearch size={18} /> },
                { mask: "blur" as const, label: "Blur", icon: <Blend size={18} /> },
                { mask: "magnifier" as const, label: "Magnifier", icon: <Search size={18} /> },
              ]).map(({ mask, label, icon }) => (
                <div key={mask} className="annotation-card" onClick={() => addLayer(makeMaskLayer(mask))}>
                  <div className={`annotation-preview mask-preview ${mask}`}>
                    {icon}
                  </div>
                  <span className="card-title-text" style={{ fontSize: "var(--text-xs)" }}>{label}</span>
                </div>
              ))}
            </div>
          </Section>

          {/* Active layers list */}
          {layers.length > 0 && (
            <Section title="Layers">
              <div className="layers-list">
                {layers.map((layer) => (
                  <div
                    key={layer.id}
                    className={`layer-row ${selectedLayerId === layer.id ? "active" : ""}`}
                    onClick={() => onSelectLayer(layer.id)}
                  >
                    <span className="layer-type-tag">{layer.type}</span>
                    <span className="layer-time">{(layer.start).toFixed(1)}s–{(layer.end).toFixed(1)}s</span>
                    <button className="layer-delete-btn" onClick={(e) => { e.stopPropagation(); deleteLayer(layer.id); }} title="Delete layer">
                      <Minus size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </Section>
          )}
          {selectedLayer && (
            <Section title="Selected Layer">
              {selectedLayer.type === "text" && (
                <>
                  <div className="field-row"><label>Text</label><input className="layer-text-input" value={selectedLayer.content} onChange={(e) => updateSelectedLayer({ content: e.target.value })} /></div>
                  <ColorInput label="Color" value={selectedLayer.color} onChange={(color) => updateSelectedLayer({ color })} />
                  <Slider label="Font Size" value={selectedLayer.fontSize} min={10} max={96} step={1} unit="px" onChange={(fontSize) => updateSelectedLayer({ fontSize })} />
                </>
              )}
              {selectedLayer.type === "shape" && (
                <>
                  <ColorInput label="Color" value={selectedLayer.color} onChange={(color) => updateSelectedLayer({ color })} />
                  <Slider label="Stroke" value={selectedLayer.strokeWidth} min={1} max={16} step={1} unit="px" onChange={(strokeWidth) => updateSelectedLayer({ strokeWidth })} />
                </>
              )}
              {selectedLayer.type === "mask" && (
                <Slider label="Intensity" value={selectedLayer.intensity} min={0.5} max={selectedLayer.mask === "blur" ? 40 : 4} step={0.5} onChange={(intensity) => updateSelectedLayer({ intensity })} />
              )}
              <Slider label="Start" value={selectedLayer.start} min={0} max={duration} step={0.1} unit="s" onChange={(start) => updateSelectedLayer({ start: Math.min(start, selectedLayer.end) })} />
              <Slider label="End" value={selectedLayer.end} min={0} max={duration} step={0.1} unit="s" onChange={(end) => updateSelectedLayer({ end: Math.max(end, selectedLayer.start) })} />
              <p className="cursor-pack-error" style={{ margin: 0 }}>Drag the layer in the preview; drag its lower-right corner to resize.</p>
            </Section>
          )}
        </div>
      )}

      {/* ═══ MOTION TAB ═══════════════════════════════════════════════ */}
      {activeTab === "motion" && (
        <div className="ss-drawer-content">
          <Section title="Motion Blur">
            <CheckRow label="Motion Blur" checked={config.motionBlur.enabled} onChange={(v) => updateBlur({ enabled: v })} />
            <Slider label="Zoom-in Blur" value={config.motionBlur.zoomAmount} min={0} max={100} step={5} unit="%" onChange={(v) => updateBlur({ zoomAmount: v })} defaultValue={0} onReset={() => updateBlur({ zoomAmount: 0 })} disabled={!config.motionBlur.enabled} />
            <Slider label="Screen Blur" value={config.motionBlur.panAmount} min={0} max={100} step={5} unit="%" onChange={(v) => updateBlur({ panAmount: v })} defaultValue={0} onReset={() => updateBlur({ panAmount: 0 })} disabled={!config.motionBlur.enabled} />
            <Slider label="Cursor Blur" value={config.motionBlur.cursorAmount} min={0} max={100} step={5} unit="%" onChange={(v) => updateBlur({ cursorAmount: v })} defaultValue={0} onReset={() => updateBlur({ cursorAmount: 0 })} disabled={!config.motionBlur.enabled} />
          </Section>

          <Section title="Cursor Movement">
            <CheckRow label="Cursor Movement" checked={config.cursorMovement.enabled} onChange={(v) => updateCursorMov({ enabled: v })} />
            <SpeedPills speed={config.cursorMovement.speed} onChange={(speed) => updateCursorMov({ speed })} />
            {config.cursorMovement.speed === "custom" && (
              <Slider label="Duration" value={config.cursorMovement.durationMs} min={100} max={2000} step={50} unit="ms" onChange={(v) => updateCursorMov({ durationMs: v })} />
            )}
          </Section>

          <Section title="Zoom & Pan">
            <div className="toggle-segmented">
              <button className={`seg-btn ${config.zoomMode === "auto" ? "active" : ""}`} onClick={() => onZoomModeChange("auto")}>Auto</button>
              <button className={`seg-btn ${config.zoomMode === "manual" ? "active" : ""}`} onClick={() => onZoomModeChange("manual")}>Manual</button>
            </div>
            <CheckRow label="Zoom Movement" checked={config.zoomMovement.enabled} onChange={(v) => updateZoomMov({ enabled: v })} />
            <CheckRow label="Lock Focus Point" checked={config.fixedZoomPart} onChange={(v) => update({ fixedZoomPart: v })} />
            <SpeedPills speed={config.zoomMovement.speed} onChange={(speed) => updateZoomMov({ speed })} />
            {config.zoomMovement.speed === "custom" && (
              <Slider label="Duration" value={config.zoomMovement.durationMs} min={100} max={3000} step={100} unit="ms" onChange={(v) => updateZoomMov({ durationMs: v })} />
            )}
            <div className="section-info-badge" style={{ marginTop: "var(--space-2)" }}>
              <span>{config.zoomMode === "auto" ? `Auto Mode: ${keyframesCount} keyframes` : `Manual Mode: ${keyframesCount} keyframes`}</span>
            </div>
            {config.zoomMode === "manual" && (
              <button className="ss-drawer-action-btn primary" onClick={onAddManualZoom} style={{ marginTop: "var(--space-2)" }}>
                + Add Zoom Region
              </button>
            )}
            <p className="cursor-pack-error" style={{ margin: "2px 0 0" }}>
              Zoom regions appear as editable bars in the timeline. Drag a bar to move it or drag its edges to change the duration.
            </p>
            {config.zoomMode === "auto" && (
              <button className="ss-drawer-action-btn" onClick={onRegenerateAutoZoom} style={{ marginTop: "var(--space-2)" }}>
                Regenerate Auto-Zoom
              </button>
            )}
          </Section>
        </div>
      )}

      {/* ═══ AUDIO TAB ═══════════════════════════════════════════════ */}
      {activeTab === "audio" && (
        <div className="ss-drawer-content">
          <Section title="System Audio">
            <CheckRow label="Mute System Audio" checked={config.audio.systemMuted} onChange={(v) => updateAudio({ systemMuted: v })} />
            <Slider label="Volume" value={config.audio.systemVolume} min={0} max={200} step={5} unit="%" onChange={(v) => updateAudio({ systemVolume: v })} disabled={config.audio.systemMuted} />
          </Section>
          <Section title="Microphone">
            <CheckRow label="Mute Microphone" checked={config.audio.micMuted} onChange={(v) => updateAudio({ micMuted: v })} />
            <Slider label="Volume" value={config.audio.micVolume} min={0} max={200} step={5} unit="%" onChange={(v) => updateAudio({ micVolume: v })} disabled={config.audio.micMuted} />
          </Section>
        </div>
      )}

    </aside>
  );
}

/* ── Helpers ────────────────────────────────────────────────────────── */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <div className="ss-section"><h4 className="ss-section-heading">{title}</h4><div className="ss-section-body">{children}</div></div>;
}

function CheckRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="field-row check-row" onClick={() => onChange(!checked)}>
      <label>{label}</label>
      <div className={`pro-checkbox ${checked ? "checked" : ""}`}>{checked && <Check size={12} strokeWidth={3} />}</div>
    </div>
  );
}

function EffectThumbnail({ effect }: { effect: ClickEffect }) {
  const Icon = CLICK_EFFECT_ICONS[effect];
  return (
    <div className={`effect-icon effect-${effect}`}>
      <span className="effect-orbit" />
      <Icon size={18} strokeWidth={1.8} />
    </div>
  );
}

function SpeedPills({ speed, onChange }: { speed: MovementSpeed; onChange: (v: MovementSpeed) => void }) {
  return (
    <div className="toggle-segmented speed-pills" style={{ marginTop: "var(--space-1)" }}>
      {(["slow", "medium", "fast", "rapid", "custom"] as MovementSpeed[]).map((s) => (
        <button key={s} className={`seg-btn ${speed === s ? "active" : ""}`} onClick={() => onChange(s)}>
          {s.charAt(0).toUpperCase() + s.slice(1)}
        </button>
      ))}
    </div>
  );
}
