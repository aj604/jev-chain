/**
 * Ask again: would Jev take this road every time?
 *
 * Jev isn't a lookup table. The same input asked twice comes back with
 * slightly different numbers (a confidence of 0.43, then 0.47), and when a
 * decision sits near its bar that's enough to send the same input down a
 * different road. One trace can't show it: it's one sample. "Closest call"
 * (`lib/trace/margin`) says how far the number would have to move; this says
 * how far it *does* move, by asking the same input again and reading every
 * decision the run made across all the asks.
 *
 *   const rows = await runSweep(node, reaskInputs(input), client);  // the same input, REASKS more times
 *   const steady = steadinessOf(chain.node, trace, rows.map((r) => r.trace));
 *   // [{ title: "Should I reply?", asked: 6, held: 2, elsewhere: [{ edge: "fallback", count: 4, first: 0 }], verdict: "flipped", … }]
 *   steadyText(steady[0])  // "went “fallback” on 4 of 6 asks"
 *
 * Verdicts, per decision the run made:
 * - **flipped**: at least one ask took a different road here.
 * - **could-flip**: every ask held, but Jev's own number moved at least as far
 *   between asks as some road not taken is away (so holding was luck).
 * - **held**: every ask held, and the wobble stayed short of every flip.
 *
 * Only real runs can be asked again: a rehearsal's answers are a hash of the
 * input (same every time, so "held" would be a lie), and a what-if's are bent.
 *
 * The asks are real requests, so they stay with the run (`keepReasks`): saved
 * with it in recent runs and packed into its share link, then read back
 * (`readKeptReasks`, `reaskRows`) into the very same verdicts without asking
 * Jev anything.
 */
import { decisions, spanAt, type AnyNode, type Decision, type Json, type Trace } from "jevchain";
import { fmtNum } from "./format";
import { flipsOf, fmtBy, measuredAt, type Flip } from "./margin";
import { isRehearsal } from "./rehearsal";
import type { RunIssue } from "./run-error";
import type { SweepInput, SweepRow } from "./sweep";
import { edgeName, isWhatIf } from "./what-if";

/** How many more times "ask again" asks: enough to catch a coin toss, few enough for the shared key. */
export const REASKS = 5;

/** The same input, `n` times over, as sweep rows (asks 2…n+1: the run itself was ask 1). */
export function reaskInputs(input: Json, n = REASKS): SweepInput[] {
  return Array.from({ length: n }, (_, i) => ({ label: `ask ${i + 2}`, value: input }));
}

/** Why this trace can't be asked again, or null when it can. */
export function reaskBlocker(trace: Trace | undefined): string | null {
  if (!trace || trace.status === "running") return "run it first";
  if (trace.status === "aborted") return "this run was stopped before it finished";
  if (isRehearsal(trace)) return "a rehearsal's answers are a hash of the input, so asked again they never change. ask jev for real to see if it would.";
  if (isWhatIf(trace)) return "a what-if bends jev's numbers. ask the run it forked from again instead.";
  if (decisions(trace).length === 0) return "nothing here was decided, so there's no road to hold";
  return null;
}

/**
 * A finished "ask again", as kept with its run: each re-ask in order (its
 * trace, or the issue that stopped it before a trace; empty when it never
 * started), how many were meant to run, and what stopped them early.
 */
export interface KeptReasks {
  asks: { trace?: Trace; issue?: RunIssue }[];
  total: number;
  stoppedBy?: RunIssue;
}

/**
 * The re-asks as they ended, ready to save or share, or undefined when Jev
 * answered none of them (nothing to read). Order is kept, so "open ask 4" is
 * the same ask later.
 */
export function keepReasks(rows: readonly SweepRow[], stoppedBy?: RunIssue, total = REASKS): KeptReasks | undefined {
  if (answeredReasks(rows.map((r) => r.trace)).length === 0) return undefined;
  return {
    asks: rows.map((r) => ({ ...(r.trace ? { trace: r.trace } : {}), ...(r.issue ? { issue: r.issue } : {}) })),
    total,
    ...(stoppedBy ? { stoppedBy } : {}),
  };
}

/** Kept re-asks back as the rows "ask again" made (asks 2…), for the same input. */
export function reaskRows(kept: KeptReasks, input: Json): SweepRow[] {
  return reaskInputs(input, kept.asks.length).map((row, i) => ({ ...row, ...kept.asks[i] }));
}

/** At most this many kept re-asks are read back: a share link is someone else's data. */
const MAX_KEPT = 20;

function isIssue(v: unknown): v is RunIssue {
  const x = v as Partial<RunIssue> | null;
  return typeof x === "object" && x !== null && typeof x.kind === "string" && typeof x.title === "string" && typeof x.detail === "string";
}

function isTrace(v: unknown): v is Trace {
  const x = v as Partial<Trace> | null;
  return typeof x === "object" && x !== null && Array.isArray(x.spans) && typeof x.status === "string";
}

/**
 * Kept re-asks from storage or a share link, or undefined when there are none
 * or they don't hold together (the run still opens, just not as asked again).
 * Only a run that could have been asked again keeps them, and only re-asks of
 * that run's input count.
 */
export function readKeptReasks(data: unknown, base: Trace): KeptReasks | undefined {
  if (!data || typeof data !== "object" || reaskBlocker(base)) return undefined;
  const { asks, total, stoppedBy } = data as { asks?: unknown; total?: unknown; stoppedBy?: unknown };
  if (!Array.isArray(asks) || asks.length > MAX_KEPT) return undefined;
  if (typeof total !== "number" || !Number.isInteger(total) || total < asks.length || total > MAX_KEPT) return undefined;
  if (stoppedBy !== undefined && !isIssue(stoppedBy)) return undefined;
  const same = JSON.stringify(base.input);
  const fits = asks.every((a: unknown) => {
    if (!a || typeof a !== "object") return false;
    const { trace, issue } = a as { trace?: unknown; issue?: unknown };
    if (issue !== undefined && !isIssue(issue)) return false;
    return trace === undefined || (isTrace(trace) && JSON.stringify(trace.input) === same);
  });
  if (!fits || answeredReasks(asks.map((a: { trace?: Trace }) => a.trace)).length === 0) return undefined;
  return { asks: asks as KeptReasks["asks"], total, ...(stoppedBy ? { stoppedBy: stoppedBy as RunIssue } : {}) };
}

export type Verdict = "flipped" | "could-flip" | "held";

export interface Steadiness {
  /** The deciding span path (= the decision's vertex id). */
  path: string;
  nodeId: string;
  title: string;
  kind: Decision["kind"];
  /** The road the run took. */
  taken: string;
  /** Asks that made this decision, the run itself included. */
  asked: number;
  /** Of those, how many took `taken`. */
  held: number;
  /** Roads other asks took here, most first; `first` is the re-ask that took it first (its index in the re-asks passed in). */
  elsewhere: { edge: string; count: number; first: number }[];
  /** Answered re-asks that finished on their own without making this decision (an earlier decision sent them elsewhere). */
  missed: number;
  /** Answered re-asks that broke (an error mid-run) before making this decision. */
  failed: number;
  /** The road not taken this is judged against: the nearest one Jev's wobble reaches, else the nearest. */
  flip?: Flip;
  /** How far `flip.measure` moved across the asks that answered it (the run included). */
  moved?: { min: number; max: number; by: number; n: number };
  /** "unasked": no re-ask made this decision, so there's no second answer to judge it by. */
  verdict: Verdict | "unasked";
}

/**
 * Re-asks Jev actually answered: finished (not stopped or unstarted) and made
 * at least one decision. A re-ask that failed before deciding anything (no
 * key, a 429, a network error) is no ask at all: it says nothing about where
 * the input goes. One that broke later still counts for what it decided.
 */
export function answeredReasks(traces: readonly (Trace | undefined)[]): Trace[] {
  return traces.filter((t): t is Trace => Boolean(t) && t!.status !== "running" && t!.status !== "aborted" && decisions(t!).length > 0);
}

/**
 * Every decision `base` made, read across `base` and the answered `reasks`
 * (the same input asked again; see `answeredReasks`). Numbers are measured
 * with the chain's own rule (`flipsOf`, `measuredAt`), so "moved" is the very
 * quantity a flip is measured in.
 */
export function steadinessOf(root: AnyNode, base: Trace, reasks: readonly (Trace | undefined)[]): Steadiness[] {
  const answered = answeredReasks(reasks);
  return decisions(base).map(({ path, nodeId, decision }) => {
    const span = spanAt(base, path)!;
    const taken = decision.taken;
    let asked = 1;
    let held = 1;
    let missed = 0;
    let failed = 0;
    const elsewhere = new Map<string, { edge: string; count: number; first: number }>();
    reasks.forEach((t, i) => {
      if (!t || !answered.includes(t)) return;
      const d = spanAt(t, path)?.decision;
      if (!d) {
        if (t.status === "error") failed++;
        else missed++;
        return;
      }
      asked++;
      if (d.taken === taken) held++;
      else {
        const e = elsewhere.get(d.taken) ?? { edge: d.taken, count: 0, first: i };
        e.count++;
        elsewhere.set(d.taken, e);
      }
    });
    const spans = [span, ...answered.map((t) => spanAt(t, path))];
    const judged = flipsOf(root, span).map((flip) => ({ flip, moved: spread(spans.map((s) => measuredAt(root, s, flip, taken))) }));
    const reached = judged.find((j) => j.moved && j.moved.by >= j.flip.by);
    const pick = reached ?? judged[0];
    return {
      path,
      nodeId,
      title: span.title ?? nodeId,
      kind: decision.kind,
      taken,
      asked,
      held,
      elsewhere: [...elsewhere.values()].sort((a, b) => b.count - a.count || a.first - b.first),
      missed,
      failed,
      ...(pick ? { flip: pick.flip } : {}),
      ...(pick?.moved ? { moved: pick.moved } : {}),
      verdict: asked === 1 ? "unasked" : held < asked ? "flipped" : reached ? "could-flip" : "held",
    };
  });
}

function spread(values: (number | undefined)[]): Steadiness["moved"] {
  const xs = values.filter((v): v is number => v !== undefined);
  if (xs.length < 2) return undefined;
  const min = Math.min(...xs);
  const max = Math.max(...xs);
  return { min, max, by: Math.round((max - min) * 1e6) / 1e6, n: xs.length };
}

const road = (edge: string) => `“${edgeName(edge)}”`;

/** Where a flip goes, as the end of a sentence: "go “unsure”", "fall back", "ask “full-context”". */
function goes(flip: Flip): string {
  if (flip.escalates) return flip.edge === "fallback" ? "fall back" : `ask ${road(flip.edge)}`;
  return `go ${road(flip.edge)}`;
}

/** What moved, as people say it: "jev's confidence at Gut check", "the lead over “billing”". */
function what(flip: Flip): string {
  return flip.measure === "lead" ? `the lead over ${road(flip.edge)}` : `jev's ${flip.measure}`;
}

/**
 * One decision across the asks, as a sentence:
 *   "went “fallback” on 4 of 6 asks"
 *   "held on all 6 asks, but jev's confidence moved 0.05 between them: more than the 0.01 it takes to fall back"
 *   "held on all 6 asks · jev's p(yes) moved 0.02; it'd take 0.30 to go “otherwise”"
 */
export function steadyText(s: Steadiness): string {
  const plural = (n: number) => `${n} re-ask${n === 1 ? "" : "s"}`;
  const missed = `${s.missed > 0 ? ` · ${plural(s.missed)} never got here` : ""}${s.failed > 0 ? ` · ${plural(s.failed)} failed before getting here` : ""}`;
  if (s.verdict === "unasked") return `only this run got here, so there's no second answer to compare${missed}`;
  if (s.verdict === "flipped") {
    const parts = s.elsewhere.map((e, i) => `${i === 0 ? "went " : ""}${road(e.edge)} on ${e.count}`);
    const range = s.flip && s.moved && s.moved.by > 0 ? ` · ${what(s.flip)} ranged ${fmtNum(s.moved.min)}–${fmtNum(s.moved.max)}` : "";
    return `${parts.join(", ")} of ${s.asked} asks${range}${missed}`;
  }
  const all = `held on all ${s.asked} asks`;
  if (!s.flip || !s.moved) return `${all}${missed}`;
  const moved = s.moved.by === 0 ? `${what(s.flip)} didn't move` : `${what(s.flip)} moved ${fmtBy(s.moved.by)}`;
  if (s.verdict === "could-flip") {
    // Rounded to two places the two can read the same ("moved 0.23 … more than the 0.23").
    const than = fmtBy(s.moved.by) === fmtBy(s.flip.by) ? "as far as" : "more than";
    const need = s.flip.by === 0 ? `it sits right on the line to ${goes(s.flip)}` : `${than} the ${fmtBy(s.flip.by)} it takes to ${goes(s.flip)}`;
    return `${all}, but ${moved} between them: ${need}${missed}`;
  }
  return `${all} · ${moved}; it'd take ${fmtBy(s.flip.by)} to ${goes(s.flip)}${missed}`;
}

/** The run's whole story across the asks, in a line: "1 of 2 decisions went another way on at least one ask." */
export function steadyHeadline(everything: readonly Steadiness[]): string {
  // Only decisions some re-ask also made have anything to say.
  const all = everything.filter((s) => s.verdict !== "unasked");
  const unasked = everything.length - all.length;
  const unaskedNote = unasked === 0 ? "" : ` ${unasked === 1 ? "one decision" : `${unasked} decisions`} no re-ask got to.`;
  if (all.length === 0) return `no re-ask got as far as ${everything.length === 1 ? "the decision" : "any decision this run made"}, so there's nothing to compare.`;
  const flipped = all.filter((s) => s.verdict === "flipped").length;
  const close = all.filter((s) => s.verdict === "could-flip").length;
  const which = (n: number) => (everything.length === 1 ? "the decision" : `${n} of ${all.length} decisions`);
  const closeNote = close === 0 ? "" : ` ${close === 1 ? "one more" : `${close} more`} held, though jev's numbers moved as far as it takes to flip ${close === 1 ? "it" : "them"}.`;
  if (flipped > 0) return `${which(flipped)} went another way on at least one ask.${closeNote}${unaskedNote}`;
  if (close > 0) return `every ask took the same road, but on ${which(close)} jev's numbers moved as far as it takes to flip.${unaskedNote}`;
  return `every ask took the same road, and jev's numbers never moved far enough to flip ${all.length === 1 ? "it" : "one"}.${unaskedNote}`;
}
