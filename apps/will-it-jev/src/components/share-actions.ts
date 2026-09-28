import { toJSON, toTypeScript, type Trace } from "jevchain";
import { compileRecipe } from "@/lib/recipe/compile";
import type { Recipe } from "@/lib/recipe/types";
import type { Verdict } from "@/lib/recipe/verdict";
import { studioHref, verdictHref } from "@/lib/share";

/** The share bar's work, kept out of React so it can be tested in node. */

export interface ShareLinks {
  /** The verdict page link, absolute. */
  share: string;
  /** "Open in the studio". */
  studio: string;
}

/**
 * Both share bar links, built together. `verdictHref` is relative, so it is
 * made absolute against `origin` (the page's `window.location.origin`).
 */
export async function buildShareLinks(
  p: { recipe: Recipe; input: string; trace: Trace; verdict: Verdict; slug: string | null },
  origin: string,
): Promise<ShareLinks> {
  const [href, studio] = await Promise.all([
    verdictHref(p),
    studioHref({ recipe: p.recipe, input: p.input, trace: p.trace }),
  ]);
  return { share: new URL(href, origin).toString(), studio };
}

/** The recipe as the jevchain TypeScript for its circuit. */
export function recipeCode(recipe: Recipe): string {
  return toTypeScript(toJSON(compileRecipe(recipe), { name: recipe.title }));
}

/**
 * Puts `text` on the clipboard. True when it got there. A missing or denied
 * clipboard gives false and never throws.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
    if (!clipboard || typeof clipboard.writeText !== "function") return false;
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
