/**
 * Traces: the complete, serializable record of a run.
 *
 * A trace is plain JSON. Save it, diff it, render it, post it in the group
 * chat. Live runs emit `TraceEvent`s; `reduceTrace` folds any prefix of those
 * events into a partial `Trace`, which is how a UI animates a run as it
 * happens and still ends up with the exact same object the runtime returns.
 */
import type { SerializedError } from "./errors";
import type { NodeKind } from "./nodes";
import type { Answer, Entry, Json, Questions } from "./questions";

export const TRACE_VERSION = 1;

export type RunStatus = "running" | "ok" | "halted" | "error" | "aborted";
export type SpanStatus = "running" | "ok" | "halted" | "error";

/** One HTTP call to Jev, as seen from one node. */
export interface JevCall {
  id: string;
  model: string;
  state: Entry;
  questions: Questions;
  answers: Record<string, Answer>;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  /** Offset from run start, ms. */
  start: number;
  end: number;
  latencyMs: number;
  attempts: number;
  requestId?: string;
  /** Set when this call shared a merged request with other nodes. */
  batch?: { id: string; size: number; questions: number };
  /** For cascade tiers: which tier made this call. */
  tier?: string;
}

/** How one outgoing edge scored in a decision. */
export interface EdgeScore {
  /** The edge key: a route label, "then", "otherwise", "unsure", a tier id, "fallback". */
  edge: string;
  /** The number that decided it (probability, noul, score or confidence). */
  value: number | null;
  taken: boolean;
}

export type Metric = "probability" | "noul" | "score" | "confidence";

export interface Decision {
  kind: "route" | "gate" | "cascade";
  /** The question key the decision was made on. */
  question: string;
  /** Edge that was taken. */
  taken: string;
  /** Every candidate edge, taken or not, with its deciding number. */
  edges: EdgeScore[];
  metric: Metric;
  /** The deciding value for the taken edge. */
  value: number;
  /** The bar it was measured against, if any. */
  threshold?: { min?: number; max?: number; label?: string };
  confidence?: number;
  /** Why this edge, in one templated sentence. See `explainDecision`. */
  summary: string;
  /** True when a low-confidence fallback overrode the obvious answer. */
  fallback?: boolean;
}

export interface SpanLog {
  at: number;
  message: string;
  data?: Json;
}

export interface Span {
  /** Unique within the run: the node's path, e.g. `$/triage/bug`. */
  path: string;
  parentPath: string | null;
  /** The edge from the parent that led here. */
  edge: string | null;
  nodeId: string;
  kind: NodeKind | "tier";
  title?: string;
  status: SpanStatus;
  start: number;
  end?: number;
  input?: Json;
  output?: Json;
  calls: JevCall[];
  decision?: Decision;
  retries: RetryRecord[];
  logs: SpanLog[];
  error?: SerializedError;
}

export interface RetryRecord {
  at: number;
  attempt: number;
  delayMs: number;
  error: SerializedError;
  /** The call being retried, or "step" for step code. */
  source: "jev" | "step";
}

export interface TraceUsage {
  calls: number;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
}

export interface Trace {
  version: typeof TRACE_VERSION;
  runId: string;
  chainId: string;
  status: RunStatus;
  /** Wall-clock ISO timestamp of the start. All other times are ms offsets from it. */
  startedAt: string;
  durationMs?: number;
  input: Json;
  output?: Json;
  /** Spans in start order. */
  spans: Span[];
  usage: TraceUsage;
  models: string[];
  error?: SerializedError;
  halted?: { path: string; nodeId: string; summary: string };
}

export type TraceEvent =
  | { type: "run:start"; runId: string; chainId: string; startedAt: string; input: Json }
  | { type: "span:start"; at: number; span: Pick<Span, "path" | "parentPath" | "edge" | "nodeId" | "kind" | "title" | "input"> }
  | { type: "jev:call"; path: string; call: JevCall }
  | { type: "retry"; path: string; retry: RetryRecord }
  | { type: "log"; path: string; log: SpanLog }
  | { type: "decision"; path: string; decision: Decision }
  | { type: "span:end"; at: number; path: string; status: SpanStatus; output?: Json; error?: SerializedError }
  | { type: "run:end"; trace: Trace };

export function emptyUsage(): TraceUsage {
  return { calls: 0, requests: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 };
}

/**
 * Fold one event into a trace. Pure: returns a new trace, safe for React state.
 * Pass `undefined` to start; the first event must be `run:start`.
 */
export function reduceTrace(trace: Trace | undefined, event: TraceEvent): Trace {
  if (event.type === "run:start") {
    return {
      version: TRACE_VERSION,
      runId: event.runId,
      chainId: event.chainId,
      status: "running",
      startedAt: event.startedAt,
      input: event.input,
      spans: [],
      usage: emptyUsage(),
      models: [],
    };
  }
  if (event.type === "run:end") return event.trace;
  if (!trace) throw new Error(`reduceTrace: got "${event.type}" before "run:start"`);

  const patch = (path: string, fn: (s: Span) => Span): Trace => ({
    ...trace,
    spans: trace.spans.map((s) => (s.path === path ? fn(s) : s)),
  });

  switch (event.type) {
    case "span:start":
      return { ...trace, spans: [...trace.spans, { ...event.span, status: "running", start: event.at, calls: [], retries: [], logs: [] }] };
    case "jev:call": {
      const next = patch(event.path, (s) => ({ ...s, calls: [...s.calls, event.call] }));
      return { ...next, usage: addCall(next.usage, event.call, trace.spans), models: addModel(next.models, event.call.model) };
    }
    case "retry":
      return patch(event.path, (s) => ({ ...s, retries: [...s.retries, event.retry] }));
    case "log":
      return patch(event.path, (s) => ({ ...s, logs: [...s.logs, event.log] }));
    case "decision":
      return patch(event.path, (s) => ({ ...s, decision: event.decision }));
    case "span:end":
      return patch(event.path, (s) => {
        const out: Span = { ...s, status: event.status, end: event.at };
        if (event.output !== undefined) out.output = event.output;
        if (event.error) out.error = event.error;
        return out;
      });
  }
}

/** Collect a whole event list into a trace. */
export function traceFromEvents(events: Iterable<TraceEvent>): Trace | undefined {
  let t: Trace | undefined;
  for (const e of events) t = reduceTrace(t, e);
  return t;
}

function addCall(usage: TraceUsage, call: JevCall, spans: Span[]): TraceUsage {
  // A merged request is one HTTP request no matter how many nodes rode along.
  const seenBatch = call.batch && spans.some((s) => s.calls.some((c) => c.batch?.id === call.batch!.id));
  return {
    calls: usage.calls + 1,
    requests: usage.requests + (seenBatch ? 0 : 1),
    inputTokens: usage.inputTokens + call.inputTokens,
    outputTokens: usage.outputTokens + call.outputTokens,
    costUsd: usage.costUsd + call.costUsd,
  };
}

function addModel(models: string[], model: string): string[] {
  return models.includes(model) ? models : [...models, model];
}

// ---------------------------------------------------------------------------
// Queries over traces (used by UIs and tests)
// ---------------------------------------------------------------------------

/** Paths of spans that ran. */
export function visitedPaths(trace: Trace): Set<string> {
  return new Set(trace.spans.map((s) => s.path));
}

/** The span for a path, if it ran. */
export function spanAt(trace: Trace, path: string): Span | undefined {
  return trace.spans.find((s) => s.path === path);
}

/** Decisions in the order they were made. */
export function decisions(trace: Trace): { path: string; nodeId: string; decision: Decision }[] {
  return trace.spans.filter((s) => s.decision).map((s) => ({ path: s.path, nodeId: s.nodeId, decision: s.decision! }));
}

export interface PathDiff {
  /** Paths visited by both runs. */
  shared: string[];
  onlyA: string[];
  onlyB: string[];
  /** Where the two runs first took different edges. */
  divergedAt?: { path: string; nodeId: string; a: string; b: string };
}

/** Compare the paths two runs of the same chain took. */
export function diffTraces(a: Trace, b: Trace): PathDiff {
  const pa = visitedPaths(a);
  const pb = visitedPaths(b);
  const shared = [...pa].filter((p) => pb.has(p));
  const onlyA = [...pa].filter((p) => !pb.has(p));
  const onlyB = [...pb].filter((p) => !pa.has(p));
  let divergedAt: PathDiff["divergedAt"];
  for (const s of a.spans) {
    const other = spanAt(b, s.path);
    if (s.decision && other?.decision && s.decision.taken !== other.decision.taken) {
      divergedAt = { path: s.path, nodeId: s.nodeId, a: s.decision.taken, b: other.decision.taken };
      break;
    }
  }
  return { shared, onlyA, onlyB, ...(divergedAt ? { divergedAt } : {}) };
}
