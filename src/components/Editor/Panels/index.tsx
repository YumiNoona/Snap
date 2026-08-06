import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { MousePointer, Check, Type, Square, Circle, Minus, ArrowRight, Hand, PenLine } from "lucide-react";
import type { EditorConfig, ExportSettings, CursorPackInfo, Layer, TextLayer, ShapeLayer, MaskLayer, ClickEffect, MovementSpeed } from "../../../lib/types";
import { GRADIENT_PRESETS, COLOR_PRESETS, gradientToCss } from "../../../lib/wallpapers";
import { ASPECT_RATIOS } from "../../../lib/types";
import type { SidebarToolTab } from "../Editor";
import Slider, { ColorInput } from "../../shared/Slider";
import Dropdown from "../../shared/Dropdown";
import "./Panels.css";

interface Props {
  config: EditorConfig;
  onConfigChange: (cfg: EditorConfig) => void;
  videoPath: string;
  duration: number;
  currentTime: number;
  keyframesCount: number;
  layers: Layer[];
  selectedLayerId: string | null;
  onAddLayer: (layer: Layer) => void;
  onSelectLayer: (id: string | null) => void;
  onExport: (settings: ExportSettings) => void;
  exportStatus: string;
  activeTab: SidebarToolTab;
  onAddManualZoom: () => void;
}

const PREMIERE_PRESETS = [
  { id: "4k", label: "4K Ultra HD", w: 3840, h: 2160, fps: 60, desc: "3840x2160 • 60 FPS" },
  { id: "2k", label: "2K Quad HD", w: 2560, h: 1440, fps: 60, desc: "2560x1440 • 60 FPS" },
  { id: "1080p", label: "1080p Full HD", w: 1920, h: 1080, fps: 60, desc: "1920x1080 • 60 FPS (Recommended)" },
  { id: "720p", label: "720p HD", w: 1280, h: 720, fps: 30, desc: "1280x720 • 30 FPS" },
  { id: "shorts", label: "Reels / Shorts (9:16)", w: 1080, h: 1920, fps: 60, desc: "1080x1920 • Vertical 9:16" },
  { id: "gif", label: "Animated GIF", w: 800, h: 600, fps: 30, desc: "800x600 • 30 FPS Loop" },
] as const;

const CLICK_EFFECTS: { value: ClickEffect; label: string; icon: string }[] = [
  { value: "none", label: "None", icon: "" },
  { value: "default", label: "Default", icon: "" },
  { value: "ripple", label: "Ripple", icon: "" },
  { value: "ring", label: "Ring", icon: "" },
  { value: "diffusion", label: "Diffusion", icon: "" },
  { value: "spotlight", label: "Spotlight", icon: "" },
  { value: "sparkle", label: "Sparkle", icon: "" },
  { value: "firework", label: "Firework", icon: "" },
  { value: "christmas", label: "Christmas", icon: "" },
];

export default function Panels({
  config, onConfigChange, videoPath, duration, currentTime, keyframesCount,
  layers, selectedLayerId, onAddLayer, onSelectLayer,
  onExport, exportStatus, activeTab, onAddManualZoom,
}: Props) {
  const [selectedPresetId, setSelectedPresetId] = useState<string>("1080p");
  const [cursorPacks, setCursorPacks] = useState<CursorPackInfo[]>([]);
  const [cursorPacksError, setCursorPacksError] = useState("");
  const [bgCategory, setBgCategory] = useState<string>("all");
  const [exportSettings, setExportSettings] = useState<ExportSettings>({
    format: "mp4", fps: 60, width: 1920, height: 1080, quality: "high",
    outputPath: videoPath.replace(/\.mp4$/i, "_edited.mp4"),
  });

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
  const setHotspot = (axis: "x" | "y", val: number) => {
    const pack = config.cursorStyle.pack;
    if (!pack) return;
    const v = Math.max(0, Math.min(100, Math.round(val)));
    onConfigChange({ ...config, cursorHotspots: { ...config.cursorHotspots, [pack.id]: { ...packHotspotOrDefault(pack.id), [axis]: v } } });
  };

  const applyPreset = (preset: typeof PREMIERE_PRESETS[number]) => {
    setSelectedPresetId(preset.id);
    const format = preset.id === "gif" ? "gif" : "mp4";
    setExportSettings({ ...exportSettings, width: preset.w, height: preset.h, fps: preset.fps, format, outputPath: videoPath.replace(/\.mp4$/i, `_${preset.id}.${format}`) });
  };

  const activeDuration = Math.max(1, (config.trimEnd || duration) - config.trimStart);
  const estimatedMB = (activeDuration * (exportSettings.width * exportSettings.height * exportSettings.fps * 0.0000035)).toFixed(1);

  const bgTab: "gradient" | "image" | "color" = config.bgType === "image" ? "image" : config.bgType === "color" ? "color" : "gradient";

  const addLayer = (layer: Layer) => {
    onAddLayer(layer);
    onSelectLayer(layer.id);
  };

  const genId = () => `layer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const makeTextLayer = (style: TextLayer["style"]): TextLayer => ({
    id: genId(), type: "text", start: currentTime, end: Math.min(currentTime + 3, duration), x: 0.15, y: 0.4, w: 0.7, h: 0.15,
    content: "Text", style, color: "#ffffff", fontSize: 24,
  });

  const makeShapeLayer = (shape: ShapeLayer["shape"], color: string): ShapeLayer => ({
    id: genId(), type: "shape", start: currentTime, end: Math.min(currentTime + 3, duration), x: 0.3, y: 0.3, w: 0.4, h: 0.4,
    shape, color, strokeWidth: 3,
  });

  const makeMaskLayer = (mask: MaskLayer["mask"]): MaskLayer => ({
    id: genId(), type: "mask", start: currentTime, end: Math.min(currentTime + 3, duration), x: 0.2, y: 0.2, w: 0.3, h: 0.3,
    mask, intensity: mask === "blur" ? 12 : mask === "magnifier" ? 2.0 : 1,
  });

  // ── Layers list ───────────────────────────────────────────────────
  const deleteLayer = (id: string) => {
    onConfigChange({ ...config, layers: config.layers.filter((l) => l.id !== id) });
    if (selectedLayerId === id) onSelectLayer(null);
  };

  return (
    <aside className="ss-panels-drawer">
      {/* ═══ CANVAS TAB ═══════════════════════════════════════════════ */}
      {activeTab === "canvas" && (
        <div className="ss-drawer-content">
          <Section title="Canvas Size">
            <div className="aspect-pills-row">
              {ASPECT_RATIOS.filter((a) => a.width > 0).slice(0, 5).map((ar) => {
                const isActive = config.aspectRatio
                  ? config.aspectRatio.width === ar.width && config.aspectRatio.height === ar.height
                  : false;
                return (
                  <button
                    key={ar.label}
                    className={`seg-btn pill ${isActive ? "active" : ""}`}
                    onClick={() => update({ aspectRatio: { width: ar.width, height: ar.height } })}
                  >
                    {ar.label}
                  </button>
                );
              })}
              <button
                className={`seg-btn pill ${!config.aspectRatio ? "active" : ""}`}
                onClick={() => update({ aspectRatio: null })}
              >
                Original
              </button>
            </div>
            <div className="field-row" style={{ marginTop: "var(--space-2)" }}>
              <label>Style</label>
              <Dropdown
                value="custom"
                onChange={() => {}}
                options={[{ value: "custom", label: "Custom" }]}
              />
            </div>
            <CheckRow label="Fixed Zoom Part" checked={config.fixedZoomPart} onChange={(v) => update({ fixedZoomPart: v })} />
          </Section>

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
              {["all", "gradient", "color"].map((cat) => (
                <button key={cat} className={`subtab-btn ${bgCategory === cat ? "active" : ""}`} onClick={() => setBgCategory(cat)}>
                  {cat === "all" ? "All" : cat === "gradient" ? "Gradients" : "Colors"}
                </button>
              ))}
            </div>
            {(bgCategory === "all" || bgCategory === "gradient") && (
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
            {(bgCategory === "all" || bgCategory === "color") && (
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
            {bgTab === "image" && <Slider label="Blur Radius" value={config.bgBlur} min={0} max={100} step={2} unit="px" onChange={(v) => update({ bgBlur: v })} />}
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

            {config.cursorStyle.pack && (
              <div className="hotspot-box">
                <div className="hotspot-title">Hotspot<span className="hotspot-hint">click point as % of image</span></div>
                <div className="hotspot-row"><label>Hotspot X</label><input type="number" min={0} max={100} value={packHotspotOrDefault(config.cursorStyle.pack.id).x} onChange={(e) => setHotspot("x", Number(e.target.value))} /></div>
                <div className="hotspot-row"><label>Hotspot Y</label><input type="number" min={0} max={100} value={packHotspotOrDefault(config.cursorStyle.pack.id).y} onChange={(e) => setHotspot("y", Number(e.target.value))} /></div>
              </div>
            )}

            <ColorInput label="Cursor Color" value={config.cursorStyle.color} onChange={(v) => updateCursor({ color: v })} />
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
                  <div className="effect-icon">{eff.value === "none" ? <Minus size={18} /> : <Circle size={18} />}</div>
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
                { mask: "spotlight" as const, label: "Spotlight" },
                { mask: "blur" as const, label: "Blur" },
                { mask: "magnifier" as const, label: "Magnifier" },
              ]).map(({ mask, label }) => (
                <div key={mask} className="annotation-card" onClick={() => addLayer(makeMaskLayer(mask))}>
                  <div className="annotation-preview" style={{ background: "var(--bg-surface-sunken)" }}>
                    <Square size={16} color="var(--text-secondary)" />
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
            <CheckRow label="Zoom Movement" checked={config.zoomMovement.enabled} onChange={(v) => updateZoomMov({ enabled: v })} />
            <SpeedPills speed={config.zoomMovement.speed} onChange={(speed) => updateZoomMov({ speed })} />
            {config.zoomMovement.speed === "custom" && (
              <Slider label="Duration" value={config.zoomMovement.durationMs} min={100} max={3000} step={100} unit="ms" onChange={(v) => updateZoomMov({ durationMs: v })} />
            )}
            <div className="section-info-badge" style={{ marginTop: "var(--space-2)" }}>
              <span>{config.zoomMode === "auto" ? `Auto Mode: ${keyframesCount} keyframes` : `Manual Mode: ${keyframesCount} keyframes`}</span>
            </div>
            {config.zoomMode === "manual" && (
              <button className="ss-drawer-action-btn primary" onClick={onAddManualZoom} style={{ marginTop: "var(--space-2)" }}>
                + Add Zoom Keyframe
              </button>
            )}
          </Section>
        </div>
      )}

      {/* ═══ AUDIO TAB ═══════════════════════════════════════════════ */}
      {activeTab === "audio" && (
        <div className="ss-drawer-content">
          <Section title="Audio">
            <p className="cursor-pack-error" style={{ margin: 0 }}>Audio controls coming soon.</p>
          </Section>
        </div>
      )}

      {/* ═══ EXPORT TAB ═══════════════════════════════════════════════ */}
      {activeTab === "export" && (
        <div className="ss-drawer-content">
          <Section title="Export Presets">
            <div className="export-preset-cards-grid">
              {PREMIERE_PRESETS.map((p) => (
                <div key={p.id} className={`export-card ${selectedPresetId === p.id ? "active" : ""}`} onClick={() => applyPreset(p)}>
                  <div className="card-top-title">
                    <span className="card-name">{p.label}</span>
                    {selectedPresetId === p.id && <span className="active-tag">Selected</span>}
                  </div>
                  <span className="card-desc">{p.desc}</span>
                </div>
              ))}
            </div>
          </Section>

          <Section title="Render Configuration">
            <div className="render-info-card">
              <div className="info-row"><span className="lbl">Duration</span><span className="val">{activeDuration.toFixed(1)}s</span></div>
              <div className="info-row"><span className="lbl">Est. File Size</span><span className="val highlight">~{estimatedMB} MB</span></div>
            </div>
            <div className="field-row" style={{ marginTop: "var(--space-2)" }}>
              <label>Format</label>
              <div className="toggle-segmented">
                <button className={`seg-btn ${exportSettings.format === "mp4" ? "active" : ""}`} onClick={() => setExportSettings({ ...exportSettings, format: "mp4" })}>MP4</button>
                <button className={`seg-btn ${exportSettings.format === "gif" ? "active" : ""}`} onClick={() => setExportSettings({ ...exportSettings, format: "gif" })}>GIF</button>
              </div>
            </div>
          </Section>

          {exportStatus && (
            <div className={`export-status-banner ${exportStatus.startsWith("Done") ? "success" : exportStatus.startsWith("Export failed") ? "error" : "progress"}`}>
              {exportStatus}
            </div>
          )}

          <button className="pro-render-export-btn" onClick={() => onExport(exportSettings)} disabled={exportStatus === "Exporting..."}>
            {exportStatus === "Exporting..." ? "Rendering..." : `Render ${exportSettings.format.toUpperCase()}`}
          </button>
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

function SpeedPills({ speed, onChange }: { speed: MovementSpeed; onChange: (v: MovementSpeed) => void }) {
  return (
    <div className="toggle-segmented" style={{ marginTop: "var(--space-1)" }}>
      {(["slow", "medium", "fast", "rapid", "custom"] as MovementSpeed[]).map((s) => (
        <button key={s} className={`seg-btn ${speed === s ? "active" : ""}`} onClick={() => onChange(s)}>
          {s.charAt(0).toUpperCase() + s.slice(1)}
        </button>
      ))}
    </div>
  );
}
