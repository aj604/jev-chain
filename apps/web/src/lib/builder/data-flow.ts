/**
 * What each node actually receives as `input`, worked out from the document
 * alone, and the three ways that quietly surprises people:
 *
 *   - In a chain, each step's output is the next step's input. So a route
 *     added after an ask, with no `state`, asks Jev about the ask's answers
 *     object, not the message the run started with.
 *   - A template reading `{{input.message}}` after such a step comes up empty,
 *     because the answers (or the emit's text) have no `message`.
 *   - The other way round: when the next step doesn't read its input at all
 *     (its state is `{{run}}`, its emit has no `{{input…}}`), the step before
 *     it is thrown away. An ask's answers go nowhere; a gate in the middle of
 *     a chain decides nothing, because what follows runs the same either way.
 *
 * None is an error (the chain loads and runs), so these are warnings with
 * a fix: read the run input instead (`{{run}}`, `{{run.message}}`), say
 * you meant the step's output (`{{input}}`), or, for an output nobody reads,
 * put what follows under the gate or drop the step (same result, one less
 * jev call).
 *
 *   const input = inputAt(root, "$/1");   // { from: "node", node: { id: "ask-4", … }, shape: { type: "answers", … } }
 *   const warnings = flowWarnings(root);  // [{ path: "$/1", rule: "implicit-state", fixes: [...] }]
 *   const f = warnings[0].fixes[0];
 *   const next = updateAt(root, f.at ?? warnings[0].path, f.node);
 *
 * A fourth: a `{{results.<id>…}}` hole that can only come up empty, because
 * no node has that id (it was renamed or deleted) or that node can't have
 * finished by the time this one reads it (it encloses this node, comes
 * later, or sits on another branch of a route). jevchain doesn't check these
 * holes, so the fix offers the nodes that are sure to have run already.
 * Anything else (a node that may or may not have run) counts as read, and so
 * does an output code could read through `ctx.results`.
 */
import { allIds, childEdges, freshId, getAt, parentOf, removeAt, segments, type BuilderKind, type NodeJson } from "./doc-ops";
import { labelsOf, type QuestionJson } from "./question-ops";
import { canBeRead, mapTemplates, readsIn, renameInTemplate, type Read } from "./reads";

// ---------------------------------------------------------------------------
// Shapes: what a node outputs, as far as the document can tell
// ---------------------------------------------------------------------------

export type Shape =
  /** Code (a step, a custom join) or a pass-through template: could be anything. `says` reads "whatever its code returns". */
  | { type: "unknown"; says: string }
  /** An ask's answers, keyed like its questions. */
  | { type: "answers"; questions: Record<string, QuestionJson> }
  /** An emit's value. Strings are templates, so their text may vary, but they stay strings. */
  | { type: "value"; value: unknown }
  /** A parallel's collected outputs. */
  | { type: "object"; fields: Record<string, Shape> }
  /** A cascade's result: `{ resolvedBy, tier, answer }` or `{ resolvedBy: "fallback", output }`. */
  | { type: "cascade" }
  /** A route or gate: whichever branch ran. */
  | { type: "oneOf"; options: Shape[] };

export interface Producer {
  id: string;
  kind: BuilderKind;
  path: string;
  title?: string;
}

/** Where a node's input comes from: the run itself, or the chain step before it. */
export type Input = { from: "run" } | { from: "node"; node: Producer; shape: Shape };

const HOLE = /\{\{\s*([\w$.-]+)\s*\}\}/g;
const WHOLE = /^\{\{\s*([\w$.-]+)\s*\}\}$/;

const ANSWER_FIELDS: Record<string, string[]> = {
  choice: ["type", "choice", "probabilities", "confidence"],
  score: ["type", "score", "probabilities", "legend", "confidence"],
  noul: ["type", "noul"],
};
const CASCADE_FIELDS = ["resolvedBy", "tier", "answer", "output"];

const outputs = new WeakMap<object, Shape>();

/** What `node` outputs. */
export function outputOf(node: NodeJson): Shape {
  const hit = outputs.get(node);
  if (hit) return hit;
  const shape = computeOutput(node);
  outputs.set(node, shape);
  return shape;
}

function computeOutput(node: NodeJson): Shape {
  switch (node.kind) {
    case "ask":
      return { type: "answers", questions: isRecord(node.questions) ? (node.questions as Record<string, QuestionJson>) : {} };
    case "emit":
      return valueShape(node.value);
    case "parallel": {
      if (node.join !== undefined) return { type: "unknown", says: "whatever the join returns" };
      const fields: Record<string, Shape> = {};
      for (const c of childEdges(node)) fields[c.edge] = outputOf(c.node);
      return { type: "object", fields };
    }
    case "cascade":
      return { type: "cascade" };
    case "step":
      return { type: "unknown", says: "whatever its code returns" };
    case "route":
    case "gate":
      return oneOf(childEdges(node).map((c) => outputOf(c.node)));
    case "chain": {
      const steps = childEdges(node);
      return steps.length ? outputOf(steps[steps.length - 1]!.node) : { type: "unknown", says: "nothing yet (no steps)" };
    }
    default:
      return { type: "unknown", says: "something the builder can't read" };
  }
}

/** An emit value: templates that are a whole hole pass something through, so they're unknown. */
function valueShape(value: unknown): Shape {
  if (typeof value === "string" && WHOLE.test(value)) return { type: "unknown", says: `whatever ${value} holds` };
  return { type: "value", value };
}

function oneOf(options: Shape[]): Shape {
  if (options.length === 1) return options[0]!;
  if (!options.length) return { type: "unknown", says: "nothing yet (no branches)" };
  return { type: "oneOf", options };
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/**
 * What the node at `path` receives. Routes, gates, parallels and a cascade's
 * fallback hand their own input straight down; a chain hands step N the
 * output of step N-1.
 */
export function inputAt(root: NodeJson, path: string): Input {
  let at = path;
  for (let p = parentOf(at); p; p = parentOf(at)) {
    const parent = getAt(root, p.parent);
    if (parent?.kind === "chain" && Number(p.edge) > 0) {
      const prevPath = `${p.parent}/${Number(p.edge) - 1}`;
      const prev = getAt(root, prevPath);
      if (!prev) return { from: "run" };
      return { from: "node", node: producer(prev, prevPath), shape: outputOf(prev) };
    }
    at = p.parent;
  }
  return { from: "run" };
}

function producer(node: NodeJson, path: string): Producer {
  return { id: String(node.id), kind: node.kind, path, ...(typeof node.title === "string" && node.title ? { title: node.title } : {}) };
}

/**
 * Whether `input.<segs>` can hold something, given the input's shape: "no"
 * means it's empty on every path the document allows.
 */
export function canRead(shape: Shape, segs: string[]): "yes" | "no" | "maybe" {
  if (!segs.length) return "yes";
  const [head, ...rest] = segs as [string, ...string[]];
  switch (shape.type) {
    case "unknown":
      return "maybe";
    case "cascade":
      return CASCADE_FIELDS.includes(head) ? "maybe" : "no";
    case "object":
      return own(shape.fields, head) ? canRead(shape.fields[head]!, rest) : "no";
    case "answers": {
      if (!own(shape.questions, head)) return "no";
      const q = shape.questions[head];
      const fields = ANSWER_FIELDS[String(q?.type)];
      if (!fields || !rest.length) return fields ? "yes" : "maybe";
      const [field, ...deeper] = rest as [string, ...string[]];
      if (!fields.includes(field)) return "no";
      if (!deeper.length) return "yes";
      if (q!.type === "choice" && field === "probabilities") return deeper.length === 1 && labelsOf(q).includes(deeper[0]!) ? "yes" : "no";
      return "maybe";
    }
    case "value":
      return readValue(shape.value, segs);
    case "oneOf": {
      const all = shape.options.map((o) => canRead(o, segs));
      if (all.every((r) => r === "no")) return "no";
      return all.every((r) => r === "yes") ? "yes" : "maybe";
    }
  }
}

function readValue(value: unknown, segs: string[]): "yes" | "no" | "maybe" {
  if (!segs.length) return "yes";
  if (typeof value === "string") {
    if (WHOLE.test(value)) return "maybe";
    // strings do have a length and characters; nobody means those, but they aren't empty
    return segs[0] === "length" || /^\d+$/.test(segs[0]!) ? "maybe" : "no";
  }
  if (Array.isArray(value)) {
    const [head, ...rest] = segs as [string, ...string[]];
    if (head === "length") return rest.length ? "no" : "yes";
    return /^\d+$/.test(head) && Number(head) < value.length ? readValue(value[Number(head)], rest) : "no";
  }
  if (isRecord(value)) {
    const [head, ...rest] = segs as [string, ...string[]];
    return own(value, head) ? readValue(value[head], rest) : "no";
  }
  return "no";
}

// ---------------------------------------------------------------------------
// Describing an input, for the property panel
// ---------------------------------------------------------------------------

export function producerName(p: Producer): string {
  return p.title || p.id;
}

/** A one-line description of a shape: `answers: vibe, tone`, `"went left"`, `one of: …`. */
export function describeShape(shape: Shape, depth = 0): string {
  switch (shape.type) {
    case "unknown":
      return shape.says;
    case "answers": {
      const keys = Object.keys(shape.questions);
      return keys.length ? `answers: ${keys.join(", ")}` : "answers";
    }
    case "value":
      return clip(typeof shape.value === "string" ? `“${shape.value}”` : JSON.stringify(shape.value) ?? "null", 48);
    case "object":
      return `{ ${Object.keys(shape.fields).join(", ")} }`;
    case "cascade":
      return "{ resolvedBy, tier, answer } or { resolvedBy, output }";
    case "oneOf": {
      if (depth > 0) return "one of several";
      const parts = [...new Set(shape.options.map((o) => describeShape(o, depth + 1)))];
      return parts.length === 1 ? parts[0]! : `one of: ${clip(parts.join(" · "), 90)}`;
    }
  }
}

/** A few `input.…` paths worth knowing about for this shape (what a template can read). */
export function inputFields(shape: Shape, limit = 6): string[] {
  const out: string[] = [];
  const walk = (s: Shape, prefix: string, depth: number) => {
    if (out.length >= limit || depth > 3) return;
    switch (s.type) {
      case "answers":
        for (const [k, q] of Object.entries(s.questions)) {
          const main = q?.type === "choice" ? "choice" : q?.type === "score" ? "score" : q?.type === "noul" ? "noul" : null;
          if (main && out.length < limit) out.push(`${prefix}.${k}.${main}`);
        }
        break;
      case "object":
        for (const [k, f] of Object.entries(s.fields)) walk(f, `${prefix}.${k}`, depth + 1);
        break;
      case "cascade":
        out.push(`${prefix}.resolvedBy`, `${prefix}.answer`);
        break;
      case "value":
        if (isRecord(s.value)) for (const k of Object.keys(s.value)) if (out.length < limit) out.push(`${prefix}.${k}`);
        break;
      case "oneOf":
        for (const o of s.options) walk(o, prefix, depth + 1);
        break;
    }
  };
  walk(shape, "input", 0);
  return [...new Set(out)].slice(0, limit);
}

// ---------------------------------------------------------------------------
// Warnings
// ---------------------------------------------------------------------------

export interface FlowFix {
  label: string;
  /** The node at `at` (default: the warning's `path`) with the fix applied. */
  node: NodeJson;
  /** Where `node` goes when the fix reshapes more than the flagged node: the chain around it. */
  at?: string;
  /** What to select afterwards, when that isn't the warning's `path`. */
  select?: string;
}

export interface FlowWarning {
  path: string;
  /** For a cascade tier. */
  tier?: string;
  rule: "implicit-state" | "missing-field" | "unused-output" | "dead-read";
  message: string;
  fixes: FlowFix[];
}

const JEV_KINDS = new Set(["ask", "route", "gate"]);

/** Every data-flow surprise in the document, in tree order. */
export function flowWarnings(root: NodeJson): FlowWarning[] {
  const out: FlowWarning[] = [];
  const unused = new Map(unusedOutputs(root).map((w) => [w.path, w]));
  const where = idPaths(root);
  const go = (node: NodeJson, path: string, depth: number) => {
    if (depth > 300) return;
    const u = unused.get(path);
    if (u) out.push(u);
    out.push(...deadReads(root, node, path, where));
    out.push(...nodeWarnings(root, node, path));
    for (const c of childEdges(node)) go(c.node, `${path}/${c.edge}`, depth + 1);
  };
  go(root, "$", 0);
  return out;
}

// ---------------------------------------------------------------------------
// {{results.<id>}} reads that can only come up empty
// ---------------------------------------------------------------------------

/** Every node's path, by id (an id can be held by more than one node). */
export function idPaths(root: NodeJson): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const go = (n: NodeJson, path: string, depth: number) => {
    if (depth > 300) return;
    out.set(n.id, [...(out.get(n.id) ?? []), path]);
    for (const c of childEdges(n)) go(c.node, `${path}/${c.edge}`, depth + 1);
  };
  go(root, "$", 0);
  return out;
}

/**
 * Whether the node at `from` has finished (so `results` holds it) by the time
 * the node at `at` renders its templates, on the paths where `at` runs at all:
 * "never" (with why), "yes" (an earlier step of a chain `at` is in), or
 * "maybe" (inside an earlier step's branch, or a parallel branch racing it).
 */
export function finishedBefore(root: NodeJson, from: string, at: string): { when: "yes" | "maybe" } | { when: "never"; why: string } {
  const f = segments(from);
  const a = segments(at);
  let k = 0;
  while (k < f.length && k < a.length && f[k] === a[k]) k++;
  if (k === f.length) return { when: "never", why: k === a.length ? "it's this node: its result is only there once it's done" : "it encloses this node, so it isn't done yet" };
  if (k === a.length) return { when: "never", why: "it runs inside this node, after this is read" };
  const lca = k ? `$/${f.slice(0, k).join("/")}` : "$";
  const parent = getAt(root, lca);
  if (parent?.kind === "chain") {
    if (Number(f[k]) > Number(a[k])) return { when: "never", why: "it comes later in the chain" };
    return { when: k + 1 === f.length ? "yes" : "maybe" };
  }
  if (parent?.kind === "parallel") return { when: "maybe" };
  const name = parent ? `${parent.kind} “${parent.title || parent.id}”` : "its parent";
  return { when: "never", why: `it's on another branch of ${name}, and only one of those runs` };
}

/**
 * The nodes sure to have finished before `at` runs, nearest first: the
 * earlier steps of every chain it's in. Only ids a hole can name, and that
 * name just that one node.
 */
export function readableBefore(root: NodeJson, at: string, where: Map<string, string[]>): Producer[] {
  const out: Producer[] = [];
  let cur = at;
  for (let p = parentOf(cur); p; p = parentOf(cur)) {
    const parent = getAt(root, p.parent);
    if (parent?.kind === "chain") {
      const steps = parent.steps as NodeJson[];
      for (let i = Number(p.edge) - 1; i >= 0; i--) {
        const s = steps[i];
        if (s && canBeRead(s.id) && where.get(s.id)?.length === 1) out.push(producer(s, `${p.parent}/${i}`));
      }
    }
    cur = p.parent;
  }
  return out;
}

/** The warnings about one node's `{{results.<id>…}}` holes: one per template owner (the node, or each cascade tier). */
export function deadReads(root: NodeJson, node: NodeJson, path: string, where: Map<string, string[]> = idPaths(root)): FlowWarning[] {
  const reads = readsIn(node).filter((r) => r.root === "results");
  if (!reads.length) return [];
  const byTier = new Map<string | undefined, { read: Read; why: string }[]>();
  for (const read of reads) {
    const paths = where.get(read.id);
    let why: string | null;
    // `{{results.constructor}}` and friends hit the object's own prototype, which renders as something, not nothing
    if (!paths && read.id in Object.prototype) continue;
    if (!paths) why = `no node has the id “${read.id}”`;
    else {
      const verdicts = paths.map((p) => finishedBefore(root, p, path));
      why = verdicts.every((v) => v.when === "never") ? `“${read.id}” can't have run yet: ${(verdicts[0] as { why: string }).why}` : null;
    }
    if (why === null) continue;
    const list = byTier.get(read.tier) ?? [];
    if (!list.some((d) => d.read.hole === read.hole)) list.push({ read, why });
    byTier.set(read.tier, list);
  }
  const candidates = byTier.size ? readableBefore(root, path, where) : [];
  const out: FlowWarning[] = [];
  for (const [tier, dead] of byTier) {
    const holes = dead.map((d) => `{{${d.read.hole}}}`);
    const reasons = [...new Set(dead.map((d) => d.why))];
    const ids = [...new Set(dead.map((d) => d.read.id))];
    const fixes: FlowFix[] = [];
    // one missing id: offer the nodes it could have meant; several: the nearest for each
    for (const id of ids) {
      const only = new Set(dead.filter((d) => d.read.id === id).map((d) => d.read.hole));
      for (const c of candidates.filter((c) => c.id !== id).slice(0, ids.length === 1 ? 3 : 1)) {
        const map = new Map([[id, c.id]]);
        const fixed = mapTemplates(node, (text, t) => (t === tier ? renameInTemplate(text, map, only) : text));
        fixes.push({ label: ids.length === 1 ? `read ${c.kind} “${producerName(c)}”` : `read “${producerName(c)}” for “${id}”`, node: fixed });
      }
    }
    out.push({
      path,
      ...(tier !== undefined ? { tier } : {}),
      rule: "dead-read",
      message: `${holes.join(", ")} ${holes.length === 1 ? "is" : "are"} always empty here: ${reasons.join("; ")}`,
      fixes: fixes.slice(0, 3),
    });
  }
  return out;
}

/** The warnings about one node (and its cascade tiers). */
export function nodeWarnings(root: NodeJson, node: NodeJson, path: string): FlowWarning[] {
  if (!JEV_KINDS.has(node.kind) && node.kind !== "cascade" && node.kind !== "emit") return [];
  const input = inputAt(root, path);
  if (input.from !== "node") return [];
  const out: FlowWarning[] = [];
  const from = `${input.node.kind} “${producerName(input.node)}”`;
  const what = describeShape(input.shape);

  if (JEV_KINDS.has(node.kind)) {
    out.push(...stateWarnings(node.state, from, what, input.shape, (state) => withState(node, state), path));
  } else if (node.kind === "cascade" && Array.isArray(node.tiers)) {
    (node.tiers as unknown[]).forEach((t, i) => {
      if (!isRecord(t) || typeof t.id !== "string") return;
      const setTier = (state: string) => ({ ...node, tiers: (node.tiers as unknown[]).map((x, j) => (j === i ? withState(x as NodeJson, state) : x)) }) as NodeJson;
      for (const w of stateWarnings(t.state, from, what, input.shape, setTier, path)) out.push({ ...w, tier: t.id });
    });
  } else if (node.kind === "emit") {
    const misses = new Set<string>();
    stringsIn(node.value, (s) => missingHoles(s, input.shape).forEach((h) => misses.add(h)));
    if (misses.size) {
      const holes = [...misses];
      out.push({
        path,
        rule: "missing-field",
        message: `${holes.map((h) => `{{${h}}}`).join(", ")} ${holes.length === 1 ? "comes" : "come"} up empty: this emit's input is the output of ${from} (${what}), which has no ${holes.map((h) => h.slice("input.".length)).join(" or ")}`,
        fixes: [{ label: `read ${holes.length === 1 ? "it" : "them"} from the run input`, node: { ...node, value: mapStrings(node.value, (s) => toRun(s, misses)) as never } }],
      });
    }
  }
  return out;
}

function stateWarnings(state: unknown, from: string, what: string, shape: Shape, set: (state: string) => NodeJson, path: string): FlowWarning[] {
  if (state === undefined) {
    // code before a jev call is usually there to shape its state: that's the point, not a surprise
    if (shape.type === "unknown") return [];
    return [
      {
        path,
        rule: "implicit-state",
        message: `asks jev about the output of ${from} (${what}), not the run input. set state to say which you mean`,
        fixes: [
          { label: "ask about the run input", node: set("{{run}}") },
          { label: `ask about ${from.replace(/^\w+ /, "")}'s output`, node: set("{{input}}") },
        ],
      },
    ];
  }
  if (typeof state !== "string") return [];
  const holes = missingHoles(state, shape);
  if (!holes.length) return [];
  const misses = new Set(holes);
  return [
    {
      path,
      rule: "missing-field",
      message: `state ${holes.map((h) => `{{${h}}}`).join(", ")} ${holes.length === 1 ? "comes" : "come"} up empty: the input here is the output of ${from} (${what}), which has no ${holes.map((h) => h.slice("input.".length)).join(" or ")}`,
      fixes: [{ label: `read ${holes.length === 1 ? "it" : "them"} from the run input`, node: set(toRun(state, misses)) }],
    },
  ];
}

/** The `input.…` holes in a template that can't hold anything, given the input's shape. */
export function missingHoles(template: string, shape: Shape): string[] {
  const out: string[] = [];
  for (const m of template.matchAll(HOLE)) {
    const hole = m[1]!;
    const [head, ...segs] = hole.split(".");
    if (head !== "input" || !segs.length) continue;
    if (canRead(shape, segs) === "no" && !out.includes(hole)) out.push(hole);
  }
  return out;
}

/** `{{input.x}}` → `{{run.x}}` for the given holes. */
function toRun(template: string, holes: Set<string>): string {
  return template.replace(HOLE, (whole, hole: string) => (holes.has(hole) ? whole.replace(hole, `run${hole.slice("input".length)}`) : whole));
}

function withState(node: NodeJson, state: string): NodeJson {
  return { ...node, state };
}

// ---------------------------------------------------------------------------
// Outputs nothing reads
// ---------------------------------------------------------------------------

/** Kinds whose whole point is their output: a jev call's answers, a decision's branch, a parallel's collection. */
const PRODUCERS = new Set(["ask", "route", "gate", "cascade", "parallel"]);
const ASKS_JEV = new Set(["ask", "route", "gate", "cascade"]);

/**
 * Chain steps whose output the next step throws away, because it never reads
 * its input. Only flagged when removing the step would leave every run ending
 * exactly as it does now: everything in it is jev calls and emits (no code,
 * no gate that can halt), and nothing reads its result another way (a
 * `{{results.<id>}}` hole anywhere, or code that runs after it and might read
 * `ctx.results`). A step already inside a flagged one isn't flagged again.
 */
export function unusedOutputs(root: NodeJson): FlowWarning[] {
  const out: FlowWarning[] = [];
  const results = resultsReads(root);
  const go = (node: NodeJson, path: string, depth: number) => {
    if (depth > 300) return;
    const flagged = new Set<string>();
    if (node.kind === "chain" && Array.isArray(node.steps)) {
      const steps = node.steps as NodeJson[];
      steps.forEach((step, i) => {
        const next = steps[i + 1];
        const at = `${path}/${i}`;
        if (!next || !isRecord(step) || !PRODUCERS.has(step.kind) || readsInput(next)) return;
        if (!settles(step) || !someNode(step, (n) => ASKS_JEV.has(n.kind))) return;
        if (results === "all" || [...allIds(step)].some((id) => results.has(id))) return;
        if (codeAfter(root, at)) return;
        flagged.add(at);
        out.push(unusedWarning(root, path, node, i, results.has(String(node.id))));
      });
    }
    for (const c of childEdges(node)) {
      const at = `${path}/${c.edge}`;
      if (!flagged.has(at)) go(c.node, at, depth + 1);
    }
  };
  go(root, "$", 0);
  return out;
}

/** Whether `node` looks at the input it's handed: a `{{input…}}` hole, a jev call with no state, or code. */
export function readsInput(node: NodeJson, depth = 0): boolean {
  if (depth > 300 || !isRecord(node)) return true;
  const children = () => childEdges(node).some((c) => readsInput(c.node, depth + 1));
  switch (node.kind) {
    case "emit": {
      let hit = false;
      stringsIn(node.value, (s) => {
        if (readsInputHole(s)) hit = true;
      });
      return hit;
    }
    case "ask":
      return stateReads(node.state);
    // a route's or gate's branches get the same input it did
    case "route":
    case "gate":
      return stateReads(node.state) || children();
    case "cascade":
      return !Array.isArray(node.tiers) || (node.tiers as unknown[]).some((t) => !isRecord(t) || stateReads(t.state)) || children();
    case "parallel":
      return node.join !== undefined || children();
    case "chain": {
      const first = childEdges(node)[0];
      return first ? readsInput(first.node, depth + 1) : true;
    }
    default:
      return true; // a step is code
  }
}

function stateReads(state: unknown): boolean {
  return typeof state !== "string" || readsInputHole(state);
}

function readsInputHole(template: string): boolean {
  return [...template.matchAll(HOLE)].some((m) => m[1]!.split(".")[0] === "input");
}

function someNode(node: NodeJson, test: (n: NodeJson) => boolean, depth = 0): boolean {
  if (depth > 300) return true;
  return test(node) || childEdges(node).some((c) => someNode(c.node, test, depth + 1));
}

/** Runs to a value and nothing else: no code to have side effects, no gate that could halt the run. */
function settles(node: NodeJson): boolean {
  if (hasRef(node)) return false;
  return !someNode(node, (n) => !KNOWN.has(n.kind) || n.kind === "step" || (n.kind === "gate" && n.otherwise === undefined));
}

const KNOWN = new Set(["ask", "route", "gate", "parallel", "cascade", "step", "emit", "chain"]);

function hasCode(node: NodeJson): boolean {
  return hasRef(node) || someNode(node, (n) => n.kind === "step" || !KNOWN.has(n.kind));
}

function hasRef(v: unknown, depth = 0): boolean {
  if (depth > 300) return true;
  if (Array.isArray(v)) return v.some((x) => hasRef(x, depth + 1));
  if (!isRecord(v)) return false;
  if (typeof v.$ref === "string") return true;
  return Object.values(v).some((x) => hasRef(x, depth + 1));
}

/**
 * Ids some template reads through `{{results.<id>…}}`, or "all" for a bare `{{results}}`.
 * `{{answers.<id>…}}` counts the same, for forward compatibility with jevchain's
 * coming `answers` root; on this jevchain it renders empty, so it can only mean fewer flags.
 */
function resultsReads(root: NodeJson): Set<string> | "all" {
  const ids = new Set<string>();
  let all = false;
  stringsIn(root, (s) => {
    for (const m of s.matchAll(HOLE)) {
      const [head, id] = m[1]!.split(".");
      if (head !== "results" && head !== "answers") continue;
      if (id === undefined) all = true;
      else ids.add(id);
    }
  });
  return all ? "all" : ids;
}

/** Whether code could run after the node at `path` (and so read its result off `ctx.results`). */
function codeAfter(root: NodeJson, path: string): boolean {
  let at = path;
  for (let p = parentOf(at); p; p = parentOf(at)) {
    const parent = getAt(root, p.parent);
    if (!parent) return true;
    if (parent.kind === "chain" && (parent.steps as NodeJson[]).slice(Number(p.edge) + 1).some(hasCode)) return true;
    if (parent.kind === "parallel" && (parent.join !== undefined || childEdges(parent).some((c) => c.edge !== p.edge && hasCode(c.node)))) return true;
    at = p.parent;
  }
  return false;
}

/** `keepChain`: the chain's own id is read through `{{results.<id>}}`, so no fix may collapse the chain away. */
function unusedWarning(root: NodeJson, chainPath: string, chain: NodeJson, i: number, keepChain: boolean): FlowWarning {
  const steps = chain.steps as NodeJson[];
  const step = steps[i]!;
  const next = steps[i + 1]!;
  const path = `${chainPath}/${i}`;
  const nextName = `${next.kind} “${producerName(producer(next, ""))}”`;
  const how = typeof next.state === "string" && JEV_KINDS.has(next.kind) ? ` (its state is “${clip(next.state, 32)}”)` : "";
  const because = `the next step, ${nextName}, never reads its input${how}`;
  const message =
    step.kind === "ask"
      ? `nothing reads these answers: ${because}. every run ends the same without this ask`
      : step.kind === "parallel"
        ? `nothing reads what this parallel collects: ${because}. every run ends the same without it`
        : `this ${step.kind} decides nothing: ${because}, so the rest of the chain runs the same whichever way it goes`;

  // a two-step chain collapses into its remaining step, unless its id is read
  const collapses = steps.length === 2 && !keepChain;
  const removed = collapses ? getAt(removeAt(root, path), chainPath)! : { ...chain, steps: steps.filter((_, j) => j !== i) };
  const fixes: FlowFix[] = [];
  if (step.kind === "gate") fixes.push(guardRest(root, chainPath, chain, i, keepChain));
  fixes.push({ label: `remove this ${step.kind}`, node: removed, at: chainPath, select: collapses ? chainPath : path });
  return { path, rule: "unused-output", message, fixes };
}

/**
 * A gate in the middle of a chain, reshaped to gate what follows it: the
 * rest of the chain becomes its `then`, so it only runs when the gate
 * passes. The old `then` stays in front unless it's an emit (whose value
 * the rest never read anyway).
 */
function guardRest(root: NodeJson, chainPath: string, chain: NodeJson, i: number, keepChain: boolean): FlowFix {
  const steps = chain.steps as NodeJson[];
  const gate = steps[i]!;
  const then = gate.then as NodeJson | undefined;
  const keep = !then || then.kind === "emit" ? [] : then.kind === "chain" ? (then.steps as NodeJson[]) : [then];
  const body = [...keep, ...steps.slice(i + 1)];
  const nextThen: NodeJson = body.length === 1 ? body[0]! : { kind: "chain", id: freshId("chain", allIds(root)), steps: body };
  const guarded = { ...gate, then: nextThen };
  const before = steps.slice(0, i);
  const wrap = before.length > 0 || keepChain;
  return {
    label: "run the rest only if it passes",
    node: wrap ? { ...chain, steps: [...before, guarded] } : guarded,
    at: chainPath,
    select: wrap ? `${chainPath}/${i}` : chainPath,
  };
}

function stringsIn(value: unknown, visit: (s: string) => void, depth = 0) {
  if (depth > 300) return;
  if (typeof value === "string") visit(value);
  else if (Array.isArray(value)) for (const v of value) stringsIn(v, visit, depth + 1);
  else if (isRecord(value)) for (const v of Object.values(value)) stringsIn(v, visit, depth + 1);
}

function mapStrings(value: unknown, fn: (s: string) => string): unknown {
  if (typeof value === "string") return fn(value);
  if (Array.isArray(value)) return value.map((v) => mapStrings(v, fn));
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapStrings(v, fn)]));
  return value;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === "object" && !Array.isArray(v);
}

function own(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function clip(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}
