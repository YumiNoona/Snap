import { userError } from "../lib/userError";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ArrowUpRight, CloudUpload, Film, FolderOpen, LoaderCircle, Play, Search, X } from "lucide-react";
import "./ModuleWindows.css";

interface MediaFile { name: string; path: string; is_dir: boolean; size: number }

const VIDEO_EXTENSIONS = ["mp4", "mov", "mkv", "webm", "avi"];
const isVideo = (path: string) => VIDEO_EXTENSIONS.includes(path.split(".").pop()?.toLowerCase() ?? "");

export default function LibraryWindow({ onOpen }: { onOpen: (video: string, log: string) => void | Promise<void> }) {
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [opening, setOpening] = useState(false);
  const openingRef = useRef(false);

  const refresh = async () => {
    try {
      const listed = await invoke<MediaFile[]>("list_recordings");
      setFiles(listed);
    } catch (cause) { setError(userError(cause)); }
  };
  useEffect(() => { void refresh(); }, []);
  const shown = useMemo(() => files.filter((file) => file.name.toLowerCase().includes(search.toLowerCase())), [files, search]);
  const open = useCallback(async (path?: string) => {
    if (openingRef.current) return;
    openingRef.current = true;
    setOpening(true);
    setDragOver(false);
    setError("");
    try {
      const selected = path ?? await openDialog({ multiple: false, directory: false, filters: [{ name: "Video", extensions: VIDEO_EXTENSIONS }] });
      if (!selected) return;
      const log = await invoke<string>("resolve_recording_log_path", { videoPath: selected });
      await onOpen(selected, log);
    } catch (cause) {
      setError(userError(cause));
    } finally {
      openingRef.current = false;
      setOpening(false);
    }
  }, [onOpen]);
  useEffect(() => {
    const unlisten = getCurrentWindow().onDragDropEvent(({ payload }) => {
      if (openingRef.current) return;
      if (payload.type === "enter") setDragOver(payload.paths.some(isVideo));
      if (payload.type === "leave") setDragOver(false);
      if (payload.type === "drop") {
        setDragOver(false);
        const video = payload.paths.find(isVideo);
        if (video) void open(video);
        else setError("Choose an MP4, MOV, MKV, WebM or AVI video.");
      }
    });
    return () => { void unlisten.then((stop) => stop()).catch(() => undefined); };
  }, [open]);

  return <div className={`module-window library-window ${dragOver ? "is-drag-over" : ""}`}>
    <header className="module-titlebar" data-tauri-drag-region>
      <span className="module-mark"><FolderOpen size={17} /></span><div data-tauri-drag-region><strong data-tauri-drag-region>Open media</strong></div>
      <button type="button" onClick={() => getCurrentWindow().close()} aria-label="Close media library"><X size={16} /></button>
    </header>
    <main className="library-body">
      <button type="button" className={`import-card ${dragOver ? "is-drag-over" : ""} ${opening ? "is-opening" : ""}`} aria-label="Import video" aria-busy={opening} disabled={opening} onClick={() => void open()}>
        <span className="import-card-icon" aria-hidden="true">{opening ? <LoaderCircle size={22} /> : <CloudUpload size={22} strokeWidth={1.8} />}</span>
        <span className="import-card-label">Drag and drop</span>
      </button>
      <label className="module-search"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search recent recordings" /></label>
      <div className="media-list">{shown.map((file, index) => <article className="library-media-card" key={file.path} style={{ "--media-index": index } as CSSProperties}>
        <button className="library-media-preview" onClick={() => void open(file.path)} aria-label={`Open ${file.name}`}>
          <video
            src={convertFileSrc(file.path)}
            muted
            playsInline
            preload="metadata"
            onLoadedMetadata={(event) => { event.currentTarget.currentTime = Math.min(1, event.currentTarget.duration * .08); }}
            onPointerEnter={(event) => { void event.currentTarget.play().catch(() => undefined); }}
            onPointerLeave={(event) => { event.currentTarget.pause(); }}
          />
          <span className="library-media-play" aria-hidden="true"><Play /></span>
          <span className="library-media-open">Open <ArrowUpRight size={13} /></span>
        </button>
        <div className="library-media-info"><span className="media-icon"><Film size={15} /></span><span><strong>{file.name.replace(/\.[^.]+$/, "")}</strong><small>{Math.max(.1, file.size / 1048576).toFixed(1)} MB · {file.name.split(".").pop()?.toUpperCase()}</small></span></div>
      </article>)}{shown.length === 0 && <div className="module-empty"><Film size={28} /><strong>No recordings found</strong></div>}</div>
      {error && <p className="module-error" role="alert">{error}</p>}
    </main>
  </div>;
}
