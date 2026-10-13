import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import SequenceLibrary from "./SequenceLibrary";
import { DEFAULT_EDITOR_CONFIG } from "../../../lib/types";

const props: ComponentProps<typeof SequenceLibrary> = {
  sequences: [], duration: 10, onInsert: vi.fn(), onEdit: vi.fn(), onChange: vi.fn(),
};

it("renders nothing when the sequence library is empty, with no heading, guidance or divider container", () => {
  expect(renderToStaticMarkup(createElement(SequenceLibrary, props))).toBe("");
});

it("keeps saved sequence cards and their actions without the old title or helper text", () => {
  const markup = renderToStaticMarkup(createElement(SequenceLibrary, {
    ...props,
    sequences: [{ id: "intro", name: "Intro", editor: { ...DEFAULT_EDITOR_CONFIG, trimEnd: 10 }, keyframes: [], captions: [], audioTracks: [] }],
  }));
  expect(markup).toContain('aria-label="Saved sequences"');
  expect(markup).toContain('aria-label="Sequence name"');
  for (const action of ["Insert Intro", "Duplicate Intro", "Delete Intro"]) {
    expect(markup).toContain(`aria-label="${action}"`);
  }
  expect(markup).not.toContain("<h3");
  expect(markup).not.toContain("<p>");
  expect(markup).not.toContain("Select adjacent footage clips");
});
