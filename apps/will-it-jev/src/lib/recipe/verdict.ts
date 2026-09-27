import type { Answer, Trace } from "jevchain";
import { TIERS, type Tier } from "../tiers";
import { findRecipeNode } from "./tree";
import type { RatedQuestion, Recipe, RecipeNode, RecipeRate } from "./types";

/**
 * Verdicts are worked out after the run, from the recipe and the trace. The
 * chain itself only asks Jev and emits. Everything here reads untrusted
 * input (a decoded share link rebuilds the result from a trace), so a bad
 * run gives null or zeros and never throws.
 */

/** Numbers read off the trace for the verdict card. */
export interface TraceStats {
  /** Questions Jev answered, over every call: one per gate, route and rated question. */
  gates: number;
  /** Decisions (gates and routes) on the path taken. */
  depth: number;
  /** The chain run's wall-clock time, rounded. Decomposition and reveal pacing aren't in it. */
  latencyMs: number;
  requests: number;
}

export interface Verdict extends TraceStats {
  tier: Tier;
  line: string;
  /** The rate leaf's weighted score, or null for a verdict leaf. */
  score: number | null;
}

/** At or above each bar, best first. Anything under the last is `nope`. */
const BARS: readonly [Tier, number][] = [
  ["jevs", 0.66],
  ["kinda", 0.4],
];

/**
 * How far one answer goes in the thing's favour, from 0 to 1.
 *
 * - Noul: the probability of the good answer.
 * - Choice: the summed probability of the good labels.
 * - Score: the answered level placed evenly on 0 to 1, flipped when low is
 *   good. Jev's score is probability-weighted, so it can sit between levels.
 *
 * NaN when `a` is not an answer to `q` (another type, or no usable number).
 * `scoreRate` treats that as no answer.
 */
export function goodness(q: RatedQuestion, a: Answer): number {
  if (!isRecord(a) || a.type !== q.kind) return NaN;
  switch (q.kind) {
    case "noul": {
      const p = finite((a as { noul?: unknown }).noul);
      return clamp(q.good ? p : 1 - p);
    }
    case "choice": {
      const probabilities = (a as { probabilities?: unknown }).probabilities;
      if (!isRecord(probabilities)) return NaN;
      let sum = 0;
      // An inherited key like "constructor" isn't a finite number, so it adds nothing.
      for (const label of new Set(q.good)) sum += finite(probabilities[label], 0);
      return clamp(sum);
    }
    case "score": {
      const top = q.levels.length - 1;
      if (top < 1) return NaN;
      const level = finite((a as { score?: unknown }).score) / top;
      return clamp(q.good === "high" ? level : 1 - level);
    }
  }
}

/**
 * The weighted mean of each answered question's goodness, rounded to two
 * places. Unanswered questions, and answers that don't fit their question,
 * are left out. With no weight left, the score is 0.
 */
export function scoreRate(rate: RecipeRate, answers: Record<string, Answer>): number {
  let total = 0;
  let weights = 0;
  for (const q of rate.questions) {
    // A missing or inherited answer fails `goodness`'s type check, so it's left out too.
    const g = isRecord(answers) ? goodness(q, answers[q.key]) : NaN;
    if (Number.isNaN(g)) continue;
    total += q.weight * g;
    weights += q.weight;
  }
  if (!(weights > 0)) return 0;
  return Math.round((total / weights) * 100) / 100;
}

/** 0.66 and up jevs, 0.4 and up kinda, anything lower nope. */
export function tierOf(score: number): Tier {
  for (const [tier, bar] of BARS) if (score >= bar) return tier;
  return "nope";
}

/**
 * Stats for the verdict card. Missing or malformed fields count as zero, so
 * a decoded trace never throws here.
 */
export function traceStats(trace: Trace): TraceStats {
  const spans = spansOf(trace);
  let gates = 0;
  let depth = 0;
  for (const span of spans) {
    if (span.decision != null) depth++;
    const calls = Array.isArray(span.calls) ? span.calls : [];
    for (const call of calls) {
      if (isRecord(call) && isRecord(call.answers)) gates += Object.keys(call.answers).length;
    }
  }
  const t: Record<string, unknown> = isRecord(trace) ? trace : {};
  const usage: Record<string, unknown> = isRecord(t.usage) ? t.usage : {};
  return {
    gates,
    depth,
    latencyMs: Math.max(0, Math.round(finite(t.durationMs, 0))),
    requests: Math.max(0, finite(usage.requests, 0)),
  };
}

/**
 * The verdict for one run of `recipe`, or null when there isn't one.
 *
 * An emitted `{ tier, line }` that is one of the recipe's verdict leaves
 * gives that tier and line, with a null score. Otherwise the last ask span
 * must be one of the recipe's rate leaves. Its answers are scored and the
 * tier's line comes from the leaf.
 *
 * Null when the run did not finish `"ok"`, or its output and last ask match
 * nothing in the recipe. Works on a result rebuilt from a decoded trace:
 * `{ status: trace.status, output: trace.output, trace }`.
 */
export function verdictOf(
  recipe: Recipe,
  result: { status: string; output?: unknown; trace: Trace },
): Verdict | null {
  if (!isRecord(result) || result.status !== "ok") return null;
  const trace = result.trace;

  const leaf = verdictLeaf(recipe, result.output);
  if (leaf) return { tier: leaf.tier, line: leaf.line, score: null, ...traceStats(trace) };

  const rated = lastRate(recipe, trace);
  if (!rated) return null;
  const score = scoreRate(rated.rate, rated.answers);
  const tier = tierOf(score);
  return { tier, line: rated.rate.verdicts[tier], score, ...traceStats(trace) };
}

/** The recipe's verdict leaf with exactly this tier and line, if `output` is one. */
function verdictLeaf(recipe: Recipe, output: unknown): { tier: Tier; line: string } | undefined {
  if (!isRecord(output)) return undefined;
  const { tier, line } = output;
  if (typeof line !== "string" || !(TIERS as readonly unknown[]).includes(tier)) return undefined;
  const has = (node: RecipeNode): boolean => {
    switch (node.kind) {
      case "verdict":
        return node.tier === tier && node.line === line;
      case "rate":
        return false;
      case "gate":
        return has(node.then) || has(node.otherwise);
      case "route":
        return Object.values(node.branches).some(has);
    }
  };
  return has(recipe.root) ? { tier: tier as Tier, line } : undefined;
}

/** The rate leaf the last ask span ran, with its answers merged over its calls. */
function lastRate(recipe: Recipe, trace: Trace): { rate: RecipeRate; answers: Record<string, Answer> } | undefined {
  const span = spansOf(trace)
    .filter((s) => s.kind === "ask")
    .pop();
  if (!span || typeof span.nodeId !== "string") return undefined;
  const node = findRecipeNode(recipe, span.nodeId);
  if (node?.kind !== "rate") return undefined;
  const answers: Record<string, Answer> = {};
  for (const call of Array.isArray(span.calls) ? span.calls : []) {
    if (isRecord(call) && isRecord(call.answers)) Object.assign(answers, call.answers);
  }
  return { rate: node, answers };
}

/** The trace's spans that are at least objects. */
function spansOf(trace: unknown): Partial<Trace["spans"][number]>[] {
  if (!isRecord(trace) || !Array.isArray(trace.spans)) return [];
  return trace.spans.filter(isRecord);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** `value` when it is a finite number, else `fallback` (NaN by default). */
function finite(value: unknown, fallback = NaN): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/** Into 0 to 1. NaN stays NaN. */
function clamp(n: number): number {
  return Number.isNaN(n) ? n : Math.min(1, Math.max(0, n));
}
