import { audioPosition, audioEnvelope, audioClipEnvelope } from "../../../lib/audioEditing";
import { useCallback, useEffect, useRef, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import type { AudioMixConfig, AudioTrack, VideoClip } from "../../../lib/types";
import { retainedClips, sequenceTime, sequenceClip, clipSpeed } from "../../../lib/videoEditing";
import {
  clampPlaybackTime,
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
  previewMuted?: boolean;
  previewVolume?: number;
  videoClips?: VideoClip[] | null;
  frameRate?: number;
}

export type TransportStatus = "idle" | "paused" | "starting" | "playing" | "buffering" | "seeking" | "recovering" | "failed";
const MEDIA_OPERATION_TIMEOUT_MS = 2_500;
const PLAY_PROGRESS_TIMEOUT_MS = 1_500;
const PLAYBACK_UI_INTERVAL_MS = 32;
const SIDECAR_SYNC_INTERVAL_MS = 50;

/**
 * The video element is the sole editor clock. Every user action invalidates
 * older async media work, and only confirmed frame progress reports playing.
 */
export function usePlaybackController({ videoPath, trimStart, trimEnd, duration, playbackRate, audioTracks, audioMix, previewMuted = false, previewVolume = 100, videoClips, frameRate = 30 }: Options) {
  const clipsRef = useRef<VideoClip[]>([]);
  clipsRef.current = retainedClips(videoClips, trimStart, trimEnd || duration);
  const gapClockRef = useRef({ time: 0, wall: performance.now() });
  const rateRef = useRef(playbackRate); rateRef.current = playbackRate;
  const activeIdRef = useRef("recording");
  const [activeClipId, setActiveClipId] = useState("recording");
  const [currentTime, setCurrentTime] = useState(0);
  const [status, setStatusState] = useState<TransportStatus>("idle");
  const [mediaElement, setMediaElement] = useState<HTMLVideoElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const audioElementsRef = useRef(new Map<string, HTMLAudioElement>());
  const audioContextRef = useRef<AudioContext | null>(null);
  const analysersRef = useRef(new Map<string, {node:AnalyserNode;data:Float32Array<ArrayBuffer>}>());
  const speechRef = useRef(0);
  const gainsRef=useRef(new Map<string,GainNode>());
  const [audioDurations,setAudioDurations]=useState<Record<string,number>>({});
  const audioSources = JSON.stringify(audioTracks.map(track => [track.id,track.path]));
  const audioTracksRef = useRef(audioTracks);
  const audioMixRef = useRef(audioMix);
  const previewMutedRef = useRef(previewMuted);
  const previewVolumeRef = useRef(previewVolume);
  const boundsRef = useRef({ start: trimStart, end: trimEnd || duration });
  const generationRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const wantsPlaybackRef = useRef(false);
  const statusRef = useRef<TransportStatus>("idle");
  const clockFrameRef = useRef(0);
  const recoveryTimerRef = useRef(0);
  const recoveryActiveRef = useRef(false);
  const lastProgressRef = useRef({ mediaTime: 0, wallTime: performance.now() });
  const lastUiUpdateRef = useRef(0);
  const lastSidecarSyncRef = useRef(0);
  const recoverRef = useRef<(time: number) => void>(() => {});

  boundsRef.current = { start: clipsRef.current[0]?.start ?? trimStart, end: clipsRef.current[clipsRef.current.length - 1]?.end ?? (trimEnd || duration) };
  audioTracksRef.current = audioTracks;
  audioMixRef.current = audioMix;
  previewMutedRef.current = previewMuted;
  previewVolumeRef.current = previewVolume;

  const setStatus = useCallback((next: TransportStatus) => {
    statusRef.current = next;
    setStatusState(next);
  }, []);

  const activeGap = useCallback(() => clipsRef.current.find(clip=>clip.id===activeIdRef.current)?.gap ?? false, []);
  const sourceClock = useCallback(() => activeGap() ? NaN : videoRef.current?.currentTime ?? 0, [activeGap]);
  const sequenceClock = useCallback(() => sequenceTime(clipsRef.current, activeGap() ? gapClockRef.current.time : videoRef.current?.currentTime ?? 0, activeIdRef.current), [activeGap]);

  const trackIsMuted = useCallback((track: AudioTrack) => (
    previewMutedRef.current
    || track.muted
    || (track.kind === "microphone" && audioMixRef.current.micMuted)
    || ((track.kind === "system" || track.kind === "device") && audioMixRef.current.systemMuted)
  ), []);

  const applyAudioMix = useCallback(() => {
    for (const track of audioTracksRef.current) {
      const element = audioElementsRef.current.get(track.id);
      if (!element) continue;
      const channelVolume = track.kind === "microphone"
        ? audioMixRef.current.micVolume
        : track.kind === "imported"
          ? 100
          : audioMixRef.current.systemVolume;
      const gain=gainsRef.current.get(track.id);
      const audible=statusRef.current==="playing"&&wantsPlaybackRef.current&&!!videoRef.current&&(activeGap()||!videoRef.current.paused&&!videoRef.current.seeking);
      element.muted = gain ? false : !audible || trackIsMuted(track);
      const position = audioPosition(track, sourceClock(), sequenceClock(), clipsRef.current);
      const volume = Math.max(0, Math.min(4, audioEnvelope(track, position.time, element.duration || Infinity) * audioClipEnvelope(position.clip,position.time) * (track.kind !== "microphone" ? 1 - (track.ducking ?? 0) / 100 * speechRef.current : 1) * channelVolume / 100 * previewVolumeRef.current / 100));
      if(gain&&audioContextRef.current){element.volume=1;gain.gain.setTargetAtTime(!audible||trackIsMuted(track)?0:volume,audioContextRef.current.currentTime,.02);}else element.volume=Math.min(1,volume);
    }
  }, [trackIsMuted,activeGap,sourceClock,sequenceClock]);

  const pauseSidecars = useCallback(() => {
    for (const element of audioElementsRef.current.values()) element.pause();
  }, []);

  const syncSidecars = useCallback((video: HTMLVideoElement, force = false) => {
    for (const track of audioTracksRef.current) {
      const element = audioElementsRef.current.get(track.id);
      if (!element) continue;
      const position = audioPosition(track, sourceClock(), sequenceClock(), clipsRef.current);
      if (!position.active || (Number.isFinite(element.duration)&&position.time>=element.duration)) { element.pause(); continue; }
      if (element.readyState >= HTMLMediaElement.HAVE_METADATA && shouldResyncSidecar(element.currentTime, position.time, force)) {
        try { element.currentTime = position.time; } catch { /* metadata changing */ }
      }
      element.playbackRate = (position.speed ?? (track.linked === false ? 1 : clipSpeed(clipsRef.current.find(c=>c.id===activeIdRef.current)??{id:"",start:0,end:0}))) * Math.max(.5,Math.min(2,rateRef.current || 1));
      element.preservesPitch = track.preservePitch ?? true;
      if(wantsPlaybackRef.current&&statusRef.current==="playing"&&(activeGap()||!video.paused&&!video.seeking)&&element.paused&&!trackIsMuted(track))void element.play().catch(()=>{});
    }
  }, [trackIsMuted,activeGap,sourceClock,sequenceClock]);

  const playSidecars = useCallback((video: HTMLVideoElement, generation: number) => {
    applyAudioMix();
    syncSidecars(video);
    for (const track of audioTracksRef.current) {
      const element = audioElementsRef.current.get(track.id);
      if (!element || trackIsMuted(track) || !element.paused || !audioPosition(track,sourceClock(),sequenceClock(),clipsRef.current).active || (Number.isFinite(element.duration)&&audioPosition(track,sourceClock(),sequenceClock(),clipsRef.current).time>=element.duration)) continue;
      void element.play().catch((error) => {
        if (generation === generationRef.current && wantsPlaybackRef.current) {
          console.warn(`[Snap] ${track.label} preview playback failed:`, error);
        }
      });
    }
  }, [applyAudioMix, syncSidecars, trackIsMuted,sourceClock,sequenceClock]);

  const primeSidecars = useCallback((video: HTMLVideoElement, generation: number, targetTime = video.currentTime) => {
    // Run inside the original click/space gesture so WebView2 unlocks each
    // independent WAV. They remain muted until the video confirms progress.
    for (const track of audioTracksRef.current) {
      const element = audioElementsRef.current.get(track.id);
      if (!element || trackIsMuted(track)) continue;
      element.pause();
      try { element.currentTime = audioPosition(track,targetTime,sequenceTime(clipsRef.current,targetTime,activeIdRef.current)).time; } catch { /* metadata is loading */ }
      element.muted = true;
      void element.play().catch((error) => {
        if (generation === generationRef.current && wantsPlaybackRef.current) {
          console.warn(`[Snap] ${track.label} preview audio could not be primed:`, error);
        }
      });
    }
  }, [trackIsMuted,activeGap,sourceClock,sequenceClock]);

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

  const seekMedia = useCallback(async (video: HTMLVideoElement, time: number, signal: AbortSignal) => {
    const target = Math.max(0, time);
    if (signal.aborted) return false;
    if (!video.seeking && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && Math.abs(video.currentTime - target) < .001) return true;
    try { video.currentTime = target; } catch { return false; }
    const mediaReady = await waitForMedia(video, signal, ["seeked", "loadeddata", "canplay"], () => (
      video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
      && !video.seeking
      && Math.abs(video.currentTime - target) < .09
    ));
    if (!mediaReady || signal.aborted) return false;
    // seeked already makes the decoded frame available to drawImage. Waiting
    // for a *new* presentation callback here deadlocks paused/hidden video.
    return true;
  }, [waitForMedia]);

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
      !video.paused && !video.ended && (video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA || video.currentTime > initialTime + .001)
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
    const rate = Math.max(0.5, Math.min(2, playbackRate || 1)) * clipSpeed(clipsRef.current.find(c=>c.id===activeIdRef.current)??{id:"",start:0,end:0});
    video.defaultPlaybackRate = rate;
    video.playbackRate = rate;
    const initialTime = video.currentTime;
    lastProgressRef.current = { mediaTime: initialTime, wallTime: performance.now() };
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
      confirmPlay(video, signal, initialTime),
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
  }, [commandIsCurrent, confirmPlay, pauseSidecars, playSidecars, playbackRate, setStatus]);

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
    if (!video || !clipsRef.current.length) return;
    void audioContextRef.current?.resume();
    const { generation, signal } = beginCommand();
    wantsPlaybackRef.current = true;
    recoveryActiveRef.current = false;
    const current = clipsRef.current.find(c => c.id === activeIdRef.current) ?? clipsRef.current[0];
    if (current?.gap && gapClockRef.current.time < current.end) { gapClockRef.current.wall=performance.now(); setStatus("playing"); syncSidecars(video,true); playSidecars(video,generation); return; }
    const startAt = current ? Math.max(current.start, Math.min(current.end, video.currentTime)) : 0;
    const restart = !current || video.ended || (video.currentTime >= current.end - .005 && current.id === clipsRef.current[clipsRef.current.length - 1]?.id);
    if (restart && clipsRef.current.length) { activeIdRef.current = clipsRef.current[0].id; setActiveClipId(activeIdRef.current); }
    const targetStart = restart ? clipsRef.current[0]?.start ?? 0 : startAt;
    if(clipsRef.current.find(clip=>clip.id===activeIdRef.current)?.gap){gapClockRef.current={time:targetStart,wall:performance.now()};setCurrentTime(targetStart);setStatus("playing");syncSidecars(video,true);playSidecars(video,generation);return;}
    // Rewind ended WAV sidecars before priming them. Priming at their old end
    // made replay start with stale/absent audio while captions restarted.
    primeSidecars(video, generation, targetStart);
    setCurrentTime(targetStart);
    if (restart || Math.abs(targetStart - video.currentTime) > .001) {
      setStatus("recovering");
      recoveryActiveRef.current = true;
      void seekMedia(video, targetStart, signal).then((ready) => {
        recoveryActiveRef.current = false;
        if (!ready || !commandIsCurrent(generation, signal) || !wantsPlaybackRef.current) return;
        syncSidecars(video, true);
        void requestPlay(video, generation, signal, false);
      });
      return;
    }
    void requestPlay(video, generation, signal, true);
  }, [beginCommand, commandIsCurrent, duration, primeSidecars, seekMedia, requestPlay, setStatus, syncSidecars,playSidecars]);

  const toggle = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (wantsPlaybackRef.current || (!video.paused && !video.ended)) pause();
    else start();
  }, [pause, start]);

  const seek = useCallback((time: number, clipId?: string) => {
    const video = videoRef.current;
    const end = boundsRef.current.end || video?.duration || duration || time;
    const selected = clipsRef.current.find(c => c.id === clipId)
      ?? clipsRef.current.find(c => c.id === activeIdRef.current && time >= c.start && time <= c.end)
      ?? clipsRef.current.find(c => time >= c.start && time < c.end)
      ?? clipsRef.current[0];
    if (selected) { activeIdRef.current = selected.id; setActiveClipId(selected.id); }
    const clamped = clampPlaybackTime(time, selected?.start ?? 0, selected?.end ?? end);
    const resumeAfterSeek = wantsPlaybackRef.current;
    const { generation, signal } = beginCommand();
    setStatus("seeking");
    if (video) {
      video.pause();
      pauseSidecars();
    }
    setCurrentTime(clamped);
    if (selected?.gap) { gapClockRef.current={time:clamped,wall:performance.now()}; setStatus(resumeAfterSeek?"playing":"paused"); if(video){syncSidecars(video,true);if(resumeAfterSeek)playSidecars(video,generation);} return; }
    if (!video) return;
    const seekOperation = seekMedia(video, clamped, signal);
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
  }, [beginCommand, commandIsCurrent, duration, pauseSidecars, requestPlay, seekMedia, setStatus, syncSidecars,playSidecars]);

  const previousClipsRef=useRef<VideoClip[]>([]);
  useEffect(()=>{
    const previous=previousClipsRef.current;previousClipsRef.current=clipsRef.current;
    if(!previous.length||!clipsRef.current.length)return;
    const time=previous.find(clip=>clip.id===activeIdRef.current)?.gap?gapClockRef.current.time:videoRef.current?.currentTime??currentTime;
    const current=clipsRef.current.find(clip=>clip.id===activeIdRef.current);
    if(current&&time>=current.start&&time<=current.end){if(videoRef.current&&!current.gap)videoRef.current.playbackRate=Math.max(.5,Math.min(2,rateRef.current||1))*clipSpeed(current);return;}
    const position=sequenceTime(previous,time,activeIdRef.current),target=sequenceClip(clipsRef.current,position);
    if(target)seek(target.source,target.clip.id);
  },[videoClips,trimStart,trimEnd,duration,seek]);

  useEffect(() => {
    const elements = new Map<string, HTMLAudioElement>();
    const metadataHandlers=new Map<string,()=>void>();
    setAudioDurations({});
    for (const track of audioTracks) {
      const element = new Audio(); element.crossOrigin="anonymous"; element.src=convertFileSrc(track.path);
      const metadata=()=>{if(Number.isFinite(element.duration))setAudioDurations(current=>({...current,[track.id]:element.duration}));};
      metadataHandlers.set(track.id,metadata);element.addEventListener("loadedmetadata",metadata);
      element.preload = "auto";
      element.load();
      elements.set(track.id, element);
    }
    audioElementsRef.current = elements;
    try {
      const context = elements.size ? new AudioContext() : null; audioContextRef.current = context;
      if(context)for (const [id,element] of elements) { const source=context.createMediaElementSource(element); const gain=context.createGain();gain.gain.value=0;gainsRef.current.set(id,gain); const node=context.createAnalyser(); node.fftSize=256; source.connect(gain);gain.connect(node); node.connect(context.destination); analysersRef.current.set(id,{node,data:new Float32Array(node.fftSize)}); }
    } catch { /* Playback remains available when Web Audio is unavailable. */ }
    applyAudioMix();
    const video = videoRef.current;
    if (video) syncSidecars(video, true);
    return () => {
      for (const [id,element] of elements) {
        const handler=metadataHandlers.get(id);if(handler)element.removeEventListener("loadedmetadata",handler);
        element.pause();
        element.removeAttribute("src");
        element.load();
      }
      if (audioElementsRef.current === elements) audioElementsRef.current = new Map();
      analysersRef.current.clear(); gainsRef.current.clear(); void audioContextRef.current?.close(); audioContextRef.current=null;
    };
  }, [applyAudioMix, audioSources, syncSidecars]);

  useEffect(() => {
    const video = mediaElement ?? videoRef.current;
    if (mediaElement) videoRef.current = mediaElement;
    if (!video || !clipsRef.current.length) return;
    const clip = clipsRef.current.find(c => c.id === activeIdRef.current) ?? clipsRef.current[0];
    const target = Math.max(clip.start, Math.min(clip.end, video.currentTime));
    if (activeIdRef.current !== clip.id || Math.abs(target - video.currentTime) > .001) seek(target, clip.id);
  }, [videoClips, trimStart, trimEnd, duration, mediaElement, seek]);

  useEffect(() => {
    applyAudioMix();
    const video = videoRef.current;
    if (video && wantsPlaybackRef.current && !video.paused && !video.seeking) {
      playSidecars(video, generationRef.current);
    }
  }, [applyAudioMix, audioMix, playSidecars, previewMuted, previewVolume]);

  useEffect(() => {
    const video = mediaElement;
    if (!video) return;
    const rate = Math.max(0.5, Math.min(2, playbackRate || 1)) * clipSpeed(clipsRef.current.find(c=>c.id===activeIdRef.current)??{id:"",start:0,end:0});
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
    const mountedAt = performance.now();
    lastProgressRef.current = { mediaTime: video.currentTime || 0, wallTime: mountedAt };
    lastUiUpdateRef.current = mountedAt;
    lastSidecarSyncRef.current = mountedAt;

    const clock = () => {
      const now = performance.now();
      if (activeGap() && wantsPlaybackRef.current) gapClockRef.current.time += (now-gapClockRef.current.wall)/1000 * Math.max(.5,Math.min(2,rateRef.current || 1));
      gapClockRef.current.wall=now;
      const mediaTime = activeGap() ? gapClockRef.current.time : video.currentTime;
      const index = clipsRef.current.findIndex(c => c.id === activeIdRef.current);
      const clip = clipsRef.current[index];
      const next = clipsRef.current[index + 1];
      if (wantsPlaybackRef.current && (activeGap()||!video.seeking) && clip && mediaTime >= clip.end - .001 && next) {
        seek(next.start, next.id);
        clockFrameRef.current = requestAnimationFrame(clock);
        return;
      }
      const last = lastProgressRef.current;
      if (Math.abs(mediaTime - last.mediaTime) >= .002) {
        lastProgressRef.current = { mediaTime, wallTime: now };
        if (now - lastUiUpdateRef.current >= PLAYBACK_UI_INTERVAL_MS) {
          lastUiUpdateRef.current = now;
          setCurrentTime(mediaTime);
        }
        if (wantsPlaybackRef.current && (activeGap()||!video.paused&&!video.seeking)) setStatus("playing");
      } else if (shouldRecoverStalledPlayback({
        wantsPlayback: wantsPlaybackRef.current,
        paused: video.paused,
        seeking: video.seeking,
        stalledForMs: now - last.wallTime,
      })) {
        lastProgressRef.current.wallTime = now;
        recoverRef.current(mediaTime);
      }
      const end = clip?.end ?? video.duration ?? 0;
      if (wantsPlaybackRef.current && !next && end > 0 && mediaTime >= end - .005) {
        wantsPlaybackRef.current = false;
        beginCommand();
        video.pause();
        pauseSidecars();
        setCurrentTime(end);
        setStatus("paused");
      } else if (wantsPlaybackRef.current && now - lastSidecarSyncRef.current >= SIDECAR_SYNC_INTERVAL_MS) {
        lastSidecarSyncRef.current = now;
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
      if(activeGap()) return;
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
      if(activeGap())return;
      setCurrentTime(video.currentTime);
      syncSidecars(video, true);
    };
    const onEnded = () => {
      if(activeGap() || clipsRef.current.findIndex(c=>c.id===activeIdRef.current)<clipsRef.current.length-1)return;
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
  }, [beginCommand, mediaElement, pauseSidecars, playSidecars, scheduleRecovery, setStatus, syncSidecars, videoPath, seek]);

  useEffect(() => {
    const timer=window.setInterval(()=>{
      let speech=0;
      for (const [id,{node,data}] of analysersRef.current) {
        const track=audioTracksRef.current.find(t=>t.id===id);
        if(track?.kind!=="microphone" || track.muted)continue;
        node.getFloatTimeDomainData(data);
        const rms=Math.sqrt(data.reduce((sum,n)=>sum+n*n,0)/data.length);
        speech=Math.max(speech,Math.min(1,rms/.025));
      }
      speechRef.current=speechRef.current*.7+speech*.3;
      applyAudioMix();
    },100);
    return ()=>window.clearInterval(timer);
  },[applyAudioMix]);

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.code === "ArrowLeft" || event.code === "ArrowRight") && !event.ctrlKey && !event.metaKey && !event.altKey && !(event.target instanceof HTMLElement && event.target.closest('input,textarea,select,button,[contenteditable],[role="listbox"],[role="option"],[role="slider"]'))) { event.preventDefault(); pause(); const target=sequenceClip(clipsRef.current,Math.max(0,sequenceClock()+(event.code === "ArrowLeft"?-1:1)*(event.shiftKey?10:1)/Math.max(1,frameRate))); if(target)seek(target.source,target.clip.id); return; }
      if (event.code !== "Space" || event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || !!target.closest("input, textarea, select, button, [role='textbox'], [role='slider']"))) return;
      event.preventDefault();
      toggle();
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [toggle,pause,seek,frameRate,sequenceClock]);

  return {
    currentTime,
    audioDurations,
    activeClipId,
    inGap: !clipsRef.current.length || activeGap(),
    sequencePosition: sequenceTime(clipsRef.current, currentTime, activeClipId),
    seekSequence: (time: number) => { const target = sequenceClip(clipsRef.current, time); if (target) seek(target.source, target.clip.id); },
    playing: status === "playing",
    playbackStatus: status,
    setMediaElement,
    togglePlay: toggle,
    pausePlayback: pause,
    seekTo: seek,
  };
}
