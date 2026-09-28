import { ImageResponse } from "next/og";
import { COPY } from "./copy";
import type { ShareQuery } from "./share";
import { OG_IMAGE_CACHE, OG_IMAGE_SIZE, shareCard } from "./share-metadata";

/**
 * The light theme's `--paper`, `--ink`, `--ink-2` and `--rule` from
 * globals.css, written out: the image renderer can't read CSS variables.
 * Change the two together.
 */
const PAPER = "#fbfaf7";
const INK = "#1b1b1b";
const INK_2 = "#4d4d4d";
const RULE = "#dedbd3";

/**
 * The 1200 by 630 share preview for a parsed query: the heading at the top,
 * the tier sentence large in the middle, the counts and the site title along
 * the bottom. The plain card (a null query) has only the generated title and
 * the site title. Uses the renderer's default font.
 */
export function ogImage(q: ShareQuery | null): ImageResponse {
  const card = shareCard(q);
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px 80px",
          background: PAPER,
          color: INK,
        }}
      >
        <div style={{ display: "flex", fontSize: 44, color: INK_2 }}>{card.tier ? card.heading : ""}</div>
        <div style={{ display: "flex", fontSize: card.tier ? 136 : 88, letterSpacing: "-0.02em" }}>
          {card.tier ?? card.heading}
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            borderTop: `2px solid ${RULE}`,
            paddingTop: 28,
            fontSize: 36,
            color: INK_2,
          }}
        >
          <div style={{ display: "flex" }}>{card.counts ?? ""}</div>
          <div style={{ display: "flex", color: INK }}>{COPY.siteTitle}</div>
        </div>
      </div>
    ),
    { ...OG_IMAGE_SIZE, headers: { "cache-control": OG_IMAGE_CACHE } },
  );
}
