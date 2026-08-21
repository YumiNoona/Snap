import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Play, Pause, Mic, MicOff, Minimize2, Maximize2 } from "lucide";
import { GripVertical, LoaderCircle, Square } from "lucide-react";
import { MorphIcon } from "morphicons/react";
import "./FloatingToolbar.css";

interface DockState {
  recording: boolean;
  elapsed: number;
  paused: boolean;
  mic_muted: boolean;
}

export default function RecordingDock() {
  const [state, setState] = useState<DockState>({
    recording: false,
    elapsed: 0,
    paused: false,
    mic_muted: false,
  });
  const [compact, setCompact] = useState(false);
  const [stopping, setStopping] = useState(false);

  // Transparent window — clear the app-level dark body background.
  useEffect(() => {
    document.body.style.background = "transparent";
    const html = document.documentElement;
    html.style.background = "transparent";
    return () => {
      document.body.style.background = "";
      html.style.background = "";
    };
  }, []);

  // Tell Rust that the transparent WebView has mounted. If recording started
  // before this page finished loading, Rust will immediately show it now.
  useEffect(() => {
    invoke("dock_window_ready").catch(() => {});
  }, []);

  // Pull the current snapshot (window may open after recording already started).
  useEffect(() => {
    let alive = true;
    invoke<DockState>("get_dock_state")
      .then((s) => { if (alive) setState(s); })
      .catch(() => {});
    return () => { alive = false; };
  }, []);

  // Stay in sync with the launcher window.
  useEffect(() => {
    const un = listen<DockState>("dock-state", (e) => setState(e.payload));
    return () => {
      un.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    const un = listen<boolean>("dock-compact", (event) => setCompact(event.payload));
    return () => { un.then((stop) => stop()); };
  }, []);

  const send = useCallback((action: "stop" | "pause" | "mic") => {
    invoke("dock_action", { action }).catch(() => {});
  }, []);

  const toggleCompact = useCallback(() => {
    const next = !compact;
    setCompact(next);
    invoke("set_dock_compact", { compact: next }).catch(() => setCompact(!next));
  }, [compact]);

  const stopRecording = useCallback(() => {
    if (stopping) return;
    setStopping(true);
    if (compact) {
      setCompact(false);
      invoke("set_dock_compact", { compact: false }).catch(() => {});
    }
    // Acknowledge the click in this window before the launcher begins the
    // heavier finalization flow. Once Rust has accepted the action, dismiss
    // the dock; the launcher shows detailed preparation progress.
    invoke("dock_action", { action: "stop" })
      .then(() => invoke("set_dock_visible", { visible: false }))
      .catch(() => setStopping(false));
  }, [compact, stopping]);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <div className={`dock-window-root ${compact ? "compact" : ""}`}>
      <div className={`floating-dock-container ${compact ? "compact" : ""} ${stopping ? "stopping" : ""}`}>
        <button
          className="dock-drag-handle"
          title="Drag recording controls"
          aria-label="Drag recording controls"
          data-tauri-drag-region
          onMouseDown={() => getCurrentWindow().startDragging().catch(() => {})}
        >
          <GripVertical size={15} />
        </button>

        <div className="floating-rec-badge">
          <span className={`rec-dot-animated ${state.paused ? "paused" : ""}`} />
          <span className="rec-timer-text">{formatTime(state.elapsed)}</span>
        </div>

        <div className="floating-dock-divider" />

        {!compact && !stopping && <button
          className="dock-action-btn"
          onClick={() => send("pause")}
          title={state.paused ? "Resume Recording" : "Pause Recording"}
        >
          <MorphIcon icon={state.paused ? Play : Pause} spring="snappy" size={16} />
        </button>}

        {!compact && !stopping && <button
          className={`dock-action-btn ${state.mic_muted ? "muted" : ""}`}
          onClick={() => send("mic")}
          title={state.mic_muted ? "Unmute Microphone" : "Mute Microphone"}
        >
          <MorphIcon icon={state.mic_muted ? MicOff : Mic} spring="snappy" size={16} />
        </button>}

        {!stopping && <button className="dock-action-btn dock-compact-btn" onClick={toggleCompact} title={compact ? "Expand controls" : "Minimize controls"}>
          <MorphIcon icon={compact ? Maximize2 : Minimize2} spring="snappy" size={16} />
        </button>}

        <button className={`dock-stop-btn ${compact ? "icon-only" : ""} ${stopping ? "stopping" : ""}`} onClick={stopRecording} disabled={stopping} title={stopping ? "Preparing recording" : "Stop & Open Editor"}>
          {stopping ? <LoaderCircle size={14} className="dock-stop-spinner" /> : <Square size={13} fill="currentColor" />}
          {!compact && (stopping ? "Preparing…" : "Stop & Edit")}
        </button>
      </div>
    </div>
  );
}
