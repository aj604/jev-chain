import { describe, expect, it } from "vitest";
import { bands3, gate, outcome, rate, recipe, route, yesNo } from "@/test/build";
import { desk, ladder } from "@/test/fixtures";
import { childrenOf, findOutcome, findRecipeNode, recipeShape } from "./tree";
import type { Recipe, RecipeGate, RecipeRoute } from "./types";

const end = (key: string) => outcome(key, "Done", `Ended at ${key}.`);

/**
 * A route whose first branch goes two gates deep and ends in a two-question
 * rate, and whose second branch is a one-question rate.
 */
function mixed(): Recipe {
  return recipe(
    "The Test Desk",
    "it",
    route(
      "vibe",
      "What is the vibe?",
      { calm: "Calm", loud: "Loud", odd: "Odd" },
      {
        calm: gate(
          "booked",
          "Is anything booked?",
          gate("paid", "Is it paid?", end("paid-yes"), end("paid-no")),
          rate("unbooked", [yesNo("u1", "One?", 1, true), yesNo("u2", "Two?", 1, true)], bands3("unbooked")),
        ),
        loud: rate("loud", [yesNo("l1", "Loud?", 1, true)], bands3("loud")),
        odd: end("odd"),
      },
    ),
  );
}

describe("recipeShape", () => {
  it("measures ladder(10)", () => {
    expect(recipeShape(ladder(10))).toEqual({ decisions: 10, maxDepth: 10, questions: 10, outcomes: 11 });
  });

  it("measures a route, gate and rate tree", () => {
    // vibe, booked and paid decide; vibe > booked > paid is the deepest path.
    // Three decision questions plus three rated ones. Three outcome leaves
    // and two rates of three bands.
    expect(recipeShape(mixed())).toEqual({ decisions: 3, maxDepth: 3, questions: 6, outcomes: 9 });
  });

  it("measures a lone outcome and a lone rate", () => {
    expect(recipeShape(recipe("t", "t", end("only")))).toEqual({ decisions: 0, maxDepth: 0, questions: 0, outcomes: 1 });
    const lone = recipe("t", "t", rate("r", [yesNo("a", "A?", 1, true), yesNo("b", "B?", 1, true)], bands3("r")));
    expect(recipeShape(lone)).toEqual({ decisions: 0, maxDepth: 0, questions: 2, outcomes: 3 });
  });

  it("takes the deepest path, not the first", () => {
    const shallowFirst = recipe("t", "t", gate("a", "A?", end("a-yes"), gate("b", "B?", end("b-yes"), end("b-no"))));
    expect(recipeShape(shallowFirst).maxDepth).toBe(2);
  });

  it("counts a path that ends in a rate", () => {
    // Only the rates sit two decisions down.
    const rating = (key: string) => rate(key, [yesNo(`${key}-q`, "Q?", 1, true)], bands3(key));
    const deepRate = recipe("t", "t", gate("a", "A?", gate("b", "B?", rating("r1"), rating("r2")), end("a-no")));
    expect(recipeShape(deepRate)).toEqual({ decisions: 2, maxDepth: 2, questions: 4, outcomes: 7 });
  });

  it("counts escape hatches as children", () => {
    // kind > danger > priest (unsure) is two deep; ask-dave is one.
    expect(recipeShape(desk())).toEqual({ decisions: 2, maxDepth: 2, questions: 5, outcomes: 8 });
    const deepUnsure = recipe(
      "t",
      "t",
      gate("a", "A?", end("a-yes"), end("a-no"), { unsure: gate("b", "B?", end("b-yes"), end("b-no")) }),
    );
    expect(recipeShape(deepUnsure)).toMatchObject({ decisions: 2, maxDepth: 2 });
  });
});

describe("findRecipeNode", () => {
  it("finds gates, routes and rates by key", () => {
    const r = mixed();
    expect(findRecipeNode(r, "vibe")).toBe(r.root);
    expect(findRecipeNode(r, "paid")).toMatchObject({ kind: "gate", key: "paid", question: "Is it paid?" });
    expect(findRecipeNode(r, "unbooked")).toMatchObject({ kind: "rate", key: "unbooked" });
    expect(findRecipeNode(r, "loud")).toMatchObject({ kind: "rate", key: "loud" });
    expect(findRecipeNode(ladder(10), "g7")).toMatchObject({ kind: "gate", question: "Does it stop at gate 7?" });
  });

  it("finds nodes under escape hatches", () => {
    const r = recipe(
      "t",
      "t",
      route("r", "R?", { a: "A", b: "B" }, { a: end("a"), b: end("b") }, { lowConfidence: gate("low", "Low?", end("l-yes"), end("l-no")) }),
    );
    expect(findRecipeNode(r, "low")).toMatchObject({ kind: "gate", key: "low" });
  });

  it("returns undefined for unknown keys, outcome keys and rated question keys", () => {
    const r = mixed();
    expect(findRecipeNode(r, "nope")).toBeUndefined();
    expect(findRecipeNode(r, "u1")).toBeUndefined();
    expect(findRecipeNode(r, "odd")).toBeUndefined();
    expect(findRecipeNode(r, "loud-high")).toBeUndefined();
    expect(findRecipeNode(ladder(3), "g4")).toBeUndefined();
  });
});

describe("findOutcome", () => {
  it("finds leaves and band outcomes, anywhere", () => {
    const r = desk();
    expect(findOutcome(r, "exorcist")).toMatchObject({ kind: "outcome", stamp: "Exorcist booked" });
    expect(findOutcome(r, "priest")).toMatchObject({ kind: "outcome", key: "priest" });
    expect(findOutcome(r, "ask-dave")).toMatchObject({ kind: "outcome", key: "ask-dave" });
    expect(findOutcome(r, "refund-half")).toMatchObject({ kind: "outcome", stamp: "Half refunded" });
  });

  it("narrows to leaves or bands", () => {
    const r = desk();
    expect(findOutcome(r, "drafty", "leaf")).toMatchObject({ key: "drafty" });
    expect(findOutcome(r, "refund-full", "leaf")).toBeUndefined();
    expect(findOutcome(r, "refund-full", "band")).toMatchObject({ key: "refund-full" });
    expect(findOutcome(r, "drafty", "band")).toBeUndefined();
  });

  it("returns undefined for node keys, rated question keys and unknown keys", () => {
    const r = desk();
    for (const key of ["kind", "danger", "refund", "charged-twice", "nosuch", "constructor"]) {
      expect(findOutcome(r, key), key).toBeUndefined();
    }
  });
});

describe("childrenOf", () => {
  it("lists a gate's yes, no, then unsure", () => {
    const g = (desk().root as RecipeRoute).branches.ghost as RecipeGate;
    expect(childrenOf(g).map((c) => c.kind === "outcome" && c.key)).toEqual(["evacuate", "exorcist", "priest"]);
    expect(childrenOf(ladder(1).root as RecipeGate)).toHaveLength(2);
  });

  it("lists a route's branches by label, then lowConfidence", () => {
    const r = desk().root as RecipeRoute;
    expect(childrenOf(r).map((c) => ("key" in c ? c.key : ""))).toEqual(["danger", "refund", "drafty", "ask-dave"]);
  });
});
