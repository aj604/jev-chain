import { describe, expect, it } from "vitest";
import { cascade, choice, createJev, emit, gate, noul, route, score, spanAt, tier, type AnyNode, type Answer, type JevClient, type Json, type Question, type Trace } from "jevchain";
import { examples } from "jevchain-examples";
import { closestFlip, flipsOf, flipText, fmtBy, type Flip } from "./margin";
import { rehearsalClient } from "./rehearsal";
import { closeCallsAt, runSweep, type SweepRow } from "./sweep";
import { whatIfClient } from "./what-if";

/** A client that answers each question (by its instructions) with whatever `answers` says. */
function scripted(answers: Record<string, Answer | Answer[]>): JevClient {
  const queues = new Map(Object.entries(answers).map(([k, v]) => [k, Array.isArray(v) ? [...v] : [v]]));
  return {
    model: "scripted",
    usdPerMillionTokens: 0,
    async ask(_state, questions) {
      const out: Record<string, Answer> = {};
      for (const [k, q] of Object.entries(questions as Record<string, Question>)) {
        const text = String(q.instructions);
        const queue = queues.get(text);
        if (!queue?.length) throw new Error(`no scripted answer for "${text}"`);
        out[k] = queue.length > 1 ? queue.shift()! : queue[0]!;
      }
      return { answers: out, model: "scripted", usage: { inputTokens: 1, outputTokens: 0 }, costUsd: 0, latencyMs: 0, attempts: 1 } as never;
    },
  };
}

async function runWith(root: AnyNode, answers: Record<string, Answer | Answer[]>, input: Json = "x"): Promise<Trace> {
  return (await createJev(scripted(answers)).run(root, input)).trace;
}

const pick = (probabilities: Record<string, number>, confidence: number): Answer => ({
  type: "choice",
  choice: Object.entries(probabilities).reduce((a, b) => (b[1] > a[1] ? b : a))[0],
  probabilities,
  confidence,
});
const yes = (p: number): Answer => ({ type: "noul", noul: p });
const scored = (s: number, confidence = 0.9): Answer => ({ type: "score", score: s, probabilities: { "0": 0, "1": 0, "2": 0, "3": 0 }, legend: { "0": "a", "1": "b", "2": "c", "3": "d" }, confidence });

const brief = (flips: Flip[]) => flips.map((f) => [f.edge, f.by]);

// ── chains whose rules are easy to tally by hand ─────────────────────────────

const desk = route("desk", {
  ask: choice("Which desk?", ["repair", "billing", "haunted"]),
  lowConfidence: { below: 0.4, then: emit("dave", { id: "dave" }) },
  branches: { repair: emit("r", { id: "r" }), billing: emit("b", { id: "b" }), haunted: emit("h", { id: "h" }) },
});

const danger = gate("danger", {
  ask: noul("Danger?"),
  pass: { min: 0.5 },
  unsure: { margin: 0.1, then: emit("check", { id: "check" }) },
  then: emit("page", { id: "page" }),
  otherwise: emit("ticket", { id: "ticket" }),
});

const halting = gate("safe", { ask: noul("Safe?"), pass: { max: 0.5 }, then: emit("ok", { id: "ok" }) });

const window = gate("window", {
  ask: score("How much?", ["none", "some", "lots", "all"]),
  pass: { min: 1, max: 2 },
  then: emit("in", { id: "in" }),
  otherwise: emit("out", { id: "out" }),
});

const doubtful = gate("doubt", {
  ask: noul("Sure?"),
  pass: { min: 0.5 },
  unsure: { minConfidence: 0.4, then: emit("hmm", { id: "hmm" }) },
  then: emit("y", { id: "y" }),
  otherwise: emit("n", { id: "n" }),
});

const verdict = noul("Text back?");
const textBack = cascade("text-back", {
  tiers: [tier("gut", { title: "Gut check", ask: verdict, minConfidence: 0.7 }), tier("full", { ask: verdict, minConfidence: 0.5 })],
  fallback: emit("sleep on it", { id: "sleep" }),
});

describe("flipsOf: hand tally", () => {
  it("route: each other label is as close as the winner's lead; unsure is confidence over the bar", async () => {
    const t = await runWith(desk, { "Which desk?": pick({ repair: 0.5, billing: 0.3, haunted: 0.2 }, 0.45) });
    const flips = flipsOf(desk, spanAt(t, "$"));
    expect(brief(flips)).toEqual([
      ["lowConfidence", 0.05],
      ["billing", 0.2],
      ["haunted", 0.3],
    ]);
    expect(flips[0]).toMatchObject({ measure: "confidence", from: 0.45, to: 0.4 });
    expect(flipText(flips[0]!)).toBe("0.05 less confidence and it goes “unsure”");
    expect(flipText(flips[1]!, "repair")).toBe("“repair” led “billing” by 0.20");
  });

  it("route gone unsure: confidence up to the bar sends it where Jev leaned", async () => {
    const t = await runWith(desk, { "Which desk?": pick({ repair: 0.2, billing: 0.7, haunted: 0.1 }, 0.3) });
    expect(spanAt(t, "$")!.decision!.taken).toBe("lowConfidence");
    const flips = flipsOf(desk, spanAt(t, "$"));
    expect(brief(flips)).toEqual([["billing", 0.1]]);
    expect(flipText(flips[0]!)).toBe("0.10 more confidence and it goes “billing”");
  });

  it("gate: the unsure band comes before the other side of the bar", async () => {
    const t = await runWith(danger, { "Danger?": yes(0.63) });
    expect(spanAt(t, "$")!.decision!.taken).toBe("then");
    expect(brief(flipsOf(danger, spanAt(t, "$")))).toEqual([
      ["unsure", 0.03],
      ["otherwise", 0.23],
    ]);
    const u = await runWith(danger, { "Danger?": yes(0.55) });
    expect(spanAt(u, "$")!.decision!.taken).toBe("unsure");
    // p 0.55 → 0.6 (≥ the band's edge) passes; 0.55 → 0.4 fails.
    expect(brief(flipsOf(danger, spanAt(u, "$")))).toEqual([
      ["then", 0.05],
      ["otherwise", 0.15],
    ]);
  });

  it("gate with no otherwise: a halt is a road too", async () => {
    const t = await runWith(halting, { "Safe?": yes(0.7) });
    expect(t.status).toBe("halted");
    const flips = flipsOf(halting, spanAt(t, "$"));
    expect(brief(flips)).toEqual([["then", 0.2]]);
    expect(flipText(flips[0]!)).toBe("0.20 less p(yes) and it goes “then”");
  });

  it("window gate: both edges of the window count", async () => {
    const t = await runWith(window, { "How much?": scored(1.8) });
    expect(brief(flipsOf(window, spanAt(t, "$")))).toEqual([["otherwise", 0.2]]);
    const low = await runWith(window, { "How much?": scored(1.1) });
    expect(brief(flipsOf(window, spanAt(low, "$")))).toEqual([["otherwise", 0.1]]);
    const out = await runWith(window, { "How much?": scored(2.6) });
    expect(flipsOf(window, spanAt(out, "$"))[0]).toMatchObject({ edge: "then", by: 0.6, measure: "score", from: 2.6, to: 2 });
  });

  it("a yes/no gate's confidence minimum is a place on its own scale", async () => {
    // p 0.75 is confidence 0.5; below p 0.7 its confidence drops under 0.4.
    const t = await runWith(doubtful, { "Sure?": yes(0.75) });
    expect(brief(flipsOf(doubtful, spanAt(t, "$")))).toEqual([
      ["unsure", 0.05],
      ["otherwise", 0.45],
    ]);
  });

  it("a choice gate's confidence minimum is its own number", async () => {
    const node = gate("g", {
      ask: choice("Which?", ["a", "b"]),
      pass: { min: 0.6, label: "a" },
      unsure: { minConfidence: 0.5, then: emit("u", { id: "u" }) },
      then: emit("t", { id: "t" }),
      otherwise: emit("o", { id: "o" }),
    });
    const t = await runWith(node, { "Which?": pick({ a: 0.9, b: 0.1 }, 0.52) });
    expect(flipsOf(node, spanAt(t, "$"))).toEqual([
      { edge: "unsure", by: 0.02, measure: "confidence", from: 0.52, to: 0.5, up: false },
      { edge: "otherwise", by: 0.3, measure: "p(a)", from: 0.9, to: 0.6, up: false },
    ]);
  });

  it("cascade: an answering tier escalates below its bar; refused tiers are as close as their bar", async () => {
    const t = await runWith(textBack, { "Text back?": [yes(0.8), yes(0.775)] }); // conf 0.6, then 0.55
    expect(spanAt(t, "$")!.decision!.taken).toBe("full");
    const flips = flipsOf(textBack, spanAt(t, "$"));
    expect(brief(flips)).toEqual([
      ["fallback", 0.05],
      ["gut", 0.1],
    ]);
    expect(flips[0]!.escalates).toBe(true);
    expect(flipText(flips[0]!)).toBe("0.05 less confidence at full and it falls back");
    expect(flipText(flips[1]!)).toBe("0.10 more confidence at Gut check and it goes “gut”");

    const first = await runWith(textBack, { "Text back?": yes(0.95) }); // conf 0.9
    const [only] = flipsOf(textBack, spanAt(first, "$"));
    expect(only).toMatchObject({ edge: "full", by: 0.2, escalates: true });
    expect(flipText(only!)).toBe("0.20 less confidence at Gut check and it asks “full” instead");

    const fell = await runWith(textBack, { "Text back?": [yes(0.6), yes(0.65)] }); // conf 0.2, 0.3
    expect(brief(flipsOf(textBack, spanAt(fell, "$")))).toEqual([
      ["full", 0.2],
      ["gut", 0.5],
    ]);
  });

  it("says nothing about a decision a what-if forced, or a span that didn't decide", async () => {
    const a = await runWith(danger, { "Danger?": yes(0.63) });
    const b = (await createJev(whatIfClient(scripted({ "Danger?": yes(0.63) }), { root: danger, trace: a, fork: { path: "$", edge: "otherwise" } })).run(danger, "x")).trace;
    expect(spanAt(b, "$")!.decision!.taken).toBe("otherwise");
    expect(flipsOf(danger, spanAt(b, "$"))).toEqual([]);
    expect(flipsOf(danger, spanAt(a, "$/then"))).toEqual([]);
    expect(closestFlip(danger, undefined)).toBeUndefined();
  });

  it("formats small distances honestly", () => {
    expect([fmtBy(0), fmtBy(0.004), fmtBy(0.005), fmtBy(0.123)]).toEqual(["0", "<0.01", "0.01", "0.12"]);
  });
});

// ── the real runtime agrees ──────────────────────────────────────────────────

/** Set the deciding number a flip measures, for the single-question chains above. */
function moved(answer: Answer, flip: Flip, x: number, label?: string): Answer {
  if (flip.measure === "confidence" || flip.measure.startsWith("confidence at")) {
    if (answer.type === "noul") return { ...answer, noul: answer.noul >= 0.5 ? 0.5 + x / 2 : 0.5 - x / 2 };
    return { ...answer, confidence: x };
  }
  if (answer.type === "noul") return { ...answer, noul: x };
  if (answer.type === "score") return { ...answer, score: x };
  if (label) return { ...answer, probabilities: { ...answer.probabilities, [label]: x } };
  return { ...answer, confidence: x };
}

describe("flipsOf: the runtime flips there and nowhere closer", () => {
  const cases: { name: string; root: AnyNode; question: string; answers: Answer[]; label?: string }[] = [
    { name: "danger", root: danger, question: "Danger?", answers: [0.02, 0.33, 0.41, 0.5, 0.57, 0.6, 0.63, 0.97].map(yes) },
    { name: "halting", root: halting, question: "Safe?", answers: [0.1, 0.5, 0.51, 0.9].map(yes) },
    { name: "window", root: window, question: "How much?", answers: [0.2, 1, 1.5, 2, 2.4, 3].map((s) => scored(s)) },
    { name: "doubtful", root: doubtful, question: "Sure?", answers: [0.05, 0.4, 0.62, 0.69, 0.75, 0.99].map(yes) },
    { name: "desk (unsure)", root: desk, question: "Which desk?", answers: [0.1, 0.39, 0.4, 0.45, 0.9].map((c) => pick({ repair: 0.5, billing: 0.3, haunted: 0.2 }, c)) },
  ];
  for (const c of cases) {
    it(`${c.name}: every flip that moves one number`, async () => {
      for (const answer of c.answers) {
        const base = await runWith(c.root, { [c.question]: answer });
        const taken = spanAt(base, "$")!.decision!.taken;
        for (const [i, flip] of flipsOf(c.root, spanAt(base, "$")).entries()) {
          if (flip.measure === "lead") continue; // a label's lead isn't one number; tallied by hand above
          const dir = flip.up ? 1 : -1;
          const edgeOf = async (x: number) => spanAt(await runWith(c.root, { [c.question]: moved(answer, flip, x, c.label) }), "$")!.decision!.taken;
          // At the boundary, or a hair past it, the runtime takes the flip's road...
          const at = await edgeOf(flip.to);
          const past = await edgeOf(flip.to + dir * 1e-6);
          expect([at, past], `${c.name} ${JSON.stringify(answer)} → ${flip.edge}`).toContain(flip.edge);
          // ...and nowhere short of it does it get there. Short of the nearest flip, it takes the road it took.
          for (const f of [0.25, 0.5, 0.75, 0.999]) {
            const short = await edgeOf(flip.from + (flip.to - flip.from) * f);
            expect(short).not.toBe(flip.edge);
            if (i === 0) expect(short).toBe(taken);
          }
        }
      }
    });
  }

  it("cascade: escalating and accepting happen exactly at the tier's bar", async () => {
    for (const [gut, full] of [
      [0.8, 0.775],
      [0.95, 0.6],
      [0.6, 0.65],
      [0.85, 0.9],
    ] as const) {
      const base = await runWith(textBack, { "Text back?": [yes(gut), yes(full)] });
      for (const flip of flipsOf(textBack, spanAt(base, "$"))) {
        const tierIndex = flip.measure.includes("Gut check") ? 0 : 1;
        const answers = [yes(gut), yes(full)];
        // confidence exactly at the bar accepts, so escalating needs a hair under it.
        answers[tierIndex] = yes(0.5 + (flip.to + (flip.up ? 0 : -1e-6)) / 2);
        const t = await runWith(textBack, { "Text back?": answers });
        const d = spanAt(t, "$")!.decision!;
        if (flip.escalates) expect(d.edges[tierIndex]!.taken, JSON.stringify(flip)).toBe(false);
        else expect(d.taken).toBe(flip.edge);
      }
    }
  });
});

describe("flipsOf: numbers on the line, and bars of 0 and 1", () => {
  it("a yes/no sitting on a cut (as float error puts it) flips at once, whichever side the cut rounds to", async () => {
    // 0.12 − 0.11 = 0.00999…: p(yes) 0.01 is on the unsure band's edge, and 0.010001 is inside it.
    const band = gate("band", { ask: noul("Band?"), pass: { min: 0.12, max: 0.18 }, unsure: { margin: 0.11, then: emit("u", { id: "u" }) }, then: emit("t", { id: "t" }), otherwise: emit("o", { id: "o" }) });
    const t1 = await runWith(band, { "Band?": yes(0.01) });
    expect(spanAt(t1, "$")!.decision!.taken).toBe("otherwise");
    expect(closestFlip(band, spanAt(t1, "$"))).toMatchObject({ edge: "unsure", by: 0, up: true });
    expect(spanAt(await runWith(band, { "Band?": yes(0.010001) }), "$")!.decision!.taken).toBe("unsure");

    // 0.5 − 0.8 / 2 = 0.09999…: p(yes) 0.1 is confidence 0.8 exactly, and 0.100001 is less sure.
    const sure = gate("sure", { ask: noul("Sure?"), pass: { max: 0.01 }, unsure: { minConfidence: 0.8, then: emit("u", { id: "u" }) }, then: emit("t", { id: "t" }), otherwise: emit("o", { id: "o" }) });
    const t2 = await runWith(sure, { "Sure?": yes(0.1) });
    expect(spanAt(t2, "$")!.decision!.taken).toBe("otherwise");
    expect(brief(flipsOf(sure, spanAt(t2, "$")))).toEqual([
      ["unsure", 0],
      ["then", 0.09],
    ]);
    expect(spanAt(await runWith(sure, { "Sure?": yes(0.100001) }), "$")!.decision!.taken).toBe("unsure");

    const win = gate("win", { ask: noul("Win?"), pass: { min: 0.53, max: 0.72 }, unsure: { minConfidence: 0.9, then: emit("u", { id: "u" }) }, then: emit("t", { id: "t" }), otherwise: emit("o", { id: "o" }) });
    const t3 = await runWith(win, { "Win?": yes(0.05) });
    expect(closestFlip(win, spanAt(t3, "$"))).toMatchObject({ edge: "unsure", by: 0 });
  });

  it("a bar of 0 can't be dropped below; a bar of 1 can be reached", async () => {
    const lastResort = cascade("c", {
      tiers: [tier("quick", { ask: noul("Quick?"), minConfidence: 0.8 }), tier("careful", { ask: choice("Careful?", ["a", "b"]), minConfidence: 0 })],
      fallback: emit("f", { id: "f" }),
    });
    const t = await runWith(lastResort, { "Quick?": yes(0.6), "Careful?": pick({ a: 0.9, b: 0.1 }, 0.8) });
    expect(spanAt(t, "$")!.decision!.taken).toBe("careful");
    expect(brief(flipsOf(lastResort, spanAt(t, "$")))).toEqual([["quick", 0.6]]);

    const never = gate("g", { ask: score("How much?", ["a", "b", "c", "d"]), pass: { min: 1 }, unsure: { minConfidence: 0, then: emit("u", { id: "u" }) }, then: emit("t", { id: "t" }), otherwise: emit("o", { id: "o" }) });
    const g = await runWith(never, { "How much?": scored(2.5, 0.7) });
    expect(brief(flipsOf(never, spanAt(g, "$")))).toEqual([["otherwise", 1.5]]);

    // A bar of 1 can still be reached from below (confidence 1 accepts).
    const top = cascade("c", { tiers: [tier("all-in", { ask: noul("All in?"), minConfidence: 1 })], fallback: emit("f", { id: "f" }) });
    const c = await runWith(top, { "All in?": yes(0.9) });
    expect(brief(flipsOf(top, spanAt(c, "$")))).toEqual([["all-in", 0.2]]);
  });
});

// ── a seeded random sweep: the runtime is the judge ──────────────────────────

/** mulberry32: a small seeded PRNG, so a failure names a reproducible case. */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One number a flip can move: how to set it, the range it lives in, and where the rule might change. */
interface Dim {
  name: string;
  lo: number;
  hi: number;
  now: number;
  set: (x: number) => Record<string, Answer | Answer[]>;
  cuts: number[];
}

interface Case {
  root: AnyNode;
  answers: Record<string, Answer | Answer[]>;
  dims: Dim[];
  /** The number a flip moves. */
  dimOf: (flip: Flip) => Dim | undefined;
}

/** A grid value as someone would type it (0.07, not 0.07000000000000001). */
const snap = (v: number, step: number) => Number((Math.round(v / step) * step).toFixed(6));

function randomGate(r: () => number): Case {
  // (A choice gate always measures a label.)
  const kind = (["noul", "score", "label"] as const)[Math.floor(r() * 3)]!;
  const hi = kind === "score" ? 3 : 1;
  const step = kind === "score" ? 0.1 : 0.01;
  const edgeish = () => (r() < 0.15 ? 0 : r() < 0.15 ? hi : snap(r() * hi, step));
  const a = edgeish();
  const b = edgeish();
  const shape = Math.floor(r() * 3);
  const pass = shape === 0 ? { min: a } : shape === 1 ? { max: a } : { min: Math.min(a, b), max: Math.max(a, b) };
  const margin = r() < 0.5 ? snap(r() * 0.3 * hi, step) : undefined;
  const minConfidence = r() < 0.5 ? (r() < 0.2 ? 0 : r() < 0.2 ? 1 : snap(r(), 0.01)) : undefined;
  const unsure =
    margin !== undefined || minConfidence !== undefined
      ? { ...(margin !== undefined ? { margin } : {}), ...(minConfidence !== undefined ? { minConfidence } : {}), then: emit("u", { id: "u" }) }
      : undefined;
  const ask = kind === "noul" ? noul("Q?") : kind === "score" ? score("Q?", ["a", "b", "c", "d"]) : choice("Q?", ["a", "b"]);
  const root = gate("g", {
    ask,
    pass: { ...pass, ...(kind === "label" ? { label: "a" } : {}) },
    ...(unsure ? { unsure } : {}),
    then: emit("t", { id: "t" }),
    ...(r() < 0.8 ? { otherwise: emit("o", { id: "o" }) } : {}),
  });
  // The rule's own cuts, computed the way a float would, so Jev's number sometimes lands right on one.
  const bar = pass.min ?? pass.max;
  const cuts = [pass.min, pass.max, bar !== undefined && margin !== undefined ? bar - margin : undefined, bar !== undefined && margin !== undefined ? bar + margin : undefined].filter(
    (x): x is number => x !== undefined,
  );
  if (kind === "noul" && minConfidence !== undefined) cuts.push(0.5 - minConfidence / 2, 0.5 + minConfidence / 2);
  // On a cut: sometimes exactly where the float lands (0.12 − 0.11), sometimes as typed (0.01), a hair off it.
  const cut = cuts.length ? cuts[Math.floor(r() * cuts.length)]! : 0;
  const value = Math.min(hi, Math.max(0, r() < 0.4 && cuts.length ? (r() < 0.5 ? cut : snap(cut, step)) : edgeish()));
  const conf = r() < 0.15 ? 0 : r() < 0.15 ? 1 : minConfidence !== undefined && r() < 0.3 ? minConfidence : snap(r(), 0.01);
  const make = (v: number, c: number): Answer =>
    kind === "noul" ? yes(v) : kind === "score" ? scored(v, c) : pick({ a: v, b: 1 - v }, c);
  const valueDim: Dim = { name: "value", lo: 0, hi, now: value, set: (x) => ({ "Q?": make(x, conf) }), cuts: [...cuts, value] };
  const confDim: Dim | undefined =
    kind !== "noul" ? { name: "confidence", lo: 0, hi: 1, now: conf, set: (x) => ({ "Q?": make(value, x) }), cuts: [minConfidence ?? 0.5, conf] } : undefined;
  return { root, answers: { "Q?": make(value, conf) }, dims: confDim ? [valueDim, confDim] : [valueDim], dimOf: (f) => (f.measure === "confidence" && confDim ? confDim : valueDim) };
}

function randomCascade(r: () => number): Case {
  const n = 1 + Math.floor(r() * 3);
  const bars = Array.from({ length: n }, () => (r() < 0.2 ? 0 : r() < 0.15 ? 1 : snap(r(), 0.01)));
  const kinds = Array.from({ length: n }, () => (r() < 0.5 ? "noul" : "choice"));
  const root = cascade("c", {
    tiers: bars.map((minConfidence, i) => tier(`t${i}`, { ask: kinds[i] === "noul" ? noul(`T${i}?`) : choice(`T${i}?`, ["a", "b"]), minConfidence })),
    fallback: emit("f", { id: "f" }),
  });
  const confs = bars.map((b) => (r() < 0.25 ? b : r() < 0.15 ? 0 : r() < 0.15 ? 1 : snap(r(), 0.01)));
  const make = (i: number, c: number): Answer => (kinds[i] === "noul" ? yes(0.5 + c / 2) : pick({ a: 0.7, b: 0.3 }, c));
  const all = (i?: number, x?: number) => Object.fromEntries(confs.map((c, j) => [`T${j}?`, make(j, j === i ? x! : c)]));
  const dims = confs.map((c, i): Dim => ({ name: `t${i}`, lo: 0, hi: 1, now: c, set: (x) => all(i, x), cuts: [bars[i]!, c] }));
  return { root, answers: all(), dims, dimOf: (f) => dims[Number(/at t(\d+)/.exec(f.measure)?.[1])] };
}

function randomRoute(r: () => number): Case {
  const below = r() < 0.2 ? 0 : r() < 0.2 ? 1 : snap(r(), 0.01);
  const root = route("r", {
    ask: choice("R?", ["a", "b", "c"]),
    lowConfidence: { below, then: emit("h", { id: "h" }) },
    branches: { a: emit("a", { id: "a" }), b: emit("b", { id: "b" }), c: emit("c", { id: "c" }) },
  });
  const c = r() < 0.3 ? below : r() < 0.15 ? 0 : r() < 0.15 ? 1 : snap(r(), 0.01);
  const probs = { a: 0.5, b: 0.3, c: 0.2 };
  const dim: Dim = { name: "confidence", lo: 0, hi: 1, now: c, set: (x) => ({ "R?": pick(probs, x) }), cuts: [below, c] };
  return { root, answers: { "R?": pick(probs, c) }, dims: [dim], dimOf: (f) => (f.measure === "confidence" ? dim : undefined) };
}

describe("flipsOf: a seeded random sweep against the runtime", () => {
  it("every flip happens at its boundary and never short of it, and nothing nearer flips", async () => {
    const r = prng(20260925);
    const stats = { cases: 0, flips: 0, probes: 0 };
    const decide = async (root: AnyNode, answers: Record<string, Answer | Answer[]>) => spanAt(await runWith(root, answers), "$")!.decision!;
    for (let n = 0; n < 2400; n++) {
      const c = n % 3 === 0 ? randomGate(r) : n % 3 === 1 ? randomCascade(r) : randomRoute(r);
      const where = `case ${n}: ${JSON.stringify(c.root)} ${JSON.stringify(c.answers)}`;
      const span = spanAt(await runWith(c.root, c.answers), "$")!;
      const road = span.decision!.taken;
      const flips = flipsOf(c.root, span);
      stats.cases++;
      // A cascade escalation is judged by the tier it moves: that tier passes the question on.
      const reaches = async (flip: Flip, dim: Dim, x: number) => {
        const d = await decide(c.root, dim.set(x));
        return flip.escalates ? d.edges[c.dims.indexOf(dim)]!.taken === false : d.taken === flip.edge;
      };
      for (const [i, flip] of flips.entries()) {
        if (flip.measure === "lead") continue; // a label's lead isn't one number; tallied by hand above
        stats.flips++;
        const dim = c.dimOf(flip)!;
        const w = `${where} flip ${JSON.stringify(flip)}`;
        // The target is somewhere the number can be...
        expect(flip.to, w).toBeGreaterThanOrEqual(dim.lo);
        expect(flip.to, w).toBeLessThanOrEqual(dim.hi);
        // ...the runtime takes the road there or a hair past it...
        let hit = false;
        for (const x of [flip.to, flip.to + (flip.up ? 1 : -1) * 1e-6]) if (x >= dim.lo && x <= dim.hi && (await reaches(flip, dim, x))) hit = true;
        expect(hit, w).toBe(true);
        // ...and not short of it.
        for (const f of [0.25, 0.5, 0.75, 0.999]) {
          const x = dim.now + (flip.to - dim.now) * f;
          if (Math.abs(x - dim.now) >= flip.by - 1e-6) continue;
          expect(await reaches(flip, dim, x), w).toBe(false);
          if (i === 0) expect((await decide(c.root, dim.set(x))).taken, w).toBe(road);
        }
      }
      // Nothing nearer: wherever moving one number changes the road, a flip at least that near is listed for it.
      for (const [k, dim] of c.dims.entries()) {
        const xs = new Set<number>();
        for (let j = 0; j <= 100; j++) xs.add(dim.lo + ((dim.hi - dim.lo) * j) / 100);
        for (const t of dim.cuts) for (const d of [0, 1e-6, -1e-6]) xs.add(t + d);
        for (const x of xs) {
          if (x < dim.lo || x > dim.hi) continue;
          stats.probes++;
          const d = await decide(c.root, dim.set(x));
          if (d.taken === road) continue;
          // A cascade's answering tier moving is an escalation, wherever the next tier then sends it.
          const escalated = c.root.kind === "cascade" && road === `t${k}`;
          // Flips keep the nearest move per road, whichever number it is, so any listed one at least this near will do.
          const listed = flips.find((f) => (escalated ? f.escalates : f.edge === d.taken));
          const w = `${where} moving ${dim.name} to ${x} goes ${d.taken}; flips ${JSON.stringify(flips)}`;
          expect(listed, w).toBeDefined();
          expect(listed!.by, w).toBeLessThanOrEqual(Math.abs(x - dim.now) + 1e-6);
        }
      }
    }
    expect(stats.flips).toBeGreaterThan(stats.cases);
    console.info(`margin sweep: ${stats.cases} random chains, ${stats.flips} flips checked at and short of the boundary, ${stats.probes} runtime probes for a nearer flip`);
  }, 120_000);
});

// ── sweeps ───────────────────────────────────────────────────────────────────

describe("closeCallsAt", () => {
  it("ranks a sweep's inputs by how close they came, per decision", async () => {
    const client = scripted({
      "Which desk?": [
        pick({ repair: 0.5, billing: 0.3, haunted: 0.2 }, 0.9), // repair, led billing by 0.2
        pick({ repair: 0.2, billing: 0.7, haunted: 0.1 }, 0.42), // billing, 0.02 from unsure
        pick({ repair: 0.34, billing: 0.33, haunted: 0.33 }, 0.35), // unsure, 0.05 from repair
      ],
    });
    const inputs = ["a", "b", "c"].map((v) => ({ label: v, value: v }));
    const { rows } = await runSweep(desk, inputs, client);
    const calls = closeCallsAt(desk, rows, "$");
    expect(calls.map((c) => [c.row.label, c.taken, c.flip.edge, c.flip.by])).toEqual([
      ["b", "billing", "lowConfidence", 0.02],
      ["c", "lowConfidence", "repair", 0.05],
      ["a", "repair", "billing", 0.2],
    ]);
    expect(calls.map((c) => c.index)).toEqual([1, 2, 0]);
  });

  it("skips inputs that never made the decision or didn't finish", () => {
    const rows: SweepRow[] = [{ label: "never ran", value: "x" }];
    expect(closeCallsAt(desk, rows, "$")).toEqual([]);
  });

  it("every example's sweep measures every decision it made", async () => {
    for (const ex of examples) {
      const { rows } = await runSweep(ex.chain, ex.inputs, rehearsalClient({ latencyMs: [0, 0] }));
      for (const row of rows) {
        for (const span of row.trace?.spans ?? []) {
          if (!span.decision) continue;
          const flip = closestFlip(ex.chain, span);
          expect(flip, `${ex.slug} ${row.label} ${span.path}`).toBeDefined();
          expect(flip!.by).toBeGreaterThanOrEqual(0);
          expect(flip!.edge).not.toBe(span.decision.taken);
        }
      }
    }
  });
});
