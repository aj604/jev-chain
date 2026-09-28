import { ImageResponse } from "next/og";
import { COPY } from "./copy";
import type { ShareQuery } from "./share";
import { OG_IMAGE_CACHE, OG_IMAGE_SIZE, shareCard } from "./share-metadata";

/**
 * The light theme's `--paper`, `--ink`, `--ink-2`, `--line-soft`, `--stamp`
 * and `--pass` from globals.css, written out: the image renderer can't read
 * CSS variables. Change the two together.
 */
const PAPER = "#fefefe";
const INK = "#1e1e1e";
const INK_2 = "#4a4a4a";
const LINE_SOFT = "#e5e5e5";
const STAMP = "#5b3fd1";
const PASS = "#03aa5c";

/** A bordered, slightly crooked stamp, as the outcome card draws it. */
function Stamp({ text, color, size, tilt }: { text: string; color: string; size: number; tilt: number }) {
  return (
    <div
      style={{
        display: "flex",
        alignSelf: "flex-start",
        color,
        border: `${Math.max(3, Math.round(size / 14))}px solid ${color}`,
        borderRadius: 10,
        padding: `${Math.round(size * 0.12)}px ${Math.round(size * 0.4)}px`,
        fontSize: size,
        fontWeight: 700,
        letterSpacing: "-0.02em",
        transform: `rotate(${tilt}deg)`,
      }}
    >
      {text}
    </div>
  );
}

/**
 * A font size that keeps a stamp on one line across the card: about half an
 * em per character in the default font, within 1000px, capped at 96.
 */
function fitOneLine(text: string): number {
  return Math.min(96, Math.floor(1000 / (text.length * 0.55)));
}

/**
 * The 1200 by 630 share preview for a parsed query. Along the top, the desk.
 * In the middle, a curated outcome's stamp with its line under it, or a large
 * "It jevs." stamp for a generated desk. Along the bottom, "It jevs." small
 * (when the outcome is shown), the counts and the site title. The plain card
 * (a null query) has only the generated title and the site title. Uses the
 * renderer's default font.
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
          padding: "64px 80px",
          background: PAPER,
          color: INK,
        }}
      >
        <div style={{ display: "flex", fontSize: 40, color: INK_2 }}>{card.jevs ? card.heading : ""}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 36 }}>
          {card.stamp ? (
            <Stamp text={card.stamp} color={STAMP} size={fitOneLine(card.stamp)} tilt={-3} />
          ) : card.jevs ? (
            <Stamp text={card.jevs} color={PASS} size={120} tilt={-3} />
          ) : (
            <div style={{ display: "flex", fontSize: 88, letterSpacing: "-0.02em" }}>{card.heading}</div>
          )}
          {card.line && <div style={{ display: "flex", fontSize: 38, lineHeight: 1.3, color: INK }}>{card.line}</div>}
        </div>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 28,
            borderTop: `2px solid ${LINE_SOFT}`,
            paddingTop: 26,
            fontSize: 32,
            color: INK_2,
          }}
        >
          {card.stamp && card.jevs && <Stamp text={card.jevs} color={PASS} size={30} tilt={2} />}
          <div style={{ display: "flex" }}>{card.counts ?? ""}</div>
          <div style={{ display: "flex", marginLeft: "auto", color: INK }}>{COPY.siteTitle}</div>
        </div>
      </div>
    ),
    { ...OG_IMAGE_SIZE, headers: { "cache-control": OG_IMAGE_CACHE } },
  );
}
