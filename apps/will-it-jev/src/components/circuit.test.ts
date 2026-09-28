import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CircuitRow } from "@/lib/circuit";
import { Circuit } from "./circuit";

const render = (rows: CircuitRow[]) => renderToStaticMarkup(createElement(Circuit, { rows }));

const ROWS: CircuitRow[] = [
  { kind: "route", path: "0", question: "How are you getting there?", status: "done", answer: "By car", pct: 90, other: "By boat" },
  { kind: "gate", path: "0.1", question: "Is there enough fuel?", status: "done", answer: "No", pct: 80, other: "Yes" },
  {
    kind: "rate",
    path: "0.1.2",
    status: "done",
    items: [
      { question: "Is it fun?", answer: "Yes, 70%", goodness: 0.7 },
      { question: "How costly is it?", answer: "fine", goodness: 0.5 },
    ],
  },
  { kind: "gate", path: "1", question: "Is it late?", status: "thinking" },
];

/** The visible label of each row, in order. */
function labels(html: string): string[] {
  return [...html.matchAll(/<li[^>]*><p class="text-xs[^"]*">([^<]*)<\/p>/g)].map((m) => m[1]!);
}

describe("Circuit", () => {
  it("labels decision rows Gate 1, Gate 2… and rate rows Rating, in row order", () => {
    expect(labels(render(ROWS))).toEqual(["Gate 1", "Gate 2", "Rating", "Gate 3"]);
    expect(labels(render([ROWS[2]!, ROWS[3]!]))).toEqual(["Rating", "Gate 1"]);
  });

  it("shows the question, the answer taken in bold with its percentage, and the loser struck through", () => {
    const html = render([ROWS[1]!]);
    expect(html).toContain("Is there enough fuel?");
    expect(html).toMatch(/<strong[^>]*>No<\/strong><span[^>]*>, 80%<\/span> <del[^>]*>Yes<\/del>/);
  });

  it("leaves out a missing percentage or loser", () => {
    const html = render([{ kind: "route", path: "r", question: "Which?", status: "done", answer: "This one" }]);
    expect(html).toContain(">This one</strong></p>");
    expect(html).not.toContain("%");
    expect(html).not.toContain("<del");
  });

  it("shows … for a thinking row, with a dot that pulses except under reduced motion", () => {
    const html = render([ROWS[3]!, { kind: "rate", path: "r", status: "thinking", items: [] }]);
    expect(html.match(/…/g)).toHaveLength(2);
    expect(html).not.toContain("<strong");
    expect(html).toContain("animate-pulse");
    expect(html.match(/motion-reduce:animate-none/g)).toHaveLength(2);
  });

  it("renders a goodness bar per rated item, with its accessible value and answer", () => {
    const html = render([ROWS[2]!]);
    const bars = [...html.matchAll(/role="meter" aria-label="([^"]*)"[^>]*aria-valuenow="(\d+)"[^>]*><div[^>]*width:(\d+)%/g)];
    expect(bars.map((m) => [m[1], m[2], m[3]])).toEqual([
      ["Is it fun?", "70", "70"],
      ["How costly is it?", "50", "50"],
    ]);
    expect(html).toContain(">Yes, 70%</p>");
    expect(html).toContain(">fine</p>");
  });

  it("keeps a goodness bar within 0 to 100", () => {
    const html = render([
      {
        kind: "rate",
        path: "r",
        status: "done",
        items: [
          { question: "a", answer: "", goodness: 1.4 },
          { question: "b", answer: "", goodness: Number.NaN },
        ],
      },
    ]);
    expect([...html.matchAll(/aria-valuenow="(\d+)"/g)].map((m) => m[1])).toEqual(["100", "0"]);
  });

  it("renders nothing but the list for no rows", () => {
    expect(render([])).toMatch(/^<ol[^>]*><\/ol>$/);
  });
});
