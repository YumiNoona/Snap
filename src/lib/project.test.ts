import { describe, expect, it } from "vitest";
import { createProject, CURRENT_PROJECT_VERSION, migrateProject, projectFingerprint, projectPathForVideo } from "./project";

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

  it("tracks editor changes without marking timestamp-only saves dirty", () => {
    const project = createProject("C:\\demo.mp4", "C:\\demo\\events.json");
    expect(projectFingerprint({ ...project, updatedAt: "later" })).toBe(projectFingerprint(project));
    expect(projectFingerprint({ ...project, editor: { ...project.editor, padding: 99 } })).not.toBe(projectFingerprint(project));
  });

  it("round-trips expanded caption styling used by preview and export", () => {
    const base = createProject("C:\\demo.mp4", "C:\\demo\\events.json");
    const caption = {
      id: "caption-track", name: "Speech", language: "en", sourceTrackIds: ["mic"], visible: true, burnedIn: true,
      style: {
        fontFamily: "Georgia", fontSize: 54, fontWeight: 700 as const, fontStyle: "italic" as const,
        color: "#fffaf2", backgroundColor: "#1b1714", outlineColor: "#000000", outlineWidth: 2,
        shadow: true, shadowBlur: .24, align: "center" as const, x: .5, y: .84, maxWidth: .78,
        letterSpacing: 1.5, lineHeight: 1.3, backgroundRadius: .24, backgroundPadding: .45,
        animation: "bounce" as const, animationDurationMs: 560,
      },
      segments: [{ id: "line", startMs: 1_000, endMs: 2_500, text: "Warm captions", language: "en", sourceTrackIds: ["mic"], userEdited: true }],
    };
    const migrated = migrateProject({ ...base, captions: [caption] });
    expect(migrated.captions[0]?.style).toEqual(caption.style);
    expect(projectFingerprint(migrated)).not.toBe(projectFingerprint(base));
  });
});
