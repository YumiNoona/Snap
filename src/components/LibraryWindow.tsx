import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { ArrowUpRight, CloudUpload, Film, FolderOpen, Play, Search, X } from "lucide-react";
import "./ModuleWindows.css";

interface MediaFile { name: string; path: string; is_dir: boolean; size: number }

export default function LibraryWindow({ onOpen }: { onOpen: (video: string, log: string) => void }) {
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
  const [dragOver, setDragOver] = useState(false);

  const refresh = async () => {
    try {
      const dir = await invoke<string>("get_videos_dir");
      const listed = await invoke<MediaFile[]>("list_directory", { path: dir });
      setFiles(listed.filter((file) => !file.is_dir && /\.(mp4|mov|mkv|webm)$/i.test(file.name)));
    } catch (cause) { setError(String(cause)); }
  };
  useEffect(() => { void refresh(); }, []);
  const shown = useMemo(() => files.filter((file) => file.name.toLowerCase().includes(search.toLowerCase())), [files, search]);
  const open = useCallback(async (path: string) => {
    const log = await invoke<string>("resolve_recording_log_path", { videoPath: path });
    onOpen(path, log);
  }, [onOpen]);
  useEffect(() => {
    const unlisten = getCurrentWindow().onDragDropEvent(({ payload }) => {
      if (payload.type === "enter" || payload.type === "over") setDragOver(true);
      if (payload.type === "leave") setDragOver(false);
      if (payload.type === "drop") {
        setDragOver(false);
        const video = payload.paths.find((path) => /\.(mp4|mov|mkv|webm|avi)$/i.test(path));
        if (video) void open(video);
      }
    });
    return () => { void unlisten.then((stop) => stop()); };
  }, [open]);
  const browse = async () => {
    try {
      const selected = await openDialog({ multiple: false, directory: false, filters: [{ name: "Video", extensions: ["mp4", "mov", "mkv", "webm", "avi"] }] });
      if (selected) await open(selected);
    } catch (cause) { setError(String(cause)); }
  };

  return <div className={`module-window ${dragOver ? "is-drag-over" : ""}`}>
    <header className="module-titlebar" data-tauri-drag-region>
      <span className="module-mark"><FolderOpen size={17} /></span><div data-tauri-drag-region><strong data-tauri-drag-region>Open media</strong></div>
      <button onClick={() => getCurrentWindow().close()}><X size={16} /></button>
    </header>
    <main className="library-body">
      <section className="import-card">
        <div className="import-card-icon"><CloudUpload size={21} /></div>
        <div className="import-card-copy"><strong>Bring in a video</strong><small>Drop into your next edit</small></div>
        <button onClick={() => void browse()}>Choose file <ArrowUpRight size={15} /></button>
      </section>
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
          <span className="library-media-play"><Play size={17} fill="currentColor" /></span>
          <span className="library-media-open">Open <ArrowUpRight size={13} /></span>
        </button>
        <div className="library-media-info"><span className="media-icon"><Film size={15} /></span><span><strong>{file.name.replace(/\.[^.]+$/, "")}</strong><small>{Math.max(.1, file.size / 1048576).toFixed(1)} MB · {file.name.split(".").pop()?.toUpperCase()}</small></span></div>
      </article>)}{shown.length === 0 && <div className="module-empty"><Film size={28} /><strong>No videos found</strong></div>}</div>
      {error && <p className="module-error">{error}</p>}
    </main>
  </div>;
}
