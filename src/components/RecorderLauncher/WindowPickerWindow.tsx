import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { AppWindow, ChevronRight, RefreshCw, Search, X } from "lucide-react";
import "./WindowPickerWindow.css";

interface DisplayTarget {
  id: string;
  name: string;
  target_type: string;
}

export default function WindowPickerWindow() {
  const [targets, setTargets] = useState<DisplayTarget[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selecting, setSelecting] = useState("");

  const refresh = async () => {
    setLoading(true);
    setError("");
    try {
      const next = await invoke<DisplayTarget[]>("enumerate_targets");
      setTargets(next.filter((target) => target.target_type === "window"));
    } catch (reason) {
      setError(`Unable to inspect open windows: ${reason}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void refresh(); }, []);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query ? targets.filter((target) => target.name.toLowerCase().includes(query)) : targets;
  }, [search, targets]);

  const choose = async (target: DisplayTarget) => {
    if (selecting) return;
    setSelecting(target.id);
    try {
      await emitTo("main", "window-target-selected", target.id);
      await getCurrentWindow().close();
    } catch (reason) {
      setSelecting("");
      setError(`Unable to select ${target.name}: ${reason}`);
    }
  };

  return (
    <main className="window-picker-window">
      <header className="window-picker-titlebar" data-tauri-drag-region>
        <span className="window-picker-mark"><AppWindow size={19} /></span>
        <div data-tauri-drag-region>
          <strong data-tauri-drag-region>Select a window</strong>
          <small data-tauri-drag-region>Choose one application to record</small>
        </div>
        <button title="Close" aria-label="Close window picker" onClick={() => getCurrentWindow().close()}><X size={16} /></button>
      </header>

      <section className="window-picker-body">
        <div className="window-picker-intro">
          <div><span>Window capture</span><h1>What would you like to record?</h1><p>Snap will follow the selected application window while keeping the rest of your desktop private.</p></div>
          <button className="window-picker-refresh" onClick={() => void refresh()} disabled={loading}><RefreshCw size={15} className={loading ? "spin" : ""} />Refresh</button>
        </div>

        <label className="window-picker-search">
          <Search size={16} />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search open windows" autoFocus />
          {search && <button title="Clear search" onClick={() => setSearch("")}><X size={13} /></button>}
        </label>

        <div className="window-picker-list" aria-busy={loading}>
          {loading && <div className="window-picker-empty"><RefreshCw size={21} className="spin" /><strong>Finding open windows…</strong></div>}
          {!loading && error && <div className="window-picker-empty error"><AppWindow size={21} /><strong>Window list unavailable</strong><small>{error}</small></div>}
          {!loading && !error && filtered.map((target) => (
            <button key={target.id} className="window-picker-option" disabled={!!selecting} onClick={() => void choose(target)}>
              <span className="window-picker-option-icon"><AppWindow size={17} /></span>
              <span><strong>{target.name}</strong><small>Application window</small></span>
              {selecting === target.id ? <RefreshCw size={15} className="spin" /> : <ChevronRight size={16} />}
            </button>
          ))}
          {!loading && !error && filtered.length === 0 && <div className="window-picker-empty"><Search size={21} /><strong>No matching windows</strong><small>Try refreshing or clearing the search.</small></div>}
        </div>

        <footer className="window-picker-footer"><span><i />{targets.length} windows available</span><small>Selecting a window starts the normal recording countdown.</small></footer>
      </section>
    </main>
  );
}
