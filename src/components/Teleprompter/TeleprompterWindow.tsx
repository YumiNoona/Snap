import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Grip, X, RotateCcw } from "lucide-react";
import { Play, Pause } from "lucide";
import { MorphIcon } from "morphicons/react";
import "./TeleprompterWindow.css";

interface Props {
  onClose?: () => void;
}

const DEFAULT_SCRIPT = `Welcome to Snap Screen Recorder!

This is your dedicated Teleprompter window. You can drag it anywhere on screen while recording your presentation, gaming, or tutorial.

Features built for seamless recording:
1. Auto-scroll with word-by-word karaoke highlighting so you never lose your place.
2. Customizable Reading Speed (WPM), Font Size, and Window Opacity.
3. Mirror Text Mode for hardware teleprompter glass setups.
4. Floating overlay that stays accessible over any app or browser window.

Type your script in Edit mode, then press Start Prompt to begin reading!`;

export default function TeleprompterWindow({ onClose }: Props) {
  const isStandalone = new URLSearchParams(window.location.search).get("window") === "teleprompter";

  const [mode, setMode] = useState<"edit" | "prompt">("prompt");
  const [script, setScript] = useState(DEFAULT_SCRIPT);

  const [isPlaying, setIsPlaying] = useState(false);
  const [wpm, setWpm] = useState(150);
  const [fontSize, setFontSize] = useState(28);
  const [opacity, setOpacity] = useState(0.92);
  const [isFlipped, setIsFlipped] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const scrollAnimationRef = useRef<number | null>(null);
  const words = useMemo(() => script.split(/(\s+)/), [script]);
  const wordIndices = useMemo(() => words.map((word, index) => word.trim() ? index : -1).filter((index) => index >= 0), [words]);
  const [currentWordPosition, setCurrentWordPosition] = useState(0);
  const currentWordIdx = wordIndices[Math.min(currentWordPosition, Math.max(0, wordIndices.length - 1))] ?? -1;
  const actualWordCount = wordIndices.length;

  useEffect(() => {
    if (!isStandalone) return;
    const prevBg = document.body.style.background;
    const prevColor = document.body.style.color;
    document.body.style.background = "#0b0d12";
    document.body.style.color = "#f2f4f8";
    return () => {
      document.body.style.background = prevBg;
      document.body.style.color = prevColor;
    };
  }, [isStandalone]);

  useEffect(() => {
    invoke("window_ready").catch((e) => {
      console.error("[Snap] window_ready failed — teleprompter window will stay hidden:", e);
    });
  }, []);

  const handleClose = useCallback(() => {
    if (onClose) {
      onClose();
    } else if (isStandalone) {
      getCurrentWindow().close();
    }
  }, [onClose, isStandalone]);

  const animateScrollTo = useCallback((targetTop: number, duration = 320) => {
    const container = scrollRef.current;
    if (!container) return;
    if (scrollAnimationRef.current !== null) cancelAnimationFrame(scrollAnimationRef.current);
    const startTop = container.scrollTop;
    const boundedTarget = Math.max(0, Math.min(targetTop, container.scrollHeight - container.clientHeight));
    const distance = boundedTarget - startTop;
    if (Math.abs(distance) < 1) return;
    const startedAt = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      container.scrollTop = startTop + distance * eased;
      if (progress < 1) scrollAnimationRef.current = requestAnimationFrame(tick);
      else scrollAnimationRef.current = null;
    };
    scrollAnimationRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => () => {
    if (scrollAnimationRef.current !== null) cancelAnimationFrame(scrollAnimationRef.current);
  }, []);


  // Advance by actual words only. Whitespace stays in the rendered script but
  // no longer consumes a timing tick, so the configured WPM is accurate.
  useEffect(() => {
    if (!isPlaying || mode !== "prompt") return;

    const msPerWord = (60 / Math.max(30, wpm)) * 1000;

    const timer = setTimeout(() => {
      setCurrentWordPosition((previous) => {
        const next = previous + 1;
        if (next >= wordIndices.length) {
          setIsPlaying(false);
          return previous;
        }
        return next;
      });
    }, msPerWord);

    return () => clearTimeout(timer);
  }, [isPlaying, mode, wpm, currentWordPosition, wordIndices.length]);

  useEffect(() => {
    if (mode !== "prompt" || currentWordIdx < 0) return;
    const wordEl = document.getElementById(`tp-word-${currentWordIdx}`);
    const container = scrollRef.current;
    if (!wordEl || !container) return;
    const targetScroll = wordEl.offsetTop - container.clientHeight / 2 + wordEl.clientHeight / 2;
    animateScrollTo(targetScroll, Math.min(380, Math.max(180, 48000 / Math.max(60, wpm))));
  }, [currentWordIdx, mode, wpm, animateScrollTo]);

  useEffect(() => {
    if (currentWordPosition >= wordIndices.length) setCurrentWordPosition(0);
  }, [currentWordPosition, wordIndices.length]);

  const resetPrompt = () => {
    setIsPlaying(false);
    setCurrentWordPosition(0);
    animateScrollTo(0, 260);
  };

  return (
    <div
      className={`teleprompter-window ${isStandalone ? "standalone" : ""}`}
      style={isStandalone ? { opacity } : undefined}
    >
      {/* Drag Titlebar */}
      <div className="tp-titlebar" data-tauri-drag-region>
        <div className="tp-drag-handle" data-tauri-drag-region>
          <Grip size={15} />
          <span className="tp-window-title" data-tauri-drag-region>Teleprompter</span>
        </div>

        <div className="tp-mode-tabs">
          <button
            className={`tp-tab-btn ${mode === "prompt" ? "active" : ""}`}
            onClick={() => { setMode("prompt"); resetPrompt(); }}
          >
            Prompter
          </button>
          <button
            className={`tp-tab-btn ${mode === "edit" ? "active" : ""}`}
            onClick={() => { setMode("edit"); setIsPlaying(false); }}
          >
            Edit Script
          </button>
        </div>

        <button className="tp-close-btn" onClick={handleClose} title="Close Teleprompter">
          <X size={14} />
        </button>
      </div>

      {/* Main Body */}
      {mode === "edit" ? (
        <div className="tp-edit-body tp-mode-panel">
          <textarea
            className="tp-script-textarea"
            value={script}
            onChange={(e) => setScript(e.target.value)}
            placeholder="Type or paste your script here..."
          />
          <div className="tp-edit-footer">
            <span className="tp-word-count">{actualWordCount} words</span>
            <button className="tp-start-btn" onClick={() => { setMode("prompt"); resetPrompt(); }}>
              Start Prompting
            </button>
          </div>
        </div>
      ) : (
        <div className="tp-prompt-body tp-mode-panel">
          <div className="tp-reading-marker" />

          <div
            className={`tp-scroll-container ${isFlipped ? "flipped" : ""}`}
            ref={scrollRef}
            style={{ fontSize: `${fontSize}px` }}
          >
            <div className="tp-text-wrapper">
              {words.map((word, idx) => {
                const isWhitespace = /^\s+$/.test(word);
                if (isWhitespace) {
                  return <span key={idx}>{word}</span>;
                }

                const isCurrent = idx === currentWordIdx;
                const isPast = idx < currentWordIdx;

                return (
                  <span
                    id={`tp-word-${idx}`}
                    key={idx}
                    className={`tp-word ${isCurrent ? "current" : ""} ${isPast ? "past" : ""}`}
                    onClick={() => {
                      const position = wordIndices.indexOf(idx);
                      if (position >= 0) setCurrentWordPosition(position);
                    }}
                  >
                    {word}
                  </span>
                );
              })}
            </div>
          </div>

          {/* Floating Control Toolbar */}
          <div className="teleprompter-controls">
            <div className="tp-primary-actions">
              <button className={`tp-play-btn ${isPlaying ? "playing" : ""}`} onClick={() => setIsPlaying(!isPlaying)}>
                <MorphIcon icon={isPlaying ? Pause : Play} spring="snappy" size={14} />
                {isPlaying ? "Pause" : "Start"}
              </button>
              <button className="tp-icon-btn reset" onClick={resetPrompt} title="Reset to top"><RotateCcw size={14} /></button>
            </div>

            <div className="tp-controls-grid">
            <div className="tp-control-item">
              <div className="tp-control-meta"><label>Speed</label><span className="tp-val">{wpm} WPM</span></div>
              <input
                type="range"
                min={60}
                max={320}
                step={5}
                value={wpm}
                onChange={(e) => setWpm(Number(e.target.value))}
              />
            </div>

            <div className="tp-control-item">
              <div className="tp-control-meta"><label>Font</label><span className="tp-val">{fontSize}px</span></div>
              <input
                type="range"
                min={18}
                max={48}
                step={2}
                value={fontSize}
                onChange={(e) => setFontSize(Number(e.target.value))}
              />
            </div>

            <div className="tp-control-item">
              <div className="tp-control-meta"><label>Opacity</label><span className="tp-val">{Math.round(opacity * 100)}%</span></div>
              <input
                type="range"
                min={0.3}
                max={1.0}
                step={0.05}
                value={opacity}
                onChange={(e) => setOpacity(Number(e.target.value))}
              />
            </div>
            </div>

            <button
              className={`tp-icon-btn flip ${isFlipped ? "active" : ""}`}
              onClick={() => setIsFlipped(!isFlipped)}
              title="Flip / Mirror Text for Glass Teleprompter"
            >
              Flip
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
