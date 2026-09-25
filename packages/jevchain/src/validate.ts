/**
 * Structural checks that the type system can't make, for chains built in code
 * *and* chains loaded from JSON (where the type system never saw them).
 */
import { questionIssues } from "./questions";
import { childPath, childrenOf, ROOT_PATH, walk, type AnyJevNode, type AnyNode } from "./nodes";
import { TEMPLATE_ROOTS, templatePaths } from "./template";

/** Question key used for a route/gate/tier's deciding question. */
export const DECISION_KEY = "decision";

export function chainIssues(root: AnyNode): string[] {
  const issues: string[] = [];
  walk(root, (node, { path }) => {
    const n = node as AnyJevNode;
    const at = `${path} (${n.kind} "${n.id}")`;
    if (typeof n.id !== "string" || n.id === "") issues.push(`${path}: every node needs a non-empty string id`);
    switch (n.kind) {
      case "ask":
        if (!n.questions || Object.keys(n.questions).length === 0) issues.push(`${at}: needs at least one question`);
        else for (const [k, q] of Object.entries(n.questions)) issues.push(...questionIssues(q, `${at}.questions.${k}`));
        break;
      case "route": {
        issues.push(...questionIssues(n.ask, `${at}.ask`));
        if (n.ask?.type !== "choice") {
          issues.push(`${at}: a route must ask a choice question`);
          break;
        }
        const labels = Object.keys(n.ask.criteria);
        const branches = Object.keys(n.branches ?? {});
        const missing = labels.filter((l) => !branches.includes(l));
        const extra = branches.filter((b) => !labels.includes(b));
        if (missing.length) issues.push(`${at}: no branch for ${missing.map((m) => `"${m}"`).join(", ")}`);
        if (extra.length) issues.push(`${at}: branches ${extra.map((m) => `"${m}"`).join(", ")} aren't options of the question`);
        if (n.lowConfidence && !inUnit(n.lowConfidence.below)) issues.push(`${at}.lowConfidence.below: expected 0–1`);
        issues.push(...alsoAskIssues(n.alsoAsk, at));
        break;
      }
      case "gate": {
        issues.push(...questionIssues(n.ask, `${at}.ask`));
        const { min, max, label } = n.pass ?? {};
        if (min === undefined && max === undefined) issues.push(`${at}.pass: set min and/or max`);
        if (n.ask?.type === "choice") {
          if (!label) issues.push(`${at}.pass.label: a choice gate needs the label to measure`);
          else if (!(label in n.ask.criteria)) issues.push(`${at}.pass.label: "${label}" isn't an option of the question`);
        }
        if (n.ask?.type !== "score") {
          if (min !== undefined && !inUnit(min)) issues.push(`${at}.pass.min: probabilities are 0–1`);
          if (max !== undefined && !inUnit(max)) issues.push(`${at}.pass.max: probabilities are 0–1`);
        }
        if (n.unsure && n.unsure.margin === undefined && n.unsure.minConfidence === undefined) {
          issues.push(`${at}.unsure: set margin and/or minConfidence`);
        }
        issues.push(...alsoAskIssues(n.alsoAsk, at));
        break;
      }
      case "parallel":
        if (!n.branches || Object.keys(n.branches).length === 0) issues.push(`${at}: needs at least one branch`);
        break;
      case "cascade": {
        if (!n.tiers?.length) issues.push(`${at}: needs at least one tier`);
        const seen = new Set<string>();
        for (const t of n.tiers ?? []) {
          if (!t.id) issues.push(`${at}: every tier needs an id`);
          if (t.id === "fallback") issues.push(`${at}: "fallback" is reserved; rename that tier`);
          if (seen.has(t.id)) issues.push(`${at}: duplicate tier id "${t.id}"`);
          seen.add(t.id);
          if (!inUnit(t.minConfidence)) issues.push(`${at}.tiers.${t.id}.minConfidence: expected 0–1`);
          issues.push(...questionIssues(t.ask, `${at}.tiers.${t.id}.ask`));
        }
        break;
      }
      case "step":
        if (typeof n.run !== "function") issues.push(`${at}: step has no function (missing handler "${n.ref ?? n.id}"?)`);
        break;
      case "chain":
        if (!n.steps?.length) issues.push(`${at}: needs at least one node`);
        break;
      case "emit":
        break;
      default:
        issues.push(`${path}: unknown node kind "${(n as { kind: unknown }).kind}"`);
    }
  });
  issues.push(...templateIssues(root));
  return issues;
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

/** Node ids mapped to the first path they appear at. */
type Ids = ReadonlyMap<string, string>;

/**
 * What a node can see in `{{results.*}}` when it runs. Only a `chain` makes
 * results available: step N sees everything under steps 0..N-1. Ancestors are
 * still running, and `parallel` siblings race it.
 */
interface ResultScope {
  readonly finished: Ids;
  readonly running: Ids;
  readonly concurrent: Ids;
}

/**
 * Holes that can only ever come up empty: an unknown root (`{{inptu}}`), a
 * `results.<id>` no node has, or a node that can't have finished by the time
 * this one reads it. Rendered, each would quietly become "" and Jev would be
 * asked about nothing. (`input.*` and `run.*` aren't checked: they're data.)
 */
function templateIssues(root: AnyNode): string[] {
  const issues: string[] = [];
  const all = new Map<string, string>();
  collectIds(root, ROOT_PATH, all);
  const go = (node: AnyNode, path: string, scope: ResultScope) => {
    const n = node as AnyJevNode;
    const at = `${path} (${n.kind} "${n.id}")`;
    for (const [where, template] of templatesOf(n)) {
      for (const hole of new Set(templatePaths(template))) {
        const problem = holeProblem(hole, n.id, scope, all);
        if (problem) issues.push(`${at}${where}: "{{${hole}}}" ${problem}`);
      }
    }
    const running = withId(scope.running, n.id, path);
    const children = childrenOf(node);
    children.forEach((c, i) => {
      let { finished, concurrent } = scope;
      if (n.kind === "chain") {
        const done = new Map(finished);
        for (const prev of children.slice(0, i)) collectIds(prev.node, childPath(path, prev.edge), done);
        finished = done;
      }
      if (n.kind === "parallel") {
        const racing = new Map(concurrent);
        for (const other of children) if (other !== c) collectIds(other.node, childPath(path, other.edge), racing);
        concurrent = racing;
      }
      go(c.node, childPath(path, c.edge), { finished, running, concurrent });
    });
  };
  go(root, ROOT_PATH, { finished: new Map(), running: new Map(), concurrent: new Map() });
  return issues;
}

/** Why a hole can never resolve, or undefined if it might. */
function holeProblem(hole: string, selfId: string, scope: ResultScope, all: Ids): string | undefined {
  const [head = "", id] = hole.split(".");
  if (!(TEMPLATE_ROOTS as readonly string[]).includes(head)) {
    return `reads "${head}", which templates don't have; start with ${TEMPLATE_ROOTS.join(", ")}${didYouMean(head, TEMPLATE_ROOTS)}`;
  }
  if (head !== "results" || id === undefined || scope.finished.has(id)) return undefined;
  const what = `reads results of "${id}"`;
  if (id === selfId) return `${what}, this node's own output, which doesn't exist until it finishes`;
  const ancestor = scope.running.get(id);
  if (ancestor) return `${what}, which is still running at ${ancestor} (results are set when a node finishes)`;
  const sibling = scope.concurrent.get(id);
  if (sibling) return `${what}, which runs in parallel at ${sibling}, so it may not have finished`;
  const elsewhere = all.get(id);
  if (elsewhere) return `${what}, which is at ${elsewhere} and never finishes before this node runs`;
  return `${what}, but no node has that id${didYouMean(id, [...all.keys()])}`;
}

/** Every template in a node, with where it lives (appended to the issue's location). */
function templatesOf(n: AnyJevNode): [string, string][] {
  const out: [string, string][] = [];
  switch (n.kind) {
    case "ask":
    case "route":
    case "gate":
      if (typeof n.state === "string") out.push([".state", n.state]);
      break;
    case "cascade":
      for (const t of n.tiers ?? []) if (typeof t.state === "string") out.push([`.tiers.${t.id}.state`, t.state]);
      break;
    case "emit":
      stringsIn(n.value, ".value", out);
      break;
  }
  return out;
}

function stringsIn(value: unknown, where: string, out: [string, string][]) {
  if (typeof value === "string") out.push([where, value]);
  else if (Array.isArray(value)) value.forEach((v, i) => stringsIn(v, `${where}.${i}`, out));
  else if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) stringsIn(v, `${where}.${k}`, out);
}

function collectIds(node: AnyNode, path: string, into: Map<string, string>) {
  walk(node, (n, info) => {
    const at = info.path === ROOT_PATH ? path : path + info.path.slice(ROOT_PATH.length);
    if (typeof n.id === "string" && !into.has(n.id)) into.set(n.id, at);
  });
}

function withId(ids: Ids, id: string, path: string): Ids {
  if (ids.has(id)) return ids;
  return new Map(ids).set(id, path);
}

/** ` (did you mean "x"?)` for the closest candidate within two edits, else "". */
function didYouMean(word: string, candidates: readonly string[]): string {
  let best: string | undefined;
  let bestDistance = 3;
  for (const c of candidates) {
    const d = editDistance(word, c);
    if (d < bestDistance) [best, bestDistance] = [c, d];
  }
  return best === undefined ? "" : ` (did you mean "${best}"?)`;
}

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length]!;
}

function inUnit(v: unknown): boolean {
  return typeof v === "number" && v >= 0 && v <= 1;
}

function alsoAskIssues(alsoAsk: Record<string, unknown> | undefined, at: string): string[] {
  if (!alsoAsk) return [];
  const issues: string[] = [];
  if (DECISION_KEY in alsoAsk) issues.push(`${at}.alsoAsk: "${DECISION_KEY}" is reserved for the deciding question`);
  for (const [k, q] of Object.entries(alsoAsk)) issues.push(...questionIssues(q, `${at}.alsoAsk.${k}`));
  return issues;
}
