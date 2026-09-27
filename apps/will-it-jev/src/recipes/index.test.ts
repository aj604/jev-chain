import { chainIssues, run, toJSON, type Answer, type Question } from "jevchain";
import { describe, expect, it } from "vitest";
import { TIER_TEXT } from "@/lib/copy";
import { compileRecipe } from "@/lib/recipe/compile";
import { recipeShape } from "@/lib/recipe/tree";
import type { RecipeNode } from "@/lib/recipe/types";
import { validateRecipe } from "@/lib/recipe/validate";
import { verdictOf } from "@/lib/recipe/verdict";
import { TIERS, type Tier } from "@/lib/tiers";
import { fakeJev, type Oracle } from "@/test/fake-jev";
import {
  CURATED,
  breakup,
  excuse,
  getCurated,
  pullRequest,
  slack,
  startup,
  tonight,
  tweet,
  weddingSpeech,
  type CuratedRecipe,
} from ".";

const each = CURATED.map((c) => [c.slug, c] as const);

/** Every noul says 0.9, every score the top level, every choice the last label. */
const agreeable: Oracle = (q: Question): Partial<Answer> => {
  if (q.type === "noul") return { noul: 0.9 };
  if (q.type === "score") {
    const top = q.criteria.length - 1;
    const probabilities = Object.fromEntries(q.criteria.map((_, i) => [String(i), i === top ? 1 : 0]));
    return { score: top, probabilities } as Partial<Answer>;
  }
  const labels = Object.keys(q.criteria);
  return { choice: labels[labels.length - 1] } as Partial<Answer>;
};

/** Every verdict line in the tree: verdict leaves and rate tier lines. */
function lines(node: RecipeNode): { tier: Tier; line: string }[] {
  switch (node.kind) {
    case "verdict":
      return [{ tier: node.tier, line: node.line }];
    case "rate":
      return TIERS.map((tier) => ({ tier, line: node.verdicts[tier] }));
    case "gate":
      return [...lines(node.then), ...lines(node.otherwise)];
    case "route":
      return Object.values(node.branches).flatMap(lines);
  }
}

async function runSample(c: CuratedRecipe, input: string, oracle?: Oracle) {
  const { client } = fakeJev(oracle);
  const result = await run(compileRecipe(c.recipe), input, { jev: client });
  return verdictOf(c.recipe, result);
}

describe("CURATED", () => {
  it("holds the eight recipes in display order", () => {
    expect(CURATED.map((c) => c.slug)).toEqual([
      "breakup-text",
      "tweet",
      "excuse",
      "slack-message",
      "startup",
      "pull-request",
      "tonight",
      "wedding-speech",
    ]);
    expect(CURATED).toEqual([breakup, tweet, excuse, slack, startup, pullRequest, tonight, weddingSpeech]);
  });

  it("has unique slugs that fit in a share link", () => {
    const slugs = CURATED.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9-]{1,40}$/);
  });
});

describe("getCurated", () => {
  it("finds a recipe by slug", () => {
    expect(getCurated("tonight")).toBe(tonight);
    for (const c of CURATED) expect(getCurated(c.slug)).toBe(c);
  });

  it("gives undefined for anything else", () => {
    expect(getCurated("nope")).toBeUndefined();
    expect(getCurated("")).toBeUndefined();
    expect(getCurated(null)).toBeUndefined();
    expect(getCurated(undefined)).toBeUndefined();
  });
});

describe.each(each)("%s", (_slug, c) => {
  it("passes validateRecipe unchanged", () => {
    expect(validateRecipe(c.recipe)).toEqual({ ok: true, recipe: c.recipe });
  });

  it("compiles to a document with empty refs and no chain issues", () => {
    const chain = compileRecipe(c.recipe);
    expect(toJSON(chain).refs).toEqual([]);
    expect(chainIssues(chain)).toEqual([]);
  });

  it("starts every verdict line with its tier sentence and adds to it", () => {
    for (const { tier, line } of lines(c.recipe.root)) {
      expect(line.startsWith(`${TIER_TEXT[tier]} `), line).toBe(true);
      expect(line.slice(TIER_TEXT[tier].length).trim(), line).toMatch(/^[A-Z].*\.$/);
    }
  });

  it("has two or three samples with distinct labels", () => {
    expect(c.samples.length).toBeGreaterThanOrEqual(2);
    expect(c.samples.length).toBeLessThanOrEqual(3);
    const labels = c.samples.map((s) => s.label);
    expect(new Set(labels).size).toBe(labels.length);
    for (const s of c.samples) {
      expect(s.label.trim()).not.toBe("");
      expect(s.input.trim()).not.toBe("");
    }
  });

  it.each(c.samples.map((s) => [s.label, s.input] as const))(
    "runs sample %s to a verdict with default answers and an agreeable oracle",
    async (_label, input) => {
      expect(await runSample(c, input)).not.toBeNull();
      expect(await runSample(c, input, agreeable)).not.toBeNull();
    },
  );
});

describe("depth", () => {
  it("puts the deep recipes at their ladder depths", () => {
    expect(recipeShape(tonight.recipe).maxDepth).toBe(10);
    expect(recipeShape(startup.recipe).maxDepth).toBe(8);
    expect(recipeShape(pullRequest.recipe).maxDepth).toBe(6);
    expect(recipeShape(weddingSpeech.recipe).maxDepth).toBe(5);
  });

  it("keeps the shallow recipes at 3 or less", () => {
    for (const c of [breakup, tweet, excuse, slack]) {
      expect(recipeShape(c.recipe).maxDepth, c.slug).toBeLessThanOrEqual(3);
    }
  });
});

/**
 * The fake Jev answers by question type, not by input, so each recipe lands
 * on one verdict per oracle. Checking which one pins the pass direction and
 * then/otherwise order of the gates on those paths, and the rate weights.
 */
describe("where the fake Jev lands", () => {
  const input = "anything";
  const land = async (c: CuratedRecipe, oracle?: Oracle) => {
    const v = await runSample(c, input, oracle);
    return v && { tier: v.tier, line: v.line, depth: v.depth };
  };

  it("with default answers: every gate no, lowest levels, first labels", async () => {
    expect(await land(breakup)).toEqual({
      tier: "kinda",
      line: "It sort of jevs. Remove the second paragraph.",
      depth: 2,
    });
    expect(await land(tweet)).toEqual({ tier: "kinda", line: "It sort of jevs. Nobody asked, but it is fine.", depth: 1 });
    expect(await land(excuse)).toEqual({ tier: "nope", line: "It does not jev. Just say you were late.", depth: 1 });
    expect(await land(slack)).toEqual({ tier: "jevs", line: "It jevs. Send it.", depth: 2 });
    expect(await land(startup)).toEqual({ tier: "nope", line: "It does not jev. Someone has to pay.", depth: 2 });
    expect(await land(pullRequest)).toEqual({ tier: "jevs", line: "It jevs. Merge it.", depth: 2 });
    expect(await land(tonight)).toEqual({ tier: "jevs", line: "It jevs. This is a plan, not a night out.", depth: 10 });
    expect(await land(weddingSpeech)).toEqual({
      tier: "kinda",
      line: "It sort of jevs. End with a toast. People need to know when to clap.",
      depth: 5,
    });
  });

  it("with the agreeable oracle: every gate yes, top levels, last labels", async () => {
    expect(await land(breakup, agreeable)).toEqual({
      tier: "nope",
      line: "It does not jev. This is a letter from counsel.",
      depth: 1,
    });
    expect(await land(tweet, agreeable)).toEqual({
      tier: "nope",
      line: "It does not jev. That opinion is popular. You know that.",
      depth: 2,
    });
    expect(await land(excuse, agreeable)).toEqual({
      tier: "nope",
      line: "It does not jev. The grandmother is doing a lot of work here.",
      depth: 2,
    });
    expect(await land(slack, agreeable)).toEqual({
      tier: "nope",
      line: "It does not jev. There is a rush. Everyone can tell.",
      depth: 1,
    });
    expect(await land(startup, agreeable)).toEqual({
      tier: "nope",
      line: "It does not jev. Uber is already Uber for things.",
      depth: 1,
    });
    expect(await land(pullRequest, agreeable)).toEqual({ tier: "nope", line: "It does not jev. It is Friday.", depth: 2 });
    expect(await land(tonight, agreeable)).toEqual({ tier: "nope", line: "It does not jev. It is never one drink.", depth: 1 });
    expect(await land(weddingSpeech, agreeable)).toEqual({
      tier: "nope",
      line: "It does not jev. Check you are on the list.",
      depth: 1,
    });
  });
});
