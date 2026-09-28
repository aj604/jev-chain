import { run, type Answer, type Trace } from "jevchain";
import { describe, expect, it } from "vitest";
import { bands3, gate, outcome, pick, rate, recipe, scale, yesNo } from "@/test/build";
import { byQuestion, fakeJev, type Oracle } from "@/test/fake-jev";
import { desk, gatedRate, ladder } from "@/test/fixtures";
import { compileRecipe } from "./compile";
import { bandOf, goodness, resultOf, scoreRate, traceStats } from "./result";
import type { Recipe, RecipeNode } from "./types";
import { validateRecipe } from "./validate";

function valid(r: Recipe): Recipe {
  const check = validateRecipe(r);
  if (!check.ok) throw new Error(check.message);
  return check.recipe;
}

function inDesk(root: RecipeNode): Recipe {
  return valid(recipe("The Test Dispatch Desk", "it", root));
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

/** A gate that goes on yes into a rate of a weight 1 noul and a weight 3 three-level scale. */
function costlyRate(): Recipe {
  return inDesk(
    gate(
      "ok",
      "Is it ok?",
      rate(
        "vibes",
        [yesNo("fun", "Is it fun?", 1, true), scale("cost", "How costly is it?", 3, ["cheap", "fine", "steep"], "low")],
        bands3("vibes"),
      ),
      outcome("not-ok", "Not ok", "It is not ok."),
    ),
  );
}

async function runRecipe(r: Recipe, oracle?: Oracle, opts?: { status?: number }) {
  const { client, requests } = fakeJev(oracle, opts);
  const result = await run(compileRecipe(r), "the thing", { jev: client });
  return { result, requests };
}

/** What the share link and result page will hand `resultOf`. */
function rebuilt(trace: Trace) {
  const decoded = JSON.parse(JSON.stringify(trace)) as Trace;
  return { status: decoded.status, output: decoded.output, trace: decoded };
}

/** The outcome as `resultOf` reports it: key, stamp and line only. */
const shown = ({ key, stamp, line }: { key: string; stamp: string; line: string }) => ({ key, stamp, line });

describe("fixtures", () => {
  it("are valid recipes", () => {
    for (const r of [ladder(3), ladder(2, "yes"), desk(), gatedRate(), costlyRate()]) expect(valid(r)).toEqual(r);
  });
});

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
      { type: "noul", noul: NaN },
    ];
    for (const a of hostile) expect(goodness(yesNo("q", "Q?", 1, true), a as Answer), JSON.stringify(a)).toBeNaN();
    expect(goodness(scale("q", "Q?", 1, fiveLevels, "high"), noulAnswer(0.5))).toBeNaN();
    expect(goodness(scale("q", "Q?", 1, fiveLevels, "high"), { type: "score" } as Answer)).toBeNaN();
    expect(goodness(scale("q", "Q?", 1, ["only"], "high"), scoreAnswer(0))).toBeNaN();
    expect(goodness(pick("q", "Q?", 1, { a: "A", b: "B" }, ["a"]), { type: "choice" } as Answer)).toBeNaN();
    expect(goodness(pick("q", "Q?", 1, { a: "A", b: "B" }, ["a"]), noulAnswer(1))).toBeNaN();
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
      bands3("r"),
    );
    expect(scoreRate(r, { fun: noulAnswer(0.4), cost: scoreAnswer(1.6) })).toBe(0.7);
  });

  it("rounds a repeating mean", () => {
    const r = rate("r", [yesNo("a", "A?", 1, true), yesNo("b", "B?", 2, true)], bands3("r"));
    expect(scoreRate(r, { a: noulAnswer(0), b: noulAnswer(1) })).toBe(0.67);
    expect(scoreRate(r, { a: noulAnswer(1), b: noulAnswer(0) })).toBe(0.33);
  });

  it("leaves out questions with no answer or an answer that doesn't fit", () => {
    const r = rate("r", [yesNo("a", "A?", 1, true), yesNo("b", "B?", 5, true), yesNo("c", "C?", 5, true)], bands3("r"));
    expect(scoreRate(r, { a: noulAnswer(0.9), c: scoreAnswer(0) })).toBe(0.9);
  });

  it("is 0 when no weights remain", () => {
    const r = rate("r", [yesNo("a", "A?", 1, true)], bands3("r"));
    expect(scoreRate(r, {})).toBe(0);
    expect(scoreRate(r, { other: noulAnswer(1) })).toBe(0);
    expect(scoreRate(r, null as unknown as Record<string, Answer>)).toBe(0);
    expect(scoreRate(r, [noulAnswer(1)] as unknown as Record<string, Answer>)).toBe(0);
  });

  it("doesn't read an inherited answer for a question keyed like an Object method", () => {
    const r = rate("r", [yesNo("constructor", "C?", 1, true), yesNo("a", "A?", 1, true)], bands3("r"));
    expect(scoreRate(r, { a: noulAnswer(0.5) })).toBe(0.5);
  });
});

describe("bandOf", () => {
  const three = rate("r", [yesNo("a", "A?", 1, true)], bands3("r"));
  const keyOf = (r: typeof three, score: number) => bandOf(r, score).key;

  it("takes the first band the score reaches, inclusive of atLeast", () => {
    expect(keyOf(three, 1)).toBe("r-high");
    expect(keyOf(three, 0.66)).toBe("r-high");
    expect(keyOf(three, 0.659)).toBe("r-mid");
    expect(keyOf(three, 0.4)).toBe("r-mid");
    expect(keyOf(three, 0.399)).toBe("r-low");
    expect(keyOf(three, 0)).toBe("r-low");
  });

  it("returns the band's own outcome", () => {
    expect(bandOf(three, 0.9)).toBe(three.bands[0]!.outcome);
  });

  it("takes the last band for NaN or a score under every band", () => {
    expect(keyOf(three, NaN)).toBe("r-low");
    expect(keyOf(three, -0.5)).toBe("r-low");
  });

  it("works with two bands", () => {
    const two = rate("two", [yesNo("a", "A?", 1, true)], [
      [0.5, outcome("pass", "Passed", "It passed.")],
      [0, outcome("fail", "Failed", "It failed.")],
    ]);
    expect([1, 0.5, 0.49, 0, NaN].map((s) => keyOf(two, s))).toEqual(["pass", "pass", "fail", "fail", "fail"]);
  });

  it("works with four bands", () => {
    const four = rate("four", [yesNo("a", "A?", 1, true)], [
      [0.9, outcome("gold", "Gold", "Gold.")],
      [0.6, outcome("silver", "Silver", "Silver.")],
      [0.3, outcome("bronze", "Bronze", "Bronze.")],
      [0, outcome("tin", "Tin", "Tin.")],
    ]);
    const scores = [1, 0.9, 0.89, 0.6, 0.59, 0.3, 0.29, 0, NaN];
    expect(scores.map((s) => keyOf(four, s))).toEqual([
      "gold",
      "gold",
      "silver",
      "silver",
      "bronze",
      "bronze",
      "tin",
      "tin",
      "tin",
    ]);
  });
});

describe("traceStats", () => {
  it("rounds durationMs and reads requests", async () => {
    const { result } = await runRecipe(ladder(2));
    const trace = { ...result.trace, durationMs: 12.6, usage: { ...result.trace.usage, requests: 7 } };
    expect(traceStats(trace)).toEqual({ gates: 2, depth: 2, latencyMs: 13, requests: 7 });
  });

  it("counts every answer in every call as a gate, and only decision spans as depth", async () => {
    const { result } = await runRecipe(costlyRate(), byQuestion({ "Is it ok?": { noul: 0.9 } }));
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

describe("resultOf over the fake Jev", () => {
  it("reads ladder(3)'s outcome leaf", async () => {
    const { result } = await runRecipe(ladder(3));
    const r = resultOf(ladder(3), result);
    expect(r).toMatchObject({
      outcome: { key: "through", stamp: "Cleared", line: "Cleared every gate on the ladder." },
      score: null,
      gates: 3,
      depth: 3,
      requests: 3,
    });
    expect(Number.isInteger(r?.latencyMs)).toBe(true);
    expect(r?.latencyMs).toBe(Math.round(result.trace.durationMs ?? NaN));
  });

  it("reads an outcome leaf part way down", async () => {
    const { result } = await runRecipe(ladder(3), byQuestion({ "gate 2?": { noul: 0.9 } }));
    expect(resultOf(ladder(3), result)).toEqual({
      outcome: { key: "stop-2", stamp: "Held at gate 2", line: "Held at gate 2 pending review." },
      score: null,
      gates: 2,
      depth: 2,
      latencyMs: expect.any(Number),
      requests: 2,
    });
  });

  it("scores a rate leaf after a gate and picks its band", async () => {
    // fun 0.8 at weight 1; cost level 1.2 of 0..2 is 0.6, low is good so 0.4, at weight 3.
    // (0.8 + 1.2) / 4 = 0.5.
    const { result } = await runRecipe(
      costlyRate(),
      byQuestion({ "Is it ok?": { noul: 0.9 }, "Is it fun?": { noul: 0.8 }, "How costly": { score: 1.2 } }),
    );
    expect(result.status).toBe("ok");
    expect(resultOf(costlyRate(), result)).toMatchObject({
      outcome: shown(bands3("vibes")[1]![1]),
      score: 0.5,
      gates: 3,
      depth: 1,
      requests: 2,
    });
  });

  it("bands the rounded score", async () => {
    const r = inDesk(rate("solo", [yesNo("q", "Is it?", 1, true)], bands3("solo")));
    const { result } = await runRecipe(r, byQuestion({ "Is it?": { noul: 0.6599 } }));
    expect(resultOf(r, result)).toMatchObject({ outcome: { key: "solo-high" }, score: 0.66, gates: 1, depth: 0 });
  });

  it("scores every question kind under a route", async () => {
    // charged-twice 0.1 (the default) at weight 2, anger level 0 with low good so 1,
    // channel "cash" takes 0.9 and the good "card" gets 0.1. (0.2 + 1 + 0.1) / 4 = 0.325.
    const { result } = await runRecipe(
      desk(),
      byQuestion({ "Which team": { choice: "bill" }, "How did they pay?": { choice: "cash" } }),
    );
    expect(resultOf(desk(), result)).toMatchObject({
      outcome: { key: "refund-none", stamp: "Refund declined", line: "No refund. Please keep the receipt anyway." },
      score: 0.33,
      gates: 4,
      depth: 1,
    });
  });

  it("reads the desk's plain outcome leaves", async () => {
    const other = await runRecipe(desk(), byQuestion({ "Which team": { choice: "other" } }));
    expect(resultOf(desk(), other.result)).toMatchObject({ outcome: { key: "drafty" }, score: null, depth: 1 });
    const yes = await runRecipe(desk(), byQuestion({ "Which team": { choice: "ghost" }, "physical danger": { noul: 0.9 } }));
    expect(resultOf(desk(), yes.result)).toMatchObject({ outcome: { key: "evacuate" }, score: null, depth: 2, gates: 2 });
    const no = await runRecipe(desk(), byQuestion({ "Which team": { choice: "ghost" }, "physical danger": { noul: 0.2 } }));
    expect(resultOf(desk(), no.result)).toMatchObject({ outcome: { key: "exorcist" }, score: null, depth: 2 });
  });

  it("reaches a gate's unsure outcome on either side of 50/50", async () => {
    for (const noul of [0.45, 0.5, 0.55]) {
      const { result } = await runRecipe(
        desk(),
        byQuestion({ "Which team": { choice: "ghost" }, "physical danger": { noul } }),
      );
      expect(result.trace.spans[1]?.decision?.taken, String(noul)).toBe("unsure");
      expect(resultOf(desk(), result), String(noul)).toMatchObject({
        outcome: { key: "priest", stamp: "Priest consulted", line: "A priest will review the file at their leisure." },
        score: null,
        gates: 2,
        depth: 2,
      });
    }
  });

  it("reaches a route's lowConfidence outcome", async () => {
    const { result } = await runRecipe(
      desk(),
      byQuestion({ "Which team": { choice: "bill", confidence: 0.3 } as Partial<Answer> }),
    );
    expect(result.trace.spans[0]?.decision?.taken).toBe("lowConfidence");
    expect(resultOf(desk(), result)).toMatchObject({
      outcome: { key: "ask-dave", stamp: "Sent to Dave", line: "A human will read this. Probably Dave." },
      score: null,
      gates: 1,
      depth: 1,
      requests: 1,
    });
  });

  it("keeps the label at exactly the lowConfidence bar", async () => {
    const { result } = await runRecipe(
      desk(),
      byQuestion({ "Which team": { choice: "other", confidence: 0.4 } as Partial<Answer> }),
    );
    expect(resultOf(desk(), result)).toMatchObject({ outcome: { key: "drafty" } });
  });

  it("gives null when the fetch returns 500", async () => {
    const { result } = await runRecipe(ladder(3), undefined, { status: 500 });
    expect(result.status).toBe("error");
    expect(resultOf(ladder(3), result)).toBeNull();
  });

  it("works on a result rebuilt from a decoded trace", async () => {
    const plain = await runRecipe(ladder(3));
    expect(resultOf(ladder(3), rebuilt(plain.result.trace))).toEqual(resultOf(ladder(3), plain.result));

    const rated = await runRecipe(costlyRate(), byQuestion({ "Is it ok?": { noul: 0.9 }, "Is it fun?": { noul: 0.8 } }));
    const fromTrace = resultOf(costlyRate(), rebuilt(rated.result.trace));
    expect(fromTrace).toEqual(resultOf(costlyRate(), rated.result));
    expect(fromTrace?.score).not.toBeNull();

    const oracles: Oracle[] = [
      byQuestion({ "Which team": { choice: "ghost" }, "physical danger": { noul: 0.48 } }),
      byQuestion({ "Which team": { choice: "ghost", confidence: 0.1 } as Partial<Answer> }),
      byQuestion({ "Which team": { choice: "bill" }, "charged twice": { noul: 0.9 } }),
    ];
    for (const oracle of oracles) {
      const live = await runRecipe(desk(), oracle);
      const expected = resultOf(desk(), live.result);
      expect(expected).not.toBeNull();
      expect(resultOf(desk(), rebuilt(live.result.trace))).toEqual(expected);
    }
  });

  it("gives null for a run checked against another recipe", async () => {
    const rated = await runRecipe(gatedRate(), byQuestion({ "Is it ok?": { noul: 0.9 } }));
    expect(resultOf(gatedRate(), rated.result)).toMatchObject({ outcome: { key: "vibes-low" }, score: 0.1 });
    expect(resultOf(ladder(3), rated.result)).toBeNull();
    const leaf = await runRecipe(ladder(3));
    expect(resultOf(desk(), leaf.result)).toBeNull();
  });
});

describe("resultOf on bad runs", () => {
  const r = costlyRate();
  const leaf = { key: "not-ok", stamp: "Not ok", line: "It is not ok." };
  const [high, , low] = bands3("vibes").map(([, o]) => shown(o));
  const trace = (spans: unknown[] = []) => ({ spans, usage: { requests: 1 }, durationMs: 1 }) as unknown as Trace;
  const askSpan = (nodeId: unknown, calls: unknown = [{ answers: { fun: noulAnswer(1), cost: scoreAnswer(0) } }]) => ({
    kind: "ask",
    nodeId,
    calls,
  });

  it("gives null for any status but ok", () => {
    for (const status of ["error", "halted", "aborted", "running", "OK", ""]) {
      expect(resultOf(r, { status, output: leaf, trace: trace() }), status).toBeNull();
    }
  });

  it("reads an outcome leaf the recipe has, even from a broken trace", () => {
    expect(resultOf(r, { status: "ok", output: leaf, trace: null as unknown as Trace })).toEqual({
      outcome: leaf,
      score: null,
      gates: 0,
      depth: 0,
      latencyMs: 0,
      requests: 0,
    });
  });

  it("keeps only the outcome's key, stamp and line", () => {
    const result = resultOf(r, { status: "ok", output: { ...leaf, score: 1, extra: "<script>" }, trace: trace() });
    expect(result?.outcome).toStrictEqual(leaf);
    expect(result?.score).toBeNull();
  });

  it("gives null for an output that isn't exactly one of the recipe's outcome leaves", () => {
    const outputs = [
      { ...leaf, stamp: "Ok" },
      { ...leaf, line: "It is ok." },
      { ...leaf, key: "stopped" },
      { ...leaf, stamp: "not ok" },
      { ...leaf, line: `${leaf.line} ` },
      { key: leaf.key, stamp: leaf.stamp },
      { key: leaf.key, line: leaf.line },
      { stamp: leaf.stamp, line: leaf.line },
      { ...leaf, line: 5 },
      { ...leaf, key: ["not-ok"] },
      // The rate's bands are outcomes too, but a run can't emit one.
      high,
      low,
      // Node keys aren't outcome keys.
      { ...leaf, key: "ok" },
      { ...leaf, key: "vibes" },
      { ...leaf, key: "__proto__" },
      { ...leaf, key: "constructor" },
    ];
    for (const output of outputs) {
      expect(resultOf(r, { status: "ok", output, trace: trace() }), JSON.stringify(output)).toBeNull();
    }
  });

  it("scores the rate when the output claims one of its bands", () => {
    const calls = [{ answers: { fun: noulAnswer(0), cost: scoreAnswer(2) } }];
    expect(resultOf(r, { status: "ok", output: high, trace: trace([askSpan("vibes", calls)]) })).toMatchObject({
      outcome: low,
      score: 0,
    });
  });

  it("gives null when no rate leaf matches the last ask span", () => {
    const cases: unknown[][] = [
      [],
      [askSpan("nope")],
      [askSpan("ok")],
      [askSpan("not-ok")],
      [askSpan("vibes-high")],
      [askSpan(7)],
      [askSpan(undefined)],
      [{ kind: "gate", nodeId: "vibes" }],
      [askSpan("vibes"), askSpan("ok")],
    ];
    for (const spans of cases) {
      expect(resultOf(r, { status: "ok", output: {}, trace: trace(spans) }), JSON.stringify(spans)).toBeNull();
    }
  });

  it("scores the last ask span's rate leaf", () => {
    expect(resultOf(r, { status: "ok", output: null, trace: trace([askSpan("ok"), askSpan("vibes")]) })).toMatchObject({
      outcome: high,
      score: 1,
    });
  });

  it("merges answers over the span's calls", () => {
    const calls = [{ answers: { fun: noulAnswer(1) } }, null, { answers: { cost: scoreAnswer(2) } }];
    expect(resultOf(r, { status: "ok", trace: trace([askSpan("vibes", calls)]) })).toMatchObject({
      outcome: low,
      score: 0.25,
    });
  });

  it("scores 0 when the rate leaf's calls are missing or broken", () => {
    for (const calls of [undefined, "x", [], [null], [{ answers: "x" }], [{ answers: { fun: "yes", cost: null } }]]) {
      expect(
        resultOf(r, { status: "ok", trace: trace([{ kind: "ask", nodeId: "vibes", calls }]) }),
        JSON.stringify(calls),
      ).toMatchObject({ outcome: low, score: 0 });
    }
  });

  it("never throws on garbage", () => {
    const traces: unknown[] = [
      null,
      undefined,
      0,
      "x",
      [],
      {},
      { spans: null },
      { spans: [null, 1, [], "s"] },
      trace([askSpan("vibes", 5)]),
      trace([askSpan("__proto__")]),
      trace([askSpan("vibes", [{ answers: { __proto__: { fun: noulAnswer(1) } } }])]),
    ];
    const outputs: unknown[] = [
      undefined,
      null,
      0,
      "It is not ok.",
      [],
      {},
      [leaf],
      { key: null, stamp: null, line: null },
      { key: "__proto__", stamp: "x", line: "y" },
      high,
    ];
    for (const t of traces) {
      for (const output of outputs) {
        expect(() => resultOf(r, { status: "ok", output, trace: t as Trace })).not.toThrow();
      }
    }
    for (const result of [null, undefined, 0, "ok", [], {}, { status: "ok" }]) {
      expect(resultOf(r, result as unknown as Parameters<typeof resultOf>[1])).toBeNull();
    }
  });
});
