/**
 * Is it the input, or is it Jev? Reading an a-vs-b comparison across re-asks.
 *
 * Compare mode runs two inputs once each and says where they parted: "diverged
 * at Should I reply?: a went “fallback”, b went “full-context”". That reads as
 * "the edit did it". But the same input asked twice can go two ways (see
 * `lib/trace/reask`), so one pull of each can't tell an input that changes the
 * road from a coin that landed differently. Asking each input again can:
 *
 *   const splits = splitsOf(a, reasksOfA, b, reasksOfB);
 *   // [{ title: "Should I reply?", a: { asks: 6, reached: 6, roads: [{ edge: "fallback", count: 4 }, { edge: "full-context", count: 2 }] },
 *   //    b: { asks: 6, reached: 6, roads: [{ edge: "full-context", count: 6 }] }, shared: ["full-context"], verdict: "both-ways" }]
 *   splitHeadline(a, b, splits)
 *   // "diverged at Should I reply?: a went “fallback”, b went “full-context”. but asked again, both inputs
 *   //  went “full-context” (a on 2 of 6 asks, b on 6 of 6), so this split alone doesn't show the inputs are told apart here."
 *
 * Verdicts, per decision either run made:
 * - **apart**: no road was taken by both inputs, on any ask (two asks a side at least).
 * - **both-ways**: some road was taken by both inputs, and it wasn't the only one
 *   taken: at least one input goes more than one way here by itself.
 * - **same**: every ask of both inputs took one road (two asks a side at least).
 * - **thin**: one side got here only once and nothing is shared yet: too few to say.
 * - **one-sided**: only one input got here at all (an earlier decision explains it).
 *
 * When a and b are the very same input no re-ask is needed: any split between
 * them is Jev answering differently (`sameInput`).
 */
import { decisions, diffTraces, spanAt, type Decision, type Json, type Trace } from "jevchain";
import { answeredReasks } from "./reask";
import { edgeName } from "./what-if";

/** One input's asks, read at one decision. */
export interface SideTally {
  /** Asks of this input Jev answered, the run itself included (see `answeredReasks`). */
  asks: number;
  /** Of those, how many made this decision. */
  reached: number;
  /** The roads they took here, most first (ties in the order they were first seen, the run itself first). */
  roads: { edge: string; count: number }[];
}

export type SplitVerdict = "apart" | "both-ways" | "same" | "thin" | "one-sided";

export interface Split {
  /** The deciding span path (= the decision's vertex id). */
  path: string;
  nodeId: string;
  title: string;
  kind: Decision["kind"];
  a: SideTally;
  b: SideTally;
  /** Roads both inputs took on at least one ask. */
  shared: string[];
  verdict: SplitVerdict;
}

/** Key-order-independent equality for inputs (the editors may format them differently). */
export function sameInput(x: Json | undefined, y: Json | undefined): boolean {
  if (x === undefined || y === undefined) return false;
  return canonical(x) === canonical(y);
}

function canonical(v: Json): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  return `{${Object.keys(v)
    .sort()
    .filter((k) => v[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonical(v[k] as Json)}`)
    .join(",")}}`;
}

/** A side's answered asks: the run (if Jev answered it) plus its answered re-asks. */
function asksOf(run: Trace, reasks: readonly (Trace | undefined)[]): Trace[] {
  return answeredReasks([run, ...reasks]);
}

function tally(asks: readonly Trace[], path: string): SideTally {
  const roads = new Map<string, number>();
  let reached = 0;
  for (const t of asks) {
    const d = spanAt(t, path)?.decision;
    if (!d) continue;
    reached++;
    roads.set(d.taken, (roads.get(d.taken) ?? 0) + 1);
  }
  // Map keeps first-seen order; a stable sort keeps it among equals.
  return { asks: asks.length, reached, roads: [...roads].map(([edge, count]) => ({ edge, count })).sort((x, y) => y.count - x.count) };
}

/**
 * Every decision run a or run b made, read across both inputs' asks: `a` and
 * its re-asks, `b` and its re-asks (either list may be empty). Ordered as the
 * decisions appear in a, then any only b made.
 */
export function splitsOf(a: Trace, reasksA: readonly (Trace | undefined)[], b: Trace, reasksB: readonly (Trace | undefined)[]): Split[] {
  const asksA = asksOf(a, reasksA);
  const asksB = asksOf(b, reasksB);
  const seen = new Map<string, { nodeId: string; title: string; kind: Decision["kind"] }>();
  for (const t of [a, ...asksA, b, ...asksB]) {
    for (const { path, nodeId, decision } of decisions(t)) {
      if (!seen.has(path)) seen.set(path, { nodeId, title: spanAt(t, path)?.title ?? nodeId, kind: decision.kind });
    }
  }
  return [...seen].map(([path, meta]) => {
    const ta = tally(asksA, path);
    const tb = tally(asksB, path);
    const inB = new Set(tb.roads.map((r) => r.edge));
    const shared = ta.roads.map((r) => r.edge).filter((e) => inB.has(e));
    return { path, ...meta, a: ta, b: tb, shared, verdict: verdictOf(ta, tb, shared) };
  });
}

function verdictOf(a: SideTally, b: SideTally, shared: string[]): SplitVerdict {
  if (a.reached === 0 || b.reached === 0) return "one-sided";
  if (shared.length > 0) return shared.length === 1 && a.roads.length === 1 && b.roads.length === 1 ? (a.reached < 2 || b.reached < 2 ? "thin" : "same") : "both-ways";
  return a.reached < 2 || b.reached < 2 ? "thin" : "apart";
}

/** Whether any re-ask (of either side) is in these splits, i.e. there's more than one pull of something to read. */
export function hasReasks(splits: readonly Split[]): boolean {
  return splits.some((s) => s.a.asks > 1 || s.b.asks > 1);
}

const road = (edge: string) => `“${edgeName(edge)}”`;

/** "“fallback” 4, “full-context” 2 of 6" (or "“fallback” 6 of 6"). */
function roadsText(t: SideTally): string {
  return `${t.roads.map((r) => `${road(r.edge)} ${r.count}`).join(", ")} of ${t.reached}`;
}

const asksWord = (n: number) => `${n} ask${n === 1 ? "" : "s"}`;

/**
 * One decision across both inputs' asks, as a sentence:
 *   "apart on every ask: a's input “fallback” 6 of 6, b's “full-context” 6 of 6"
 *   "both inputs went “full-context”: a's “fallback” 4, “full-context” 2 of 6, b's “full-context” 6 of 6"
 *   "“gut-check” on every ask of both inputs (6 and 6)"
 */
export function splitText(s: Split): string {
  switch (s.verdict) {
    case "one-sided": {
      const [who, t] = s.a.reached > 0 ? (["a", s.a] as const) : (["b", s.b] as const);
      return `only ${who}'s input got here (${t.reached} of its ${asksWord(t.asks)}): ${roadsText(t)}`;
    }
    case "thin": {
      const who = s.a.reached < 2 ? "a" : "b";
      return `${who}'s input got here on one ask only, too few to tell · a's ${roadsText(s.a)}, b's ${roadsText(s.b)}`;
    }
    case "same":
      return `${road(s.shared[0]!)} on every ask of both inputs (${s.a.reached} and ${s.b.reached})`;
    case "apart":
      return `apart on every ask: a's input ${roadsText(s.a)}, b's ${roadsText(s.b)}`;
    case "both-ways":
      return `both inputs went ${s.shared.map(road).join(" and ")}: a's ${roadsText(s.a)}, b's ${roadsText(s.b)}`;
  }
}

/** "a on 2 of 6 asks, b on 6 of 6" for one road. */
function onWhich(s: Split, edge: string): string {
  const n = (t: SideTally) => t.roads.find((r) => r.edge === edge)?.count ?? 0;
  return `a on ${n(s.a)} of ${asksWord(s.a.reached)}, b on ${n(s.b)} of ${s.b.reached}`;
}

/**
 * The one-line verdict on a and b, read across the re-asks when there are any.
 * `path` is where they parted (for the "jump there" click).
 */
export function splitHeadline(a: Trace, b: Trace, splits?: readonly Split[]): { text: string; diverged: boolean; path?: string } {
  const d = diffTraces(a, b);
  const same = sameInput(a.input, b.input);
  const read = splits && hasReasks(splits) ? splits : undefined;
  if (d.divergedAt) {
    const { path } = d.divergedAt;
    const title = a.spans.find((s) => s.path === path)?.title ?? d.divergedAt.nodeId;
    const base = `diverged at ${title}: a went ${road(d.divergedAt.a)}, b went ${road(d.divergedAt.b)}`;
    if (same) return { text: `${base}. same input both times, so that's jev answering differently, not the input.`, diverged: true, path };
    const s = read?.find((x) => x.path === path);
    if (s?.verdict === "apart") {
      return { text: `diverged at ${title}, on every ask: a's input went ${roadsText(s.a)}, b's ${roadsText(s.b)}.`, diverged: true, path };
    }
    if (s?.verdict === "both-ways") {
      // The road that shows it best: one the side that didn't take it this pull took on a re-ask.
      const edge = s.shared.find((e) => e === d.divergedAt!.b) ?? s.shared.find((e) => e === d.divergedAt!.a) ?? s.shared[0]!;
      return {
        text: `${base}. but asked again, both inputs went ${road(edge)} (${onWhich(s, edge)}), so this split alone doesn't show the inputs are told apart here.`,
        diverged: true,
        path,
      };
    }
    return { text: `${base}.`, diverged: true, path };
  }
  const parted = read?.find((s) => s.verdict === "apart" || s.verdict === "both-ways");
  if (parted) {
    return {
      text: `same road this pull, but not on every ask: at ${parted.title}, a's input went ${roadsText(parted.a)}, b's ${roadsText(parted.b)}.`,
      diverged: true,
      path: parted.path,
    };
  }
  if (d.onlyA.length || d.onlyB.length) return { text: "same decisions, but the runs ended in different places.", diverged: true };
  if (read) {
    return { text: `same road, every fork, on every ask (${read[0]!.a.asks} of a's input, ${read[0]!.b.asks} of b's). only the numbers differ.`, diverged: false };
  }
  return { text: "same road, every fork. only the numbers differ.", diverged: false };
}
