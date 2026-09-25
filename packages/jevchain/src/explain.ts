/**
 * "Why did it go here?" Plain-language summaries, templated from the numbers.
 * No LLM involved; that would be a bit rich for a library about not using one.
 */
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
  const d = Math.abs(value - bar);
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
      d.lowConfidenceBelow ?? 0,
    )} bar, so it took the low-confidence path instead of guessing.`;
  }
  const ranked = d.edges.filter((e) => e.value !== null && e.edge !== "lowConfidence").sort((a, b) => b.value! - a.value!);
  const winner = ranked[0];
  const runnerUp = ranked[1];
  if (!winner) return `Went to "${d.taken}".`;
  const conf = d.confidence !== undefined ? ` (confidence ${num(d.confidence)})` : "";
  if (!runnerUp) return `Went to "${d.taken}" at ${pct(winner.value!)}${conf}.`;
  const margin = winner.value! - runnerUp.value!;
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

function explainGate(d: ExplainInput): string {
  const what = describeValue(d);
  const bar = describeBar(d.threshold);
  const ref = d.threshold?.min ?? d.threshold?.max;
  if (d.taken === "unsure") {
    return `Too close to call: ${what}, right next to ${bar}${
      d.confidence !== undefined ? ` (confidence ${num(d.confidence)})` : ""
    }, so it took the "unsure" path.`;
  }
  const ceilingOnly = d.threshold?.min === undefined && d.threshold?.max !== undefined;
  const by = ref !== undefined ? ` ${clearance(d.value, ref)}` : "";
  if (d.taken === "then") return `Passed: ${what}, ${ceilingOnly ? "under" : "clearing"} ${bar}${by}.`;
  const tail = d.edges.some((e) => e.edge === "otherwise") ? `took "otherwise"` : "the run stopped here";
  return `Blocked: ${what}, ${ceilingOnly ? "over" : "short of"} ${bar}${by}, so ${tail}.`;
}

function explainCascade(d: ExplainInput): string {
  const tiers = d.edges.filter((e) => e.edge !== "fallback");
  const tried = tiers.filter((e) => e.value !== null);
  const skipped = tried.filter((e) => !e.taken);
  const escalations = skipped.length
    ? `Escalated past ${skipped.map((e) => `"${e.edge}" (${num(e.value!)})`).join(", ")}; `
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
