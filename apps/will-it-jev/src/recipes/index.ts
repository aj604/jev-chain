import type { Recipe } from "@/lib/recipe/types";
import { breakup } from "./breakup-text";
import { excuse } from "./excuse";
import { pullRequest } from "./pull-request";
import { slack } from "./slack-message";
import { startup } from "./startup";
import { tonight } from "./tonight";
import { tweet } from "./tweet";
import { weddingSpeech } from "./wedding-speech";

/**
 * A hand-written recipe with the inputs offered beside it. Curated recipes
 * pass the same `validateRecipe` as model output.
 */
export interface CuratedRecipe {
  /** Names the recipe in share links as `r=`. */
  slug: string;
  recipe: Recipe;
  /** Two or three. The first fills the box when the example is picked. */
  samples: { label: string; input: string }[];
}

export { breakup, excuse, pullRequest, slack, startup, tonight, tweet, weddingSpeech };

/** In display order: the four shallow recipes, then the four deep ones. */
export const CURATED: CuratedRecipe[] = [
  breakup,
  tweet,
  excuse,
  slack,
  startup,
  pullRequest,
  tonight,
  weddingSpeech,
];

/** The curated recipe with this slug, if there is one. */
export function getCurated(slug: string | null | undefined): CuratedRecipe | undefined {
  return slug == null ? undefined : CURATED.find((c) => c.slug === slug);
}
