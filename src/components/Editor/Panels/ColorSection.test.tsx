import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import ColorSection from "./ColorSection";

it("keeps controls visible without collapse arrows or disclosure buttons", () => {
  const markup = renderToStaticMarkup(createElement(ColorSection, {
    title: "RGB curves",
    children: createElement("input", { "aria-label": "Curve output" }),
  }));
  expect(markup).toContain("<section");
  expect(markup).toContain("RGB curves</h4>");
  expect(markup).toContain('aria-label="Curve output"');
  for (const element of ["<details", "<summary", "<svg", "<button", "hidden"]) {
    expect(markup).not.toContain(element);
  }
});
