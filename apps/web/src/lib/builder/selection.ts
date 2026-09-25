/**
 * Graph selection ↔ document paths.
 *
 * The canvas selects graph vertices; the editor edits document nodes. Most
 * vertex ids *are* node paths, except the graph-only ones: a cascade's tiers
 * (`$/c/<tierId>` → the cascade, focused on that tier), a parallel's
 * `#join` and a gate's `/halt` (→ their owner via `spanPath`). Chains have
 * no vertex, so selecting one lands on its first step.
 */
import type { FlowGraph } from "jevchain";
import { childEdges, getAt, joinPath, parentOf, type NodeJson } from "./doc-ops";

export interface EditTarget {
  path: string;
  node: NodeJson;
  tier?: string;
}

function safeGet(root: NodeJson, path: string): NodeJson | undefined {
  try {
    return getAt(root, path);
  } catch {
    return undefined;
  }
}

/** What the editor should show for a selected vertex id. */
export function editTarget(graph: FlowGraph, root: NodeJson, selected: string | null): EditTarget | null {
  if (!selected) return null;
  const v = graph.vertices.find((x) => x.id === selected);
  const path = v ? v.spanPath : selected;
  const node = safeGet(root, path);
  if (!node) return null;
  return v?.kind === "tier" && v.tier ? { path, node, tier: v.tier } : { path, node };
}

/** The vertex id to select for a document path (chains → their first step). */
export function vertexFor(root: NodeJson, path: string, tier?: string): string | null {
  const node = safeGet(root, path);
  if (!node) return null;
  if (tier && node.kind === "cascade") return joinPath(path, tier);
  if (node.kind !== "chain") return path;
  const first = childEdges(node)[0];
  return first ? vertexFor(root, joinPath(path, first.edge)) : null;
}

/** After deleting `path`: whatever now sits there, else the nearest ancestor with a vertex. */
export function selectionAfterRemove(root: NodeJson, path: string): string | null {
  let cur: string | null = path;
  while (cur) {
    const node = safeGet(root, cur);
    if (node && node.kind !== "chain") return cur;
    cur = parentOf(cur)?.parent ?? null;
  }
  return null;
}
