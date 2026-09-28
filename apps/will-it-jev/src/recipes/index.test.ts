import { chainIssues, run, toJSON, type Answer, type Question } from "jevchain";
import { describe, expect, it } from "vitest";
import { toneIssue } from "@/lib/deadpan";
import { compileRecipe } from "@/lib/recipe/compile";
import { recipeShape } from "@/lib/recipe/tree";
import type { Recipe, RecipeNode, RecipeOutcome } from "@/lib/recipe/types";
import { validateRecipe } from "@/lib/recipe/validate";
import { fakeJev, type Oracle } from "@/test/fake-jev";
import {
  CURATED,
  breakup,
  excuse,
  getCurated,
  houseplantInquest,
  linkedin,
  petAuthorship,
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

/** Every choice is a near-even split that nobody could call. Nouls keep the default. */
const splitVote: Oracle = (q: Question): Partial<Answer> | undefined => {
  if (q.type !== "choice") return undefined;
  const labels = Object.keys(q.criteria);
  const probabilities = Object.fromEntries(labels.map((l) => [l, 1 / labels.length]));
  return { choice: labels[0], probabilities, confidence: 0.05 } as Partial<Answer>;
};

/** Every outcome in the tree, including rate bands and escape hatches. */
function outcomes(node: RecipeNode): RecipeOutcome[] {
  switch (node.kind) {
    case "outcome":
      return [node];
    case "rate":
      return node.bands.map((b) => b.outcome);
    case "gate":
      return [node.yes, node.no, ...(node.unsure ? [node.unsure] : [])].flatMap(outcomes);
    case "route":
      return [...Object.values(node.branches), ...(node.lowConfidence ? [node.lowConfidence] : [])].flatMap(outcomes);
  }
}

/** Every string a visitor can read on the graph or the card. */
function strings(recipe: Recipe): string[] {
  const out = [recipe.title, recipe.thing];
  const visit = (node: RecipeNode) => {
    if (node.kind === "outcome") {
      out.push(node.stamp, node.line);
      return;
    }
    out.push(node.title);
    if (node.kind === "rate") {
      for (const q of node.questions) {
        out.push(q.question);
        if (q.kind === "score") out.push(...q.levels);
        if (q.kind === "choice") out.push(...Object.values(q.labels));
      }
      for (const b of node.bands) visit(b.outcome);
      return;
    }
    out.push(node.question);
    if (node.kind === "gate") {
      if (node.means) out.push(node.means.yes, node.means.no);
      [node.yes, node.no, ...(node.unsure ? [node.unsure] : [])].forEach(visit);
    } else {
      out.push(...Object.values(node.labels));
      [...Object.values(node.branches), ...(node.lowConfidence ? [node.lowConfidence] : [])].forEach(visit);
    }
  };
  visit(recipe.root);
  return out;
}

/** Keys of the gates and routes that have an escape hatch. */
function escapeHatches(node: RecipeNode): string[] {
  switch (node.kind) {
    case "outcome":
    case "rate":
      return [];
    case "gate":
      return [...(node.unsure ? [node.key] : []), ...[node.yes, node.no].flatMap(escapeHatches)];
    case "route":
      return [...(node.lowConfidence ? [node.key] : []), ...Object.values(node.branches).flatMap(escapeHatches)];
  }
}

async function runSample(c: CuratedRecipe, input: string, oracle?: Oracle) {
  const { client } = fakeJev(oracle);
  return run(compileRecipe(c.recipe), input, { jev: client });
}

/**
 * Where a run ended: the outcome it reached, or the rate it reached (a
 * rate's outcome is read off the score after the run). Found by node id in
 * the trace, since outcome and rate keys are unique across the tree.
 */
async function land(c: CuratedRecipe, oracle?: Oracle): Promise<string | undefined> {
  const result = await runSample(c, "anything", oracle);
  const ran = new Set(result.trace.spans.map((s) => s.nodeId));
  const leaves = [
    ...outcomes(c.recipe.root).map((o) => o.key),
    ...(function rates(n: RecipeNode): string[] {
      if (n.kind === "rate") return [n.key];
      if (n.kind === "gate") return [n.yes, n.no, ...(n.unsure ? [n.unsure] : [])].flatMap(rates);
      if (n.kind === "route") return Object.values(n.branches).flatMap(rates);
      return [];
    })(c.recipe.root),
  ];
  return leaves.find((k) => ran.has(k));
}

describe("CURATED", () => {
  it("holds the eleven recipes in display order, the any-text desks first", () => {
    expect(CURATED.map((c) => c.slug)).toEqual([
      "pet-authorship",
      "houseplant-inquest",
      "excuse",
      "breakup-text",
      "tonight",
      "linkedin-post",
      "slack-message",
      "tweet",
      "wedding-speech",
      "startup",
      "pull-request",
    ]);
    expect(CURATED).toEqual([
      petAuthorship,
      houseplantInquest,
      excuse,
      breakup,
      tonight,
      linkedin,
      slack,
      tweet,
      weddingSpeech,
      startup,
      pullRequest,
    ]);
  });

  it("has unique slugs that fit in a share link", () => {
    const slugs = CURATED.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z0-9-]{1,40}$/);
  });

  it("never repeats an outcome line across the whole collection", () => {
    const lines = CURATED.flatMap((c) => outcomes(c.recipe.root).map((o) => o.line));
    expect(new Set(lines).size).toBe(lines.length);
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

  it("is a desk: an institution for a title, in the house voice throughout", () => {
    expect(c.recipe.v).toBe(2);
    expect(c.recipe.title).toMatch(/^The [A-Z]/);
    for (const s of strings(c.recipe)) expect(toneIssue(s), s).toBeNull();
  });

  it("files every outcome as an event, never a grade", () => {
    const found = outcomes(c.recipe.root);
    expect(found.length).toBeGreaterThanOrEqual(3);
    const stamps = found.map((o) => o.stamp);
    expect(new Set(stamps).size, "stamps repeat").toBe(stamps.length);
    for (const o of found) {
      // "It jevs." is the site's own stamp for a run that worked. Outcomes never grade.
      expect(`${o.stamp} ${o.line}`, o.key).not.toMatch(/\bjev/i);
      expect(o.stamp, o.key).toMatch(/^[A-Z0-9"]/);
      expect(o.line, o.key).toMatch(/^[A-Z0-9"].*\.$/);
    }
  });

  it("has at least one escape hatch for when Jev cannot call it", () => {
    expect(escapeHatches(c.recipe.root).length).toBeGreaterThanOrEqual(1);
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
    "runs sample %s to the end with default answers and an agreeable oracle",
    async (_label, input) => {
      expect((await runSample(c, input)).status).toBe("ok");
      expect((await runSample(c, input, agreeable)).status).toBe("ok");
    },
  );
});

describe("depth", () => {
  it("varies from a two-question sort to a ten-gate ladder", () => {
    const depths = Object.fromEntries(CURATED.map((c) => [c.slug, recipeShape(c.recipe).maxDepth]));
    expect(depths).toEqual({
      "pet-authorship": 2,
      "houseplant-inquest": 2,
      excuse: 3,
      "breakup-text": 2,
      tonight: 10,
      "linkedin-post": 2,
      "slack-message": 2,
      tweet: 2,
      "wedding-speech": 4,
      startup: 9,
      "pull-request": 5,
    });
  });
});

/**
 * The fake Jev answers by question type, not by input, so each recipe lands
 * in one place per oracle. Checking where pins the yes and no sides of the
 * gates on those paths and the label order of the routes.
 */
describe("where the fake Jev lands", () => {
  it("with default answers: every gate no, lowest levels, first labels", async () => {
    const landed = Object.fromEntries(await Promise.all(CURATED.map(async (c) => [c.slug, await land(c)])));
    expect(landed).toEqual({
      "pet-authorship": "walk-scheduled",
      "houseplant-inquest": "watering-can-seized",
      excuse: "card-to-grandmother",
      "breakup-text": "courier-dispatched",
      tonight: "permit-granted",
      "linkedin-post": "waved-through",
      "slack-message": "filed-someday",
      tweet: "take-contained",
      "wedding-speech": "clap-cue",
      startup: "invoice-issued",
      "pull-request": "merged-by-acclamation",
    });
  });

  it("with the agreeable oracle: every gate yes, top levels, last labels", async () => {
    const landed = Object.fromEntries(
      await Promise.all(CURATED.map(async (c) => [c.slug, await land(c, agreeable)])),
    );
    expect(landed).toEqual({
      "pet-authorship": "speaker-traced",
      "houseplant-inquest": "composted-with-honours",
      excuse: "astrologer-consulted",
      "breakup-text": "counsel-copied",
      tonight: "filed-four-drinks",
      "linkedin-post": "role-inspected",
      "slack-message": "channel-evacuated",
      tweet: "inquiry-opened",
      "wedding-speech": "table-fourteen",
      startup: "forwarded-to-uber",
      "pull-request": "weekend-cancelled",
    });
  });

  it("with a split vote on every route: the first route's escape hatch", async () => {
    const routed = CURATED.filter((c) => c.recipe.root.kind === "route");
    const landed = Object.fromEntries(await Promise.all(routed.map(async (c) => [c.slug, await land(c, splitVote)])));
    expect(landed).toEqual({
      "pet-authorship": "hamster-questioned",
      "houseplant-inquest": "cactus-detained",
      excuse: "brenda-summoned",
      "breakup-text": "linda-reads-it",
      "linkedin-post": "sharon-inspects",
      "slack-message": "gary-closed-it",
      tweet: "kyle-posted-it",
      "wedding-speech": "handed-to-dj",
      "pull-request": "mark-paged",
    });
  });

  it("with a coin flip at the unsure gates of the two ladders: their unsure paths", async () => {
    const coinFlip =
      (words: string): Oracle =>
      (q) =>
        q.type === "noul" && typeof q.instructions === "string" && q.instructions.includes(words)
          ? { noul: 0.5 }
          : undefined;
    expect(await land(tonight, coinFlip("running into someone's ex"))).toBe("kev-on-lookout");
    expect(await land(startup, coinFlip("who pays"))).toBe("chad-knows-angels");
  });
});
