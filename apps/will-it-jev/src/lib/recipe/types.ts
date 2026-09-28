/**
 * A Recipe is a small dispatch desk: a decision tree that routes the thing
 * someone wrote to one specific outcome. Curated examples, LLM output and
 * share links all use this one JSON shape, and every untrusted one goes
 * through `validateRecipe`.
 *
 * There is no pass or fail. A run that reaches an outcome "jevs": the thing
 * was turned into gates and Jev decided every one of them. The outcome is
 * where it ended up.
 */
export interface Recipe {
  v: 2;
  /** The desk, as an institution: "The Breakup Text Dispatch Desk". */
  title: string;
  /** "your breakup text" */
  thing: string;
  root: RecipeNode;
}

export type RecipeNode = RecipeGate | RecipeRoute | RecipeRate | RecipeOutcome;

/**
 * A yes/no question. Yes goes to `yes`, no to `no`. `means` describes each
 * answer to Jev, the way jevchain's `noul(q, { true, false })` does, and is
 * where much of the comedy lives. `unsure` catches an answer within 0.1 of
 * 50/50.
 */
export interface RecipeGate {
  kind: "gate";
  key: string;
  /** A short node title for the graph: "Furniture named?" */
  title: string;
  question: string;
  means?: { yes: string; no: string };
  yes: RecipeNode;
  no: RecipeNode;
  unsure?: RecipeNode;
}

/**
 * A multiple-choice question with one branch per label. `lowConfidence`
 * catches a winning label under 40%: the "Probably Dave" branch.
 */
export interface RecipeRoute {
  kind: "route";
  key: string;
  title: string;
  question: string;
  /** Label to description. The descriptions are a sober taxonomy of ridiculous things. */
  labels: Record<string, string>;
  branches: Record<string, RecipeNode>;
  lowConfidence?: RecipeNode;
}

/**
 * A leaf that scores weighted questions from 0 to 1 and picks the first band
 * the score reaches. Bands are highest first and the last is `atLeast: 0`,
 * so every score lands somewhere. The score itself is shown.
 */
export interface RecipeRate {
  kind: "rate";
  key: string;
  title: string;
  questions: RatedQuestion[];
  bands: { atLeast: number; outcome: RecipeOutcome }[];
}

/**
 * Where the thing ended up. `stamp` is the short official mark ("Exorcist
 * booked"); `line` is the notice ("Booked: one (1) exorcist. Please remove
 * fragile items from the countertop."). The key names the outcome in share
 * link queries, so it is unique across the tree like every other key.
 */
export interface RecipeOutcome {
  kind: "outcome";
  key: string;
  stamp: string;
  line: string;
}

/** Each rated question says which answer pushes the score up. */
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

/** jevchain settings the compiler uses for the optional escape hatches. */
export const ESCAPE = {
  /** A route whose winning label is under this goes to `lowConfidence`. */
  lowConfidenceBelow: 0.4,
  /** A gate within this of 0.5 goes to `unsure`. */
  unsureMargin: 0.1,
} as const;

/**
 * Tighter than jevchain's own limits on purpose. The proxy and the decomposer
 * prompt read these too, so every part of the site uses the same numbers.
 */
export const LIMITS = {
  /** Decisions (gates and routes) on any path. Rate and outcome leaves don't count. */
  depth: 10,
  nodes: 40,
  /** A gate or route asks one. A rate asks one per rated question. */
  questions: 30,
} as const;

/** String lengths, after trimming, and list sizes. */
export const CAPS = {
  title: 80,
  thing: 60,
  nodeTitle: 40,
  question: 200,
  /** Each of a gate's `means`. */
  means: 120,
  label: 40,
  labelDescription: 120,
  level: 40,
  stamp: 32,
  /** An outcome's notice. */
  line: 160,
  maxWeight: 10,
  labels: { min: 2, max: 6 },
  levels: { min: 2, max: 5 },
  rateQuestions: { min: 1, max: 6 },
  bands: { min: 2, max: 4 },
  key: 32,
  /** The visitor's text, which a run sends to Jev unchanged as `state`. */
  input: 2000,
} as const;

/** Node keys, outcome keys and rated question keys. */
export const KEY_PATTERN = /^[a-z0-9-]{1,32}$/;

/** Route and choice labels. */
export const LABEL_PATTERN = /^[a-z0-9-]{1,40}$/;
