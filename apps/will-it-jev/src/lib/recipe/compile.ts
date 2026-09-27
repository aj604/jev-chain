import { ask, choice, emit, gate, noul, score, type AnyNode, type Question, type RouteNode } from "jevchain";
import type { RatedQuestion, Recipe, RecipeNode } from "./types";

/**
 * Turns a recipe into a jevchain chain, one node per recipe node. It adds no
 * step nodes and no handlers, so the result serializes with empty `refs`,
 * loads back with `fromJSON` and prints with `toTypeScript`.
 *
 * - A gate asks `noul(question)`. Yes passes at `{ min: 0.5 }` and no at
 *   `{ max: 0.5 }`. The bar is inclusive, so exactly 0.5 takes the passing
 *   side. There is no `unsure` branch, so a run never halts at a gate.
 * - A route asks `choice(question, labels)` with one branch per label.
 * - A rate is one ask titled "Rating", its questions keyed by their keys.
 * - A verdict emits `{ tier, line }`, titled with the line.
 *
 * Gates, routes and rates keep their recipe keys as ids. A verdict's id is
 * `<gate>-then` or `<gate>-otherwise` under a gate, `<route>-<label>` under a
 * route, and `verdict` when the whole recipe is one verdict. When that id is
 * also a recipe key or another verdict's id, `verdictIds` resolves the clash.
 *
 * Expects a recipe that passed `validateRecipe`, so keys are unique.
 */
export function compileRecipe(recipe: Recipe): AnyNode {
  const claim = verdictIds(recipe.root);
  const compile = (node: RecipeNode, id: string): AnyNode => {
    switch (node.kind) {
      case "verdict":
        return emit({ tier: node.tier, line: node.line }, { id: claim(id), title: node.line });
      case "gate":
        return gate(node.key, {
          title: node.question,
          ask: noul(node.question),
          pass: node.pass === "yes" ? { min: 0.5 } : { max: 0.5 },
          then: compile(node.then, `${node.key}-then`),
          otherwise: compile(node.otherwise, `${node.key}-otherwise`),
        });
      case "route": {
        // Built by hand: `route()` checks branches against literal label
        // types, and these labels are only known at run time.
        const routeNode: RouteNode = {
          kind: "route",
          id: node.key,
          title: node.question,
          ask: choice(node.question, node.labels),
          branches: Object.fromEntries(
            Object.entries(node.branches).map(([label, child]) => [label, compile(child, `${node.key}-${label}`)]),
          ),
        };
        return routeNode;
      }
      case "rate":
        return ask(node.key, {
          title: "Rating",
          questions: Object.fromEntries(node.questions.map((q) => [q.key, ratedQuestion(q)])),
        });
    }
  };
  return compile(recipe.root, "verdict");
}

function ratedQuestion(q: RatedQuestion): Question {
  switch (q.kind) {
    case "noul":
      return noul(q.question);
    case "score":
      // The validator guarantees at least two levels.
      return score(q.question, q.levels as [string, string, ...string[]]);
    case "choice":
      return choice(q.question, q.labels);
  }
}

/**
 * Hands out verdict ids. Call it with each verdict's spec'd id in document
 * order, the order `compileRecipe` walks in.
 *
 * Recipe keys are ids already, so they are never renamed. A verdict keeps its
 * spec'd id unless a recipe key or an earlier verdict has it. Then it gets
 * the lowest free `-2`, `-3`, ... suffix. Suffixes skip every spec'd id, so
 * a clash never renames a verdict that had none.
 */
function verdictIds(root: RecipeNode): (id: string) => string {
  const keys = new Set<string>();
  const wanted = new Set<string>();
  const visit = (node: RecipeNode, id: string) => {
    if (node.kind === "verdict") {
      wanted.add(id);
      return;
    }
    keys.add(node.key);
    if (node.kind === "gate") {
      visit(node.then, `${node.key}-then`);
      visit(node.otherwise, `${node.key}-otherwise`);
    } else if (node.kind === "route") {
      for (const [label, child] of Object.entries(node.branches)) visit(child, `${node.key}-${label}`);
    }
  };
  visit(root, "verdict");

  const taken = keys;
  return (id) => {
    let free = id;
    for (let n = 2; taken.has(free) || (free !== id && wanted.has(free)); n++) free = `${id}-${n}`;
    taken.add(free);
    return free;
  };
}
