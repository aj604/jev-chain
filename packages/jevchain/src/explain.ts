/**
 * "Why did it go here?" Plain-language summaries, templated from the numbers.
 * No LLM involved; that would be a bit rich for a library about not using one.
 */
import { distance } from "./questions";
import type { Decision, Trace } from "./trace";

const pct = (v: number) => `${Math.round(v * 100)}%`;
const num = (v: number) => (Math.abs(v) >= 10 ? v.toFixed(1) : v.toFixed(2));

/** A few words on how lopsided a probability split was. */
export function marginWord(margin: number): string {
  if (margin >= 0.6) return "a landslide";
  if (margin >= 0.35) return "a comfortable win";
  if (margin >= 0.15) return "a clear lead";
  if (margin >= 0.05) return "a narrow lead";
  return "a photo finish";
}

/** How far a value landed from a bar, in words. */
function clearance(value: number, bar: number): string {
  return by(distance(value, bar));
}

/** A distance, in words: "by a hair", "by 0.06", "comfortably (by 0.20)", "easily (by 0.49)". */
function by(d: number): string {
  if (d < 0.03) return "by a hair";
  if (d < 0.1) return `by ${num(d)}`;
  if (d < 0.25) return `comfortably (by ${num(d)})`;
  return `easily (by ${num(d)})`;
}

export interface ExplainInput {
  kind: Decision["kind"];
  question: string;
  taken: string;
  edges: Decision["edges"];
  metric: Decision["metric"];
  value: number;
  threshold?: Decision["threshold"];
  confidence?: number;
  fallback?: boolean;
  /** Extra detail for low-confidence routes: which label *would* have won. */
  wouldHaveBeen?: string;
  /** The low-confidence bar that triggered a fallback. */
  lowConfidenceBelow?: number;
  /**
   * For a route: its low-confidence bar, whether or not it fired. When the
   * route didn't fall back, the sentence says how far `confidence` cleared it.
   */
  lowConfidence?: { below: number };
  /**
   * For a gate: its `unsure` triggers, whether or not they fired. When the
   * gate didn't take "unsure", the sentence measures the value from the edge
   * of the unsure margin (where the road actually changes) rather than from
   * the bar, and says how far `confidence` cleared `minConfidence`.
   */
  unsure?: { margin?: number; minConfidence?: number };
  /**
   * For a gate that took "unsure": which trigger(s) fired. `margin` when the
   * value landed within it of the bar; `minConfidence` (with the `confidence`
   * it was compared to) when Jev wasn't sure enough. Omitted, the sentence
   * just says it was close.
   */
  unsureBecause?: { margin?: number; minConfidence?: number; confidence?: number };
  /** For a cascade: each tier's `minConfidence`, by tier id, so escalations can say what they missed. */
  tierBars?: Readonly<Record<string, number>>;
}

/** One sentence explaining a decision. */
export function explainDecision(d: ExplainInput): string {
  switch (d.kind) {
    case "route":
      return explainRoute(d);
    case "gate":
      return explainGate(d);
    case "cascade":
      return explainCascade(d);
  }
}

function explainRoute(d: ExplainInput): string {
  if (d.fallback) {
    return `Jev leaned "${d.wouldHaveBeen}" but only at ${num(d.confidence ?? 0)} confidence, under the ${num(
      d.lowConfidenceBelow ?? d.lowConfidence?.below ?? 0,
    )} bar, so it took the low-confidence path instead of guessing.`;
  }
  const ranked = d.edges.filter((e) => e.value !== null && e.edge !== "lowConfidence").sort((a, b) => b.value! - a.value!);
  const winner = ranked[0];
  const runnerUp = ranked[1];
  if (!winner) return `Went to "${d.taken}".`;
  // A confident-looking split can still be one wobble from the human handoff: say how far.
  const below = d.lowConfidence?.below;
  const lowBar =
    below === undefined || d.confidence === undefined
      ? ""
      : distance(d.confidence, below) === 0
        ? `, exactly at the ${num(below)} low-confidence bar`
        : `, ${num(distance(d.confidence, below))} over the ${num(below)} low-confidence bar`;
  const conf = d.confidence !== undefined ? ` (confidence ${num(d.confidence)}${lowBar})` : "";
  if (!runnerUp) return `Went to "${d.taken}" at ${pct(winner.value!)}${conf}.`;
  const margin = distance(winner.value!, runnerUp.value!);
  return `Went to "${d.taken}" with ${pct(winner.value!)}, ${marginWord(margin)} over "${runnerUp.edge}" at ${pct(runnerUp.value!)}${conf}.`;
}

function describeValue(d: ExplainInput): string {
  switch (d.metric) {
    case "noul":
      return `p(yes) = ${num(d.value)}`;
    case "probability":
      return `p(${d.threshold?.label ?? "label"}) = ${num(d.value)}`;
    case "score":
      return `the score came in at ${num(d.value)}`;
    case "confidence":
      return `confidence was ${num(d.value)}`;
  }
}

function describeBar(t: Decision["threshold"]): string {
  if (!t) return "the bar";
  if (t.min !== undefined && t.max !== undefined) return `the ${num(t.min)}–${num(t.max)} window`;
  if (t.min !== undefined) return `the ${num(t.min)} bar`;
  if (t.max !== undefined) return `the ${num(t.max)} ceiling`;
  return "the bar";
}

/**
 * The edge of a gate's bar that a value is measured against: the only one
 * there is, or for a min–max window the edge it missed or, inside, the edge
 * it's closest to. The runtime's `unsure` margin and the gate's sentence both
 * use it, so "right next to the bar" always means the bar it was next to.
 */
export function nearestEdge(value: number, t: Decision["threshold"]): { bar: number; side: "min" | "max" } | undefined {
  const { min, max } = t ?? {};
  if (min !== undefined && max !== undefined) {
    if (value < min) return { bar: min, side: "min" };
    if (value > max) return { bar: max, side: "max" };
    return distance(value, min) <= distance(value, max) ? { bar: min, side: "min" } : { bar: max, side: "max" };
  }
  if (min !== undefined) return { bar: min, side: "min" };
  if (max !== undefined) return { bar: max, side: "max" };
  return undefined;
}

function explainGate(d: ExplainInput): string {
  const what = describeValue(d);
  const bar = describeBar(d.threshold);
  const edge = nearestEdge(d.value, d.threshold);
  const window = d.threshold?.min !== undefined && d.threshold?.max !== undefined;
  if (d.taken === "unsure") return explainUnsure(d, what, bar, edge, window);
  const passed = d.taken === "then";
  const where = passed ? (window ? "inside" : edge?.side === "max" ? "under" : "clearing") : edge?.side === "max" ? "over" : "short of";
  const margin = d.unsure?.margin;
  const dist = edge ? distance(d.value, edge.bar) : undefined;
  let position = `${where} ${bar}${edge ? ` ${clearance(d.value, edge.bar)}` : ""}`;
  if (edge && dist === 0) position = `exactly on ${window ? `the ${num(edge.bar)} ${edge.side === "min" ? "floor" : "ceiling"} of ${bar}` : bar}`;
  // With an unsure band, the road changes at the band's edge, not the bar: measure from there.
  if (edge && dist !== undefined && margin !== undefined) {
    const gap = dist > margin ? distance(dist, margin) : 0;
    const band = gap === 0 ? `exactly on the edge of its ${num(margin)} unsure margin` : `clear of its ${num(margin)} unsure margin ${by(gap)}`;
    position = `${num(dist)} ${where === "clearing" ? "over" : where} ${bar} and ${band}`;
  }
  const minConf = d.unsure?.minConfidence;
  let conf = "";
  if (minConf !== undefined && d.confidence !== undefined) {
    conf =
      distance(d.confidence, minConf) === 0
        ? `, with confidence ${num(d.confidence)} exactly at the ${num(minConf)} unsure minimum`
        : `, with confidence ${num(d.confidence)} over the ${num(minConf)} unsure minimum ${clearance(d.confidence, minConf)}`;
  }
  if (passed) return `Passed: ${what}, ${position}${conf}.`;
  const tail = d.edges.some((e) => e.edge === "otherwise") ? `took "otherwise"` : "the run stopped here";
  return `Blocked: ${what}, ${position}${conf}, so ${tail}.`;
}

function explainUnsure(d: ExplainInput, what: string, bar: string, edge: ReturnType<typeof nearestEdge>, window: boolean): string {
  const why = d.unsureBecause;
  const conf = d.confidence !== undefined ? ` (confidence ${num(d.confidence)})` : "";
  if (!why || (why.margin === undefined && why.minConfidence === undefined)) {
    return `Too close to call: ${what}, right next to ${bar}${conf}, so it took the "unsure" path.`;
  }
  const reasons: string[] = [];
  if (why.margin !== undefined && edge) {
    const place = window ? `the ${num(edge.bar)} ${edge.side === "min" ? "floor" : "ceiling"} of ${bar}` : bar;
    const gap = distance(d.value, edge.bar);
    const where = gap === 0 ? `exactly on ${place}` : `${num(gap)} ${d.value < edge.bar ? "under" : "over"} ${place}`;
    reasons.push(`${where}, inside the ${num(why.margin)} margin`);
  }
  if (why.minConfidence !== undefined) {
    const c = why.confidence ?? d.confidence;
    reasons.push(`${c !== undefined ? `confidence ${num(c)}` : "confidence"} was under the ${num(why.minConfidence)} minimum`);
  }
  const verdict = why.margin !== undefined ? "Too close to call" : "Too unsure to call";
  return `${verdict}: ${what}, ${reasons.join(", and ")}${why.minConfidence === undefined ? conf : ""}, so it took the "unsure" path.`;
}

function explainCascade(d: ExplainInput): string {
  const tiers = d.edges.filter((e) => e.edge !== "fallback");
  const tried = tiers.filter((e) => e.value !== null);
  const skipped = tried.filter((e) => !e.taken);
  const needed = (tier: string) => (d.tierBars?.[tier] !== undefined ? `, needed ${num(d.tierBars[tier]!)}` : "");
  const escalations = skipped.length
    ? `Escalated past ${skipped.map((e) => `"${e.edge}" (${num(e.value!)}${needed(e.edge)})`).join(", ")}; `
    : "";
  if (d.taken === "fallback") {
    return `${escalations}no tier was confident enough, so it handed off to the fallback.`;
  }
  const bar = d.threshold?.min;
  const first = skipped.length === 0;
  return `${escalations}"${d.taken}" answered at ${num(d.value)} confidence${bar !== undefined ? ` (needed ${num(bar)})` : ""}${
    first ? ". No escalation needed, the cheap seats had it." : "."
  }`;
}

/** A short story of a whole run, one line per decision, plus the ending. */
export function explainTrace(trace: Trace): string[] {
  const lines: string[] = [];
  for (const s of trace.spans) {
    if (s.decision) lines.push(`${s.title ?? s.nodeId}: ${s.decision.summary}`);
  }
  if (trace.status === "halted" && trace.halted) lines.push(`Halted at ${trace.halted.nodeId}. ${trace.halted.summary}`);
  if (trace.status === "error" && trace.error) lines.push(`Failed: ${trace.error.message}`);
  if (trace.status === "aborted") lines.push("Aborted before it finished.");
  return lines;
}
