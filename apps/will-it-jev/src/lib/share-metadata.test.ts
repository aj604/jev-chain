import { describe, expect, it, vi } from "vitest";
import { TEST_CURATED } from "@/test/curated";
import { COPY } from "./copy";
import { recipeShape } from "./recipe/tree";
import type { Recipe, RecipeNode, RecipeOutcome } from "./recipe/types";
import { parseShareQuery, type ShareQuery } from "./share";
import { ogImagePath, shareCard, shareMetadata } from "./share-metadata";

vi.mock("@/recipes", async () => (await import("@/test/curated")).curatedModule);

const EXORCIST: ShareQuery = { gates: 2, depth: 2, slug: "desk", outcome: "exorcist" };
const GENERATED: ShareQuery = { gates: 1, depth: 1, slug: null, outcome: null };

/** Every string anywhere in `value`. */
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (typeof value === "object" && value !== null) return Object.values(value).flatMap(strings);
  return [];
}

/** Every outcome in a recipe, leaves and bands. */
function outcomes(recipe: Recipe): RecipeOutcome[] {
  const out: RecipeOutcome[] = [];
  const visit = (node: RecipeNode) => {
    if (node.kind === "outcome") out.push(node);
    else if (node.kind === "rate") out.push(...node.bands.map((b) => b.outcome));
    else if (node.kind === "gate") [node.yes, node.no, ...(node.unsure ? [node.unsure] : [])].forEach(visit);
    else [...Object.values(node.branches), ...(node.lowConfidence ? [node.lowConfidence] : [])].forEach(visit);
  };
  visit(recipe.root);
  return out;
}

describe("shareMetadata", () => {
  it("builds a curated run's metadata from its outcome", () => {
    const images = [{ url: "/api/og?g=2&d=2&r=desk&o=exorcist", width: 1200, height: 630 }];
    const description = "Booked: one (1) exorcist. Please remove fragile items. The Appliance Dispatch Desk 2 gates. 2 deep.";
    expect(shareMetadata(EXORCIST)).toEqual({
      title: "Exorcist booked",
      description,
      openGraph: { title: "Exorcist booked", description, images },
      twitter: { card: "summary_large_image", title: "Exorcist booked", description, images },
    });
  });

  it("says It jevs. with the generated title and counts when there is no slug", () => {
    const meta = shareMetadata(GENERATED);
    expect(meta.title).toBe("It jevs.");
    expect(meta.description).toBe("Something was jevved. 1 gate. 1 deep.");
    expect(meta.openGraph?.images).toEqual([{ url: "/api/og?g=1&d=1", width: 1200, height: 630 }]);
  });

  it("gives the plain metadata for a null query", () => {
    const images = [{ url: "/api/og", width: 1200, height: 630 }];
    expect(shareMetadata(null)).toEqual({
      // Absolute: the layout's template would repeat the site title.
      title: { absolute: "Will it jev?" },
      description: "Something was jevved.",
      openGraph: { title: "Will it jev?", description: "Something was jevved.", images },
      twitter: { card: "summary_large_image", title: "Will it jev?", description: "Something was jevved.", images },
    });
  });

  it("never holds anything but curated titles and outcomes, copy lines and numbers", () => {
    const allowed = [
      ...TEST_CURATED.flatMap((c) => [c.recipe.title, ...outcomes(c.recipe).flatMap((o) => [o.stamp, o.line])]),
      COPY.jevs,
      COPY.generatedTitle,
      COPY.siteTitle,
      "summary_large_image",
    ];
    const queries: (ShareQuery | null)[] = [null];
    for (const [gates, depth] of [[0, 0], [1, 1], [3, 7], [30, 10]] as const) {
      queries.push({ gates, depth, slug: null, outcome: null });
      for (const c of TEST_CURATED) {
        for (const o of outcomes(c.recipe)) queries.push({ gates, depth, slug: c.slug, outcome: o.key });
      }
    }
    for (const q of queries) {
      const known = [...allowed, ogImagePath(q), ...(q ? [COPY.gatesAndDepth(q.gates, q.depth)] : [])];
      for (const s of strings(shareMetadata(q))) {
        // Longest first, so a sentence is taken whole before a shorter one inside it.
        const rest = [...known].sort((a, b) => b.length - a.length).reduce((acc, k) => acc.split(k).join(""), s);
        expect(rest.trim(), s).toBe("");
      }
    }
  });

  it("carries nothing from the URL beyond the parsed query", () => {
    const params = new URLSearchParams("g=2&d=2&r=desk&o=exorcist&x=%3Cmarquee%3E&input=my+secret+plan&t=jevs");
    const text = JSON.stringify(shareMetadata(parseShareQuery(params)));
    expect(text).not.toContain("marquee");
    expect(text).not.toContain("secret");
    expect(text).not.toContain("t=");
    expect(text).toContain('"/api/og?g=2&d=2&r=desk&o=exorcist"');
  });

  it("gives the plain metadata for out-of-range or mismatched values", () => {
    for (const query of ["t=jevs&g=99", "g=99&d=3", "g=3&d=3&r=desk", "g=3&d=3&o=exorcist", "g=3&d=3&r=desk&o=nosuch"]) {
      expect(shareMetadata(parseShareQuery(new URLSearchParams(query))), query).toEqual(shareMetadata(null));
    }
    expect(shareMetadata(parseShareQuery({ g: "3", d: "3", r: "vibes", o: "exorcist" }))).toEqual(shareMetadata(null));
  });

  it("finds band outcomes as well as leaves", () => {
    const meta = shareMetadata({ gates: 2, depth: 1, slug: "vibes", outcome: "vibes-mid" });
    expect(meta.title).toBe("Middling");
    expect(meta.description).toBe("Scored in the middle at vibes. The Vibes Desk 2 gates. 1 deep.");
  });
});

describe("shareCard", () => {
  it("has the heading, It jevs., the outcome's stamp and line, and the counts", () => {
    expect(shareCard(EXORCIST)).toEqual({
      heading: "The Appliance Dispatch Desk",
      jevs: "It jevs.",
      stamp: "Exorcist booked",
      line: "Booked: one (1) exorcist. Please remove fragile items.",
      counts: "2 gates. 2 deep.",
    });
  });

  it("has It jevs. and the counts, with no stamp or line, for a generated recipe", () => {
    expect(shareCard(GENERATED)).toEqual({
      heading: "Something was jevved.",
      jevs: "It jevs.",
      stamp: null,
      line: null,
      counts: "1 gate. 1 deep.",
    });
  });

  it("has only the generated title when plain", () => {
    expect(shareCard(null)).toEqual({ heading: "Something was jevved.", jevs: null, stamp: null, line: null, counts: null });
  });

  it("covers every outcome of a curated recipe", () => {
    const desk = TEST_CURATED[0]!.recipe;
    expect(outcomes(desk)).toHaveLength(recipeShape(desk).outcomes);
    for (const o of outcomes(desk)) {
      expect(shareCard({ gates: 1, depth: 1, slug: "desk", outcome: o.key })).toMatchObject({ stamp: o.stamp, line: o.line });
    }
  });
});
