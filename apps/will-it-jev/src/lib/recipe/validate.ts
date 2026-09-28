import { toneIssue } from "../deadpan";
import {
  CAPS,
  KEY_PATTERN,
  LABEL_PATTERN,
  LIMITS,
  type RatedQuestion,
  type Recipe,
  type RecipeGate,
  type RecipeNode,
  type RecipeRate,
  type RecipeOutcome,
  type RecipeRoute,
} from "./types";

export type RecipeCheck = { ok: true; recipe: Recipe } | { ok: false; message: string };

/**
 * The one door for untrusted recipes: model output, share links and the
 * curated library in tests. Returns a cleaned copy, with every string trimmed
 * and unknown fields dropped, or the first problem as `<path>: <problem>`.
 *
 * The walk is depth first in document order. On each node it checks kind,
 * the node and depth caps, key, question count, then the fields in the order
 * the types list them, and descends into children last. Caps are checked as
 * the walk goes, so a huge or deep input fails early.
 */
export function validateRecipe(raw: unknown): RecipeCheck {
  try {
    return { ok: true, recipe: checkRecipe(raw) };
  } catch (error) {
    if (error instanceof RecipeError) return { ok: false, message: error.message };
    // A getter or proxy that throws while being read. Bad input, so no throw.
    return { ok: false, message: "recipe: could not be read" };
  }
}

class RecipeError extends Error {}

function fail(path: string, problem: string): never {
  throw new RecipeError(`${path}: ${problem}`);
}

type Obj = Record<string, unknown>;

const isObject = (value: unknown): value is Obj =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const KEY_RULE = `keys are lowercase letters, digits and dashes, up to ${CAPS.key} characters`;
const LABEL_RULE = `labels are lowercase letters, digits and dashes, up to ${CAPS.label} characters`;

/** Trims, then checks length, template syntax and tone. */
function text(value: unknown, path: string, cap: number): string {
  if (typeof value !== "string") fail(path, "must be a string");
  const trimmed = value.trim();
  if (!trimmed) fail(path, "must not be empty");
  if (trimmed.length > cap) fail(path, `too long. the limit is ${cap} characters`);
  if (trimmed.includes("{{")) fail(path, "no {{ }}. jevchain would read it as a template");
  const issue = toneIssue(trimmed);
  if (issue) fail(path, issue);
  return trimmed;
}

const range = ({ min, max }: { min: number; max: number }) => `${min} to ${max}`;

function checkRecipe(raw: unknown): Recipe {
  if (!isObject(raw)) fail("recipe", "must be an object");
  if (raw.v !== 2) fail("recipe.v", "must be 2");
  const title = text(raw.title, "recipe.title", CAPS.title);
  const thing = text(raw.thing, "recipe.thing", CAPS.thing);
  const root = new Walk().node(raw.root, "root", 0);
  return { v: 2, title, thing, root };
}

/** An optional field: absent when undefined or null. */
const absent = (value: unknown) => value === undefined || value === null;

/** Tree-wide state: keys seen so far and running totals. */
class Walk {
  private keys = new Set<string>();
  private nodes = 0;
  private questions = 0;

  /**
   * `depth` is the number of decisions above this node. Escape hatches
   * (`unsure`, `lowConfidence`) are children like any other. A rate's band
   * outcomes are part of the rate, not nodes of their own.
   */
  node(raw: unknown, path: string, depth: number): RecipeNode {
    if (!isObject(raw)) fail(path, "must be an object");
    const kind = raw.kind;
    if (kind !== "gate" && kind !== "route" && kind !== "rate" && kind !== "outcome") {
      fail(`${path}.kind`, 'must be "gate", "route", "rate" or "outcome"');
    }
    if (++this.nodes > LIMITS.nodes) fail("root", `too many nodes. the limit is ${LIMITS.nodes}`);
    if (kind === "outcome") return this.outcome(raw, path);
    if (kind === "rate") return this.rate(raw, path);
    if (depth + 1 > LIMITS.depth) {
      fail(path, `too deep. the limit is ${LIMITS.depth} decisions on any path`);
    }
    return kind === "gate" ? this.gate(raw, path, depth + 1) : this.route(raw, path, depth + 1);
  }

  private gate(raw: Obj, path: string, depth: number): RecipeGate {
    const key = this.key(raw.key, `${path}.key`);
    this.ask(1);
    const title = text(raw.title, `${path}.title`, CAPS.nodeTitle);
    const question = text(raw.question, `${path}.question`, CAPS.question);
    let means: RecipeGate["means"];
    if (!absent(raw.means)) {
      const rawMeans = raw.means;
      if (!isObject(rawMeans)) fail(`${path}.means`, "must be an object with yes and no");
      means = {
        yes: text(rawMeans.yes, `${path}.means.yes`, CAPS.means),
        no: text(rawMeans.no, `${path}.means.no`, CAPS.means),
      };
    }
    // A missing child would halt the jevchain run, so both are required.
    for (const side of ["yes", "no"] as const) {
      if (absent(raw[side])) fail(`${path}.${side}`, "missing. a gate needs both yes and no");
    }
    const yes = this.node(raw.yes, `${path}.yes`, depth);
    const no = this.node(raw.no, `${path}.no`, depth);
    const unsure = absent(raw.unsure) ? undefined : this.node(raw.unsure, `${path}.unsure`, depth);
    return {
      kind: "gate",
      key,
      title,
      question,
      ...(means ? { means } : {}),
      yes,
      no,
      ...(unsure ? { unsure } : {}),
    };
  }

  private route(raw: Obj, path: string, depth: number): RecipeRoute {
    const key = this.key(raw.key, `${path}.key`);
    this.ask(1);
    const title = text(raw.title, `${path}.title`, CAPS.nodeTitle);
    const question = text(raw.question, `${path}.question`, CAPS.question);
    const labels = this.labels(raw.labels, `${path}.labels`);
    const rawBranches = raw.branches;
    if (!isObject(rawBranches)) fail(`${path}.branches`, "must be an object");
    for (const label of Object.keys(labels)) {
      if (!Object.hasOwn(rawBranches, label)) fail(`${path}.branches`, `missing branch "${label}"`);
    }
    for (const label of Object.keys(rawBranches)) {
      if (!Object.hasOwn(labels, label)) fail(`${path}.branches`, `"${label}" is not a label`);
    }
    const branches: Record<string, RecipeNode> = {};
    for (const label of Object.keys(labels)) {
      branches[label] = this.node(rawBranches[label], `${path}.branches.${label}`, depth);
    }
    const lowConfidence = absent(raw.lowConfidence)
      ? undefined
      : this.node(raw.lowConfidence, `${path}.lowConfidence`, depth);
    return { kind: "route", key, title, question, labels, branches, ...(lowConfidence ? { lowConfidence } : {}) };
  }

  private rate(raw: Obj, path: string): RecipeRate {
    const key = this.key(raw.key, `${path}.key`);
    const title = text(raw.title, `${path}.title`, CAPS.nodeTitle);
    const rawQuestions = raw.questions;
    if (!Array.isArray(rawQuestions)) fail(`${path}.questions`, "must be a list");
    const { min, max } = CAPS.rateQuestions;
    if (rawQuestions.length < min || rawQuestions.length > max) {
      fail(`${path}.questions`, `needs ${range(CAPS.rateQuestions)} questions`);
    }
    this.ask(rawQuestions.length);
    // Array.from visits holes, which map would skip.
    const questions = Array.from(rawQuestions, (q, i) => this.rated(q, `${path}.questions[${i}]`));
    const bands = this.bands(raw.bands, `${path}.bands`);
    return { kind: "rate", key, title, questions, bands };
  }

  /**
   * Highest first, strictly descending, each `atLeast` from 0 to 1, and the
   * last exactly 0, so every score lands in one band.
   */
  private bands(raw: unknown, path: string): RecipeRate["bands"] {
    if (!Array.isArray(raw)) fail(path, "must be a list");
    const { min, max } = CAPS.bands;
    if (raw.length < min || raw.length > max) fail(path, `needs ${range(CAPS.bands)} bands`);
    const bands: RecipeRate["bands"] = [];
    for (let i = 0; i < raw.length; i++) {
      const band: unknown = raw[i];
      const at = `${path}[${i}]`;
      if (!isObject(band)) fail(at, "must be an object");
      const atLeast = band.atLeast;
      if (typeof atLeast !== "number" || !Number.isFinite(atLeast) || atLeast < 0 || atLeast > 1) {
        fail(`${at}.atLeast`, "must be a number from 0 to 1");
      }
      const previous = bands[i - 1];
      if (previous && atLeast >= previous.atLeast) {
        fail(`${at}.atLeast`, "must be lower than the band before it. bands go highest first");
      }
      if (i === raw.length - 1 && atLeast !== 0) fail(`${at}.atLeast`, "must be 0 on the last band");
      const rawOutcome = band.outcome;
      if (!isObject(rawOutcome) || rawOutcome.kind !== "outcome") {
        fail(`${at}.outcome`, 'must be an object with kind "outcome"');
      }
      bands.push({ atLeast, outcome: this.outcome(rawOutcome, `${at}.outcome`) });
    }
    return bands;
  }

  private outcome(raw: Obj, path: string): RecipeOutcome {
    const key = this.key(raw.key, `${path}.key`);
    const stamp = text(raw.stamp, `${path}.stamp`, CAPS.stamp);
    const line = text(raw.line, `${path}.line`, CAPS.line);
    return { kind: "outcome", key, stamp, line };
  }

  private rated(raw: unknown, path: string): RatedQuestion {
    if (!isObject(raw)) fail(path, "must be an object");
    const kind = raw.kind;
    if (kind !== "noul" && kind !== "score" && kind !== "choice") {
      fail(`${path}.kind`, 'must be "noul", "score" or "choice"');
    }
    const key = this.key(raw.key, `${path}.key`);
    const question = text(raw.question, `${path}.question`, CAPS.question);
    const weight = raw.weight;
    if (typeof weight !== "number" || !Number.isFinite(weight) || weight <= 0 || weight > CAPS.maxWeight) {
      fail(`${path}.weight`, `must be a positive number up to ${CAPS.maxWeight}`);
    }
    const base = { key, question, weight };

    if (kind === "noul") {
      if (typeof raw.good !== "boolean") fail(`${path}.good`, "must be true or false");
      return { ...base, kind, good: raw.good };
    }

    if (kind === "score") {
      const rawLevels = raw.levels;
      if (!Array.isArray(rawLevels)) fail(`${path}.levels`, "must be a list");
      const { min, max } = CAPS.levels;
      if (rawLevels.length < min || rawLevels.length > max) {
        fail(`${path}.levels`, `needs ${range(CAPS.levels)} levels`);
      }
      const levels = Array.from(rawLevels, (level, i) => text(level, `${path}.levels[${i}]`, CAPS.level));
      const good = raw.good;
      if (good !== "high" && good !== "low") fail(`${path}.good`, 'must be "high" or "low"');
      return { ...base, kind, levels, good };
    }

    const labels = this.labels(raw.labels, `${path}.labels`);
    const rawGood = raw.good;
    if (!Array.isArray(rawGood)) fail(`${path}.good`, "must be a list");
    if (rawGood.length === 0) fail(`${path}.good`, "needs at least one label");
    const good: string[] = [];
    // Walk by index: forEach would skip holes and let an all-holes list pass empty.
    for (let i = 0; i < rawGood.length; i++) {
      const label: unknown = rawGood[i];
      if (typeof label !== "string") fail(`${path}.good[${i}]`, "must be a string");
      const trimmed = label.trim();
      if (!Object.hasOwn(labels, trimmed)) fail(`${path}.good`, `"${trimmed}" is not a label`);
      if (!good.includes(trimmed)) good.push(trimmed);
    }
    return { ...base, kind, labels, good };
  }

  /** Route and choice labels: label to description. */
  private labels(raw: unknown, path: string): Record<string, string> {
    if (!isObject(raw)) fail(path, "must be an object");
    const entries = Object.entries(raw);
    const { min, max } = CAPS.labels;
    if (entries.length < min || entries.length > max) fail(path, `needs ${range(CAPS.labels)} labels`);
    const labels: Record<string, string> = {};
    for (const [label, description] of entries) {
      if (!LABEL_PATTERN.test(label)) fail(`${path}.${label}`, LABEL_RULE);
      const issue = toneIssue(label);
      if (issue) fail(`${path}.${label}`, issue);
      labels[label] = text(description, `${path}.${label}`, CAPS.labelDescription);
    }
    return labels;
  }

  /** Node keys, outcome keys and rated question keys share one namespace. */
  private key(raw: unknown, path: string): string {
    if (typeof raw !== "string") fail(path, "must be a string");
    const key = raw.trim();
    if (!KEY_PATTERN.test(key)) fail(path, KEY_RULE);
    const issue = toneIssue(key);
    if (issue) fail(path, issue);
    if (this.keys.has(key)) fail(path, `"${key}" is used twice`);
    this.keys.add(key);
    return key;
  }

  /** A gate or route asks one question. A rate asks one per rated question. */
  private ask(count: number) {
    this.questions += count;
    if (this.questions > LIMITS.questions) {
      fail("root", `too many questions. the limit is ${LIMITS.questions}`);
    }
  }
}
