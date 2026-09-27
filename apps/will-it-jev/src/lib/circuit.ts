import type { Answer, Trace } from "jevchain";
import { findRecipeNode } from "./recipe/tree";
import type { RatedQuestion, Recipe, RecipeGate, RecipeRate, RecipeRoute } from "./recipe/types";
import { goodness } from "./recipe/verdict";

/**
 * The circuit: one row per gate, route and rating a run has reached, for the
 * page to show while the run goes and after. Everything here reads a live
 * or decoded trace, so malformed parts are skipped or read as "thinking",
 * and nothing throws.
 */

export interface RateItem {
  question: string;
  /** "Yes, 70%", a score's level text, or "<description>, 90%". */
  answer: string;
  /** 0 to 1, for the bar. See `goodness`. */
  goodness: number;
}

export interface DecisionRow {
  kind: "gate" | "route";
  /** The span path. Unique per row, so the UI can key on it. */
  path: string;
  question: string;
  status: "thinking" | "done";
  /** Done only. A gate's "Yes" or "No", or the winning route label's description. */
  answer?: string;
  /** Done only. The shown answer's probability as a whole percentage. */
  pct?: number;
  /** Done only. The answer that lost. For a route, the likeliest label not taken. */
  other?: string;
}

export interface RateRow {
  kind: "rate";
  path: string;
  status: "thinking" | "done";
  /** One per answered rated question, in the recipe's order. Empty while thinking. */
  items: RateItem[];
}

export type CircuitRow = DecisionRow | RateRow;

/**
 * One row per gate, route and rate span in `trace`, in span order.
 *
 * - A span whose node isn't in the recipe (verdict emits, anything unknown)
 *   is skipped, and so is a second span with a path already shown.
 * - A gate or route is "thinking" until its span has a decision it can read.
 *   A gate's span stays "running" while its subtree runs, so the decision,
 *   not the span status, is what marks it done. A decision that never came
 *   (the call failed) stays "thinking": the page shows the failure.
 * - A rate is "thinking" until its span ends "ok" with output. One that
 *   failed stays "thinking" with no items.
 */
export function circuitRows(recipe: Recipe, trace: Trace | undefined): CircuitRow[] {
  const rows: CircuitRow[] = [];
  if (!isRecord(trace) || !Array.isArray(trace.spans)) return rows;
  const seen = new Set<string>();
  for (const span of trace.spans as unknown[]) {
    if (!isRecord(span) || typeof span.path !== "string" || typeof span.nodeId !== "string") continue;
    if (seen.has(span.path)) continue;
    const node = findRecipeNode(recipe, span.nodeId);
    if (!node) continue;
    seen.add(span.path);
    switch (node.kind) {
      case "gate":
        rows.push(gateRow(node, span.path, span.decision));
        break;
      case "route":
        rows.push(routeRow(node, span.path, span.decision));
        break;
      case "rate":
        rows.push(rateRow(node, span.path, span));
        break;
    }
  }
  return rows;
}

/**
 * The shown answer comes from the edge taken, not the raw value: the bar is
 * inclusive, so a gate that passes on "no" at exactly 0.5 took "then" and
 * shows "No", at 50%.
 */
function gateRow(node: RecipeGate, path: string, decision: unknown): DecisionRow {
  const row: DecisionRow = { kind: "gate", path, question: node.question, status: "thinking" };
  if (!isRecord(decision) || (decision.taken !== "then" && decision.taken !== "otherwise")) return row;
  const passed = decision.taken === "then";
  const yes = passed === (node.pass === "yes");
  const done: DecisionRow = { ...row, status: "done", answer: yes ? "Yes" : "No", other: yes ? "No" : "Yes" };
  // A noul gate's value is the probability of yes.
  const noul = finite(decision.value);
  if (!Number.isNaN(noul)) done.pct = percent(yes ? noul : 1 - noul);
  return done;
}

/**
 * The winning label's description and probability. `other` is the likeliest
 * label not taken, the first in edge order on a tie, and is left out when
 * the decision has no readable edges.
 */
function routeRow(node: RecipeRoute, path: string, decision: unknown): DecisionRow {
  const row: DecisionRow = { kind: "route", path, question: node.question, status: "thinking" };
  if (!isRecord(decision) || typeof decision.taken !== "string") return row;
  const taken = decision.taken;
  const done: DecisionRow = { ...row, status: "done", answer: labelText(node.labels, taken) };

  const edges = (Array.isArray(decision.edges) ? decision.edges : []).filter(
    (e): e is { edge: string; value: unknown } => isRecord(e) && typeof e.edge === "string",
  );
  const own = edges.find((e) => e.edge === taken);
  const value = finite(own ? own.value : decision.value);
  if (!Number.isNaN(value)) done.pct = percent(value);

  let best: { edge: string; value: number } | undefined;
  for (const e of edges) {
    const v = finite(e.value);
    // Only the recipe's labels: jevchain's own edges (lowConfidence) aren't answers.
    if (e.edge === taken || Number.isNaN(v) || !Object.hasOwn(node.labels, e.edge)) continue;
    if (!best || v > best.value) best = { edge: e.edge, value: v };
  }
  if (best) done.other = labelText(node.labels, best.edge);
  return done;
}

function rateRow(node: RecipeRate, path: string, span: Record<string, unknown>): RateRow {
  const row: RateRow = { kind: "rate", path, status: "thinking", items: [] };
  if (span.status !== "ok" || span.output === undefined) return row;
  const answers = rateAnswers(span);
  const items: RateItem[] = [];
  for (const q of node.questions) {
    const a = Object.hasOwn(answers, q.key) ? answers[q.key] : undefined;
    const g = goodness(q, a as Answer);
    if (Number.isNaN(g)) continue;
    items.push({ question: q.question, answer: describeAnswer(q, a as Answer), goodness: g });
  }
  return { ...row, status: "done", items };
}

/** The span's output (the ask's answers), with its calls' answers over it. */
function rateAnswers(span: Record<string, unknown>): Record<string, unknown> {
  const answers: Record<string, unknown> = isRecord(span.output) ? { ...span.output } : {};
  for (const call of Array.isArray(span.calls) ? span.calls : []) {
    if (isRecord(call) && isRecord(call.answers)) Object.assign(answers, call.answers);
  }
  return answers;
}

/**
 * A short answer for a rated question.
 *
 * - Noul: the likelier side and its probability, "Yes, 70%" or "No, 70%".
 *   Exactly 0.5 reads "Yes, 50%".
 * - Score: the level text at the score rounded to the nearest level (1.5
 *   reads as level 2) and clamped to the levels.
 * - Choice: the chosen label's description and probability, "Sunny, 90%".
 *   With no `choice`, the likeliest label. An unknown label shows as itself.
 *
 * An answer that doesn't fit the question gives "".
 */
export function describeAnswer(q: RatedQuestion, a: Answer): string {
  if (!isRecord(a) || a.type !== q.kind) return "";
  switch (q.kind) {
    case "noul": {
      const p = finite((a as { noul?: unknown }).noul);
      if (Number.isNaN(p)) return "";
      return p >= 0.5 ? `Yes, ${percent(p)}%` : `No, ${percent(1 - p)}%`;
    }
    case "score": {
      const score = finite((a as { score?: unknown }).score);
      if (Number.isNaN(score) || q.levels.length === 0) return "";
      const level = Math.min(q.levels.length - 1, Math.max(0, Math.round(score)));
      return q.levels[level]!;
    }
    case "choice": {
      const probabilities = (a as { probabilities?: unknown }).probabilities;
      const probs = isRecord(probabilities) ? probabilities : {};
      const chosen = (a as { choice?: unknown }).choice;
      const label = typeof chosen === "string" ? chosen : likeliest(probs);
      if (label === undefined) return "";
      const text = labelText(q.labels, label);
      const p = Object.hasOwn(probs, label) ? finite(probs[label]) : NaN;
      return Number.isNaN(p) ? text : `${text}, ${percent(p)}%`;
    }
  }
}

function likeliest(probabilities: Record<string, unknown>): string | undefined {
  let best: { label: string; p: number } | undefined;
  for (const [label, raw] of Object.entries(probabilities)) {
    const p = finite(raw);
    if (!Number.isNaN(p) && (!best || p > best.p)) best = { label, p };
  }
  return best?.label;
}

/** A label's description, or the label itself when the recipe doesn't have it. */
function labelText(labels: Record<string, string>, label: string): string {
  return Object.hasOwn(labels, label) ? labels[label]! : label;
}

/** A 0-to-1 probability as a whole percentage, clamped to 0 to 100. */
function percent(p: number): number {
  return Math.round(Math.min(1, Math.max(0, p)) * 100);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `value` when it is a finite number, else NaN. */
function finite(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : NaN;
}
