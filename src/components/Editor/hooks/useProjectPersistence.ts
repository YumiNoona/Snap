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
  const generationRef = useRef(0);
  const recoveryFailedRef = useRef(false);
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
    const generation = generationRef.current;
    const operation = saveQueueRef.current.catch(() => undefined).then(async () => {
      if (generation !== generationRef.current) throw new Error("The open project changed before saving");
      if (recoveryFailedRef.current && path.replace(/\//g, "\\").toLowerCase() === activePathRef.current.replace(/\//g, "\\").toLowerCase()) {
        throw new Error("Use Save As to preserve the original project and its recovery backup");
      }
      const snapshot = snapshotProject();
      if (!snapshot) throw new Error("The editor project is not ready yet");
      setSaving(true);
      setStatus("Saving…");
      try {
        const saved = await saveProjectAtPath(snapshot, path);
        if (generation !== generationRef.current) return saved;
        const current = snapshotProject();
        const stillDirty = !current || projectFingerprint(current) !== projectFingerprint(saved);
        projectRef.current = saved;
        lastSavedFingerprintRef.current = projectFingerprint(saved);
        activePathRef.current = path;
        setActivePath(path);
        recoveryFailedRef.current = false;
        setDirty(stillDirty);
        setStatus(stillDirty ? "Unsaved changes" : "Saved");
        return saved;
      } catch (error) {
        if (generation === generationRef.current) setStatus("Save failed — use Save As if recovery failed");
        throw error;
      } finally {
        if (generation === generationRef.current) setSaving(false);
      }
    });
    saveQueueRef.current = operation.then(() => undefined, () => undefined);
    return operation;
  }, [snapshotProject]);

  const saveNow = useCallback(() => persist(activePathRef.current), [persist]);
  const saveAs = useCallback((path: string) => persist(path), [persist]);

  useEffect(() => {
    if (disabled) return;
    ++generationRef.current;
    recoveryFailedRef.current = false;
    projectRef.current = null;
    let cancelled = false;
    const path = initialProjectPath || projectPathForVideo(videoPath);
    activePathRef.current = path;
    setActivePath(path);
    setReady(false);
    setSaving(false);
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
            audioTracks: project.audioTracks,
          });
          setRestored(true);
          setStatus("Project restored");
        } else {
          setStatus("New project");
        }
      } catch (error) {
        if (cancelled) return;
        console.error("[Snap] Could not restore project:", error);
        projectRef.current = createProject(videoPath, inputLogPath);
        lastSavedFingerprintRef.current = "";
        recoveryFailedRef.current = true;
        setStatus("Recovery failed. Use Save As; your original files are preserved.");
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => { cancelled = true; ++generationRef.current; };
  }, [disabled, initialProjectPath, inputLogPath, videoPath]);

  useEffect(() => {
    if (!ready || disabled || saving || !projectRef.current) return;
    const snapshot = snapshotProject();
    if (!snapshot) return;
    const fingerprint = projectFingerprint(snapshot);
    if (fingerprint === lastSavedFingerprintRef.current) {
      setDirty(false);
      return;
    }
    setDirty(true);
    if (recoveryFailedRef.current) return;
    setStatus("Unsaved changes");
    const generation = generationRef.current;
    const timer = window.setTimeout(() => {
      void persist(activePathRef.current).catch((error) => {
        console.error("[Snap] Project autosave failed:", error);
        if (generation === generationRef.current) setStatus("Autosave failed");
      });
    }, 1_500);
    return () => window.clearTimeout(timer);
  }, [activePath, audioTracks, captions, config, disabled, duration, keyframes, persist, ready, saving, snapshotProject]);

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
