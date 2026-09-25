/**
 * What if it went the other way? Re-run a finished trace with one decision
 * forced down a road it didn't take, and see where the chain ends up.
 *
 *   const jev = createJev(whatIfClient(inner, { root: chain, trace, fork: { path: "$", edge: "repair" } }));
 *   const b = await jev.run(chain, trace.input);   // b takes "repair" at $
 *
 * Nothing about the chain changes. A stand-in JevClient sits in front of the
 * real one (or the rehearsal one) and does three things:
 *
 * - **replays** every question the original run already asked, answer for
 *   answer, so everything before the fork is exactly what Jev said then (and
 *   costs nothing);
 * - **steers** the forked decision: it rewrites Jev's answer there just enough
 *   for the runtime's own rules to pick the forced edge (swap the winner of a
 *   route, move a gate's value across its bar, sink a cascade tier's
 *   confidence), and reports that call as model `"what-if"`;
 * - **forwards** anything new, i.e. the road that was never walked, to the
 *   inner client, so what happens after the fork is real judgement.
 *
 * The runtime, decisions and trace are all real; the one made-up answer is
 * labelled in `trace.models`, and `forksOf(trace)` finds it again, so a what-if
 * trace explains itself wherever it's shown (saved runs, share links).
 *
 * A what-if trace can be forked again: pass it as `trace`. Its own bent answer
 * is replayed like any other, so the earlier fork holds and the new one is
 * added on top (`forksOf` lists both), and a decision that only exists on the
 * new road can be forced too:
 *
 *   const c = await createJev(whatIfClient(inner, { root: chain, trace: b, fork: { path: "$/repair/0", edge: "otherwise" } })).run(chain, b.input);
 */
import {
  confidenceOf,
  spanAt,
  walk,
  type AnyNode,
  type Answer,
  type AskOptions,
  type AskResult,
  type CascadeNode,
  type Entry,
  type GateNode,
  type JevCall,
  type JevClient,
  type Question,
  type Questions,
  type RouteNode,
  type Trace,
} from "jevchain";

/** The model id reported by the one steered call. `isWhatIf` and `forkOf` key off it. */
export const WHAT_IF_MODEL = "what-if";

const DECISION = "decision";

/** Force the decision made at span `path` down edge `edge`. */
export interface Fork {
  path: string;
  edge: string;
}

export interface WhatIfOptions {
  /** The chain that produced `trace` (the same one you're about to re-run). */
  root: AnyNode;
  /** The finished run to replay from. */
  trace: Trace;
  fork: Fork;
}

/** True when this trace came from a what-if re-run. */
export function isWhatIf(trace: Pick<Trace, "models"> | undefined): boolean {
  return Boolean(trace?.models.includes(WHAT_IF_MODEL));
}

/** One decision a what-if forced: where, and which way. */
export interface ForcedDecision {
  path: string;
  nodeId: string;
  title?: string;
  edge: string;
}

/**
 * Every decision a what-if trace was forced at, in the order the run reached
 * them. A what-if of a what-if keeps its parent's forks (their bent answers
 * are replayed), so this is the whole chain of "what ifs" that got here,
 * minus any fork whose road no longer runs.
 */
export function forksOf(trace: Trace | undefined): ForcedDecision[] {
  if (!trace || !isWhatIf(trace)) return [];
  return trace.spans
    .filter((s) => s.decision && s.calls.some((c) => c.model === WHAT_IF_MODEL))
    .map((s) => ({ path: s.path, nodeId: s.nodeId, ...(s.title ? { title: s.title } : {}), edge: s.decision!.taken }));
}

/** An edge as people say it: the route's `lowConfidence` road is "unsure". */
export const edgeName = (edge: string) => (edge === "lowConfidence" ? "unsure" : edge);

/** "Front desk → paranormal". */
export const forkLabel = (f: ForcedDecision) => `${f.title ?? f.nodeId} → ${edgeName(f.edge)}`;

/** The first decision a what-if trace was forced at. See `forksOf` for all of them. */
export function forkOf(trace: Trace | undefined): ForcedDecision | undefined {
  return forksOf(trace)[0];
}

/**
 * The edges a what-if can force at `path`: every edge the decision there
 * didn't take, minus any the node's own rules make unreachable (a gate whose
 * bar can't be failed, a cascade tier after one that can't be refused).
 */
export function forkableEdges(root: AnyNode, trace: Trace | undefined, path: string): string[] {
  if (!trace || trace.status === "running") return [];
  const span = spanAt(trace, path);
  const node = nodeAt(root, path);
  if (!span?.decision || !node || node.kind !== span.decision.kind) return [];
  const candidates = span.decision.edges.map((e) => e.edge);
  if (node.kind === "gate" && !(node as GateNode).otherwise) candidates.push("halt");
  return candidates.filter((edge) => edge !== span.decision!.taken && planFork(node, span.calls, edge) !== undefined);
}

/** A JevClient that replays `trace`, forces `fork`, and forwards everything else to `inner`. */
export function whatIfClient(inner: JevClient, { root, trace, fork }: WhatIfOptions): JevClient {
  const span = spanAt(trace, fork.path);
  const node = nodeAt(root, fork.path);
  if (!span?.decision || !node) throw new Error(`nothing was decided at ${fork.path}`);
  const plan = planFork(node, span.calls, fork.edge);
  if (!plan) throw new Error(`${span.title ?? span.nodeId} can't be forced to "${fork.edge}"`);

  // Every call the original run made, queued per (state, questions).
  const recorded = new Map<string, JevCall[]>();
  for (const s of trace.spans) {
    for (const c of s.calls) {
      const k = keyOf(c.state, c.questions);
      recorded.set(k, [...(recorded.get(k) ?? []), c]);
    }
  }
  const steers = [...plan];

  return {
    model: inner.model,
    usdPerMillionTokens: inner.usdPerMillionTokens,
    async ask<const Q extends Questions>(state: Entry, questions: Q, options: AskOptions = {}): Promise<AskResult<Q>> {
      if (options.signal?.aborted) throw options.signal.reason;
      const k = keyOf(state, questions);
      const qk = JSON.stringify(questions);
      const s = steers.findIndex((x) => x.questions === qk && (x.state === undefined || x.state === JSON.stringify(state)));
      const replay = recorded.get(k)?.shift();
      if (s >= 0) {
        const steer = steers.splice(s, 1)[0]!;
        const base = replay ? fromCall<Q>(replay) : await inner.ask(state, questions, options);
        const answers = { ...base.answers, [DECISION]: steer.rewrite(base.answers[DECISION] as Answer) };
        const source = sourceModel(base);
        return { ...base, answers: answers as AskResult<Q>["answers"], model: WHAT_IF_MODEL, requestId: source ? `${WHAT_IF_MODEL}:${source}` : WHAT_IF_MODEL };
      }
      if (replay) return fromCall<Q>(replay);
      return inner.ask(state, questions, options);
    },
  };
}

// ---------------------------------------------------------------------------
// Steering: the smallest rewrite of Jev's answer that makes the runtime pick
// the forced edge. Each rewrite mirrors the runtime's own decision rule, and
// the tests run the real runtime to prove the edge is taken.
// ---------------------------------------------------------------------------

interface Steer {
  /** JSON of the questions this call asks. */
  questions: string;
  /** JSON of the state, when the original run recorded it. */
  state?: string;
  rewrite: (answer: Answer) => Answer;
}

/** How to force `edge` at this node, or undefined if its rules make that impossible. */
function planFork(node: AnyNode, calls: readonly JevCall[], edge: string): Steer[] | undefined {
  switch (node.kind) {
    case "route":
      return planRoute(node as RouteNode, calls, edge);
    case "gate":
      return planGate(node as GateNode, calls, edge);
    case "cascade":
      return planCascade(node as CascadeNode, calls, edge);
    default:
      return undefined;
  }
}

function planRoute(node: RouteNode, calls: readonly JevCall[], edge: string): Steer[] | undefined {
  const call = calls[0];
  if (!call) return undefined;
  const below = node.lowConfidence?.below;
  let rewrite: (a: Answer) => Answer;
  if (edge === "lowConfidence") {
    if (below === undefined || below <= 0) return undefined;
    rewrite = (a) => (a.type === "choice" ? { ...a, confidence: Math.min(a.confidence, round(below - 0.01)) } : a);
  } else {
    if (!(edge in node.branches)) return undefined;
    // Swap the forced label's probability with the winner's: same distribution, new winner.
    rewrite = (a) => {
      if (a.type !== "choice") return a;
      const probabilities = { ...a.probabilities, [edge]: a.probabilities[a.choice] ?? 1, [a.choice]: a.probabilities[edge] ?? 0 };
      if (edge === a.choice) probabilities[edge] = a.probabilities[edge] ?? 1;
      return { ...a, choice: edge, probabilities, confidence: below !== undefined ? Math.max(a.confidence, below) : a.confidence };
    };
  }
  return [{ questions: JSON.stringify(call.questions), state: JSON.stringify(call.state), rewrite }];
}

function planGate(node: GateNode, calls: readonly JevCall[], edge: string): Steer[] | undefined {
  const call = calls[0];
  const original = call?.answers[DECISION];
  if (!call || !original) return undefined;
  const forced = steerGate(node, original, edge);
  if (!forced) return undefined;
  return [{ questions: JSON.stringify(call.questions), state: JSON.stringify(call.state), rewrite: () => forced }];
}

/** The gate's edge for an answer: the runtime's rule, restated. */
export function gateEdge(node: GateNode, answer: Answer): string {
  const value = gateValue(answer, node.pass.label);
  const { min, max } = node.pass;
  const passed = (min === undefined || value >= min) && (max === undefined || value <= max);
  let unsure = false;
  if (node.unsure) {
    const bar = min ?? max;
    const nearBar = node.unsure.margin !== undefined && bar !== undefined && Math.abs(value - bar) < node.unsure.margin;
    const lowConf = node.unsure.minConfidence !== undefined && confidenceOf(answer) < node.unsure.minConfidence;
    unsure = nearBar || lowConf;
  }
  return unsure ? "unsure" : passed ? "then" : node.otherwise ? "otherwise" : "halt";
}

/** Move the gate's value (closest to where Jev put it first) until the gate takes `edge`. */
function steerGate(node: GateNode, answer: Answer, edge: string): Answer | undefined {
  const [lo, hi] = domain(node.ask);
  const v0 = gateValue(answer, node.pass.label);
  const { min, max } = node.pass;
  const margin = node.unsure?.margin ?? 0;
  const bars = [min, max].filter((b): b is number => b !== undefined);
  const values = new Set<number>([v0, lo, hi]);
  for (const b of bars) {
    values.add(2 * b - v0);
    for (const d of [0, 0.01, margin, margin + 0.01, -0.01, -margin, -margin - 0.01]) values.add(b + d);
  }
  if (min !== undefined && max !== undefined) values.add((min + max) / 2);
  const ordered = [...values].map((v) => round(Math.min(hi, Math.max(lo, v)))).sort((a, b) => Math.abs(a - v0) - Math.abs(b - v0));

  const minConf = node.unsure?.minConfidence;
  // Unsure is also reachable by doubt alone; everything else needs Jev at least that sure.
  const confidences = edge === "unsure" && minConf !== undefined && minConf > 0 ? [undefined, round(minConf - 0.01)] : [minConf];
  for (const c of confidences) {
    for (const v of ordered) {
      const next = withConfidence(withGateValue(answer, node.pass.label, v), c, edge === "unsure");
      if (gateEdge(node, next) === edge) return next;
    }
  }
  return undefined;
}

function planCascade(node: CascadeNode, calls: readonly JevCall[], edge: string): Steer[] | undefined {
  const target = edge === "fallback" ? node.tiers.length : node.tiers.findIndex((t) => t.id === edge);
  if (target < 0) return undefined;
  const steers: Steer[] = [];
  for (const [i, tier] of node.tiers.entries()) {
    if (i > target) break;
    const accept = i === target;
    if (!accept && tier.minConfidence <= 0) return undefined; // can't be refused
    if (accept && tier.minConfidence > 1) return undefined;
    const call = calls.find((c) => c.tier === tier.id);
    const bar = accept ? tier.minConfidence : round(tier.minConfidence - 0.01);
    steers.push({
      questions: JSON.stringify({ [DECISION]: tier.ask }),
      ...(call ? { state: JSON.stringify(call.state) } : {}),
      rewrite: (a) => {
        const c = confidenceOf(a);
        return accept ? (c >= bar ? a : setConfidence(a, bar)) : c < tier.minConfidence ? a : setConfidence(a, bar);
      },
    });
  }
  return steers;
}

// ---------------------------------------------------------------------------
// answer surgery
// ---------------------------------------------------------------------------

function gateValue(answer: Answer, label?: string): number {
  switch (answer.type) {
    case "noul":
      return answer.noul;
    case "score":
      return answer.score;
    case "choice":
      return label ? (answer.probabilities[label] ?? 0) : answer.confidence;
  }
}

function withGateValue(answer: Answer, label: string | undefined, v: number): Answer {
  switch (answer.type) {
    case "noul":
      return { ...answer, noul: v };
    case "score":
      return { ...answer, score: v };
    case "choice": {
      if (!label) return { ...answer, confidence: v };
      // Put `v` on the label and share the rest out in the old proportions.
      const rest = Object.entries(answer.probabilities).filter(([l]) => l !== label);
      const restSum = rest.reduce((s, [, p]) => s + p, 0);
      const probabilities: Record<string, number> = { [label]: v };
      for (const [l, p] of rest) probabilities[l] = round(restSum > 0 ? (p / restSum) * (1 - v) : (1 - v) / rest.length);
      const choice = Object.entries(probabilities).reduce((a, b) => (b[1] > a[1] ? b : a))[0];
      return { ...answer, probabilities, choice };
    }
  }
}

/** Nudge confidence toward `c` (at least `c`, or below it when `doubt`) where the answer type allows it. */
function withConfidence(answer: Answer, c: number | undefined, doubt: boolean): Answer {
  if (c === undefined || answer.type === "noul") return answer;
  const now = answer.confidence;
  if (doubt ? now < c : now >= c) return answer;
  return { ...answer, confidence: c };
}

function setConfidence(answer: Answer, c: number): Answer {
  if (answer.type !== "noul") return { ...answer, confidence: c };
  const side = answer.noul >= 0.5 ? 1 : -1;
  let noul = round(0.5 + (side * c) / 2);
  // |noul − 0.5| × 2 can land a hair under c in floating point (0.7 → 0.3999…); nudge outward.
  if (Math.abs(noul - 0.5) * 2 < c) noul = round(noul + side * 0.001);
  return { ...answer, noul };
}

function domain(q: Question): [number, number] {
  return q.type === "score" ? [0, q.criteria.length - 1] : [0, 1];
}

// ---------------------------------------------------------------------------

function nodeAt(root: AnyNode, path: string): AnyNode | undefined {
  let found: AnyNode | undefined;
  walk(root, (n, info) => {
    if (!found && info.path === path) found = n;
  });
  return found;
}

function keyOf(state: Entry, questions: Questions): string {
  return JSON.stringify([state, questions]);
}

/** A recorded call, served again: Jev's answers, nothing spent. */
function fromCall<Q extends Questions>(call: JevCall): AskResult<Q> {
  return {
    answers: call.answers as AskResult<Q>["answers"],
    model: call.model,
    usage: { inputTokens: call.inputTokens, outputTokens: call.outputTokens },
    costUsd: 0,
    latencyMs: 0,
    attempts: 1,
    requestId: replayId(call.requestId ?? call.id),
  };
}

const replayId = (id: string) => (id.startsWith("replay:") ? id : `replay:${id}`);

/**
 * Who really answered the call that got bent: the model the steered call
 * reports is always `"what-if"`, so its requestId carries the original
 * (`what-if:rehearsal`, `what-if:jev-…`). That's how a rehearsal stays a
 * rehearsal after its only call was forced, however many forks deep.
 */
function sourceModel(result: Pick<AskResult<Questions>, "model" | "requestId">): string | undefined {
  if (result.model !== WHAT_IF_MODEL) return result.model;
  const id = result.requestId ?? "";
  const at = id.lastIndexOf(`${WHAT_IF_MODEL}:`);
  return at >= 0 ? id.slice(at + WHAT_IF_MODEL.length + 1) || undefined : undefined;
}

const round = (v: number) => Math.round(v * 1000) / 1000;
