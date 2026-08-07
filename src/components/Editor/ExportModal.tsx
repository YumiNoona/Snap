import { useState } from "react";
import { CheckCircle2, Clock3, Download, HardDrive, MonitorPlay, X } from "lucide-react";
import type { EditorConfig, ExportSettings } from "../../lib/types";
import "./ExportModal.css";

interface Props {
  videoPath: string;
  duration: number;
  config: EditorConfig;
  status: string;
  progress: number;
  onClose: () => void;
  onExport: (settings: ExportSettings) => Promise<void>;
}

const PRESETS = [
  { id: "4k", label: "4K", detail: "3840 × 2160", width: 3840, height: 2160, fps: 60 },
  { id: "1080p", label: "Full HD", detail: "1920 × 1080", width: 1920, height: 1080, fps: 60 },
  { id: "720p", label: "HD", detail: "1280 × 720", width: 1280, height: 720, fps: 30 },
  { id: "vertical", label: "Vertical", detail: "1080 × 1920", width: 1080, height: 1920, fps: 60 },
] as const;

function formatDuration(seconds: number) {
  const rounded = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(rounded / 60);
  return `${minutes}:${String(rounded % 60).padStart(2, "0")}`;
}

function formatEstimate(seconds: number) {
  if (seconds < 60) return `about ${Math.max(1, Math.round(seconds))} sec`;
  return `about ${Math.ceil(seconds / 60)} min`;
}

export default function ExportModal({ videoPath, duration, config, status, progress, onClose, onExport }: Props) {
  const defaultPath = videoPath.replace(/\.mp4$/i, "_edited.mp4");
  const [settings, setSettings] = useState<ExportSettings>({
    format: "mp4", fps: 60, width: 1920, height: 1080, quality: "high", outputPath: defaultPath,
  });
  const activeDuration = Math.max(0.01, (config.trimEnd || duration) - config.trimStart);
  const pixelFactor = (settings.width * settings.height) / (1920 * 1080);
  const fpsFactor = Math.sqrt(settings.fps / 60);
  const baseMbps = settings.quality === "high" ? 12 : settings.quality === "medium" ? 8 : 5;
  const bitrateMbps = Math.max(2, Math.min(65, baseMbps * pixelFactor * fpsFactor));
  const estimatedMB = settings.format === "gif"
    ? activeDuration * Math.min(15, settings.fps) * settings.width * settings.height * 0.00000015
    : activeDuration * (bitrateMbps + 0.192) / 8;
  // Canvas export runs in real time, followed by FFmpeg finalization.
  const encodeFactor = Math.max(0.2, Math.min(2.2, pixelFactor * (settings.fps / 60) * 0.45));
  const estimatedSeconds = activeDuration * (1 + encodeFactor) + 3;
  const exporting = status.startsWith("Exporting") || status === "Finalizing...";
  const done = status.startsWith("Done");

  const selectPreset = (preset: typeof PRESETS[number]) => {
    const extension = settings.format;
    setSettings((current) => ({
      ...current,
      width: preset.width,
      height: preset.height,
      fps: preset.fps,
      outputPath: videoPath.replace(/\.mp4$/i, `_${preset.id}.${extension}`),
    }));
  };

  return (
    <div className="export-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !exporting && onClose()}>
      <section className="export-modal" role="dialog" aria-modal="true" aria-label="Export video">
        <header className="export-modal-header">
          <div><span className="export-eyebrow">READY TO SHARE</span><h2>Export video</h2></div>
          <button className="export-close" onClick={onClose} disabled={exporting}><X size={18} /></button>
        </header>

        <div className="export-modal-body">
          <div className="export-main-column">
            <div className="export-section-title">Resolution</div>
            <div className="export-preset-grid">
              {PRESETS.map((preset) => {
                const active = settings.width === preset.width && settings.height === preset.height && settings.fps === preset.fps;
                return <button key={preset.id} className={`export-preset ${active ? "active" : ""}`} onClick={() => selectPreset(preset)}>
                  <MonitorPlay size={18} /><span><strong>{preset.label}</strong><small>{preset.detail} · {preset.fps} FPS</small></span>{active && <CheckCircle2 size={16} />}
                </button>;
              })}
            </div>

            <div className="export-options-row">
              <label>Format<select value={settings.format} onChange={(e) => {
                const format = e.target.value as "mp4" | "gif";
                setSettings({ ...settings, format, outputPath: settings.outputPath.replace(/\.(mp4|gif)$/i, `.${format}`) });
              }}><option value="mp4">MP4 · H.264</option><option value="gif">Animated GIF</option></select></label>
              <label>Quality<select value={settings.quality} onChange={(e) => setSettings({ ...settings, quality: e.target.value as ExportSettings["quality"] })}><option value="high">High</option><option value="medium">Balanced</option><option value="low">Small file</option></select></label>
            </div>

            <label className="export-path-label">Save as<input value={settings.outputPath} onChange={(e) => setSettings({ ...settings, outputPath: e.target.value })} /></label>
          </div>

          <aside className="export-summary">
            <h3>Export summary</h3>
            <div className="export-summary-row"><Clock3 size={17} /><span><small>Video length</small><strong>{formatDuration(activeDuration)}</strong></span></div>
            <div className="export-summary-row"><HardDrive size={17} /><span><small>Estimated size</small><strong>≈ {estimatedMB < 10 ? estimatedMB.toFixed(1) : Math.round(estimatedMB)} MB</strong></span></div>
            <div className="export-summary-row"><Download size={17} /><span><small>Estimated time</small><strong>{formatEstimate(estimatedSeconds)}</strong></span></div>
            <p className="export-estimate-note">Snap renders the canvas in real time, then encodes the final file. Estimates vary with your GPU and selected effects.</p>
          </aside>
        </div>

        {(exporting || done || status.startsWith("Export failed")) && <div className={`export-progress ${done ? "done" : status.startsWith("Export failed") ? "error" : ""}`}>
          <div><span>{status}</span><strong>{done ? "100%" : `${Math.round(progress * 100)}%`}</strong></div>
          <div className="export-progress-track"><i style={{ width: `${Math.max(2, progress * 100)}%` }} /></div>
        </div>}

        <footer className="export-modal-footer">
          <span>{settings.width} × {settings.height} · {settings.fps} FPS · {settings.quality}</span>
          <button className="export-start-button" disabled={exporting || !settings.outputPath.trim()} onClick={() => onExport(settings)}><Download size={17} />{exporting ? "Exporting…" : "Start export"}</button>
        </footer>
      </section>
    </div>
  );
}
