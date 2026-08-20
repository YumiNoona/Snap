import { useCallback, useEffect, useRef, useState } from "react";
import {
  createProject,
  loadProjectAtPath,
  projectFingerprint,
  projectPathForVideo,
  saveProjectAtPath,
  type SnapProject,
} from "../../../lib/project";
import type { AudioTrack, CaptionTrack, EditorConfig, Keyframe } from "../../../lib/types";
import type { EditorSnapshot } from "./useEditorHistory";

interface Options {
  disabled: boolean;
  videoPath: string;
  inputLogPath: string;
  initialProjectPath?: string;
  duration: number;
  config: EditorConfig;
  keyframes: Keyframe[];
  captions: CaptionTrack[];
  audioTracks: AudioTrack[];
  restore: (snapshot: EditorSnapshot) => void;
  restoreAudioTracks?: (tracks: AudioTrack[]) => void;
  decorateRestoredConfig?: (config: EditorConfig) => EditorConfig;
}

interface EditableProjectState {
  videoPath: string;
  inputLogPath: string;
  duration: number;
  config: EditorConfig;
  keyframes: Keyframe[];
  captions: CaptionTrack[];
  audioTracks: AudioTrack[];
}

export function useProjectPersistence({
  disabled, videoPath, inputLogPath, initialProjectPath, duration, config, keyframes, captions, audioTracks,
  restore, restoreAudioTracks, decorateRestoredConfig,
}: Options) {
  const defaultPath = initialProjectPath || projectPathForVideo(videoPath);
  const [ready, setReady] = useState(disabled);
  const [restored, setRestored] = useState(false);
  const [status, setStatus] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [activePath, setActivePath] = useState(defaultPath);
  const projectRef = useRef<SnapProject | null>(null);
  const activePathRef = useRef(defaultPath);
  const lastSavedFingerprintRef = useRef("");
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const restoreRef = useRef(restore);
  const decorateRef = useRef(decorateRestoredConfig);
  const restoreAudioRef = useRef(restoreAudioTracks);
  const stateRef = useRef<EditableProjectState>({ videoPath, inputLogPath, duration, config, keyframes, captions, audioTracks });

  restoreRef.current = restore;
  decorateRef.current = decorateRestoredConfig;
  restoreAudioRef.current = restoreAudioTracks;
  stateRef.current = { videoPath, inputLogPath, duration, config, keyframes, captions, audioTracks };

  const snapshotProject = useCallback((): SnapProject | null => {
    const base = projectRef.current;
    if (!base) return null;
    const current = stateRef.current;
    return {
      ...base,
      media: {
        ...base.media,
        videoPath: current.videoPath,
        inputLogPath: current.inputLogPath,
        durationSeconds: current.duration,
      },
      editor: current.config,
      keyframes: current.keyframes,
      captions: current.captions,
      audioTracks: current.audioTracks,
    };
  }, []);

  const persist = useCallback((path: string) => {
    const operation = saveQueueRef.current.catch(() => undefined).then(async () => {
      const snapshot = snapshotProject();
      if (!snapshot) throw new Error("The editor project is not ready yet");
      setSaving(true);
      setStatus("Saving…");
      try {
        const saved = await saveProjectAtPath(snapshot, path);
        projectRef.current = saved;
        lastSavedFingerprintRef.current = projectFingerprint(saved);
        activePathRef.current = path;
        setActivePath(path);
        setDirty(false);
        setStatus("Saved");
        return saved;
      } catch (error) {
        setStatus("Save failed");
        throw error;
      } finally {
        setSaving(false);
      }
    });
    saveQueueRef.current = operation.then(() => undefined, () => undefined);
    return operation;
  }, [snapshotProject]);

  const saveNow = useCallback(() => persist(activePathRef.current), [persist]);
  const saveAs = useCallback((path: string) => persist(path), [persist]);

  useEffect(() => {
    if (disabled) return;
    let cancelled = false;
    const path = initialProjectPath || projectPathForVideo(videoPath);
    activePathRef.current = path;
    setActivePath(path);
    setReady(false);
    setRestored(false);
    setDirty(false);
    setStatus("Opening project…");
    void (async () => {
      try {
        const existing = await loadProjectAtPath(path);
        if (cancelled) return;
        const project = existing ?? createProject(videoPath, inputLogPath);
        projectRef.current = project;
        lastSavedFingerprintRef.current = existing ? projectFingerprint(project) : "";
        if (existing) {
          restoreAudioRef.current?.(project.audioTracks);
          restoreRef.current({
            config: decorateRef.current?.(project.editor) ?? project.editor,
            keyframes: project.keyframes,
            captions: project.captions,
          });
          setRestored(true);
          setStatus("Project restored");
        } else {
          setStatus("New project");
        }
      } catch (error) {
        console.error("[Snap] Could not restore project:", error);
        projectRef.current = createProject(videoPath, inputLogPath);
        lastSavedFingerprintRef.current = "";
        setStatus("Project recovery failed; editing a new project");
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, [disabled, initialProjectPath, inputLogPath, videoPath]);

  useEffect(() => {
    if (!ready || disabled || !projectRef.current) return;
    const snapshot = snapshotProject();
    if (!snapshot) return;
    const fingerprint = projectFingerprint(snapshot);
    if (fingerprint === lastSavedFingerprintRef.current) {
      setDirty(false);
      return;
    }
    setDirty(true);
    setStatus("Unsaved changes");
    const timer = window.setTimeout(() => {
      void persist(activePathRef.current).catch((error) => {
        console.error("[Snap] Project autosave failed:", error);
        setStatus("Autosave failed");
      });
    }, 1_500);
    return () => window.clearTimeout(timer);
  }, [audioTracks, captions, config, disabled, duration, keyframes, persist, ready, snapshotProject]);

  return {
    projectReady: ready,
    hasSavedProject: restored,
    projectStatus: status,
    projectDirty: dirty,
    projectSaving: saving,
    projectPath: activePath,
    saveProjectNow: saveNow,
    saveProjectAs: saveAs,
  };
}
