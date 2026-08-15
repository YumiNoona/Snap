import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Film, FolderOpen, Search, Upload, X } from "lucide-react";
import "./ModuleWindows.css";

interface MediaFile { name: string; path: string; is_dir: boolean; size: number }

export default function LibraryWindow({ onOpen }: { onOpen: (video: string, log: string) => void }) {
  const [files, setFiles] = useState<MediaFile[]>([]);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");

  const refresh = async () => {
    try {
      const dir = await invoke<string>("get_videos_dir");
      const listed = await invoke<MediaFile[]>("list_directory", { path: dir });
      setFiles(listed.filter((file) => !file.is_dir && /\.(mp4|mov|mkv|webm)$/i.test(file.name)));
    } catch (cause) { setError(String(cause)); }
  };
  useEffect(() => { void refresh(); void invoke("window_ready"); }, []);
  const shown = useMemo(() => files.filter((file) => file.name.toLowerCase().includes(search.toLowerCase())), [files, search]);
  const open = async (path: string) => {
    const log = await invoke<string>("resolve_recording_log_path", { videoPath: path });
    onOpen(path, log);
  };
  const browse = async () => {
    try {
      const selected = await openDialog({ multiple: false, directory: false, filters: [{ name: "Video", extensions: ["mp4", "mov", "mkv", "webm", "avi"] }] });
      if (selected) await open(selected);
    } catch (cause) { setError(String(cause)); }
  };

  return <div className="module-window">
    <header className="module-titlebar" data-tauri-drag-region>
      <span className="module-mark"><FolderOpen size={17} /></span><div data-tauri-drag-region><strong data-tauri-drag-region>Open media</strong><small data-tauri-drag-region>Snap recordings and videos from other apps</small></div>
      <button onClick={() => getCurrentWindow().close()}><X size={16} /></button>
    </header>
    <main className="library-body">
      <section className="import-card"><div><Upload size={19} /><span><strong>Import any video</strong><small>Manual zoom, captions, canvas styling, audio controls and export remain available without a Snap sidecar.</small></span></div><button onClick={() => void browse()}>Choose video</button></section>
      <label className="module-search"><Search size={16} /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search recent recordings" /></label>
      <div className="media-list">{shown.map((file) => <button key={file.path} onClick={() => void open(file.path)}><span className="media-icon"><Film size={17} /></span><span><strong>{file.name.replace(/\.[^.]+$/, "")}</strong><small>{Math.max(.1, file.size / 1048576).toFixed(1)} MB · {file.name.split(".").pop()?.toUpperCase()}</small></span><i>Open</i></button>)}{shown.length === 0 && <div className="module-empty"><Film size={28} /><strong>No videos found</strong><small>Import a video from anywhere on your computer.</small></div>}</div>
      {error && <p className="module-error">{error}</p>}
    </main>
  </div>;
}
