import type { ScreenTiltKey } from "./screenTilt";
import type { CaptionTrack, ClipEffects, EditorConfig, Keyframe, VideoClip, LayerAnimationKey } from "./types";

export function snapshotClipEffects(config: EditorConfig, keyframes: Keyframe[], captions: CaptionTrack[]): ClipEffects {
  return structuredClone({ config: { screenTilt: config.screenTilt, zoomEnabled: config.zoomEnabled, zoomLevel: config.zoomLevel, zoomMovement: config.zoomMovement, fixedZoomPart: config.fixedZoomPart, zoomMode: config.zoomMode }, keyframes, captions });
}

export function resolveClipEffects(clip: VideoClip | undefined, config: EditorConfig, keyframes: Keyframe[], captions: CaptionTrack[]) {
  return { config: clip?.effects ? { ...config, ...clip.effects.config } : config, keyframes: clip?.effects?.keyframes ?? keyframes, captions: clip?.effects?.captions ?? captions };
}

export function editClipEffects(config: EditorConfig, clipId: string, patch: Partial<ClipEffects>): EditorConfig {
  return { ...config, videoClips: config.videoClips?.map(clip => clip.id === clipId && clip.effects ? { ...clip, effects: { ...clip.effects, ...patch } } : clip) ?? null };
}

export function replaceAnimationKeys(config: EditorConfig, kind: "tilt" | "camera" | "layer", id: string, keys: (LayerAnimationKey | ScreenTiltKey)[], clipId?: string): EditorConfig {
  if (config.lockedTracks?.includes(kind === "layer" ? "annotations" : kind)) return config;
  if (kind === "tilt") {
    const clip = config.videoClips?.find(item => item.id === clipId);
    const tilt = clip?.effects?.config.screenTilt ?? config.screenTilt;
    if (!tilt) return config;
    const screenTilt = { ...tilt, keys: keys as ScreenTiltKey[] };
    return clip?.effects ? editClipEffects(config, clip.id, { config: { ...clip.effects.config, screenTilt } }) : { ...config, screenTilt };
  }
  if (kind === "camera") return { ...config, cameraOverlay: { ...config.cameraOverlay, animation: keys as LayerAnimationKey[] } };
  return { ...config, layers: config.layers.map(layer => layer.id === id ? { ...layer, animation: keys as LayerAnimationKey[] } : layer) };
}
