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
        {isPaused ? (
          <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
            <polygon points="5,3 19,12 5,21" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
            <rect x="6" y="4" width="4" height="16" rx="1" />
            <rect x="14" y="4" width="4" height="16" rx="1" />
          </svg>
        )}
      </button>

      <button
        className={`dock-action-btn ${micMuted ? "muted" : ""}`}
        onClick={onMicToggle}
        title={micMuted ? "Unmute Microphone" : "Mute Microphone"}
      >
        {micMuted ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
            <line x1="1" y1="1" x2="23" y2="23" />
            <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
            <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
            <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3M8 22h8" />
          </svg>
        )}
      </button>

      <button className="dock-stop-btn" onClick={onStop} title="Stop & Open Editor">
        <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
          <rect x="4" y="4" width="16" height="16" rx="3" />
        </svg>
        Stop & Edit
      </button>
    </div>
  );
}
