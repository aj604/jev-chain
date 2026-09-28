"use client";

import type { Trace } from "jevchain";
import { useMemo } from "react";
import { circuitRows } from "@/lib/circuit";
import { COPY } from "@/lib/copy";
import type { Recipe } from "@/lib/recipe/types";
import type { Verdict } from "@/lib/recipe/verdict";
import type { RunFailure } from "@/lib/run";
import { Circuit } from "./circuit";
import { ShareBar } from "./share-bar";
import { useReveal } from "./use-reveal";
import { VerdictCard } from "./verdict-card";

/** One run on the home page, from its first request to its verdict or failure. */
export interface LiveRun {
  /** A new one per run, so a late update from an older run is dropped. */
  id: number;
  recipe: Recipe;
  /** The whole input the run sent, untrimmed for the share bar. */
  input: string;
  /** The picked example's slug, or `curatedSlugFor` a generated recipe. */
  slug: string | null;
  /** The trace so far. Undefined until the run's first event. */
  trace: Trace | undefined;
  /** Null while the run goes. */
  outcome: { verdict: Verdict | null; failure: RunFailure | null } | null;
}

const FAILURE_TEXT: Record<RunFailure, string> = {
  "rate-limited": COPY.rateLimited,
  paused: COPY.paused,
  "no-answer": COPY.jevCrashed,
};

const button = "rounded-md border border-rule px-3 py-2 text-sm text-ink hover:border-ink-3";

/**
 * The live circuit, then the verdict card and share bar, or the failure line
 * and "Try again". Rows are paced by `useReveal`; the verdict and the failure
 * wait until every row is shown.
 *
 * It stays mounted with no run, so its two polite regions (the status line
 * and the verdict) are in the page before anything is announced in them. A
 * new run's rows start at 0, which `useReveal` reads as a new run.
 */
export function RunView({
  run,
  onRetry,
  onAgain,
}: {
  run: LiveRun | null;
  onRetry: () => void;
  onAgain: () => void;
}) {
  const rows = useMemo(() => (run ? circuitRows(run.recipe, run.trace) : []), [run]);
  const shown = useReveal(rows.length);

  // Done, and every row is on screen.
  const settled = run?.outcome && shown === rows.length ? run.outcome : null;
  const verdict = settled?.verdict ?? null;
  // A run that ended "ok" off every leaf has no verdict and no failure: it reads as no answer.
  const failure = settled && !verdict ? (settled.failure ?? "no-answer") : null;

  let status = "";
  if (failure) status = FAILURE_TEXT[failure];
  else if (run && !run.outcome && shown === 0) status = COPY.running;

  return (
    <section className="flex min-w-0 flex-col">
      {shown > 0 && <Circuit rows={rows.slice(0, shown)} />}
      <p role="status" className={status ? "mt-4 text-ink-2" : undefined}>
        {status}
      </p>
      {failure && (
        <div className="mt-3">
          <button type="button" className={button} onClick={onRetry}>
            {COPY.retry}
          </button>
        </div>
      )}
      <div aria-live="polite" aria-atomic="true" className={verdict ? "mt-6" : undefined}>
        {verdict && run && <VerdictCard verdict={verdict} title={run.recipe.title} live={false} />}
      </div>
      {verdict && run?.trace && (
        <div className="mt-6 flex min-w-0 flex-col gap-6">
          <ShareBar recipe={run.recipe} input={run.input} trace={run.trace} verdict={verdict} slug={run.slug} />
          <div>
            <button type="button" className={button} onClick={onAgain}>
              {COPY.again}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
