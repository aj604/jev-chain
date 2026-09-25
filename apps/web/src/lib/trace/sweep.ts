/**
 * Sweep: run one chain over many inputs and see where each one goes.
 *
 * One trace answers "why did it go here?" for one input. A sweep answers the
 * question behind it: what does this chain do with *everything* — which roads
 * the inputs actually take, how each decision splits them, and which roads no
 * input reaches at all. Pure helpers (so the numbers are tested) plus a
 * sequential runner that works with any `JevClient`, real or rehearsal.
 *
 *   const rows = sweepInputs(chain.inputs, { label: "your input", value }, extraText);
 *   await runSweep(node, rows.inputs, client, { signal, onRow });
 *   trafficOf(graph, traces)      // visits per vertex / edge, for the graph
 *   tallyDecisions(graph, traces) // how each decision split the inputs
 *   unreachedRoads(graph, traffic)// the first node of every road nothing took
 */
import { createJev, decisions, overlayTrace, spanAt, type AnyNode, type FlowGraph, type GraphOverlay, type JevClient, type Json, type Trace, type Vertex } from "jevchain";
import { previewJson } from "./format";
import { closestFlip, type Flip } from "./margin";
import { traceIssue, type RunIssue } from "./run-error";
import { edgeName } from "./what-if";

/** At most this many inputs per sweep: enough to see a shape, few enough for the shared key's rate limit. */
export const MAX_SWEEP = 20;

export interface SweepInput {
  label: string;
  value: Json;
}

export interface SweepRow extends SweepInput {
  trace?: Trace;
  issue?: RunIssue | null;
}

// ── inputs ───────────────────────────────────────────────────────────────────

export type ParsedLines = { ok: true; values: Json[] } | { ok: false; error: string; line: number };

/**
 * "More inputs, one per line." A line that starts like JSON (`{`, `[`, `"`)
 * must parse as JSON; anything else is plain text. Blank lines are skipped.
 */
export function parseSweepLines(text: string): ParsedLines {
  const values: Json[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    if (/^[[{"]/.test(line)) {
      try {
        values.push(JSON.parse(line) as Json);
      } catch {
        return { ok: false, error: `line ${i + 1} looks like json but doesn't parse`, line: i + 1 };
      }
    } else values.push(line);
  }
  return { ok: true, values };
}

/**
 * Everything a sweep runs: the chain's samples, the input in the editor (when
 * it isn't one of them), and any extra lines. Duplicates are dropped; the list
 * is capped at `MAX_SWEEP` and says how many it left out.
 */
export function sweepInputs(samples: readonly SweepInput[], current: Json | undefined, extra: readonly Json[] = []): { inputs: SweepInput[]; dropped: number } {
  const seen = new Set<string>();
  const all: SweepInput[] = [];
  const add = (label: string, value: Json) => {
    const key = JSON.stringify(value);
    if (seen.has(key)) return;
    seen.add(key);
    all.push({ label, value });
  };
  for (const s of samples) add(s.label, s.value);
  if (current !== undefined) add("your input", current);
  for (const v of extra) add(previewJson(v, 48), v);
  return { inputs: all.slice(0, MAX_SWEEP), dropped: Math.max(0, all.length - MAX_SWEEP) };
}

// ── running ──────────────────────────────────────────────────────────────────

/** Issues that would hit every remaining input the same way: stop instead of failing N times. */
const FATAL: ReadonlySet<RunIssue["kind"]> = new Set(["missing-key", "bad-key", "rate-limited", "network", "config"]);

export interface SweepResult {
  rows: SweepRow[];
  /** Set when the sweep gave up early: the issue that stopped it. */
  stoppedBy?: RunIssue;
}

/**
 * Run `node` on each input in turn (one at a time: the shared key is rate
 * limited, and a sweep is about coverage, not speed). `onRow` fires after each
 * input finishes. Stops early on an abort, or on an issue every later input
 * would hit too (no key, bad key, rate limited, can't reach the proxy).
 */
export async function runSweep(
  node: AnyNode,
  inputs: readonly SweepInput[],
  client: JevClient,
  options: { signal?: AbortSignal; onRow?: (index: number, row: SweepRow) => void } = {},
): Promise<SweepResult> {
  const jev = createJev(client);
  const rows: SweepRow[] = inputs.map((i) => ({ ...i }));
  for (let i = 0; i < inputs.length; i++) {
    if (options.signal?.aborted) return { rows };
    let row: SweepRow;
    try {
      const result = await jev.run(node, inputs[i]!.value, options.signal ? { signal: options.signal } : {});
      row = { ...inputs[i]!, trace: result.trace, issue: traceIssue(result.trace, result.error) };
    } catch (e) {
      // run() only throws for an invalid chain.
      row = { ...inputs[i]!, issue: { kind: "config", title: "this chain doesn't hold together", detail: e instanceof Error ? e.message : String(e) } };
    }
    rows[i] = row;
    options.onRow?.(i, row);
    if (row.trace?.status === "aborted") return { rows };
    if (row.issue && FATAL.has(row.issue.kind)) return { rows, stoppedBy: row.issue };
  }
  return { rows };
}

// ── reading a sweep ──────────────────────────────────────────────────────────

/** Traces that finished on their own. A stopped run's half-walked road isn't where that input goes. */
export function finishedTraces(rows: readonly SweepRow[]): Trace[] {
  return rows.flatMap((r) => (r.trace && r.trace.status !== "running" && r.trace.status !== "aborted" ? [r.trace] : []));
}

/**
 * Inputs that didn't make it to the end on their own (errored, stopped, or
 * never run). While there are any, "no input takes this road" isn't a claim a
 * sweep can make: that input might have gone anywhere after it broke.
 */
export function unfinished(rows: readonly SweepRow[]): number {
  return rows.filter((r) => r.trace?.status !== "ok" && r.trace?.status !== "halted").length;
}

/** How many of `total` traces reached each vertex and took each edge. */
export interface Traffic {
  total: number;
  vertices: Record<string, number>;
  edges: Record<string, number>;
}

const reached = (s: string | undefined) => s !== undefined && s !== "idle" && s !== "skipped";

/**
 * The vertices one trace passed through and the edges it took, from the same
 * overlay the graph draws for a single run, with one correction: the overlay
 * gives a parallel's join the parallel's final status, so a parallel that
 * halted or errored in a branch would count as joined. A join only counts when
 * the parallel finished ok, or every branch did (so a join function that
 * throws still counts: the branches met). An edge into a join counts only when
 * the join does.
 */
function walked(graph: FlowGraph, trace: Trace): { vertices: Set<string>; edges: Set<string> } {
  const o = overlayTrace(graph, trace);
  const vertices = new Set(graph.vertices.filter((v) => reached(o.vertices[v.id]?.state)).map((v) => v.id));
  for (const v of graph.vertices) {
    if (v.kind !== "join" || !vertices.has(v.id) || o.vertices[v.id]?.state === "ok") continue;
    const branches = trace.spans.filter((s) => s.parentPath === v.spanPath);
    if (branches.length === 0 || branches.some((s) => s.status !== "ok")) vertices.delete(v.id);
  }
  const edges = new Set(graph.edges.filter((e) => o.edges[e.id]?.state === "taken" && vertices.has(e.source) && vertices.has(e.target)).map((e) => e.id));
  return { vertices, edges };
}

/** Count visits per vertex and edge. */
export function trafficOf(graph: FlowGraph, traces: readonly Trace[]): Traffic {
  const vertices: Record<string, number> = Object.fromEntries(graph.vertices.map((v) => [v.id, 0]));
  const edges: Record<string, number> = Object.fromEntries(graph.edges.map((e) => [e.id, 0]));
  for (const t of traces) {
    const w = walked(graph, t);
    for (const id of w.vertices) vertices[id]!++;
    for (const id of w.edges) edges[id]!++;
  }
  return { total: traces.length, vertices, edges };
}

/**
 * A sweep painted like a finished trace: anything at least one input reached
 * is "ok"/"taken", everything else is "skipped"/"not-taken". The counts ride
 * alongside (see `Traffic`); this is just the shape the graph already draws.
 */
export function trafficOverlay(graph: FlowGraph, traffic: Traffic): GraphOverlay {
  return {
    vertices: Object.fromEntries(graph.vertices.map((v) => [v.id, { state: (traffic.vertices[v.id] ?? 0) > 0 ? "ok" : "skipped" }])),
    edges: Object.fromEntries(graph.edges.map((e) => [e.id, { state: (traffic.edges[e.id] ?? 0) > 0 ? "taken" : "not-taken" }])),
  };
}

/** Did this trace pass through vertex `id`? */
export function visits(graph: FlowGraph, trace: Trace, id: string): boolean {
  return walked(graph, trace).vertices.has(id);
}

export interface DecisionTally {
  /** The deciding span path (= the route/gate/cascade vertex id). */
  path: string;
  nodeId: string;
  title: string;
  kind: "route" | "gate" | "cascade";
  /** How many traces made this decision (an input whose ask errored reached the node but decided nothing). */
  decided: number;
  /** Every road out of it, with how many traces took it (0 = none did). */
  roads: { edge: string; label: string; count: number }[];
}

/** How each decision split the traces that made it, in graph order. Decisions nothing made are left out. */
export function tallyDecisions(graph: FlowGraph, traces: readonly Trace[]): DecisionTally[] {
  const out: DecisionTally[] = [];
  for (const v of graph.vertices) {
    if (v.kind !== "route" && v.kind !== "gate" && v.kind !== "cascade") continue;
    const made = traces.flatMap((t) => decisions(t).filter((d) => d.path === v.spanPath));
    if (made.length === 0) continue;
    // Candidate roads, in the decision's own order (tiers before fallback), plus any the graph
    // draws that no decision listed (a gate's halt), so a road nothing took still shows as 0.
    const keys: string[] = [];
    const add = (k: string) => {
      if (!keys.includes(k)) keys.push(k);
    };
    for (const d of made) for (const e of d.decision.edges) add(e.edge);
    for (const d of made) add(d.decision.taken);
    for (const e of graph.edges) if (e.decidedBy?.spanPath === v.spanPath && !e.decidedBy.key.startsWith("escalate:")) add(e.decidedBy.key);
    out.push({
      path: v.spanPath,
      nodeId: v.nodeId,
      title: v.label,
      kind: v.kind,
      decided: made.length,
      roads: keys.map((edge) => ({ edge, label: edgeName(edge), count: made.filter((d) => d.decision.taken === edge).length })),
    });
  }
  return out;
}

export interface UnreachedRoad {
  /** The first vertex on the road nothing took. */
  vertex: Vertex;
  /** The decision that could have sent something there, and the road's key. */
  via?: { path: string; title: string; edge: string };
}

/**
 * Roads no trace took: each unvisited vertex whose way in comes from a visited
 * one (so a whole dead subtree is reported once, at its entrance). Needs at
 * least one trace.
 */
export function unreachedRoads(graph: FlowGraph, traffic: Traffic): UnreachedRoad[] {
  if (traffic.total === 0) return [];
  const out: UnreachedRoad[] = [];
  for (const v of graph.vertices) {
    if ((traffic.vertices[v.id] ?? 0) > 0) continue;
    const incoming = graph.edges.filter((e) => e.target === v.id && (traffic.vertices[e.source] ?? 0) > 0);
    if (incoming.length === 0) continue;
    const decided = incoming.find((e) => e.decidedBy);
    const by = decided?.decidedBy;
    const decider = by ? graph.vertices.find((x) => x.id === by.spanPath) : undefined;
    out.push({ vertex: v, ...(by ? { via: { path: by.spanPath, title: decider?.label ?? by.spanPath, edge: by.key } } : {}) });
  }
  return out;
}

/** The decisions one trace made, as "title → road" steps (for a sweep row). */
export function routeOf(trace: Trace): { path: string; title: string; edge: string }[] {
  return decisions(trace).map((d) => {
    const span = trace.spans.find((s) => s.path === d.path);
    return { path: d.path, title: span?.title ?? d.nodeId, edge: edgeName(d.decision.taken) };
  });
}

export interface CloseCall {
  /** Index into the sweep's rows. */
  index: number;
  row: SweepRow;
  /** The nearest road this input's decision didn't take, and how far off it was. */
  flip: Flip;
  /** The road it did take. */
  taken: string;
}

/**
 * The inputs that came closest to going another way at decision `path`,
 * nearest first: one per input that made the decision and finished, measured
 * by `closestFlip` against the chain's own rule. A split of 3 to 2 reads very
 * differently when all five sat a hair from the line.
 */
export function closeCallsAt(root: AnyNode, rows: readonly SweepRow[], path: string): CloseCall[] {
  const out: CloseCall[] = [];
  rows.forEach((row, index) => {
    const t = row.trace;
    if (!t || t.status === "running" || t.status === "aborted") return;
    const span = spanAt(t, path);
    const flip = closestFlip(root, span);
    if (flip && span?.decision) out.push({ index, row, flip, taken: span.decision.taken });
  });
  return out.sort((a, b) => a.flip.by - b.flip.by || a.index - b.index);
}
