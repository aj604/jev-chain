import type { Recipe, RecipeGate, RecipeNode, RecipeOutcome, RecipeRate, RecipeRoute } from "./types";

/** Counts over a whole recipe, measured the way `LIMITS` measures them. */
export interface RecipeShape {
  /** Gates and routes in the whole tree. */
  decisions: number;
  /** The most decisions on any root-to-leaf path. */
  maxDepth: number;
  /** Every Jev question: one per gate or route, one per rated question. */
  questions: number;
  /** Every place a run can end: outcome leaves and rate bands. */
  outcomes: number;
}

export function recipeShape(recipe: Recipe): RecipeShape {
  const shape: RecipeShape = { decisions: 0, maxDepth: 0, questions: 0, outcomes: 0 };
  const visit = (node: RecipeNode, depth: number) => {
    if (node.kind === "outcome") {
      shape.outcomes++;
      shape.maxDepth = Math.max(shape.maxDepth, depth);
      return;
    }
    if (node.kind === "rate") {
      shape.questions += node.questions.length;
      shape.outcomes += node.bands.length;
      shape.maxDepth = Math.max(shape.maxDepth, depth);
      return;
    }
    shape.decisions++;
    shape.questions++;
    for (const child of childrenOf(node)) visit(child, depth + 1);
  };
  visit(recipe.root, 0);
  return shape;
}

/** The gate, route or rate keyed `key`. Outcome and rated question keys don't count. */
export function findRecipeNode(
  recipe: Recipe,
  key: string,
): RecipeGate | RecipeRoute | RecipeRate | undefined {
  const search = (node: RecipeNode): RecipeGate | RecipeRoute | RecipeRate | undefined => {
    if (node.kind === "outcome") return undefined;
    if (node.key === key) return node;
    if (node.kind === "rate") return undefined;
    for (const child of childrenOf(node)) {
      const found = search(child);
      if (found) return found;
    }
    return undefined;
  };
  return search(recipe.root);
}

/**
 * The outcome keyed `key`, as a leaf of the tree or a rate's band. `where`
 * narrows it to leaves only (what an emit can be) or bands only.
 */
export function findOutcome(
  recipe: Recipe,
  key: string,
  where: "any" | "leaf" | "band" = "any",
): RecipeOutcome | undefined {
  const search = (node: RecipeNode): RecipeOutcome | undefined => {
    if (node.kind === "outcome") return where !== "band" && node.key === key ? node : undefined;
    if (node.kind === "rate") {
      return where === "leaf" ? undefined : node.bands.find((b) => b.outcome.key === key)?.outcome;
    }
    for (const child of childrenOf(node)) {
      const found = search(child);
      if (found) return found;
    }
    return undefined;
  };
  return search(recipe.root);
}

/**
 * A decision's children in document order: yes, no, then unsure; or the
 * branches by label, then lowConfidence. The same order as jevchain's edges.
 */
export function childrenOf(node: RecipeGate | RecipeRoute): RecipeNode[] {
  if (node.kind === "gate") return node.unsure ? [node.yes, node.no, node.unsure] : [node.yes, node.no];
  const branches = Object.values(node.branches);
  return node.lowConfidence ? [...branches, node.lowConfidence] : branches;
}
