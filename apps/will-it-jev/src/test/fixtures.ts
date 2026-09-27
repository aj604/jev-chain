import { gate, recipe, verdict } from "@/lib/recipe/build";
import type { Recipe, RecipeNode } from "@/lib/recipe/types";

/**
 * `depth` nested gates keyed g1..gN. Each continues on `pass` and otherwise
 * ends at "It does not jev at gate N.". The innermost child is "It jevs.".
 */
export function ladder(depth: number, pass: "yes" | "no" = "no"): Recipe {
  let node: RecipeNode = verdict("jevs", "It jevs.");
  for (let n = depth; n >= 1; n--) {
    node = gate(
      `g${n}`,
      `Does it stop at gate ${n}?`,
      pass,
      node,
      verdict("nope", `It does not jev at gate ${n}.`),
    );
  }
  return recipe("Will the ladder jev?", "the ladder", node);
}
