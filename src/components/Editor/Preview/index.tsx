import { useEffect, useRef, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";

interface InputEvent {
  ts: number;
  type: string;
  x: number | null;
  y: number | null;
  key: string | null;
  button: string | null;
}

interface Props {
  videoPath: string;
  inputLogPath: string;
  onClose: () => void;
}

export default function Preview({ videoPath, inputLogPath, onClose }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [events, setEvents] = useState<InputEvent[]>([]);
  const [loadError, setLoadError] = useState("");
  const rafRef = useRef<number>(0);

  // Pre-filtered mousemove events sorted by timestamp for binary search
  const mouseMoveEvents = useRef<InputEvent[]>([]);

  // Load input log JSONL
  useEffect(() => {
    (async () => {
      try {
        const text = await invoke<string>("read_text_file", {
          path: inputLogPath,
        });
        const parsed: InputEvent[] = text
          .split("\n")
          .filter((line) => line.trim())
          .map((line) => JSON.parse(line));
        setEvents(parsed);

        // Pre-filter and sort mousemove events for efficient binary search
        mouseMoveEvents.current = parsed
          .filter((e) => e.type === "mousemove" && e.x != null && e.y != null)
          .sort((a, b) => a.ts - b.ts);

        console.log(
          `[Editor] Loaded ${parsed.length} input events (${mouseMoveEvents.current.length} mousemove)`
        );
      } catch (e) {
        setLoadError(`Failed to load input log: ${e}`);
      }
    })();
  }, [inputLogPath]);

  // Binary search for the last mousemove event at or before the given timestamp.
  const getCursorAt = useCallback(
    (timestampMs: number): { x: number; y: number } | null => {
      const moves = mouseMoveEvents.current;
      if (moves.length === 0) return null;

      // Binary search: find the rightmost event with ts <= timestampMs
      let lo = 0;
      let hi = moves.length - 1;
      let best = -1;

      while (lo <= hi) {
        const mid = (lo + hi) >>> 1;
        if (moves[mid].ts <= timestampMs) {
          best = mid;
          lo = mid + 1;
        } else {
          hi = mid - 1;
        }
      }

      if (best >= 0) {
        const e = moves[best];
        return { x: e.x!, y: e.y! };
      }
      return null;
    },
    [] // mouseMoveEvents is a ref, no dependency needed
  );

  // Render one frame — draws video frame + cursor to canvas
  const renderFrame = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Draw video frame
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

    // Draw cursor overlay
    const timestampMs = video.currentTime * 1000;
    const cursor = getCursorAt(timestampMs);
    if (cursor) {
      const scaleX = canvas.width / video.videoWidth;
      const scaleY = canvas.height / video.videoHeight;
      const cx = cursor.x * scaleX;
      const cy = cursor.y * scaleY;

      ctx.beginPath();
      ctx.arc(cx, cy, 12, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(255, 80, 80, 0.8)";
      ctx.fill();
      ctx.strokeStyle = "#fff";
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    setCurrentTime(video.currentTime);
  }, [getCursorAt]);

  // Render loop — calls renderFrame on each animation frame while playing
  const renderLoop = useCallback(() => {
    renderFrame();
    rafRef.current = requestAnimationFrame(renderLoop);
  }, [renderFrame]);

  // Start/stop render loop
  useEffect(() => {
    if (playing) {
      rafRef.current = requestAnimationFrame(renderLoop);
    } else {
      cancelAnimationFrame(rafRef.current);
    }
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, renderLoop]);

  // Video metadata loaded
  const onMetadata = () => {
    const video = videoRef.current;
    if (!video) return;
    setDuration(video.duration);
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play();
      setPlaying(true);
    } else {
      video.pause();
      setPlaying(false);
      // Render one more frame so canvas shows the paused frame
      renderFrame();
    }
  };

  const onSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const video = videoRef.current;
    if (!video) return;
    const t = parseFloat(e.target.value);
    video.currentTime = t;
    setCurrentTime(t);
    // Render immediately so canvas updates even when paused
    requestAnimationFrame(renderFrame);
  };

  const videoUrl = convertFileSrc(videoPath);

  return (
    <div style={{ padding: 20, background: "var(--bg-primary)", color: "var(--text-primary)", minHeight: "100vh" }}>
      {/* Top bar */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <button onClick={onClose} style={{ padding: "6px 14px", borderRadius: 6, border: "1px solid var(--border-default)", background: "var(--bg-tertiary)", color: "var(--text-primary)", cursor: "pointer" }}>
          Back
        </button>
        <span style={{ fontSize: 14, fontWeight: 600 }}>Editor Preview</span>
        <span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: "auto" }}>
          {videoPath.split("\\").pop()}
        </span>
      </div>

      {loadError && (
        <p style={{ color: "#f87171", marginBottom: 12 }}>{loadError}</p>
      )}

      {/* Canvas */}
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 16 }}>
        <canvas
          ref={canvasRef}
          style={{ maxWidth: "100%", borderRadius: 8, background: "#000" }}
        />
      </div>

      {/* Hidden video element */}
      <video
        ref={videoRef}
        src={videoUrl}
        style={{ display: "none" }}
        onLoadedMetadata={onMetadata}
        onEnded={() => {
          setPlaying(false);
          renderFrame();
        }}
      />

      {/* Controls */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, maxWidth: 600, margin: "0 auto" }}>
        <button
          onClick={togglePlay}
          style={{
            padding: "8px 18px",
            borderRadius: 6,
            border: "1px solid var(--border-default)",
            background: "var(--bg-tertiary)",
            color: "var(--text-primary)",
            cursor: "pointer",
            fontWeight: 600,
            fontSize: 14,
          }}
        >
          {playing ? "Pause" : "Play"}
        </button>

        <span style={{ fontSize: 12, color: "var(--text-muted)", minWidth: 80, textAlign: "center" }}>
          {formatTime(currentTime)} / {formatTime(duration)}
        </span>

        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.01}
          value={currentTime}
          onChange={onSeek}
          style={{ flex: 1, accentColor: "var(--accent)" }}
        />

        <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
          {events.length} events
        </span>
      </div>
    </div>
  );
}

function formatTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}
