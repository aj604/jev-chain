import { describe, expect, it } from "vitest";
import { CURATED } from "@/recipes";
import { COPY, TIER_TEXT } from "./copy";
import { parseShareQuery, type ShareQuery } from "./share";
import { ogImagePath, shareCard, shareMetadata } from "./share-metadata";
import { TIERS } from "./tiers";

const TONIGHT: ShareQuery = { tier: "nope", gates: 3, depth: 3, slug: "tonight" };

/** Every string anywhere in `value`. */
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (typeof value === "object" && value !== null) return Object.values(value).flatMap(strings);
  return [];
}

describe("shareMetadata", () => {
  it("builds a curated run's metadata from the query", () => {
    const images = [{ url: "/api/og?t=nope&g=3&d=3&r=tonight", width: 1200, height: 630 }];
    const description = "Will your plan for tonight jev? 3 gates. 3 deep.";
    expect(shareMetadata(TONIGHT)).toEqual({
      title: "It does not jev.",
      description,
      openGraph: { title: "It does not jev.", description, images },
      twitter: { card: "summary_large_image", title: "It does not jev.", description, images },
    });
  });

  it("uses the generated title when there is no slug", () => {
    const meta = shareMetadata({ tier: "jevs", gates: 1, depth: 1, slug: null });
    expect(meta.title).toBe("It jevs.");
    expect(meta.description).toBe("Something was jevved. 1 gate. 1 deep.");
    expect(meta.openGraph?.images).toEqual([{ url: "/api/og?t=jevs&g=1&d=1", width: 1200, height: 630 }]);
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

  it("never holds anything but tier text, curated titles, copy lines and numbers", () => {
    const allowed = [
      ...Object.values(TIER_TEXT),
      ...CURATED.map((c) => c.recipe.title),
      COPY.generatedTitle,
      COPY.siteTitle,
      "summary_large_image",
    ];
    const queries: (ShareQuery | null)[] = [null];
    for (const tier of TIERS) {
      for (const slug of [null, ...CURATED.map((c) => c.slug)]) {
        for (const [gates, depth] of [[0, 0], [1, 1], [3, 7], [10, 10]]) queries.push({ tier, gates, depth, slug });
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
    const params = new URLSearchParams("t=kinda&g=2&d=2&r=tonight&x=%3Cmarquee%3E&input=my+secret+plan");
    const text = JSON.stringify(shareMetadata(parseShareQuery(params)));
    expect(text).not.toContain("marquee");
    expect(text).not.toContain("secret");
    expect(text).toContain('"/api/og?t=kinda&g=2&d=2&r=tonight"');
  });

  it("gives the plain metadata for out-of-range values", () => {
    expect(shareMetadata(parseShareQuery(new URLSearchParams("t=great&g=99")))).toEqual(shareMetadata(null));
    expect(shareMetadata(parseShareQuery({ t: "nope", g: "99", d: "3" }))).toEqual(shareMetadata(null));
  });
});

describe("shareCard", () => {
  it("has the heading, tier sentence and counts", () => {
    expect(shareCard(TONIGHT)).toEqual({
      heading: "Will your plan for tonight jev?",
      tier: "It does not jev.",
      counts: "3 gates. 3 deep.",
    });
  });

  it("has only the generated title when plain", () => {
    expect(shareCard(null)).toEqual({ heading: "Something was jevved.", tier: null, counts: null });
  });
});
