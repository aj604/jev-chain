import { run, type Answer, type Trace } from "jevchain";
import { describe, expect, it } from "vitest";
import { byQuestion, fakeJev, type Oracle } from "@/test/fake-jev";
import { ladder } from "@/test/fixtures";
import { gate, pick, rate, recipe, route, scale, verdict, yesNo } from "./build";
import { compileRecipe } from "./compile";
import type { Recipe, RecipeNode } from "./types";
import { validateRecipe } from "./validate";
import { goodness, scoreRate, tierOf, traceStats, verdictOf } from "./verdict";

const VERDICTS = { jevs: "It jevs.", kinda: "It sort of jevs.", nope: "It does not jev." };

function valid(root: RecipeNode): Recipe {
  const check = validateRecipe(recipe("Will it jev?", "it", root));
  if (!check.ok) throw new Error(check.message);
  return check.recipe;
}

const noulAnswer = (noul: number): Answer => ({ type: "noul", noul });
const scoreAnswer = (score: number): Answer => ({ type: "score", score, probabilities: {}, legend: {}, confidence: 1 });
const choiceAnswer = (probabilities: Record<string, number>): Answer => ({
  type: "choice",
  choice: Object.keys(probabilities)[0],
  probabilities,
  confidence: 0.5,
});

const fiveLevels = ["none", "some", "half", "most", "all"];

/** A gate that passes on yes into a rate of a weight 1 noul and a weight 3 three-level scale. */
function gatedRate(): Recipe {
  return valid(
    gate(
      "ok",
      "Is it ok?",
      "yes",
      rate(
        "vibes",
        [yesNo("fun", "Is it fun?", 1, true), scale("cost", "How costly is it?", 3, ["cheap", "fine", "steep"], "low")],
        VERDICTS,
      ),
      verdict("nope", "It is not ok."),
    ),
  );
}

async function runRecipe(r: Recipe, oracle?: Oracle, opts?: { status?: number }) {
  const { client, requests } = fakeJev(oracle, opts);
  const result = await run(compileRecipe(r), "the thing", { jev: client });
  return { result, requests };
}

/** What the share link and verdict page will hand `verdictOf`. */
function rebuilt(trace: Trace) {
  const decoded = JSON.parse(JSON.stringify(trace)) as Trace;
  return { status: decoded.status, output: decoded.output, trace: decoded };
}

describe("goodness", () => {
  it("scores a noul in the good direction", () => {
    expect(goodness(yesNo("q", "Q?", 1, true), noulAnswer(0.8))).toBe(0.8);
    expect(goodness(yesNo("q", "Q?", 1, false), noulAnswer(0.8))).toBeCloseTo(0.2, 10);
  });

  it("places a 5-level score at level 3, flipped when low is good", () => {
    expect(goodness(scale("q", "Q?", 1, fiveLevels, "high"), scoreAnswer(3))).toBe(0.75);
    expect(goodness(scale("q", "Q?", 1, fiveLevels, "low"), scoreAnswer(3))).toBe(0.25);
  });

  it("places a fractional score between levels", () => {
    expect(goodness(scale("q", "Q?", 1, fiveLevels, "high"), scoreAnswer(2.5))).toBe(0.625);
    expect(goodness(scale("q", "Q?", 1, ["lo", "hi"], "high"), scoreAnswer(0))).toBe(0);
    expect(goodness(scale("q", "Q?", 1, ["lo", "hi"], "high"), scoreAnswer(1))).toBe(1);
  });

  it("sums a choice's good labels", () => {
    const q = pick("q", "Q?", 1, { a: "A", b: "B", c: "C" }, ["a", "b"]);
    expect(goodness(q, choiceAnswer({ a: 0.5, b: 0.2, c: 0.3 }))).toBeCloseTo(0.7, 10);
    expect(goodness(q, choiceAnswer({ a: 0, b: 0, c: 1 }))).toBe(0);
  });

  it("counts a good label listed twice once", () => {
    const q = pick("q", "Q?", 1, { a: "A", b: "B" }, ["a", "a"]);
    expect(goodness(q, choiceAnswer({ a: 0.3, b: 0.7 }))).toBe(0.3);
  });

  it("clamps to 0 to 1", () => {
    expect(goodness(yesNo("q", "Q?", 1, true), noulAnswer(1.4))).toBe(1);
    expect(goodness(yesNo("q", "Q?", 1, false), noulAnswer(1.4))).toBe(0);
    expect(goodness(scale("q", "Q?", 1, fiveLevels, "high"), scoreAnswer(9))).toBe(1);
    expect(goodness(scale("q", "Q?", 1, fiveLevels, "low"), scoreAnswer(9))).toBe(0);
    expect(goodness(scale("q", "Q?", 1, fiveLevels, "high"), scoreAnswer(-2))).toBe(0);
    const q = pick("q", "Q?", 1, { a: "A", b: "B", c: "C" }, ["a", "b"]);
    expect(goodness(q, choiceAnswer({ a: 0.9, b: 0.9, c: 0 }))).toBe(1);
  });

  it("is NaN for an answer that doesn't fit the question", () => {
    const hostile: unknown[] = [
      null,
      undefined,
      "0.8",
      [],
      scoreAnswer(3),
      { type: "noul" },
      { type: "noul", noul: "0.8" },
      { type: "noul", noul: Infinity },
    ];
    for (const a of hostile) expect(goodness(yesNo("q", "Q?", 1, true), a as Answer), JSON.stringify(a)).toBeNaN();
    expect(goodness(scale("q", "Q?", 1, fiveLevels, "high"), noulAnswer(0.5))).toBeNaN();
    expect(goodness(scale("q", "Q?", 1, fiveLevels, "high"), { type: "score" } as Answer)).toBeNaN();
    expect(goodness(pick("q", "Q?", 1, { a: "A", b: "B" }, ["a"]), { type: "choice" } as Answer)).toBeNaN();
  });

  it("ignores a choice's missing, inherited and non-numeric probabilities", () => {
    const q = pick("q", "Q?", 1, { a: "A", constructor: "C", toString: "T" }, ["a", "constructor", "toString"]);
    expect(goodness(q, choiceAnswer({ a: 0.25 }))).toBe(0.25);
    expect(goodness(q, { type: "choice", probabilities: { a: 0.25, toString: "x" } } as unknown as Answer)).toBe(0.25);
  });
});

describe("scoreRate", () => {
  it("takes the weighted mean, rounded to two places", () => {
    // (1 * 0.4 + 3 * 0.8) / 4 = 0.7000000000000001 in floating point.
    const r = rate(
      "r",
      [yesNo("fun", "Fun?", 1, true), scale("cost", "Cost?", 3, ["cheap", "fine", "steep"], "high")],
      VERDICTS,
    );
    expect(scoreRate(r, { fun: noulAnswer(0.4), cost: scoreAnswer(1.6) })).toBe(0.7);
  });

  it("rounds a repeating mean", () => {
    const r = rate("r", [yesNo("a", "A?", 1, true), yesNo("b", "B?", 2, true)], VERDICTS);
    expect(scoreRate(r, { a: noulAnswer(0), b: noulAnswer(1) })).toBe(0.67);
    expect(scoreRate(r, { a: noulAnswer(1), b: noulAnswer(0) })).toBe(0.33);
  });

  it("leaves out questions with no answer or an answer that doesn't fit", () => {
    const r = rate(
      "r",
      [yesNo("a", "A?", 1, true), yesNo("b", "B?", 5, true), yesNo("c", "C?", 5, true)],
      VERDICTS,
    );
    expect(scoreRate(r, { a: noulAnswer(0.9), c: scoreAnswer(0) })).toBe(0.9);
  });

  it("is 0 when no weights remain", () => {
    const r = rate("r", [yesNo("a", "A?", 1, true)], VERDICTS);
    expect(scoreRate(r, {})).toBe(0);
    expect(scoreRate(r, { other: noulAnswer(1) })).toBe(0);
    expect(scoreRate(r, null as unknown as Record<string, Answer>)).toBe(0);
  });

  it("doesn't read an inherited answer for a question keyed like an Object method", () => {
    const r = rate("r", [yesNo("constructor", "C?", 1, true), yesNo("a", "A?", 1, true)], VERDICTS);
    expect(scoreRate(r, { a: noulAnswer(0.5) })).toBe(0.5);
  });
});

describe("tierOf", () => {
  it("cuts at 0.66 and 0.4", () => {
    expect(tierOf(1)).toBe("jevs");
    expect(tierOf(0.66)).toBe("jevs");
    expect(tierOf(0.659)).toBe("kinda");
    expect(tierOf(0.4)).toBe("kinda");
    expect(tierOf(0.399)).toBe("nope");
    expect(tierOf(0)).toBe("nope");
  });
});

describe("traceStats", () => {
  it("rounds durationMs and reads requests", async () => {
    const { result } = await runRecipe(ladder(2));
    const trace = { ...result.trace, durationMs: 12.6, usage: { ...result.trace.usage, requests: 7 } };
    expect(traceStats(trace)).toEqual({ gates: 2, depth: 2, latencyMs: 13, requests: 7 });
  });

  it("counts every answer in every call as a gate, and only decision spans as depth", async () => {
    const { result } = await runRecipe(gatedRate(), byQuestion({ "Is it ok?": { noul: 0.9 } }));
    expect(result.trace.spans.map((s) => [s.kind, s.decision != null])).toEqual([
      ["gate", true],
      ["ask", false],
    ]);
    expect(traceStats(result.trace)).toMatchObject({ gates: 3, depth: 1, requests: 2 });
  });

  it("counts zero for whatever is missing or malformed", () => {
    const garbage: unknown[] = [
      null,
      undefined,
      42,
      "trace",
      [],
      {},
      { spans: "x", usage: "y", durationMs: "5" },
      { spans: [null, 1, "a", [], { calls: "x" }, { calls: [null, { answers: null }, { answers: [] }] }] },
      { durationMs: NaN, usage: { requests: Infinity } },
      { durationMs: -5, usage: { requests: -1 } },
    ];
    for (const trace of garbage) {
      expect(traceStats(trace as Trace), JSON.stringify(trace)).toEqual({ gates: 0, depth: 0, latencyMs: 0, requests: 0 });
    }
  });

  it("counts a decision on a span with otherwise broken fields", () => {
    const trace = { spans: [{ decision: {}, calls: [{ answers: { decision: {}, extra: {} } }] }] };
    expect(traceStats(trace as unknown as Trace)).toEqual({ gates: 2, depth: 1, latencyMs: 0, requests: 0 });
  });
});

describe("verdictOf over the fake Jev", () => {
  it("reads ladder(3)'s verdict leaf", async () => {
    const { result } = await runRecipe(ladder(3));
    const v = verdictOf(ladder(3), result);
    expect(v).toMatchObject({ tier: "jevs", line: "It jevs.", score: null, gates: 3, depth: 3, requests: 3 });
    expect(Number.isInteger(v?.latencyMs)).toBe(true);
    expect(v?.latencyMs).toBe(Math.round(result.trace.durationMs ?? NaN));
  });

  it("reads a verdict leaf off the failing side", async () => {
    const { result } = await runRecipe(ladder(3), byQuestion({ "gate 2?": { noul: 0.9 } }));
    expect(verdictOf(ladder(3), result)).toMatchObject({
      tier: "nope",
      line: "It does not jev at gate 2.",
      score: null,
      gates: 2,
      depth: 2,
      requests: 2,
    });
  });

  it("scores a rate leaf after a gate", async () => {
    // fun 0.8 at weight 1; cost level 1.2 of 0..2 is 0.6, low is good so 0.4, at weight 3.
    // (0.8 + 1.2) / 4 = 0.5.
    const { result } = await runRecipe(
      gatedRate(),
      byQuestion({ "Is it ok?": { noul: 0.9 }, "Is it fun?": { noul: 0.8 }, "How costly": { score: 1.2 } }),
    );
    expect(result.status).toBe("ok");
    expect(verdictOf(gatedRate(), result)).toMatchObject({
      tier: "kinda",
      line: "It sort of jevs.",
      score: 0.5,
      gates: 3,
      depth: 1,
      requests: 2,
    });
  });

  it("tiers the rounded score", async () => {
    const r = valid(rate("solo", [yesNo("q", "Is it?", 1, true)], VERDICTS));
    const { result } = await runRecipe(r, byQuestion({ "Is it?": { noul: 0.6599 } }));
    expect(verdictOf(r, result)).toMatchObject({ tier: "jevs", line: "It jevs.", score: 0.66, gates: 1, depth: 0 });
  });

  it("scores every question kind under a route", async () => {
    const r = valid(
      route(
        "vibe",
        "What is the vibe?",
        { calm: "Calm", loud: "Loud" },
        {
          calm: verdict("kinda", "Calm enough."),
          loud: rate(
            "loud",
            [
              yesNo("friends", "Are friends coming?", 2, true),
              scale("cost", "How expensive?", 1, ["cheap", "fine", "steep"], "low"),
              pick("where", "Where is it?", 1, { home: "Home", out: "Out", away: "Away" }, ["home", "out"]),
            ],
            VERDICTS,
          ),
        },
      ),
    );
    // friends 0.1 (the default), cost level 0 so 1, where: "away" takes 0.9 and the good labels share 0.1.
    // (2 * 0.1 + 1 + 0.1) / 4 = 0.325.
    const { result } = await runRecipe(r, byQuestion({ "vibe?": { choice: "loud" }, "Where is it?": { choice: "away" } }));
    expect(verdictOf(r, result)).toMatchObject({ tier: "nope", line: "It does not jev.", score: 0.33, gates: 4, depth: 1 });
  });

  it("gives null when the fetch returns 500", async () => {
    const { result } = await runRecipe(ladder(3), undefined, { status: 500 });
    expect(result.status).toBe("error");
    expect(verdictOf(ladder(3), result)).toBeNull();
  });

  it("works on a result rebuilt from a decoded trace", async () => {
    const plain = await runRecipe(ladder(3));
    expect(verdictOf(ladder(3), rebuilt(plain.result.trace))).toEqual(verdictOf(ladder(3), plain.result));
    const rated = await runRecipe(gatedRate(), byQuestion({ "Is it ok?": { noul: 0.9 }, "Is it fun?": { noul: 0.8 } }));
    const fromTrace = verdictOf(gatedRate(), rebuilt(rated.result.trace));
    expect(fromTrace).toEqual(verdictOf(gatedRate(), rated.result));
    expect(fromTrace?.score).not.toBeNull();
  });

  it("gives null for a rate run checked against another recipe", async () => {
    const { result } = await runRecipe(gatedRate(), byQuestion({ "Is it ok?": { noul: 0.9 } }));
    expect(verdictOf(ladder(3), result)).toBeNull();
  });
});

describe("verdictOf on bad runs", () => {
  const r = gatedRate();
  const leaf = { tier: "nope", line: "It is not ok." };
  const trace = (spans: unknown[] = []) => ({ spans, usage: { requests: 1 }, durationMs: 1 }) as unknown as Trace;
  const askSpan = (nodeId: unknown, calls: unknown = [{ answers: { fun: noulAnswer(1), cost: scoreAnswer(0) } }]) => ({
    kind: "ask",
    nodeId,
    calls,
  });

  it("gives null for any status but ok", () => {
    for (const status of ["error", "halted", "aborted", "running", "OK", ""]) {
      expect(verdictOf(r, { status, output: leaf, trace: trace() }), status).toBeNull();
    }
  });

  it("reads a verdict leaf the recipe has, even from a broken trace", () => {
    expect(verdictOf(r, { status: "ok", output: leaf, trace: null as unknown as Trace })).toEqual({
      ...leaf,
      score: null,
      gates: 0,
      depth: 0,
      latencyMs: 0,
      requests: 0,
    });
  });

  it("gives null for a verdict value the recipe doesn't have", () => {
    const outputs = [
      { tier: "nope", line: "Something else." },
      { tier: "jevs", line: "It is not ok." },
      { tier: "great", line: "It is not ok." },
      { tier: "nope" },
      { line: "It is not ok." },
      { tier: "nope", line: 5 },
      // A rate leaf's lines are not verdict leaves.
      { tier: "jevs", line: "It jevs." },
    ];
    for (const output of outputs) expect(verdictOf(r, { status: "ok", output, trace: trace() }), JSON.stringify(output)).toBeNull();
  });

  it("gives null when no rate leaf matches the last ask span", () => {
    const cases: unknown[][] = [
      [],
      [askSpan("nope")],
      [askSpan("ok")],
      [askSpan(7)],
      [askSpan(undefined)],
      [{ kind: "gate", nodeId: "vibes" }],
      [askSpan("vibes"), askSpan("ok")],
    ];
    for (const spans of cases) {
      expect(verdictOf(r, { status: "ok", output: {}, trace: trace(spans) }), JSON.stringify(spans)).toBeNull();
    }
  });

  it("scores the last ask span's rate leaf", () => {
    expect(verdictOf(r, { status: "ok", output: null, trace: trace([askSpan("ok"), askSpan("vibes")]) })).toMatchObject({
      tier: "jevs",
      score: 1,
    });
  });

  it("merges answers over the span's calls", () => {
    const calls = [{ answers: { fun: noulAnswer(1) } }, null, { answers: { cost: scoreAnswer(2) } }];
    expect(verdictOf(r, { status: "ok", trace: trace([askSpan("vibes", calls)]) })).toMatchObject({ score: 0.25, tier: "nope" });
  });

  it("scores 0 when the rate leaf's calls are missing or broken", () => {
    for (const calls of [undefined, "x", [], [null], [{ answers: "x" }], [{ answers: { fun: "yes", cost: null } }]]) {
      expect(verdictOf(r, { status: "ok", trace: trace([{ kind: "ask", nodeId: "vibes", calls }]) }), JSON.stringify(calls)).toMatchObject({
        tier: "nope",
        line: "It does not jev.",
        score: 0,
      });
    }
  });

  it("never throws on garbage", () => {
    const traces: unknown[] = [null, undefined, 0, "x", [], {}, { spans: null }, { spans: [null, 1, [], "s"] }, trace([askSpan("vibes", 5)])];
    const outputs: unknown[] = [undefined, null, 0, "It jevs.", [], {}, [leaf], { tier: null, line: null }];
    for (const t of traces) {
      for (const output of outputs) {
        expect(() => verdictOf(r, { status: "ok", output, trace: t as Trace })).not.toThrow();
      }
    }
    for (const result of [null, undefined, 0, "ok", [], {}, { status: "ok" }]) {
      expect(verdictOf(r, result as unknown as Parameters<typeof verdictOf>[1])).toBeNull();
    }
  });
});
