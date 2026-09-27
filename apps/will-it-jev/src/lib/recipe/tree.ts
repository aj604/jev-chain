import type { Recipe, RecipeGate, RecipeNode, RecipeRate, RecipeRoute } from "./types";

/** Counts over a whole recipe, measured the way `LIMITS` measures them. */
export interface RecipeShape {
  /** Gates and routes in the whole tree. */
  decisions: number;
  /** The most decisions on any root-to-leaf path. */
  maxDepth: number;
  /** Every Jev question: one per gate or route, one per rated question. */
  questions: number;
}

export function recipeShape(recipe: Recipe): RecipeShape {
  const shape: RecipeShape = { decisions: 0, maxDepth: 0, questions: 0 };
  const visit = (node: RecipeNode, depth: number) => {
    if (node.kind === "verdict") {
      shape.maxDepth = Math.max(shape.maxDepth, depth);
      return;
    }
    if (node.kind === "rate") {
      shape.questions += node.questions.length;
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

/** The gate, route or rate keyed `key`. Rated question keys don't count. */
export function findRecipeNode(
  recipe: Recipe,
  key: string,
): RecipeGate | RecipeRoute | RecipeRate | undefined {
  const search = (node: RecipeNode): RecipeGate | RecipeRoute | RecipeRate | undefined => {
    if (node.kind === "verdict") return undefined;
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

/** A decision's children in document order: then, otherwise, or the branches by label. */
function childrenOf(node: RecipeGate | RecipeRoute): RecipeNode[] {
  return node.kind === "gate" ? [node.then, node.otherwise] : Object.values(node.branches);
}
