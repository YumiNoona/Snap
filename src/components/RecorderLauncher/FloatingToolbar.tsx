import { Play, Pause, Mic, MicOff, Square } from "lucide-react";
import "./FloatingToolbar.css";

interface Props {
  elapsed: number;
  onStop: () => void;
  onPauseToggle: () => void;
  isPaused: boolean;
  onMicToggle: () => void;
  micMuted: boolean;
}

export default function FloatingToolbar({
  elapsed,
  onStop,
  onPauseToggle,
  isPaused,
  onMicToggle,
  micMuted,
}: Props) {
  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  };

  return (
    <div className="floating-dock-container">
      <div className="floating-rec-badge">
        <span className={`rec-dot-animated ${isPaused ? "paused" : ""}`} />
        <span className="rec-timer-text">{formatTime(elapsed)}</span>
      </div>

      <div className="floating-dock-divider" />

      <button
        className="dock-action-btn"
        onClick={onPauseToggle}
        title={isPaused ? "Resume Recording" : "Pause Recording"}
      >
        {isPaused ? <Play size={16} /> : <Pause size={16} />}
      </button>

      <button
        className={`dock-action-btn ${micMuted ? "muted" : ""}`}
        onClick={onMicToggle}
        title={micMuted ? "Unmute Microphone" : "Mute Microphone"}
      >
        {micMuted ? <MicOff size={16} /> : <Mic size={16} />}
      </button>

      <button className="dock-stop-btn" onClick={onStop} title="Stop & Open Editor">
        <Square size={13} fill="currentColor" />
        Stop & Edit
      </button>
    </div>
  );
}