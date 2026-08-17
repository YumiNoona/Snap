import { useCallback, useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { AudioMixConfig, AudioTrack } from "../../../lib/types";

interface Options {
  videoPath: string;
  trimStart: number;
  trimEnd: number;
  duration: number;
  audioTracks: AudioTrack[];
  audioMix: AudioMixConfig;
}

/** The video remains the master clock; independent WAV tracks follow it. */
export function usePlaybackController({ videoPath, trimStart, trimEnd, duration, audioTracks, audioMix }: Options) {
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [mediaElement, setMediaElement] = useState<HTMLVideoElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioElementsRef = useRef(new Map<string, HTMLAudioElement>());
  const audioTracksRef = useRef(audioTracks);
  const audioMixRef = useRef(audioMix);
  const boundsRef = useRef({ start: trimStart, end: trimEnd || duration });
  boundsRef.current = { start: trimStart, end: trimEnd || duration };
  audioTracksRef.current = audioTracks;
  audioMixRef.current = audioMix;

  const trackIsMuted = useCallback((track: AudioTrack) => (
    track.muted || (track.kind === "microphone" ? audioMixRef.current.micMuted : audioMixRef.current.systemMuted)
  ), []);

  const applyAudioMix = useCallback(() => {
    for (const track of audioTracksRef.current) {
      const element = audioElementsRef.current.get(track.id);
      if (!element) continue;
      const channelVolume = track.kind === "microphone"
        ? audioMixRef.current.micVolume
        : audioMixRef.current.systemVolume;
      element.muted = trackIsMuted(track);
      element.volume = Math.max(0, Math.min(1, track.volume * channelVolume / 100));
    }
  }, [trackIsMuted]);

  const syncSidecars = useCallback((video: HTMLVideoElement, force = false) => {
    for (const element of audioElementsRef.current.values()) {
      if (force || Math.abs(element.currentTime - video.currentTime) > 0.12) {
        try { element.currentTime = video.currentTime; } catch { /* metadata is still loading */ }
      }
      element.playbackRate = video.playbackRate;
    }
  }, []);

  const playSidecars = useCallback((video: HTMLVideoElement) => {
    applyAudioMix();
    syncSidecars(video, true);
    for (const track of audioTracksRef.current) {
      const element = audioElementsRef.current.get(track.id);
      if (!element || trackIsMuted(track)) continue;
      void element.play().catch((error) => console.warn(`[Snap] ${track.label} preview playback failed:`, error));
    }
  }, [applyAudioMix, syncSidecars, trackIsMuted]);

  const pauseSidecars = useCallback(() => {
    for (const element of audioElementsRef.current.values()) element.pause();
  }, []);

  useEffect(() => {
    const elements = new Map<string, HTMLAudioElement>();
    for (const track of audioTracks) {
      const element = new Audio(convertFileSrc(track.path));
      element.preload = "auto";
      elements.set(track.id, element);
    }
    audioElementsRef.current = elements;
    applyAudioMix();
    const video = videoRef.current;
    if (video) {
      syncSidecars(video, true);
      if (!video.paused) playSidecars(video);
    }
    return () => {
      for (const element of elements.values()) {
        element.pause();
        element.removeAttribute("src");
        element.load();
      }
      if (audioElementsRef.current === elements) audioElementsRef.current = new Map();
    };
  }, [applyAudioMix, audioTracks, playSidecars, syncSidecars]);

  useEffect(() => {
    applyAudioMix();
    const video = videoRef.current;
    if (!video || video.paused) return;
    for (const track of audioTracksRef.current) {
      const element = audioElementsRef.current.get(track.id);
      if (!element) continue;
      if (trackIsMuted(track)) element.pause();
      else if (element.paused) {
        try { element.currentTime = video.currentTime; } catch { /* metadata is still loading */ }
        void element.play().catch(() => {});
      }
    }
  }, [applyAudioMix, audioMix, trackIsMuted]);

  const pause = useCallback(() => {
    videoRef.current?.pause();
    pauseSidecars();
    setPlaying(false);
  }, [pauseSidecars]);

  useEffect(() => {
    const video = mediaElement;
    if (!video) return;
    videoRef.current = video;
    const onPlay = () => { setPlaying(true); playSidecars(video); };
    const onPause = () => { pauseSidecars(); setPlaying(false); };
    const onEnded = () => { pauseSidecars(); setPlaying(false); };
    const onTime = () => {
      const end = boundsRef.current.end || video.duration || 0;
      if (!video.paused && end > 0 && video.currentTime >= end) {
        video.pause();
        video.currentTime = end;
      }
      setCurrentTime(video.currentTime);
      syncSidecars(video);
    };
    const onSeeking = () => syncSidecars(video, true);
    const onRateChange = () => syncSidecars(video, true);
    video.addEventListener("play", onPlay);
    video.addEventListener("playing", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("ended", onEnded);
    video.addEventListener("timeupdate", onTime);
    video.addEventListener("seeking", onSeeking);
    video.addEventListener("ratechange", onRateChange);
    return () => {
      video.pause();
      video.removeEventListener("play", onPlay);
      video.removeEventListener("playing", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("seeking", onSeeking);
      video.removeEventListener("ratechange", onRateChange);
      videoRef.current = null;
    };
  }, [mediaElement, pauseSidecars, playSidecars, syncSidecars, videoPath]);

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
    // Start sidecars in the same user-gesture turn as the video. Waiting for
    // the video's asynchronous `play` event can make WebView treat the WAV
    // calls as autoplay and reject them on the first press.
    const playRequest = video.play();
    playSidecars(video);
    void playRequest.catch((error) => {
      pauseSidecars();
      setPlaying(false);
      console.error("[Snap] Video playback failed:", error);
    });
  }, [duration, pauseSidecars, playSidecars, trimEnd, trimStart]);

  const seek = useCallback((time: number) => {
    const video = videoRef.current;
    const end = trimEnd || video?.duration || time;
    const clamped = Math.max(trimStart, Math.min(time, end));
    if (video) video.currentTime = clamped;
    if (video) syncSidecars(video, true);
    setCurrentTime(clamped);
  }, [syncSidecars, trimEnd, trimStart]);

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
