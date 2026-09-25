/**
 * `{{results.<id>…}}` holes: a template reading another node's output by its
 * id. jevchain renders them against `results`, which only holds a node once
 * it has finished, so a hole naming an id that's gone (renamed, deleted) or
 * that can't have run yet quietly renders empty.
 *
 * This module is the per-node half: which strings on a node jevchain renders
 * as templates, which ids they read, and rewriting those ids. `doc-ops` walks
 * a whole tree with it (renames and copies keep their reads pointed at the
 * node they meant); `data-flow` flags the reads that can only come up empty.
 *
 *   readsIn(node)                          // [{ hole: "results.triage.urgency.choice", id: "triage", tier: undefined }]
 *   withReadsRenamed(node, new Map([["triage", "urgency"]]))
 */
import type { NodeJson } from "./doc-ops";

const HOLE = /\{\{\s*([\w$.-]+)\s*\}\}/g;

/** Ids a hole can name: `{{results.<id>}}` splits its path on dots, and the hole itself only allows `[\w$.-]`. */
const READABLE = /^[\w$-]+$/;

/** Whether `{{results.<id>}}` can name this id at all. */
export function canBeRead(id: string): boolean {
  return READABLE.test(id);
}

/**
 * The roots whose next segment is a node id. `answers` isn't on this jevchain
 * yet (it renders empty here); it's kept in step with `results` so renames
 * and copies carry it too, matching how `unusedOutputs` counts it as a read.
 */
const ID_ROOTS = new Set(["results", "answers"]);

export interface Read {
  /** The whole hole path, e.g. `results.triage.urgency.choice`. */
  hole: string;
  root: "results" | "answers";
  id: string;
  /** Set when the hole is in a cascade tier's state. */
  tier?: string;
}

/**
 * Every template string jevchain renders on this node itself (not its
 * children), with the cascade tier it belongs to: `state`, each tier's
 * `state`, and every string in an emit's `value`. Question text isn't a
 * template, so it isn't here.
 */
export function templatesOf(node: NodeJson): { text: string; tier?: string }[] {
  const out: { text: string; tier?: string }[] = [];
  if (typeof node.state === "string") out.push({ text: node.state });
  if (node.kind === "cascade" && Array.isArray(node.tiers)) {
    for (const t of node.tiers as unknown[]) {
      if (isRecord(t) && typeof t.state === "string") out.push({ text: t.state, ...(typeof t.id === "string" ? { tier: t.id } : {}) });
    }
  }
  if (node.kind === "emit") strings(node.value, (text) => out.push({ text }));
  return out;
}

/** The `{{results.<id>…}}` (and `{{answers.<id>…}}`) holes on this node. A bare `{{results}}` names no id and isn't here. */
export function readsIn(node: NodeJson): Read[] {
  const out: Read[] = [];
  for (const { text, tier } of templatesOf(node)) {
    for (const m of text.matchAll(HOLE)) {
      const hole = m[1]!;
      const [root, id] = hole.split(".");
      if (!ID_ROOTS.has(root!) || !id) continue;
      out.push({ hole, root: root as Read["root"], id, ...(tier !== undefined ? { tier } : {}) });
    }
  }
  return out;
}

/**
 * `node` with its templates mapped through `fn` (given the tier, for a tier's
 * state). Returns the same object when nothing changed.
 */
export function mapTemplates(node: NodeJson, fn: (text: string, tier?: string) => string): NodeJson {
  let out = node;
  if (typeof node.state === "string") {
    const next = fn(node.state);
    if (next !== node.state) out = { ...out, state: next };
  }
  if (node.kind === "cascade" && Array.isArray(node.tiers)) {
    let changed = false;
    const tiers = (node.tiers as unknown[]).map((t) => {
      if (!isRecord(t) || typeof t.state !== "string") return t;
      const next = fn(t.state, typeof t.id === "string" ? t.id : undefined);
      if (next === t.state) return t;
      changed = true;
      return { ...t, state: next };
    });
    if (changed) out = { ...out, tiers };
  }
  if (node.kind === "emit") {
    const value = mapStrings(node.value, (s) => fn(s));
    if (value !== node.value) out = { ...out, value };
  }
  return out;
}

/** Rewrite the id in each `{{results.<id>…}}` hole of one template, for the ids in `map`. `only` limits it to those holes. */
export function renameInTemplate(text: string, map: ReadonlyMap<string, string>, only?: ReadonlySet<string>): string {
  return text.replace(HOLE, (whole, hole: string) => {
    const [root, id, ...rest] = hole.split(".");
    if (!ID_ROOTS.has(root!) || id === undefined || !map.has(id) || (only && !only.has(hole))) return whole;
    // a function, so a `$` in the new id isn't read as a replacement pattern
    return whole.replace(hole, () => [root, map.get(id)!, ...rest].join("."));
  });
}

/** `node`'s own templates with the ids in `map` rewritten (old → new). Same object when nothing reads them. */
export function withReadsRenamed(node: NodeJson, map: ReadonlyMap<string, string>): NodeJson {
  if (!map.size) return node;
  return mapTemplates(node, (text) => renameInTemplate(text, map));
}

function strings(value: unknown, visit: (s: string) => void, depth = 0) {
  if (depth > 300) return;
  if (typeof value === "string") visit(value);
  else if (Array.isArray(value)) for (const v of value) strings(v, visit, depth + 1);
  else if (isRecord(value)) for (const v of Object.values(value)) strings(v, visit, depth + 1);
}

/** Like a deep map over strings, but keeps every untouched object as is. */
function mapStrings(value: unknown, fn: (s: string) => string, depth = 0): unknown {
  if (depth > 300) return value;
  if (typeof value === "string") return fn(value);
  if (Array.isArray(value)) {
    const next = value.map((v) => mapStrings(v, fn, depth + 1));
    return next.some((v, i) => v !== value[i]) ? next : value;
  }
  if (isRecord(value)) {
    const entries = Object.entries(value);
    const next = entries.map(([k, v]) => [k, mapStrings(v, fn, depth + 1)] as const);
    return next.some(([, v], i) => v !== entries[i]![1]) ? Object.fromEntries(next) : value;
  }
  return value;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}
