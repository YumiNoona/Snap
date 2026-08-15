import { describe, expect, it } from "vitest";
import { createProject, CURRENT_PROJECT_VERSION, migrateProject, projectPathForVideo } from "./project";

describe("Snap project documents", () => {
  it("creates a versioned non-destructive project beside the recording data", () => {
    const now = new Date("2026-01-02T03:04:05.000Z");
    const project = createProject("C:\\Videos\\Snap\\demo.mp4", "C:\\Videos\\Snap\\demo\\events.json", now);

    expect(project.schemaVersion).toBe(CURRENT_PROJECT_VERSION);
    expect(project.createdAt).toBe(now.toISOString());
    expect(project.media.videoPath).toBe("C:\\Videos\\Snap\\demo.mp4");
    expect(project.captions).toEqual([]);
    expect(projectPathForVideo(project.media.videoPath)).toBe("C:\\Videos\\Snap\\demo\\project.snap.json");
  });

  it("fills newly added nested editor fields while loading a v1 project", () => {
    const base = createProject("C:\\demo.mp4", "C:\\demo\\events.json");
    const migrated = migrateProject({
      ...base,
      editor: { ...base.editor, shadow: { enabled: false } },
      captions: undefined,
    });

    expect(migrated.editor.shadow.enabled).toBe(false);
    expect(migrated.editor.shadow.blur).toBeGreaterThan(0);
    expect(migrated.captions).toEqual([]);
  });

  it("rejects unknown future schemas instead of silently corrupting them", () => {
    expect(() => migrateProject({ schemaVersion: 99, media: {} })).toThrow(/Unsupported Snap project version/);
  });
});
