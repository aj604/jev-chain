/**
 * What each node actually receives as `input`, worked out from the document
 * alone, and the two ways that quietly surprises people:
 *
 *   - In a chain, each step's output is the next step's input. So a route
 *     added after an ask, with no `state`, asks Jev about the ask's answers
 *     object, not the message the run started with.
 *   - A template reading `{{input.message}}` after such a step comes up empty,
 *     because the answers (or the emit's text) have no `message`.
 *
 * Neither is an error (the chain loads and runs), so these are warnings with
 * a fix: read the run input instead (`{{run}}`, `{{run.message}}`), or say
 * you meant the step's output (`{{input}}`).
 *
 *   const input = inputAt(root, "$/1");   // { from: "node", node: { id: "ask-4", … }, shape: { type: "answers", … } }
 *   const warnings = flowWarnings(root);  // [{ path: "$/1", rule: "implicit-state", fixes: [...] }]
 *   const next = updateAt(root, warnings[0].path, warnings[0].fixes[0].node);
 *
 * `results.*` holes are jevchain's business (it knows what has finished);
 * this only reasons about `input.*`, which jevchain treats as opaque data.
 */
import { childEdges, getAt, parentOf, type BuilderKind, type NodeJson } from "./doc-ops";
import { labelsOf, type QuestionJson } from "./question-ops";

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
  /** The node at the warning's `path` with the fix applied. */
  node: NodeJson;
}

export interface FlowWarning {
  path: string;
  /** For a cascade tier. */
  tier?: string;
  rule: "implicit-state" | "missing-field";
  message: string;
  fixes: FlowFix[];
}

const JEV_KINDS = new Set(["ask", "route", "gate"]);

/** Every data-flow surprise in the document, in tree order. */
export function flowWarnings(root: NodeJson): FlowWarning[] {
  const out: FlowWarning[] = [];
  const go = (node: NodeJson, path: string, depth: number) => {
    if (depth > 300) return;
    out.push(...nodeWarnings(root, node, path));
    for (const c of childEdges(node)) go(c.node, `${path}/${c.edge}`, depth + 1);
  };
  go(root, "$", 0);
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
