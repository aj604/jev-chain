"use client";

import type { Trace } from "jevchain";
import Link from "next/link";
import { useEffect, useState } from "react";
import { COPY } from "@/lib/copy";
import type { Recipe } from "@/lib/recipe/types";
import { resultOf, type Result } from "@/lib/recipe/result";
import { curatedSlugFor, isTrimmed, readVerdictPayload, ShareError } from "@/lib/share";
import { WhyPanel } from "jevchain-trace-ui/components/why-panel";
import { DeskGraph } from "./desk-graph";
import { ShareBar } from "./share-bar";
import { OutcomeCard } from "./outcome-card";

/** Everything the page shows for a good link, worked out from the hash alone. */
interface Shared {
  recipe: Recipe;
  input: string;
  trace: Trace;
  result: Result;
  /** `curatedSlugFor` the recipe, for re-sharing. Never the query's `r`. */
  slug: string | null;
  trimmed: boolean;
}

type View = { kind: "decoding" } | { kind: "damaged" } | { kind: "shared"; shared: Shared };

/** The run in `hash`. Rejects for anything `readVerdictPayload` rejects, or a result that won't recompute. */
async function readShared(hash: string): Promise<Shared> {
  const { recipe, input, trace } = await readVerdictPayload(hash);
  const result = resultOf(recipe, { status: trace.status, output: trace.output, trace });
  if (!result) throw new ShareError();
  return {
    recipe,
    input,
    trace,
    result,
    slug: curatedSlugFor(recipe),
    trimmed: isTrimmed(input),
  };
}

const jevSomething = "inline-block border-hard bg-accent px-5 py-2 font-semibold text-accent-ink hover:bg-accent-2";

/**
 * A shared run, read from `window.location.hash` in the browser. It makes no
 * requests and runs nothing: the run already happened, so the whole circuit
 * shows at once. The query string is never read here; it only feeds the
 * server's share preview. A new hash (an edited link) is read again.
 */
export function SharedVerdict() {
  const [view, setView] = useState<View>({ kind: "decoding" });

  useEffect(() => {
    let latest = 0;
    const read = () => {
      const id = ++latest;
      readShared(window.location.hash).then(
        (shared) => {
          if (id === latest) setView({ kind: "shared", shared });
        },
        () => {
          if (id === latest) setView({ kind: "damaged" });
        },
      );
    };
    read();
    window.addEventListener("hashchange", read);
    return () => {
      // Drops a decode still in flight.
      latest = -1;
      window.removeEventListener("hashchange", read);
    };
  }, []);

  if (view.kind === "decoding") return null;

  if (view.kind === "damaged") {
    return (
      <div className="flex min-w-0 flex-col gap-6">
        <p className="wrap-break-word text-lg text-ink">{COPY.badLink}</p>
        <p>
          <Link href="/" className={jevSomething}>
            {COPY.jevSomething}
          </Link>
        </p>
      </div>
    );
  }

  const { recipe, input, trace, result, slug, trimmed } = view.shared;
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex min-w-0 flex-col gap-3">
        <p className="text-ink-2">{COPY.sentThis}</p>
        {/* Text, never HTML: React escapes it, and pre-wrap keeps its line breaks. */}
        <blockquote className="min-w-0 border-l-2 border-accent pl-3 whitespace-pre-wrap wrap-break-word text-ink">
          {input}
        </blockquote>
        {trimmed && <p className="text-sm text-ink-3">{COPY.trimmed}</p>}
      </div>
      <div className="relative h-80 border-hard bg-paper sm:h-96">
        <DeskGraph recipe={recipe} trace={trace} className="h-full" />
      </div>
      <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        {/* Not a live region: the result is part of the page, not an update to it. */}
        <OutcomeCard result={result} title={recipe.title} live={false} />
        <section className="min-w-0 border-hard bg-surface">
          <h3 className="border-soft-b px-4 py-2.5 font-mono text-[12px] text-ink-3">{COPY.whyHeading}</h3>
          <WhyPanel trace={trace} runHint={null} className="max-h-[28rem] overflow-y-auto" />
        </section>
      </div>
      <ShareBar recipe={recipe} input={input} trace={trace} result={result} slug={slug} trimmedInput={trimmed} />
      <p className="border-soft-t pt-6">
        <Link href="/" className={jevSomething}>
          {COPY.jevSomething}
        </Link>
      </p>
    </div>
  );
}
