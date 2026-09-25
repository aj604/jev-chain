/**
 * Cut, copy and paste for whole subtrees, so a node (and everything under it)
 * can land anywhere: after or before another node, or in place of one (a
 * placeholder slot, a branch, a gate's `then`...).
 *
 *   clipboard.set(getAt(root, "$/0/b")!, "copy");
 *   const r = pasteAt(root, "$/1", clipboard.get()!.node, "after");   // { root, path }
 *
 * The clipboard itself is a tiny module-level store, not the system clipboard:
 * it outlives switching drafts or forking an example in the same tab, which is
 * the point (copy a branch out of an example, paste it into your own chain).
 */
import { allIds, childEdges, followable, getAt, insertAfterPath, insertBeforePath, renameReads, updateAt, type NodeJson } from "./doc-ops";

export type PasteMode = "after" | "before" | "replace";

export interface Clip {
  node: NodeJson;
  /** Whether it was cut (so the ids are free again) or copied. */
  via: "cut" | "copy";
}

/**
 * `node` with any id that's already `taken` renamed (`x` → `x-copy`,
 * `x-copy-2`…), including ids repeated inside the node itself. Ids that are
 * free are kept, so cut → paste moves a subtree without renaming it. Adds
 * every id it hands out to `taken`. `{{results.<id>}}` reads inside the node,
 * of a node inside it, follow that node to its new id.
 */
export function withUniqueIds(node: NodeJson, taken: Set<string>): NodeJson {
  const renames: [string, string][] = [];
  const go = (n: NodeJson): NodeJson => {
    let id = n.id;
    if (taken.has(id)) {
      id = `${n.id}-copy`;
      for (let i = 2; taken.has(id); i++) id = `${n.id}-copy-${i}`;
    }
    taken.add(id);
    renames.push([n.id, id]);
    let out: NodeJson = id === n.id ? n : { ...n, id };
    for (const c of childEdges(n)) {
      const next = go(c.node);
      if (next !== c.node) out = updateAt(out, `$/${c.edge}`, next);
    }
    return out;
  };
  return renameReads(go(node), followable(renames));
}

/**
 * Put `node` at `path`: as the next or previous step (the same rules as
 * adding a node, so it may wrap the target in a new chain), or in its place.
 * Colliding ids are renamed. Returns the new root and where the pasted node
 * landed; with a null path it goes at the end (or start) of the whole chain.
 */
export function pasteAt(root: NodeJson, path: string | null, node: NodeJson, mode: PasteMode): { root: NodeJson; path: string } {
  const at = path ?? "$";
  if (mode === "replace") {
    const taken = allIds(root);
    const outgoing = getAt(root, at);
    if (outgoing) for (const id of allIds(outgoing)) taken.delete(id);
    return { root: updateAt(root, at, withUniqueIds(node, taken)), path: at };
  }
  const taken = allIds(root);
  const clean = withUniqueIds(node, taken);
  return mode === "after" ? insertAfterPath(root, at, clean, taken) : insertBeforePath(root, at, clean, taken);
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

let current: Clip | null = null;
const listeners = new Set<() => void>();

export const clipboard = {
  get: (): Clip | null => current,
  set(node: NodeJson, via: Clip["via"]) {
    current = { node, via };
    for (const l of listeners) l();
  },
  clear() {
    current = null;
    for (const l of listeners) l();
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => void listeners.delete(listener);
  },
};
