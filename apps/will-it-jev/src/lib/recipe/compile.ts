import { ask, choice, emit, gate, noul, score, type AnyNode, type Question, type RouteNode } from "jevchain";
import { ESCAPE, type RatedQuestion, type Recipe, type RecipeGate, type RecipeNode } from "./types";

/**
 * Turns a recipe into a jevchain chain, one node per recipe node. It adds no
 * step nodes and no handlers, so the result serializes with empty `refs`,
 * loads back with `fromJSON` and prints with `toTypeScript`.
 *
 * - A gate asks `noul(question, { true: means.yes, false: means.no })` (no
 *   criteria without `means`). Yes passes at `{ min: 0.5 }` to `yes`, and
 *   anything under goes to `no`. The bar is inclusive, so exactly 0.5 is
 *   yes. With `unsure`, an answer within `ESCAPE.unsureMargin` of 0.5 goes
 *   there instead. There is always a `no` branch, so a run never halts.
 * - A route asks `choice(question, labels)` with one branch per label. With
 *   `lowConfidence`, a confidence under `ESCAPE.lowConfidenceBelow` goes there.
 * - A rate is one ask, titled with its title, its questions keyed by their
 *   keys. The band is picked after the run, from the answers.
 * - An outcome emits `{ key, stamp, line }`, titled with its stamp.
 *
 * Every node keeps its recipe key as its id. Keys are unique across the
 * tree, so ids are too.
 *
 * Expects a recipe that passed `validateRecipe`.
 */
export function compileRecipe(recipe: Recipe): AnyNode {
  return compileNode(recipe.root);
}

function compileNode(node: RecipeNode): AnyNode {
  switch (node.kind) {
    case "outcome":
      return emit({ key: node.key, stamp: node.stamp, line: node.line }, { id: node.key, title: node.stamp });
    case "gate":
      return gate(node.key, {
        title: node.title,
        ask: gateQuestion(node),
        pass: { min: 0.5 },
        then: compileNode(node.yes),
        otherwise: compileNode(node.no),
        ...(node.unsure ? { unsure: { margin: ESCAPE.unsureMargin, then: compileNode(node.unsure) } } : {}),
      });
    case "route": {
      // Built by hand: `route()` checks branches against literal label
      // types, and these labels are only known at run time.
      const routeNode: RouteNode = {
        kind: "route",
        id: node.key,
        title: node.title,
        ask: choice(node.question, node.labels),
        branches: Object.fromEntries(
          Object.entries(node.branches).map(([label, child]) => [label, compileNode(child)]),
        ),
        ...(node.lowConfidence
          ? { lowConfidence: { below: ESCAPE.lowConfidenceBelow, then: compileNode(node.lowConfidence) } }
          : {}),
      };
      return routeNode;
    }
    case "rate":
      return ask(node.key, {
        title: node.title,
        questions: Object.fromEntries(node.questions.map((q) => [q.key, ratedQuestion(q)])),
      });
  }
}

function gateQuestion(node: RecipeGate): Question {
  return node.means ? noul(node.question, { true: node.means.yes, false: node.means.no }) : noul(node.question);
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
