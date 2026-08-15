import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { CaptionTrack, EditorConfig, Keyframe } from "../../../lib/types";

export interface EditorSnapshot {
  config: EditorConfig;
  keyframes: Keyframe[];
  captions: CaptionTrack[];
}

interface Options {
  config: EditorConfig;
  keyframes: Keyframe[];
  setConfig: Dispatch<SetStateAction<EditorConfig>>;
  setKeyframes: Dispatch<SetStateAction<Keyframe[]>>;
  captions: CaptionTrack[];
  setCaptions: Dispatch<SetStateAction<CaptionTrack[]>>;
  limit?: number;
}

export function useEditorHistory({ config, keyframes, captions, setConfig, setKeyframes, setCaptions, limit = 80 }: Options) {
  const historyRef = useRef<EditorSnapshot[]>([]);
  const futureRef = useRef<EditorSnapshot[]>([]);
  const lastSnapshotRef = useRef<EditorSnapshot>({ config, keyframes, captions });
  const suppressNextCaptureRef = useRef(false);
  const [availability, setAvailability] = useState({ canUndo: false, canRedo: false });

  const refreshAvailability = useCallback(() => {
    setAvailability({ canUndo: historyRef.current.length > 0, canRedo: futureRef.current.length > 0 });
  }, []);

  useEffect(() => {
    const current = { config, keyframes, captions };
    if (suppressNextCaptureRef.current) {
      suppressNextCaptureRef.current = false;
      lastSnapshotRef.current = current;
      refreshAvailability();
      return;
    }
    const previous = lastSnapshotRef.current;
    if (previous.config === config && previous.keyframes === keyframes && previous.captions === captions) return;
    historyRef.current.push(previous);
    if (historyRef.current.length > limit) historyRef.current.shift();
    futureRef.current = [];
    lastSnapshotRef.current = current;
    refreshAvailability();
  }, [captions, config, keyframes, limit, refreshAvailability]);

  const restore = useCallback((snapshot: EditorSnapshot) => {
    suppressNextCaptureRef.current = true;
    setConfig(snapshot.config);
    setKeyframes(snapshot.keyframes);
    setCaptions(snapshot.captions);
  }, [setCaptions, setConfig, setKeyframes]);

  const undo = useCallback(() => {
    const snapshot = historyRef.current.pop();
    if (!snapshot) return;
    futureRef.current.push(lastSnapshotRef.current);
    restore(snapshot);
  }, [restore]);

  const redo = useCallback(() => {
    const snapshot = futureRef.current.pop();
    if (!snapshot) return;
    historyRef.current.push(lastSnapshotRef.current);
    restore(snapshot);
  }, [restore]);

  const replaceWithoutHistory = useCallback((snapshot: EditorSnapshot) => {
    historyRef.current = [];
    futureRef.current = [];
    restore(snapshot);
  }, [restore]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z") return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || !!target.closest("input, textarea, [role='textbox']"))) return;
      event.preventDefault();
      if (event.shiftKey) redo(); else undo();
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [redo, undo]);

  return { undo, redo, replaceWithoutHistory, ...availability };
}
