import { useEffect, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Play, Pause, Mic, MicOff } from "lucide";
import { Square } from "lucide-react";
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

  const send = useCallback((action: "stop" | "pause" | "mic") => {
    invoke("dock_action", { action }).catch(() => {});
  }, []);

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <div className="dock-window-root">
      <div className="floating-dock-container">
        <div className="floating-rec-badge">
          <span className={`rec-dot-animated ${state.paused ? "paused" : ""}`} />
          <span className="rec-timer-text">{formatTime(state.elapsed)}</span>
        </div>

        <div className="floating-dock-divider" />

        <button
          className="dock-action-btn"
          onClick={() => send("pause")}
          title={state.paused ? "Resume Recording" : "Pause Recording"}
        >
          <MorphIcon icon={state.paused ? Play : Pause} spring="snappy" size={16} />
        </button>

        <button
          className={`dock-action-btn ${state.mic_muted ? "muted" : ""}`}
          onClick={() => send("mic")}
          title={state.mic_muted ? "Unmute Microphone" : "Mute Microphone"}
        >
          <MorphIcon icon={state.mic_muted ? MicOff : Mic} spring="snappy" size={16} />
        </button>

        <button className="dock-stop-btn" onClick={() => send("stop")} title="Stop & Open Editor">
          <Square size={13} fill="currentColor" />
          Stop & Edit
        </button>
      </div>
    </div>
  );
}