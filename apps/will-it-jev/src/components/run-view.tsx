"use client";

import type { Trace } from "jevchain";
import { WhyPanel } from "jevchain-trace-ui/components/why-panel";
import { COPY } from "@/lib/copy";
import type { Result } from "@/lib/recipe/result";
import type { Recipe } from "@/lib/recipe/types";
import type { RunFailure } from "@/lib/run";
import { OutcomeCard } from "./outcome-card";
import { ShareBar } from "./share-bar";

/** One run on the home page, from its first request to its result or failure. */
export interface LiveRun {
  /** A new one per run, so a late update from an older run is dropped. */
  id: number;
  recipe: Recipe;
  /** The whole input the run sent, untrimmed for the share bar. */
  input: string;
  /** The picked desk's slug, or `curatedSlugFor` a generated recipe. */
  slug: string | null;
  /** The trace so far. Undefined until the run's first event. */
  trace: Trace | undefined;
  /** Null while the run goes. */
  outcome: { result: Result | null; failure: RunFailure | null } | null;
}

const FAILURE_TEXT: Record<RunFailure, string> = {
  "rate-limited": COPY.rateLimited,
  paused: COPY.paused,
  "no-answer": COPY.jevCrashed,
};

const button = "border-soft bg-surface px-3 py-2 text-sm text-ink hover:border-ink-3";

/**
 * Below the desk: the running line, then the outcome card beside the why
 * panel and the share bar, or the failure line and "Try again". `settled`
 * is the run's outcome once every paced span is on the graph, so the stamp
 * lands when the path does.
 *
 * It stays mounted with no run, so its two polite regions (the status line
 * and the outcome) are in the page before anything is announced in them.
 */
export function RunView({
  run,
  trace,
  settled,
  onRetry,
  onAgain,
  onSelect,
}: {
  run: LiveRun | null;
  /** The paced trace the graph is showing. */
  trace: Trace | undefined;
  settled: LiveRun["outcome"];
  onRetry: () => void;
  onAgain: () => void;
  onSelect: (id: string) => void;
}) {
  const result = settled?.result ?? null;
  // A run that ended "ok" off every leaf has no result and no failure: it reads as no answer.
  const failure = settled && !result ? (settled.failure ?? "no-answer") : null;

  let status = "";
  if (failure) status = FAILURE_TEXT[failure];
  else if (run && !settled) status = COPY.running;

  return (
    <section className="flex min-w-0 flex-col">
      <p role="status" className={status ? "font-mono text-[13px] text-ink-2" : undefined}>
        {status}
      </p>
      {failure && (
        <div className="mt-3">
          <button type="button" className={button} onClick={onRetry}>
            {COPY.retry}
          </button>
        </div>
      )}
      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div aria-live="polite" aria-atomic="true" className="min-w-0">
          {result && run && <OutcomeCard result={result} title={run.recipe.title} live={false} />}
        </div>
        {result && trace && (
          <section className="min-w-0 border-hard bg-surface">
            <h3 className="border-soft-b px-4 py-2.5 font-mono text-[12px] text-ink-3">{COPY.whyHeading}</h3>
            <WhyPanel trace={trace} onSelect={onSelect} runHint={null} className="max-h-[28rem] overflow-y-auto" />
          </section>
        )}
      </div>
      {result && run?.trace && (
        <div className="mt-6 flex min-w-0 flex-col gap-6">
          <ShareBar recipe={run.recipe} input={run.input} trace={run.trace} result={result} slug={run.slug} />
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
