import { useCallback, useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { AudioMixConfig, AudioTrack } from "../../../lib/types";
import {
  clampPlaybackTime,
  isAtPlaybackBoundary,
  shouldRebuildForSeek,
  shouldRecoverStalledPlayback,
  shouldResyncSidecar,
} from "../../../lib/playbackTransport";

interface Options {
  videoPath: string;
  trimStart: number;
  trimEnd: number;
  duration: number;
  playbackRate: number;
  audioTracks: AudioTrack[];
  audioMix: AudioMixConfig;
}

export type TransportStatus = "idle" | "paused" | "starting" | "playing" | "buffering" | "seeking" | "recovering" | "failed";
const MEDIA_OPERATION_TIMEOUT_MS = 2_500;
const PLAY_PROGRESS_TIMEOUT_MS = 1_500;

/**
 * The video element is the sole editor clock. Every user action invalidates
 * older async media work, and only confirmed frame progress reports playing.
 */
export function usePlaybackController({ videoPath, trimStart, trimEnd, duration, playbackRate, audioTracks, audioMix }: Options) {
  const [currentTime, setCurrentTime] = useState(0);
  const [status, setStatusState] = useState<TransportStatus>("idle");
  const [mediaElement, setMediaElement] = useState<HTMLVideoElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioElementsRef = useRef(new Map<string, HTMLAudioElement>());
  const audioTracksRef = useRef(audioTracks);
  const audioMixRef = useRef(audioMix);
  const boundsRef = useRef({ start: trimStart, end: trimEnd || duration });
  const generationRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const wantsPlaybackRef = useRef(false);
  const statusRef = useRef<TransportStatus>("idle");
  const clockFrameRef = useRef(0);
  const recoveryTimerRef = useRef(0);
  const recoveryActiveRef = useRef(false);
  const lastProgressRef = useRef({ mediaTime: 0, wallTime: performance.now() });
  const recoverRef = useRef<(time: number) => void>(() => {});

  boundsRef.current = { start: trimStart, end: trimEnd || duration };
  audioTracksRef.current = audioTracks;
  audioMixRef.current = audioMix;

  const setStatus = useCallback((next: TransportStatus) => {
    statusRef.current = next;
    setStatusState(next);
  }, []);

  const trackIsMuted = useCallback((track: AudioTrack) => (
    track.muted || (track.kind === "microphone" ? audioMixRef.current.micMuted : audioMixRef.current.systemMuted)
  ), []);

  const applyAudioMix = useCallback(() => {
    for (const track of audioTracksRef.current) {
      const element = audioElementsRef.current.get(track.id);
      if (!element) continue;
      const channelVolume = track.kind === "microphone" ? audioMixRef.current.micVolume : audioMixRef.current.systemVolume;
      element.muted = trackIsMuted(track);
      element.volume = Math.max(0, Math.min(1, track.volume * channelVolume / 100));
    }
  }, [trackIsMuted]);

  const pauseSidecars = useCallback(() => {
    for (const element of audioElementsRef.current.values()) element.pause();
  }, []);

  const syncSidecars = useCallback((video: HTMLVideoElement, force = false) => {
    for (const element of audioElementsRef.current.values()) {
      if (element.readyState >= HTMLMediaElement.HAVE_METADATA
        && shouldResyncSidecar(element.currentTime, video.currentTime, force)) {
        try { element.currentTime = video.currentTime; } catch { /* sidecar source is changing */ }
      }
      element.playbackRate = video.playbackRate;
    }
  }, []);

  const playSidecars = useCallback((video: HTMLVideoElement, generation: number) => {
    applyAudioMix();
    syncSidecars(video, true);
    for (const track of audioTracksRef.current) {
      const element = audioElementsRef.current.get(track.id);
      if (!element || trackIsMuted(track)) continue;
      void element.play().catch((error) => {
        if (generation === generationRef.current && wantsPlaybackRef.current) {
          console.warn(`[Snap] ${track.label} preview playback failed:`, error);
        }
      });
    }
  }, [applyAudioMix, syncSidecars, trackIsMuted]);

  const primeSidecars = useCallback((video: HTMLVideoElement, generation: number) => {
    // Run inside the original click/space gesture so WebView2 unlocks each
    // independent WAV. They remain muted until the video confirms progress.
    for (const track of audioTracksRef.current) {
      const element = audioElementsRef.current.get(track.id);
      if (!element || trackIsMuted(track)) continue;
      try { element.currentTime = video.currentTime; } catch { /* metadata is loading */ }
      element.muted = true;
      void element.play().catch((error) => {
        if (generation === generationRef.current && wantsPlaybackRef.current) {
          console.warn(`[Snap] ${track.label} preview audio could not be primed:`, error);
        }
      });
    }
  }, [trackIsMuted]);

  const beginCommand = useCallback(() => {
    abortRef.current?.abort();
    window.clearTimeout(recoveryTimerRef.current);
    const controller = new AbortController();
    abortRef.current = controller;
    return { generation: ++generationRef.current, signal: controller.signal };
  }, []);

  const commandIsCurrent = useCallback((generation: number, signal: AbortSignal) => (
    !signal.aborted && generation === generationRef.current
  ), []);

  const waitForMedia = useCallback((
    video: HTMLVideoElement,
    signal: AbortSignal,
    events: Array<keyof HTMLMediaElementEventMap>,
    ready: () => boolean,
  ) => {
    if (ready()) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      let settled = false;
      let timer = 0;
      const finish = (value: boolean) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        events.forEach((event) => video.removeEventListener(event, onReady));
        video.removeEventListener("error", onError);
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      };
      const onReady = () => { if (ready()) finish(true); };
      const onError = () => finish(false);
      const onAbort = () => finish(false);
      events.forEach((event) => video.addEventListener(event, onReady));
      video.addEventListener("error", onError, { once: true });
      signal.addEventListener("abort", onAbort, { once: true });
      timer = window.setTimeout(() => finish(ready()), MEDIA_OPERATION_TIMEOUT_MS);
    });
  }, []);

  const waitForPresentedFrame = useCallback((
    video: HTMLVideoElement,
    signal: AbortSignal,
    accepts: (mediaTime: number) => boolean,
  ) => {
    if (typeof video.requestVideoFrameCallback !== "function") return Promise.resolve(true);
    return new Promise<boolean>((resolve) => {
      let settled = false;
      let callbackId: number | null = null;
      let timer = 0;
      const finish = (value: boolean) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        if (callbackId !== null) video.cancelVideoFrameCallback(callbackId);
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      };
      const requestNext = () => {
        callbackId = video.requestVideoFrameCallback((_now, metadata) => {
          callbackId = null;
          if (accepts(metadata.mediaTime)) finish(true);
          else if (!signal.aborted) requestNext();
        });
      };
      const onAbort = () => finish(false);
      signal.addEventListener("abort", onAbort, { once: true });
      timer = window.setTimeout(() => finish(false), MEDIA_OPERATION_TIMEOUT_MS);
      requestNext();
    });
  }, []);

  const seekMedia = useCallback(async (video: HTMLVideoElement, time: number, signal: AbortSignal) => {
    const target = Math.max(0, time);
    try { video.currentTime = target; } catch { return false; }
    const mediaReady = await waitForMedia(video, signal, ["seeked", "loadeddata", "canplay"], () => (
      video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
      && !video.seeking
      && Math.abs(video.currentTime - target) < .09
    ));
    if (!mediaReady || signal.aborted) return false;
    // A seek is not complete for this canvas-based editor until the target
    // frame has actually been presented. WebView2 can otherwise report
    // `seeked` while drawImage() still exposes the pre-seek texture.
    return waitForPresentedFrame(video, signal, (mediaTime) => Math.abs(mediaTime - target) < .18);
  }, [waitForMedia, waitForPresentedFrame]);

  const reloadMediaAt = useCallback(async (video: HTMLVideoElement, time: number, signal: AbortSignal) => {
    video.pause();
    pauseSidecars();
    video.load();
    const metadataReady = await waitForMedia(video, signal, ["loadedmetadata", "durationchange"], () => (
      video.readyState >= HTMLMediaElement.HAVE_METADATA
    ));
    if (!metadataReady || signal.aborted) return false;
    return seekMedia(video, time, signal);
  }, [pauseSidecars, seekMedia, waitForMedia]);

  const confirmPlay = useCallback((video: HTMLVideoElement, signal: AbortSignal, initialTime: number) => (
    waitForMedia(video, signal, ["playing", "timeupdate"], () => (
      !video.paused && !video.ended && video.currentTime > initialTime + .001
    ))
  ), [waitForMedia]);

  const requestPlay = useCallback(async (
    video: HTMLVideoElement,
    generation: number,
    signal: AbortSignal,
    allowRecovery: boolean,
  ) => {
    if (!commandIsCurrent(generation, signal) || !wantsPlaybackRef.current) return;
    setStatus("starting");
    const initialTime = video.currentTime;
    let playCall: Promise<void>;
    try {
      playCall = video.play();
    } catch (error) {
      console.error("[Snap] Video play call failed:", error);
      playCall = Promise.reject(error);
    }
    // Never await an unbounded WebView2 play promise. Actual playback must be
    // confirmed by media state or a media event before the UI shows Pause.
    const playFailure = new Promise<boolean>((resolve) => { void playCall.catch(() => resolve(false)); });
    const confirmed = await Promise.race([
      Promise.all([
        confirmPlay(video, signal, initialTime),
        waitForPresentedFrame(video, signal, (mediaTime) => mediaTime > initialTime + .001),
      ]).then((results) => results.every(Boolean)),
      playFailure,
      new Promise<boolean>((resolve) => window.setTimeout(() => resolve(false), PLAY_PROGRESS_TIMEOUT_MS)),
    ]);
    if (!commandIsCurrent(generation, signal) || !wantsPlaybackRef.current) return;
    if (!confirmed) {
      if (allowRecovery) recoverRef.current(video.currentTime);
      else {
        wantsPlaybackRef.current = false;
        video.pause();
        pauseSidecars();
        setStatus("failed");
      }
      return;
    }
    lastProgressRef.current = { mediaTime: video.currentTime, wallTime: performance.now() };
    setCurrentTime(video.currentTime);
    setStatus("playing");
    playSidecars(video, generation);
  }, [commandIsCurrent, confirmPlay, pauseSidecars, playSidecars, setStatus, waitForPresentedFrame]);

  const recover = useCallback((time: number) => {
    const video = videoRef.current;
    if (!video || recoveryActiveRef.current || !wantsPlaybackRef.current) return;
    recoveryActiveRef.current = true;
    const { generation, signal } = beginCommand();
    setStatus("recovering");
    void reloadMediaAt(video, time, signal).then((ready) => {
      recoveryActiveRef.current = false;
      if (!ready || !commandIsCurrent(generation, signal) || !wantsPlaybackRef.current) {
        if (commandIsCurrent(generation, signal) && wantsPlaybackRef.current) {
          wantsPlaybackRef.current = false;
          setStatus("failed");
        }
        return;
      }
      syncSidecars(video, true);
      void requestPlay(video, generation, signal, false);
    });
  }, [beginCommand, commandIsCurrent, reloadMediaAt, requestPlay, setStatus, syncSidecars]);
  recoverRef.current = recover;

  const scheduleRecovery = useCallback((video: HTMLVideoElement) => {
    window.clearTimeout(recoveryTimerRef.current);
    recoveryTimerRef.current = window.setTimeout(() => {
      if (wantsPlaybackRef.current && (video.paused || statusRef.current === "buffering")) {
        recoverRef.current(video.currentTime);
      }
    }, PLAY_PROGRESS_TIMEOUT_MS);
  }, []);

  const pause = useCallback(() => {
    beginCommand();
    wantsPlaybackRef.current = false;
    recoveryActiveRef.current = false;
    videoRef.current?.pause();
    pauseSidecars();
    setStatus("paused");
  }, [beginCommand, pauseSidecars, setStatus]);

  const start = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const { generation, signal } = beginCommand();
    wantsPlaybackRef.current = true;
    recoveryActiveRef.current = false;
    primeSidecars(video, generation);
    const { start: rangeStart, end: configuredEnd } = boundsRef.current;
    const rangeEnd = configuredEnd || video.duration || duration;
    const rebuild = isAtPlaybackBoundary(video.currentTime, video.ended, rangeStart, rangeEnd);
    const startAt = rebuild ? Math.max(0, rangeStart) : video.currentTime;
    setCurrentTime(startAt);
    if (rebuild) {
      setStatus("recovering");
      recoveryActiveRef.current = true;
      void reloadMediaAt(video, startAt, signal).then((ready) => {
        recoveryActiveRef.current = false;
        if (!ready || !commandIsCurrent(generation, signal) || !wantsPlaybackRef.current) return;
        syncSidecars(video, true);
        void requestPlay(video, generation, signal, false);
      });
      return;
    }
    void requestPlay(video, generation, signal, true);
  }, [beginCommand, commandIsCurrent, duration, primeSidecars, reloadMediaAt, requestPlay, setStatus, syncSidecars]);

  const toggle = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (wantsPlaybackRef.current || (!video.paused && !video.ended)) pause();
    else start();
  }, [pause, start]);

  const seek = useCallback((time: number) => {
    const video = videoRef.current;
    const end = boundsRef.current.end || video?.duration || duration || time;
    const clamped = clampPlaybackTime(time, boundsRef.current.start, end);
    const rebuildDecoder = !!video && shouldRebuildForSeek({
      currentTime: video.currentTime,
      targetTime: clamped,
      start: boundsRef.current.start,
      end,
      ended: video.ended,
    });
    const resumeAfterSeek = wantsPlaybackRef.current;
    const { generation, signal } = beginCommand();
    setStatus("seeking");
    if (video) {
      video.pause();
      pauseSidecars();
    }
    setCurrentTime(clamped);
    if (!video) return;
    const seekOperation = rebuildDecoder
      ? reloadMediaAt(video, clamped, signal)
      : seekMedia(video, clamped, signal);
    void seekOperation.then((ready) => {
      if (!commandIsCurrent(generation, signal)) return;
      if (!ready) {
        if (resumeAfterSeek) recoverRef.current(clamped);
        else setStatus("failed");
        return;
      }
      syncSidecars(video, true);
      if (resumeAfterSeek && wantsPlaybackRef.current) void requestPlay(video, generation, signal, true);
      else setStatus("paused");
    });
  }, [beginCommand, commandIsCurrent, duration, pauseSidecars, reloadMediaAt, requestPlay, seekMedia, setStatus, syncSidecars]);

  useEffect(() => {
    const elements = new Map<string, HTMLAudioElement>();
    for (const track of audioTracks) {
      const element = new Audio(convertFileSrc(track.path));
      element.preload = "auto";
      element.load();
      elements.set(track.id, element);
    }
    audioElementsRef.current = elements;
    applyAudioMix();
    const video = videoRef.current;
    if (video) syncSidecars(video, true);
    return () => {
      for (const element of elements.values()) {
        element.pause();
        element.removeAttribute("src");
        element.load();
      }
      if (audioElementsRef.current === elements) audioElementsRef.current = new Map();
    };
  }, [applyAudioMix, audioTracks, syncSidecars]);

  useEffect(() => {
    applyAudioMix();
    const video = videoRef.current;
    if (video && wantsPlaybackRef.current && !video.paused && !video.seeking) {
      playSidecars(video, generationRef.current);
    }
  }, [applyAudioMix, audioMix, playSidecars]);

  useEffect(() => {
    const video = mediaElement;
    if (!video) return;
    const rate = Math.max(0.5, Math.min(2, playbackRate || 1));
    video.defaultPlaybackRate = rate;
    video.playbackRate = rate;
    video.preservesPitch = true;
    for (const element of audioElementsRef.current.values()) {
      element.defaultPlaybackRate = rate;
      element.playbackRate = rate;
      element.preservesPitch = true;
    }
    syncSidecars(video, true);
  }, [mediaElement, playbackRate, syncSidecars]);

  useEffect(() => {
    const video = mediaElement;
    if (!video) return;
    videoRef.current = video;
    wantsPlaybackRef.current = false;
    setCurrentTime(video.currentTime || 0);
    setStatus("paused");
    lastProgressRef.current = { mediaTime: video.currentTime || 0, wallTime: performance.now() };

    const clock = () => {
      const mediaTime = video.currentTime;
      const now = performance.now();
      const last = lastProgressRef.current;
      if (Math.abs(mediaTime - last.mediaTime) >= .002) {
        lastProgressRef.current = { mediaTime, wallTime: now };
        setCurrentTime(mediaTime);
        if (wantsPlaybackRef.current && !video.paused && !video.seeking) setStatus("playing");
      } else if (shouldRecoverStalledPlayback({
        wantsPlayback: wantsPlaybackRef.current,
        paused: video.paused,
        seeking: video.seeking,
        stalledForMs: now - last.wallTime,
      })) {
        lastProgressRef.current.wallTime = now;
        recoverRef.current(mediaTime);
      }
      const end = boundsRef.current.end || video.duration || 0;
      if (wantsPlaybackRef.current && end > 0 && mediaTime >= end - .005) {
        wantsPlaybackRef.current = false;
        beginCommand();
        video.pause();
        pauseSidecars();
        setCurrentTime(end);
        setStatus("paused");
      } else if (wantsPlaybackRef.current) {
        syncSidecars(video);
      }
      clockFrameRef.current = requestAnimationFrame(clock);
    };

    const onPlaying = () => {
      if (!wantsPlaybackRef.current) { video.pause(); return; }
      lastProgressRef.current = { mediaTime: video.currentTime, wallTime: performance.now() };
      setStatus("playing");
      playSidecars(video, generationRef.current);
    };
    const onPause = () => {
      pauseSidecars();
      if (!wantsPlaybackRef.current || video.ended) setStatus("paused");
      else if (statusRef.current === "playing") {
        setStatus("buffering");
        scheduleRecovery(video);
      }
    };
    const onWaiting = () => {
      if (!wantsPlaybackRef.current) return;
      pauseSidecars();
      setStatus("buffering");
      scheduleRecovery(video);
    };
    const onSeeking = () => {
      pauseSidecars();
      if (wantsPlaybackRef.current) setStatus("seeking");
    };
    const onSeeked = () => {
      setCurrentTime(video.currentTime);
      syncSidecars(video, true);
    };
    const onEnded = () => {
      wantsPlaybackRef.current = false;
      beginCommand();
      pauseSidecars();
      setCurrentTime(video.currentTime);
      setStatus("paused");
    };
    const onError = () => {
      wantsPlaybackRef.current = false;
      pauseSidecars();
      setStatus("failed");
    };
    const onRateChange = () => syncSidecars(video, true);

    video.addEventListener("playing", onPlaying);
    video.addEventListener("pause", onPause);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("stalled", onWaiting);
    video.addEventListener("seeking", onSeeking);
    video.addEventListener("seeked", onSeeked);
    video.addEventListener("ended", onEnded);
    video.addEventListener("error", onError);
    video.addEventListener("ratechange", onRateChange);
    clockFrameRef.current = requestAnimationFrame(clock);
    return () => {
      abortRef.current?.abort();
      generationRef.current += 1;
      wantsPlaybackRef.current = false;
      recoveryActiveRef.current = false;
      window.clearTimeout(recoveryTimerRef.current);
      cancelAnimationFrame(clockFrameRef.current);
      video.pause();
      pauseSidecars();
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("stalled", onWaiting);
      video.removeEventListener("seeking", onSeeking);
      video.removeEventListener("seeked", onSeeked);
      video.removeEventListener("ended", onEnded);
      video.removeEventListener("error", onError);
      video.removeEventListener("ratechange", onRateChange);
      if (videoRef.current === video) videoRef.current = null;
    };
  }, [beginCommand, mediaElement, pauseSidecars, playSidecars, scheduleRecovery, setStatus, syncSidecars, videoPath]);

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

  return {
    currentTime,
    playing: status === "playing",
    playbackStatus: status,
    setMediaElement,
    togglePlay: toggle,
    pausePlayback: pause,
    seekTo: seek,
  };
}
