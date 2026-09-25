/**
 * Questions and answers: the typed vocabulary Jev speaks.
 *
 * These mirror TypeSafe's `POST /v1/systemone` wire format exactly, so a
 * question built here is sent to the API untouched. The generics exist only
 * to carry your labels through to the answer types.
 */

/** Any JSON value. */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** Text, a JSON object, or a JSON array: what Jev accepts for state, instructions and criteria. */
export type Entry = string | { [key: string]: Json } | Json[] | null;

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

/** Pick exactly one of your labels. */
export interface ChoiceQuestion<L extends string = string> {
  readonly type: "choice";
  readonly instructions?: Entry;
  readonly criteria: { readonly [K in L]: Entry };
}

/** Rate against an ordered rubric (2–10 levels). */
export interface ScoreQuestion {
  readonly type: "score";
  readonly instructions?: Entry;
  readonly criteria: readonly Entry[];
}

/** A yes/no question. The answer is the probability of "yes". */
export interface NoulQuestion {
  readonly type: "noul";
  readonly instructions?: Entry;
  readonly criteria?: { readonly true?: Entry; readonly false?: Entry };
}

export type Question = ChoiceQuestion<string> | ScoreQuestion | NoulQuestion;

/** Questions keyed by the names you want the answers under. */
export type Questions = { readonly [key: string]: Question };

/** The label union of a choice question (`never` for other kinds). */
export type LabelsOf<Q> = Q extends ChoiceQuestion<infer L> ? L : never;

/**
 * Ask Jev to pick one option.
 *
 * ```ts
 * choice("Which team?", { billing: "money stuff", bug: null })
 * choice("Which team?", ["billing", "bug"])
 * ```
 * The labels come back as a literal union, not `string`.
 */
export function choice<const L extends string>(instructions: Entry, labels: readonly L[]): ChoiceQuestion<L>;
export function choice<const C extends { readonly [label: string]: Entry }>(
  instructions: Entry,
  criteria: C,
): ChoiceQuestion<Extract<keyof C, string>>;
export function choice(
  instructions: Entry,
  criteria: readonly string[] | { readonly [label: string]: Entry },
): ChoiceQuestion<string> {
  const normalized: Record<string, Entry> = Array.isArray(criteria)
    ? Object.fromEntries((criteria as readonly string[]).map((label) => [label, null]))
    : { ...(criteria as Record<string, Entry>) };
  const count = Object.keys(normalized).length;
  if (count < 2) throw new TypeError(`choice(): needs at least 2 options, got ${count}`);
  if (count > 255) throw new TypeError(`choice(): TypeSafe allows at most 255 options, got ${count}`);
  return { type: "choice", instructions, criteria: normalized };
}

/**
 * Ask Jev to rate something on an ordered rubric, lowest level first.
 *
 * ```ts
 * score("How spicy is this take?", ["mild", "medium", "call the fire department"])
 * ```
 */
export function score(instructions: Entry, levels: readonly [Entry, Entry, ...Entry[]]): ScoreQuestion {
  if (levels.length > 10) throw new TypeError(`score(): TypeSafe allows at most 10 levels, got ${levels.length}`);
  return { type: "score", instructions, criteria: [...levels] };
}

/**
 * Ask Jev a yes/no question. You get back the probability of "yes".
 *
 * ```ts
 * noul("Is the user blocked right now?", { true: "cannot do their job", false: "mild inconvenience" })
 * ```
 */
export function noul(instructions: Entry, criteria?: { true?: Entry; false?: Entry }): NoulQuestion {
  return criteria ? { type: "noul", instructions, criteria: { ...criteria } } : { type: "noul", instructions };
}

// ---------------------------------------------------------------------------
// Answers
// ---------------------------------------------------------------------------

export interface ChoiceAnswer<L extends string = string> {
  readonly type: "choice";
  /** The highest-probability label. */
  readonly choice: L;
  /** Every label mapped to its probability (sums to 1). */
  readonly probabilities: { readonly [K in L]: number };
  /** 0–1 certainty derived from the distribution; 0 is uniform, 1 is all-in. */
  readonly confidence: number;
}

export interface ScoreAnswer {
  readonly type: "score";
  /** Probability-weighted level; can land between levels. */
  readonly score: number;
  /** Level index (as a string) mapped to its probability. */
  readonly probabilities: { readonly [level: string]: number };
  /** Level index (as a string) mapped back to its description. */
  readonly legend: { readonly [level: string]: Entry };
  readonly confidence: number;
}

export interface NoulAnswer {
  readonly type: "noul";
  /** Probability that the answer is yes, 0–1. */
  readonly noul: number;
}

export type Answer = ChoiceAnswer<string> | ScoreAnswer | NoulAnswer;

/** The answer type for a given question type. */
export type AnswerOf<Q> = Q extends ChoiceQuestion<infer L>
  ? ChoiceAnswer<L>
  : Q extends ScoreQuestion
    ? ScoreAnswer
    : Q extends NoulQuestion
      ? NoulAnswer
      : never;

/** Answers keyed like the questions that produced them. */
export type Answers<Q extends Questions> = { readonly [K in keyof Q]: AnswerOf<Q[K]> };

/**
 * A 0–1 "how sure is it" number for any answer.
 *
 * Choice and score answers carry Jev's own confidence. Nouls don't, so we use
 * distance from a coin flip: 0.5 → 0, 0.0 or 1.0 → 1.
 */
export function confidenceOf(answer: Answer): number {
  return answer.type === "noul" ? distance(answer.noul, 0.5) * 2 : answer.confidence;
}

/**
 * How far apart two numbers are, as the decimal they differ by.
 *
 * Subtracting doubles leaves noise: 2.9 − 2.5 is 0.3999999999999999, and
 * 0.8 − 0.7 is 0.10000000000000009. Compared raw, a value exactly `margin`
 * from a bar lands inside the margin on one side and outside it on the other.
 * Rounded to 12 significant digits of the larger operand (plenty finer than
 * any difference an answer carries, plenty coarser than the noise), a value
 * that is exactly `margin` away measures as exactly `margin`.
 */
export function distance(a: number, b: number): number {
  const d = Math.abs(a - b);
  if (!Number.isFinite(d)) return d;
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  const places = Math.min(100, Math.max(0, 12 - Math.ceil(Math.log10(scale))));
  return Number(d.toFixed(places));
}

/** Validate a question object at runtime (used when loading chains from JSON). */
export function questionIssues(question: unknown, path: string): string[] {
  const issues: string[] = [];
  if (!question || typeof question !== "object") return [`${path}: expected a question object`];
  const q = question as Record<string, unknown>;
  switch (q.type) {
    case "choice": {
      const c = q.criteria;
      if (!c || typeof c !== "object" || Array.isArray(c)) issues.push(`${path}.criteria: expected an object of labels`);
      else if (Object.keys(c).length < 2) issues.push(`${path}.criteria: a choice needs at least 2 labels`);
      else if (Object.keys(c).length > 255) issues.push(`${path}.criteria: at most 255 labels`);
      break;
    }
    case "score": {
      const c = q.criteria;
      if (!Array.isArray(c)) issues.push(`${path}.criteria: expected an array of levels`);
      else if (c.length < 2 || c.length > 10) issues.push(`${path}.criteria: a score needs 2–10 levels`);
      break;
    }
    case "noul":
      break;
    default:
      issues.push(`${path}.type: expected "choice", "score" or "noul"`);
  }
  return issues;
}
