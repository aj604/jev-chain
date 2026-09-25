/**
 * Editing the working document as JSON text, and bringing it back onto the
 * canvas. The code drawer's json tab is a text box over this:
 *
 *   const text = formatDocument(doc);
 *   const r = readDocumentEdit(editedText, doc);
 *   if (r.ok && r.changed) builder.commit(r.doc);   // one undo step
 *
 * Two levels of wrong, kept apart on purpose:
 *  - `ok: false`: not JSON, not a `jevchain/v1` document, or not the types
 *    jevchain declares (a route without `branches`, a threshold that isn't a
 *    number, a node without a known `kind`...; see `shapeIssues`). The
 *    builder trusts those types, so applying it would break the canvas; it's
 *    refused, with where the problem is.
 *  - `ok: true` with `issues`: a document the builder can show and fix, but
 *    that won't run yet (a branch missing for a label, a bad threshold). The
 *    same broken links the checks strip shows; applying is allowed.
 */
import type { ChainDocument } from "jevchain";
import { CHAIN_FORMAT } from "jevchain";
import { documentIssues, subtreeSize, withRoot, type BuilderKind, type NodeJson } from "./doc-ops";

export type JsonEdit =
  | {
      ok: false;
      /** What's wrong, e.g. `$/billing: a route needs "branches"`, or a JSON syntax error. */
      error: string;
      /** For a syntax error: where, 1-based, and the character offset (to put the caret there). */
      line?: number;
      column?: number;
      offset?: number;
    }
  | {
      ok: true;
      /** The edited document, with `refs` recomputed. */
      doc: ChainDocument;
      /** False when the text means the same document as `current`. */
      changed: boolean;
      /** Why it won't run yet ([] if it will). */
      issues: string[];
      /** Node counts, for "12 → 13 nodes". */
      nodes: { before: number; after: number };
    };

/** The text the json tab starts from: what `toJSON()` gives you, pretty-printed. */
export function formatDocument(doc: ChainDocument): string {
  return JSON.stringify(doc, null, 2);
}

const KINDS = new Set<BuilderKind>(["ask", "route", "gate", "parallel", "cascade", "step", "emit", "chain"]);
const QUESTION_TYPES = new Set(["choice", "score", "noul"]);

/** Deeper than this and it's refused before anything walks it (recursion would overflow the stack). */
export const MAX_DEPTH = 256;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
/** jevchain's `Entry`: text, a JSON object, a JSON array, or null. */
const isEntry = (v: unknown) => v === null || typeof v === "string" || typeof v === "object";
const isRef = (v: unknown) => isObject(v) && typeof v.$ref === "string";

/**
 * Where `doc` doesn't match the types jevchain declares for a chain document,
 * each prefixed with the node's path. The canvas, the property editor and the
 * structural edits trust those types without re-checking (they call
 * `.toFixed` on thresholds, walk `criteria`, render titles as text), so a
 * document that doesn't fit them can't go on the canvas.
 *
 * It checks types, not meaning: every field that must be there is there,
 * and every field that is there has its declared type (a number, a string,
 * a question, a node...). Whether a number is in range, or a branch exists
 * for every label, is `documentIssues`' job, and the builder can hold a
 * document that fails it.
 */
export function shapeIssues(node: unknown, path = "$"): string[] {
  if (!isObject(node)) return [`${path}: expected a node object, got ${describe(node)}`];
  const kind = node.kind as BuilderKind;
  if (typeof node.kind !== "string" || !KINDS.has(kind)) return [`${path}: unknown kind ${JSON.stringify(node.kind)} (one of ${[...KINDS].join(", ")})`];
  const out: string[] = [];
  const at = `${path} (${kind}${typeof node.id === "string" ? ` "${node.id}"` : ""})`;
  const bad = (where: string, want: string) => out.push(`${at}: ${where} must be ${want}`);

  // field checks on any object, by name
  const need = (o: Record<string, unknown>, key: string, where: string, ok: (v: unknown) => boolean, want: string, optional = false) => {
    if (o[key] === undefined) {
      if (!optional) out.push(`${at}: needs ${where}, ${want}`);
    } else if (!ok(o[key])) bad(where, want);
  };
  const str = (v: unknown) => typeof v === "string";
  const num = (v: unknown) => typeof v === "number";

  const question = (q: unknown, where: string) => {
    if (!isObject(q)) return bad(where, "a question object");
    if (typeof q.type !== "string" || !QUESTION_TYPES.has(q.type)) return bad(`${where}.type`, `"choice", "score" or "noul"`);
    need(q, "instructions", `${where}.instructions`, isEntry, "text, an object, a list or null", true);
    const c = q.criteria;
    if (q.type === "choice") {
      if (!isObject(c)) bad(`${where}.criteria`, "an object of labels");
      else for (const [label, v] of Object.entries(c)) if (!isEntry(v)) bad(`${where}.criteria.${label}`, "text, an object, a list or null");
    } else if (q.type === "score") {
      if (!Array.isArray(c)) bad(`${where}.criteria`, "a list of levels");
      else c.forEach((v: unknown, i) => isEntry(v) || bad(`${where}.criteria.${i}`, "text, an object, a list or null"));
    } else if (c !== undefined) {
      if (!isObject(c)) bad(`${where}.criteria`, `an object with "true" / "false"`);
      else for (const side of ["true", "false"]) need(c, side, `${where}.criteria.${side}`, isEntry, "text, an object, a list or null", true);
    }
  };
  const questions = (qs: unknown, where: string, optional: boolean) => {
    if (qs === undefined && optional) return;
    if (!isObject(qs)) return bad(where, "an object of questions");
    for (const [k, q] of Object.entries(qs)) question(q, `${where}.${k}`);
  };
  /** JevCallConfig: `state` (a template or a handler ref) and `model`. */
  const call = (o: Record<string, unknown>, where: string) => {
    need(o, "state", `${where}state`, (v) => str(v) || isRef(v), `a template string or {"$ref": name}`, true);
    need(o, "model", `${where}model`, str, "a string", true);
  };
  const child = (c: unknown, edge: string) => out.push(...(c === undefined ? [`${at}: needs "${edge}", a node`] : shapeIssues(c, `${path}/${edge}`)));
  const branches = (b: unknown) => {
    if (!isObject(b)) return void out.push(`${at}: needs "branches", an object of nodes`);
    for (const [key, c] of Object.entries(b)) {
      if (!key || key.includes("/")) out.push(`${at}: branch name ${JSON.stringify(key)} can't be empty or contain "/"`);
      else child(c, key);
    }
  };
  /** `lowConfidence` / `unsure`: an object with numeric settings and a `then` node. */
  const wrapped = (w: unknown, field: string, nums: [string, boolean][]) => {
    if (w === undefined) return;
    if (!isObject(w)) return bad(`"${field}"`, `an object with "then"`);
    for (const [key, optional] of nums) need(w, key, `${field}.${key}`, num, "a number", optional);
    child(w.then, field);
  };

  need(node, "id", `"id"`, str, "a string");
  need(node, "title", `"title"`, str, "a string", true);
  need(node, "description", `"description"`, str, "a string", true);

  switch (kind) {
    case "ask":
      call(node, "");
      questions(node.questions, "questions", false);
      break;
    case "route":
      call(node, "");
      question(node.ask, "ask");
      questions(node.alsoAsk, "alsoAsk", true);
      branches(node.branches);
      wrapped(node.lowConfidence, "lowConfidence", [["below", false]]);
      break;
    case "gate":
      call(node, "");
      question(node.ask, "ask");
      questions(node.alsoAsk, "alsoAsk", true);
      if (!isObject(node.pass)) bad(`"pass"`, `an object like {"min": 0.7}`);
      else {
        need(node.pass, "label", "pass.label", str, "a string", true);
        need(node.pass, "min", "pass.min", num, "a number", true);
        need(node.pass, "max", "pass.max", num, "a number", true);
      }
      child(node.then, "then");
      if (node.otherwise !== undefined) child(node.otherwise, "otherwise");
      wrapped(node.unsure, "unsure", [
        ["margin", true],
        ["minConfidence", true],
      ]);
      break;
    case "parallel":
      branches(node.branches);
      need(node, "join", `"join"`, isRef, `{"$ref": name}`, true);
      break;
    case "cascade":
      if (!Array.isArray(node.tiers)) out.push(`${at}: needs "tiers", a list`);
      else
        node.tiers.forEach((t: unknown, i) => {
          const where = `tiers.${i}`;
          if (!isObject(t)) return bad(where, "an object");
          need(t, "id", `${where}.id`, str, "a string");
          need(t, "title", `${where}.title`, str, "a string", true);
          question(t.ask, `${where}.ask`);
          need(t, "minConfidence", `${where}.minConfidence`, num, "a number");
          call(t, `${where}.`);
        });
      child(node.fallback, "fallback");
      break;
    case "step":
      need(node, "run", `"run"`, isRef, `{"$ref": name}`, true);
      need(node, "ref", `"ref"`, str, "a string", true);
      need(node, "timeoutMs", `"timeoutMs"`, num, "a number", true);
      need(node, "retries", `"retries"`, num, "a number", true);
      break;
    case "emit":
      if (!("value" in node)) out.push(`${at}: needs "value"`);
      break;
    case "chain":
      if (!Array.isArray(node.steps) || node.steps.length === 0) out.push(`${at}: needs "steps", a non-empty list`);
      else node.steps.forEach((s: unknown, i) => child(s, String(i)));
      break;
  }
  return out;
}

/** How deeply `value` nests, walked without recursion; stops counting past `limit`. */
function depthOf(value: unknown, limit: number): number {
  let max = 0;
  const stack: [unknown, number][] = [[value, 1]];
  while (stack.length) {
    const [v, d] = stack.pop()!;
    if (!v || typeof v !== "object") continue;
    if (d > max) max = d;
    if (max > limit) return max;
    for (const x of Object.values(v)) stack.push([x, d + 1]);
  }
  return max;
}

/** Read the json tab's text back into a document, or say why it can't be. */
export function readDocumentEdit(text: string, current: ChainDocument): JsonEdit {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return syntaxError(text, e);
  }
  if (depthOf(parsed, MAX_DEPTH) > MAX_DEPTH) return { ok: false, error: `nested more than ${MAX_DEPTH} levels deep` };
  if (!isObject(parsed)) return { ok: false, error: `expected a chain document object, got ${describe(parsed)}` };
  if (parsed.format !== CHAIN_FORMAT) return { ok: false, error: `"format" must be "${CHAIN_FORMAT}"` };
  for (const field of ["name", "description"] as const)
    if (parsed[field] !== undefined && typeof parsed[field] !== "string") return { ok: false, error: `"${field}" must be a string` };
  if (parsed.examples !== undefined && !Array.isArray(parsed.examples)) return { ok: false, error: `"examples" must be a list of sample inputs` };
  if (parsed.root === undefined) return { ok: false, error: `the document needs a "root" node` };
  const shape = shapeIssues(parsed.root);
  if (shape.length) return { ok: false, error: shape.length === 1 ? shape[0]! : `${shape[0]} (+${shape.length - 1} more)` };

  const root = parsed.root as NodeJson;
  const doc = withRoot(parsed as unknown as ChainDocument, root);
  const changed = JSON.stringify(doc) !== JSON.stringify(withRoot(current, current.root as unknown as NodeJson));
  return { ok: true, doc, changed, issues: documentIssues(doc), nodes: { before: subtreeSize(current.root as unknown as NodeJson), after: subtreeSize(root) } };
}

function describe(v: unknown): string {
  if (v === undefined) return "nothing";
  if (v === null) return "null";
  if (Array.isArray(v)) return "a list";
  return typeof v === "object" ? "an object" : `${typeof v} ${JSON.stringify(v)}`;
}

/** A JSON.parse failure with a line and column, whichever way the engine words it. */
function syntaxError(text: string, e: unknown): JsonEdit {
  const message = e instanceof Error ? e.message : String(e);
  const pos = /position (\d+)/.exec(message);
  const lc = /line (\d+) column (\d+)/.exec(message);
  let offset: number | undefined = pos ? Number(pos[1]) : undefined;
  if (offset === undefined && lc) {
    const lines = text.split("\n");
    offset = lines.slice(0, Number(lc[1]) - 1).reduce((n, l) => n + l.length + 1, 0) + Number(lc[2]) - 1;
  }
  if (offset === undefined && /end of (JSON|data) input|Unexpected end/i.test(message)) offset = text.length;
  const clean = message.replace(/^JSON\.parse: /, "").replace(/ in JSON at position \d+.*$/, "").replace(/ at line \d+ column \d+.*$/, "");
  if (offset === undefined) return { ok: false, error: `not valid JSON: ${clean}` };
  const before = text.slice(0, offset).split("\n");
  const line = before.length;
  const column = before[before.length - 1]!.length + 1;
  return { ok: false, error: `not valid JSON (line ${line}, column ${column}): ${clean}`, line, column, offset };
}
