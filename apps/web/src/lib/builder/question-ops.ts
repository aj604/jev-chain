/**
 * Pure edits on question JSON (choice / score / noul) and the things that
 * hang off questions: gate thresholds, question maps (`questions`, `alsoAsk`),
 * and keyed maps in general (parallel branches). Order-preserving, immutable,
 * and they refuse edits that would silently merge or drop keys.
 */
import type { Entry } from "jevchain";

export type QuestionType = "choice" | "score" | "noul";

export interface QuestionJson {
  type: QuestionType;
  instructions?: Entry;
  criteria?: unknown;
}

export interface ThresholdJson {
  label?: string;
  min?: number;
  max?: number;
}

export const MIN_LEVELS = 2;
export const MAX_LEVELS = 10;
export const MIN_LABELS = 2;

// ---------------------------------------------------------------------------
// Keyed maps (order matters: route labels, branches, question keys)
// ---------------------------------------------------------------------------

/** Why a key can't be used, or null if it's fine. */
export function keyProblem(next: string, keys: string[], current?: string): string | null {
  if (!next.trim()) return "can't be empty";
  if (next !== next.trim()) return "no leading/trailing spaces";
  if (next.includes("/")) return "no slashes (they're path separators)";
  if (next !== current && keys.includes(next)) return `"${next}" is taken`;
  return null;
}

/** Rename a key in place, keeping its position. Returns the same object if the rename isn't valid. */
export function renameKey<V>(obj: Record<string, V>, from: string, to: string): Record<string, V> {
  if (from === to || !(from in obj) || keyProblem(to, Object.keys(obj), from)) return obj;
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k === from ? to : k, v]));
}

export function removeKey<V>(obj: Record<string, V>, key: string): Record<string, V> {
  if (!(key in obj)) return obj;
  const next = { ...obj };
  delete next[key];
  return next;
}

/** `base`, `base-2`, `base-3`… whichever isn't taken. */
export function freshKey(base: string, keys: Iterable<string>): string {
  const taken = new Set(keys);
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

export function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return [...list];
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item!);
  return next;
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

export function labelsOf(q: QuestionJson | undefined): string[] {
  return q?.type === "choice" && q.criteria && typeof q.criteria === "object" ? Object.keys(q.criteria as object) : [];
}

export function levelsOf(q: QuestionJson | undefined): Entry[] {
  return q?.type === "score" && Array.isArray(q.criteria) ? (q.criteria as Entry[]) : [];
}

export function newQuestion(type: QuestionType, instructions: Entry = null): QuestionJson {
  switch (type) {
    case "choice":
      return { type, instructions, criteria: { yes: null, no: null } };
    case "score":
      return { type, instructions, criteria: ["not at all", "somewhat", "extremely"] };
    case "noul":
      return { type, instructions };
  }
}

/** Switch a question's type, carrying over whatever translates (labels ↔ levels). */
export function convertQuestion(q: QuestionJson, type: QuestionType): QuestionJson {
  if (q.type === type) return q;
  const instructions = q.instructions ?? null;
  if (type === "noul") return { type, instructions };
  if (type === "choice") {
    if (q.type === "score") {
      const levels = levelsOf(q);
      const criteria: Record<string, Entry> = {};
      levels.forEach((lvl, i) => {
        const label = typeof lvl === "string" && lvl.trim() && !lvl.includes("/") ? lvl.trim() : `level-${i}`;
        criteria[freshKey(label, Object.keys(criteria))] = null;
      });
      return Object.keys(criteria).length >= MIN_LABELS ? { type, instructions, criteria } : newQuestion("choice", instructions);
    }
    return newQuestion("choice", instructions);
  }
  // → score
  if (q.type === "choice") {
    const labels = labelsOf(q).slice(0, MAX_LEVELS);
    return labels.length >= MIN_LEVELS ? { type, instructions, criteria: labels } : newQuestion("score", instructions);
  }
  return newQuestion("score", instructions);
}

export function setChoiceDescription(q: QuestionJson, label: string, description: Entry): QuestionJson {
  const criteria = { ...(q.criteria as Record<string, Entry>), [label]: description };
  return { ...q, criteria };
}

export function renameLabel(q: QuestionJson, from: string, to: string): QuestionJson {
  const criteria = q.criteria as Record<string, Entry>;
  const next = renameKey(criteria, from, to);
  return next === criteria ? q : { ...q, criteria: next };
}

export function addLabel(q: QuestionJson, base = "option"): QuestionJson {
  const criteria = q.criteria as Record<string, Entry>;
  return { ...q, criteria: { ...criteria, [freshKey(base, Object.keys(criteria))]: null } };
}

export function removeLabel(q: QuestionJson, label: string): QuestionJson {
  const criteria = q.criteria as Record<string, Entry>;
  if (Object.keys(criteria).length <= MIN_LABELS) return q;
  return { ...q, criteria: removeKey(criteria, label) };
}

export function setLevel(q: QuestionJson, i: number, value: Entry): QuestionJson {
  const levels = [...levelsOf(q)];
  if (i < 0 || i >= levels.length) return q;
  levels[i] = value;
  return { ...q, criteria: levels };
}

export function addLevel(q: QuestionJson, value: Entry = "new level"): QuestionJson {
  const levels = levelsOf(q);
  if (levels.length >= MAX_LEVELS) return q;
  return { ...q, criteria: [...levels, value] };
}

export function removeLevel(q: QuestionJson, i: number): QuestionJson {
  const levels = levelsOf(q);
  if (levels.length <= MIN_LEVELS) return q;
  return { ...q, criteria: levels.filter((_, j) => j !== i) };
}

export function moveLevel(q: QuestionJson, i: number, to: number): QuestionJson {
  return { ...q, criteria: moveItem(levelsOf(q), i, to) };
}

export function setNoulSide(q: QuestionJson, side: "true" | "false", value: Entry | undefined): QuestionJson {
  const criteria = { ...((q.criteria as Record<string, Entry> | undefined) ?? {}) };
  if (value === undefined || value === null || value === "") delete criteria[side];
  else criteria[side] = value;
  const next: QuestionJson = { type: q.type, ...(q.instructions !== undefined ? { instructions: q.instructions } : {}) };
  return Object.keys(criteria).length ? { ...next, criteria } : next;
}

// ---------------------------------------------------------------------------
// Gate thresholds
// ---------------------------------------------------------------------------

/** The range a gate's threshold lives in: probabilities are 0–1, scores are 0…levels-1. */
export function passScale(q: QuestionJson | undefined): { min: number; max: number; step: number } {
  if (q?.type === "score") return { min: 0, max: Math.max(1, levelsOf(q).length - 1), step: 0.1 };
  return { min: 0, max: 1, step: 0.01 };
}

/** Make a threshold fit its question: a valid label for choices, values clamped into range, at least one bound. */
export function normalizePass(q: QuestionJson, pass: ThresholdJson): ThresholdJson {
  const { max: hi } = passScale(q);
  const clamp = (v: number | undefined) => (v === undefined ? undefined : Math.max(0, Math.min(hi, v)));
  const out: ThresholdJson = {};
  if (q.type === "choice") {
    const labels = labelsOf(q);
    out.label = pass.label && labels.includes(pass.label) ? pass.label : labels[0];
  }
  const min = clamp(pass.min);
  const max = clamp(pass.max);
  if (min !== undefined) out.min = round(min);
  if (max !== undefined) out.max = round(max);
  if (out.min === undefined && out.max === undefined) out.min = q.type === "score" ? round(hi / 2) : 0.5;
  return out;
}

/** After a label rename, keep a choice gate pointed at the same option. */
export function followLabel(pass: ThresholdJson, from: string, to: string): ThresholdJson {
  return pass.label === from ? { ...pass, label: to } : pass;
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// Issues → places
// ---------------------------------------------------------------------------

/**
 * Where a validation issue points. Issues from `chainIssues` start with the
 * node path, e.g. `$/0 (route "r"): no branch for "b"` or
 * `$/2 (cascade "c").tiers.quick.minConfidence: expected 0–1`.
 */
export function issueTarget(issue: string): { path: string; tier?: string } | null {
  const m = /^(\$(?:\/[^\s/:()]+)*)(?=[\s:.]|$)/.exec(issue);
  if (!m) return null;
  const tier = /\)\.tiers\.([^.\s:]+)/.exec(issue)?.[1];
  return tier ? { path: m[1]!, tier } : { path: m[1]! };
}

/** An issue with its path prefix swapped for something friendlier. */
export function issueMessage(issue: string): string {
  const m = /^\$[^\s:]*(?: \([a-z]+ "[^"]*"\))?(.*)$/.exec(issue);
  if (!m) return issue;
  return m[1]!.replace(/^[.:]\s*/, "").replace(/^([\w.]+):\s*/, "$1 · ") || issue;
}
