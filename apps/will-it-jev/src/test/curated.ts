import type { Recipe } from "@/lib/recipe/types";
import { desk, gatedRate } from "./fixtures";

/**
 * A stand-in for `@/recipes`, so tests of share links and previews don't
 * depend on the curated library's wording. Use it with
 *
 * ```ts
 * vi.mock("@/recipes", async () => (await import("@/test/curated")).curatedModule);
 * ```
 */
export interface TestCurated {
  slug: string;
  recipe: Recipe;
  samples: { label: string; input: string }[];
}

export const TEST_CURATED: TestCurated[] = [
  {
    slug: "desk",
    recipe: desk(),
    samples: [{ label: "Toaster", input: "My toaster whispers my name at 3am." }],
  },
  {
    slug: "vibes",
    recipe: gatedRate(),
    samples: [{ label: "Vibes", input: "The vibes are fine." }],
  },
];

export const curatedModule = {
  CURATED: TEST_CURATED,
  getCurated: (slug: string | null | undefined) => (slug == null ? undefined : TEST_CURATED.find((c) => c.slug === slug)),
};
