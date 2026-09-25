/**
 * Pure, immutable edits on a chain document's JSON tree, addressed by the same
 * paths the runtime and graph use (`$`, `$/0`, `$/bug/then`, `$/p/x`...).
 *
 * The builder UI only ever calls these; they never mutate, so undo/redo is a
 * stack of documents and React re-renders stay cheap.
 */
import { CHAIN_FORMAT, ChainConfigError, fromJSON, type ChainDocument, type Json } from "jevchain";

export type NodeJson = { kind: BuilderKind; id: string; title?: string; [key: string]: unknown };
export type BuilderKind = "ask" | "route" | "gate" | "parallel" | "cascade" | "step" | "emit" | "chain";

export const ROOT = "$";

export function segments(path: string): string[] {
  if (path === ROOT) return [];
  if (!path.startsWith(`${ROOT}/`)) throw new Error(`bad path: ${path}`);
  return path.slice(2).split("/");
}

export function joinPath(parent: string, edge: string): string {
  return `${parent}/${edge}`;
}

export function parentOf(path: string): { parent: string; edge: string } | null {
  const segs = segments(path);
  if (!segs.length) return null;
  const edge = segs.pop()!;
  return { parent: segs.length ? `${ROOT}/${segs.join("/")}` : ROOT, edge };
}

/** The child node JSON reached from `node` by `edge`, if any. */
export function childAt(node: NodeJson, edge: string): NodeJson | undefined {
  switch (node.kind) {
    case "route":
      if (edge === "lowConfidence") return (node.lowConfidence as { then: NodeJson } | undefined)?.then;
      return (node.branches as Record<string, NodeJson>)[edge];
    case "gate":
      if (edge === "then") return node.then as NodeJson;
      if (edge === "otherwise") return node.otherwise as NodeJson | undefined;
      if (edge === "unsure") return (node.unsure as { then: NodeJson } | undefined)?.then;
      return undefined;
    case "parallel":
      return (node.branches as Record<string, NodeJson>)[edge];
    case "cascade":
      return edge === "fallback" ? (node.fallback as NodeJson) : undefined;
    case "chain":
      return (node.steps as NodeJson[])[Number(edge)];
    default:
      return undefined;
  }
}

/** Every child with its edge, in display order. */
export function childEdges(node: NodeJson): { edge: string; node: NodeJson }[] {
  const out: { edge: string; node: NodeJson }[] = [];
  const push = (edge: string, n: unknown) => n && out.push({ edge, node: n as NodeJson });
  switch (node.kind) {
    case "route":
      for (const [k, v] of Object.entries(node.branches as Record<string, NodeJson>)) push(k, v);
      push("lowConfidence", (node.lowConfidence as { then?: NodeJson } | undefined)?.then);
      break;
    case "gate":
      push("then", node.then);
      push("otherwise", node.otherwise);
      push("unsure", (node.unsure as { then?: NodeJson } | undefined)?.then);
      break;
    case "parallel":
      for (const [k, v] of Object.entries(node.branches as Record<string, NodeJson>)) push(k, v);
      break;
    case "cascade":
      push("fallback", node.fallback);
      break;
    case "chain":
      (node.steps as NodeJson[]).forEach((s, i) => push(String(i), s));
      break;
  }
  return out;
}

function withChild(node: NodeJson, edge: string, child: NodeJson): NodeJson {
  switch (node.kind) {
    case "route":
      if (edge === "lowConfidence") return { ...node, lowConfidence: { ...(node.lowConfidence as object), then: child } };
      return { ...node, branches: { ...(node.branches as object), [edge]: child } };
    case "gate":
      if (edge === "unsure") return { ...node, unsure: { ...(node.unsure as object), then: child } };
      return { ...node, [edge]: child };
    case "parallel":
      return { ...node, branches: { ...(node.branches as object), [edge]: child } };
    case "cascade":
      return { ...node, fallback: child };
    case "chain": {
      const steps = [...(node.steps as NodeJson[])];
      steps[Number(edge)] = child;
      return { ...node, steps };
    }
    default:
      throw new Error(`${node.kind} nodes have no children`);
  }
}

export function getAt(root: NodeJson, path: string): NodeJson | undefined {
  let cur: NodeJson | undefined = root;
  for (const s of segments(path)) {
    if (!cur) return undefined;
    cur = childAt(cur, s);
  }
  return cur;
}

/** Replace the node at `path` (or apply an updater to it). */
export function updateAt(root: NodeJson, path: string, next: NodeJson | ((n: NodeJson) => NodeJson)): NodeJson {
  const segs = segments(path);
  const go = (node: NodeJson, i: number): NodeJson => {
    if (i === segs.length) return typeof next === "function" ? next(node) : next;
    const child = childAt(node, segs[i]!);
    if (!child) throw new Error(`no node at ${path}`);
    return withChild(node, segs[i]!, go(child, i + 1));
  };
  return go(root, 0);
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

let seq = 0;
/** A short unique-ish id: `route-3`. Unique within a session; the user can rename. */
export function freshId(kind: string, taken: Set<string> = new Set()): string {
  let id: string;
  do id = `${kind}-${++seq}`;
  while (taken.has(id));
  return id;
}

export function allIds(root: NodeJson): Set<string> {
  const ids = new Set<string>();
  const go = (n: NodeJson) => {
    ids.add(n.id);
    for (const c of childEdges(n)) go(c.node);
  };
  go(root);
  return ids;
}

/** What a removed node leaves behind. The builder draws these as "+ something goes here". */
export const PLACEHOLDER = "nothing here yet";

export function isPlaceholder(node: NodeJson | undefined): boolean {
  return node?.kind === "emit" && node.value === PLACEHOLDER;
}

const leaf = (text: string, taken: Set<string>): NodeJson => {
  const id = freshId("emit", taken);
  taken.add(id);
  return { kind: "emit", id, value: text };
};

/** A valid, runnable starter node of each kind. */
export function template(kind: BuilderKind, taken: Set<string> = new Set()): NodeJson {
  const id = freshId(kind, taken);
  taken.add(id);
  switch (kind) {
    case "ask":
      return { kind, id, questions: { vibe: { type: "choice", instructions: "What's the vibe?", criteria: { good: null, bad: null } } } };
    case "route":
      return {
        kind,
        id,
        ask: { type: "choice", instructions: "Which way?", criteria: { left: null, right: null } },
        branches: { left: leaf("went left", taken), right: leaf("went right", taken) },
      };
    case "gate":
      return {
        kind,
        id,
        ask: { type: "noul", instructions: "Is this a good idea?" },
        pass: { min: 0.7 },
        then: leaf("do it", taken),
        otherwise: leaf("don't", taken),
      };
    case "parallel":
      return {
        kind,
        id,
        branches: {
          a: { kind: "ask", id: freshId("ask", taken), questions: { spicy: { type: "noul", instructions: "Is this spicy?" } } },
          b: { kind: "ask", id: freshId("ask", taken), questions: { sad: { type: "noul", instructions: "Is this sad?" } } },
        },
      };
    case "cascade":
      return {
        kind,
        id,
        tiers: [
          { id: "quick", ask: { type: "noul", instructions: "Is this obviously fine?" }, minConfidence: 0.8 },
          { id: "careful", ask: { type: "noul", instructions: "Considering everything, is this fine?" }, minConfidence: 0.5 },
        ],
        fallback: leaf("ask a human", taken),
      };
    case "step":
      return { kind, id, run: { $ref: id } };
    case "emit":
      return { kind, id, value: "hello from {{input}}" };
    case "chain":
      return { kind, id, steps: [template("ask", taken), leaf("done", taken)] };
  }
}

// ---------------------------------------------------------------------------
// Structural edits
// ---------------------------------------------------------------------------

/**
 * Keep a route's branches in sync with its choice labels: new labels get a
 * placeholder leaf, removed labels drop their branch, and a rename (same
 * position) keeps the subtree.
 */
export function syncRouteBranches(route: NodeJson, prevLabels: string[], nextLabels: string[], taken: Set<string>): NodeJson {
  const old = route.branches as Record<string, NodeJson>;
  const branches: Record<string, NodeJson> = {};
  nextLabels.forEach((label, i) => {
    if (old[label]) branches[label] = old[label];
    else if (prevLabels[i] !== undefined && !nextLabels.includes(prevLabels[i]!) && old[prevLabels[i]!]) branches[label] = old[prevLabels[i]!]!;
    else branches[label] = leaf(`→ ${label}`, taken);
  });
  return { ...route, branches };
}

/** Insert `node` after the one at `path`: into the parent chain if there is one, else wrap both in a new chain. */
export function insertAfter(root: NodeJson, path: string, node: NodeJson, taken: Set<string> = allIds(root)): NodeJson {
  const p = parentOf(path);
  if (p) {
    const parent = getAt(root, p.parent)!;
    if (parent.kind === "chain") {
      const i = Number(p.edge);
      return updateAt(root, p.parent, (c) => {
        const steps = [...(c.steps as NodeJson[])];
        steps.splice(i + 1, 0, node);
        return { ...c, steps };
      });
    }
  }
  const target = getAt(root, path)!;
  if (target.kind === "chain") return updateAt(root, path, (c) => ({ ...c, steps: [...(c.steps as NodeJson[]), node] }));
  const id = freshId("chain", taken);
  return updateAt(root, path, { kind: "chain", id, steps: [target, node] });
}

/**
 * Remove the node at `path`. In a chain it's spliced out (a one-step chain
 * collapses to that step); elsewhere it's replaced by a placeholder leaf so the
 * parent stays valid. Removing the root resets to a fresh emit.
 */
export function removeAt(root: NodeJson, path: string, taken: Set<string> = allIds(root)): NodeJson {
  const p = parentOf(path);
  if (!p) return leaf(PLACEHOLDER, taken);
  const parent = getAt(root, p.parent)!;
  if (parent.kind === "chain") {
    const steps = (parent.steps as NodeJson[]).filter((_, i) => i !== Number(p.edge));
    return updateAt(root, p.parent, steps.length === 1 ? steps[0]! : { ...parent, steps });
  }
  if (parent.kind === "gate" && p.edge !== "then") {
    return updateAt(root, p.parent, (g) => {
      const next = { ...g };
      if (p.edge === "otherwise") delete next.otherwise;
      else delete next.unsure;
      return next;
    });
  }
  if (parent.kind === "route" && p.edge === "lowConfidence") {
    return updateAt(root, p.parent, (r) => {
      const next = { ...r };
      delete next.lowConfidence;
      return next;
    });
  }
  if (parent.kind === "parallel" && Object.keys(parent.branches as object).length > 1) {
    return updateAt(root, p.parent, (par) => {
      const branches = { ...(par.branches as Record<string, NodeJson>) };
      delete branches[p.edge];
      return { ...par, branches };
    });
  }
  return updateAt(root, path, leaf(PLACEHOLDER, taken));
}

/**
 * `insertAfter`, plus where the new node ended up, so the UI can select it.
 */
export function insertAfterPath(root: NodeJson, path: string, node: NodeJson, taken: Set<string> = allIds(root)): { root: NodeJson; path: string } {
  const p = parentOf(path);
  if (p && getAt(root, p.parent)?.kind === "chain") return { root: insertAfter(root, path, node, taken), path: joinPath(p.parent, String(Number(p.edge) + 1)) };
  const target = getAt(root, path)!;
  if (target.kind === "chain") return { root: insertAfter(root, path, node, taken), path: joinPath(path, String((target.steps as unknown[]).length)) };
  return { root: insertAfter(root, path, node, taken), path: joinPath(path, "1") };
}

/** Number of nodes in the subtree at `node` (1 for a leaf). */
export function subtreeSize(node: NodeJson): number {
  return 1 + childEdges(node).reduce((n, c) => n + subtreeSize(c.node), 0);
}

/** A deep copy of `node` with fresh ids (`x` → `x-copy`, `x-copy-2`…). `$ref`s are kept, so copied steps stay bound. */
export function cloneWithFreshIds(node: NodeJson, taken: Set<string>): NodeJson {
  const rename = (id: string) => {
    let next = `${id}-copy`;
    for (let i = 2; taken.has(next); i++) next = `${id}-copy-${i}`;
    taken.add(next);
    return next;
  };
  const go = (n: NodeJson): NodeJson => {
    let out: NodeJson = { ...structuredClone(n), id: rename(n.id) };
    for (const c of childEdges(n)) out = withChild(out, c.edge, go(c.node));
    return out;
  };
  return go(node);
}

/**
 * Where a copy of the node at `path` can go as a sibling: the next slot in a
 * chain, or a new branch of a parallel. Routes (branches = labels), gates and
 * cascades have fixed slots, so there's nowhere for a sibling.
 */
export function canDuplicate(root: NodeJson, path: string): boolean {
  const p = parentOf(path);
  const parent = p ? getAt(root, p.parent) : undefined;
  return parent?.kind === "chain" || parent?.kind === "parallel";
}

export function duplicateAt(root: NodeJson, path: string, taken: Set<string> = allIds(root)): { root: NodeJson; path: string } | null {
  const p = parentOf(path);
  const parent = p ? getAt(root, p.parent) : undefined;
  const node = getAt(root, path);
  if (!p || !parent || !node) return null;
  const copy = cloneWithFreshIds(node, taken);
  if (parent.kind === "chain") return insertAfterPath(root, path, copy, taken);
  if (parent.kind === "parallel") {
    const branches = parent.branches as Record<string, NodeJson>;
    let key = `${p.edge}-copy`;
    for (let i = 2; key in branches; i++) key = `${p.edge}-copy-${i}`;
    const entries = Object.entries(branches);
    const at = entries.findIndex(([k]) => k === p.edge);
    entries.splice(at + 1, 0, [key, copy]);
    return { root: updateAt(root, p.parent, { ...parent, branches: Object.fromEntries(entries) }), path: joinPath(p.parent, key) };
  }
  return null;
}

/** Swap the node at `path` for a fresh template of another kind. */
export function replaceKind(root: NodeJson, path: string, kind: BuilderKind, taken: Set<string> = allIds(root)): NodeJson {
  return updateAt(root, path, template(kind, taken));
}

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export function newDocument(name = "untitled chain"): ChainDocument {
  const taken = new Set<string>();
  return { format: CHAIN_FORMAT, name, root: template("route", taken) as unknown as Json, refs: [] };
}

/** Recompute `refs` (step handlers etc.) after edits. */
export function withRoot(doc: ChainDocument, root: NodeJson): ChainDocument {
  const refs = new Set<string>();
  const scan = (v: unknown) => {
    if (!v || typeof v !== "object") return;
    if (typeof (v as { $ref?: unknown }).$ref === "string") refs.add((v as { $ref: string }).$ref);
    for (const x of Object.values(v)) scan(x);
  };
  scan(root);
  return { ...doc, root: root as unknown as Json, refs: [...refs].sort() };
}

/** Issues that would stop the document from loading/running, or [] if it's good. */
export function documentIssues(doc: ChainDocument): string[] {
  try {
    fromJSON(doc, { missingHandlers: "passthrough" });
    return [];
  } catch (e) {
    if (e instanceof ChainConfigError) return [...e.issues];
    return [e instanceof Error ? e.message : String(e)];
  }
}
