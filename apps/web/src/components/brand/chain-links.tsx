import type { CSSProperties } from "react";
import { cn } from "@/lib/cn";

/**
 * The jevchain motif: a row of interlocking oval links.
 *
 * Links alternate face-on (open ovals) and edge-on (flat ovals). Drawing them
 * in order means each edge link sits over its left neighbour and under its
 * right one — a real interlock, with no masks.
 *
 *   <ChainLinks />                          static, 5 links
 *   <ChainLinks count={7} progress={3} />   first 3 links filled
 *   <ChainLinks variant="loading" />        links fill one after another, looping
 *
 * Stroke is currentColor (1.2px); filled links are accent with an ink outline.
 * Edge links are backed with `--chain-bg` (defaults to --paper) so the
 * over/under reads correctly — set it when placing on another surface.
 */

const PITCH = 11; // horizontal distance between link centres
const FACE = { rx: 7, ry: 4.6 };
const EDGE = { rx: 7, ry: 1.8 };
const H = 12;
const PAD = 0.8; // room for the stroke at the extremes

export interface ChainLinksProps {
  /** Number of links (face + edge). Default 5. */
  count?: number;
  variant?: "static" | "loading";
  /** 0..count links filled with accent (static variant). */
  progress?: number;
  /** Rendered height in px. Width follows. Default 12. */
  size?: number;
  /** Loop length for the loading variant. Default 1400ms. */
  cycleMs?: number;
  /** Accessible label. Static chains without a label are decorative. */
  label?: string;
  className?: string;
  style?: CSSProperties;
}

export function chainLinksWidth(count: number, size = H) {
  return ((FACE.rx * 2 + (count - 1) * PITCH + PAD * 2) / H) * size;
}

export function ChainLinks({
  count = 5,
  variant = "static",
  progress = 0,
  size = H,
  cycleMs = 1400,
  label,
  className,
  style,
}: ChainLinksProps) {
  const n = Math.max(1, Math.floor(count));
  const filled = Math.max(0, Math.min(n, Math.round(progress)));
  const loading = variant === "loading";
  const vbW = FACE.rx * 2 + (n - 1) * PITCH + PAD * 2;
  const step = (cycleMs * 0.55) / n;

  const a11y = loading
    ? { role: "status" as const, "aria-label": label ?? "loading" }
    : label
      ? { role: "img" as const, "aria-label": label }
      : { "aria-hidden": true as const };

  return (
    <svg
      viewBox={`${-PAD} 0 ${vbW} ${H}`}
      width={chainLinksWidth(n, size)}
      height={size}
      fill="none"
      className={cn("inline-block shrink-0 overflow-visible", className)}
      style={{ ...style, ["--chain-cycle" as string]: `${cycleMs}ms` }}
      {...a11y}
    >
      {Array.from({ length: n }, (_, i) => {
        const cx = FACE.rx + i * PITCH;
        const isFace = i % 2 === 0;
        const { rx, ry } = isFace ? FACE : EDGE;
        const on = !loading && i < filled;
        const emptyFill = isFace ? "transparent" : "var(--chain-bg, var(--paper))";
        return (
          <ellipse
            key={i}
            cx={cx}
            cy={H / 2}
            rx={rx}
            ry={ry}
            strokeWidth={1.2}
            vectorEffect="non-scaling-stroke"
            className={cn(
              loading && "chain-link-anim",
              "transition-[fill,stroke] duration-(--dur) ease-snap",
            )}
            data-rm-fill={loading && i < Math.ceil(n / 2) ? "true" : undefined}
            style={{
              ["--chain-empty" as string]: emptyFill,
              fill: on ? "var(--accent)" : emptyFill,
              stroke: on ? "var(--ink)" : "currentColor",
              animationDelay: loading ? `${i * step}ms` : undefined,
            }}
          />
        );
      })}
    </svg>
  );
}

/** Horizontal rule with the chain motif in the middle (or at the start with a label). */
export function ChainDivider({
  count = 5,
  label,
  className,
}: {
  count?: number;
  label?: string;
  className?: string;
}) {
  return (
    <div role="separator" className={cn("flex items-center gap-3 text-ink-3", className)}>
      {label ? (
        <>
          <ChainLinks count={count} />
          <span className="font-mono text-[11px] lowercase tracking-wide">{label}</span>
          <span className="h-(--bw) flex-1 bg-line-soft" />
        </>
      ) : (
        <>
          <span className="h-(--bw) flex-1 bg-line-soft" />
          <ChainLinks count={count} />
          <span className="h-(--bw) flex-1 bg-line-soft" />
        </>
      )}
    </div>
  );
}
