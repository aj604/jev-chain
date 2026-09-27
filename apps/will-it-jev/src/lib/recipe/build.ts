import type { Tier } from "../tiers";
import type {
  RatedQuestion,
  Recipe,
  RecipeGate,
  RecipeNode,
  RecipeRate,
  RecipeRoute,
  RecipeVerdict,
} from "./types";

/**
 * Builders for writing recipes by hand. Each returns a plain object, so a
 * built recipe is the same JSON the validator and share links see. They
 * check nothing: run the result through `validateRecipe`.
 */

export function recipe(title: string, thing: string, root: RecipeNode): Recipe {
  return { v: 1, title, thing, root };
}

export function verdict(tier: Tier, line: string): RecipeVerdict {
  return { kind: "verdict", tier, line };
}

export function gate(
  key: string,
  question: string,
  pass: "yes" | "no",
  then: RecipeNode,
  otherwise: RecipeNode,
): RecipeGate {
  return { kind: "gate", key, question, pass, then, otherwise };
}

/** The label names carry through, so `branches` must cover exactly `labels`. */
export function route<const L extends string>(
  key: string,
  question: string,
  labels: Record<L, string>,
  branches: Record<NoInfer<L>, RecipeNode>,
): RecipeRoute {
  return { kind: "route", key, question, labels, branches };
}

export function rate(key: string, questions: RatedQuestion[], verdicts: Record<Tier, string>): RecipeRate {
  return { kind: "rate", key, questions, verdicts };
}

/** A rated yes/no. `good` is the answer that counts in the thing's favour. */
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

/** A rated choice. `good` lists the labels that count in the thing's favour. */
export function pick<const L extends string>(
  key: string,
  question: string,
  weight: number,
  labels: Record<L, string>,
  good: NoInfer<L>[],
): RatedQuestion {
  return { key, kind: "choice", question, weight, labels, good };
}
