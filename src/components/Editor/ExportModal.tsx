import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { CheckCircle2, Clock3, Download, ExternalLink, FolderSearch, HardDrive, MonitorPlay, RefreshCw, X } from "lucide-react";
import type { EditorConfig, ExportSettings } from "../../lib/types";
import { defaultExportPath, pathFileName, recordingExportDirectory } from "../../lib/exportPaths";
import "./ExportModal.css";
import { outputDuration } from "../../lib/exportTiming";
import { retainedClips, sequenceDuration } from "../../lib/videoEditing";
import { layoutExportSize } from "../../lib/editorFinishing";
import Dropdown from "../shared/Dropdown";

interface Props {
  videoPath: string;
  duration: number;
  config: EditorConfig;
  captionTrackCount: number;
  status: string;
  progress: number;
  exportedPath: string;
  onClose: () => void;
  onCancel: () => void;
  onOpenFile: () => Promise<void>;
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

function ExportChoice({ label, value, options, onChange }: { label: string; value: string; options: [string, string][]; onChange: (value: string) => void }) {
  return <label>{label}<Dropdown ariaLabel={label} value={value} options={options.map(([value, label]) => ({ value, label }))} onChange={onChange}/></label>;
}

export default function ExportModal({ videoPath, duration, config, captionTrackCount, status, progress, exportedPath, onClose, onCancel, onOpenFile, onExport }: Props) {
  const fallbackExportsDir = recordingExportDirectory(videoPath);
  const [exportsDir, setExportsDir] = useState(fallbackExportsDir);
  const defaultPath = defaultExportPath(videoPath, fallbackExportsDir, "edited", config.exportDefaults?.format??"mp4");
  const [settings, setSettings] = useState<ExportSettings>({
    format: "mp4", fps: 60,...layoutExportSize(config.aspectRatio), quality: "high", outputPath: defaultPath, captions: captionTrackCount > 0 ? "burned" : "none", audioMode: "mixed", normalizeAudio: false, deliveryPackage: false, loop: true,...config.exportDefaults,
  });
  useEffect(() => {
    let cancelled = false;
    void invoke<string>("get_exports_dir").then((directory) => {
      if (cancelled) return;
      setExportsDir(directory);
      setSettings((current) => ({
        ...current,
        outputPath: `${directory.replace(/[\\/]$/, "")}\\${pathFileName(current.outputPath)}`,
      }));
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, []);
  const activeDuration = outputDuration(0, sequenceDuration(retainedClips(config.videoClips, config.trimStart, config.trimEnd || duration)), config.playbackRate);
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
  const exporting = status.startsWith("Exporting") || status === "Finalizing..." || status.startsWith("Cancelling");
  const cancellable = status.startsWith("Exporting");
  const done = status.startsWith("Done");
  const [fileActionError, setFileActionError] = useState("");
  const [fileActionBusy, setFileActionBusy] = useState(false);
  const fileActionRef = useRef({ busy: false, generation: 0 });
  useEffect(() => {
    fileActionRef.current = { busy: false, generation: fileActionRef.current.generation + 1 };
    setFileActionError("");
    setFileActionBusy(false);
    return () => { fileActionRef.current.generation++; };
  }, [exportedPath, status]);
  const runFileAction = async (action: "open" | "folder") => {
    if (!done || !exportedPath || fileActionRef.current.busy) return;
    const generation = fileActionRef.current.generation;
    fileActionRef.current.busy = true;
    setFileActionBusy(true);
    setFileActionError("");
    try {
      if (action === "open") await onOpenFile();
      else await revealItemInDir(exportedPath);
    } catch (error) {
      console.error(`[Snap] Export ${action} action failed:`, error);
      if (fileActionRef.current.generation === generation) {
        setFileActionError(action === "open"
          ? "Windows could not open the file. Use Show in folder to choose a compatible app."
          : "Windows could not show the file. You can find it in your chosen export folder.");
      }
    } finally {
      if (fileActionRef.current.generation === generation) {
        fileActionRef.current.busy = false;
        setFileActionBusy(false);
      }
    }
  };
  const modalRef = useRef<HTMLElement>(null);
  const actionsRef = useRef({ onClose, exporting });
  actionsRef.current = { onClose, exporting };
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const focusables = () => Array.from(modalRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex='0']") ?? []).filter((element) => element.offsetParent !== null);
    focusables()[0]?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation();
        if (!actionsRef.current.exporting) actionsRef.current.onClose();
      } else if (event.key === "Tab") {
        const elements = focusables();
        const first = elements[0], last = elements[elements.length - 1];
        if (!first) { event.preventDefault(); return; }
        if (event.shiftKey && (document.activeElement === first || !elements.includes(document.activeElement as HTMLElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !elements.includes(document.activeElement as HTMLElement))) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("keydown", key); if (previous?.isConnected) previous.focus(); };
  }, []);

  const selectPreset = (preset: typeof PRESETS[number]) => {
    const extension = settings.format;
    setSettings((current) => ({
      ...current,
      width: preset.width,
      height: preset.height,
      fps: preset.fps,
      outputPath: defaultExportPath(videoPath, exportsDir, preset.id, extension),
    }));
  };

  return (
    <div className="export-modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && !exporting && onClose()}>
      <section ref={modalRef} className="export-modal" role="dialog" aria-modal="true" aria-label="Export video">
        <header className="export-modal-header">
          <div><span className="export-eyebrow">READY TO SHARE</span><h2>Export video</h2></div>
          <button className="export-close" onClick={onClose} disabled={exporting} aria-label="Close export dialog"><X size={18} /></button>
        </header>

        <div className="export-modal-body">
          <fieldset className="export-main-column" disabled={exporting}>
            <legend hidden>Export options</legend>
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
              <ExportChoice label="Format" value={settings.format} options={[["mp4", "MP4 · H.264"], ["webm", "WebM · VP9"], ["gif", "Animated GIF"]]} onChange={value => {
                const format = value as ExportSettings["format"];
                setSettings({ ...settings, format, captions: format === "gif" && settings.captions === "embedded" ? "burned" : settings.captions, outputPath: settings.outputPath.replace(/\.(mp4|webm|gif)$/i, `.${format}`) });
              }}/>
              <ExportChoice label="Quality" value={settings.quality} options={[["high", "High"], ["medium", "Balanced"], ["low", "Small file"]]} onChange={quality => setSettings({ ...settings, quality: quality as ExportSettings["quality"] })}/>
            </div>
            {captionTrackCount > 0 && <div className="export-options-row">
              <ExportChoice label="Captions" value={settings.captions ?? "none"} options={[["burned", "Burn into video"], ...(settings.format !== "gif" ? [["embedded", "Embedded subtitle track"]] as [string, string][] : []), ["srt", "SRT sidecar only"], ["vtt", "WebVTT sidecar only"], ["burned-srt", "Burned + SRT"], ["none", "No captions"]]} onChange={captions => setSettings({ ...settings, captions: captions as ExportSettings["captions"] })}/>
            </div>}
            {settings.format === "mp4" && <div className="export-options-row">
              <ExportChoice label="Audio tracks" value={settings.audioMode ?? "mixed"} options={[["mixed", "Mixed · most compatible"], ["separate", "Separate editable tracks"]]} onChange={audioMode => setSettings({ ...settings, audioMode: audioMode as ExportSettings["audioMode"] })}/>
              <ExportChoice label="Normalization" value={settings.normalizeAudio ? "on" : "off"} options={[["off", "Preserve levels"], ["on", "Normalize loudness"]]} onChange={value => setSettings({ ...settings, normalizeAudio: value === "on" })}/>
            </div>}
            {settings.format === "gif" && <div className="export-options-row"><ExportChoice label="Loop" value={settings.loop ? "forever" : "once"} options={[["forever", "Loop forever"], ["once", "Play once"]]} onChange={value => setSettings({ ...settings, loop: value === "forever" })}/></div>}
            <div className="export-delivery-choice"><ExportChoice label="Delivery package" value={settings.deliveryPackage ? "on" : "off"} options={[["off", "Video only"], ["on", "Video + thumbnail + transcript + chapters"]]} onChange={value => setSettings({ ...settings, deliveryPackage: value === "on" })}/></div>

            <label className="export-path-label">Save as<input value={settings.outputPath} onChange={(e) => setSettings({ ...settings, outputPath: e.target.value })} /></label>
          </fieldset>

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

        {fileActionError && <p className="export-file-action-error" role="alert">{fileActionError}</p>}
        <footer className="export-modal-footer">
          <span>{settings.width} × {settings.height} · {settings.fps} FPS · {settings.quality}</span>
          <div className="export-footer-actions">
            {cancellable && <button type="button" className="export-secondary-button" onClick={onCancel}>Cancel export</button>}
            {done && exportedPath && <>
              <button type="button" className="export-secondary-button" disabled={fileActionBusy} onClick={() => void runFileAction("folder")}><FolderSearch size={17} /> Show in folder</button>
              <button type="button" className="export-open-button" disabled={fileActionBusy} onClick={() => void runFileAction("open")}><ExternalLink size={17} /> Open file</button>
            </>}
            {done
              ? <button type="button" className="export-secondary-button export-again-button" disabled={!settings.outputPath.trim()} onClick={() => onExport(settings)}><RefreshCw size={16} /> Export again</button>
              : <button className="export-start-button" disabled={exporting || !settings.outputPath.trim()} onClick={() => onExport(settings)}><Download size={17} />{exporting ? "Exporting…" : "Start export"}</button>}
          </div>
        </footer>
      </section>
    </div>
  );
}
