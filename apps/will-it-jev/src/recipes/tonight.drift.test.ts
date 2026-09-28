import type { AnyNode, GateNode } from "jevchain";
import { tonight as studioTonight } from "jevchain-examples";
import { describe, expect, it } from "vitest";
import { compileRecipe } from "@/lib/recipe/compile";
import { tonight } from "./tonight";

/** One rung of a gate ladder: the gate, its question, and the answer that goes on to the next gate. */
interface Rung {
  id: string;
  question: unknown;
  onward: "yes" | "no" | null;
}

/**
 * Walks a chain of nested gates from the top. At each gate it reads which
 * answer leads to another gate, from the gate's bar: a `min` bar passes on
 * yes, a `max` bar on no. The ladder ends at the first gate with no gate
 * under its yes or no. Unsure paths are not part of the ladder.
 */
function ladder(root: AnyNode): Rung[] {
  const rungs: Rung[] = [];
  let next: AnyNode | undefined = root;
  while (next?.kind === "gate") {
    const node = next as GateNode;
    const passesOnYes = "min" in node.pass;
    const yes = passesOnYes ? node.then : node.otherwise;
    const no = passesOnYes ? node.otherwise : node.then;
    const onward: Rung["onward"] = yes?.kind === "gate" ? "yes" : no?.kind === "gate" ? "no" : null;
    rungs.push({ id: node.id, question: node.ask.instructions, onward });
    next = onward === "yes" ? yes : onward === "no" ? no : undefined;
  }
  return rungs;
}

/**
 * The site's tonight recipe and the studio's tonight example ask the same
 * ten questions, in the same order, and carry on down the ladder on the same
 * answer. Their leaves differ on purpose: the studio grades the plan and the
 * site files paperwork for it.
 */
describe("the studio's tonight example", () => {
  it("asks the same ladder of questions as the compiled tonight recipe", () => {
    const site = ladder(compileRecipe(tonight.recipe));
    expect(site).toHaveLength(10);
    expect(ladder(studioTonight)).toStrictEqual(site);
  });

  it("carries on at every rung on no, so a plan with no hazards asks all ten", () => {
    expect(ladder(studioTonight).map((r) => r.onward)).toEqual([...Array(9).fill("no"), null]);
  });
});
