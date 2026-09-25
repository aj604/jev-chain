/**
 * Chains <-> JSON.
 *
 * Since nodes are already plain objects, serializing is mostly the identity.
 * The only wrinkle is code: `step` functions, function-valued `state`, and
 * `parallel` joins become `{ "$ref": "name" }` and are re-attached from a
 * `handlers` map on load. Everything else, questions and thresholds and
 * templates included, round-trips exactly.
 */
import { ChainConfigError } from "./errors";
import { walk, type AnyJevNode, type AnyNode, type JevNode } from "./nodes";
import type { Json } from "./questions";
import { chainIssues } from "./validate";

export const CHAIN_FORMAT = "jevchain/v1";

export interface Ref {
  $ref: string;
}

/** A serialized chain. This is the format the web app and the library share. */
export interface ChainDocument {
  format: typeof CHAIN_FORMAT;
  name?: string;
  description?: string;
  /** Example inputs, for UIs and docs. */
  examples?: Json[];
  root: Json;
  /** Handler names the document needs at load time. */
  refs: string[];
}

export type Handler = (...args: any[]) => unknown;

export interface FromJsonOptions {
  /** Functions for every `$ref` in the document, keyed by name. */
  handlers?: Record<string, Handler>;
  /**
   * What to do when a step's handler is missing.
   * - "throw" (default): fail with a ChainConfigError listing them
   * - "passthrough": the step returns its input unchanged and logs a note (handy for previews)
   */
  missingHandlers?: "throw" | "passthrough";
}

/** Serialize a chain. Functions become `$ref`s named after their node. */
export function toJSON(root: AnyNode, meta: { name?: string; description?: string; examples?: Json[] } = {}): ChainDocument {
  const refs = new Set<string>();
  const ref = (name: string): Ref => {
    refs.add(name);
    return { $ref: name };
  };
  const encode = (node: AnyNode): Json => {
    const n = node as AnyJevNode;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(n)) {
      if (v === undefined) continue;
      out[k] = v;
    }
    if ("state" in n && typeof n.state === "function") out.state = ref(`${n.id}.state`);
    switch (n.kind) {
      case "step":
        out.run = ref(n.ref ?? n.id);
        break;
      case "parallel":
        out.branches = mapValues(n.branches, encode);
        if (n.join) out.join = ref(`${n.id}.join`);
        break;
      case "route":
        out.branches = mapValues(n.branches, encode);
        if (n.lowConfidence) out.lowConfidence = { below: n.lowConfidence.below, then: encode(n.lowConfidence.then) };
        break;
      case "gate":
        out.then = encode(n.then);
        if (n.otherwise) out.otherwise = encode(n.otherwise);
        if (n.unsure) out.unsure = { ...n.unsure, then: encode(n.unsure.then) };
        break;
      case "cascade":
        out.tiers = n.tiers.map((t) => (typeof t.state === "function" ? { ...t, state: ref(`${n.id}.${t.id}.state`) } : t));
        out.fallback = encode(n.fallback);
        break;
      case "chain":
        out.steps = n.steps.map(encode);
        break;
    }
    return out as Json;
  };
  const root_ = encode(root);
  return {
    format: CHAIN_FORMAT,
    ...(meta.name ? { name: meta.name } : {}),
    ...(meta.description ? { description: meta.description } : {}),
    ...(meta.examples ? { examples: meta.examples } : {}),
    root: root_,
    refs: [...refs].sort(),
  };
}

/** Load a chain from its JSON document (or a JSON string). */
export function fromJSON<I = unknown, O = unknown>(doc: ChainDocument | string, options: FromJsonOptions = {}): JevNode<I, O> {
  const parsed: unknown = typeof doc === "string" ? JSON.parse(doc) : doc;
  if (!parsed || typeof parsed !== "object") throw new ChainConfigError("Expected a chain document object");
  const d = parsed as Partial<ChainDocument>;
  if (d.format !== CHAIN_FORMAT) throw new ChainConfigError(`Unsupported format ${JSON.stringify(d.format)}; expected "${CHAIN_FORMAT}"`);
  if (!d.root || typeof d.root !== "object") throw new ChainConfigError("Document has no root node");

  const handlers = options.handlers ?? {};
  const missing = new Set<string>();
  const resolve = (value: unknown, stepFallback?: Handler): unknown => {
    if (!isRef(value)) return value;
    const fn = handlers[value.$ref];
    if (fn) return fn;
    if (stepFallback && options.missingHandlers === "passthrough") return stepFallback;
    missing.add(value.$ref);
    return undefined;
  };

  const decode = (raw: unknown): AnyNode => {
    const n = { ...(raw as Record<string, unknown>) };
    if (n.state !== undefined) n.state = resolve(n.state);
    switch (n.kind) {
      case "step": {
        const name = isRef(n.run) ? n.run.$ref : String(n.id);
        n.run = resolve(n.run ?? { $ref: name }, (input: unknown, ctx: { log: (m: string) => void }) => {
          ctx.log(`no handler bound for "${name}", passed input through`);
          return input;
        });
        break;
      }
      case "parallel":
        n.branches = mapValues(n.branches as Record<string, unknown>, decode);
        if (n.join !== undefined) n.join = resolve(n.join);
        break;
      case "route":
        n.branches = mapValues(n.branches as Record<string, unknown>, decode);
        if (n.lowConfidence) {
          const lc = n.lowConfidence as { below: number; then: unknown };
          n.lowConfidence = { below: lc.below, then: decode(lc.then) };
        }
        break;
      case "gate":
        n.then = decode(n.then);
        if (n.otherwise) n.otherwise = decode(n.otherwise);
        if (n.unsure) {
          const u = n.unsure as Record<string, unknown>;
          n.unsure = { ...u, then: decode(u.then) };
        }
        break;
      case "cascade":
        n.tiers = ((n.tiers as Record<string, unknown>[]) ?? []).map((t) => (t.state !== undefined ? { ...t, state: resolve(t.state) } : t));
        n.fallback = decode(n.fallback);
        break;
      case "chain":
        n.steps = ((n.steps as unknown[]) ?? []).map(decode);
        break;
    }
    return n as unknown as AnyNode;
  };

  const root = decode(d.root);
  if (missing.size) {
    throw new ChainConfigError([...missing].sort().map((m) => `missing handler "${m}" (pass it in options.handlers)`));
  }
  const issues = chainIssues(root);
  if (issues.length) throw new ChainConfigError(issues);
  return root as JevNode<I, O>;
}

/**
 * Every function in a chain, keyed by the `$ref` name `toJSON` gives it.
 * `fromJSON(toJSON(c), { handlers: handlersOf(c) })` rebuilds a working chain,
 * which is how an editor can modify a coded chain's structure and keep its code.
 */
export function handlersOf(root: AnyNode): Record<string, Handler> {
  const out: Record<string, Handler> = {};
  walk(root, (node) => {
    const n = node as AnyJevNode;
    if ("state" in n && typeof n.state === "function") out[`${n.id}.state`] = n.state;
    if (n.kind === "step") out[n.ref ?? n.id] = n.run;
    if (n.kind === "parallel" && n.join) out[`${n.id}.join`] = n.join;
    if (n.kind === "cascade") for (const t of n.tiers) if (typeof t.state === "function") out[`${n.id}.${t.id}.state`] = t.state;
  });
  return out;
}

function isRef(v: unknown): v is Ref {
  return !!v && typeof v === "object" && typeof (v as Ref).$ref === "string";
}

function mapValues<T, U>(obj: Readonly<Record<string, T>>, fn: (v: T) => U): Record<string, U> {
  return Object.fromEntries(Object.entries(obj ?? {}).map(([k, v]) => [k, fn(v)]));
}
