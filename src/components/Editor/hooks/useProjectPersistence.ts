import { useEffect, useRef, useState } from "react";
import { createProject, loadProject, saveProject, type SnapProject } from "../../../lib/project";
import type { AudioTrack, CaptionTrack, EditorConfig, Keyframe } from "../../../lib/types";
import type { EditorSnapshot } from "./useEditorHistory";

interface Options {
  disabled: boolean;
  videoPath: string;
  inputLogPath: string;
  duration: number;
  config: EditorConfig;
  keyframes: Keyframe[];
  captions: CaptionTrack[];
  audioTracks: AudioTrack[];
  restore: (snapshot: EditorSnapshot) => void;
  restoreAudioTracks?: (tracks: AudioTrack[]) => void;
  decorateRestoredConfig?: (config: EditorConfig) => EditorConfig;
}

export function useProjectPersistence({
  disabled, videoPath, inputLogPath, duration, config, keyframes, captions, audioTracks,
  restore, restoreAudioTracks, decorateRestoredConfig,
}: Options) {
  const [ready, setReady] = useState(disabled);
  const [restored, setRestored] = useState(false);
  const [status, setStatus] = useState("");
  const projectRef = useRef<SnapProject | null>(null);
  const restoreRef = useRef(restore);
  const decorateRef = useRef(decorateRestoredConfig);
  const restoreAudioRef = useRef(restoreAudioTracks);
  restoreRef.current = restore;
  decorateRef.current = decorateRestoredConfig;
  restoreAudioRef.current = restoreAudioTracks;

  useEffect(() => {
    if (disabled) return;
    let cancelled = false;
    setReady(false);
    setRestored(false);
    void (async () => {
      try {
        const existing = await loadProject(videoPath);
        if (cancelled) return;
        const project = existing ?? createProject(videoPath, inputLogPath);
        projectRef.current = project;
        if (existing) {
          restoreAudioRef.current?.(project.audioTracks);
          restoreRef.current({
            config: decorateRef.current?.(project.editor) ?? project.editor,
            keyframes: project.keyframes,
            captions: project.captions,
          });
          setRestored(true);
          setStatus("Project restored");
        }
      } catch (error) {
        console.error("[Snap] Could not restore project:", error);
        projectRef.current = createProject(videoPath, inputLogPath);
        setStatus("Project recovery failed; editing a new project");
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => { cancelled = true; };
  }, [disabled, inputLogPath, videoPath]);

  useEffect(() => {
    if (!ready || disabled || !projectRef.current) return;
    const timer = window.setTimeout(() => {
      const project: SnapProject = {
        ...projectRef.current!,
        media: { ...projectRef.current!.media, videoPath, inputLogPath, durationSeconds: duration },
        editor: config,
        keyframes,
        captions,
        audioTracks,
      };
      projectRef.current = project;
      void saveProject(project)
        .then(() => setStatus("Saved"))
        .catch((error) => {
          console.error("[Snap] Project autosave failed:", error);
          setStatus("Autosave failed");
        });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [audioTracks, captions, config, duration, disabled, inputLogPath, keyframes, ready, videoPath]);

  return { projectReady: ready, hasSavedProject: restored, projectStatus: status };
}
