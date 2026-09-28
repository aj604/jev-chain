import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Result } from "@/lib/recipe/result";
import { OutcomeCard } from "./outcome-card";

const BASE: Result = {
  outcome: { key: "exorcist", stamp: "Exorcist booked", line: "Booked: one (1) exorcist." },
  score: null,
  gates: 10,
  depth: 10,
  latencyMs: 180,
  requests: 10,
};

const render = (result: Result, title = "The Appliance Dispatch Desk") =>
  renderToStaticMarkup(createElement(OutcomeCard, { result, title }));

describe("OutcomeCard", () => {
  it("is a polite live region", () => {
    expect(render(BASE)).toMatch(/^<section[^>]* aria-live="polite"/);
  });

  it("leaves the live region to the page with live={false}", () => {
    const html = renderToStaticMarkup(createElement(OutcomeCard, { result: BASE, title: "t", live: false }));
    expect(html).toMatch(/^<section /);
    expect(html).not.toContain("aria-live");
    expect(html).not.toContain("aria-atomic");
  });

  it("shows the desk, the stamp, the line, It jevs. and the stat line", () => {
    const html = render(BASE);
    expect(html).toContain(">The Appliance Dispatch Desk</p>");
    expect(html).toContain(">Exorcist booked</p>");
    expect(html).toContain(">Booked: one (1) exorcist.</p>");
    expect(html).toContain(">It jevs.</p>");
    expect(html).toContain(">10 gates. 10 deep. 180ms.</p>");
  });

  it("adds a rating's score to the stat line", () => {
    expect(render({ ...BASE, score: 0.5 })).toContain(">10 gates. 10 deep. 180ms. Score 0.50.</p>");
  });

  it("escapes the title", () => {
    expect(render(BASE, "<b>x</b>")).toContain("&lt;b&gt;x&lt;/b&gt;");
  });
});
