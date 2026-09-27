import type { Tier } from "../tiers";

/**
 * A Recipe is a decision tree. Curated examples, LLM output and share links
 * all use this one JSON shape, and every untrusted one goes through
 * `validateRecipe`.
 */
export interface Recipe {
  v: 1;
  /** "Will your breakup text jev?" */
  title: string;
  /** "your breakup text" */
  thing: string;
  root: RecipeNode;
}

export type RecipeNode = RecipeGate | RecipeRoute | RecipeRate | RecipeVerdict;

/** A yes/no question. The `pass` answer goes to `then`, the other to `otherwise`. */
export interface RecipeGate {
  kind: "gate";
  key: string;
  question: string;
  pass: "yes" | "no";
  then: RecipeNode;
  otherwise: RecipeNode;
}

/** A multiple-choice question with one branch per label. */
export interface RecipeRoute {
  kind: "route";
  key: string;
  question: string;
  /** Label to description. */
  labels: Record<string, string>;
  branches: Record<string, RecipeNode>;
}

/** A leaf that scores weighted questions and picks the tier's line. */
export interface RecipeRate {
  kind: "rate";
  key: string;
  questions: RatedQuestion[];
  verdicts: Record<Tier, string>;
}

/** A leaf with a fixed tier and line. */
export interface RecipeVerdict {
  kind: "verdict";
  tier: Tier;
  line: string;
}

/** Each rated question says which answer counts in the thing's favour. */
export type RatedQuestion =
  | { key: string; kind: "noul"; question: string; weight: number; good: boolean }
  | {
      key: string;
      kind: "score";
      question: string;
      weight: number;
      /** Lowest first. */
      levels: string[];
      good: "high" | "low";
    }
  | {
      key: string;
      kind: "choice";
      question: string;
      weight: number;
      /** Label to description. */
      labels: Record<string, string>;
      good: string[];
    };

/**
 * Tighter than jevchain's own limits on purpose. The proxy and the decomposer
 * prompt read these too, so every part of the site uses the same numbers.
 */
export const LIMITS = {
  /** Decisions (gates and routes) on any path. Rate and verdict leaves don't count. */
  depth: 10,
  nodes: 40,
  /** A gate or route asks one. A rate asks one per rated question. */
  questions: 30,
} as const;

/** String lengths, after trimming, and list sizes. */
export const CAPS = {
  title: 80,
  thing: 60,
  question: 200,
  label: 40,
  labelDescription: 120,
  level: 40,
  /** Verdict leaves and rate tier lines. */
  line: 140,
  maxWeight: 10,
  labels: { min: 2, max: 6 },
  levels: { min: 2, max: 5 },
  rateQuestions: { min: 1, max: 6 },
  key: 32,
} as const;

/** Node keys and rated question keys. */
export const KEY_PATTERN = /^[a-z0-9-]{1,32}$/;

/** Route and choice labels. */
export const LABEL_PATTERN = /^[a-z0-9-]{1,40}$/;
