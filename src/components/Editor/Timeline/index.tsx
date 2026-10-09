import { mediaLayerName, splitMediaLayer } from "../../../lib/mediaTimeline";
import { TRANSITION_EFFECTS } from "../../../lib/transitions";
import { SelectRow } from "../Panels/PanelControls";
import type { ScreenTiltKey } from "../../../lib/screenTilt";
import { copyKeys, retimeKeys, pasteKeys } from "../../../lib/keyframeEditing";
import { snapshotClipEffects } from "../../../lib/clipEffects";
import { resolvedAudioClips, splitAudioClip, duplicateAudioClip, editAudioClip } from "../../../lib/audioEditing";
import { useRef, useCallback, useState, useEffect, useMemo, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { Plus, Circle, Layers, PanelLeft, MoveRight, Scissors, MousePointer2, Magnet, RectangleHorizontal, Crop, SkipBack, SkipForward, Play, Pause, ChevronDown, ChevronUp, BookmarkPlus, ZoomIn, ZoomOut, Film, Undo2, Redo2, Copy, Trash2, SlidersHorizontal, Volume2, VolumeX, RotateCcw, LoaderCircle, Music2, Clock3, Sparkles, Captions, Type, Shapes, ScanSearch, Image as ImageIcon, Keyboard, Lock, LockOpen, Combine, ArrowLeftRight, X, GripVertical, StepBack, StepForward, BetweenHorizontalStart, Diamond, Box } from "lucide-react";
import { retainedClips, splitClip, sequenceDuration, sequenceTime, sourceTime, frameDuration, clipDuration, clipSpeed } from "../../../lib/videoEditing";
import type { VideoClip, LayerAnimationKey, AudioClip } from "../../../lib/types";
import type { TransportStatus } from "../hooks/usePlaybackController";
import type { ActionEventEdit, AudioTrack, CaptionSegment, CaptionSegmentSelection, CaptionTrack, Keyframe, EditorConfig, ZoomRegionSelection, Layer } from "../../../lib/types";
import { ASPECT_RATIOS } from "../../../lib/types";
import { collectZoomRegions } from "../../../lib/zoomRegions";
import { timelineHeightBounds, timelineInspectorLayout } from "../../../lib/timelineLayout";
import { loadInputLog } from "../../../lib/inputLog";
import { buildDisplayActions, resolveDisplayActions, type DisplayAction, type ResolvedDisplayAction } from "../../../lib/actionOverlay";
import "./Timeline.css";
import { moveClips, duplicateClips, combineClips, deleteClips, changeClipSpeed, placeClip, trimClipRange } from "../../../lib/clipOperations";
import { sequenceClip } from "../../../lib/videoEditing";
import TrimPreview from "./TrimPreview";

interface Props {
  editorTheme: "dark" | "light";
  inputLogPath: string;
  audioTracks: AudioTrack[];
  duration: number;
  currentTime: number;
  keyframes: Keyframe[];
  config: EditorConfig;
  playing: boolean;
  playbackStatus: TransportStatus;
  onTogglePlay: () => void;
  onSeek: (t: number, clipId?: string) => void;
  activeClipId?: string;
  frameRate?: number;
  audioDurations?:Record<string,number>;
  videoPath?: string;
  onTrackLocksChange?: (tracks: string[]) => void;
  onAnimationKeyChange?: (kind:"tilt"|"camera"|"layer", id:string, time:number, nextTime:number|null, clipId?:string) => void;
  onAnimationKeysChange?: (kind:"tilt"|"camera"|"layer", id:string, keys:(LayerAnimationKey|ScreenTiltKey)[], clipId?:string) => void;
  onTrackClear?: (kind: "video" | "zoom" | "action" | "caption" | "layer", id?: string) => void;
  onTrimStartChange: (t: number) => void;
  onTrimEndChange: (t: number) => void;
  onCutsChange: (cuts: number[]) => void;
  onVideoClipsChange: (clips: VideoClip[] | null) => void;
  onAspectChange: (ar: { width: number; height: number } | null) => void;
  onToggleCrop: () => void;
  cropActive: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onKeyframesChange: (keyframes: Keyframe[], clipId?: string) => void;
  onAudioMuteChange: (track: "system" | "mic", muted: boolean) => void;
  onAddAudio: () => void;
  onLayerSplit?: (layer:Layer, parts:Layer[]) => void;
  onMediaDrop: (paths: string[], atTime: number) => void;
  onAddCaptionAtTime: (time: number) => void;
  onAudioTrackChange: (track: AudioTrack) => void;
  onAudioTrackRemove: (trackId: string) => void;
  onPlaybackRateChange: (rate: number) => void;
  selectedActionId: string | null;
  onActionSelect: (id: string) => void;
  onActionEdit: (id: string, patch: ActionEventEdit) => void;
  selectedZoomRegion: ZoomRegionSelection | null;
  onZoomRegionSelect: (region: ZoomRegionSelection) => void;
  onZoomRegionDuplicate: (region: ZoomRegionSelection) => void;
  onZoomRegionDelete: (region: ZoomRegionSelection) => void;
  layers: Layer[];
  selectedLayerId: string | null;
  onLayerSelect: (id: string) => void;
  onLayerChange: (layer: Layer) => void;
  onLayerDuplicate: (id: string) => void;
  onLayerDelete: (id: string) => void;
  captionTracks: CaptionTrack[];
  selectedCaption: CaptionSegmentSelection | null;
  onCaptionSegmentSelect: (selection: CaptionSegmentSelection) => void;
  onCaptionSegmentChange: (trackId: string, segment: CaptionSegment, clipId?: string) => void;
  onCaptionSegmentDuplicate: (trackId: string, segmentId: string) => void;
  onCaptionSegmentDelete: (trackId: string, segmentId: string) => void;
}

interface ZoomSegment {
  start: number;
  end: number;
  scale: number;
  firstIndex: number;
  lastZoomIndex: number;
  resetIndex: number | null;
  memberIndices: number[];
  source: "auto" | "manual";
  regionId?: string;
}

export default function Timeline({
  editorTheme,
  inputLogPath,
  audioTracks,
  duration,
  currentTime,
  keyframes,
  config,
  playing,
  playbackStatus,
  onTogglePlay,
  onSeek,
  activeClipId,
  frameRate=30,
  audioDurations={},
  videoPath,
  onTrackLocksChange,
  onTrackClear,
  onAnimationKeyChange,
  onAnimationKeysChange,
  onTrimStartChange,
  onTrimEndChange,
  onCutsChange,
  onVideoClipsChange,
  onAspectChange,
  onToggleCrop,
  cropActive,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onKeyframesChange,
  onAudioMuteChange,
  onAddAudio,
  onMediaDrop, onLayerSplit,
  onAddCaptionAtTime,
  onAudioTrackChange,
  onAudioTrackRemove,
  onPlaybackRateChange,
  selectedActionId,
  onActionSelect,
  onActionEdit,
  selectedZoomRegion,
  onZoomRegionSelect,
  onZoomRegionDuplicate,
  onZoomRegionDelete,
  layers,
  selectedLayerId,
  onLayerSelect,
  onLayerChange,
  onLayerDuplicate,
  onLayerDelete,
  captionTracks,
  selectedCaption,
  onCaptionSegmentSelect,
  onCaptionSegmentChange,
  onCaptionSegmentDuplicate,
  onCaptionSegmentDelete,
}: Props) {
  const [editTool, setEditTool] = useState<"select" | "razor">("select");
  const [timeView, setTimeView] = useState<"sequence" | "source">("sequence");
  const [cutGuide,setCutGuide]=useState<{id:string;time:number;left:number}|null>(null);
  useEffect(()=>{setCutGuide(null);if(editTool==="razor")setTimeView("sequence");},[editTool]);
  const [snapping, setSnapping] = useState(true);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const timelineRootRef=useRef<HTMLDivElement>(null);
  const [inspectorLayout,setInspectorLayout]=useState<ReturnType<typeof timelineInspectorLayout>>({maxHeight:620});
  useLayoutEffect(()=>{
    if(!inspectorOpen)return;
    const place=()=>setInspectorLayout(timelineInspectorLayout(timelineRootRef.current?.getBoundingClientRect().top??NaN,window.innerHeight));
    place();window.addEventListener("resize",place);
    const observer=new ResizeObserver(place);if(timelineRootRef.current)observer.observe(timelineRootRef.current);
    return ()=>{window.removeEventListener("resize",place);observer.disconnect();};
  },[inspectorOpen]);
  const [dragPreview, setDragPreview] = useState<{x:number;y:number;ids:string[];destination:number;position?:number;valid?:boolean} | null>(null);
  const [reorderIndex, setReorderIndex] = useState<number | null>(null);
  const suppressClipClick = useRef(false);
  const suppressKeyClick = useRef(false);
  useEffect(() => {
    if (!inspectorOpen) return;
    const close = (event: PointerEvent) => {
      if (!(event.target as HTMLElement).closest?.('.timeline-clip-inspector, .timeline-inspector-toggle')) setInspectorOpen(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') setInspectorOpen(false); };
    window.addEventListener('pointerdown', close); window.addEventListener('keydown', escape);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', escape); };
  }, [inspectorOpen]);
  const [selectedClipIds, setSelectedClipIds] = useState<string[]>([]);
  const [trimPreview, setTrimPreview] = useState<{ left: number; right: number } | null>(null);
  const videoLocked = config.lockedTracks?.includes("video") ?? false;
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [selectedAudio,setSelectedAudio]=useState<{trackId:string;clipId:string}|null>(null);
  const selectedAudioTrack=audioTracks.find(track=>track.id===selectedAudio?.trackId);
  const [rippleEdits,setRippleEdits]=useState(false);
  const [clipNotice,setClipNotice]=useState("");
  const [trimDraft, setTrimDraft] = useState<VideoClip[] | null>(null);
  const clips = useMemo(() => retainedClips(config.videoClips, config.trimStart, config.trimEnd || duration), [config.videoClips, config.trimStart, config.trimEnd, duration]);
  const selectedClip = clips.find(c => c.id === selectedClipId);
  const selectedMedia = !selectedClipId && !selectedAudio ? layers.find(layer=>layer.id===selectedLayerId) : undefined;
  const timelineDuration = timeView === "sequence" ? sequenceDuration(clips) : duration;
  const splitAt = useCallback((time: number) => {
    if(selectedMedia && onLayerSplit){if(!config.lockedTracks?.includes("annotations")){const parts=splitMediaLayer(selectedMedia,selectedMedia.timeSpace === "sequence"?sequenceTime(clips,time,activeClipId):time,frameRate);if(parts.length>1)onLayerSplit(selectedMedia,parts);}return;}
    if(selectedAudio){const track=audioTracks.find(t=>t.id===selectedAudio.trackId);if(track&&!config.lockedTracks?.includes(track.id))onAudioTrackChange(splitAudioClip(track,clips,audioDurations[track.id]??duration,selectedAudio.clipId,sequenceTime(clips,time,activeClipId),frameRate));return;}
    if (videoLocked) return;
    const next = splitClip(clips, Math.round(time * frameRate) / frameRate, activeClipId ?? selectedClipId ?? undefined, frameRate);
    if (next.length !== clips.length) onVideoClipsChange(next);
  }, [clips, onVideoClipsChange, activeClipId, selectedClipId, videoLocked, frameRate, selectedAudio, audioTracks, audioDurations,config.lockedTracks,onAudioTrackChange,duration,selectedMedia,onLayerSplit]);
  const deleteClip = useCallback((ripple = false) => {
    if(selectedMedia){if(!config.lockedTracks?.includes("annotations"))onLayerDelete(selectedMedia.id);return;}
    if(selectedAudio){const track=audioTracks.find(t=>t.id===selectedAudio.trackId);if(track&&!config.lockedTracks?.includes(track.id))onAudioTrackChange({...track,clips:resolvedAudioClips(track,clips,audioDurations[track.id]??duration).filter(clip=>clip.id!==selectedAudio.clipId)});setSelectedAudio(null);return;}
    const selected = selectedClipIds.length ? selectedClipIds : selectedClip ? [selectedClip.id] : [];
    if (videoLocked || !selected.length) return;
    onVideoClipsChange(deleteClips(clips,selected,ripple));
    setSelectedClipIds([]);
    setSelectedClipId(null);
  }, [clips, selectedClip, selectedClipIds, onVideoClipsChange, videoLocked,selectedAudio,audioTracks,audioDurations,config.lockedTracks,onAudioTrackChange,duration,selectedMedia,onLayerDelete]);
  const [thumbnailStrip,setThumbnailStrip]=useState<string|null>(null);
  useEffect(()=>{let cancelled=false;setThumbnailStrip(null);if(videoPath)void invoke<string>("editor_cached_media",{path:videoPath,kind:"thumbnails"}).then(path=>{if(!cancelled)setThumbnailStrip(convertFileSrc(path));}).catch(()=>{});return ()=>{cancelled=true;};},[videoPath]);
  const [actionEvents, setActionEvents] = useState<DisplayAction[]>([]);
  useEffect(() => {
    let cancelled = false;
    if (!inputLogPath || !config.actionOverlay.enabled) { setActionEvents([]); return; }
    void loadInputLog(inputLogPath).then((log) => { if (!cancelled) setActionEvents(buildDisplayActions(log.allEvents)); }).catch(() => { if (!cancelled) setActionEvents([]); });
    return () => { cancelled = true; };
  }, [config.actionOverlay.enabled, inputLogPath]);
  const resolvedActionEvents = useMemo(
    () => resolveDisplayActions(actionEvents, config.actionOverlay),
    [actionEvents, config.actionOverlay],
  );
  const [dragging, setDragging] = useState<"playhead" | "trim-start" | "trim-end" | null>(null);
  const [zoomScale, setZoomScale] = useState(1);
  const [showAspectMenu, setShowAspectMenu] = useState(false);
  const [aspectMenuPosition, setAspectMenuPosition] = useState({ x: 8, y: 8 });
  const [waveforms, setWaveforms] = useState<Record<string, number[] | undefined>>({});

  const [waveformErrors, setWaveformErrors] = useState<Set<string>>(() => new Set());
  const [contentWidth, setContentWidth] = useState(600);
  const [timelineHeight, setTimelineHeight] = useState(240);
  const [mediaDragOver, setMediaDragOver] = useState(false);
  const [mediaDropTime,setMediaDropTime]=useState(0);
  const [contextMenu, setContextMenu] = useState<
    | { kind:"animation-key";x:number;y:number;animationKind:"tilt"|"camera"|"layer";id:string;time:number;sourceTime:number;clipId?:string;label:string }
    | { kind: "track"; x:number; y:number; label:string; lockId:string; trackKind:"video"|"zoom"|"action"|"caption"|"layer"; id?:string }
    | { kind: "zoom"; x: number; y: number; region: ZoomRegionSelection }
    | { kind: "layer"; x: number; y: number; layer: Layer }
    | { kind: "caption"; x: number; y: number; trackId: string; segment: CaptionSegment; clipId?: string }
    | { kind: "audio"; x: number; y: number; track: AudioTrack; muted: boolean; label: string; clipId?: string }
    | { kind: "clip"; x: number; y: number }
    | { kind: "action"; x: number; y: number; action: ResolvedDisplayAction }
    | null
  >(null);

  const dragCleanupRef = useRef<(() => void) | null>(null);
  const timeAreaRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);
  const aspectButtonRef = useRef<HTMLButtonElement>(null);
  const aspectMenuRef = useRef<HTMLDivElement>(null);

  // Clean up drag listeners on unmount
  useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
    };
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") close(); };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", closeOnEscape);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!showAspectMenu) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!aspectButtonRef.current?.contains(target) && !aspectMenuRef.current?.contains(target)) setShowAspectMenu(false);
    };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setShowAspectMenu(false); };
    const closeOnResize = () => setShowAspectMenu(false);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", escape);
    window.addEventListener("resize", closeOnResize);
    return () => { window.removeEventListener("pointerdown", close); window.removeEventListener("keydown", escape); window.removeEventListener("resize", closeOnResize); };
  }, [showAspectMenu]);

  useEffect(() => {
    if (!contextMenu) return;
    requestAnimationFrame(() => contextMenuRef.current?.querySelector<HTMLButtonElement>("button")?.focus());
  }, [contextMenu]);

  useLayoutEffect(() => {
    const menu = contextMenuRef.current;
    if (!contextMenu || !menu) return;
    const frame = requestAnimationFrame(() => {
      const padding = 10;
      menu.style.maxHeight = `${Math.max(180, window.innerHeight - padding * 2)}px`;
      const rect = menu.getBoundingClientRect();
      const left = Math.max(padding, Math.min(contextMenu.x, window.innerWidth - rect.width - padding));
      const top = Math.max(padding, Math.min(contextMenu.y, window.innerHeight - rect.height - padding));
      menu.style.left = `${left}px`;
      menu.style.top = `${top}px`;
      menu.dataset.opensUpward = top < contextMenu.y ? "true" : "false";
    });
    return () => cancelAnimationFrame(frame);
  }, [contextMenu]);
  const deviceTrack = audioTracks.find((track) => track.kind === "device");
  const systemTrack = deviceTrack ?? audioTracks.find((track) => track.kind === "system");
  const micTrack = audioTracks.find((track) => track.kind === "microphone");
  const importedTracks = audioTracks.filter((track) => track.kind === "imported");
  const timelineAudioTracks = [
    ...(systemTrack ? [systemTrack] : []),
    ...(micTrack ? [micTrack] : []),
    ...importedTracks,
  ];
  // Quantize bucket counts so resizing the panel does not launch a new native
  // WAV scan for every pixel. The canvas stretches cached data between steps.
  const waveformBuckets = Math.max(64, Math.min(2000, Math.round(contentWidth * zoomScale / 192) * 64));

  // Build RMS waveforms from the same validated tracks used by playback,
  // captions, project persistence, and export.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const results = await Promise.allSettled(
        timelineAudioTracks.map((track) => loadWaveformWithRetry(track.path, waveformBuckets)),
      );
      if (cancelled) return;
      setWaveforms(Object.fromEntries(timelineAudioTracks.map((track, index) => [
        track.id,
        results[index]?.status === "fulfilled" ? results[index].value : undefined,
      ])));
      setWaveformErrors(new Set(timelineAudioTracks.flatMap((track, index) => results[index]?.status === "rejected" ? [track.id] : [])));
    })();
    return () => { cancelled = true; };
  }, [audioTracks, waveformBuckets]);

  // Measure before paint and keep the fit-to-width scale current.
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => { if (el.clientWidth > 0) setContentWidth(el.clientWidth); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const effectiveWidth = Math.max(1, contentWidth * zoomScale);

  const getZoomSegments = (frames:Keyframe[]) => collectZoomRegions(frames, Math.round((config.trimEnd || duration) * 1000)).map((region): ZoomSegment => ({
      start: region.startMs / 1000,
      end: region.endMs / 1000,
      scale: region.scale,
      firstIndex: region.zoomIndices[0],
      lastZoomIndex: region.zoomIndices[region.zoomIndices.length - 1],
      resetIndex: region.resetIndex,
      memberIndices: region.memberIndices,
      source: region.source ?? "auto",
      regionId: region.regionId,
    }));
  const zoomSegments = useMemo(() => getZoomSegments(keyframes), [keyframes, config.trimEnd, duration]);

  const visibleLayerTypes = useMemo(
    () => (["text", "shape", "mask", "image", "video"] as Layer["type"][]).filter((type) => layers.some((layer) => layer.type === type)),
    [layers]
  );
  const layerRows = visibleLayerTypes.flatMap<{id:string;type:Layer["type"];name:string;items:Layer[]}>(type => type === "image" || type === "video" ? layers.filter(l => l.type === type).map(layer => ({ id: layer.id, type, name: mediaLayerName(layer), items: [layer] })) : [{ id: type, type, name: type.charAt(0).toUpperCase() + type.slice(1), items: layers.filter(l => l.type === type) }]);
  const visibleCaptionTracks = [...new Map([...captionTracks,...clips.flatMap(c=>c.effects?.captions??[])].filter(track=>track.segments.length>0).map(track=>[track.id,track])).values()];
  const showActionTrack = config.actionOverlay.enabled && resolvedActionEvents.length > 0;

  const allTiltKeys = [...(config.screenTilt?.keys??[]), ...clips.flatMap(c=>c.effects?.config.screenTilt?.keys??[])];
  const animationTracks = [
    ...(allTiltKeys.length ? [{kind:"tilt" as const,label:"3D tilt",keys:config.screenTilt?.keys??[]}] : []),
    ...(config.cameraOverlay.animation?.length ? [{kind:"camera" as const,label:"Webcam",keys:config.cameraOverlay.animation}] : []),
  ];
  const visibleTrackCount = 1
    + animationTracks.length
    + timelineAudioTracks.length
    + (zoomSegments.length > 0 || clips.some(c=>c.effects?.keyframes.length) ? 1 : 0)
    + (showActionTrack ? 1 : 0)
    + visibleCaptionTracks.length
    + layerRows.length;
  const heightBounds = timelineHeightBounds(visibleTrackCount);
  const minimumTimelineHeight = heightBounds.minimum + 36;
  const maximumTimelineHeight = heightBounds.maximum + 36;

  useEffect(() => {
    setTimelineHeight((height) => Math.max(minimumTimelineHeight, Math.min(height, maximumTimelineHeight)));
  }, [minimumTimelineHeight, maximumTimelineHeight]);

  const audioTrackMuted = (track: AudioTrack) => (
    track.muted
    || (track.kind === "microphone" && config.audio.micMuted)
    || ((track.kind === "system" || track.kind === "device") && config.audio.systemMuted)
  );

  const setAudioTrackMuted = (track: AudioTrack, muted: boolean) => {
    if(config.lockedTracks?.includes(track.id))return;
    if (track.kind === "microphone") onAudioMuteChange("mic", muted);
    else if (track.kind === "system" || track.kind === "device") onAudioMuteChange("system", muted);
    else onAudioTrackChange({ ...track, muted });
  };

  const audioTrackLabel = (track: AudioTrack) => {
    if (track.kind === "microphone") return "Mic";
    if (track.kind === "device") return "Device";
    if (track.kind === "system") return "Desktop";
    return track.label;
  };

  const trackHeaderMenu = (event: React.MouseEvent, label:string, lockId:string, trackKind:"video"|"zoom"|"action"|"caption"|"layer", id?:string) => {
    event.preventDefault(); event.stopPropagation();
    setContextMenu({kind:"track",label,lockId,trackKind,id,...menuPosition(event)});
  };
  const trackLock=(id:string,label:string)=><button className="track-lock" aria-label={`${config.lockedTracks?.includes(id)?"Unlock":"Lock"} ${label} track`} aria-pressed={config.lockedTracks?.includes(id)??false} onClick={()=>onTrackLocksChange?.(config.lockedTracks?.includes(id)?config.lockedTracks.filter(t=>t!==id):[...config.lockedTracks??[],id])}>{config.lockedTracks?.includes(id)?<Lock size={11}/>:<LockOpen size={11}/>}</button>;

  const beginZoomEdit = (event: React.PointerEvent, segment: ZoomSegment, mode: "move" | "start" | "end", clipId?:string) => {
    if (config.lockedTracks?.includes("zoom")) return;
    if (event.button !== 0) return;
    if(clipId)onSeek(getTimeFromEvent(event),clipId);
    event.preventDefault();
    event.stopPropagation();
    onZoomRegionSelect({ startMs: Math.round(segment.start * 1000), endMs: Math.round(segment.end * 1000), regionId: segment.regionId, clipId });
    const startX = event.clientX;
    const scopedKeyframes=clips.find(c=>c.id===clipId)?.effects?.keyframes??keyframes;
    const scopedSegments=getZoomSegments(scopedKeyframes);
    const initial = scopedKeyframes.map((frame) => ({ ...frame }));
    const editingSegment: ZoomSegment = { ...segment, memberIndices: [...segment.memberIndices] };
    const minTimeMs = Math.max(0, config.trimStart * 1000);
    const maxTimeMs = Math.max(minTimeMs + 100, (config.trimEnd || duration) * 1000);
    const startMs = segment.start * 1000;
    const endMs = segment.end * 1000;
    const segmentDurationMs = Math.max(1, endMs - startMs);
    const minSegmentMs = Math.min(350, segmentDurationMs);
    const bar = (event.currentTarget as HTMLElement).closest<HTMLElement>(".zoom-segment-bar");
    if (!bar || duration <= 0) return;

    // A trailing zoom with no explicit reset is normalized into a regular
    // editable segment the first time it is manipulated.
    if (editingSegment.resetIndex === null) {
      editingSegment.resetIndex = initial.length;
      editingSegment.memberIndices.push(initial.length);
      initial.push({ time: Math.round(endMs), duration: 400, x: 0.5, y: 0.5, scale: 1, easing: "ease-in-out", source: editingSegment.source, regionId: editingSegment.regionId });
    }
    const previousEndMs = scopedSegments
      .filter((candidate) => candidate !== segment && candidate.end <= segment.start)
      .reduce((latest, candidate) => Math.max(latest, candidate.end * 1000 + 50), minTimeMs);
    const nextStartMs = scopedSegments
      .filter((candidate) => candidate !== segment && candidate.start >= segment.end)
      .reduce((earliest, candidate) => Math.min(earliest, candidate.start * 1000 - 50), maxTimeMs);

    let pendingKeyframes: Keyframe[] | null = null;
    let animationFrame = 0;
    let visualStartMs = startMs;
    let visualEndMs = endMs;
    bar.classList.add("editing");

    const paintBar = () => {
      animationFrame = 0;
      bar.style.left = `${x(visualStartMs / 1000)}px`;
      bar.style.width = `${Math.max(18, w((visualEndMs - visualStartMs) / 1000, visualStartMs / 1000))}px`;
    };

    const onMove = (moveEvent: PointerEvent) => {
      const area = timeAreaRef.current;
      if (!area || duration <= 0) return;
      const deltaMs = sourceDelta(moveEvent.clientX - startX, area.getBoundingClientRect().width, (mode === "end" ? endMs : startMs) / 1000,clipId) * 1000;
      const next = initial.map((frame) => ({ ...frame }));

      if (mode === "move") {
        const boundedDelta = Math.max(previousEndMs - startMs, Math.min(nextStartMs - endMs, deltaMs));
        editingSegment.memberIndices.forEach((index) => {
          next[index].time = Math.round(next[index].time + boundedDelta);
        });
        visualStartMs = startMs + boundedDelta;
        visualEndMs = endMs + boundedDelta;
      } else if (mode === "start") {
        const latestStart = Math.max(previousEndMs, endMs - minSegmentMs);
        const desired = Math.max(previousEndMs, Math.min(latestStart, startMs + deltaMs));
        const ratio = (endMs - desired) / segmentDurationMs;
        editingSegment.memberIndices.forEach((index) => {
          const original = initial[index];
          next[index].time = Math.round(endMs - (endMs - original.time) * ratio);
          if (original.duration > 0) next[index].duration = Math.max(40, Math.round(original.duration * ratio));
        });
        visualStartMs = desired;
        visualEndMs = endMs;
      } else {
        const desired = Math.round(Math.max(startMs + minSegmentMs, Math.min(nextStartMs, endMs + deltaMs)));
        const ratio = (desired - startMs) / segmentDurationMs;
        editingSegment.memberIndices.forEach((index) => {
          const original = initial[index];
          next[index].time = Math.round(startMs + (original.time - startMs) * ratio);
          if (original.duration > 0) next[index].duration = Math.max(40, Math.round(original.duration * ratio));
        });
        visualStartMs = startMs;
        visualEndMs = desired;
      }

      pendingKeyframes = next.sort((a, b) => a.time - b.time);
      if (!animationFrame) animationFrame = requestAnimationFrame(paintBar);
    };

    const cleanup = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onCancel);
      if (animationFrame) cancelAnimationFrame(animationFrame);
      bar.classList.remove("editing");
      dragCleanupRef.current = null;
    };

    const onUp = () => {
      cleanup();
      if (pendingKeyframes) {
        onKeyframesChange(pendingKeyframes,clipId);
        onZoomRegionSelect({ startMs: Math.round(visualStartMs), endMs: Math.round(visualEndMs), regionId: editingSegment.regionId });
      }
    };
    const onCancel = () => {
      cleanup();
      bar.style.left = `${x(startMs / 1000)}px`;
      bar.style.width = `${Math.max(18, w(segmentDurationMs / 1000, segment.start))}px`;
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onCancel);
    dragCleanupRef.current = cleanup;
  };

  const beginLayerEdit = (event: React.PointerEvent, layer: Layer, mode: "move" | "start" | "end", clipId?:string) => {
    if (config.lockedTracks?.includes("annotations")) return;
    if (event.button !== 0 || editTool === "razor") return;
    if(clipId && clipId!=="sequence-media")onSeek(getTimeFromEvent(event),clipId);
    event.preventDefault();
    event.stopPropagation();
    setSelectedAudio(null);
    onLayerSelect(layer.id);
    const bar = (event.currentTarget as HTMLElement).closest<HTMLElement>(".layer-clip-bar");
    if (!bar || duration <= 0) return;
    const startX = event.clientX;
    const initialStart = layer.start;
    const initialEnd = layer.end;
    const layerDuration = Math.max(0.2, initialEnd - initialStart);
    const minTime = layer.timeSpace === "sequence" ? 0 : Math.max(0, config.trimStart);
    const maxTime = layer.timeSpace === "sequence" ? sequenceDuration(clips) : Math.max(minTime + 0.2, config.trimEnd || duration);
    let visualStart = initialStart;
    let visualEnd = initialEnd;
    let pending: Layer | null = null;
    let animationFrame = 0;
    bar.classList.add("editing");

    const paint = () => {
      animationFrame = 0;
      bar.style.left = `${x(visualStart,clipId)}px`;
      bar.style.width = `${Math.max(18, w(visualEnd - visualStart, visualStart,clipId))}px`;
    };
    const onMove = (moveEvent: PointerEvent) => {
      const area = timeAreaRef.current;
      if (!area) return;
      const rawDelta = sourceDelta(moveEvent.clientX - startX, area.getBoundingClientRect().width, mode === "end" ? initialEnd : initialStart,clipId);
      const delta = Math.round(rawDelta*frameRate)/frameRate;
      if (mode === "move") {
        const bounded = Math.max(minTime - initialStart, Math.min(maxTime - initialEnd, delta));
        visualStart = initialStart + bounded;
        visualEnd = initialEnd + bounded;
      } else if (mode === "start") {
        visualStart = Math.max(layer.type === "video" ? Math.max(minTime,initialStart-(layer.sourceOffset??0)) : minTime, Math.min(initialEnd - 1/frameRate, initialStart + delta));
        visualEnd = initialEnd;
      } else {
        visualStart = initialStart;
        visualEnd = Math.max(initialStart + 1/frameRate, Math.min(layer.type === "video" && layer.sourceDuration ? Math.min(maxTime, initialStart+layer.sourceDuration-(layer.sourceOffset??0)) : maxTime, initialEnd + delta));
      }
      visualStart = Math.round(visualStart * frameRate) / frameRate;
      visualEnd = Math.round(visualEnd * frameRate) / frameRate;
      pending = { ...layer, start: visualStart, end: visualEnd, ...(layer.type === "video" && mode === "start" ? {sourceOffset: Math.max(0,(layer.sourceOffset??0)+visualStart-initialStart)} : {}) };
      if (!animationFrame) animationFrame = requestAnimationFrame(paint);
    };
    const cleanup = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onCancel);
      if (animationFrame) cancelAnimationFrame(animationFrame);
      bar.classList.remove("editing");
      dragCleanupRef.current = null;
    };
    const onUp = () => { cleanup(); if (pending) onLayerChange(pending); };
    const onCancel = () => {
      cleanup();
      bar.style.left = `${x(initialStart,clipId)}px`;
      bar.style.width = `${Math.max(18, w(layerDuration, layer.start))}px`;
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onCancel);
    dragCleanupRef.current = cleanup;
  };

  const beginActionEdit = (event: React.PointerEvent, action: ResolvedDisplayAction, mode: "move" | "start" | "end", clipId?:string) => {
    if (config.lockedTracks?.includes("action")) return;
    if (event.button !== 0 || duration <= 0) return;
    if(clipId)onSeek(getTimeFromEvent(event),clipId);
    event.preventDefault();
    event.stopPropagation();
    onActionSelect(action.id);
    const bar = (event.currentTarget as HTMLElement).closest<HTMLElement>(".action-event-bar");
    if (!bar) return;
    const startX = event.clientX;
    const initialStart = action.ts / 1000;
    const initialEnd = initialStart + action.durationMs / 1000;
    const minTime = Math.max(0, config.trimStart);
    const maxTime = Math.max(minTime + .15, config.trimEnd || duration);
    let visualStart = initialStart;
    let visualEnd = initialEnd;
    let pending: ActionEventEdit | null = null;
    let animationFrame = 0;
    bar.classList.add("editing");

    const paint = () => {
      animationFrame = 0;
      bar.style.left = `${x(visualStart,clipId)}px`;
      bar.style.width = `${Math.max(28, w(visualEnd - visualStart, visualStart,clipId))}px`;
    };
    const onMove = (moveEvent: PointerEvent) => {
      const area = timeAreaRef.current;
      if (!area) return;
      const rawDelta = sourceDelta(moveEvent.clientX - startX, area.getBoundingClientRect().width, mode === "end" ? initialEnd : initialStart,clipId);
      const delta = Math.round(rawDelta*frameRate)/frameRate;
      if (mode === "move") {
        const bounded = Math.max(minTime - initialStart, Math.min(maxTime - initialEnd, delta));
        visualStart = initialStart + bounded;
        visualEnd = initialEnd + bounded;
      } else if (mode === "start") {
        visualStart = Math.max(minTime, Math.min(initialEnd - .15, initialStart + delta));
        visualEnd = initialEnd;
      } else {
        visualStart = initialStart;
        visualEnd = Math.max(initialStart + .15, Math.min(maxTime, initialEnd + delta));
      }
      pending = {
        offsetMs: Math.round(visualStart * 1000 - action.sourceTs),
        durationMs: Math.max(150, Math.round((visualEnd - visualStart) * 1000)),
      };
      if (!animationFrame) animationFrame = requestAnimationFrame(paint);
    };
    const cleanup = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onCancel);
      if (animationFrame) cancelAnimationFrame(animationFrame);
      bar.classList.remove("editing");
      dragCleanupRef.current = null;
    };
    const onUp = () => { cleanup(); if (pending) onActionEdit(action.id, pending); };
    const onCancel = () => {
      cleanup();
      bar.style.left = `${x(initialStart,clipId)}px`;
      bar.style.width = `${Math.max(28, w(initialEnd - initialStart, initialStart))}px`;
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onCancel);
    dragCleanupRef.current = cleanup;
  };

  const beginCaptionEdit = (event: React.PointerEvent, trackId: string, segment: CaptionSegment, mode: "move" | "start" | "end", clipId?:string) => {
    if (config.lockedTracks?.includes("caption")) return;
    if (event.button !== 0 || duration <= 0) return;
    if(clipId)onSeek(getTimeFromEvent(event),clipId);
    event.preventDefault(); event.stopPropagation();
    const bar = (event.currentTarget as HTMLElement).closest<HTMLElement>(".caption-clip-bar");
    if (!bar) return;
    const startX = event.clientX;
    const initialStart = segment.startMs / 1000;
    const initialEnd = segment.endMs / 1000;
    const clipDuration = Math.max(0.1, initialEnd - initialStart);
    const track = captionTracks.find((candidate) => candidate.id === trackId);
    const ordered = [...(track?.segments ?? [])].sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
    const segmentIndex = ordered.findIndex((candidate) => candidate.id === segment.id);
    const previous = segmentIndex > 0 ? ordered[segmentIndex - 1] : null;
    const next = segmentIndex >= 0 && segmentIndex < ordered.length - 1 ? ordered[segmentIndex + 1] : null;
    // Captions are exclusive intervals. Constraining edits to adjacent cards
    // prevents an overlap from making one card disappear in preview/export.
    const minTime = Math.max(config.trimStart, (previous?.endMs ?? 0) / 1000);
    const maxTime = Math.min(config.trimEnd || duration, (next?.startMs ?? Number.POSITIVE_INFINITY) / 1000);
    let visualStart = initialStart, visualEnd = initialEnd;
    let pending: CaptionSegment | null = null;
    const move = (moveEvent: PointerEvent) => {
      const area = timeAreaRef.current; if (!area) return;
      const rawDelta = sourceDelta(moveEvent.clientX - startX, area.getBoundingClientRect().width, mode === "end" ? initialEnd : initialStart,clipId);
      const delta = Math.round(rawDelta*frameRate)/frameRate;
      if (mode === "move") {
        const bounded = Math.max(minTime - initialStart, Math.min(maxTime - initialEnd, delta));
        visualStart = initialStart + bounded; visualEnd = initialEnd + bounded;
      } else if (mode === "start") visualStart = Math.max(minTime, Math.min(initialEnd - 0.1, initialStart + delta));
      else visualEnd = Math.max(initialStart + 0.1, Math.min(maxTime, initialEnd + delta));
      pending = { ...segment, startMs: Math.round(visualStart * 1000), endMs: Math.round(visualEnd * 1000), words: segment.words?.map(word=>({...word,startMs:Math.max(visualStart*1000,word.startMs+(mode==="move"?(visualStart-initialStart)*1000:0)),endMs:Math.min(visualEnd*1000,word.endMs+(mode==="move"?(visualStart-initialStart)*1000:0))})).filter(word=>word.endMs>word.startMs), userEdited: true };
      bar.style.left = `${x(visualStart,clipId)}px`; bar.style.width = `${Math.max(18, w(visualEnd - visualStart, visualStart,clipId))}px`;
    };
    const cleanup = () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerup", up);
      document.removeEventListener("pointercancel", cancel);
      bar.classList.remove("editing");
      dragCleanupRef.current = null;
    };
    const up = () => { cleanup(); if (pending) onCaptionSegmentChange(trackId, pending,clipId); };
    const cancel = () => {
      cleanup();
      bar.style.left = `${x(initialStart,clipId)}px`;
      bar.style.width = `${Math.max(18, w(clipDuration, initialStart,clipId))}px`;
    };
    bar.classList.add("editing");
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerup", up);
    document.addEventListener("pointercancel", cancel);
    dragCleanupRef.current = cleanup;
  };

  const beginResize = (event: React.MouseEvent) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = timelineHeight;
    const move = (e: MouseEvent) => setTimelineHeight(Math.max(minimumTimelineHeight, Math.min(maximumTimelineHeight, startHeight - (e.clientY - startY))));
    const up = () => { document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  };

  useEffect(() => {
    if (!playing || zoomScale <= 1) return;
    const scroller = scrollRef.current;
    if (!scroller || duration <= 0) return;
    const playheadX = (timelineTime(currentTime, activeClipId) / Math.max(.001, timelineDuration)) * effectiveWidth;
    const margin = Math.min(120, scroller.clientWidth * 0.2);
    if (playheadX < scroller.scrollLeft + margin) {
      scroller.scrollLeft = Math.max(0, playheadX - margin);
    } else if (playheadX > scroller.scrollLeft + scroller.clientWidth - margin) {
      scroller.scrollLeft = playheadX - scroller.clientWidth + margin;
    }
  }, [currentTime, duration, effectiveWidth, playing, zoomScale, timeView, timelineDuration, clips, activeClipId]);

  const handleAddMarker = useCallback(() => {
    if (duration <= 0) return;
    const cutPoint = Math.round(currentTime * 100) / 100;
    if (cutPoint <= config.trimStart || cutPoint >= (config.trimEnd || duration)) return;
    if (config.cuts.includes(cutPoint)) return;

    const newCuts = [...config.cuts, cutPoint].sort((a, b) => a - b);
    onCutsChange(newCuts);
  }, [config.cuts, config.trimEnd, config.trimStart, currentTime, duration, onCutsChange]);

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if (event.altKey || event.repeat) return;
      if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select, [contenteditable='true'], [role='dialog']")) return;
      const key = event.key.toLowerCase();
      if ((event.ctrlKey || event.metaKey) && key === "k") { event.preventDefault(); splitAt(currentTime); }
      else if (!event.ctrlKey && !event.metaKey) {
        if (key === "escape") { setEditTool("select");setCutGuide(null); }
        else if (key === "c") { event.preventDefault(); setEditTool("razor"); }
        else if (key === "v") { event.preventDefault(); setEditTool("select"); }
        else if (key === "m") { event.preventDefault(); handleAddMarker(); }
        else if (key === "s") { event.preventDefault(); setSnapping(s => !s); }
        else if ((key === "delete" || key === "backspace") && selectedClip && event.target instanceof Element && event.target.closest(".footage-segment")) { event.preventDefault(); deleteClip(event.shiftKey); }
      }
    };
    window.addEventListener("keydown", shortcut);
    return () => window.removeEventListener("keydown", shortcut);
  }, [handleAddMarker, splitAt, currentTime, selectedClip, deleteClip]);

  const getTimeFromEvent = useCallback(
    (e: MouseEvent | React.MouseEvent): number => {
      const el = timeAreaRef.current;
      if (!el || duration <= 0) return 0;
      const rect = el.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const time = Math.max(0, Math.min(timelineDuration, (x / rect.width) * timelineDuration));
      return timeView === "sequence" ? sourceTime(clips, time) : time;
    },
    [timelineDuration, timeView, clips]
  );

  const handleMouseDown = (type: "playhead" | "trim-start" | "trim-end") => (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setDragging(type);

    const onMove = (ev: MouseEvent) => {
      const source = getTimeFromEvent(ev as unknown as React.MouseEvent);
      const t = type === "playhead" ? source : Math.round(source * frameRate) / frameRate;
      if (type === "playhead") {const rect=timeAreaRef.current?.getBoundingClientRect();const target=timeView==="sequence"&&rect?sequenceClip(clips,Math.max(0,Math.min(timelineDuration,(ev.clientX-rect.left)/rect.width*timelineDuration))):null;onSeek(t,target?.clip.id);}
      else if (type === "trim-start") onTrimStartChange(Math.min(t, (config.trimEnd || duration) - frameDuration(frameRate)));
      else onTrimEndChange(Math.max(t, config.trimStart + frameDuration(frameRate)));
    };
    const onUp = () => {
      setDragging(null);
      const swallowClick = (ev: MouseEvent) => {
        ev.stopPropagation();
        document.removeEventListener("click", swallowClick, true);
      };
      document.addEventListener("click", swallowClick, true);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    dragCleanupRef.current = () => {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  };

  const MIN_CLIP_SECONDS = frameDuration(frameRate);
  const trimClip = (event: React.MouseEvent, clip: VideoClip, edge: "start" | "end") => {
    event.preventDefault(); event.stopPropagation();
    if (videoLocked) return;
    setSelectedClipId(clip.id);
    const startX = event.clientX;
    const dragWidth = timeAreaRef.current?.getBoundingClientRect().width || effectiveWidth;
    let draft = clips;
    const move = (e: MouseEvent) => {
      let time = Math.round((clip[edge] + (e.clientX - startX) / dragWidth * timelineDuration * (timeView === "sequence" ? clipSpeed(clip) : 1)) * frameRate) / frameRate;
      if (snapping) {
        const candidates = [currentTime, config.trimStart, config.trimEnd || duration, ...clips.filter(c => c.id !== clip.id).flatMap(c => [c.start, c.end])];
        const closest = candidates.sort((a, b) => Math.abs(a - time) - Math.abs(b - time))[0];
        if (Math.abs(closest - time) <= timelineDuration * 8 / effectiveWidth) time = closest;
      }
      const start = edge === "start" ? Math.max(config.trimStart, Math.min(time, clip.end - MIN_CLIP_SECONDS)) : clip.start;
      const end = edge === "end" ? Math.min(config.trimEnd || duration, Math.max(time, clip.start + MIN_CLIP_SECONDS)) : clip.end;
      draft = trimClipRange(clips,clip.id,start,end,rippleEdits);
      setTrimDraft(draft);
      const index=clips.findIndex(c=>c.id===clip.id);
      setTrimPreview(edge==="end"?{left:Math.max(start,end-1/frameRate),right:clips[index+1]?.start??end}:{left:Math.max(0,(clips[index-1]?.end??start)-1/frameRate),right:start});
    };
    const cancel = () => cleanup();
    const escape = (e: KeyboardEvent) => { if (e.key === "Escape") cancel(); };
    const cleanup = () => { document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); window.removeEventListener("blur", cancel); window.removeEventListener("keydown", escape); dragCleanupRef.current = null; setTrimDraft(null); setTrimPreview(null); };
    const up = () => { cleanup(); if (JSON.stringify(draft) !== JSON.stringify(clips)) onVideoClipsChange(draft); };
    dragCleanupRef.current?.(); dragCleanupRef.current = cleanup;
    document.addEventListener("mousemove", move); document.addEventListener("mouseup", up); window.addEventListener("blur", cancel); window.addEventListener("keydown", escape);
  };

  const beginAudioEdit=(event:React.PointerEvent,track:AudioTrack,segment:ReturnType<typeof resolvedAudioClips>[number],edge:"move"|"start"|"end")=>{
    event.stopPropagation();if(event.button!==0||config.lockedTracks?.includes(track.id)||editTool==="razor")return;
    setSelectedAudio({trackId:track.id,clipId:segment.id});setSelectedClipId(null);
    if(edge==="move"&&(segment.linked??track.linked??true)&&segment.videoClipId)return;
    if(timeView==="source")setTimeView("sequence");
    const audioTimelineDuration=sequenceDuration(clips);
    const origin=event.clientX;
    const element=(event.currentTarget as HTMLElement).closest?.(".timeline-audio-clip") as HTMLElement|null;
    const restore=()=>{if(element){element.style.left=`${segment.start/Math.max(.001,audioTimelineDuration)*effectiveWidth}px`;element.style.width=`${(segment.sourceEnd-segment.sourceStart)/segment.speed/Math.max(.001,audioTimelineDuration)*effectiveWidth}px`;}};
    let draft=segment;
    const move=(e:PointerEvent)=>{
      const rect=timeAreaRef.current?.getBoundingClientRect();if(!rect)return;
      const delta=Math.round((e.clientX-origin)/rect.width*audioTimelineDuration*frameRate)/frameRate;
      if(edge==="move")draft={...segment,start:Math.max(0,segment.start+delta)};
      else if(edge==="start"){const sourceStart=Math.max(0,Math.min(segment.sourceEnd-1/frameRate,segment.sourceStart+delta*segment.speed));draft={...segment,sourceStart,start:segment.start+(sourceStart-segment.sourceStart)/segment.speed};}
      else draft={...segment,sourceEnd:Math.min(audioDurations[track.id]??duration,Math.max(segment.sourceStart+1/frameRate,segment.sourceEnd+delta*segment.speed))};
      const node=element;
      if(node?.style){node.style.left=`${draft.start/Math.max(.001,audioTimelineDuration)*effectiveWidth}px`;node.style.width=`${(draft.sourceEnd-draft.sourceStart)/draft.speed/Math.max(.001,audioTimelineDuration)*effectiveWidth}px`;}
    };
    const cleanup=()=>{window.removeEventListener("pointermove",move);window.removeEventListener("pointerup",up);window.removeEventListener("pointercancel",cancel);dragCleanupRef.current=null;};
    const up=()=>{cleanup();const next=editAudioClip(track,clips,audioDurations[track.id]??duration,segment.id,draft);if(next===track){restore();setClipNotice("Audio clips cannot overlap on the same track.");return;}onAudioTrackChange(next);};
    const cancel=()=>{cleanup();restore();};dragCleanupRef.current?.();dragCleanupRef.current=cleanup;
    window.addEventListener("pointermove",move);window.addEventListener("pointerup",up);window.addEventListener("pointercancel",cancel);
  };

  const resizeTransition=(event:React.PointerEvent<HTMLSpanElement>,clip:VideoClip)=>{
    event.preventDefault();event.stopPropagation();if(videoLocked||!clip.transition||event.button!==0)return;
    const origin=event.clientX,initial=clip.transition.duration,element=event.currentTarget.closest(".timeline-transition") as HTMLElement|null;
    const oldWidth=element?.style.width;let pending=initial;
    const maximum=Math.max(1/frameRate,Math.min(2,clipDuration(clip)));
    const move=(e:PointerEvent)=>{const rect=timeAreaRef.current?.getBoundingClientRect();if(!rect)return;const delta=(e.clientX-origin)/rect.width*timelineDuration/(timeView==="source"?clipSpeed(clip):1);pending=Math.max(1/frameRate,Math.min(maximum,Math.round((initial+delta)*frameRate)/frameRate));if(element)element.style.width=`${pending*(timeView==="source"?clipSpeed(clip):1)/Math.max(.001,timelineDuration)*effectiveWidth}px`;};
    const cleanup=()=>{window.removeEventListener("pointermove",move);window.removeEventListener("pointerup",up);window.removeEventListener("pointercancel",cancel);dragCleanupRef.current=null;};
    const up=()=>{cleanup();onVideoClipsChange(clips.map(item=>item.id===clip.id?{...item,transition:{...clip.transition!,duration:pending}}:item));};
    const cancel=()=>{cleanup();if(element&&oldWidth!==undefined)element.style.width=oldWidth;};
    dragCleanupRef.current?.();dragCleanupRef.current=cleanup;window.addEventListener("pointermove",move);window.addEventListener("pointerup",up);window.addEventListener("pointercancel",cancel);
  };

  // Position helpers — all measured in the timeline (time) column space
  const instances = <T,>(items:T[],range:(item:T)=>[number,number]) => items.flatMap(item=>{
    const [start,end]=range(item);
    return timeView==="source"?[{item,clipId:undefined as string|undefined,start,end}]:clips.filter(clip=>!clip.gap).flatMap(clip=>end>clip.start&&start<clip.end?[{item,clipId:clip.id,start:Math.max(start,clip.start),end:Math.min(end,clip.end)}]:[]);
  });
  const effectInstances = <T,>(shared:T[], local:(clip:VideoClip)=>T[]|undefined, range:(item:T)=>[number,number]) => timeView==="source" ? instances(local(clips.find(c=>c.id===activeClipId)??clips[0])??shared,range) : clips.filter(clip=>!clip.gap).flatMap(clip=>(local(clip)??shared).flatMap(item=>{const [start,end]=range(item);return end>clip.start&&start<clip.end?[{item,clipId:clip.id,start:Math.max(start,clip.start),end:Math.min(end,clip.end)}]:[];}));
  const zoomInstances=effectInstances(zoomSegments,clip=>clip?.effects?getZoomSegments(clip.effects.keyframes):undefined,s=>[s.start,s.end]);
  const timelineTime = (t: number, id?: string) => id === "sequence-media" ? t : timeView === "sequence" ? sequenceTime(clips, t, id) : t;
  const layerInstances = (items:Layer[]) => items.flatMap(item => item.timeSpace === "sequence" ? (timeView === "sequence" ? [{item,clipId:"sequence-media",start:item.start,end:item.end}] : []) : instances([item], l=>[l.start,l.end]));
  const x = (t: number, id?: string): number => timelineDuration > 0 ? timelineTime(t, id) / timelineDuration * effectiveWidth : 0;
  const w = (length: number, start = config.trimStart, id?: string): number => Math.max(0, x(start + length, id) - x(start, id));
  const sourceDelta = (pixels: number, width: number, _anchor: number, clipId?: string): number => pixels / width * timelineDuration * (timeView==="sequence"?clipSpeed(clips.find(clip=>clip.id===clipId)??{id:"",start:0,end:0}):1);


  const currentAspectLabel = ASPECT_RATIOS.find((ar) =>
    (config.aspectRatio === null && ar.width === 0) ||
    (config.aspectRatio?.width === ar.width && config.aspectRatio?.height === ar.height)
  )?.label || "Wide 16:9";

  const menuPosition = (event: React.MouseEvent) => ({
    x: event.clientX,
    y: event.clientY,
  });

  const handleContextMenuKeys = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "Home" && event.key !== "End") return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"));
    if (items.length === 0) return;
    event.preventDefault();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === "Home" ? 0
      : event.key === "End" ? items.length - 1
        : event.key === "ArrowDown" ? (current + 1 + items.length) % items.length
          : (current - 1 + items.length) % items.length;
    items[next].focus();
  };

  const [selectedKeys,setSelectedKeys]=useState<{kind:"tilt"|"camera"|"layer";id:string;clipId?:string;time:number}[]>([]);
  const keyClipboard=useRef<{kind:"tilt"|"camera"|"layer";keys:(LayerAnimationKey|ScreenTiltKey)[]}|null>(null);
  const animationKeys=(kind:"tilt"|"camera"|"layer",id:string,clipId?:string):(LayerAnimationKey|ScreenTiltKey)[]=>kind==="tilt"?(clips.find(c=>c.id===clipId)?.effects?.config.screenTilt?.keys??(clips.find(c=>c.id===clipId)?.effects?[]:config.screenTilt?.keys??[])):kind==="camera"?config.cameraOverlay.animation??[]:layers.find(l=>l.id===id)?.animation??[];
  const selectedTimes=(kind:"tilt"|"camera"|"layer",id:string,clipId:string|undefined,time:number)=>{const values=selectedKeys.filter(k=>k.kind===kind&&k.id===id&&k.clipId===clipId).map(k=>k.time);return values.includes(time)?values:[time];};
  const pasteAnimation=(kind:"tilt"|"camera"|"layer",id:string,clipId?:string)=>{
    if(!onAnimationKeysChange||keyClipboard.current?.kind!==kind||config.lockedTracks?.includes(kind==="layer"?"annotations":kind))return;
    const layer=kind==="layer"?layers.find(l=>l.id===id):undefined;
    onAnimationKeysChange(kind,id,pasteKeys(animationKeys(kind,id,clipId),keyClipboard.current.keys,Math.max(0,(layer?.timeSpace==="sequence"?sequenceTime(clips,currentTime,activeClipId):currentTime)-(layer?.start??0)),layer?layer.end-layer.start:duration,frameRate),clipId);
  };
  const seekKeyTime = (time:number,clipId?:string) => { if(clipId!=="sequence-media")onSeek(time,clipId);else {const target=sequenceClip(clips,time);if(target)onSeek(target.source,target.clip.id);} };
  const renderAnimationKeys = (keys:{time:number}[], kind:"tilt"|"camera"|"layer", id:string, offset=0, end=duration, onlyClipId?:string) => keys.flatMap(key => {
    const source=key.time+offset;
    const onlyClip=clips.find(clip=>clip.id===onlyClipId);
    const sequenceLayer=kind==="layer"&&layers.find(l=>l.id===id)?.timeSpace==="sequence";
    const occurrences=sequenceLayer?(timeView==="sequence"&&source>=offset&&source<=end?["sequence-media"]:[]):onlyClipId?(timeView==="source"||onlyClip&&source>=onlyClip.start&&source<=onlyClip.end?[onlyClipId]:[]):timeView === "sequence" ? clips.filter((clip,index)=>!clip.gap&&source>=clip.start && (source<clip.end || index===clips.length-1 && source<=clip.end)).map(clip=>clip.id) : [undefined];
    return occurrences.map(clipId=><button key={`${kind}-${id}-${key.time}-${clipId}`} className={`timeline-animation-key ${Math.abs((sequenceLayer?sequenceTime(clips,currentTime,activeClipId):currentTime)-source)<1/frameRate && (sequenceLayer||!activeClipId||activeClipId===clipId) ? "active" : ""} ${selectedKeys.some(k=>k.kind===kind&&k.id===id&&k.clipId===clipId&&Math.abs(k.time-key.time)<1e-6)?"selected":""}`} data-key-time={key.time} style={{left:x(source,clipId)}} aria-label={`${kind === "tilt" ? "3D tilt" : kind === "camera" ? "Webcam" : "Object"} keyframe at ${source.toFixed(3)} seconds`} title={`Keyframe · ${source.toFixed(3)}s`} onClick={event=>{event.stopPropagation();if(suppressKeyClick.current){suppressKeyClick.current=false;return;}const entry={kind,id,clipId,time:key.time};setSelectedKeys(previous=>event.ctrlKey||event.metaKey?previous.some(k=>k.kind===kind&&k.id===id&&k.clipId===clipId&&k.time===key.time)?previous.filter(k=>!(k.kind===kind&&k.id===id&&k.clipId===clipId&&k.time===key.time)):[...previous,entry]:[entry]);if(kind==="layer")onLayerSelect(id);seekKeyTime(source,clipId);}} onPointerDown={event=>{
      event.stopPropagation();if(event.ctrlKey||event.metaKey)return;if(event.button!==0||!onAnimationKeyChange||config.lockedTracks?.includes(kind==="layer"?"annotations":kind))return;
      suppressKeyClick.current=false;const element=event.currentTarget;const origin=event.clientX;const times=selectedTimes(kind,id,clipId,key.time);setSelectedKeys(times.map(time=>({kind,id,clipId,time})));let pending=key.time,moved=false;
      const selectionElements = Array.from(element.closest?.(".ss-track-row")?.querySelectorAll<HTMLButtonElement>(".timeline-animation-key") ?? []).filter(node => times.includes(Number(node.dataset.keyTime)));
      const paintSelection = (delta: number) => {
        if (!selectionElements.length) element.style.left = `${x(key.time + delta + offset,clipId)}px`;
        for (const node of selectionElements) node.style.left = `${x(Number(node.dataset.keyTime) + delta + offset,clipId)}px`;
      };
      const move=(e:PointerEvent)=>{
        if(Math.abs(e.clientX-origin)<4&&!moved)return;
        moved=true;suppressKeyClick.current=true;
        const area=timeAreaRef.current?.getBoundingClientRect();if(!area)return;
        pending=key.time+sourceDelta(e.clientX-origin,area.width,key.time,clipId);
        if(snapping){
          const target=[...keys.filter(k=>!times.includes(k.time)).map(k=>k.time),(clipId==="sequence-media"?sequenceTime(clips,currentTime,activeClipId):currentTime)-offset].sort((a,b)=>Math.abs(a-pending)-Math.abs(b-pending))[0];
          if(Math.abs(target-pending)<timelineDuration*6/area.width)pending=target;
        }
        const delta=Math.max(-Math.min(...times),Math.min(end-offset-Math.max(...times),Math.round((pending-key.time)*frameRate)/frameRate));
        pending=Math.round((key.time+delta)*frameRate)/frameRate;
        paintSelection(pending-key.time);
      };
      const cleanup=()=>{window.removeEventListener("pointermove",move);window.removeEventListener("pointerup",up);window.removeEventListener("pointercancel",cancel);dragCleanupRef.current=null;};
      const up=()=>{cleanup();if(moved){if(times.length>1&&onAnimationKeysChange)onAnimationKeysChange(kind,id,retimeKeys(animationKeys(kind,id,clipId),times,pending-key.time,end-offset,frameRate),clipId);else onAnimationKeyChange(kind,id,key.time,pending,clipId);setSelectedKeys(times.map(time=>({kind,id,clipId,time:time+pending-key.time})));seekKeyTime(pending+offset,clipId);}};
      const cancel=()=>{cleanup();paintSelection(0);};
      dragCleanupRef.current?.();dragCleanupRef.current=cleanup;window.addEventListener("pointermove",move);window.addEventListener("pointerup",up);window.addEventListener("pointercancel",cancel);
    }} onKeyDown={event=>{if(event.key==="ArrowLeft"||event.key==="ArrowRight"){event.preventDefault();event.stopPropagation();if(config.lockedTracks?.includes(kind==="layer"?"annotations":kind))return;const delta=(event.key==="ArrowLeft"?-1:1)*(event.shiftKey?10:1)/frameRate;onAnimationKeysChange?.(kind,id,retimeKeys(animationKeys(kind,id,clipId),selectedTimes(kind,id,clipId,key.time),delta,end-offset,frameRate),clipId);}else if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="c"){event.preventDefault();event.stopPropagation();keyClipboard.current={kind,keys:copyKeys(animationKeys(kind,id,clipId),selectedTimes(kind,id,clipId,key.time))};}else if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="v"){event.preventDefault();event.stopPropagation();pasteAnimation(kind,id,clipId);}}} onContextMenu={event=>{event.preventDefault();event.stopPropagation();setContextMenu({kind:"animation-key",animationKind:kind,id,time:key.time,sourceTime:source,clipId,label:kind==="tilt"?"3D tilt":kind==="camera"?"Webcam":"Object",...menuPosition(event)});}}><Diamond size={12}/></button>);
  });
  return (
    <div
      ref={timelineRootRef}
      className={`ss-timeline-container ${mediaDragOver ? "is-media-drag-over" : ""}`}
      style={{ height: `${timelineHeight}px` }}
      onDragEnter={(event) => { event.preventDefault(); setMediaDragOver(true); }}
      onDragOver={(event) => { if(!Array.from(event.dataTransfer.types).some(type=>type==="application/x-snap-media"||type==="Files"))return; event.preventDefault(); event.dataTransfer.dropEffect = "copy"; const rect=timeAreaRef.current?.getBoundingClientRect();if(rect)setMediaDropTime(Math.max(0,Math.min(timelineDuration,Math.round((event.clientX-rect.left)/rect.width*timelineDuration*frameRate)/frameRate))); setMediaDragOver(true); }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setMediaDragOver(false); }}
      onDrop={(event) => {
        event.preventDefault(); setMediaDragOver(false);
        let paths: string[] = [];
        const encoded = event.dataTransfer.getData("application/x-snap-media");
        if (encoded) { try { const item = JSON.parse(encoded) as { path?: string }; if (item.path) paths = [item.path]; } catch { /* ignore invalid drag data */ } }
        if (!paths.length) {
          const files = Array.from(event.dataTransfer.files) as Array<File & { path?: string }>;
          paths = files.map((file) => file.path).filter((path): path is string => Boolean(path));
        }
        if (paths.length) { const rect=timeAreaRef.current?.getBoundingClientRect(); const at=rect?Math.max(0,Math.min(timelineDuration,(event.clientX-rect.left)/rect.width*timelineDuration)):0; onMediaDrop(paths,timeView==="sequence"?Math.round(at*frameRate)/frameRate:sequenceTime(clips,at)); setTimeView("sequence"); }
      }}
    >
      <div className="timeline-resize-edge" onMouseDown={beginResize} title="Drag the timeline edge to resize" />
      {/* ── Screen Studio Toolbar ──────────────────────────────────── */}
      <div className="ss-timeline-toolbar">
        <div className="tb-left-group">
          <div className="aspect-menu-wrap">
            <button
              ref={aspectButtonRef}
              className="ss-tb-btn aspect-btn"
              onClick={() => {
                const rect = aspectButtonRef.current?.getBoundingClientRect();
                if (rect) setAspectMenuPosition({ x: rect.left, y: rect.top - 7 });
                setShowAspectMenu(!showAspectMenu);
              }}
              title={`Aspect ratio: ${currentAspectLabel}`}
              aria-label={`Aspect ratio: ${currentAspectLabel}`}
            >
              <RectangleHorizontal size={16} />
              <span className="aspect-current-label">{currentAspectLabel}</span>
              {showAspectMenu ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>

            {showAspectMenu && createPortal(
              <div ref={aspectMenuRef} className={`aspect-dropdown-menu aspect-dropdown-portal theme-${editorTheme}`} style={{ left: aspectMenuPosition.x, top: aspectMenuPosition.y }}>
                {ASPECT_RATIOS.map((ar) => (
                  <button
                    key={ar.label}
                    className="aspect-item"
                    onClick={() => {
                      onAspectChange(ar.width > 0 ? { width: ar.width, height: ar.height } : null);
                      setShowAspectMenu(false);
                    }}
                  >
                    {ar.label}
                  </button>
                ))}
              </div>, document.body
            )}
          </div>

          <button
            className={`ss-tb-btn crop-btn ${cropActive ? "active" : ""}`}
            onClick={onToggleCrop}
            title={cropActive ? "Finish crop" : "Crop Canvas Region"}
          >
            <Crop size={16} />
            <span>Crop</span>
          </button>

          <button className="ss-tb-btn add-audio-timeline-btn" onClick={onAddAudio} title="Add an audio file to the timeline">
            <Music2 size={16} />
            <span>Audio</span>
          </button>
        </div>

        {/* Center Transport Controls & Timecode */}
        <div className="tb-center-group">
          <span className="tb-timecode-text">{formatTimecode(timelineTime(currentTime,activeClipId) / (timeView === "sequence" ? config.playbackRate || 1 : 1))}</span>

          <div className="tb-transport-buttons">
            <button className="tb-transport-btn" disabled={duration <= 0} onClick={() => {const first=clips[0];if(first)onSeek(first.start,first.id);}} title="Jump to Start" aria-label="Jump to start">
              <SkipBack size={17} strokeWidth={1.9} />
            </button>
            <button className="tb-transport-btn" disabled={duration <= 0} title="Previous frame (Left arrow)" aria-label="Previous frame" onClick={()=>{if(playing)onTogglePlay();const target=sequenceClip(clips,Math.max(0,sequenceTime(clips,currentTime,activeClipId)-1/frameRate));if(target)onSeek(target.source,target.clip.id);}}><StepBack size={17} strokeWidth={1.9}/></button>

            <button
              className={`tb-play-icon-btn ${playing ? "is-playing" : "is-paused"} ${["starting", "buffering", "seeking", "recovering"].includes(playbackStatus) ? "is-loading" : ""}`}
              onClick={onTogglePlay}
              disabled={duration <= 0}
              title={["starting", "buffering", "seeking", "recovering"].includes(playbackStatus) ? "Cancel playback loading" : playing ? "Pause" : "Play"}
              aria-label={["starting", "buffering", "seeking", "recovering"].includes(playbackStatus) ? "Cancel playback loading" : playing ? "Pause preview" : "Play preview"}
            >
              {["starting", "buffering", "seeking", "recovering"].includes(playbackStatus)
                ? <LoaderCircle className="tb-play-loading-icon" size={18} aria-hidden="true" />
                : <span className="tb-play-morph-icon" aria-hidden="true">{playing ? <Pause size={20} strokeWidth={2} /> : <Play size={20} strokeWidth={2} />}</span>}
            </button>

            <button className="tb-transport-btn" disabled={duration <= 0} title="Next frame (Right arrow)" aria-label="Next frame" onClick={()=>{if(playing)onTogglePlay();const target=sequenceClip(clips,sequenceTime(clips,currentTime,activeClipId)+1/frameRate);if(target)onSeek(target.source,target.clip.id);}}><StepForward size={17} strokeWidth={1.9}/></button>
            <button className="tb-transport-btn" disabled={duration <= 0} onClick={() => {const last=clips[clips.length-1];if(last)onSeek(last.end,last.id);}} title="Jump to End" aria-label="Jump to end">
              <SkipForward size={17} strokeWidth={1.9} />
            </button>
          </div>

          <span className="tb-timecode-text total" title="Edited output duration">{formatTimecode(sequenceDuration(clips) / (config.playbackRate || 1))}</span>
        </div>

        {/* Right Tools (Scissor cut & Zoom scale) */}
        <div className="tb-right-group">
          <button className="ss-tb-btn primary-scissor-btn" onClick={handleAddMarker} title="Add timeline marker (M)" aria-label="Add timeline marker">
            <BookmarkPlus size={16} />
          </button>

          <button className="zoom-step-btn history-btn" onClick={onUndo} disabled={!canUndo} title="Undo (Ctrl+Z)"><Undo2 size={16} /></button>
          <button className="zoom-step-btn history-btn" onClick={onRedo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)"><Redo2 size={16} /></button>

          <div className="timeline-zoom-slider-wrap">
            <button className="zoom-step-btn" onClick={() => setZoomScale(Math.max(1, zoomScale - 0.5))} title="Zoom Out">
              <ZoomOut size={15} />
            </button>
            <input
              type="range"
              min={1}
              max={4}
              step={0.5}
              value={zoomScale}
              onChange={(e) => setZoomScale(Number(e.target.value))}
            />
            <button className="zoom-step-btn" onClick={() => setZoomScale(Math.min(4, zoomScale + 0.5))} title="Zoom In">
              <ZoomIn size={15} />
            </button>
          </div>
        </div>
      </div>

      <div className="timeline-edit-bar" role="toolbar" aria-label="Footage editing tools">
        <div className="timeline-tool-cluster">          <button className="ss-tb-btn" aria-pressed={editTool === "select"} onClick={() => setEditTool("select")} title="Selection tool (V)" aria-label="Selection tool"><MousePointer2 size={16} /></button>
          <button className="ss-tb-btn" aria-pressed={editTool === "razor"} onClick={() => setEditTool("razor")} title="Cut tool (C): click footage, audio or a layer" aria-label="Razor tool"><Scissors size={16} /></button>
          <button className="ss-tb-btn" onClick={() => splitAt(currentTime)} title="Split at playhead (Ctrl+K)" aria-label="Split at playhead" disabled={selectedMedia ? config.lockedTracks?.includes("annotations") || (selectedMedia.timeSpace === "sequence" ? sequenceTime(clips,currentTime,activeClipId) : currentTime)-selectedMedia.start<1/frameRate-1e-7 || selectedMedia.end-(selectedMedia.timeSpace === "sequence" ? sequenceTime(clips,currentTime,activeClipId) : currentTime)<1/frameRate-1e-7 : selectedAudio ? !selectedAudioTrack||config.lockedTracks?.includes(selectedAudio.trackId)||!resolvedAudioClips(selectedAudioTrack,clips,audioDurations[selectedAudio.trackId]??duration).some(c=>c.id===selectedAudio.clipId&&sequenceTime(clips,currentTime,activeClipId)-c.start>=1/frameRate/c.speed-1e-7&&c.end-sequenceTime(clips,currentTime,activeClipId)>=1/frameRate/c.speed-1e-7) : videoLocked||!clips.some(c=>!c.gap&&(!activeClipId||c.id===activeClipId)&&currentTime-c.start>=1/frameRate-1e-7&&c.end-currentTime>=1/frameRate-1e-7)}><BetweenHorizontalStart size={17} /></button>
          <button className="ss-tb-btn" onClick={()=>deleteClip()} disabled={selectedMedia ? config.lockedTracks?.includes("annotations") : selectedAudio?config.lockedTracks?.includes(selectedAudio.trackId):videoLocked || !selectedClip || !clips.length} title="Delete selection (Delete)" aria-label={selectedMedia?"Delete selected layer":selectedAudio?"Delete selected audio":"Delete selected footage"}><Trash2 size={16} /></button>
          <button className="ss-tb-btn" aria-pressed={snapping} onClick={() => setSnapping(s => !s)} title="Snapping (S)" aria-label="Snapping"><Magnet size={16} /></button>
</div>
        <button className="ss-tb-btn timeline-view-toggle" onClick={() => setTimeView(view => view === "sequence" ? "source" : "sequence")} title="Switch between joined sequence and original source timeline"><Film size={14}/>{timeView === "sequence" ? "Sequence" : "Source"}<ChevronDown size={12}/></button>
                  {config.videoClips !== null && <button className="ss-tb-btn" disabled={videoLocked} onClick={() => { onVideoClipsChange(null); setSelectedClipId(null); }} title="Restore original footage ranges" aria-label="Restore original footage"><RotateCcw size={16} /></button>}

        <span className="timeline-toolbar-spacer"/>
        <button className="ss-tb-btn timeline-inspector-toggle" disabled={!selectedClip&&!selectedAudio} aria-label="Clip settings" aria-expanded={inspectorOpen && !!(selectedClip||selectedAudio)} onClick={() => setInspectorOpen(open => !open)}><SlidersHorizontal size={16}/><span>{selectedAudio?"Audio":selectedClip ? "Clip " + (clips.indexOf(selectedClip)+1) : "Clip settings"}</span><ChevronDown size={12}/></button>
      </div>
      {trimPreview && videoPath && !inspectorOpen && <div className="timeline-live-trim-preview"><TrimPreview path={videoPath} left={trimPreview.left} right={trimPreview.right} onClose={()=>setTrimPreview(null)}/></div>}
      {inspectorOpen&&selectedAudioTrack&&selectedAudio&&(()=>{
        const track=selectedAudioTrack,locked=config.lockedTracks?.includes(track.id),segments=resolvedAudioClips(track,clips,audioDurations[track.id]??duration),segment=segments.find(clip=>clip.id===selectedAudio.clipId);
        if(!segment)return null;
        const update=(patch:Partial<AudioClip>)=>{if(!locked){const next=editAudioClip(track,clips,audioDurations[track.id]??duration,segment.id,patch);if(next===track){setClipNotice("Audio clips cannot overlap on the same track.");return;}setClipNotice("");onAudioTrackChange(next);}};
        return <aside className="timeline-clip-inspector" style={inspectorLayout} aria-label="Audio clip settings"><header><span><Music2 size={16}/>Audio</span><button aria-label="Close audio settings" onClick={()=>setInspectorOpen(false)}><X size={16}/></button></header>
          <SelectRow label="Link" value={(segment.linked??track.linked??true)&&segment.videoClipId?"linked":"unlinked"} options={["linked","unlinked"]} onChange={value=>{if(locked)return;if(value==="linked"&&!segment.videoClipId){const target=sequenceClip(clips,segment.start);if(!target||target.clip.gap){setClipNotice("Select footage at this audio position first.");return;}update({linked:true,videoClipId:target.clip.id});}else update({linked:value==="linked"});}}/>
          <div className="timeline-source-fields"><label className="timeline-value-field">In<input type="number" min={0} max={segment.sourceEnd-1/frameRate} step={1/frameRate} disabled={locked} value={Number(segment.sourceStart.toFixed(3))} onChange={e=>{const value=e.target.valueAsNumber;if(Number.isFinite(value)&&value>=0&&value<=segment.sourceEnd-1/frameRate)update({sourceStart:Math.round(value*frameRate)/frameRate});}}/></label><label className="timeline-value-field">Out<input type="number" min={segment.sourceStart+1/frameRate} max={audioDurations[track.id]??duration} step={1/frameRate} disabled={locked} value={Number(segment.sourceEnd.toFixed(3))} onChange={e=>{const value=e.target.valueAsNumber;if(Number.isFinite(value)&&value>segment.sourceStart&&value<=(audioDurations[track.id]??duration))update({sourceEnd:Math.round(value*frameRate)/frameRate});}}/></label></div>
          <div className="timeline-source-fields"><label className="timeline-value-field">Volume<input type="number" min={0} max={200} step={5} disabled={locked} value={Math.round((segment.volume??1)*100)} onChange={e=>{if(Number.isFinite(e.target.valueAsNumber))update({volume:Math.max(0,Math.min(2,e.target.valueAsNumber/100))});}}/></label><label className="timeline-value-field">Position<input type="number" min={0} step={1/frameRate} disabled={locked||(segment.linked??track.linked??true)&&!!segment.videoClipId} value={Number(segment.start.toFixed(3))} onChange={e=>{if(Number.isFinite(e.target.valueAsNumber))update({start:Math.max(0,e.target.valueAsNumber)});}}/></label></div>
          <div className="timeline-source-fields">{(["fadeIn","fadeOut"] as const).map(kind=><label className="timeline-value-field" key={kind}>{kind==="fadeIn"?"Fade in":"Fade out"}<input type="number" min={0} max={segment.sourceEnd-segment.sourceStart} step={.05} disabled={locked} value={segment[kind]??0} onChange={e=>{if(Number.isFinite(e.target.valueAsNumber))update({[kind]:Math.max(0,Math.min(segment.sourceEnd-segment.sourceStart,e.target.valueAsNumber))});}}/></label>)}</div>
          <SelectRow label="Pitch" value={track.preservePitch===false?"natural":"preserve"} options={["preserve","natural"]} onChange={value=>{if(!locked)onAudioTrackChange({...track,preservePitch:value==="preserve"});}}/>
          {clipNotice&&<p className="timeline-inline-notice" role="status">{clipNotice}</p>}
          <div className="timeline-inspector-actions"><button className="ss-tb-btn" aria-label="Split audio at playhead" disabled={locked} onClick={()=>onAudioTrackChange(splitAudioClip(track,clips,audioDurations[track.id]??duration,segment.id,sequenceTime(clips,currentTime,activeClipId),frameRate))}><Scissors size={20}/></button><button className="ss-tb-btn" aria-label="Duplicate audio clip" disabled={locked} onClick={()=>onAudioTrackChange(duplicateAudioClip(track,clips,audioDurations[track.id]??duration,segment.id))}><Copy size={20}/></button><button className="ss-tb-btn" aria-label="Delete audio clip" disabled={locked} onClick={()=>{onAudioTrackChange({...track,clips:segments.filter(clip=>clip.id!==segment.id)});setSelectedAudio(null);}}><Trash2 size={20}/></button></div>
        </aside>;
      })()}
      {inspectorOpen && selectedClip && <aside className="timeline-clip-inspector" style={inspectorLayout} aria-label="Clip trim settings" onKeyDown={e => { if(e.key === "Escape") setInspectorOpen(false); }}>
        <header><span><SlidersHorizontal size={16}/>Clip settings</span><button aria-label="Close clip settings" onClick={() => setInspectorOpen(false)}><X size={16}/></button></header>
        {selectedClip.gap ? <button className="ss-drawer-action-btn" disabled={videoLocked} onClick={()=>deleteClip(true)}>Close gap</button> : <>
        <SelectRow label="Effects" value={selectedClip.effects?"independent":"shared"} options={["shared","independent"]} onChange={value=>{if(videoLocked)return;onVideoClipsChange(clips.map(c=>c.id===selectedClip.id?{...c,effects:value==="shared"?undefined:snapshotClipEffects(config,keyframes,captionTracks)}:c));onSeek(selectedClip.start,selectedClip.id);}}/>
        <div className="timeline-source-fields">
          <label className="timeline-value-field">In<input aria-label="Selected clip source in" type="number" step={1/frameRate} disabled={videoLocked} min={0} max={selectedClip.end-MIN_CLIP_SECONDS} value={Number(selectedClip.start.toFixed(3))} onChange={event=>{const value=event.target.valueAsNumber;if(!Number.isFinite(value))return;const start=Math.max(0,Math.min(Math.round(value*frameRate)/frameRate,selectedClip.end-MIN_CLIP_SECONDS));const next=trimClipRange(clips,selectedClip.id,start,selectedClip.end,rippleEdits);setClipNotice(next===clips?"Not enough space to extend this clip.":"");onVideoClipsChange(next);}}/></label>
          <label className="timeline-value-field">Out<input aria-label="Selected clip source out" type="number" step={1/frameRate} disabled={videoLocked} min={selectedClip.start+MIN_CLIP_SECONDS} max={duration} value={Number(selectedClip.end.toFixed(3))} onChange={event=>{const value=event.target.valueAsNumber;if(!Number.isFinite(value))return;const end=Math.min(duration,Math.max(Math.round(value*frameRate)/frameRate,selectedClip.start+MIN_CLIP_SECONDS));const next=trimClipRange(clips,selectedClip.id,selectedClip.start,end,rippleEdits);setClipNotice(next===clips?"Not enough space to extend this clip.":"");onVideoClipsChange(next);}}/></label>
        </div>
        <div className="timeline-source-fields">
          <label className="timeline-value-field">Position<input aria-label="Clip position" type="number" min={0} step={1/frameRate} disabled={videoLocked} value={Number(sequenceTime(clips,selectedClip.start,selectedClip.id).toFixed(3))} onChange={event=>{const next=placeClip(clips,selectedClip.id,event.target.valueAsNumber);if(next===clips){setClipNotice("Choose empty space for this clip.");return;}setClipNotice("");onVideoClipsChange(next);}}/></label>
          <label className="timeline-value-field">Speed<input aria-label="Clip speed" type="number" min={.25} max={4} step={.25} disabled={videoLocked} value={clipSpeed(selectedClip)} onChange={event=>{const next=changeClipSpeed(clips,selectedClip.id,event.target.valueAsNumber,rippleEdits);if(next===clips){setClipNotice("Not enough space. Close a gap or use Ripple speed.");return;}setClipNotice("");onVideoClipsChange(next);}}/></label>
        </div>
        <SelectRow label="Placement" value={rippleEdits?"ripple":"keepPosition"} options={["keepPosition","ripple"]} optionLabels={{keepPosition:"Keep position",ripple:"Ripple"}} onChange={value=>setRippleEdits(value==="ripple")}/>
        <section className="timeline-transition-tools" aria-label="Clip transition">
          <span className="timeline-control-heading">Transition</span>
          <div className="timeline-transition-presets">{TRANSITION_EFFECTS.map(effect=><button key={effect} type="button" aria-label={`${effect} transition`} aria-pressed={(selectedClip.transition?.effect??"none")===effect} disabled={videoLocked||effect!=="none"&&(clips.indexOf(selectedClip)===0||clips[clips.indexOf(selectedClip)-1]?.gap)} onClick={()=>{setClipNotice("");onVideoClipsChange(clips.map(clip=>clip.id===selectedClip.id?{...clip,transition:effect==="none"?undefined:{...selectedClip.transition,effect,duration:Math.min(selectedClip.transition?.duration??.3,clipDuration(selectedClip))}}:clip));}}>
            {effect==="none"?<X size={18}/>:effect==="fade"?<Circle size={18}/>:effect==="dissolve"?<Layers size={18}/>:effect==="zoom"?<ZoomIn size={18}/>:effect==="wipe"?<PanelLeft size={18}/>:effect==="push"?<ArrowLeftRight size={18}/>:<MoveRight size={18}/>}<span>{effect[0].toUpperCase()+effect.slice(1)}</span>
          </button>)}</div>
          {selectedClip.transition&&<>
            <div className="timeline-transition-duration"><span>Duration</span><input aria-label="Transition duration" type="range" min={1/frameRate} max={Math.max(1/frameRate,Math.min(2,clipDuration(selectedClip)))} step={1/frameRate} disabled={videoLocked} value={selectedClip.transition.duration} onChange={event=>onVideoClipsChange(clips.map(clip=>clip.id===selectedClip.id?{...clip,transition:{...selectedClip.transition!,duration:Number(event.target.value)}}:clip))}/><output>{selectedClip.transition.duration.toFixed(2)}s</output></div>
            {["slide","push","wipe"].includes(selectedClip.transition.effect)&&<SelectRow label="Direction" value={selectedClip.transition.direction??"left"} options={["left","right","up","down"]} onChange={direction=>{if(!videoLocked)onVideoClipsChange(clips.map(clip=>clip.id===selectedClip.id?{...clip,transition:{...selectedClip.transition!,direction:direction as "left"|"right"|"up"|"down"}}:clip));}}/>}
            <SelectRow label="Easing" value={selectedClip.transition.easing??"ease-in-out"} options={["linear","ease-in","ease-out","ease-in-out","sine","smoother"]} optionLabels={{"ease-in":"Ease in","ease-out":"Ease out","ease-in-out":"Smooth",sine:"Sine",smoother:"Gentle"}} onChange={easing=>{if(!videoLocked)onVideoClipsChange(clips.map(clip=>clip.id===selectedClip.id?{...clip,transition:{...selectedClip.transition!,easing:easing as Keyframe["easing"]}}:clip));}}/>
          </>}
        </section>

        </>}
        {clipNotice&&<p className="timeline-inline-notice" role="status">{clipNotice}</p>}
        {trimPreview&&videoPath&&<TrimPreview path={videoPath} left={trimPreview.left} right={trimPreview.right} onClose={()=>setTrimPreview(null)}/>}
        <div className="timeline-inspector-actions">          <button className="ss-tb-btn" disabled={videoLocked || !selectedClip} title="Duplicate selected clips" onClick={() => onVideoClipsChange(duplicateClips(clips, selectedClipIds.length ? selectedClipIds : selectedClip ? [selectedClip.id] : []))}><Copy size={16}/></button>
          <button className="ss-tb-btn" disabled={videoLocked || selectedClipIds.length < 2 || clips.flatMap((c,i)=>selectedClipIds.includes(c.id)?[i]:[]).some((index,i,indices)=>i>0&&index!==indices[i-1]+1)} title="Combine adjacent ranges or group adjacent cuts" onClick={() => onVideoClipsChange(combineClips(clips, selectedClipIds))}><Combine size={16}/></button>
          <button className="ss-tb-btn" disabled={videoLocked || !selectedClip} title="Move selected clips to the beginning" onClick={() => onVideoClipsChange(moveClips(clips, selectedClipIds.length ? selectedClipIds : [selectedClip!.id], 0))}><SkipBack size={16}/></button>
          <button className="ss-tb-btn" disabled={videoLocked || !selectedClip} title="Move selected clips to the end" onClick={() => onVideoClipsChange(moveClips(clips, selectedClipIds.length ? selectedClipIds : [selectedClip!.id], clips.length))}><SkipForward size={16}/></button>
</div>
      </aside>}
      {/* ── Multi-Track Area (Video / Audio / Zoom layers) ──────────── */}
      <div className="ss-tracks-wrapper">
        {/* Left label rail */}
        <div className="ss-labels-col">
          <div className="timeline-ruler-label" title="Time"><Clock3 size={13} /></div>
          <div className="track-label video-label" title="Video" onContextMenu={e=>trackHeaderMenu(e,"Video","video","video")}><Film size={15} /><span className="rail-track-name">Video</span><button className="track-lock" aria-label={videoLocked ? "Unlock footage track" : "Lock footage track"} title={videoLocked ? "Unlock footage track" : "Lock footage track"} aria-pressed={videoLocked} onClick={() => onTrackLocksChange?.(videoLocked ? (config.lockedTracks ?? []).filter(id => id !== "video") : [...config.lockedTracks ?? [], "video"])}>{videoLocked ? <Lock size={12}/> : <LockOpen size={12}/>}</button></div>
          {timelineAudioTracks.map((track) => {
            const muted = audioTrackMuted(track);
            const label = audioTrackLabel(track);
            return <div className="track-label audio-label" key={track.id} onContextMenu={e=>{e.preventDefault();e.stopPropagation();setContextMenu({kind:"audio",...menuPosition(e),track,muted,label});}}>
              <button className={`track-label-button ${muted ? "muted" : ""}`} onClick={() => setAudioTrackMuted(track, !muted)} title={`${muted ? "Unmute" : "Mute"} ${label}`}>
                {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
                <span className="track-label-name">{label}</span>
              </button>
            </div>;
          })}
          {animationTracks.map(track=><div key={track.kind} className="track-label animation-label"><Box size={14}/><span className="rail-track-name">{track.label}</span></div>)}
          {zoomSegments.length > 0 && <div className="track-label zoom-label" title="Zoom" onContextMenu={e=>trackHeaderMenu(e,"Zoom","zoom","zoom")}><Sparkles size={14} /><span className="rail-track-name">Zoom</span>{trackLock("zoom","zoom")}</div>}
          {showActionTrack && <div className="track-label action-label" title="Keys & Clicks" onContextMenu={e=>trackHeaderMenu(e,"Actions","action","action")}><Keyboard size={14} /><span className="rail-track-name">Actions</span>{trackLock("action","actions")}</div>}
          {visibleCaptionTracks.map((track) => <div className="track-label caption-label" title="Captions" key={track.id} onContextMenu={e=>trackHeaderMenu(e,track.name || "Captions","caption","caption",track.id)}><Captions size={14} /><span className="rail-track-name">Captions</span>{trackLock("caption","captions")}</div>)}
          {layerRows.map(({id, type, name}) => (
            <div key={id} className={`track-label layer-label ${type}-label`} onContextMenu={e=>trackHeaderMenu(e,name,"annotations","layer",id)} title={type === "shape" ? "Shapes" : type === "mask" ? "Masks" : type === "image" ? "Images" : type === "video" ? "Video overlays" : "Text"}>
              {type === "shape" ? <Shapes size={14} /> : type === "mask" ? <ScanSearch size={14} /> : type === "image" ? <ImageIcon size={14} /> : type === "video" ? <Film size={14} /> : <Type size={14} />}<span className="rail-track-name">{name}</span>{trackLock("annotations","annotations")}
            </div>
          ))}
        </div>

        {/* Shared timeline columns */}
        <div className={`ss-timeline-scroll ${zoomScale > 1 ? "is-zoomed" : ""}`} ref={scrollRef}>
        <div className="ss-timeline-col" data-time-view={timeView} data-timeline-duration={timelineDuration} ref={timeAreaRef} style={{ width: `${zoomScale * 100}%` }} onMouseDownCapture={event => { if (!(event.target instanceof Element && event.target.closest(".footage-segment"))) setSelectedClipId(null); }} onClick={(e) => { const time = getTimeFromEvent(e); const rect = timeAreaRef.current?.getBoundingClientRect(); const target = timeView === "sequence" && rect ? sequenceClip(clips, (e.clientX - rect.left) / rect.width * timelineDuration) : null; onSeek(time, target?.clip.id); }}>
          {mediaDragOver&&<div className="timeline-media-drop-guide" style={{left:timelineDuration?mediaDropTime/timelineDuration*effectiveWidth:0}}><span><Plus size={14}/>New layer · {formatTimecode(mediaDropTime)}</span></div>}
          <div className="timeline-ruler">
            {timelineDuration > 0 ? Array.from({ length: 11 }, (_, index) => <span key={index} style={{ left: `${index * 10}%` }}>{formatTimecode(timelineDuration * index / 10 / (timeView === "sequence" ? config.playbackRate || 1 : 1))}</span>) : <span className="timeline-loading-label">Loading video duration…</span>}
          </div>
          {/* Video layer */}
          <div className="ss-track-row video-track">
            {(trimDraft ?? clips).flatMap((clip,index)=>timeView==="sequence"||!clip.gap?[{clip,index}]:[]).map(({clip,index}) => <div
              key={clip.id}
              draggable={false}
              onPointerMove={event=>{if(editTool!=="razor"||videoLocked||clip.gap)return;const rect=event.currentTarget.getBoundingClientRect();const raw=clip.start+(event.clientX-rect.left)/rect.width*(clip.end-clip.start);const time=Math.round(raw*frameRate)/frameRate;if(time-clip.start<1/frameRate-1e-7||clip.end-time<1/frameRate-1e-7){setCutGuide(null);return;}setCutGuide({id:clip.id,time,left:(time-clip.start)/(clip.end-clip.start)*rect.width});}}
              onPointerLeave={()=>setCutGuide(null)}
              onPointerDown={event => {
                if (videoLocked || clip.gap || editTool !== "select" || event.button !== 0 || event.ctrlKey || event.metaKey || (event.target as HTMLElement).closest?.(".footage-trim-handle")) return;
                suppressClipClick.current=false;
                const origin=event.clientX;
                const ids=selectedClipIds.includes(clip.id) ? selectedClipIds : clip.groupId ? clips.filter(c=>c.groupId===clip.groupId).map(c=>c.id) : [clip.id];
                let dragReorder=event.shiftKey;
                let destination=index, moved=false, placement=sequenceTime(clips,clip.start,clip.id);
                const move=(e: PointerEvent) => {
                  if(!moved && Math.abs(e.clientX-origin)<6) return;
                  if (!moved && timeView === "source") setTimeView("sequence");
                  moved=true; suppressClipClick.current=true;
                  const area=timeAreaRef.current?.getBoundingClientRect(); if(!area) return;
                  let elapsed=0; destination=clips.length;
                  const time=(e.clientX-area.left)/area.width*sequenceDuration(clips);
                  placement=Math.max(0,Math.round((sequenceTime(clips,clip.start,clip.id)+(e.clientX-origin)/area.width*sequenceDuration(clips))*frameRate)/frameRate);
                  for(let i=0;i<clips.length;i++) { const length=clipDuration(clips[i]); if(time<elapsed+length/2) { destination=i; break; } elapsed+=length; }
                  setSelectedClipId(clip.id); setSelectedClipIds(ids); setReorderIndex(destination);
                  dragReorder=e.shiftKey;
                  const freePlacement=ids.length===1&&clips.some(c=>c.gap)&&!e.shiftKey;
                  if(freePlacement&&snapping){const starts=clips.reduce<number[]>((values,item)=>[...values,values[values.length-1]+clipDuration(item)],[0]);const threshold=8/area.width*sequenceDuration(clips);const target=starts.find(point=>Math.abs(point-placement)<=threshold);if(target!==undefined)placement=target;}
                  setDragPreview({x:e.clientX,y:e.clientY,ids,destination,position:freePlacement?placement:undefined,valid:!freePlacement||placeClip(clips,clip.id,placement)!==clips});
                  const scroll=scrollRef.current;
                  if(scroll) { const bounds=scroll.getBoundingClientRect(); if(e.clientX>bounds.right-36) scroll.scrollLeft+=18; else if(e.clientX<bounds.left+36) scroll.scrollLeft-=18; }
                  e.preventDefault();
                };
                const cleanup=()=>{ window.removeEventListener("pointermove",move); window.removeEventListener("pointerup",up); window.removeEventListener("pointercancel",cancel); dragCleanupRef.current=null; };
                const up=()=>{cleanup();setReorderIndex(null);setDragPreview(null);if(moved){
                  if(ids.length===1&&clips.some(c=>c.gap)&&!dragReorder){const next=placeClip(clips,clip.id,placement);if(next===clips){setClipNotice("Choose empty space or hold Shift to reorder.");setInspectorOpen(true);}else{setClipNotice("");onVideoClipsChange(next);}}
                  else onVideoClipsChange(moveClips(clips,ids,destination));
                }};
                const cancel=()=>{cleanup();setReorderIndex(null);setDragPreview(null);suppressClipClick.current=false;};
                dragCleanupRef.current?.();dragCleanupRef.current=cleanup;
                window.addEventListener("pointermove",move);window.addEventListener("pointerup",up);window.addEventListener("pointercancel",cancel);
              }}
              role="button" tabIndex={0} aria-label={`Footage segment ${index + 1}`} aria-pressed={selectedClipId === clip.id}
              className={`amber-clip-block footage-segment ${selectedClipIds.includes(clip.id) || selectedClipId === clip.id ? "selected" : ""} ${editTool === "razor" ? "razor" : ""} ${videoLocked ? "is-locked" : ""} ${dragPreview?.ids.includes(clip.id) ? "is-reordering" : ""} ${clip.groupId ? "combined" : ""} ${clip.gap ? "gap-clip" : ""}`}
              style={{
                backgroundImage: !clip.gap && thumbnailStrip ? `url("${thumbnailStrip}")` : undefined,
                backgroundSize: "auto 100%",
                backgroundPosition: `${Math.min(9,Math.floor(clip.start/Math.max(.1,duration)*10))/9*100}% center`,
                left: x(clip.start, clip.id),
                width: (timeView==="sequence"?clipDuration(clip):clip.end-clip.start)/Math.max(.001,timelineDuration)*effectiveWidth,
              }}
              onClick={event => { event.stopPropagation(); if(suppressClipClick.current) { suppressClipClick.current=false; return; } event.currentTarget.focus(); setSelectedClipId(clip.id);setSelectedAudio(null);
                setSelectedClipIds(ids => event.ctrlKey || event.metaKey ? ids.includes(clip.id) ? ids.filter(id => id !== clip.id) : [...ids, clip.id] : clip.groupId ? clips.filter(c=>c.groupId===clip.groupId).map(c=>c.id) : [clip.id]);
                if (editTool === "razor") { if (!videoLocked) { const next = splitClip(clips, Math.round(getTimeFromEvent(event) * frameRate) / frameRate, clip.id, frameRate); if (next.length !== clips.length) onVideoClipsChange(next); } }
                else onSeek(getTimeFromEvent(event), clip.id);
              }}
              onKeyDown={event => { if (event.key === "Enter") { setSelectedClipId(clip.id); onSeek(clip.start, clip.id); } }}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setSelectedClipId(clip.id);
                setContextMenu({ kind: "clip", ...menuPosition(event) });
              }}
            >
              {cutGuide?.id===clip.id&&<span className="timeline-cut-guide" style={{left:cutGuide.left}}><Scissors size={14}/><small>{formatTimecode(sequenceTime(clips,cutGuide.time,clip.id))}</small></span>}
              {clip.transition&&<div className="timeline-transition" style={{width:Math.min(clip.transition.duration,clipDuration(clip))*(timeView==="source"?clipSpeed(clip):1)/Math.max(.001,timelineDuration)*effectiveWidth}} onPointerDown={event=>event.stopPropagation()}><button className="timeline-transition-open" aria-label="Edit transition" title={`${clip.transition.effect} transition`} onClick={event=>{event.stopPropagation();setSelectedAudio(null);setSelectedClipId(clip.id);setInspectorOpen(true);}}><Sparkles size={14}/></button><span className="timeline-transition-handle" role="slider" tabIndex={videoLocked?-1:0} aria-label="Transition length" aria-valuemin={1/frameRate} aria-valuemax={Math.min(2,clipDuration(clip))} aria-valuenow={clip.transition.duration} onPointerDown={event=>resizeTransition(event,clip)} onClick={event=>event.stopPropagation()} onKeyDown={event=>{if(event.key!=="ArrowLeft"&&event.key!=="ArrowRight")return;event.preventDefault();event.stopPropagation();if(!videoLocked)onVideoClipsChange(clips.map(item=>item.id===clip.id?{...item,transition:{...clip.transition!,duration:Math.max(1/frameRate,Math.min(2,clipDuration(clip),clip.transition!.duration+(event.key==="ArrowLeft"?-1:1)*(event.shiftKey?10:1)/frameRate))}}:item));}}/></div>}
              {!clip.transition&&!clip.gap&&index>0&&!clips[index-1].gap&&<button className="timeline-add-transition" aria-label="Add transition at this cut" disabled={videoLocked} onPointerDown={event=>event.stopPropagation()} onClick={event=>{event.stopPropagation();setSelectedAudio(null);setSelectedClipId(clip.id);setInspectorOpen(true);onVideoClipsChange(clips.map(item=>item.id===clip.id?{...item,transition:{effect:"dissolve",duration:Math.min(.3,clipDuration(clip))}}:item));}}><Plus size={14}/></button>}
              <div className="clip-tag-content">
                <GripVertical size={12} className="clip-drag-grip"/>
                <span>{clip.gap ? "Gap" : `Clip ${index + 1}`}</span>
                <span className="clip-info">{(clipDuration(clip) / (config.playbackRate || 1)).toFixed(1)}s</span>
              </div>
              {!clip.gap && <><div className="footage-trim-handle start" title="Trim segment start" onMouseDown={e => trimClip(e, clip, "start")} onClick={e => e.stopPropagation()} />
              <div className="footage-trim-handle end" title="Trim segment end" onMouseDown={e => trimClip(e, clip, "end")} onClick={e => e.stopPropagation()} /></>}
            </div>)}

            {reorderIndex !== null && <div className="clip-insertion-marker" aria-label="Clip insertion position" style={{ left: `${(dragPreview?.position??clips.slice(0,reorderIndex).reduce((sum,c)=>sum+clipDuration(c),0))/Math.max(.001,sequenceDuration(clips))*100}%` }}/>}
            {config.cuts.map((cutTime, i) => (
              <div key={i} className="cut-marker-line" style={{ left: x(cutTime), display: timeView === "sequence" && !clips.some(c => cutTime >= c.start && cutTime < c.end) ? "none" : undefined }} title={`Marker at ${formatTimecode(cutTime)} — double-click to remove`} onDoubleClick={(event) => { event.stopPropagation(); onCutsChange(config.cuts.filter((time) => time !== cutTime)); }}>
                <div className="cut-marker-head" />
              </div>
            ))}
          </div>

          {timelineAudioTracks.map((track) => {
            const muted = audioTrackMuted(track);
            return <div
              className={`ss-track-row audio-track ${track.kind}-audio ${muted ? "muted" : ""}`}
              title={track.label}
              key={track.id}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setContextMenu({ kind: "audio", ...menuPosition(event), track, muted, label: track.label });
              }}
            >
              <div className="audio-clips-lane">
              {resolvedAudioClips(track,clips,audioDurations[track.id]??duration).map(segment=>{
                const denominator=timeView==="sequence"?timelineDuration:duration;
                const start=timeView==="sequence"?segment.start:segment.sourceStart,end=timeView==="sequence"?segment.end:segment.sourceEnd;
                const raw=waveforms[track.id];const sourceDuration=audioDurations[track.id]??duration;
                const bins=raw?.slice(Math.floor(segment.sourceStart/Math.max(.001,sourceDuration)*raw.length),Math.max(1,Math.ceil(segment.sourceEnd/Math.max(.001,sourceDuration)*raw.length)));
                return <div key={segment.id} role="button" tabIndex={0} aria-label={`${track.label} audio clip`} onPointerMove={event=>{if(editTool!=="razor"||config.lockedTracks?.includes(track.id))return;const rect=event.currentTarget.getBoundingClientRect();const raw=segment.sourceStart+(event.clientX-rect.left)/rect.width*(segment.sourceEnd-segment.sourceStart);const source=Math.round(raw*frameRate)/frameRate;if(source-segment.sourceStart<1/frameRate-1e-7||segment.sourceEnd-source<1/frameRate-1e-7){setCutGuide(null);return;}setCutGuide({id:segment.id,time:segment.start+(source-segment.sourceStart)/segment.speed,left:(source-segment.sourceStart)/(segment.sourceEnd-segment.sourceStart)*rect.width});}} onPointerLeave={()=>setCutGuide(null)} className={`timeline-audio-clip ${editTool==="razor"?"razor":""} ${config.lockedTracks?.includes(track.id)?"is-locked":""} ${selectedAudio?.trackId===track.id&&selectedAudio.clipId===segment.id?"selected":""}`} style={{left:start/Math.max(.001,denominator)*effectiveWidth,width:(end-start)/Math.max(.001,denominator)*effectiveWidth}} onPointerDown={event=>beginAudioEdit(event,track,segment,"move")} onClick={event=>{event.stopPropagation();setSelectedAudio({trackId:track.id,clipId:segment.id});setSelectedClipId(null);if(editTool==="razor"){if(!config.lockedTracks?.includes(track.id)){const rect=timeAreaRef.current?.getBoundingClientRect();const at=rect?(event.clientX-rect.left)/rect.width*timelineDuration:segment.start;onAudioTrackChange(splitAudioClip(track,clips,sourceDuration,segment.id,at,frameRate));}}else{const rect=timeAreaRef.current?.getBoundingClientRect();const at=rect&&Number.isFinite(event.clientX)?Math.max(segment.start,Math.min(segment.end,(event.clientX-rect.left)/rect.width*sequenceDuration(clips))):Math.max(segment.start,Math.min(segment.end,timelineTime(currentTime,activeClipId)));const target=sequenceClip(clips,at);if(target)onSeek(target.source,target.clip.id);}}} onKeyDown={event=>{if(event.key==="Delete"||event.key==="Backspace"){event.preventDefault();event.stopPropagation();if(!config.lockedTracks?.includes(track.id))onAudioTrackChange({...track,clips:resolvedAudioClips(track,clips,sourceDuration).filter(clip=>clip.id!==segment.id)});}}} onContextMenu={event=>{event.preventDefault();event.stopPropagation();setSelectedAudio({trackId:track.id,clipId:segment.id});setSelectedClipId(null);setContextMenu({kind:"audio",...menuPosition(event),track,muted,label:track.label,clipId:segment.id});}}>
                  <button className="layer-bar-handle left" aria-label="Trim audio start" onPointerDown={event=>beginAudioEdit(event,track,segment,"start")}/>
                  {cutGuide?.id===segment.id&&<span className="timeline-cut-guide" style={{left:cutGuide.left}}><Scissors size={14}/><small>{formatTimecode(cutGuide.time)}</small></span>}
                  {bins?.length?<WaveRow data={bins} theme={editorTheme}/>:<span className="empty-track-label">{waveformErrors.has(track.id)?"Waveform unavailable":"Reading waveform…"}</span>}
                  <span className="audio-clip-name">{track.label}</span><button className="layer-bar-handle right" aria-label="Trim audio end" onPointerDown={event=>beginAudioEdit(event,track,segment,"end")}/>
                </div>;
              })}</div>
            </div>;
          })}

          {animationTracks.map(track=><div key={track.kind} className="ss-track-row animation-track" aria-label={`${track.label} keyframes`}><div className="animation-track-line"/>{track.kind==="tilt"?(timeView==="sequence"?clips:[clips.find(c=>c.id===activeClipId)??clips[0]]).filter(clip=>clip&&!clip.gap).flatMap(clip=>renderAnimationKeys(clip.effects?.config.screenTilt?.keys??(clip.effects?[]:track.keys),track.kind,track.kind,0,duration,clip.id)):renderAnimationKeys(track.keys,track.kind,track.kind)}</div>)}
          {/* Zoom / Animation layer */}
          {zoomInstances.length > 0 && <div className="ss-track-row zoom-track">
            <div className="zoom-connecting-line" />
            {zoomInstances.map(({item:segment,clipId,start:visibleStart,end:visibleEnd}, index) => (
              <div
                key={`zoom-${index}`}
                className={`zoom-segment-bar ${segment.source} ${selectedZoomRegion && (!selectedZoomRegion.clipId || selectedZoomRegion.clipId === clipId) && (
                  selectedZoomRegion.regionId && segment.regionId
                    ? selectedZoomRegion.regionId === segment.regionId
                    : Math.abs(selectedZoomRegion.startMs - segment.start * 1000) < 2 && Math.abs(selectedZoomRegion.endMs - segment.end * 1000) < 2
                ) ? "selected" : ""}`}
                style={{ left: x(visibleStart,clipId), width: Math.max(2, w(visibleEnd-visibleStart,visibleStart,clipId)) }}
                onPointerDown={(event) => beginZoomEdit(event, segment, "move",clipId)}
                onClick={(event) => event.stopPropagation()}
                onContextMenu={(event) => {
                  onSeek(visibleStart,clipId);
                  event.preventDefault();
                  event.stopPropagation();
                  const position = menuPosition(event);
                  setContextMenu({
                    kind: "zoom",
                    ...position,
                    region: { startMs: Math.round(segment.start * 1000), endMs: Math.round(segment.end * 1000), regionId: segment.regionId, clipId },
                  });
                }}
                title="Drag to move · drag either edge to change duration"
              >
                <button className="zoom-bar-handle left" onPointerDown={(event) => beginZoomEdit(event, segment, "start",clipId)} aria-label="Change zoom start" />
                <span><i className="zoom-source-dot" />{segment.scale.toFixed(1)}×</span>
                <button className="zoom-bar-handle right" onPointerDown={(event) => beginZoomEdit(event, segment, "end",clipId)} aria-label="Change zoom end" />
              </div>
            ))}
          </div>}

          {showActionTrack && <div className="ss-track-row action-track" title="Keys and clicks overlay layer">
            {instances(resolvedActionEvents,a=>[a.ts/1000,(a.ts+a.durationMs)/1000]).map(({item:action,clipId,start:visibleStart,end:visibleEnd}) => (
              <div
                key={`${action.id}-${clipId}`}
                className={`action-event-bar ${action.kind} ${action.hidden ? "hidden" : ""} ${selectedActionId === action.id ? "selected" : ""}`}
                style={{ left: x(visibleStart,clipId), width: Math.max(2,w(visibleEnd-visibleStart,visibleStart,clipId)) }}
                onPointerDown={(event) => beginActionEdit(event, action, "move",clipId)}
                onClick={(event) => { event.stopPropagation(); onActionSelect(action.id); onSeek(action.ts / 1000,clipId); }}
                onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setContextMenu({ kind: "action", ...menuPosition(event), action }); }}
                title={`${action.label} · ${(action.ts / 1000).toFixed(2)}s · drag to move, resize from either edge`}
              >
                <button className="action-bar-handle left" onPointerDown={(event) => beginActionEdit(event, action, "start",clipId)} aria-label="Change action start" />
                <Keyboard size={10} /><span>{action.label}</span>
                <button className="action-bar-handle right" onPointerDown={(event) => beginActionEdit(event, action, "end",clipId)} aria-label="Change action duration" />
              </div>
            ))}
          </div>}

          {visibleCaptionTracks.map((track) => (
            <div className="ss-track-row caption-track" key={track.id}>
              {effectInstances(track.segments,clip=>clip?.effects?clip.effects.captions.find(t=>t.id===track.id)?.segments??[]:undefined,s=>[s.startMs/1000,s.endMs/1000]).map(({item:segment,clipId,start:visibleStart,end:visibleEnd}) => (
                <div
                  className={`caption-clip-bar ${selectedCaption?.trackId === track.id && selectedCaption.segmentId === segment.id && (!selectedCaption.clipId || selectedCaption.clipId === clipId) ? "selected" : ""}`}
                  key={`${segment.id}-${clipId}`}
                  style={{ left: x(visibleStart,clipId), width: Math.max(2,w(visibleEnd-visibleStart,visibleStart,clipId)) }}
                  onPointerDown={(event) => beginCaptionEdit(event, track.id, segment, "move",clipId)}
                  onClick={(event) => { event.stopPropagation(); onSeek(visibleStart,clipId); onCaptionSegmentSelect({ trackId: track.id, segmentId: segment.id, clipId }); }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onSeek(visibleStart,clipId);
                    setContextMenu({ kind: "caption", ...menuPosition(event), trackId: track.id, segment, clipId });
                  }}
                  title="Drag to move · drag edges to change timing"
                >
                  <button className="layer-bar-handle left" onPointerDown={(event) => beginCaptionEdit(event, track.id, segment, "start",clipId)} aria-label="Change caption start" />
                  <span>{segment.text}</span>
                  <button className="layer-bar-handle right" onPointerDown={(event) => beginCaptionEdit(event, track.id, segment, "end",clipId)} aria-label="Change caption end" />
                </div>
              ))}
            </div>
          ))}

          {layerRows.map(({id, type, items}) => (
            <div key={id} className={`ss-track-row layer-track ${type}-track`}>
              <div className="layer-connecting-line" />
              {layerInstances(items).map(({item:layer,clipId,start:visibleStart,end:visibleEnd}) => {
                const name = layer.type === "text" ? layer.content || "Text" : layer.type === "shape" ? layer.shape : layer.type === "mask" ? layer.mask : layer.path.split(/[\\/]/).pop() || "Image";
                return (
                  <div
                    key={`${layer.id}-${clipId}`}
                    className={`layer-clip-bar ${type} ${editTool === "razor" ? "razor" : ""} ${selectedLayerId === layer.id ? "selected" : ""}`}
                    style={{ left: x(visibleStart,clipId), width: Math.max(2, w(visibleEnd-visibleStart,visibleStart,clipId)) }}
                    onPointerDown={(event) => beginLayerEdit(event, layer, "move",clipId)}
                    onClick={(event) => { event.stopPropagation(); if(editTool==="razor" && onLayerSplit && !config.lockedTracks?.includes("annotations")){const rect=event.currentTarget.getBoundingClientRect();const at=visibleStart+(event.clientX-rect.left)/rect.width*(visibleEnd-visibleStart);const parts=splitMediaLayer(layer,at,frameRate);if(parts.length>1)onLayerSplit(layer,parts);} }}
                    onPointerMove={event=>{if(editTool!=="razor"||config.lockedTracks?.includes("annotations"))return;const rect=event.currentTarget.getBoundingClientRect();const time=Math.round((visibleStart+(event.clientX-rect.left)/rect.width*(visibleEnd-visibleStart))*frameRate)/frameRate;setCutGuide(time-layer.start>=1/frameRate-1e-7&&layer.end-time>=1/frameRate-1e-7?{id:layer.id,time,left:(time-visibleStart)/(visibleEnd-visibleStart)*rect.width}:null);}}
                    onPointerLeave={()=>setCutGuide(null)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setContextMenu({ kind: "layer", ...menuPosition(event), layer });
                    }}
                    title={`${name} · drag to move, trim either edge`}
                  >
                    <button className="layer-bar-handle left" onPointerDown={(event) => beginLayerEdit(event, layer, "start",clipId)} aria-label={`Change ${type} start`} />
                    {cutGuide?.id===layer.id&&<span className="timeline-cut-guide" style={{left:cutGuide.left}}><Scissors size={14}/></span>}
                    <span>{name}</span>
                    <button className="layer-bar-handle right" onPointerDown={(event) => beginLayerEdit(event, layer, "end",clipId)} aria-label={`Change ${type} end`} />
                  </div>
                );
              })}
              {items.map(layer=>renderAnimationKeys(layer.animation??[],"layer",layer.id,layer.start,layer.end))}
            </div>
          ))}

          {/* Trim controls belong to the clip, not the audio/zoom tracks. */}
          {duration > 0 && <>
          <div
            title="Trim start"
            className={`ss-trim-handle in-handle ${dragging === "trim-start" ? "dragging" : ""}`}
            style={{ left: x(config.trimStart), display: timeView === "sequence" ? "none" : undefined }}
            onMouseDown={handleMouseDown("trim-start")}
          />
          <div
            title="Trim end"
            className={`ss-trim-handle out-handle ${dragging === "trim-end" ? "dragging" : ""}`}
            style={{ left: x(config.trimEnd || duration), display: timeView === "sequence" ? "none" : undefined }}
            onMouseDown={handleMouseDown("trim-end")}
          />
          <div
            className={`ss-playhead-needle ${dragging === "playhead" ? "dragging" : ""}`}
            style={{ left: x(currentTime) }}
            onMouseDown={handleMouseDown("playhead")}
          >
            <div className="playhead-cap" />
            <div className="playhead-line" />
          </div>
          </>}
        </div>
        </div>
      </div>
      {dragPreview && createPortal(<div className="timeline-drag-preview" style={{left:Math.max(8,Math.min(dragPreview.x+18,window.innerWidth-192)),top:Math.max(8,Math.min(dragPreview.y-80,window.innerHeight-96))}} aria-label="Clip reorder preview">
        <div className="timeline-drag-thumbnail" style={{backgroundImage:thumbnailStrip ? `url("${thumbnailStrip}")` : undefined}}><GripVertical size={16}/><strong>{dragPreview.ids.length > 1 ? `${dragPreview.ids.length} clips` : `Clip ${clips.findIndex(c=>c.id===dragPreview.ids[0])+1}`}</strong><span>{clips.filter(c=>dragPreview.ids.includes(c.id)).reduce((sum,c)=>sum+clipDuration(c),0).toFixed(1)}s</span></div>
        <small>{dragPreview.position!==undefined ? (dragPreview.valid?`Place at ${formatTimecode(dragPreview.position)}`:"Occupied space") : dragPreview.destination === clips.length ? "Move to end" : dragPreview.destination === 0 ? "Move to beginning" : `Insert before clip ${dragPreview.destination+1}`}</small>
      </div>, document.body)}
      {contextMenu && createPortal(
        <div
          ref={contextMenuRef}
          className={`timeline-context-menu theme-${editorTheme}`}
          style={{ left: contextMenu.x, top: contextMenu.y }}
          role="menu"
          aria-label={`${contextMenu.kind} actions`}
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={handleContextMenuKeys}
        >
          <div className="timeline-context-title">
            {contextMenu.kind === "animation-key" ? `${contextMenu.label} keyframe` : contextMenu.kind === "track" ? `${contextMenu.label} track` : contextMenu.kind === "zoom" ? "Zoom region"
              : contextMenu.kind === "layer" ? `${contextMenu.layer.type} layer`
                : contextMenu.kind === "caption" ? "Caption segment"
                  : contextMenu.kind === "audio" ? contextMenu.label
                    : contextMenu.kind === "action" ? contextMenu.action.label
                    : "Video clip"}
          </div>
          {contextMenu.kind === "animation-key" && <>
            <button role="menuitem" onClick={()=>{keyClipboard.current={kind:contextMenu.animationKind,keys:copyKeys(animationKeys(contextMenu.animationKind,contextMenu.id,contextMenu.clipId),selectedTimes(contextMenu.animationKind,contextMenu.id,contextMenu.clipId,contextMenu.time))};setContextMenu(null);}}><Copy size={15}/>Copy selected keyframes</button>
            <button role="menuitem" disabled={!onAnimationKeysChange||keyClipboard.current?.kind!==contextMenu.animationKind||config.lockedTracks?.includes(contextMenu.animationKind==="layer"?"annotations":contextMenu.animationKind)} onClick={()=>{pasteAnimation(contextMenu.animationKind,contextMenu.id,contextMenu.clipId);setContextMenu(null);}}>Paste at playhead</button>
            {([-1,1] as const).map(direction=><button role="menuitem" key={direction} onClick={()=>{const times=animationKeys(contextMenu.animationKind,contextMenu.id,contextMenu.clipId).map(k=>k.time).sort((a,b)=>a-b);const time=direction<0?[...times].reverse().find(t=>t<contextMenu.time-1e-6):times.find(t=>t>contextMenu.time+1e-6);if(time!==undefined)seekKeyTime(time+(contextMenu.animationKind==="layer"?layers.find(l=>l.id===contextMenu.id)?.start??0:0),contextMenu.clipId);setContextMenu(null);}}>{direction<0?<StepBack size={15}/>:<StepForward size={15}/>} {direction<0?"Previous":"Next"} keyframe</button>)}

            <button role="menuitem" onClick={()=>{seekKeyTime(contextMenu.sourceTime,contextMenu.clipId);if(contextMenu.animationKind==="layer")onLayerSelect(contextMenu.id);setContextMenu(null);}}><Diamond size={15}/>Go to keyframe</button>
            <button role="menuitem" className="danger" disabled={!onAnimationKeyChange||config.lockedTracks?.includes(contextMenu.animationKind==="layer"?"annotations":contextMenu.animationKind)} onClick={()=>{const times=selectedTimes(contextMenu.animationKind,contextMenu.id,contextMenu.clipId,contextMenu.time);if(times.length>1&&onAnimationKeysChange)onAnimationKeysChange(contextMenu.animationKind,contextMenu.id,animationKeys(contextMenu.animationKind,contextMenu.id,contextMenu.clipId).filter(k=>!times.includes(k.time)),contextMenu.clipId);else onAnimationKeyChange?.(contextMenu.animationKind,contextMenu.id,contextMenu.time,null,contextMenu.clipId);setSelectedKeys([]);setContextMenu(null);}}><Trash2 size={15}/>Remove keyframe</button>
          </>}
          {contextMenu.kind === "track" && <>
            <button role="menuitem" onClick={()=>{const locks=config.lockedTracks??[];onTrackLocksChange?.(locks.includes(contextMenu.lockId)?locks.filter(id=>id!==contextMenu.lockId):[...locks,contextMenu.lockId]);setContextMenu(null);}}>{config.lockedTracks?.includes(contextMenu.lockId)?<LockOpen size={15}/>:<Lock size={15}/>} {config.lockedTracks?.includes(contextMenu.lockId)?"Unlock track":"Lock track"}</button>
            {contextMenu.trackKind === "video" && <button role="menuitem" onClick={()=>{setSelectedClipIds(clips.map(c=>c.id));setSelectedClipId(clips[0]?.id??null);setContextMenu(null);}}><Copy size={15}/>Select all clips</button>}
            {contextMenu.trackKind === "caption" && <button role="menuitem" disabled={config.lockedTracks?.includes(contextMenu.lockId)} onClick={()=>{onAddCaptionAtTime(currentTime);setContextMenu(null);}}><Captions size={15}/>Add caption at playhead</button>}
            <div className="timeline-context-separator"/>
            <button className="danger" role="menuitem" disabled={!onTrackClear || config.lockedTracks?.includes(contextMenu.lockId)} onClick={()=>{onTrackClear?.(contextMenu.trackKind,contextMenu.id);setContextMenu(null);}}><Trash2 size={15}/>{contextMenu.trackKind === "video" ? "Restore footage & clear markers" : contextMenu.trackKind === "action" ? "Hide all actions" : `Clear all ${contextMenu.trackKind === "zoom" ? "zooms" : contextMenu.trackKind === "caption" ? "captions" : contextMenu.label.toLowerCase()}`}</button>
          </>}
          {contextMenu.kind === "action" && <>
            <button role="menuitem" onClick={() => { onActionSelect(contextMenu.action.id); onSeek(contextMenu.action.ts / 1000); setContextMenu(null); }}>
              <SlidersHorizontal size={15} /> Go to and edit
            </button>
            <button role="menuitem" onClick={() => { onActionEdit(contextMenu.action.id, { hidden: !contextMenu.action.hidden }); setContextMenu(null); }}>
              {contextMenu.action.hidden ? <Keyboard size={15} /> : <VolumeX size={15} />}{contextMenu.action.hidden ? "Show action" : "Hide action"}
            </button>
            <button role="menuitem" onClick={() => { onActionEdit(contextMenu.action.id, { offsetMs: 0, durationMs: config.actionOverlay.holdMs, label: actionEvents.find((action) => action.id === contextMenu.action.id)?.label ?? contextMenu.action.label, hidden: false }); setContextMenu(null); }}>
              <RotateCcw size={15} /> Reset action
            </button>
          </>}
          {(contextMenu.kind === "zoom" || contextMenu.kind === "layer") && <>
            <button role="menuitem" onClick={() => {
              if (contextMenu.kind === "zoom") onZoomRegionSelect(contextMenu.region);
              else onLayerSelect(contextMenu.layer.id);
              setContextMenu(null);
            }}>
              <SlidersHorizontal size={15} /> Edit parameters
            </button>
            <button role="menuitem" onClick={() => {
              if (contextMenu.kind === "zoom") onZoomRegionDuplicate(contextMenu.region);
              else onLayerDuplicate(contextMenu.layer.id);
              setContextMenu(null);
            }}>
              <Copy size={15} /> Duplicate
            </button>
            <div className="timeline-context-separator" />
            <button className="danger" role="menuitem" onClick={() => {
              if (contextMenu.kind === "zoom") onZoomRegionDelete(contextMenu.region);
              else onLayerDelete(contextMenu.layer.id);
              setContextMenu(null);
            }}>
              <Trash2 size={15} /> Remove
            </button>
          </>}
          {contextMenu.kind === "caption" && <>
            <button role="menuitem" onClick={() => { onCaptionSegmentSelect({ trackId: contextMenu.trackId, segmentId: contextMenu.segment.id, clipId: contextMenu.clipId }); onSeek(contextMenu.segment.startMs / 1000, contextMenu.clipId); setContextMenu(null); }}>
              <SlidersHorizontal size={15} /> Go to and edit
            </button>
            <button role="menuitem" onClick={() => { onCaptionSegmentDuplicate(contextMenu.trackId, contextMenu.segment.id); setContextMenu(null); }}>
              <Copy size={15} /> Duplicate
            </button>
            <div className="timeline-context-separator" />
            <button className="danger" role="menuitem" onClick={() => { onCaptionSegmentDelete(contextMenu.trackId, contextMenu.segment.id); setContextMenu(null); }}>
              <Trash2 size={15} /> Remove
            </button>
          </>}
          {contextMenu.kind === "audio" && <>
            {contextMenu.clipId&&<>
              <button role="menuitem" disabled={config.lockedTracks?.includes(contextMenu.track.id)} onClick={()=>{setInspectorOpen(true);setContextMenu(null);}}><SlidersHorizontal size={15}/>Clip settings</button>
              <button role="menuitem" disabled={config.lockedTracks?.includes(contextMenu.track.id)} onClick={()=>{const track=contextMenu.track;onAudioTrackChange(splitAudioClip(track,clips,audioDurations[track.id]??duration,contextMenu.clipId!,sequenceTime(clips,currentTime,activeClipId),frameRate));setContextMenu(null);}}><BetweenHorizontalStart size={15}/>Split at playhead</button>
              <button role="menuitem" disabled={config.lockedTracks?.includes(contextMenu.track.id)} onClick={()=>{const track=contextMenu.track,segments=resolvedAudioClips(track,clips,audioDurations[track.id]??duration);onAudioTrackChange({...track,linked:track.linked===false,clips:segments.map(segment=>({...segment,linked:track.linked===false}))});setContextMenu(null);}}><Combine size={15}/>{contextMenu.track.linked===false?"Link audio":"Unlink audio"}</button>
              <button role="menuitem" disabled={config.lockedTracks?.includes(contextMenu.track.id)} onClick={()=>{const track=contextMenu.track;onAudioTrackChange(duplicateAudioClip(track,clips,audioDurations[track.id]??duration,contextMenu.clipId!));setContextMenu(null);}}><Copy size={15}/>Duplicate clip</button>
              <button role="menuitem" className="danger" disabled={config.lockedTracks?.includes(contextMenu.track.id)} onClick={()=>{const track=contextMenu.track;onAudioTrackChange({...track,clips:resolvedAudioClips(track,clips,audioDurations[track.id]??duration).filter(clip=>clip.id!==contextMenu.clipId)});setSelectedAudio(null);setContextMenu(null);}}><Trash2 size={15}/>Delete clip</button><div className="timeline-context-separator"/>
            </>}

            <button role="menuitem" onClick={() => { const locks=config.lockedTracks??[]; onTrackLocksChange?.(locks.includes(contextMenu.track.id)?locks.filter(id=>id!==contextMenu.track.id):[...locks,contextMenu.track.id]); setContextMenu(null); }}>
              {config.lockedTracks?.includes(contextMenu.track.id) ? <LockOpen size={15}/> : <Lock size={15}/>}{config.lockedTracks?.includes(contextMenu.track.id) ? "Unlock track" : "Lock track"}
            </button>
            <button role="menuitem" disabled={config.lockedTracks?.includes(contextMenu.track.id)} onClick={() => {
              setAudioTrackMuted(contextMenu.track, !contextMenu.muted);
              setContextMenu(null);
            }}>
              {contextMenu.muted ? <Volume2 size={15} /> : <VolumeX size={15} />}
              {contextMenu.muted ? "Unmute track" : "Mute track"}
            </button>
            {contextMenu.track.kind === "imported" && <>
              <div className="timeline-context-separator" />
              <button className="danger" role="menuitem" disabled={config.lockedTracks?.includes(contextMenu.track.id)} onClick={() => { onAudioTrackRemove(contextMenu.track.id); setContextMenu(null); }}>
                <Trash2 size={15} /> Remove audio
              </button>
            </>}
          </>}
          {contextMenu.kind === "clip" && <>
            <button role="menuitem" onClick={() => { splitAt(currentTime); setContextMenu(null); }}><Scissors size={15} /> Split at playhead · Ctrl+K</button>
            <button role="menuitem" disabled={videoLocked||!selectedClip || !clips.length} onClick={() => { deleteClip(); setContextMenu(null); }}><Trash2 size={15} />Delete</button>
            <button role="menuitem" disabled={videoLocked||!selectedClip} onClick={()=>{deleteClip(true);setContextMenu(null);}}><Trash2 size={15}/>Ripple delete</button>
            <button role="menuitem" disabled={config.videoClips === null} onClick={() => { onVideoClipsChange(null); setSelectedClipId(null); setContextMenu(null); }}><RotateCcw size={15} /> Restore original footage</button>
            <div className="timeline-context-separator" />
            <div className="timeline-context-speed">
              <span>Footage speed · all segments</span>
              <div>
                {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
                  <button
                    key={rate}
                    className={Math.abs((config.playbackRate || 1) - rate) < .001 ? "active" : ""}
                    role="menuitemradio"
                    aria-checked={Math.abs((config.playbackRate || 1) - rate) < .001}
                    onClick={() => { onPlaybackRateChange(rate); setContextMenu(null); }}
                  >
                    {rate}×
                  </button>
                ))}
              </div>
            </div>
            <div className="timeline-context-separator" />
            <button role="menuitem" onClick={() => { handleAddMarker(); setContextMenu(null); }}>
              <BookmarkPlus size={15} /> Add marker at playhead
            </button>
            <button role="menuitem" onClick={() => { onAddCaptionAtTime(currentTime); setContextMenu(null); }}>
              <Captions size={15} /> Add caption at playhead
            </button>
            <button role="menuitem" onClick={() => { onAddAudio(); setContextMenu(null); }}>
              <Music2 size={15} /> Add audio track
            </button>
            <div className="timeline-context-separator" />
            <button role="menuitem" disabled={currentTime <= 0 || currentTime >= (config.trimEnd || duration)} onClick={() => { onTrimStartChange(currentTime); setContextMenu(null); }}>
              <Clock3 size={15} /> Set trim start here
            </button>
            <button role="menuitem" disabled={currentTime <= config.trimStart || currentTime >= duration} onClick={() => { onTrimEndChange(currentTime); setContextMenu(null); }}>
              <Clock3 size={15} /> Set trim end here
            </button>
            <button role="menuitem" onClick={() => {
              onTrimStartChange(0);
              onTrimEndChange(duration);
              setContextMenu(null);
            }}>
              <RotateCcw size={15} /> Reset trim
            </button>
            {Math.abs((config.playbackRate || 1) - 1) > .001 && <button role="menuitem" onClick={() => { onPlaybackRateChange(1); setContextMenu(null); }}>
              <RotateCcw size={15} /> Reset speed
            </button>}
            {config.cuts.length > 0 && <button role="menuitem" onClick={() => { onCutsChange([]); setContextMenu(null); }}>
              <Trash2 size={15} /> Remove all markers
            </button>}
          </>}
        </div>,
        document.body
      )}
    </div>
  );
}

// ── Audio waveform helpers ────────────────────────────────────────────────────

function WaveRow({ data, theme }: { data: number[]; theme: "dark" | "light" }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    const draw = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const wpx = Math.max(2, Math.floor(parent.clientWidth));
      const hpx = Math.max(2, Math.floor(parent.clientHeight));
      if (canvas.width !== wpx) canvas.width = wpx;
      if (canvas.height !== hpx) canvas.height = hpx;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, wpx, hpx);

      const n = data.length;
      if (n === 0) return;
      ctx.fillStyle = getComputedStyle(canvas).getPropertyValue("--text-secondary").trim() || "#71717a";
      const barW = wpx / n;
      // Raw RMS is commonly only 0.01–0.08 for normal speech. Normalize to a
      // robust percentile instead of full-scale 1.0, while retaining the
      // relative dynamics and ignoring one-off click peaks.
      const audible = data.filter((value) => value > 0.000_01).sort((a, b) => a - b);
      const reference = audible.length > 0
        ? Math.max(0.000_01, audible[Math.min(audible.length - 1, Math.floor(audible.length * 0.95))])
        : 1;
      for (let i = 0; i < n; i++) {
        const normalized = data[i] <= 0 ? 0 : Math.min(1, Math.pow(data[i] / reference, 0.62));
        const bh = Math.max(1, normalized * (hpx - 2));
        ctx.fillRect(i * barW, (hpx - bh) / 2, Math.max(1, barW - 0.5), bh);
      }
    };

    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(canvas.parentElement!);
    window.addEventListener("resize", draw);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", draw);
    };
  }, [data, theme]);

  return <canvas ref={ref} className="wave-canvas" />;
}

const waveformCache = new Map<string, Promise<number[]>>();

async function loadWaveform(path: string, buckets: number): Promise<number[]> {
  const fingerprint = await invoke<string>("editor_media_fingerprint", { path }).catch(() => null);
  const key = fingerprint ? `${path}\0${fingerprint}\0${buckets}` : null;
  const cached = key ? waveformCache.get(key) : undefined;
  if (cached) return cached;
  const pending = invoke<number[]>("audio_waveform", { path, buckets }).catch((error) => {
    if (key) waveformCache.delete(key);
    throw error;
  });
  if (key) waveformCache.set(key, pending);
  // Retain only the newest resolutions. A long editing session should not
  // accumulate waveform arrays for every timeline width ever visited.
  if (waveformCache.size > 18) {
    const oldest = waveformCache.keys().next().value;
    if (oldest) waveformCache.delete(oldest);
  }
  return pending;
}

async function loadWaveformWithRetry(path: string, buckets: number): Promise<number[]> {
  let lastError: unknown;
  for (const delay of [0, 200, 600, 1_200]) {
    if (delay > 0) await new Promise((resolve) => window.setTimeout(resolve, delay));
    try {
      return await loadWaveform(path, buckets);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function formatTimecode(s: number): string {
  if (!isFinite(s) || s < 0) return "0:00.00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  const ms = Math.floor((s % 1) * 100);
  return `${m}:${sec.toString().padStart(2, "0")}.${ms.toString().padStart(2, "0")}`;
}
