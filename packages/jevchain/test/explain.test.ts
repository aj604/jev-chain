import { describe, expect, it } from "vitest";
import { diffTraces, explainDecision, marginWord, renderTemplate, type Trace } from "../src/index.js";

describe("explainDecision", () => {
  it("describes route margins", () => {
    const s = explainDecision({
      kind: "route",
      question: "decision",
      taken: "bug",
      metric: "probability",
      value: 0.51,
      confidence: 0.3,
      edges: [
        { edge: "bug", value: 0.51, taken: true },
        { edge: "billing", value: 0.49, taken: false },
      ],
    });
    expect(s).toBe('Went to "bug" with 51%, a photo finish over "billing" at 49% (confidence 0.30).');
  });

  it("describes gates", () => {
    const base = { kind: "gate" as const, question: "decision", metric: "noul" as const, threshold: { min: 0.7 } };
    expect(explainDecision({ ...base, taken: "then", value: 0.99, edges: [] })).toBe("Passed: p(yes) = 0.99, clearing the 0.70 bar easily (by 0.29).");
    expect(explainDecision({ ...base, taken: "halt", value: 0.69, edges: [] })).toBe(
      "Blocked: p(yes) = 0.69, short of the 0.70 bar by a hair, so the run stopped here.",
    );
    expect(explainDecision({ ...base, threshold: { max: 0.5 }, taken: "then", value: 0.05, edges: [] })).toBe(
      "Passed: p(yes) = 0.05, under the 0.50 ceiling easily (by 0.45).",
    );
  });

  it("measures a window from the edge the value missed or is nearest", () => {
    const base = { kind: "gate" as const, question: "decision", metric: "noul" as const, threshold: { min: 0.3, max: 0.7 } };
    const otherwise = [{ edge: "otherwise", value: 0, taken: true }];
    expect(explainDecision({ ...base, taken: "otherwise", value: 0.9, edges: otherwise })).toBe(
      'Blocked: p(yes) = 0.90, over the 0.30–0.70 window comfortably (by 0.20), so took "otherwise".',
    );
    expect(explainDecision({ ...base, taken: "otherwise", value: 0.1, edges: otherwise })).toBe(
      'Blocked: p(yes) = 0.10, short of the 0.30–0.70 window comfortably (by 0.20), so took "otherwise".',
    );
    expect(explainDecision({ ...base, taken: "then", value: 0.68, edges: [] })).toBe("Passed: p(yes) = 0.68, inside the 0.30–0.70 window by a hair.");
    expect(explainDecision({ ...base, taken: "then", value: 0.5, edges: [] })).toBe("Passed: p(yes) = 0.50, inside the 0.30–0.70 window comfortably (by 0.20).");
  });

  it("says which unsure trigger fired", () => {
    const base = { kind: "gate" as const, question: "decision", taken: "unsure", edges: [] };
    expect(
      explainDecision({ ...base, metric: "noul", value: 0.69, threshold: { min: 0.3, max: 0.7 }, unsureBecause: { margin: 0.05 } }),
    ).toBe('Too close to call: p(yes) = 0.69, 0.01 under the 0.70 ceiling of the 0.30–0.70 window, inside the 0.05 margin, so it took the "unsure" path.');
    expect(
      explainDecision({ ...base, metric: "score", value: 2.6, threshold: { min: 2.5 }, confidence: 0.9, unsureBecause: { margin: 0.4 } }),
    ).toBe('Too close to call: the score came in at 2.60, 0.10 over the 2.50 bar, inside the 0.40 margin (confidence 0.90), so it took the "unsure" path.');
    expect(
      explainDecision({
        ...base,
        metric: "probability",
        value: 0.6,
        threshold: { min: 0.2, label: "yes" },
        confidence: 0.3,
        unsureBecause: { minConfidence: 0.5, confidence: 0.3 },
      }),
    ).toBe('Too unsure to call: p(yes) = 0.60, confidence 0.30 was under the 0.50 minimum, so it took the "unsure" path.');
    expect(
      explainDecision({ ...base, metric: "noul", value: 0.55, threshold: { min: 0.5 }, unsureBecause: { margin: 0.1, minConfidence: 0.3, confidence: 0.1 } }),
    ).toBe('Too close to call: p(yes) = 0.55, 0.05 over the 0.50 bar, inside the 0.10 margin, and confidence 0.10 was under the 0.30 minimum, so it took the "unsure" path.');
    // Without the triggers (a hand-built input), it keeps the old sentence.
    expect(explainDecision({ ...base, metric: "noul", value: 0.65, threshold: { min: 0.7 } })).toBe(
      'Too close to call: p(yes) = 0.65, right next to the 0.70 bar, so it took the "unsure" path.',
    );
  });

  it("names each cascade tier's bar", () => {
    const edges = [
      { edge: "gut", value: 0.4, taken: false },
      { edge: "full", value: 0.55, taken: false },
      { edge: "fallback", value: null, taken: true },
    ];
    const d = { kind: "cascade" as const, question: "decision", metric: "confidence" as const, edges, tierBars: { gut: 0.8, full: 0.6 } };
    expect(explainDecision({ ...d, taken: "fallback", value: 0.55, threshold: { min: 0.6 } })).toBe(
      'Escalated past "gut" (0.40, needed 0.80), "full" (0.55, needed 0.60); no tier was confident enough, so it handed off to the fallback.',
    );
  });

  it("has words for margins", () => {
    expect([0.9, 0.4, 0.2, 0.06, 0.01].map(marginWord)).toEqual(["a landslide", "a comfortable win", "a clear lead", "a narrow lead", "a photo finish"]);
  });
});

describe("templates", () => {
  it("renders paths and keeps whole-hole values raw", () => {
    expect(renderTemplate("{{input.a.b}}", { input: { a: { b: [1, 2] } } })).toEqual([1, 2]);
    expect(renderTemplate("hi {{input.name}}, {{input.missing}}!", { input: { name: "jev" } })).toBe("hi jev, !");
    expect(renderTemplate("{{ input.list.1 }}", { input: { list: ["a", "b"] } })).toBe("b");
  });
});

describe("diffTraces", () => {
  const t = (taken: string, paths: string[]): Trace => ({
    version: 1,
    runId: "r",
    chainId: "c",
    status: "ok",
    startedAt: "",
    input: null,
    models: [],
    usage: { calls: 0, requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 },
    spans: paths.map((path, i) => ({
      path,
      parentPath: null,
      edge: null,
      nodeId: path,
      kind: "route",
      status: "ok",
      start: 0,
      calls: [],
      retries: [],
      logs: [],
      ...(i === 0 ? { decision: { kind: "route", question: "q", taken, edges: [], metric: "probability", value: 1, summary: "" } } : {}),
    })),
  });

  it("finds where two runs diverged", () => {
    const d = diffTraces(t("a", ["$", "$/a"]), t("b", ["$", "$/b"]));
    expect(d).toEqual({ shared: ["$"], onlyA: ["$/a"], onlyB: ["$/b"], divergedAt: { path: "$", nodeId: "$", a: "a", b: "b" } });
  });
});
