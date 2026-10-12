import { describe, expect, it } from "vitest";
import {
  COLOR_LOOKS,
  DEFAULT_COLOR_GRADE,
  colorGradeFilter,
  normalizeColorGrade,
} from "./colorGrade";
import { resolveClipEffects } from "./clipEffects";
import { combineClips, duplicateClips } from "./clipOperations";
import { migrateProject, createProject } from "./project";
import { DEFAULT_EDITOR_CONFIG } from "./types";

describe("non-destructive color looks", () => {
  it("keeps original pixels neutral and blends looks to zero intensity", () => {
    expect(colorGradeFilter()).toBe("none");
    for (const look of COLOR_LOOKS) {
      expect(
        colorGradeFilter({
          ...DEFAULT_COLOR_GRADE,
          look: look.id,
          intensity: 0,
        }),
      ).toBe("none");
      if (look.id !== "original")
        expect(
          colorGradeFilter({ ...DEFAULT_COLOR_GRADE, look: look.id }),
        ).not.toBe("none");
    }
    expect(
      colorGradeFilter({
        ...DEFAULT_COLOR_GRADE,
        look: "midnight",
        enabled: false,
      }),
    ).toBe("none");
    expect(
      colorGradeFilter({
        ...DEFAULT_COLOR_GRADE,
        look: "fuji",
        intensity: 0,
        exposure: 1,
      }),
    ).toBe("brightness(2.0000)");
  });
  it("rejects invalid recipes and bounds every parameter", () => {
    expect(
      normalizeColorGrade({
        look: "unknown",
        intensity: NaN,
        exposure: Infinity,
        saturation: -100,
        contrast: 500,
        vignette: 200,
      } as never),
    ).toMatchObject({
      look: "original",
      intensity: 100,
      exposure: 0,
      saturation: 0,
      contrast: 50,
      vignette: 100,
    });
  });
  it("retains different clip looks when grouping, duplicating and reopening a project", () => {
    const colorGrade = { ...DEFAULT_COLOR_GRADE, look: "fuji" as const };
    const other = { ...DEFAULT_COLOR_GRADE, look: "midnight" as const };
    const clips = [
      { id: "a", start: 0, end: 1, colorGrade },
      { id: "b", start: 1, end: 2, colorGrade: other },
    ];
    const grouped = combineClips(clips, ["a", "b"]);
    expect(grouped).toHaveLength(2);
    expect(grouped[0].groupId).toBe(grouped[1].groupId);
    const copied = duplicateClips(grouped, ["a"]);
    expect(copied[1].colorGrade).toEqual(colorGrade);
    expect(copied[1].colorGrade).not.toBe(colorGrade);
    const project = createProject("C:/video.mp4", "C:/events.json");
    project.editor = {
      ...project.editor,
      videoClips: copied,
      colorGrade: other,
    };
    const restored = migrateProject(JSON.parse(JSON.stringify(project)));
    expect(
      resolveClipEffects(
        restored.editor.videoClips![0],
        restored.editor,
        [],
        [],
      ).config.colorGrade,
    ).toEqual(colorGrade);
    expect(
      resolveClipEffects(undefined, restored.editor, [], []).config.colorGrade,
    ).toEqual(other);
    expect(
      resolveClipEffects(undefined, DEFAULT_EDITOR_CONFIG, [], []).config
        .colorGrade,
    ).toBeUndefined();
  });
});
