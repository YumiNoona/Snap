import { useState, useEffect, useRef } from "react";
import "./TeleprompterModal.css";

interface Props {
  onClose: () => void;
}

export default function TeleprompterModal({ onClose }: Props) {
  const [script, setScript] = useState(
    "Welcome to Snap Screen Recorder!\n\nUse this teleprompter to read your script seamlessly while recording your screen, browser, or camera.\n\nAdjust the scroll speed, font size, and text color below to fit your pacing."
  );
  const [scrolling, setScrolling] = useState(false);
  const [speed, setSpeed] = useState(2);
  const [fontSize, setFontSize] = useState(24);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!scrolling) return;
    const interval = setInterval(() => {
      if (contentRef.current) {
        contentRef.current.scrollTop += speed * 0.8;
      }
    }, 30);
    return () => clearInterval(interval);
  }, [scrolling, speed]);

  return (
    <div className="teleprompter-overlay">
      <div className="teleprompter-card">
        <div className="teleprompter-header">
          <div className="teleprompter-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <path d="M6 8h12M6 12h12M6 16h8" />
            </svg>
            Teleprompter Script
          </div>
          <button className="teleprompter-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>

        {/* Script Content / Editor */}
        <div className="teleprompter-body" ref={contentRef}>
          <textarea
            className="teleprompter-textarea"
            value={script}
            onChange={(e) => setScript(e.target.value)}
            style={{ fontSize: `${fontSize}px` }}
            placeholder="Type or paste your script here..."
          />
        </div>

        {/* Controls Bar */}
        <div className="teleprompter-controls">
          <button
            className={`teleprompter-play-btn ${scrolling ? "active" : ""}`}
            onClick={() => setScrolling(!scrolling)}
          >
            {scrolling ? "Pause Scroll" : "Start Auto Scroll"}
          </button>

          <div className="control-group">
            <label>Speed ({speed}x)</label>
            <input
              type="range"
              min={1}
              max={10}
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
            />
          </div>

          <div className="control-group">
            <label>Font ({fontSize}px)</label>
            <input
              type="range"
              min={16}
              max={48}
              value={fontSize}
              onChange={(e) => setFontSize(Number(e.target.value))}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
