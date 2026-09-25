/**
 * Editing the working document as JSON text, and bringing it back onto the
 * canvas. The code drawer's json tab is a text box over this:
 *
 *   const text = formatDocument(doc);
 *   const r = readDocumentEdit(editedText, doc);
 *   if (r.ok && r.changed) builder.commit(r.doc);   // one undo step
 *
 * Two levels of wrong, kept apart on purpose:
 *  - `ok: false`: not JSON, not a `jevchain/v1` document, or a shape the
 *    builder can't hold (a route without `branches`, a gate without `then`, a
 *    node without a known `kind`...). Applying it would break the canvas, so
 *    it's refused, with where the problem is.
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

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Problems that would stop the builder from holding the tree at all (it walks
 * children and opens question editors without re-checking), each prefixed
 * with the node's path. Semantic problems are `documentIssues`' job.
 */
export function shapeIssues(node: unknown, path = "$"): string[] {
  if (!isObject(node)) return [`${path}: expected a node object, got ${describe(node)}`];
  const kind = node.kind as BuilderKind;
  if (typeof node.kind !== "string" || !KINDS.has(kind)) return [`${path}: unknown kind ${JSON.stringify(node.kind)} (one of ${[...KINDS].join(", ")})`];
  const out: string[] = [];
  const at = `${path} (${kind}${typeof node.id === "string" ? ` "${node.id}"` : ""})`;
  if (typeof node.id !== "string") out.push(`${at}: "id" must be a string`);
  if (node.title !== undefined && typeof node.title !== "string") out.push(`${at}: "title" must be a string`);

  const question = (q: unknown, where: string) => {
    if (!isObject(q)) out.push(`${at}: ${where} must be a question object`);
    else if (typeof q.type !== "string") out.push(`${at}: ${where} needs a "type"`);
  };
  const child = (c: unknown, edge: string) => out.push(...(c === undefined ? [`${at}: needs "${edge}", a node`] : shapeIssues(c, `${path}/${edge}`)));
  const branches = (b: unknown) => {
    if (!isObject(b)) return void out.push(`${at}: needs "branches", an object of nodes`);
    for (const [key, c] of Object.entries(b)) {
      if (!key || key.includes("/")) out.push(`${at}: branch name ${JSON.stringify(key)} can't be empty or contain "/"`);
      else child(c, key);
    }
  };
  const wrapped = (w: unknown, field: string) => {
    if (w === undefined) return;
    if (!isObject(w)) out.push(`${at}: "${field}" must be an object with "then"`);
    else child(w.then, field);
  };

  switch (kind) {
    case "ask":
      if (!isObject(node.questions)) out.push(`${at}: needs "questions", an object of questions`);
      else for (const [k, q] of Object.entries(node.questions)) question(q, `questions.${k}`);
      break;
    case "route":
      question(node.ask, `"ask"`);
      branches(node.branches);
      wrapped(node.lowConfidence, "lowConfidence");
      break;
    case "gate":
      question(node.ask, `"ask"`);
      if (node.pass !== undefined && !isObject(node.pass)) out.push(`${at}: "pass" must be an object`);
      child(node.then, "then");
      if (node.otherwise !== undefined) child(node.otherwise, "otherwise");
      wrapped(node.unsure, "unsure");
      break;
    case "parallel":
      branches(node.branches);
      break;
    case "cascade":
      if (!Array.isArray(node.tiers)) out.push(`${at}: needs "tiers", a list`);
      else
        node.tiers.forEach((t: unknown, i) => {
          if (!isObject(t)) return void out.push(`${at}: tiers.${i} must be an object`);
          if (typeof t.id !== "string") out.push(`${at}: tiers.${i} needs a string "id"`);
          question(t.ask, `tiers.${i}.ask`);
        });
      child(node.fallback, "fallback");
      break;
    case "chain":
      if (!Array.isArray(node.steps) || node.steps.length === 0) out.push(`${at}: needs "steps", a non-empty list`);
      else node.steps.forEach((s: unknown, i) => child(s, String(i)));
      break;
  }
  return out;
}

/** Read the json tab's text back into a document, or say why it can't be. */
export function readDocumentEdit(text: string, current: ChainDocument): JsonEdit {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return syntaxError(text, e);
  }
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
