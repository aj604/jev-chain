import { createJev, reduceTrace, type Answer, type Decision, type Span, type Trace, type TraceEvent } from "jevchain";
import { describe, expect, it } from "vitest";
import { byQuestion, fakeJev, type Oracle } from "@/test/fake-jev";
import { ladder } from "@/test/fixtures";
import { circuitRows, describeAnswer, type CircuitRow } from "./circuit";
import { gate, pick, rate, recipe, route, scale, verdict, yesNo } from "./recipe/build";
import { compileRecipe } from "./recipe/compile";
import type { RatedQuestion, Recipe, RecipeNode } from "./recipe/types";
import { validateRecipe } from "./recipe/validate";
import { runRecipe } from "./run";

const VERDICTS = { jevs: "It jevs.", kinda: "It sort of jevs.", nope: "It does not jev." };

function valid(root: RecipeNode): Recipe {
  const check = validateRecipe(recipe("Will the trip jev?", "the trip", root));
  if (!check.ok) throw new Error(check.message);
  return check.recipe;
}

const FUN = yesNo("fun", "Is it fun?", 1, true);
const COST = scale("cost", "How costly is it?", 2, ["cheap", "fine", "steep"], "low");
const WEATHER = pick("weather", "What is the weather?", 1, { sun: "Sunny", rain: "Rainy" }, ["sun"]);

/** A route, then (on "car") a gate that passes on yes, then (otherwise) a rate. */
const TRIP = valid(
  route(
    "how",
    "How are you getting there?",
    { walk: "On foot", car: "By car", boat: "By boat" },
    {
      walk: verdict("jevs", "It jevs. Walk it."),
      car: gate(
        "fuel",
        "Is there enough fuel?",
        "yes",
        verdict("jevs", "It jevs. Drive."),
        rate("vibes", [FUN, COST, WEATHER], VERDICTS),
      ),
      boat: verdict("nope", "It does not jev. Boats sink."),
    },
  ),
);

/** Car at 90% (boat second at 7%), fuel at 0.2 (so "No", 80%), fun at 0.7, cost level 1. */
const TRIP_ORACLE: Oracle = byQuestion({
  "How are you getting there?": { choice: "car", probabilities: { walk: 0.03, car: 0.9, boat: 0.07 } } as Partial<Answer>,
  "Is there enough fuel?": { noul: 0.2 },
  "Is it fun?": { noul: 0.7 },
  "How costly is it?": { score: 1 },
});

/** Every event of a run, and its result. */
async function recordRun(r: Recipe, oracle: Oracle) {
  const { client } = fakeJev(oracle);
  const events: TraceEvent[] = [];
  const s = createJev(client).stream(compileRecipe(r), "the trip");
  for await (const e of s) events.push(e);
  return { events, result: await s.result };
}

function prefix(events: TraceEvent[], n: number): Trace | undefined {
  let t: Trace | undefined;
  for (const e of events.slice(0, n)) t = reduceTrace(t, e);
  return t;
}

const TRIP_ROWS: CircuitRow[] = [
  {
    kind: "route",
    path: "$",
    question: "How are you getting there?",
    status: "done",
    answer: "By car",
    pct: 90,
    other: "By boat",
  },
  { kind: "gate", path: "$/car", question: "Is there enough fuel?", status: "done", answer: "No", pct: 80, other: "Yes" },
  {
    kind: "rate",
    path: "$/car/otherwise",
    status: "done",
    items: [
      { question: "Is it fun?", answer: "Yes, 70%", goodness: 0.7 },
      { question: "How costly is it?", answer: "fine", goodness: 0.5 },
      { question: "What is the weather?", answer: "Sunny, 90%", goodness: 0.9 },
    ],
  },
];

describe("circuitRows", () => {
  it("gives the exact rows for a complete run", async () => {
    const run = await runRecipe(createJev(fakeJev(TRIP_ORACLE).client), TRIP, "the trip");
    expect(run.result.status).toBe("ok");
    expect(circuitRows(TRIP, run.result.trace)).toStrictEqual(TRIP_ROWS);
  });

  it("is empty for an undefined trace", () => {
    expect(circuitRows(TRIP, undefined)).toEqual([]);
  });

  it("gives one thinking route row before the first decision", async () => {
    const { events } = await recordRun(TRIP, TRIP_ORACLE);
    const firstDecision = events.findIndex((e) => e.type === "decision");
    expect(circuitRows(TRIP, prefix(events, firstDecision))).toStrictEqual([
      { kind: "route", path: "$", question: "How are you getting there?", status: "thinking" },
    ]);
  });

  it("marks a gate done by its decision while its span still runs, and a rate thinking until it ends", async () => {
    const { events } = await recordRun(TRIP, TRIP_ORACLE);
    const rateCall = events.findIndex((e) => e.type === "jev:call" && e.path === "$/car/otherwise");
    const t = prefix(events, rateCall + 1)!;
    expect(t.spans.find((s) => s.path === "$/car")?.status).toBe("running");
    expect(circuitRows(TRIP, t)).toStrictEqual([
      TRIP_ROWS[0],
      TRIP_ROWS[1],
      { kind: "rate", path: "$/car/otherwise", status: "thinking", items: [] },
    ]);
  });

  it("never throws on any prefix of a run, and keeps paths unique", async () => {
    const { events, result } = await recordRun(TRIP, TRIP_ORACLE);
    let t: Trace | undefined;
    for (let n = 0; n <= events.length; n++) {
      const rows = circuitRows(TRIP, t);
      const paths = rows.map((r) => r.path);
      expect(new Set(paths).size).toBe(paths.length);
      if (n < events.length) t = reduceTrace(t, events[n]!);
    }
    expect(t).toBe(result.trace);
  });

  it("shows the side taken at exactly 0.5, not the raw value", async () => {
    // Passes on "no" at { max: 0.5 }, inclusive, so 0.5 goes to "then".
    const half = ladder(1, "no");
    const run = await runRecipe(createJev(fakeJev(() => ({ noul: 0.5 })).client), half, "x");
    expect(run.result.trace.spans[0]!.decision?.taken).toBe("then");
    expect(circuitRows(half, run.result.trace)).toStrictEqual([
      { kind: "gate", path: "$", question: "Does it stop at gate 1?", status: "done", answer: "No", pct: 50, other: "Yes" },
    ]);
  });

  it("reads a gate that passes on yes", async () => {
    const yes = ladder(1, "yes");
    const run = await runRecipe(createJev(fakeJev(() => ({ noul: 0.64 })).client), yes, "x");
    expect(circuitRows(yes, run.result.trace)[0]).toMatchObject({ answer: "Yes", pct: 64, other: "No" });
  });

  it("skips spans whose node isn't in the recipe", async () => {
    // TRIP's rows read against a recipe with none of its keys.
    const run = await runRecipe(createJev(fakeJev(TRIP_ORACLE).client), TRIP, "x");
    expect(circuitRows(ladder(2), run.result.trace)).toEqual([]);
  });

  it("keeps a failed decision thinking and a failed rate thinking with no items", async () => {
    const decisionFails = await runRecipe(createJev(fakeJev(undefined, { status: 500 }).client), TRIP, "x");
    expect(circuitRows(TRIP, decisionFails.result.trace)).toStrictEqual([
      { kind: "route", path: "$", question: "How are you getting there?", status: "thinking" },
    ]);

    const t = await tripTrace();
    const rateSpan = t.spans.find((s) => s.path === "$/car/otherwise")!;
    const failed = withSpan(t, "$/car/otherwise", { status: "error", output: undefined });
    expect(rateSpan.status).toBe("ok");
    expect(circuitRows(TRIP, failed)[2]).toStrictEqual({
      kind: "rate",
      path: "$/car/otherwise",
      status: "thinking",
      items: [],
    });
  });

  it("leaves out rated questions with no usable answer", async () => {
    const t = await tripTrace();
    const partial = withSpan(t, "$/car/otherwise", {
      calls: [],
      output: { fun: { type: "noul", noul: 0.2 }, cost: { type: "noul", noul: 1 } },
    });
    expect(circuitRows(TRIP, partial)[2]).toStrictEqual({
      kind: "rate",
      path: "$/car/otherwise",
      status: "done",
      items: [{ question: "Is it fun?", answer: "No, 80%", goodness: 0.2 }],
    });
  });

  it("leaves out a route's other answer when its edges are missing", async () => {
    const t = await tripTrace();
    const decision = t.spans[0]!.decision!;
    const noEdges = withSpan(t, "$", { decision: { ...decision, edges: undefined } as unknown as Decision });
    expect(circuitRows(TRIP, noEdges)[0]).toStrictEqual({
      kind: "route",
      path: "$",
      question: "How are you getting there?",
      status: "done",
      answer: "By car",
      pct: 90,
    });
  });

  it("breaks a tie for a route's other answer by edge order", async () => {
    const run = await runRecipe(createJev(fakeJev().client), TRIP, "x");
    // The fake picks the first label at 0.9, the other two at 0.05 each.
    expect(circuitRows(TRIP, run.result.trace)[0]).toMatchObject({ answer: "On foot", pct: 90, other: "By car" });
  });

  it("shows one row per path even if a span repeats", async () => {
    const t = await tripTrace();
    const doubled = { ...t, spans: [...t.spans, t.spans[0]!] };
    expect(circuitRows(TRIP, doubled)).toStrictEqual(TRIP_ROWS);
  });

  it("does not throw on junk", () => {
    const junk: unknown[] = [
      null,
      42,
      "trace",
      [],
      {},
      { spans: null },
      { spans: [null, 1, "x", [], {}] },
      { spans: [{ path: 1, nodeId: "how" }, { path: "$", nodeId: 7 }] },
      {
        spans: [
          { path: "$", nodeId: "how", decision: { taken: 3, edges: "no" } },
          { path: "$/car", nodeId: "fuel", decision: { taken: "maybe", value: "x" } },
          { path: "$/a", nodeId: "fuel", decision: { taken: "then", value: Infinity } },
          { path: "$/b", nodeId: "how", decision: { taken: "car", edges: [null, { edge: 1 }, { edge: "boat", value: "x" }] } },
          { path: "$/c", nodeId: "vibes", status: "ok", output: 5, calls: "no" },
          { path: "$/d", nodeId: "vibes", status: "ok", output: { fun: null, cost: { type: "score" } }, calls: [null, { answers: 1 }] },
          { path: "$/e", nodeId: "__proto__", decision: {} },
        ],
      },
    ];
    for (const t of junk) expect(() => circuitRows(TRIP, t as Trace)).not.toThrow();
    const rows = circuitRows(TRIP, junk.at(-1) as Trace);
    expect(rows.map((r) => [r.path, r.status])).toEqual([
      ["$", "thinking"],
      ["$/car", "thinking"],
      ["$/a", "done"],
      ["$/b", "done"],
      ["$/c", "done"],
      ["$/d", "done"],
    ]);
    // A gate whose value can't be read has no percentage; a route with unreadable edges has no other.
    expect(rows[2]).toStrictEqual({ kind: "gate", path: "$/a", question: "Is there enough fuel?", status: "done", answer: "Yes", other: "No" });
    expect(rows[3]).toStrictEqual({ kind: "route", path: "$/b", question: "How are you getting there?", status: "done", answer: "By car" });
    expect(rows[4]).toMatchObject({ items: [] });
    expect(rows[5]).toMatchObject({ items: [] });
  });
});

describe("describeAnswer", () => {
  const noul = (p: number): Answer => ({ type: "noul", noul: p });
  const score = (s: number): Answer => ({ type: "score", score: s, probabilities: {}, legend: {}, confidence: 1 });
  const choice = (c: string | undefined, probabilities: Record<string, number>): Answer =>
    ({ type: "choice", choice: c, probabilities, confidence: 1 }) as Answer;

  it("reads a noul as the likelier side and its percentage", () => {
    expect(describeAnswer(FUN, noul(0.7))).toBe("Yes, 70%");
    expect(describeAnswer(FUN, noul(0.3))).toBe("No, 70%");
    expect(describeAnswer(FUN, noul(0.5))).toBe("Yes, 50%");
    expect(describeAnswer(FUN, noul(0.004))).toBe("No, 100%");
    expect(describeAnswer(FUN, noul(0.125))).toBe("No, 88%");
  });

  it("reads a score as the level text at the rounded, clamped level", () => {
    expect(describeAnswer(COST, score(0))).toBe("cheap");
    expect(describeAnswer(COST, score(0.49))).toBe("cheap");
    expect(describeAnswer(COST, score(1.5))).toBe("steep");
    expect(describeAnswer(COST, score(1.4))).toBe("fine");
    expect(describeAnswer(COST, score(-3))).toBe("cheap");
    expect(describeAnswer(COST, score(9))).toBe("steep");
  });

  it("reads a choice as the description and its percentage", () => {
    expect(describeAnswer(WEATHER, choice("rain", { sun: 0.35, rain: 0.645 }))).toBe("Rainy, 65%");
    // No `choice`: the likeliest label.
    expect(describeAnswer(WEATHER, choice(undefined, { sun: 0.8, rain: 0.2 }))).toBe("Sunny, 80%");
    // A label the recipe doesn't have shows as itself; no probability, no percentage.
    expect(describeAnswer(WEATHER, choice("hail", {}))).toBe("hail");
  });

  it("gives an empty string for an answer that doesn't fit", () => {
    expect(describeAnswer(FUN, score(1))).toBe("");
    expect(describeAnswer(FUN, { type: "noul" } as unknown as Answer)).toBe("");
    expect(describeAnswer(COST, null as unknown as Answer)).toBe("");
    expect(describeAnswer(WEATHER, choice(undefined, {}))).toBe("");
    const noLevels = { ...COST, levels: [] } as RatedQuestion;
    expect(describeAnswer(noLevels, score(0))).toBe("");
  });
});

/** TRIP's complete trace. */
async function tripTrace(): Promise<Trace> {
  return (await runRecipe(createJev(fakeJev(TRIP_ORACLE).client), TRIP, "the trip")).result.trace;
}

/** `t` with the span at `path` patched. */
function withSpan(t: Trace, path: string, patch: Partial<Span>): Trace {
  return { ...t, spans: t.spans.map((s) => (s.path === path ? { ...s, ...patch } : s)) };
}
