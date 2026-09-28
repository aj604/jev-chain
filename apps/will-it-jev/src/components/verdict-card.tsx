import { COPY, TIER_TEXT, lineRest } from "@/lib/copy";
import type { Verdict } from "@/lib/recipe/verdict";
import type { Tier } from "@/lib/tiers";

const TIER_COLOR: Record<Tier, string> = { jevs: "text-yes", kinda: "text-ink", nope: "text-no" };

/**
 * The verdict: the recipe title, the tier sentence very large, the rest of
 * the line, and the stat line. The card is a polite live region, so screen
 * readers announce it when it arrives.
 *
 * A page that shows the card after a live run passes `live={false}` and
 * renders it into its own polite region, mounted before the verdict arrives:
 * a live region that mounts already filled is not announced everywhere.
 */
export function VerdictCard({ verdict, title, live = true }: { verdict: Verdict; title: string; live?: boolean }) {
  const rest = lineRest(verdict.line, verdict.tier);
  const stats = COPY.stats(verdict.gates, verdict.depth, verdict.latencyMs);
  return (
    <section
      aria-live={live ? "polite" : undefined}
      aria-atomic={live ? true : undefined}
      className="min-w-0 border-y border-rule py-6"
    >
      <p className="wrap-break-word text-sm text-ink-2">{title}</p>
      <p className={`mt-2 wrap-break-word text-5xl font-semibold tracking-tight ${TIER_COLOR[verdict.tier]}`}>
        {TIER_TEXT[verdict.tier]}
      </p>
      {rest && <p className="mt-3 wrap-break-word text-lg text-ink">{rest}</p>}
      <p className="mt-4 text-sm tabular-nums text-ink-3">
        {verdict.score === null ? stats : `${stats} ${COPY.score(verdict.score)}`}
      </p>
    </section>
  );
}
