import { useCallback, useEffect, useRef, useState } from "react";

interface Options { videoPath: string; trimStart: number; trimEnd: number; duration: number }

/** A deliberately small transport: the video element remains the sole clock. */
export function usePlaybackController({ videoPath, trimStart, trimEnd, duration }: Options) {
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [mediaElement, setMediaElement] = useState<HTMLVideoElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const boundsRef = useRef({ start: trimStart, end: trimEnd || duration });
  boundsRef.current = { start: trimStart, end: trimEnd || duration };

  const pause = useCallback(() => {
    videoRef.current?.pause();
    setPlaying(false);
  }, []);

  useEffect(() => {
    const video = mediaElement;
    if (!video) return;
    videoRef.current = video;
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    const onEnded = () => setPlaying(false);
    const onTime = () => {
      const end = boundsRef.current.end || video.duration || 0;
      if (!video.paused && end > 0 && video.currentTime >= end) {
        video.pause();
        video.currentTime = end;
      }
      setCurrentTime(video.currentTime);
    };
    video.addEventListener("play", onPlay);
    video.addEventListener("playing", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onEnded);
    video.addEventListener("timeupdate", onTime);
    return () => {
      video.pause();
      video.removeEventListener("play", onPlay);
      video.removeEventListener("playing", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("timeupdate", onTime);
      videoRef.current = null;
    };
  }, [mediaElement, videoPath]);

  const toggle = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!video.paused && !video.ended) {
      video.pause();
      return;
    }
    const start = Math.max(0, trimStart);
    const end = trimEnd || video.duration || duration;
    if (video.ended || video.currentTime < start || (end > start && video.currentTime >= end - .025)) {
      video.currentTime = start;
      setCurrentTime(start);
    }
    void video.play().catch((error) => {
      setPlaying(false);
      console.error("[Snap] Video playback failed:", error);
    });
  }, [duration, trimEnd, trimStart]);

  const seek = useCallback((time: number) => {
    const video = videoRef.current;
    const end = trimEnd || video?.duration || time;
    const clamped = Math.max(trimStart, Math.min(time, end));
    if (video) video.currentTime = clamped;
    setCurrentTime(clamped);
  }, [trimEnd, trimStart]);

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || !!target.closest("input, textarea, select, button, [role='textbox'], [role='slider']"))) return;
      event.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [toggle]);

  return { currentTime, playing, setMediaElement, setCurrentTime, togglePlay: toggle, pausePlayback: pause, seekTo: seek };
}
