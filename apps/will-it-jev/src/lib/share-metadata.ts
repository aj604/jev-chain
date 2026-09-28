import type { Metadata } from "next";
import { getCurated } from "@/recipes";
import { COPY, TIER_TEXT } from "./copy";
import { shareQueryString, type ShareQuery } from "./share";

/**
 * What a share link shows before it is opened: the `/v` page's metadata and
 * the `/api/og` preview image. Both are built from the parsed query alone,
 * so they only ever hold the tier text, curated titles, copy lines and
 * numbers. User text lives in the hash, which never reaches the server.
 */

export const OG_IMAGE_PATH = "/api/og";
export const OG_IMAGE_SIZE = { width: 1200, height: 630 } as const;
/** The image depends only on its URL, so it can be cached for good. */
export const OG_IMAGE_CACHE = "public, max-age=31536000, immutable";

/** The lines on a share card. A plain card has no tier and no counts. */
export interface ShareCard {
  /** The curated title, or `COPY.generatedTitle`. */
  heading: string;
  tier: string | null;
  counts: string | null;
}

export function shareCard(q: ShareQuery | null): ShareCard {
  if (!q) return { heading: COPY.generatedTitle, tier: null, counts: null };
  return {
    heading: getCurated(q.slug)?.recipe.title ?? COPY.generatedTitle,
    tier: TIER_TEXT[q.tier],
    counts: COPY.gatesAndDepth(q.gates, q.depth),
  };
}

/** The preview image's path: `/api/og` with the same bounded query, or none for the plain card. */
export function ogImagePath(q: ShareQuery | null): string {
  return q ? `${OG_IMAGE_PATH}?${shareQueryString(q)}` : OG_IMAGE_PATH;
}

/**
 * The `/v` page's metadata. Image URLs are relative: the root layout's
 * `metadataBase` makes them absolute.
 */
export function shareMetadata(q: ShareQuery | null): Metadata {
  const card = shareCard(q);
  // The layout's title template would make the plain title "Will it jev? · Will it jev?".
  const title = card.tier ?? COPY.siteTitle;
  const description = card.counts ? `${card.heading} ${card.counts}` : card.heading;
  const images = [{ url: ogImagePath(q), ...OG_IMAGE_SIZE }];
  return {
    title: card.tier ?? { absolute: COPY.siteTitle },
    description,
    openGraph: { title, description, images },
    twitter: { card: "summary_large_image", title, description, images },
  };
}
