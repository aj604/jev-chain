/**
 * How close was the call? For one decision in a trace: every other road it
 * could have taken, and how far Jev's deciding number would have had to move
 * for the runtime's own rule to take it.
 *
 *   const [closest] = flipsOf(chain, span);
 *   // { edge: "unsure", by: 0.03, measure: "confidence", from: 0.43, to: 0.4 }
 *   flipText(closest)  // "0.03 less confidence and it goes “unsure”"
 *
 * A decision's recorded numbers alone can't say this: a route that didn't go
 * unsure doesn't record the confidence bar it cleared, and a gate doesn't
 * record its unsure band. So this reads the rule off the chain node, the same
 * way a what-if does (`lib/trace/what-if`), and measures one number at a time:
 *
 * - **route**: a label road is as close as the winner's lead over it (the
 *   runtime takes Jev's choice, so the lead is what would have to go); the
 *   unsure road is confidence minus the `lowConfidence` bar; from unsure,
 *   confidence up to the bar, and it goes where Jev leaned.
 * - **gate**: the measured value (p(yes), score, p(label) or confidence)
 *   slid toward each edge of every band the gate draws (its min / max, the
 *   unsure margin, and for a yes/no, where its confidence crosses the unsure
 *   minimum); plus confidence alone for the unsure minimum on other answers.
 * - **cascade**: a tier that answered is as close as its confidence over its
 *   bar (any less and the next tier gets asked: where that goes is unknown,
 *   so the flip says `escalates`); a tier that refused, its bar minus its
 *   confidence.
 *
 * A flip is only listed when its number can get there: confidence stays in
 * 0–1 and a gate's value in its question's range, so a bar of 0 (a catch-all
 * tier, say) is never "escalated" past.
 *
 * `by` is the distance to the boundary. The rules mix ≥, ≤ and < (a route
 * goes unsure *below* its bar, a gate passes *at* its min), so the call flips
 * at exactly `by` or a hair past it; either way nothing closer flips it.
 */
import { confidenceOf, type AnyNode, type Answer, type CascadeNode, type GateNode, type RouteNode, type Span } from "jevchain";
import { fmtNum } from "./format";
import { domain, edgeName, gateEdge, gateValue, nodeAt, WHAT_IF_MODEL, withGateValue } from "./what-if";

const DECISION = "decision";

export interface Flip {
  /** The road it would have taken (a cascade escalation: the tier it would ask next, or "fallback"). */
  edge: string;
  /** How far `measure` had to move to get there. Never negative. */
  by: number;
  /** What would have had to move: "confidence", "p(yes)", "score", "p(repair)", "confidence at gut-check", or "lead" (a route winner's lead over `edge`). */
  measure: string;
  /** `measure` as it was, and where the call flips. */
  from: number;
  to: number;
  /** Which way `measure` had to move (at a distance of 0, `from` and `to` can't say). */
  up: boolean;
  /** A cascade tier that answered would have passed the question on: `edge` is who'd be asked, not where it ends up. */
  escalates?: boolean;
}

/**
 * Every road the decision at `span` didn't take that one number moving could
 * reach, nearest first. Empty when the span decided nothing, the chain has no
 * such node, or the decision was forced by a what-if (its numbers were bent
 * to sit just past the line, so "how close" says nothing about Jev).
 */
export function flipsOf(root: AnyNode, span: Span | undefined): Flip[] {
  const decision = span?.decision;
  if (!span || !decision) return [];
  if (span.calls.some((c) => c.model === WHAT_IF_MODEL)) return [];
  const node = nodeAt(root, span.path);
  if (!node || node.kind !== decision.kind) return [];
  const flips =
    node.kind === "route"
      ? routeFlips(node as RouteNode, span, decision.taken)
      : node.kind === "gate"
        ? gateFlips(node as GateNode, span, decision.taken)
        : node.kind === "cascade"
          ? cascadeFlips(node as CascadeNode, span, decision.taken)
          : [];
  return nearestPerEdge(flips);
}

/** The nearest road not taken, or undefined when there's none to measure. */
export function closestFlip(root: AnyNode, span: Span | undefined): Flip | undefined {
  return flipsOf(root, span)[0];
}

/** A distance, honest at the small end: 0 → "0", 0.004 → "<0.01", 0.05 → "0.05". */
export function fmtBy(by: number): string {
  if (by === 0) return "0";
  if (by < 0.005) return "<0.01";
  return fmtNum(by);
}

/** The flip as a sentence: "0.03 less confidence and it goes “unsure”". */
export function flipText(flip: Flip, taken?: string): string {
  const road = `“${edgeName(flip.edge)}”`;
  if (flip.measure === "lead") return `${taken ? `“${edgeName(taken)}”` : "it"} led ${road} by ${fmtBy(flip.by)}`;
  const way = flip.up ? "more" : "less";
  const moved = flip.by === 0 ? `any ${way} ${flip.measure}` : `${fmtBy(flip.by)} ${way} ${flip.measure}`;
  if (flip.escalates) return flip.edge === "fallback" ? `${moved} and it falls back` : `${moved} and it asks ${road} instead`;
  return `${moved} and it goes ${road}`;
}

// ── per kind ─────────────────────────────────────────────────────────────────

function decisionAnswer(span: Span, tier?: string): Answer | undefined {
  const call = tier === undefined ? span.calls[0] : span.calls.find((c) => c.tier === tier);
  return call?.answers[DECISION];
}

function routeFlips(node: RouteNode, span: Span, taken: string): Flip[] {
  const a = decisionAnswer(span);
  if (a?.type !== "choice") return [];
  const below = node.lowConfidence?.below;
  if (taken === "lowConfidence") {
    // Confident enough and it goes where Jev leaned.
    if (below === undefined || below > 1 || !(a.choice in node.branches)) return [];
    return [{ edge: a.choice, by: clamp0(below - a.confidence), measure: "confidence", from: a.confidence, to: below, up: true }];
  }
  const lead = a.probabilities[taken] ?? 0;
  const flips: Flip[] = Object.keys(node.branches)
    .filter((label) => label !== taken)
    .map((label) => {
      const gap = clamp0(lead - (a.probabilities[label] ?? 0));
      return { edge: label, by: gap, measure: "lead", from: gap, to: 0, up: false };
    });
  if (below !== undefined && below > 0) flips.push({ edge: "lowConfidence", by: clamp0(a.confidence - below), measure: "confidence", from: a.confidence, to: below, up: false });
  return flips;
}

function gateFlips(node: GateNode, span: Span, taken: string): Flip[] {
  const a = decisionAnswer(span);
  if (!a) return [];
  const label = node.pass.label;
  const measure = a.type === "noul" ? "p(yes)" : a.type === "score" ? "score" : label ? `p(${label})` : "confidence";
  const [lo, hi] = domain(node.ask);
  const v = gateValue(a, label);
  const { min, max } = node.pass;
  const bar = min ?? max;
  const margin = node.unsure?.margin;
  const minConf = node.unsure?.minConfidence;
  // Every place the gate's edge can change as the value slides.
  const cuts = new Set<number>();
  for (const b of [min, max]) if (b !== undefined) cuts.add(b);
  if (bar !== undefined && margin !== undefined) {
    cuts.add(bar - margin);
    cuts.add(bar + margin);
  }
  // A yes/no's confidence is its distance from 0.5, so the unsure minimum is two more cuts.
  if (a.type === "noul" && minConf !== undefined) {
    cuts.add(0.5 - minConf / 2);
    cuts.add(0.5 + minConf / 2);
  }
  const edgeAt = (x: number) => gateEdge(node, withGateValue(a, label, x));
  const flips: Flip[] = [];
  const EPS = 1e-9;
  for (const t of cuts) {
    if (t < lo || t > hi) continue;
    // Jev's number on the cut (give or take float error, e.g. 0.5 − 0.8 / 2 = 0.09999…): either side may flip.
    const onLine = Math.abs(t - v) < EPS;
    for (const x of onLine ? [t, t + EPS, t - EPS] : [t, t + Math.sign(t - v) * EPS]) {
      if (x < lo || x > hi) continue;
      const edge = edgeAt(x);
      if (edge !== taken) flips.push({ edge, by: Math.abs(t - v), measure, from: v, to: t, up: x > v });
    }
  }
  // Doubt alone sends a choice or score to unsure; confidence up can bring it back.
  // Only where confidence can get to: down below a minimum of 0 or up past one over 1 it can't.
  if (a.type !== "noul" && minConf !== undefined && (a.confidence < minConf ? minConf <= 1 : minConf > 0)) {
    const c = a.confidence;
    const edge = gateEdge(node, { ...a, confidence: c < minConf ? minConf : Math.min(c, minConf - EPS) });
    if (edge !== taken) flips.push({ edge, by: Math.abs(c - minConf), measure: "confidence", from: c, to: minConf, up: c < minConf });
  }
  return flips;
}

function cascadeFlips(node: CascadeNode, span: Span, taken: string): Flip[] {
  const flips: Flip[] = [];
  for (const [i, tier] of node.tiers.entries()) {
    const a = decisionAnswer(span, tier.id);
    if (!a) break; // never asked: everything from here on is a guess
    const c = confidenceOf(a);
    const measure = `confidence at ${tier.title ?? tier.id}`;
    if (tier.id === taken) {
      const next = node.tiers[i + 1]?.id ?? "fallback";
      // A bar of 0 can't be refused: confidence never goes below it.
      if (tier.minConfidence > 0) flips.push({ edge: next, by: clamp0(c - tier.minConfidence), measure, from: c, to: tier.minConfidence, up: false, escalates: true });
      break;
    }
    if (tier.minConfidence <= 1) flips.push({ edge: tier.id, by: clamp0(tier.minConfidence - c), measure, from: c, to: tier.minConfidence, up: true });
  }
  return flips;
}

// ─────────────────────────────────────────────────────────────────────────────

function nearestPerEdge(flips: Flip[]): Flip[] {
  const best = new Map<string, Flip>();
  for (const f of flips) {
    const by = round(f.by);
    const cur = best.get(f.edge);
    if (!cur || by < cur.by) best.set(f.edge, { ...f, by, from: round(f.from), to: round(f.to) });
  }
  return [...best.values()].sort((x, y) => x.by - y.by);
}

const clamp0 = (v: number) => Math.max(0, v);
const round = (v: number) => Math.round(v * 1e6) / 1e6;
