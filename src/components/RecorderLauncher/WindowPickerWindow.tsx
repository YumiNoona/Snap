import { userError } from "../../lib/userError";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AppWindow, RefreshCw, X } from "lucide-react";
import "./WindowPickerWindow.css";

interface DisplayTarget {
  id: string;
  name: string;
  target_type: string;
}

const previewMode = import.meta.env.DEV && typeof window !== "undefined"
  && new URLSearchParams(window.location.search).get("preview") === "1";

export default function WindowPickerWindow() {
  const [targets, setTargets] = useState<DisplayTarget[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selecting, setSelecting] = useState("");
  const [previews, setPreviews] = useState<Record<string, string>>({});

  const refresh = async () => {
    setLoading(true);
    setError("");
    try {
      // Browser-only visual fixture; never included in a packaged build.
      const next = previewMode ? ["Apex Legends", "Snap", "Browser", "File Explorer", "Terminal", "Notes"].map((name, index) => ({ id: `preview-${index}`, name, target_type: "window" })) : await invoke<DisplayTarget[]>("enumerate_targets");
      setTargets(next.filter((target) => target.target_type === "window"));
    } catch (reason) {
      setError(`Unable to inspect open windows: ${userError(reason)}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);
  useEffect(() => {
    let cancelled = false;
    const urls: string[] = [];
    setPreviews({});
    // Serial, one-shot previews. Never poll or keep a capture alive in the picker.
    void (async () => {
      for (const target of targets) {
        if (cancelled || previewMode) break;
        try {
          const bytes = await invoke<number[] | null>("window_preview", { targetId: target.id });
          if (cancelled || !bytes?.length) continue;
          const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "image/jpeg" }));
          urls.push(url);
          setPreviews((current) => ({ ...current, [target.id]: url }));
        } catch { /* Unavailable/protected windows keep a neutral preview. */ }
      }
    })();
    return () => { cancelled = true; urls.forEach((url) => URL.revokeObjectURL(url)); };
  }, [targets]);

  const choose = async (target: DisplayTarget) => {
    if (selecting) return;
    if (previewMode) return;
    setSelecting(target.id);
    try {
      await emitTo("main", "window-target-selected", target.id);
      await getCurrentWindow().close();
    } catch (reason) {
      setSelecting("");
      setError(`Unable to select ${target.name}: ${userError(reason)}`);
    }
  };

  return (
    <main className="window-picker-window">
      <header className="window-picker-titlebar" data-tauri-drag-region>
        <span className="window-picker-mark"><AppWindow size={19} /></span>
        <div data-tauri-drag-region>
          <strong data-tauri-drag-region>Select a window</strong>
        </div>
        <button className="window-picker-refresh" title="Refresh windows" aria-label="Refresh windows" onClick={() => void refresh()} disabled={loading || !!selecting}><RefreshCw size={16} className={loading ? "spin" : ""} /></button>
        <button title="Close" aria-label="Close window picker" onClick={() => getCurrentWindow().close()}><X size={16} /></button>
      </header>

      <section className="window-picker-body">
        {error && <p className="window-picker-error" role="alert">{error}</p>}
        <div className="window-picker-list" aria-label="Open windows" aria-busy={loading}>
          {loading && <div className="window-picker-empty"><RefreshCw size={21} className="spin" /><strong>Finding open windows…</strong></div>}
          {!loading && targets.map((target) => (
            <button key={target.id} className="window-picker-option" title={target.name} disabled={!!selecting} onClick={() => void choose(target)}>
              <span className="window-picker-video">
                {previews[target.id] ? <img src={previews[target.id]} alt="" /> : <AppWindow size={32} aria-label="Preview unavailable" />}
                {selecting === target.id && <RefreshCw size={20} className="spin" />}
              </span>
              <strong>{target.name}</strong>
            </button>
          ))}
          {!loading && !error && targets.length === 0 && <div className="window-picker-empty"><AppWindow size={21} /><strong>No open windows</strong></div>}
        </div>

      </section>
    </main>
  );
}
