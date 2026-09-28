import type {
  RatedQuestion,
  Recipe,
  RecipeGate,
  RecipeNode,
  RecipeOutcome,
  RecipeRate,
  RecipeRoute,
} from "./types";

/**
 * Builders for writing recipes by hand. Each returns a plain object with no
 * undefined fields, so a built recipe is the same JSON the validator and
 * share links see. They check nothing: run the result through
 * `validateRecipe`.
 */

/** `title` is the desk, as an institution: "The Breakup Text Dispatch Desk". */
export function recipe(title: string, thing: string, root: RecipeNode): Recipe {
  return { v: 2, title, thing, root };
}

/** Where the thing ends up. `stamp` is the official mark, `line` the notice. */
export function outcome(key: string, stamp: string, line: string): RecipeOutcome {
  return { kind: "outcome", key, stamp, line };
}

/**
 * A yes/no question. `means` describes each answer to Jev; `unsure` catches
 * an answer too close to 50/50 to call.
 */
export function gate(
  key: string,
  title: string,
  question: string,
  paths: {
    yes: RecipeNode;
    no: RecipeNode;
    means?: { yes: string; no: string };
    unsure?: RecipeNode;
  },
): RecipeGate {
  return {
    kind: "gate",
    key,
    title,
    question,
    ...(paths.means ? { means: { yes: paths.means.yes, no: paths.means.no } } : {}),
    yes: paths.yes,
    no: paths.no,
    ...(paths.unsure ? { unsure: paths.unsure } : {}),
  };
}

/**
 * A multiple-choice question. The label names carry through, so `branches`
 * must cover exactly `labels`. `lowConfidence` catches a winning label Jev
 * is not sure of: the "Probably Dave" branch.
 */
export function route<const L extends string>(
  key: string,
  title: string,
  question: string,
  labels: Record<L, string>,
  branches: Record<NoInfer<L>, RecipeNode>,
  lowConfidence?: RecipeNode,
): RecipeRoute {
  return {
    kind: "route",
    key,
    title,
    question,
    labels,
    branches,
    ...(lowConfidence ? { lowConfidence } : {}),
  };
}

/**
 * A leaf that scores its questions from 0 to 1 and lands on the first band
 * the score reaches. Give bands highest first as `[atLeast, outcome]`, the
 * last at 0.
 */
export function rate(
  key: string,
  title: string,
  questions: RatedQuestion[],
  bands: [atLeast: number, outcome: RecipeOutcome][],
): RecipeRate {
  return { kind: "rate", key, title, questions, bands: bands.map(([atLeast, o]) => ({ atLeast, outcome: o })) };
}

/** A rated yes/no. `good` is the answer that pushes the score up. */
export function yesNo(key: string, question: string, weight: number, good: boolean): RatedQuestion {
  return { key, kind: "noul", question, weight, good };
}

/** A rated scale. `levels` go lowest first. */
export function scale(
  key: string,
  question: string,
  weight: number,
  levels: string[],
  good: "high" | "low",
): RatedQuestion {
  return { key, kind: "score", question, weight, levels, good };
}

/** A rated choice. `good` lists the labels that push the score up. */
export function pick<const L extends string>(
  key: string,
  question: string,
  weight: number,
  labels: Record<L, string>,
  good: NoInfer<L>[],
): RatedQuestion {
  return { key, kind: "choice", question, weight, labels, good };
}
