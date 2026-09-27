import { describe, expect, it } from "vitest";
import { ladder } from "@/test/fixtures";
import { gate, rate, recipe, route, verdict, yesNo } from "./build";
import { findRecipeNode, recipeShape } from "./tree";
import type { Recipe } from "./types";

const VERDICTS = { jevs: "It jevs.", kinda: "It sort of jevs.", nope: "It does not jev." };

/**
 * A route whose first branch goes two gates deep and ends in a two-question
 * rate, and whose second branch is a one-question rate.
 */
function mixed(): Recipe {
  return recipe(
    "Will it jev?",
    "it",
    route(
      "vibe",
      "What is the vibe?",
      { calm: "Calm", loud: "Loud", odd: "Odd" },
      {
        calm: gate(
          "booked",
          "Is anything booked?",
          "yes",
          gate("paid", "Is it paid?", "yes", verdict("jevs", "Yes."), verdict("nope", "No.")),
          rate("unbooked", [yesNo("u1", "One?", 1, true), yesNo("u2", "Two?", 1, true)], VERDICTS),
        ),
        loud: rate("loud", [yesNo("l1", "Loud?", 1, true)], VERDICTS),
        odd: verdict("kinda", "Odd."),
      },
    ),
  );
}

describe("recipeShape", () => {
  it("measures ladder(10)", () => {
    expect(recipeShape(ladder(10))).toEqual({ decisions: 10, maxDepth: 10, questions: 10 });
  });

  it("measures a route, gate and rate tree", () => {
    // vibe, booked and paid decide; vibe > booked > paid is the deepest path.
    // Three decision questions plus three rated ones.
    expect(recipeShape(mixed())).toEqual({ decisions: 3, maxDepth: 3, questions: 6 });
  });

  it("measures a lone verdict and a lone rate", () => {
    expect(recipeShape(recipe("t", "t", verdict("jevs", "Yes.")))).toEqual({ decisions: 0, maxDepth: 0, questions: 0 });
    const lone = recipe("t", "t", rate("r", [yesNo("a", "A?", 1, true), yesNo("b", "B?", 1, true)], VERDICTS));
    expect(recipeShape(lone)).toEqual({ decisions: 0, maxDepth: 0, questions: 2 });
  });

  it("takes the deepest path, not the first", () => {
    const shallowFirst = recipe(
      "t",
      "t",
      gate("a", "A?", "yes", verdict("jevs", "Yes."), gate("b", "B?", "yes", verdict("jevs", "Yes."), verdict("nope", "No."))),
    );
    expect(recipeShape(shallowFirst).maxDepth).toBe(2);
  });

  it("counts a path that ends in a rate", () => {
    // Only the rates sit two decisions down.
    const rating = (key: string) => rate(key, [yesNo(`${key}-q`, "Q?", 1, true)], VERDICTS);
    const deepRate = recipe(
      "t",
      "t",
      gate("a", "A?", "yes", gate("b", "B?", "yes", rating("r1"), rating("r2")), verdict("nope", "No.")),
    );
    expect(recipeShape(deepRate)).toEqual({ decisions: 2, maxDepth: 2, questions: 4 });
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

  it("returns undefined for unknown keys and rated question keys", () => {
    const r = mixed();
    expect(findRecipeNode(r, "nope")).toBeUndefined();
    expect(findRecipeNode(r, "u1")).toBeUndefined();
    expect(findRecipeNode(ladder(3), "g4")).toBeUndefined();
    expect(findRecipeNode(recipe("t", "t", verdict("jevs", "Yes.")), "verdict")).toBeUndefined();
  });
});
