import { expect, it } from "vitest";
import { extendClipWorkspace, type EditorRoute } from "./clipWorkspace";
const original: EditorRoute = {
  projectPath: "edited.snap.json",
  videoPath: "source.mp4",
  inputLogPath: "events.json",
  label: "Original timeline",
  position: 36,
};
const a: EditorRoute = {
  ...original,
  projectPath: "clip-a.snap.json",
  label: "Clip A",
  position: 0,
};
it("retains the original saved timeline and playhead when more clips open", () => {
  const first = extendClipWorkspace(null, original, [a]);
  const next = extendClipWorkspace(first, a, [
    a,
    { ...a, projectPath: "clip-b.snap.json", label: "Clip B" },
  ]);
  expect(next.original).toEqual(original);
  expect(next.clips).toHaveLength(2);
});
it("starts a separate workspace for a different source", () => {
  const previous = extendClipWorkspace(null, original, [a]);
  const another = {
    ...original,
    videoPath: "other.mp4",
    projectPath: "other.snap.json",
  };
  expect(extendClipWorkspace(previous, another, [])).toEqual({
    original: another,
    clips: [],
  });
});
