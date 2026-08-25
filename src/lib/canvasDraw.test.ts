import { describe, expect, it } from "vitest";
import { drawCaptionTrack } from "./canvasDraw";
import type { CaptionTrack } from "./types";

describe("caption canvas isolation", () => {
  it("starts a fresh path before filling the caption background", () => {
    const operations: string[] = [];
    const context = {
      globalAlpha: 1,
      save: () => operations.push("save"),
      restore: () => operations.push("restore"),
      measureText: (value: string) => ({ width: value.length * 10 }),
      beginPath: () => operations.push("beginPath"),
      moveTo: () => operations.push("moveTo"),
      lineTo: () => operations.push("lineTo"),
      arcTo: () => operations.push("arcTo"),
      closePath: () => operations.push("closePath"),
      fill: () => operations.push("fill"),
      translate: () => operations.push("translate"),
      scale: () => operations.push("scale"),
      strokeText: () => operations.push("strokeText"),
      fillText: () => operations.push("fillText"),
    } as unknown as CanvasRenderingContext2D;
    const track: CaptionTrack = {
      id: "cc",
      name: "Captions",
      language: "en",
      sourceTrackIds: ["mic"],
      visible: true,
      burnedIn: true,
      style: {
        fontFamily: "Arial", fontSize: 42, fontWeight: 700,
        color: "#fff", backgroundColor: "rgba(0,0,0,.68)",
        outlineColor: "#000", outlineWidth: 0, shadow: false,
        align: "center", x: .5, y: .86, maxWidth: .82, animation: "none",
      },
      segments: [{ id: "line", startMs: 0, endMs: 1_000, text: "Safe caption", language: "en", sourceTrackIds: ["mic"], userEdited: false }],
    };

    drawCaptionTrack(context, track, 500, { x: 0, y: 0, w: 1_920, h: 1_080 });

    expect(operations.indexOf("beginPath")).toBeGreaterThan(-1);
    expect(operations.indexOf("beginPath")).toBeLessThan(operations.indexOf("fill"));
  });
});
