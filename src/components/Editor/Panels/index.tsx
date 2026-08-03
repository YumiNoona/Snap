import { useState } from "react";
import type { EditorConfig, ExportSettings } from "../../../lib/types";
import { ASPECT_RATIOS } from "../../../lib/types";
import "./Panels.css";

interface Props {
  config: EditorConfig;
  onConfigChange: (cfg: EditorConfig) => void;
  videoPath: string;
  duration: number;
  currentTime: number;
  keyframesCount: number;
  onExport: (settings: ExportSettings) => void;
}

const RESOLUTION_PRESETS = [
  { label: "HD 720p", w: 1280, h: 720 },
  { label: "Full HD 1080p", w: 1920, h: 1080 },
  { label: "2K 1440p", w: 2560, h: 1440 },
  { label: "4K 2160p", w: 3840, h: 2160 },
  { label: "Custom", w: 0, h: 0 },
] as const;

const FPS_PRESETS = [24, 30, 60, 120, 240, 540] as const;

export default function Panels({
  config,
  onConfigChange,
  videoPath,
  duration,
  currentTime,
  keyframesCount,
  onExport,
}: Props) {
  const [activeTab, setActiveTab] = useState<"edit" | "export">("edit");
  const [exportSettings, setExportSettings] = useState<ExportSettings>({
    format: "mp4", fps: 60, width: 1920, height: 1080,
    quality: "high", outputPath: videoPath.replace(/\.mp4$/, "_edited.mp4"),
  });
  const [customFps, setCustomFps] = useState(false);

  const update = (patch: Partial<EditorConfig>) => onConfigChange({ ...config, ...patch });
  const updateCursor = (patch: Partial<EditorConfig["cursorStyle"]>) =>
    onConfigChange({ ...config, cursorStyle: { ...config.cursorStyle, ...patch } });
  const updateShadow = (patch: Partial<EditorConfig["shadow"]>) =>
    onConfigChange({ ...config, shadow: { ...config.shadow, ...patch } });

  const applyPreset = (preset: typeof RESOLUTION_PRESETS[number]) => {
    if (preset.w > 0) {
      setExportSettings({ ...exportSettings, width: preset.w, height: preset.h });
    }
  };

  return (
    <div className="panels-container">
      <div className="panels-tabs">
        <button className={`panel-tab ${activeTab === "edit" ? "active" : ""}`} onClick={() => setActiveTab("edit")}>Edit</button>
        <button className={`panel-tab ${activeTab === "export" ? "active" : ""}`} onClick={() => setActiveTab("export")}>Export</button>
      </div>

      {activeTab === "edit" ? (
        <div className="panels-content">
          {/* Trim */}
          <Section title="Trim">
            <div className="trim-buttons">
              <button className="trim-btn" onClick={() => update({ trimStart: currentTime })}>
                Set In
              </button>
              <button className="trim-btn" onClick={() => update({ trimEnd: Math.max(currentTime, config.trimStart + 0.1) })}>
                Set Out
              </button>
              <button className="trim-btn reset" onClick={() => update({ trimStart: 0, trimEnd: duration })}>
                Reset
              </button>
            </div>
            <div className="trim-display">
              <span>{formatTime(config.trimStart)}</span>
              <span className="trim-arrow">→</span>
              <span>{formatTime(config.trimEnd || duration)}</span>
            </div>
            <div className="trim-duration">
              Duration: {formatTime((config.trimEnd || duration) - config.trimStart)}
            </div>
          </Section>

          {/* Layout */}
          <Section title="Layout">
            <SliderRow label="Padding" value={config.padding} min={0} max={160} step={4} onChange={(v) => update({ padding: v })} />
            <SliderRow label="Radius" value={config.borderRadius} min={0} max={60} step={1} onChange={(v) => update({ borderRadius: v })} />
            <div className="field-row">
              <label>Aspect</label>
              <select
                value={config.aspectRatio ? `${config.aspectRatio.width}:${config.aspectRatio.height}` : "0:0"}
                onChange={(e) => {
                  const [w, h] = e.target.value.split(":").map(Number);
                  update({ aspectRatio: w > 0 ? { width: w, height: h } : null });
                }}
              >
                {ASPECT_RATIOS.map((ar) => (
                  <option key={ar.label} value={`${ar.width}:${ar.height}`}>{ar.label}</option>
                ))}
              </select>
            </div>
            <ColorRow label="BG" value={config.backgroundColor} onChange={(v) => update({ backgroundColor: v })} />
          </Section>

          {/* Cursor */}
          <Section title="Cursor">
            <CheckRow label="Show" checked={config.showCursor} onChange={(v) => update({ showCursor: v })} />
            <ColorRow label="Color" value={config.cursorStyle.color} onChange={(v) => updateCursor({ color: v })} />
            <SliderRow label="Size" value={config.cursorStyle.size} min={6} max={36} step={1} onChange={(v) => updateCursor({ size: v })} />
            <div className="field-row">
              <label>Shape</label>
              <div className="toggle-group">
                <button className={`toggle-btn ${config.cursorStyle.shape === "circle" ? "active" : ""}`} onClick={() => updateCursor({ shape: "circle" })}>Circle</button>
                <button className={`toggle-btn ${config.cursorStyle.shape === "arrow" ? "active" : ""}`} onClick={() => updateCursor({ shape: "arrow" })}>Arrow</button>
              </div>
            </div>
            <CheckRow label="Ripples" checked={config.cursorStyle.showClickRipples} onChange={(v) => updateCursor({ showClickRipples: v })} />
          </Section>

          {/* Zoom */}
          <Section title="Zoom">
            <CheckRow label="Auto zoom" checked={config.zoomEnabled} onChange={(v) => update({ zoomEnabled: v })} />
            <div className="field-info">{keyframesCount} keyframes</div>
          </Section>

          {/* Shadow */}
          <Section title="Shadow">
            <CheckRow label="On" checked={config.shadow.enabled} onChange={(v) => updateShadow({ enabled: v })} />
            <SliderRow label="Blur" value={config.shadow.blur} min={0} max={80} step={2} onChange={(v) => updateShadow({ blur: v })} />
            <SliderRow label="Y" value={config.shadow.offsetY} min={0} max={40} step={1} onChange={(v) => updateShadow({ offsetY: v })} />
          </Section>
        </div>
      ) : (
        <div className="panels-content">
          {/* Export Presets */}
          <Section title="Resolution">
            <div className="preset-grid">
              {RESOLUTION_PRESETS.map((p) => (
                <button
                  key={p.label}
                  className={`preset-btn ${exportSettings.width === p.w && p.w > 0 ? "active" : ""}`}
                  onClick={() => applyPreset(p)}
                >
                  {p.label}
                  {p.w > 0 && <span className="preset-dim">{p.w}x{p.h}</span>}
                </button>
              ))}
            </div>
          </Section>

          <Section title="Frame Rate">
            <div className="preset-grid fps-grid">
              {FPS_PRESETS.map((f) => (
                <button
                  key={f}
                  className={`preset-btn ${!customFps && exportSettings.fps === f ? "active" : ""}`}
                  onClick={() => { setCustomFps(false); setExportSettings({ ...exportSettings, fps: f }); }}
                >
                  {f} fps
                </button>
              ))}
              <button
                className={`preset-btn ${customFps ? "active" : ""}`}
                onClick={() => setCustomFps(true)}
              >
                Custom
              </button>
            </div>
            {customFps && (
              <SliderRow label="FPS" value={exportSettings.fps} min={1} max={540} step={1} onChange={(v) => setExportSettings({ ...exportSettings, fps: v })} />
            )}
          </Section>

          <Section title="Format">
            <div className="field-row">
              <label>Format</label>
              <div className="toggle-group">
                <button className={`toggle-btn ${exportSettings.format === "mp4" ? "active" : ""}`} onClick={() => setExportSettings({ ...exportSettings, format: "mp4" })}>MP4</button>
                <button className={`toggle-btn ${exportSettings.format === "gif" ? "active" : ""}`} onClick={() => setExportSettings({ ...exportSettings, format: "gif" })}>GIF</button>
              </div>
            </div>
            <div className="field-row">
              <label>Quality</label>
              <div className="toggle-group triple">
                {(["high", "medium", "low"] as const).map((q) => (
                  <button key={q} className={`toggle-btn ${exportSettings.quality === q ? "active" : ""}`} onClick={() => setExportSettings({ ...exportSettings, quality: q })}>
                    {q[0].toUpperCase() + q.slice(1)}
                  </button>
                ))}
              </div>
            </div>
          </Section>

          <Section title="Output">
            <label className="field-label">Path</label>
            <input type="text" className="field-input full" value={exportSettings.outputPath} onChange={(e) => setExportSettings({ ...exportSettings, outputPath: e.target.value })} />
            <div className="field-info">Source: {videoPath.split("\\").pop()}<br />{duration.toFixed(1)}s · {keyframesCount} KF</div>
          </Section>

          <button className="export-btn" onClick={() => onExport(exportSettings)}>
            Export {exportSettings.format.toUpperCase()}
          </button>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="panel-section">
      <h4 className="section-title">{title}</h4>
      <div className="section-fields">{children}</div>
    </div>
  );
}

function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div className="field-row color-row">
      <label>{label}</label>
      <div className="color-picker-wrap">
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="color-swatch" />
        <input type="text" value={value} onChange={(e) => onChange(e.target.value)} className="field-input small" />
      </div>
    </div>
  );
}

function SliderRow({ label, value, min, max, step, onChange }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void }) {
  return (
    <div className="field-row">
      <label>{label}</label>
      <div className="slider-wrap">
        <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
        <span className="slider-value">{value}</span>
      </div>
    </div>
  );
}

function CheckRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="field-row check-row" onClick={() => onChange(!checked)}>
      <label>{label}</label>
      <div className={`checkbox ${checked ? "checked" : ""}`}>
        {checked && <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12" /></svg>}
      </div>
    </div>
  );
}

function formatTime(s: number): string {
  if (!isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
