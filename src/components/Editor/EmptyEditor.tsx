import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emit, listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { AudioLines, Box, Captions, Film, FolderOpen, Frame, Layers3, Link2, Maximize2, Minus, Moon, MousePointer2, Play, Scissors, Sun, Upload, X } from "lucide-react";
import { loadProjectAtPath } from "../../lib/project";
import { recordingDataPaths } from "../../lib/recordingPaths";
import { userError } from "../../lib/userError";
import LinkImportDialog from "./LinkImportDialog";
import "./EmptyEditor.css";

const VIDEO_EXTENSIONS = ["mp4", "mov", "mkv", "webm", "avi"];
const isVideo = (path: string) => VIDEO_EXTENSIONS.includes(path.split(".").pop()?.toLowerCase() ?? "");
const TOOLS = [[Frame, "Canvas"], [Box, "Effects"], [MousePointer2, "Cursor"], [Layers3, "Layers"], [Captions, "Captions"], [AudioLines, "Audio"]] as const;

/** No recording scan, decoders or autosave run until a source is imported. */
export default function EmptyEditor({ onOpenProject }: {
  onOpenProject?: (projectPath: string, videoPath: string, inputLogPath: string) => void;
}) {
  const [theme, setTheme] = useState<"dark" | "light">(() => localStorage.getItem("snap.editorTheme.v1") === "light" ? "light" : "dark");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkBusy, setLinkBusy] = useState(false);
  const importPath = useCallback(async (path: string) => {
    if (/\.(snap|json)$/i.test(path)) {
      const project = await loadProjectAtPath(path);
      if (!project) throw new Error("The selected project no longer exists");
      onOpenProject?.(path, project.media.videoPath, project.media.inputLogPath);
    } else {
      if (!isVideo(path)) throw new Error("Choose a video or a saved Snap project.");
      const log = await invoke<string>("resolve_recording_log_path", { videoPath: path }).catch(() => recordingDataPaths(path).logPath);
      // Reuse native handoff so the selected source grants its sidecars and
      // project directory before loading audio, cursor data or autosave.
      await invoke("open_editor_window", { video: path, log });
    }
  }, [onOpenProject]);
  const choose = useCallback(async (project = false, droppedPath?: string) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true); setError(""); setDragOver(false);
    try {
      const path = droppedPath ?? await open({
        title: project ? "Open Snap Project" : "Import Video", multiple: false, directory: false,
        filters: project ? [{ name: "Snap Project", extensions: ["snap", "json"] }] : [{ name: "Video", extensions: VIDEO_EXTENSIONS }],
      });
      if (path && !Array.isArray(path)) await importPath(path);
    } catch (cause) { setError(userError(cause)); }
    finally { busyRef.current = false; setBusy(false); }
  }, [importPath]);

  useEffect(() => {
    localStorage.setItem("snap.editorTheme.v1", theme);
    document.body.dataset.editorTheme = theme;
  }, [theme]);
  useEffect(() => {
    const unlisten = listen<string>("recording-starting", ({ payload }) => {
      void emit("editor-suspended", { requestId: payload, ready: !busyRef.current, ...(busyRef.current ? { reason: "media-import" } : {}) });
    });
    return () => { void unlisten.then(stop => stop()).catch(() => {}); };
  }, []);
  useEffect(() => {
    if (linkOpen) return;
    const keydown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "o") {
        event.preventDefault(); void choose(!event.shiftKey);
      }
    };
    window.addEventListener("keydown", keydown);
    let unlisten: Promise<() => void> | undefined;
    try {
      unlisten = getCurrentWindow().onDragDropEvent(({ payload }) => {
        if (payload.type === "enter") setDragOver(true);
        if (payload.type === "leave") setDragOver(false);
        if (payload.type === "drop") {
          setDragOver(false);
          if (payload.paths[0]) void choose(false, payload.paths[0]);
        }
      });
    } catch { /* Browser preview has no native drop bridge. */ }
    return () => { window.removeEventListener("keydown", keydown); void unlisten?.then(stop => stop()).catch(() => {}); };
  }, [choose, linkOpen]);

  return <div className={`screenstudio-editor-layout empty-editor ${dragOver ? "is-drag-over" : ""}`} data-theme={theme}>
    <header className="ss-topbar" data-tauri-drag-region>
      <div className="ss-drag-area" data-tauri-drag-region />
      <div className="ss-topbar-left"><Film size={18} /><strong>Snap Editor</strong><span className="ss-file-title">Untitled project</span></div>
      <div className="ss-topbar-right">
        <button className="ss-icon-btn" title="Open project" aria-label="Open project" disabled={busy || linkOpen} onClick={() => void choose(true)}><FolderOpen size={18} /></button>
        <button className="ss-icon-btn" title="Switch theme" aria-label="Switch theme" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}</button>
        <button className="ss-topbar-export-btn" disabled title="Import a video to export"><Upload size={15} />Export</button>
        <div className="ss-window-controls">
          <button className="window-btn" title="Minimize" onClick={() => void getCurrentWindow().minimize()}><Minus size={15} /></button>
          <button className="window-btn" title="Maximize or restore" onClick={() => void getCurrentWindow().toggleMaximize()}><Maximize2 size={14} /></button>
          <button className="window-btn close-btn" title="Close" onClick={() => { if (!linkBusy) void getCurrentWindow().close(); }} disabled={linkBusy}><X size={15} /></button>
        </div>
      </div>
    </header>
    <aside className="ss-vertical-tool-palette" aria-label="Editor tools">
      <button className="ss-tool-icon-btn active" aria-label="Media" title="Import video" disabled={busy || linkOpen} onClick={() => void choose()}><FolderOpen size={19} /><span className="ss-tool-label">Media</span></button>
      {TOOLS.map(([Icon, label]) => <button key={label} className="ss-tool-icon-btn" disabled title={`Import a video to edit ${label.toLowerCase()}`}><Icon size={19} /><span className="ss-tool-label">{label}</span></button>)}
    </aside>
    <main className="ss-preview-center-area empty-editor-preview">
      <div className="empty-editor-canvas">
        <Film size={38} strokeWidth={1.2} /><h1>Start an edit</h1><p>Drop a video here to add it to your timeline.</p>
        <button className="empty-editor-primary" disabled={busy || linkOpen} onClick={() => void choose()}><Upload size={16} />{busy ? "Opening…" : "Import video"}</button>
        <div className="empty-editor-actions"><button disabled={busy || linkOpen} onClick={() => void choose(true)}><FolderOpen size={14} />Open project</button><button disabled={busy || linkOpen} onClick={() => setLinkOpen(true)}><Link2 size={14} />Import link</button></div>
        {error && <p role="alert" className="empty-editor-error">{error}</p>}
      </div>
    </main>
    <aside className="ss-panels-drawer empty-editor-inspector" aria-label="Project panel"><h2>Project</h2><p>Your video, captions and effects will appear here.</p><dl><dt>Timeline</dt><dd>Empty</dd><dt>Media</dt><dd>No video added</dd></dl></aside>
    <section className="ss-timeline-container empty-editor-timeline" aria-label="Empty timeline">
      <div className="empty-editor-transport"><Scissors size={16} /><span>Timeline</span><button className="ss-icon-btn" aria-label="Play" disabled><Play size={16} /></button><time>00:00 / 00:00</time></div>
      <button className="empty-editor-track" disabled={busy || linkOpen} onClick={() => void choose()}><Upload size={18} />Import a video to start your timeline</button>
    </section>
    {linkOpen && <LinkImportDialog actionLabel="Open in editor" onBusy={value => { busyRef.current = value; setLinkBusy(value); }} onClose={() => setLinkOpen(false)} onImported={importPath} />}
  </div>;
}
