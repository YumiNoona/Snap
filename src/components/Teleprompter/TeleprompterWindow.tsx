import { useState, useEffect, useRef, useCallback } from "react";
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
  const appWindow = getCurrentWindow();
  const isStandalone = appWindow.label === "teleprompter";

  const [mode, setMode] = useState<"edit" | "prompt">("prompt");
  const [script, setScript] = useState(DEFAULT_SCRIPT);

  const [isPlaying, setIsPlaying] = useState(false);
  const [wpm, setWpm] = useState(150);
  const [fontSize, setFontSize] = useState(28);
  const [opacity, setOpacity] = useState(0.92);
  const [isFlipped, setIsFlipped] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const words = script.split(/(\s+)/);
  const [currentWordIdx, setCurrentWordIdx] = useState(0);

  const actualWordCount = words.filter((w) => w.trim().length > 0).length;

  useEffect(() => {
    console.log("[Snap Teleprompter] mounted OK, standalone:", isStandalone);
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

  const handleClose = useCallback(() => {
    if (onClose) {
      onClose();
    } else if (isStandalone) {
      appWindow.close();
    }
  }, [onClose, isStandalone, appWindow]);

  const handleTitlebarDrag = async (e: React.MouseEvent) => {
    if (isStandalone) {
      e.preventDefault();
      await appWindow.startDragging();
    }
  };

  // Word-by-word reveal & auto scroll timer
  useEffect(() => {
    if (!isPlaying || mode !== "prompt") return;

    const msPerWord = (60 / Math.max(30, wpm)) * 1000;

    const interval = setInterval(() => {
      setCurrentWordIdx((prev) => {
        const next = prev + 1;
        if (next >= words.length) {
          setIsPlaying(false);
          return prev;
        }

        const wordEl = document.getElementById(`tp-word-${next}`);
        if (wordEl && scrollRef.current) {
          const container = scrollRef.current;
          const wordTop = wordEl.offsetTop - container.offsetTop;
          const targetScroll = wordTop - container.clientHeight / 2 + 40;
          container.scrollTo({ top: targetScroll, behavior: "smooth" });
        }

        return next;
      });
    }, msPerWord);

    return () => clearInterval(interval);
  }, [isPlaying, mode, wpm, words.length]);

  const resetPrompt = () => {
    setIsPlaying(false);
    setCurrentWordIdx(0);
    if (scrollRef.current) {
      scrollRef.current.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  return (
    <div
      className={`teleprompter-window ${isStandalone ? "standalone" : ""}`}
      style={isStandalone ? { opacity } : undefined}
    >
      {/* Drag Titlebar */}
      <div className="tp-titlebar" onMouseDown={handleTitlebarDrag}>
        <div className="tp-drag-handle">
          <Grip size={15} />
          <span className="tp-window-title">Teleprompter</span>
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
        <div className="tp-edit-body">
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
        <div className="tp-prompt-body">
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
                      setCurrentWordIdx(idx);
                      const wordEl = document.getElementById(`tp-word-${idx}`);
                      if (wordEl && scrollRef.current) {
                        scrollRef.current.scrollTo({
                          top: wordEl.offsetTop - scrollRef.current.clientHeight / 2,
                          behavior: "smooth",
                        });
                      }
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
            <button
              className={`tp-play-btn ${isPlaying ? "playing" : ""}`}
              onClick={() => setIsPlaying(!isPlaying)}
            >
              <MorphIcon icon={isPlaying ? Pause : Play} spring="snappy" size={14} />
              {isPlaying ? "Pause" : "Start"}
            </button>

            <button className="tp-icon-btn" onClick={resetPrompt} title="Reset to Top">
              <RotateCcw size={14} />
            </button>

            <div className="tp-control-item">
              <label>Speed</label>
              <input
                type="range"
                min={60}
                max={320}
                step={5}
                value={wpm}
                onChange={(e) => setWpm(Number(e.target.value))}
              />
              <span className="tp-val">{wpm} WPM</span>
            </div>

            <div className="tp-control-item">
              <label>Font</label>
              <input
                type="range"
                min={18}
                max={48}
                step={2}
                value={fontSize}
                onChange={(e) => setFontSize(Number(e.target.value))}
              />
              <span className="tp-val">{fontSize}px</span>
            </div>

            <div className="tp-control-item">
              <label>Opacity</label>
              <input
                type="range"
                min={0.3}
                max={1.0}
                step={0.05}
                value={opacity}
                onChange={(e) => setOpacity(Number(e.target.value))}
              />
            </div>

            <button
              className={`tp-icon-btn ${isFlipped ? "active" : ""}`}
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
