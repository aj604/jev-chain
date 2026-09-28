import type {
  RatedQuestion,
  Recipe,
  RecipeGate,
  RecipeNode,
  RecipeOutcome,
  RecipeRate,
  RecipeRoute,
} from "@/lib/recipe/types";

/**
 * Recipe builders for tests. `src/lib/recipe/build.ts` is for curated
 * recipes and changes with them; these stay put so the lib tests don't. Each
 * returns plain JSON and checks nothing. Titles default to the key.
 */

export function recipe(title: string, thing: string, root: RecipeNode): Recipe {
  return { v: 2, title, thing, root };
}

export function outcome(key: string, stamp: string, line: string): RecipeOutcome {
  return { kind: "outcome", key, stamp, line };
}

export function gate(
  key: string,
  question: string,
  yes: RecipeNode,
  no: RecipeNode,
  opts: { title?: string; means?: { yes: string; no: string }; unsure?: RecipeNode } = {},
): RecipeGate {
  return {
    kind: "gate",
    key,
    title: opts.title ?? key,
    question,
    ...(opts.means ? { means: opts.means } : {}),
    yes,
    no,
    ...(opts.unsure ? { unsure: opts.unsure } : {}),
  };
}

/** The label names carry through, so `branches` must cover exactly `labels`. */
export function route<const L extends string>(
  key: string,
  question: string,
  labels: Record<L, string>,
  branches: Record<NoInfer<L>, RecipeNode>,
  opts: { title?: string; lowConfidence?: RecipeNode } = {},
): RecipeRoute {
  return {
    kind: "route",
    key,
    title: opts.title ?? key,
    question,
    labels,
    branches,
    ...(opts.lowConfidence ? { lowConfidence: opts.lowConfidence } : {}),
  };
}

/** `bands` as `[atLeast, outcome]` pairs, highest first. */
export function rate(
  key: string,
  questions: RatedQuestion[],
  bands: [number, RecipeOutcome][],
  opts: { title?: string } = {},
): RecipeRate {
  return {
    kind: "rate",
    key,
    title: opts.title ?? key,
    questions,
    bands: bands.map(([atLeast, o]) => ({ atLeast, outcome: o })),
  };
}

/** Three bands at 0.66, 0.4 and 0, with outcome keys `<key>-high`, `-mid` and `-low`. */
export function bands3(key: string): [number, RecipeOutcome][] {
  return [
    [0.66, outcome(`${key}-high`, "High", `Scored high at ${key}.`)],
    [0.4, outcome(`${key}-mid`, "Middling", `Scored in the middle at ${key}.`)],
    [0, outcome(`${key}-low`, "Low", `Scored low at ${key}.`)],
  ];
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
