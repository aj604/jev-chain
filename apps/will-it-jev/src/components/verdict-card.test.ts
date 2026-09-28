import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Verdict } from "@/lib/recipe/verdict";
import { VerdictCard } from "./verdict-card";

const BASE: Verdict = {
  tier: "jevs",
  line: "It jevs. Go out.",
  score: null,
  gates: 10,
  depth: 10,
  latencyMs: 180,
  requests: 10,
};

const render = (verdict: Verdict, title = "Will your plan for tonight jev?") =>
  renderToStaticMarkup(createElement(VerdictCard, { verdict, title }));

describe("VerdictCard", () => {
  it("is a polite live region", () => {
    expect(render(BASE)).toMatch(/^<section[^>]* aria-live="polite"/);
  });

  it("shows the title, the tier sentence, the rest of the line and the stat line", () => {
    const html = render(BASE);
    expect(html).toContain(">Will your plan for tonight jev?</p>");
    expect(html).toContain(">It jevs.</p>");
    expect(html).toContain(">Go out.</p>");
    expect(html).toContain(">10 gates. 10 deep. 180ms.</p>");
  });

  it("leaves out the score when there is none", () => {
    expect(render(BASE)).not.toContain("Score");
  });

  it("adds the score to the stat line when there is one", () => {
    const html = render({ ...BASE, tier: "kinda", line: "It sort of jevs. Barely.", score: 0.5 });
    expect(html).toContain(">It sort of jevs.</p>");
    expect(html).toContain(">Barely.</p>");
    expect(html).toContain(">10 gates. 10 deep. 180ms. Score 0.50.</p>");
  });

  it("shows no rest when the line is only the tier sentence", () => {
    const html = render({ ...BASE, tier: "nope", line: "It does not jev." });
    expect(html.match(/<p/g)).toHaveLength(3);
    expect(html).toContain(">It does not jev.</p>");
  });

  it("escapes the title", () => {
    expect(render(BASE, "<b>x</b>")).toContain("&lt;b&gt;x&lt;/b&gt;");
  });
});
