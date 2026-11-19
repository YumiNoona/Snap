export interface EditorRoute {
  projectPath: string;
  videoPath: string;
  inputLogPath: string;
  label: string;
  position?: number;
}
export interface ClipWorkspace {
  original: EditorRoute;
  clips: EditorRoute[];
}

/** Retain the source timeline while switching between independent clip projects. */
export function extendClipWorkspace(
  previous: ClipWorkspace | null,
  original: EditorRoute,
  clips: EditorRoute[],
): ClipWorkspace {
  const sameSource = previous?.original.videoPath === original.videoPath;
  const byPath = new Map(
    (sameSource ? previous.clips : []).map((c) => [c.projectPath, c]),
  );
  for (const clip of clips) byPath.set(clip.projectPath, clip);
  return {
    original: sameSource ? previous.original : original,
    clips: [...byPath.values()],
  };
}
