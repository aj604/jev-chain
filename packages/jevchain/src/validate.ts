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
 * What a node can see in `{{results.*}}` when it runs. In a `chain`, step N
 * sees everything under steps 0..N-1. A `parallel` branch may see its
 * siblings (a fast one can finish first), so they count too. Ancestors are
 * still running.
 *
 * `{{answers.*}}` sees the same finished nodes, plus the route, gate and
 * cascade ancestors that decided the way here: their calls have come back.
 */
interface ResultScope {
  readonly finished: Ids;
  readonly running: Ids;
  readonly decided: Ids;
}

/** For `{{answers.*}}`: the answer keys each id's calls produce, and where it first asks. */
type Asked = ReadonlyMap<string, { readonly keys: ReadonlySet<string>; readonly path: string }>;

const DECIDES = new Set(["route", "gate", "cascade"]);

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
  const known = { all, asked: askedIds(root), kinds: kindsById(root) };
  const go = (node: AnyNode, path: string, scope: ResultScope) => {
    const n = node as AnyJevNode;
    const at = `${path} (${n.kind} "${n.id}")`;
    for (const [where, template, tier] of templatesOf(n)) {
      for (const hole of new Set(templatePaths(template))) {
        const problem = holeProblem(hole, n.id, scope, known, tier);
        if (problem) issues.push(`${at}${where}: "{{${hole}}}" ${problem}`);
      }
    }
    const running = withId(scope.running, n.id, path);
    const decided = DECIDES.has(n.kind) ? withId(scope.decided, n.id, path) : scope.decided;
    const children = childrenOf(node);
    children.forEach((c, i) => {
      const before = n.kind === "chain" ? children.slice(0, i) : n.kind === "parallel" ? children.filter((other) => other !== c) : [];
      let { finished } = scope;
      if (before.length) {
        const done = new Map(finished);
        for (const prev of before) collectIds(prev.node, childPath(path, prev.edge), done);
        finished = done;
      }
      go(c.node, childPath(path, c.edge), { finished, running, decided });
    });
  };
  go(root, ROOT_PATH, { finished: new Map(), running: new Map(), decided: new Map() });
  return issues;
}

/** Why a hole can never resolve, or undefined if it might. */
function holeProblem(
  hole: string,
  selfId: string,
  scope: ResultScope,
  known: { all: Ids; asked: Asked; kinds: ReadonlyMap<string, string> },
  tier?: TierAt,
): string | undefined {
  const { all } = known;
  const [head = "", id, key] = hole.split(".");
  if (!(TEMPLATE_ROOTS as readonly string[]).includes(head)) {
    return `reads "${head}", which templates don't have; start with ${TEMPLATE_ROOTS.join(", ")}${didYouMean(head, TEMPLATE_ROOTS)}`;
  }
  if (head === "answers" && id !== undefined) return answersProblem(id, key, selfId, scope, known, tier);
  if (head !== "results" || id === undefined || scope.finished.has(id)) return undefined;
  const what = `reads results of "${id}"`;
  if (id === selfId) return `${what}, this node's own output, which doesn't exist until it finishes`;
  const ancestor = scope.running.get(id);
  if (ancestor) {
    // A branch reading the route/gate/cascade above it almost always wants what Jev said there.
    const instead = scope.decided.has(id) ? `; what Jev answered it is in {{answers.${id}}}` : "";
    return `${what}, which is still running at ${ancestor} (results are set when a node finishes${instead})`;
  }
  const elsewhere = all.get(id);
  if (elsewhere) return `${what}, which is at ${elsewhere} and never finishes before this node runs`;
  return `${what}, but no node has that id${didYouMean(id, [...all.keys()])}`;
}

/** Why `{{answers.<id>.<key>}}` can never resolve, or undefined if it might. */
function answersProblem(
  id: string,
  key: string | undefined,
  selfId: string,
  scope: ResultScope,
  { all, asked, kinds }: { all: Ids; asked: Asked; kinds: ReadonlyMap<string, string> },
  tier?: TierAt,
): string | undefined {
  const what = `reads answers of "${id}"`;
  const mine = asked.get(id);
  if (!mine) {
    if (!all.has(id)) return `${what}, but no node has that id${didYouMean(id, [...asked.keys()])}`;
    const kind = kinds.get(id);
    const inside = kind === "chain" || kind === "parallel" ? `; read the ask, route, gate or cascade inside it` : "";
    return `${what}, a ${kind}, which doesn't ask Jev itself${inside}`;
  }
  if (!scope.finished.has(id) && !scope.decided.has(id)) {
    // A cascade tier's state is rendered after the tiers before it have answered.
    if (id === selfId && tier?.earlier.length) {
      if (key === undefined || tier.earlier.includes(key)) return undefined;
      if (mine.keys.has(key)) {
        return `${what}, whose tier "${key}" hasn't answered when tier "${tier.id}" renders its state (only ${tier.earlier.map((t) => `"${t}"`).join(", ")} have)`;
      }
    } else if (id === selfId) {
      return `${what}, this node's own, which don't exist until its call comes back`;
    } else {
      return `${what}, which is at ${mine.path} and never asks Jev before this node runs`;
    }
  }
  if (key !== undefined && !mine.keys.has(key)) {
    const has = [...mine.keys].map((k) => `"${k}"`).join(", ");
    return `${what}, which has no "${key}" (it has ${has})${didYouMean(key, [...mine.keys])}`;
  }
  return undefined;
}

/** Every id that asks Jev, with the answer keys its calls produce (merged across nodes sharing the id). */
function askedIds(root: AnyNode): Asked {
  const out = new Map<string, { keys: Set<string>; path: string }>();
  walk(root, (node, { path }) => {
    const n = node as AnyJevNode;
    let keys: string[];
    switch (n.kind) {
      case "ask":
        keys = Object.keys(n.questions ?? {});
        break;
      case "route":
      case "gate":
        keys = [DECISION_KEY, ...Object.keys(n.alsoAsk ?? {})];
        break;
      case "cascade":
        keys = (n.tiers ?? []).map((t) => t.id);
        break;
      default:
        return;
    }
    const entry = out.get(n.id) ?? { keys: new Set<string>(), path };
    for (const k of keys) entry.keys.add(k);
    out.set(n.id, entry);
  });
  return out;
}

/** Each id's kind, where it first appears. */
function kindsById(root: AnyNode): Map<string, string> {
  const out = new Map<string, string>();
  walk(root, (n) => {
    if (!out.has(n.id)) out.set(n.id, n.kind);
  });
  return out;
}

/** For a cascade tier's state: which tier it is, and the tiers that have answered before it renders. */
interface TierAt {
  readonly id: string;
  readonly earlier: readonly string[];
}

/** Every template in a node, with where it lives (appended to the issue's location). */
function templatesOf(n: AnyJevNode): [string, string, TierAt?][] {
  const out: [string, string, TierAt?][] = [];
  switch (n.kind) {
    case "ask":
    case "route":
    case "gate":
      if (typeof n.state === "string") out.push([".state", n.state]);
      break;
    case "cascade":
      (n.tiers ?? []).forEach((t, i, tiers) => {
        if (typeof t.state === "string") out.push([`.tiers.${t.id}.state`, t.state, { id: t.id, earlier: tiers.slice(0, i).map((e) => e.id) }]);
      });
      break;
    case "emit":
      stringsIn(n.value, ".value", out);
      break;
  }
  return out;
}

function stringsIn(value: unknown, where: string, out: [string, string, TierAt?][]) {
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
