import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { releaseVideo } from "../../../lib/canvasDraw";

export default function TrimPreview({ path, left, right, onClose }: { path: string; left: number; right: number; onClose: () => void }) {
  const outgoing = useRef<HTMLVideoElement>(null), incoming = useRef<HTMLVideoElement>(null);
  const times = useRef([left, right]); times.current = [left, right];
  useEffect(() => {
    const videos = [outgoing.current, incoming.current];
    const handlers = videos.map((video, i) => {
      const seek = () => { if (video) video.currentTime = Math.max(0, Math.min(times.current[i], video.duration - .001)); };
      if (video) { video.src = convertFileSrc(path); video.addEventListener("loadedmetadata", seek); video.load(); }
      return seek;
    });
    return () => videos.forEach((video, i) => { if (video) { video.removeEventListener("loadedmetadata", handlers[i]); releaseVideo(video); } });
  }, [path]);
  useEffect(() => {
    const timer = setTimeout(() => [outgoing.current, incoming.current].forEach((video, i) => {
      if (video && video.readyState >= 1) video.currentTime = Math.max(0, Math.min(times.current[i], video.duration - .001));
    }), 120);
    return () => clearTimeout(timer);
  }, [left, right]);
  return <aside className="trim-preview" aria-label="Two-frame trim preview"><figure><video ref={outgoing} muted playsInline preload="metadata"/><figcaption>Outgoing · {left.toFixed(3)}s</figcaption></figure><figure><video ref={incoming} muted playsInline preload="metadata"/><figcaption>Incoming · {right.toFixed(3)}s</figcaption></figure><button onClick={onClose} aria-label="Close trim preview"><X size={14}/></button></aside>;
}
