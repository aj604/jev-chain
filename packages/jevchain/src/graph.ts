/**
 * Chains as flow graphs, for drawing.
 *
 * A chain is a tree of nodes, but it *runs* like a DAG: a route fans out and
 * whatever comes next in the chain runs after whichever branch was taken;
 * a parallel forks and joins; a cascade climbs a ladder of tiers. `graphOf`
 * compiles the tree into that DAG, and `overlayTrace` paints a (possibly
 * in-progress) trace onto it: what ran, which edges were taken, and the
 * number that decided each one.
 */
import { childPath, ROOT_PATH, type AnyJevNode, type AnyNode, type NodeKind } from "./nodes";
import type { Question } from "./questions";
import type { Decision, Span, Trace } from "./trace";

export type VertexKind = NodeKind | "tier" | "join" | "halt";

export interface Vertex {
  /** Unique; equals the span path for real nodes. */
  id: string;
  kind: VertexKind;
  nodeId: string;
  label: string;
  /** Path of the span that records this vertex's work (tiers point at their cascade). */
  spanPath: string;
  /** The deciding question, for route/gate/tier vertices. */
  question?: Question;
  /** For tiers: the tier id. */
  tier?: string;
  /** Nesting depth in the original tree (for grouping). */
  depth: number;
}

export interface Edge {
  id: string;
  source: string;
  target: string;
  /** Text on the edge: a route label, "then"/"otherwise", "escalate"... Empty for plain sequence edges. */
  label: string;
  /** If a decision picks this edge: the deciding span path and the decision edge key. */
  decidedBy?: { spanPath: string; key: string };
  kind: "sequence" | "branch" | "fork" | "join" | "escalate" | "accept" | "halt";
}

export interface FlowGraph {
  vertices: Vertex[];
  edges: Edge[];
  /** Where execution starts. */
  entry: string;
}

interface Fragment {
  entry: string;
  /** Vertices whose completion flows to whatever comes next, with the edge label/kind to use. */
  exits: { id: string; label: string; kind: Edge["kind"]; decidedBy?: Edge["decidedBy"] }[];
}

export function graphOf(root: AnyNode): FlowGraph {
  const vertices: Vertex[] = [];
  const edges: Edge[] = [];
  const addEdge = (e: Omit<Edge, "id">) => {
    const id = `${e.source}->${e.target}`;
    if (!edges.some((x) => x.id === id)) edges.push({ id, ...e });
  };
  const connect = (exits: Fragment["exits"], target: string) => {
    for (const x of exits) addEdge({ source: x.id, target, label: x.label, kind: x.kind, ...(x.decidedBy ? { decidedBy: x.decidedBy } : {}) });
  };

  const build = (node: AnyNode, path: string, depth: number): Fragment => {
    const n = node as AnyJevNode;
    const v: Vertex = { id: path, kind: n.kind, nodeId: n.id, label: n.title ?? n.id, spanPath: path, depth };
    const seq = (id: string) => ({ id, label: "", kind: "sequence" as const });
    switch (n.kind) {
      case "ask":
      case "step":
      case "emit":
        vertices.push(v);
        return { entry: path, exits: [seq(path)] };
      case "chain": {
        // A chain is its steps, laid end to end. No vertex of its own.
        let first: Fragment | undefined;
        let prev: Fragment | undefined;
        n.steps.forEach((child, i) => {
          const f = build(child, childPath(path, String(i)), depth + 1);
          if (prev) connect(prev.exits, f.entry);
          first ??= f;
          prev = f;
        });
        return { entry: first!.entry, exits: prev!.exits };
      }
      case "route": {
        vertices.push({ ...v, question: n.ask });
        const exits: Fragment["exits"] = [];
        const branch = (key: string, child: AnyNode) => {
          const f = build(child, childPath(path, key), depth + 1);
          addEdge({ source: path, target: f.entry, label: key === "lowConfidence" ? "unsure" : key, kind: "branch", decidedBy: { spanPath: path, key } });
          exits.push(...f.exits);
        };
        for (const [key, child] of Object.entries(n.branches)) branch(key, child);
        if (n.lowConfidence) branch("lowConfidence", n.lowConfidence.then);
        return { entry: path, exits };
      }
      case "gate": {
        vertices.push({ ...v, question: n.ask });
        const exits: Fragment["exits"] = [];
        const branch = (key: string, child: AnyNode) => {
          const f = build(child, childPath(path, key), depth + 1);
          addEdge({ source: path, target: f.entry, label: key, kind: "branch", decidedBy: { spanPath: path, key } });
          exits.push(...f.exits);
        };
        branch("then", n.then);
        if (n.otherwise) branch("otherwise", n.otherwise);
        else {
          const halt = childPath(path, "halt");
          vertices.push({ id: halt, kind: "halt", nodeId: n.id, label: "halt", spanPath: path, depth: depth + 1 });
          addEdge({ source: path, target: halt, label: "halt", kind: "halt", decidedBy: { spanPath: path, key: "halt" } });
        }
        if (n.unsure) branch("unsure", n.unsure.then);
        return { entry: path, exits };
      }
      case "parallel": {
        vertices.push(v);
        const join = `${path}#join`;
        vertices.push({ id: join, kind: "join", nodeId: n.id, label: n.join ? "join" : "collect", spanPath: path, depth });
        for (const [key, child] of Object.entries(n.branches)) {
          const f = build(child, childPath(path, key), depth + 1);
          addEdge({ source: path, target: f.entry, label: key, kind: "fork" });
          connect(
            f.exits.map((x) => ({ ...x, kind: "join" as const })),
            join,
          );
        }
        return { entry: path, exits: [seq(join)] };
      }
      case "cascade": {
        vertices.push(v);
        const exits: Fragment["exits"] = [];
        let prev = path;
        n.tiers.forEach((t, i) => {
          const id = childPath(path, t.id);
          vertices.push({ id, kind: "tier", nodeId: n.id, label: t.title ?? t.id, spanPath: path, tier: t.id, question: t.ask, depth: depth + 1 });
          addEdge(
            i === 0
              ? { source: prev, target: id, label: "", kind: "sequence" }
              : { source: prev, target: id, label: "escalate", kind: "escalate", decidedBy: { spanPath: path, key: `escalate:${n.tiers[i - 1]!.id}` } },
          );
          exits.push({ id, label: "accept", kind: "accept", decidedBy: { spanPath: path, key: t.id } });
          prev = id;
        });
        const f = build(n.fallback, childPath(path, "fallback"), depth + 1);
        addEdge({ source: prev, target: f.entry, label: "escalate", kind: "escalate", decidedBy: { spanPath: path, key: "fallback" } });
        exits.push(...f.exits);
        return { entry: path, exits };
      }
    }
  };

  const top = build(root, ROOT_PATH, 0);
  return { vertices, edges, entry: top.entry };
}

// ---------------------------------------------------------------------------
// Painting a trace onto the graph
// ---------------------------------------------------------------------------

export type VertexState = "idle" | "running" | "ok" | "error" | "halted" | "skipped";
export type EdgeState = "idle" | "taken" | "not-taken";

export interface VertexOverlay {
  state: VertexState;
  span?: Span;
  /** Duration in ms, once finished. */
  durationMs?: number;
}

export interface EdgeOverlay {
  state: EdgeState;
  /** The deciding number for this edge (probability, noul, score, confidence), if any. */
  value?: number | null;
  metric?: Decision["metric"];
}

export interface GraphOverlay {
  vertices: Record<string, VertexOverlay>;
  edges: Record<string, EdgeOverlay>;
}

/** Paint a trace (finished or in-flight) onto a graph. */
export function overlayTrace(graph: FlowGraph, trace: Trace | undefined): GraphOverlay {
  const vertices: Record<string, VertexOverlay> = {};
  const edges: Record<string, EdgeOverlay> = {};
  const spans = new Map((trace?.spans ?? []).map((s) => [s.path, s]));
  const finished = trace && trace.status !== "running";

  for (const v of graph.vertices) {
    const span = spans.get(v.spanPath);
    let state: VertexState = finished ? "skipped" : "idle";
    if (v.kind === "tier") {
      const called = span?.calls.some((c) => c.tier === v.tier);
      if (called) state = "ok";
      else if (span?.status === "running" && !span.decision) {
        // The first tier without a call yet is the one in flight.
        const cascadeTiers = graph.vertices.filter((x) => x.kind === "tier" && x.spanPath === v.spanPath);
        const next = cascadeTiers.find((t) => !span.calls.some((c) => c.tier === t.tier));
        if (next?.id === v.id) state = "running";
      }
    } else if (v.kind === "join") {
      if (span && span.status !== "running") state = span.status === "ok" ? "ok" : span.status === "halted" ? "halted" : "error";
      else if (span) {
        // Joined once every branch has finished.
        const branchDone = graph.edges.filter((e) => e.target === v.id).every((e) => {
          const s = spans.get(graph.vertices.find((x) => x.id === e.source)?.spanPath ?? "");
          return s && s.status !== "running";
        });
        state = branchDone ? "running" : state;
      }
    } else if (v.kind === "halt") {
      if (span?.decision?.taken === "halt") state = "halted";
    } else if (span) {
      state = span.status;
    }
    vertices[v.id] = {
      state,
      ...(span && v.kind !== "join" && v.kind !== "halt" && v.kind !== "tier" ? { span } : {}),
      ...(span?.end !== undefined && v.kind !== "tier" ? { durationMs: span.end - span.start } : {}),
    };
    if (v.kind === "tier" && span) {
      const call = span.calls.find((c) => c.tier === v.tier);
      vertices[v.id] = { ...vertices[v.id]!, span, ...(call ? { durationMs: call.end - call.start } : {}) };
    }
  }

  for (const e of graph.edges) {
    const src = vertices[e.source]!;
    const dst = vertices[e.target]!;
    const reached = (s: VertexState) => s !== "idle" && s !== "skipped";
    let state: EdgeState = reached(src.state) && reached(dst.state) ? "taken" : finished || (src.state !== "running" && reached(src.state)) ? "not-taken" : "idle";
    const overlay: EdgeOverlay = { state };
    if (e.decidedBy) {
      const d = spans.get(e.decidedBy.spanPath)?.decision;
      if (d) {
        overlay.metric = d.metric;
        const key = e.decidedBy.key;
        if (key.startsWith("escalate:")) {
          const from = key.slice("escalate:".length);
          const tierEdge = d.edges.find((x) => x.edge === from);
          overlay.value = tierEdge?.value ?? null;
          overlay.metric = "confidence";
          state = tierEdge && tierEdge.value !== null && !tierEdge.taken ? "taken" : "not-taken";
        } else if (key === "fallback") {
          overlay.value = null;
          state = d.taken === "fallback" ? "taken" : "not-taken";
        } else {
          const de = d.edges.find((x) => x.edge === key);
          overlay.value = de?.value ?? (key === "halt" ? d.value : null);
          state = d.taken === key ? "taken" : "not-taken";
        }
        overlay.state = state;
      } else if (!finished && reached(src.state)) {
        overlay.state = "idle";
      }
    }
    edges[e.id] = overlay;
  }
  return { vertices, edges };
}
