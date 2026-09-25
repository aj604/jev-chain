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
