/**
 * Lay a chain's flow graph out left-to-right for static drawing.
 *
 * Pure and synchronous (dagre does the ranking and edge routing), so it runs
 * happily in a server component at build time: the mini-maps ship as plain
 * SVG with no client JS.
 */
import dagre from "@dagrejs/dagre";
import { graphOf, type AnyNode, type Edge, type FlowGraph, type VertexKind } from "jevchain";

export type MapDetail = "compact" | "full";

export interface MapNode {
  id: string;
  kind: VertexKind;
  /** Shown inside the box: the kind (compact) or the node's title (full). */
  label: string;
  /** Node id, for tooltips / titles. */
  nodeId: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface MapEdge {
  id: string;
  kind: Edge["kind"];
  label: string;
  points: { x: number; y: number }[];
  labelAt?: { x: number; y: number };
}

export interface ChainLayout {
  width: number;
  height: number;
  nodes: MapNode[];
  edges: MapEdge[];
}

/** Rough advance width of Geist Mono at a given size. Good enough for boxes. */
const monoWidth = (text: string, size: number) => text.length * size * 0.6;

const SIZES = {
  compact: { font: 9, padX: 7, h: 18, rank: 26, node: 10, edgeFont: 0 },
  full: { font: 11, padX: 10, h: 30, rank: 44, node: 16, edgeFont: 10 },
} as const;

/** What a vertex says about itself in each detail level. */
function vertexText(kind: VertexKind, label: string, detail: MapDetail): string {
  if (detail === "compact") return kind === "halt" ? "halt" : kind === "join" ? "join" : kind;
  if (kind === "halt") return "halt";
  if (kind === "join") return label; // "join" | "collect"
  return label.length > 28 ? `${label.slice(0, 27)}…` : label;
}

export function layoutGraph(graph: FlowGraph, detail: MapDetail = "compact"): ChainLayout {
  const s = SIZES[detail];
  const g = new dagre.graphlib.Graph<Record<string, unknown>, { width: number; height: number }, Record<string, unknown>>({
    multigraph: false,
  });
  g.setGraph({ rankdir: "LR", ranksep: s.rank, nodesep: s.node, edgesep: 6, marginx: 2, marginy: 2 });
  g.setDefaultEdgeLabel(() => ({}));

  const texts = new Map<string, string>();
  for (const v of graph.vertices) {
    const text = vertexText(v.kind, v.label, detail);
    texts.set(v.id, text);
    // Kind tag + text in full mode; the tag is drawn as a small prefix.
    const tag = detail === "full" && v.kind !== "halt" && v.kind !== "join" ? monoWidth(v.kind, s.font - 2) + 10 : 0;
    const w = Math.max(detail === "compact" ? 30 : 64, Math.ceil(monoWidth(text, s.font) + s.padX * 2 + tag));
    const small = v.kind === "join" || v.kind === "halt";
    g.setNode(v.id, { width: small && detail === "compact" ? 26 : w, height: small ? s.h - 4 : s.h });
  }
  for (const e of graph.edges) {
    const showLabel = detail === "full" && e.label !== "";
    g.setEdge(
      e.source,
      e.target,
      showLabel
        ? { width: monoWidth(e.label, s.edgeFont) + 8, height: s.edgeFont + 4, labelpos: "c" }
        : { width: 0, height: 0 },
    );
  }

  dagre.layout(g);

  const nodes: MapNode[] = graph.vertices.map((v) => {
    const n = g.node(v.id) as { x: number; y: number; width: number; height: number };
    return { id: v.id, kind: v.kind, label: texts.get(v.id)!, nodeId: v.nodeId, x: n.x, y: n.y, w: n.width, h: n.height };
  });
  const edges: MapEdge[] = graph.edges.map((e) => {
    const d = g.edge(e.source, e.target) as { points?: { x: number; y: number }[]; x?: number; y?: number };
    return {
      id: e.id,
      kind: e.kind,
      label: e.label,
      points: d.points ?? [],
      ...(detail === "full" && e.label && d.x !== undefined && d.y !== undefined ? { labelAt: { x: d.x, y: d.y } } : {}),
    };
  });
  const gl = g.graph() as { width?: number; height?: number };
  return { width: Math.ceil(gl.width ?? 0), height: Math.ceil(gl.height ?? 0), nodes, edges };
}

/** Convenience: chain → graph → layout. */
export function layoutChain(chain: AnyNode, detail: MapDetail = "compact"): ChainLayout {
  return layoutGraph(graphOf(chain), detail);
}

/** Node kinds that spend a Jev call (drawn with the accent marker). */
export const CALLS_JEV: ReadonlySet<VertexKind> = new Set(["ask", "route", "gate", "tier"]);
