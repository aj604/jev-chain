"use client";

import type { Trace } from "jevchain";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { COPY } from "@/lib/copy";
import type { Recipe } from "@/lib/recipe/types";
import type { Result } from "@/lib/recipe/result";
import { buildShareLinks, copyText, recipeCode, type ShareLinks } from "./share-actions";

/** How long "Copied." shows before the button reads "Copy link" again. */
const COPIED_MS = 2000;

export interface ShareBarProps {
  recipe: Recipe;
  input: string;
  trace: Trace;
  result: Result;
  /** A curated recipe's slug for the link's query, or null. */
  slug: string | null;
  /** The input was cut for a share link: the studio button says so. */
  trimmedInput?: boolean;
}

/**
 * Copy link, open in the studio, and show the code. Both links are async to
 * build, so they are built as soon as the run is here and the click is
 * instant. Until they are ready the two link controls are inert.
 */
export function ShareBar({ recipe, input, trace, result, slug, trimmedInput }: ShareBarProps) {
  const links = useShareLinks(recipe, input, trace, result, slug);
  const [copied, setCopied] = useState(false);
  const [showCode, setShowCode] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const codeId = useId();
  const code = useMemo(() => (showCode ? recipeCode(recipe) : ""), [showCode, recipe]);

  useEffect(
    () => () => {
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
    },
    [],
  );

  const copy = async () => {
    if (!links || !(await copyText(links.share))) return;
    setCopied(true);
    if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
    copiedTimer.current = setTimeout(() => setCopied(false), COPIED_MS);
  };

  const button =
    "border-soft bg-surface px-3 py-2 text-sm text-ink hover:border-ink-3 disabled:text-ink-3 aria-disabled:text-ink-3";

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        <button type="button" className={button} disabled={!links} onClick={copy}>
          <span aria-live="polite">{copied ? COPY.copied : COPY.share}</span>
        </button>
        <a
          className={button}
          href={links?.studio}
          aria-disabled={links ? undefined : true}
          target="_blank"
          rel="noopener noreferrer"
        >
          {trimmedInput ? COPY.openInStudioTrimmed : COPY.openInStudio}
        </a>
        <button
          type="button"
          className={button}
          aria-expanded={showCode}
          aria-controls={codeId}
          onClick={() => setShowCode((shown) => !shown)}
        >
          {showCode ? COPY.hideCode : COPY.showCode}
        </button>
      </div>
      <div id={codeId} hidden={!showCode} className="min-w-0">
        {showCode && (
          <>
            <pre
              tabIndex={0}
              className="max-h-96 overflow-auto border-soft bg-surface-2 p-3 font-mono text-xs leading-relaxed text-ink select-all"
            >
              <code>{code}</code>
            </pre>
            <p className="mt-2 text-sm text-ink-2">{COPY.codeNote}</p>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The share bar's links for these props, or null while they are being
 * built (or when building failed). A build for props that have since changed
 * is dropped, so a slow build never shows another run's links.
 */
function useShareLinks(
  recipe: Recipe,
  input: string,
  trace: Trace,
  result: Result,
  slug: string | null,
): ShareLinks | null {
  const [built, setBuilt] = useState<{ key: readonly unknown[]; links: ShareLinks } | null>(null);
  const key = [recipe, input, trace, result, slug] as const;

  useEffect(() => {
    let live = true;
    buildShareLinks({ recipe, input, trace, result, slug }, window.location.origin).then(
      (links) => {
        if (live) setBuilt({ key: [recipe, input, trace, result, slug], links });
      },
      () => {},
    );
    return () => {
      live = false;
    };
  }, [recipe, input, trace, result, slug]);

  return built && built.key.every((part, i) => part === key[i]) ? built.links : null;
}
