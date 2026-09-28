"use client";

import type { Trace } from "jevchain";
import Link from "next/link";
import { useEffect, useState } from "react";
import { circuitRows, type CircuitRow } from "@/lib/circuit";
import { COPY } from "@/lib/copy";
import type { Recipe } from "@/lib/recipe/types";
import { verdictOf, type Verdict } from "@/lib/recipe/verdict";
import { curatedSlugFor, isTrimmed, readVerdictPayload, ShareError } from "@/lib/share";
import { Circuit } from "./circuit";
import { ShareBar } from "./share-bar";
import { VerdictCard } from "./verdict-card";

/** Everything the page shows for a good link, worked out from the hash alone. */
interface Shared {
  recipe: Recipe;
  input: string;
  trace: Trace;
  verdict: Verdict;
  rows: CircuitRow[];
  /** `curatedSlugFor` the recipe, for re-sharing. Never the query's `r`. */
  slug: string | null;
  trimmed: boolean;
}

type View = { kind: "decoding" } | { kind: "damaged" } | { kind: "shared"; shared: Shared };

/** The run in `hash`. Rejects for anything `readVerdictPayload` rejects, or a verdict that won't recompute. */
async function readShared(hash: string): Promise<Shared> {
  const { recipe, input, trace } = await readVerdictPayload(hash);
  const verdict = verdictOf(recipe, { status: trace.status, output: trace.output, trace });
  if (!verdict) throw new ShareError();
  return {
    recipe,
    input,
    trace,
    verdict,
    rows: circuitRows(recipe, trace),
    slug: curatedSlugFor(recipe),
    trimmed: isTrimmed(input),
  };
}

const jevSomething = "inline-block rounded-md bg-ink px-4 py-2 font-medium text-paper hover:opacity-90";

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

  const { recipe, input, trace, verdict, rows, slug, trimmed } = view.shared;
  return (
    <div className="flex min-w-0 flex-col gap-6">
      <div className="flex min-w-0 flex-col gap-3">
        <p className="text-ink-2">{COPY.sentThis}</p>
        {/* Text, never HTML: React escapes it, and pre-wrap keeps its line breaks. */}
        <blockquote className="min-w-0 border-l-2 border-rule pl-3 whitespace-pre-wrap wrap-break-word text-ink">
          {input}
        </blockquote>
        {trimmed && <p className="text-sm text-ink-3">{COPY.trimmed}</p>}
      </div>
      <Circuit rows={rows} />
      {/* Not a live region: the verdict is part of the page, not an update to it. */}
      <VerdictCard verdict={verdict} title={recipe.title} live={false} />
      <ShareBar recipe={recipe} input={input} trace={trace} verdict={verdict} slug={slug} trimmedInput={trimmed} />
      <p className="border-t border-rule pt-6">
        <Link href="/" className={jevSomething}>
          {COPY.jevSomething}
        </Link>
      </p>
    </div>
  );
}
