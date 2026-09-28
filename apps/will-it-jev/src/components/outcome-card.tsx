import type { CSSProperties } from "react";
import { COPY } from "@/lib/copy";
import type { Result } from "@/lib/recipe/result";

const tilt = (deg: number) => ({ "--tilt": `${deg}deg` }) as CSSProperties;

/**
 * Where the thing ended up: the desk, the outcome's stamp pressed on large,
 * its notice, and a small "It jevs." stamp with the numbers. The stamps land
 * once when the card mounts, which is when a run finishes.
 *
 * The card is a polite live region, so screen readers announce it. A page
 * that shows it after a live run passes `live={false}` and renders it into
 * its own polite region, mounted before the result arrives: a live region
 * that mounts already filled is not announced everywhere.
 */
export function OutcomeCard({ result, title, live = true }: { result: Result; title: string; live?: boolean }) {
  return (
    <section
      aria-live={live ? "polite" : undefined}
      aria-atomic={live ? true : undefined}
      className="min-w-0 border-hard bg-surface px-5 py-6 sm:px-8 sm:py-8"
    >
      <p className="wrap-break-word font-mono text-[12px] text-ink-3">{title}</p>
      <p
        className="stamp stamp-down mt-6 max-w-full wrap-break-word text-3xl leading-tight font-bold tracking-tight sm:text-5xl"
        style={tilt(-3)}
      >
        {result.outcome.stamp}
      </p>
      <p className="mt-7 max-w-[36ch] wrap-break-word text-xl leading-snug text-ink sm:text-2xl">{result.outcome.line}</p>
      <div className="mt-7 flex flex-wrap items-center gap-x-4 gap-y-2 border-soft-t pt-5">
        <p className="stamp stamp-down text-sm font-semibold text-pass [mask-image:none] [animation-delay:280ms]" style={tilt(2)}>
          {COPY.jevs}
        </p>
        <p className="font-mono text-[12px] tabular-nums text-ink-3">
          {COPY.stats(result.gates, result.depth, result.latencyMs, result.score)}
        </p>
      </div>
    </section>
  );
}
