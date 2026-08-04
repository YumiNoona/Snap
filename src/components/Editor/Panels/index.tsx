import { useState } from "react";
import type { EditorConfig, ExportSettings } from "../../../lib/types";
import { WALLPAPER_PRESETS } from "../../../lib/wallpapers";
import type { SidebarToolTab } from "../Editor";
import "./Panels.css";

interface Props {
  config: EditorConfig;
  onConfigChange: (cfg: EditorConfig) => void;
  videoPath: string;
  duration: number;
  keyframesCount: number;
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

export default function Panels({
  config,
  onConfigChange,
  videoPath,
  duration,
  keyframesCount,
  onExport,
  exportStatus,
  activeTab,
  onAddManualZoom,
}: Props) {
  const [bgCategory, setBgCategory] = useState<"wallpaper" | "gradient" | "color" | "image">("wallpaper");
  const [selectedPresetId, setSelectedPresetId] = useState<string>("1080p");
  const [exportSettings, setExportSettings] = useState<ExportSettings>({
    format: "mp4",
    fps: 60,
    width: 1920,
    height: 1080,
    quality: "high",
    outputPath: videoPath.replace(/\.mp4$/i, "_edited.mp4"),
  });

  const update = (patch: Partial<EditorConfig>) => onConfigChange({ ...config, ...patch });
  const updateCursor = (patch: Partial<EditorConfig["cursorStyle"]>) =>
    onConfigChange({ ...config, cursorStyle: { ...config.cursorStyle, ...patch } });
  const updateShadow = (patch: Partial<EditorConfig["shadow"]>) =>
    onConfigChange({ ...config, shadow: { ...config.shadow, ...patch } });

  const applyPreset = (preset: typeof PREMIERE_PRESETS[number]) => {
    setSelectedPresetId(preset.id);
    const format = preset.id === "gif" ? "gif" : "mp4";
    setExportSettings({
      ...exportSettings,
      width: preset.w,
      height: preset.h,
      fps: preset.fps,
      format,
      outputPath: videoPath.replace(/\.mp4$/i, `_${preset.id}.${format}`),
    });
  };

  const activeDuration = Math.max(1, (config.trimEnd || duration) - config.trimStart);
  const estimatedMB = (activeDuration * (exportSettings.width * exportSettings.height * exportSettings.fps * 0.0000035)).toFixed(1);

  const filteredPresets = WALLPAPER_PRESETS.filter((p) => p.category === bgCategory || (bgCategory === "wallpaper" && p.category === "wallpaper"));

  return (
    <aside className="ss-panels-drawer">
      {/* ── BACKGROUND TOOL TAB ────────────────────────────────────────── */}
      {activeTab === "background" && (
        <div className="ss-drawer-content">
          <Section title="Background Engine">
            {/* Category Tabs */}
            <div className="ss-subtab-segmented">
              <button
                className={`subtab-btn ${bgCategory === "wallpaper" ? "active" : ""}`}
                onClick={() => { setBgCategory("wallpaper"); update({ bgType: "wallpaper" }); }}
              >
                Wallpaper
              </button>
              <button
                className={`subtab-btn ${bgCategory === "gradient" ? "active" : ""}`}
                onClick={() => { setBgCategory("gradient"); update({ bgType: "gradient" }); }}
              >
                Gradient
              </button>
              <button
                className={`subtab-btn ${bgCategory === "color" ? "active" : ""}`}
                onClick={() => { setBgCategory("color"); update({ bgType: "color" }); }}
              >
                Color
              </button>
            </div>

            {/* Wallpaper Cards Grid */}
            <div className="ss-wallpaper-grid">
              {filteredPresets.map((wp) => (
                <div
                  key={wp.id}
                  className={`ss-wallpaper-card ${config.wallpaperUrl === wp.id ? "active" : ""}`}
                  style={{ background: wp.gradient }}
                  onClick={() => update({ bgType: bgCategory, wallpaperUrl: wp.id, backgroundColor: wp.gradient })}
                  title={wp.name}
                />
              ))}
            </div>

            <ColorRow label="Custom Solid Color" value={config.backgroundColor} onChange={(v) => update({ backgroundColor: v, bgType: "color" })} />
          </Section>

          {/* Background Blur */}
          <Section title="Background Blur">
            <SliderRow
              label="Blur Radius"
              value={config.bgBlur}
              min={0}
              max={100}
              step={2}
              unit="px"
              onChange={(v) => update({ bgBlur: v })}
            />
          </Section>

          {/* Shape & Padding */}
          <Section title="Shape &amp; Padding (4-Side)">
            <SliderRow
              label="Canvas Padding"
              value={config.padding}
              min={0}
              max={160}
              step={4}
              unit="px"
              onChange={(v) => update({ padding: v })}
            />
            <SliderRow
              label="Corner Radius"
              value={config.borderRadius}
              min={0}
              max={60}
              step={1}
              unit="px"
              onChange={(v) => update({ borderRadius: v })}
            />
          </Section>
        </div>
      )}

      {/* ── ZOOM & MOTION TOOL TAB ────────────────────────────────────── */}
      {activeTab === "zoom" && (
        <div className="ss-drawer-content">
          <Section title="Zoom Engine">
            <CheckRow
              label="Enable Motion Zoom"
              checked={config.zoomEnabled}
              onChange={(v) => update({ zoomEnabled: v })}
            />

            {config.zoomEnabled && (
              <>
                <div className="field-row">
                  <label>Zoom Mode</label>
                  <div className="toggle-segmented">
                    <button
                      className={`seg-btn ${config.zoomMode === "auto" ? "active" : ""}`}
                      onClick={() => update({ zoomMode: "auto" })}
                    >
                      Auto
                    </button>
                    <button
                      className={`seg-btn ${config.zoomMode === "manual" ? "active" : ""}`}
                      onClick={() => update({ zoomMode: "manual" })}
                    >
                      Manual
                    </button>
                  </div>
                </div>

                <div className="section-info-badge">
                  <span>
                    {config.zoomMode === "auto"
                      ? `Auto Mode: ${keyframesCount} cluster keyframes detected.`
                      : `Manual Mode: ${keyframesCount} keyframes created.`}
                  </span>
                </div>

                <SliderRow
                  label="Zoom Level"
                  value={config.zoomLevel}
                  min={1.2}
                  max={3.0}
                  step={0.1}
                  unit="x"
                  onChange={(v) => update({ zoomLevel: v })}
                />

                <button className="ss-drawer-action-btn primary" onClick={onAddManualZoom}>
                  + Add Zoom Keyframe at Playhead
                </button>

                <div className="ss-btn-group">
                  <button className="ss-drawer-action-btn secondary" onClick={() => update({ zoomLevel: 2.0 })}>
                    Set as default
                  </button>
                  <button className="ss-drawer-action-btn secondary">
                    Apply to all zooms
                  </button>
                </div>
              </>
            )}
          </Section>
        </div>
      )}

      {/* ── CURSOR STYLING TAB ────────────────────────────────────────── */}
      {activeTab === "cursor" && (
        <div className="ss-drawer-content">
          <Section title="Cursor Overlay">
            <CheckRow label="Show Cursor Overlay" checked={config.showCursor} onChange={(v) => update({ showCursor: v })} />
            <ColorRow label="Cursor Color" value={config.cursorStyle.color} onChange={(v) => updateCursor({ color: v })} />
            <SliderRow label="Cursor Size" value={config.cursorStyle.size} min={8} max={40} step={1} unit="px" onChange={(v) => updateCursor({ size: v })} />
            <div className="field-row">
              <label>Cursor Style</label>
              <div className="toggle-segmented">
                <button
                  className={`seg-btn ${config.cursorStyle.shape === "arrow" ? "active" : ""}`}
                  onClick={() => updateCursor({ shape: "arrow" })}
                >
                  Arrow
                </button>
                <button
                  className={`seg-btn ${config.cursorStyle.shape === "circle" ? "active" : ""}`}
                  onClick={() => updateCursor({ shape: "circle" })}
                >
                  Circle
                </button>
              </div>
            </div>
            <CheckRow label="Click Ripple Animations" checked={config.cursorStyle.showClickRipples} onChange={(v) => updateCursor({ showClickRipples: v })} />
          </Section>
        </div>
      )}

      {/* ── SHADOW & CORNERS TAB ──────────────────────────────────────── */}
      {activeTab === "shadow" && (
        <div className="ss-drawer-content">
          <Section title="Video Drop Shadow">
            <CheckRow label="Enable Drop Shadow" checked={config.shadow.enabled} onChange={(v) => updateShadow({ enabled: v })} />
            <SliderRow label="Shadow Blur" value={config.shadow.blur} min={0} max={100} step={2} unit="px" onChange={(v) => updateShadow({ blur: v })} />
            <SliderRow label="Vertical Offset" value={config.shadow.offsetY} min={0} max={50} step={1} unit="px" onChange={(v) => updateShadow({ offsetY: v })} />
            <ColorRow label="Shadow Color" value={config.shadow.color} onChange={(v) => updateShadow({ color: v })} />
          </Section>
        </div>
      )}

      {/* ── EXPORT TOOL TAB ───────────────────────────────────────────── */}
      {activeTab === "export" && (
        <div className="ss-drawer-content">
          <Section title="Export Presets">
            <div className="export-preset-cards-grid">
              {PREMIERE_PRESETS.map((p) => (
                <div
                  key={p.id}
                  className={`export-card ${selectedPresetId === p.id ? "active" : ""}`}
                  onClick={() => applyPreset(p)}
                >
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
              <div className="info-row">
                <span className="lbl">Duration</span>
                <span className="val">{activeDuration.toFixed(1)}s</span>
              </div>
              <div className="info-row">
                <span className="lbl">Est. File Size</span>
                <span className="val highlight">~{estimatedMB} MB</span>
              </div>
            </div>

            <div className="field-row">
              <label>Format</label>
              <div className="toggle-segmented">
                <button
                  className={`seg-btn ${exportSettings.format === "mp4" ? "active" : ""}`}
                  onClick={() => setExportSettings({ ...exportSettings, format: "mp4" })}
                >
                  MP4
                </button>
                <button
                  className={`seg-btn ${exportSettings.format === "gif" ? "active" : ""}`}
                  onClick={() => setExportSettings({ ...exportSettings, format: "gif" })}
                >
                  GIF
                </button>
              </div>
            </div>
          </Section>

          {exportStatus && (
            <div className={`export-status-banner ${exportStatus.startsWith("Done") ? "success" : exportStatus.startsWith("Export failed") ? "error" : "progress"}`}>
              {exportStatus}
            </div>
          )}

          <button
            className="pro-render-export-btn"
            onClick={() => onExport(exportSettings)}
            disabled={exportStatus === "Exporting..."}
          >
            {exportStatus === "Exporting..." ? "Rendering..." : `Render ${exportSettings.format.toUpperCase()}`}
          </button>
        </div>
      )}
    </aside>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="ss-section">
      <h4 className="ss-section-heading">{title}</h4>
      <div className="ss-section-body">{children}</div>
    </div>
  );
}

function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="field-row">
      <label>{label}</label>
      <div className="color-wrap">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="swatch" />
        <input type="text" value={value} onChange={(e) => onChange(e.target.value)} className="hex-input" />
      </div>
    </div>
  );
}

function SliderRow({ label, value, min, max, step, unit = "", onChange }: { label: string; value: number; min: number; max: number; step: number; unit?: string; onChange: (v: number) => void }) {
  return (
    <div className="field-row">
      <label>{label}</label>
      <div className="slider-wrap">
        <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
        <span className="slider-val">{value}{unit}</span>
      </div>
    </div>
  );
}

function CheckRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="field-row check-row" onClick={() => onChange(!checked)}>
      <label>{label}</label>
      <div className={`pro-checkbox ${checked ? "checked" : ""}`}>
        {checked && (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" width="12" height="12">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
      </div>
    </div>
  );
}
