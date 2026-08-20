import { invoke } from "@tauri-apps/api/core";
import type { AudioTrack, CaptionTrack, EditorConfig, ExportSettings, Keyframe } from "./types";
import { DEFAULT_EDITOR_CONFIG } from "./types";
import { recordingDataPaths } from "./recordingPaths";

export const CURRENT_PROJECT_VERSION = 1 as const;
export const PROJECT_FILENAME = "project.snap.json";

export interface SnapProject {
  schemaVersion: typeof CURRENT_PROJECT_VERSION;
  id: string;
  createdAt: string;
  updatedAt: string;
  media: {
    videoPath: string;
    inputLogPath: string;
    durationSeconds: number;
    width: number;
    height: number;
  };
  audioTracks: AudioTrack[];
  editor: EditorConfig;
  keyframes: Keyframe[];
  captions: CaptionTrack[];
  exportSettings: Partial<ExportSettings>;
}

function cloneDefaultEditor(): EditorConfig {
  return structuredClone(DEFAULT_EDITOR_CONFIG);
}

export function projectPathForVideo(videoPath: string): string {
  return `${recordingDataPaths(videoPath).dataDir}\\${PROJECT_FILENAME}`;
}

export function createProject(videoPath: string, inputLogPath: string, now = new Date()): SnapProject {
  const timestamp = now.toISOString();
  return {
    schemaVersion: CURRENT_PROJECT_VERSION,
    id: `project-${now.getTime()}-${Math.random().toString(36).slice(2, 9)}`,
    createdAt: timestamp,
    updatedAt: timestamp,
    media: { videoPath, inputLogPath, durationSeconds: 0, width: 0, height: 0 },
    audioTracks: [],
    editor: cloneDefaultEditor(),
    keyframes: [],
    captions: [],
    exportSettings: {},
  };
}

export function migrateProject(value: unknown): SnapProject {
  if (!value || typeof value !== "object") throw new Error("Project file is not a JSON object");
  const raw = value as Partial<SnapProject> & { schemaVersion?: number };
  if (raw.schemaVersion !== CURRENT_PROJECT_VERSION) {
    throw new Error(`Unsupported Snap project version: ${String(raw.schemaVersion ?? "missing")}`);
  }
  if (!raw.media?.videoPath || !raw.media.inputLogPath) throw new Error("Project media paths are missing");
  const defaults = cloneDefaultEditor();
  return {
    ...raw,
    schemaVersion: CURRENT_PROJECT_VERSION,
    id: raw.id || `project-${Date.now()}`,
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: raw.updatedAt || new Date().toISOString(),
    media: {
      videoPath: raw.media.videoPath,
      inputLogPath: raw.media.inputLogPath,
      durationSeconds: Number(raw.media.durationSeconds) || 0,
      width: Number(raw.media.width) || 0,
      height: Number(raw.media.height) || 0,
    },
    audioTracks: Array.isArray(raw.audioTracks) ? raw.audioTracks : [],
    editor: {
      ...defaults,
      ...(raw.editor ?? {}),
      shadow: { ...defaults.shadow, ...(raw.editor?.shadow ?? {}) },
      cursorStyle: { ...defaults.cursorStyle, ...(raw.editor?.cursorStyle ?? {}) },
      motionBlur: { ...defaults.motionBlur, ...(raw.editor?.motionBlur ?? {}) },
      cursorMovement: { ...defaults.cursorMovement, ...(raw.editor?.cursorMovement ?? {}) },
      zoomMovement: { ...defaults.zoomMovement, ...(raw.editor?.zoomMovement ?? {}) },
      autoZoom: { ...defaults.autoZoom, ...(raw.editor?.autoZoom ?? {}) },
      audio: { ...defaults.audio, ...(raw.editor?.audio ?? {}) },
      layers: Array.isArray(raw.editor?.layers) ? raw.editor.layers : [],
      cuts: Array.isArray(raw.editor?.cuts) ? raw.editor.cuts : [],
    },
    keyframes: Array.isArray(raw.keyframes) ? raw.keyframes : [],
    captions: Array.isArray(raw.captions) ? raw.captions : [],
    exportSettings: raw.exportSettings ?? {},
  };
}

export async function loadProject(videoPath: string): Promise<SnapProject | null> {
  return loadProjectAtPath(projectPathForVideo(videoPath));
}

export async function loadProjectAtPath(path: string): Promise<SnapProject | null> {
  const text = await invoke<string | null>("read_optional_text_file", { path });
  if (text === null) return null;
  try {
    return migrateProject(JSON.parse(text));
  } catch (primaryError) {
    const backup = await invoke<string | null>("read_optional_text_file", { path: `${path}.bak` });
    if (backup === null) throw primaryError;
    return migrateProject(JSON.parse(backup));
  }
}

export async function saveProjectAtPath(project: SnapProject, path: string): Promise<SnapProject> {
  const updated = { ...project, updatedAt: new Date().toISOString() };
  await invoke("write_text_file_atomic", {
    path,
    contents: JSON.stringify(updated, null, 2),
  });
  return updated;
}

export async function saveProject(project: SnapProject): Promise<SnapProject> {
  return saveProjectAtPath(project, projectPathForVideo(project.media.videoPath));
}

export function projectFingerprint(project: SnapProject): string {
  const { updatedAt: _updatedAt, ...stable } = project;
  return JSON.stringify(stable);
}
