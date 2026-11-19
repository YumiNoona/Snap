import { useEffect, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { Download, Link2, X } from "lucide-react";
import { useModalFocus } from "./hooks/useModalFocus";

interface LinkFormat {
  id: string;
  width: number;
  height: number;
  fps?: number;
  codec: string;
  embeddedAudio: boolean | null;
}

interface LinkInfo {
  title: string;
  duration?: number;
  formats: LinkFormat[];
  separateAudio: boolean;
}

interface LinkProgress {
  phase: string;
  percent: number | null;
}

interface Props {
  actionLabel?: string;
  onClose: () => void;
  onBusy: (busy: boolean) => void;
  onImported: (path: string) => Promise<void>;
}

export default function LinkImportDialog({ onClose, onBusy, onImported, actionLabel }: Props) {
  const dialog = useModalFocus(true);
  const [url, setUrl] = useState("");
  const [info, setInfo] = useState<LinkInfo>();
  const [formatId, setFormatId] = useState("");
  const [withAudio, setWithAudio] = useState(true);
  const [phase, setPhase] = useState<"setup" | "inspect" | "download" | "insert">();
  const [ready, setReady] = useState<boolean>();
  const [progress, setProgress] = useState<LinkProgress>();
  const [downloadedPath, setDownloadedPath] = useState<string>();
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState("");
  const format = info?.formats.find((item) => item.id === formatId);
  const audioAvailable = Boolean(format && (format.embeddedAudio !== false || info?.separateAudio));

  useEffect(() => {
    let open = true;
    void invoke<boolean>("editor_link_ready").then(
      (available) => { if (open) setReady(available); },
      () => { if (open) setReady(false); },
    );
    return () => { open = false; };
  }, []);

  const cancel = async () => {
    if (!phase) {
      onClose();
    } else if (phase !== "insert" && !cancelling) {
      setCancelling(true);
      await invoke("cancel_editor_link").catch(() => setCancelling(false));
    }
  };

  const install = async () => {
    setPhase("setup");
    setProgress(undefined);
    setError("");
    onBusy(true);
    try {
      const updates = new Channel<LinkProgress>(setProgress);
      await invoke("install_editor_link", { progress: updates });
      setReady(true);
      setInfo(undefined);
    } catch (reason) {
      setError(String(reason));
    } finally {
      onBusy(false);
      setPhase(undefined);
      setCancelling(false);
    }
  };

  const inspect = async () => {
    if (!ready || phase || !url.trim()) return;
    setPhase("inspect");
    setDownloadedPath(undefined);
    onBusy(true);
    setError("");
    try {
      const result = await invoke<LinkInfo>("inspect_editor_link", { url: url.trim() });
      setInfo(result);
      const standard = result.formats.filter((item) => item.height > 0 && item.height <= 1080);
      const playable = standard.find((item) => item.embeddedAudio !== false || result.separateAudio);
      const preferred = playable && standard.find((item) => item.height === playable.height &&
        (item.fps ?? 0) >= (playable.fps ?? 0) && /^(avc1|h264)$/i.test(item.codec) &&
        (item.embeddedAudio !== false || result.separateAudio));
      setFormatId((preferred ?? playable ?? standard[0] ?? result.formats[0]).id);
    } catch (reason) {
      const message = String(reason);
      if (message.startsWith("Select Install downloader")) setReady(false);
      setError(message);
    } finally {
      onBusy(false);
      setPhase(undefined);
      setCancelling(false);
    }
  };

  const download = async () => {
    if (!info || !format) return;
    setPhase(downloadedPath ? "insert" : "download");
    setProgress(undefined);
    onBusy(true);
    setError("");
    try {
      let path = downloadedPath;
      if (!path) {
        const updates = new Channel<LinkProgress>(setProgress);
        path = await invoke<string>("download_editor_link", {
          request: { url: url.trim(), title: info.title, formatId, embeddedAudio: format.embeddedAudio, withAudio: withAudio && audioAvailable },
          progress: updates,
        });
      }
      setDownloadedPath(path);
      setPhase("insert");
      await onImported(path);
      onClose();
    } catch (reason) {
      setError(String(reason));
    } finally {
      onBusy(false);
      setPhase(undefined);
      setCancelling(false);
    }
  };

  return (
    <div className="ss-command-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !phase) onClose(); }}>
      <section ref={dialog} className="ss-health-panel ss-link-import" role="dialog" aria-modal="true" aria-labelledby="link-import-title" tabIndex={-1}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") {
            void cancel();
          }
        }}>
        <header>
          <div><Link2 size={20} /><strong id="link-import-title">Import from link</strong></div>
          <button type="button" aria-label="Close link importer" disabled={Boolean(phase)} onClick={onClose}><X size={17} /></button>
        </header>
        <form onSubmit={(event) => { event.preventDefault(); if (!phase) void inspect(); }}>
          <label htmlFor="link-import-url">Video URL</label>
          <div className="ss-link-import-url">
            <input id="link-import-url" type="url" placeholder="https://…" required disabled={Boolean(phase)} value={url} onChange={(event) => {
              setUrl(event.target.value);
              setInfo(undefined);
              setDownloadedPath(undefined);
              setWithAudio(true);
              setError("");
            }} />
            <button type="submit" className="ss-topbar-export-btn" disabled={!ready || !url.trim() || Boolean(phase)}>Check link</button>
          </div>
        </form>
        {ready === undefined && <p role="status">Checking downloader setup…</p>}
        {ready === false && !phase && (
          <div className="ss-link-import-setup">
            <p>Install the video downloader and its YouTube runtime to check links.</p>
            <button type="button" className="ss-topbar-export-btn" onClick={() => void install()}><Download size={16} /> Install downloader</button>
          </div>
        )}
        {info && <>
          <div className="ss-link-import-title"><strong>{info.title}</strong>{Boolean(info.duration) && <small>{Math.floor(info.duration! / 60)}:{String(Math.floor(info.duration! % 60)).padStart(2, "0")}</small>}</div>
          <label htmlFor="link-import-quality">Download quality</label>
          <select id="link-import-quality" disabled={Boolean(phase)} value={formatId} onChange={(event) => {
            setFormatId(event.target.value);
            setDownloadedPath(undefined);
          }}>
            {info.formats.map((item) => <option key={item.id} value={item.id}>
              {item.width ? `${item.width} × ${item.height}` : item.height ? `${item.height}p` : "Original quality"}
              {item.fps ? ` · ${Math.round(item.fps)} fps` : ""}{item.codec ? ` · ${item.codec}` : ""}
              {/^(avc1|h264)$/i.test(item.codec) ? " · Fast import" : ""}
              {item.embeddedAudio === true ? " · Audio included" : item.embeddedAudio === false && info.separateAudio ? " · Separate audio" : item.embeddedAudio === false ? " · Video only" : ""}
            </option>)}
          </select>
          <label className="ss-link-import-audio">
            <input type="checkbox" checked={withAudio && audioAvailable} disabled={!audioAvailable || Boolean(phase)} onChange={(event) => {
              setWithAudio(event.target.checked);
              setDownloadedPath(undefined);
            }} />
            {format?.embeddedAudio === null ? "Include audio when available" : audioAvailable ? "Include audio" : "Audio unavailable for this quality"}
          </label>
        </>}
        {error && <p className="ss-link-import-error" role="alert">{error}</p>}
        {phase && <p role="status">{cancelling ? "Cancelling…" : phase === "setup" ? progress?.phase ?? "Preparing downloader setup…" : phase === "inspect" ? "Checking available qualities…" : phase === "download" ? progress?.phase ?? "Starting download…" : "Adding a video layer to the timeline…"}{phase === "download" && !cancelling && progress?.percent != null && ` · ${progress.percent}%`}</p>}
        {(phase === "setup" || phase === "download") && <progress aria-label={phase === "setup" ? "Downloader installation" : "Video import progress"} max={100} value={cancelling ? undefined : progress?.percent ?? undefined} />}
        <footer>
          {phase && phase !== "insert" && <button className="ss-link-import-cancel" type="button" disabled={cancelling} onClick={() => void cancel()}>Cancel</button>}
          {ready && !phase && error.startsWith("Could not read this link.") && <button className="ss-link-import-cancel" type="button" onClick={() => void install()}>Update downloader</button>}
          {info && <button type="button" className="ss-topbar-export-btn" disabled={Boolean(phase)} onClick={() => void download()}><Download size={16} /> {actionLabel ?? (downloadedPath ? "Add video layer" : "Download & add to timeline")}</button>}
        </footer>
      </section>
    </div>
  );
}
