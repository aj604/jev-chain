/**
 * Graph layout: dagre, left → right, with node sizes that match the cards the
 * graph renders. Pure and deterministic, so it's memoized per chain and never
 * recomputed while a run streams in (overlays only restyle).
 */
import dagre from "@dagrejs/dagre";
import { walk, type AnyJevNode, type AnyNode, type Edge, type FlowGraph, type Vertex } from "jevchain";
import { fmtThreshold, gateMeasure, questionLabels } from "./format";

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export type Direction = "LR" | "TB";

export interface GraphLayout {
  direction: Direction;
  /** Top-left corner of each vertex. */
  positions: Record<string, Point>;
  sizes: Record<string, Size>;
  /** Center of each labeled edge's pill, as placed by dagre. */
  labels: Record<string, Point>;
  width: number;
  height: number;
}

/** What a node card shows under its title. Derived from the chain, not the trace. */
export interface VertexHint {
  /** Tiny chips: choice labels, question keys... */
  chips?: string[];
  /** A bar to clear: "p(yes) ≤ 0.50", "conf ≥ 0.70". */
  bar?: { measure: string; text: string; min?: number; max?: number; scale: number };
  /** Short secondary line, e.g. an emit's value. */
  line?: string;
}

export const NODE_WIDTH = 200;
const SMALL = new Set<Vertex["kind"]>(["join", "halt"]);

/** Chips wrap inside the card; this estimates how many rows (max 3) they need, leaving room for a value like " 100%". */
export function chipRows(chips: string[], inner = NODE_WIDTH - 16): number {
  let rows = 1;
  let x = 0;
  for (const c of chips) {
    const w = (c.length + 5) * 6.1 + 10;
    if (x > 0 && x + w > inner) {
      rows++;
      x = 0;
    }
    x += w + 4;
  }
  return Math.min(3, rows);
}

export function nodeSize(v: Pick<Vertex, "kind">, hint?: VertexHint): Size {
  if (SMALL.has(v.kind)) return { width: 92, height: 36 };
  let height = 58;
  if (hint?.chips?.length) height += 4 + 22 * chipRows(hint.chips);
  if (hint?.bar) height += 24;
  if (hint?.line) height += 20;
  return { width: NODE_WIDTH, height };
}

/** Walk the chain once and describe each vertex for the card. */
export function vertexHints(root: AnyNode | undefined, graph: FlowGraph): Record<string, VertexHint> {
  const byPath = new Map<string, AnyJevNode>();
  if (root) walk(root, (n, { path }) => byPath.set(path, n as AnyJevNode));
  const out: Record<string, VertexHint> = {};
  for (const v of graph.vertices) {
    const node = byPath.get(v.spanPath);
    const hint: VertexHint = {};
    switch (v.kind) {
      case "route": {
        hint.chips = questionLabels(v.question);
        break;
      }
      case "gate": {
        if (node?.kind === "gate") {
          const text = fmtThreshold(node.pass);
          if (text) {
            hint.bar = {
              measure: gateMeasure(node.ask, node.pass.label),
              text,
              min: node.pass.min,
              max: node.pass.max,
              scale: node.ask.type === "score" ? Math.max(1, node.ask.criteria.length - 1) : 1,
            };
          }
        } else if (v.question) hint.chips = [v.question.type];
        break;
      }
      case "tier": {
        if (node?.kind === "cascade") {
          const t = node.tiers.find((x) => x.id === v.tier);
          if (t) hint.bar = { measure: "conf", text: `≥ ${t.minConfidence.toFixed(2)}`, min: t.minConfidence, scale: 1 };
        }
        break;
      }
      case "ask": {
        if (node?.kind === "ask") {
          hint.chips = Object.entries(node.questions).map(([k, q]) => `${k}:${q.type}`);
        }
        break;
      }
      case "emit": {
        if (node?.kind === "emit") {
          const value = typeof node.value === "string" ? node.value : JSON.stringify(node.value);
          hint.line = value;
        }
        break;
      }
      case "parallel": {
        if (node?.kind === "parallel") hint.chips = Object.keys(node.branches);
        break;
      }
      case "cascade": {
        if (node?.kind === "cascade") hint.chips = node.tiers.map((t) => t.id);
        break;
      }
      case "step": {
        if (node?.kind === "step") hint.line = node.description ?? "your code";
        break;
      }
    }
    if (hint.chips && hint.chips.length === 0) delete hint.chips;
    out[v.id] = hint;
  }
  return out;
}

/** Rough pixel width of an edge pill: mono 10px, plus room for "✓" and a " · 100%" value. */
export function edgeLabelWidth(e: Pick<Edge, "label" | "decidedBy">): number {
  const chars = e.label.length + (e.decidedBy ? 9 : 0) + 2;
  return Math.round(chars * 6.1 + 14);
}

export function layoutGraph(graph: FlowGraph, sizeOf: (v: Vertex) => Size = (v) => nodeSize(v), direction: Direction = "LR"): GraphLayout {
  const g = new dagre.graphlib.Graph({ multigraph: false });
  // Labeled edges get their own rank (dagre halves ranksep and doubles minlen),
  // so pills sit in reserved space instead of on top of cards.
  g.setGraph(
    direction === "LR"
      ? { rankdir: "LR", nodesep: 20, ranksep: 36, edgesep: 12, marginx: 12, marginy: 12 }
      : { rankdir: "TB", nodesep: 28, ranksep: 30, edgesep: 16, marginx: 12, marginy: 12 },
  );
  g.setDefaultEdgeLabel(() => ({}));
  const sizes: Record<string, Size> = {};
  for (const v of graph.vertices) {
    const s = sizeOf(v);
    sizes[v.id] = s;
    g.setNode(v.id, { width: s.width, height: s.height });
  }
  for (const e of graph.edges) {
    const labeled = Boolean(e.label || e.decidedBy);
    g.setEdge(e.source, e.target, {
      minlen: 1,
      weight: e.kind === "sequence" || e.kind === "join" ? 2 : 1,
      ...(labeled ? { width: edgeLabelWidth(e), height: 20, labelpos: "c" } : {}),
    });
  }
  dagre.layout(g);

  const positions: Record<string, Point> = {};
  const labels: Record<string, Point> = {};
  let width = 0;
  let height = 0;
  for (const v of graph.vertices) {
    const n = g.node(v.id) as { x: number; y: number } | undefined;
    const s = sizes[v.id]!;
    const x = (n?.x ?? 0) - s.width / 2;
    const y = (n?.y ?? 0) - s.height / 2;
    positions[v.id] = { x, y };
    width = Math.max(width, x + s.width);
    height = Math.max(height, y + s.height);
  }
  for (const e of graph.edges) {
    if (!(e.label || e.decidedBy)) continue;
    const le = g.edge(e.source, e.target) as { x?: number; y?: number } | undefined;
    if (le?.x !== undefined && le.y !== undefined) labels[e.id] = { x: le.x, y: le.y };
  }
  return { direction, positions, sizes, labels, width, height };
}

/**
 * How big the graph would draw in a `w`×`h` box, as a zoom factor. Used to pick
 * the direction that makes the chain most readable in the space available.
 */
export function fitZoom(layout: Pick<GraphLayout, "width" | "height">, w: number, h: number, padding = 0.16): number {
  if (!(w > 0 && h > 0)) return 0;
  const k = 1 - padding;
  return Math.min((w * k) / Math.max(1, layout.width), (h * k) / Math.max(1, layout.height));
}

/** Left→right unless top→bottom draws clearly bigger (LR reads like a chain; keep it when it fits). */
export function pickDirection(lr: GraphLayout, tb: GraphLayout, w: number, h: number, bias = 1.2): Direction {
  if (!(w > 0 && h > 0)) return "LR";
  const zl = Math.min(1, fitZoom(lr, w, h));
  const zt = Math.min(1, fitZoom(tb, w, h));
  return zt > zl * bias ? "TB" : "LR";
}

/**
 * The curve for an edge in flow direction. With a label point it passes
 * through it on a flat tangent (so the pill sits on a level stretch of line).
 */
export function edgePath(sx: number, sy: number, tx: number, ty: number, via?: Point, direction: Direction = "LR"): { d: string; label: Point } {
  if (direction === "TB") {
    if (!via || via.y <= sy || via.y >= ty) {
      const dy = Math.max(24, Math.abs(ty - sy) * 0.5);
      return { d: `M ${sx},${sy} C ${sx},${sy + dy} ${tx},${ty - dy} ${tx},${ty}`, label: { x: (sx + tx) / 2, y: (sy + ty) / 2 } };
    }
    const d1 = Math.max(10, (via.y - sy) * 0.55);
    const d2 = Math.max(10, (ty - via.y) * 0.55);
    return {
      d: `M ${sx},${sy} C ${sx},${sy + d1} ${via.x},${via.y - d1} ${via.x},${via.y} C ${via.x},${via.y + d2} ${tx},${ty - d2} ${tx},${ty}`,
      label: via,
    };
  }
  if (!via || via.x <= sx || via.x >= tx) return flowPath(sx, sy, tx, ty, 0.5);
  const d1 = Math.max(12, (via.x - sx) * 0.55);
  const d2 = Math.max(12, (tx - via.x) * 0.55);
  return {
    d: `M ${sx},${sy} C ${sx + d1},${sy} ${via.x - d1},${via.y} ${via.x},${via.y} C ${via.x + d2},${via.y} ${tx - d2},${ty} ${tx},${ty}`,
    label: via,
  };
}

/**
 * Cubic curve between two points, flowing left → right, and a point along it
 * for the label (nearer the target so fan-out labels don't pile up at the fork).
 */
export function flowPath(sx: number, sy: number, tx: number, ty: number, labelAt = 0.6): { d: string; label: Point } {
  const dx = Math.max(36, Math.abs(tx - sx) * 0.5);
  const c1x = sx + dx;
  const c2x = tx - dx;
  const t = labelAt;
  const mt = 1 - t;
  const bx = mt * mt * mt * sx + 3 * mt * mt * t * c1x + 3 * mt * t * t * c2x + t * t * t * tx;
  const by = mt * mt * mt * sy + 3 * mt * mt * t * sy + 3 * mt * t * t * ty + t * t * t * ty;
  return { d: `M ${sx},${sy} C ${c1x},${sy} ${c2x},${ty} ${tx},${ty}`, label: { x: bx, y: by } };
}
