import type { Metadata } from "next";
import { getCurated } from "@/recipes";
import { COPY } from "./copy";
import { findOutcome } from "./recipe/tree";
import { shareQueryString, type ShareQuery } from "./share";

/**
 * What a share link shows before it is opened: the `/v` page's metadata and
 * the `/api/og` preview image. Both are built from the parsed query alone,
 * so they only ever hold curated titles and outcomes, copy lines and
 * numbers. User text lives in the hash, which never reaches the server.
 */

export const OG_IMAGE_PATH = "/api/og";
export const OG_IMAGE_SIZE = { width: 1200, height: 630 } as const;
/** The image depends only on its URL, so it can be cached for good. */
export const OG_IMAGE_CACHE = "public, max-age=31536000, immutable";

/**
 * The lines on a share card. A plain card has only the heading. A generated
 * recipe's card says "It jevs." with the counts; a curated one's has its
 * outcome's stamp and line as well.
 */
export interface ShareCard {
  /** The curated desk's title, or `COPY.generatedTitle`. */
  heading: string;
  /** `COPY.jevs`, or null on the plain card. */
  jevs: string | null;
  /** A curated outcome's stamp and line. */
  stamp: string | null;
  line: string | null;
  counts: string | null;
}

export function shareCard(q: ShareQuery | null): ShareCard {
  if (!q) return { heading: COPY.generatedTitle, jevs: null, stamp: null, line: null, counts: null };
  const curated = getCurated(q.slug);
  const outcome = curated && q.outcome !== null ? findOutcome(curated.recipe, q.outcome) : undefined;
  return {
    heading: curated?.recipe.title ?? COPY.generatedTitle,
    jevs: COPY.jevs,
    stamp: outcome?.stamp ?? null,
    line: outcome?.line ?? null,
    counts: COPY.gatesAndDepth(q.gates, q.depth),
  };
}

/** The preview image's path: `/api/og` with the same bounded query, or none for the plain card. */
export function ogImagePath(q: ShareQuery | null): string {
  return q ? `${OG_IMAGE_PATH}?${shareQueryString(q)}` : OG_IMAGE_PATH;
}

/**
 * The `/v` page's metadata. The title is the outcome's stamp when there is
 * one, else "It jevs.". Image URLs are relative: the root layout's
 * `metadataBase` makes them absolute.
 */
export function shareMetadata(q: ShareQuery | null): Metadata {
  const card = shareCard(q);
  // The layout's title template would make the plain title "Will it jev? · Will it jev?".
  const title = card.stamp ?? card.jevs ?? COPY.siteTitle;
  const description = [card.line, card.heading, card.counts].filter((s) => s !== null).join(" ");
  const images = [{ url: ogImagePath(q), ...OG_IMAGE_SIZE }];
  return {
    title: card.jevs ? title : { absolute: COPY.siteTitle },
    description,
    openGraph: { title, description, images },
    twitter: { card: "summary_large_image", title, description, images },
  };
}
