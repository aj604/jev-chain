import Link from "next/link";
import type { ReactNode } from "react";
import { ChainMap } from "@/components/chain-map/chain-map";
import { Badge } from "@/components/ui/badge";
import { Code } from "@/components/ui/code-block";
import { CopyButton } from "@/components/ui/copy-button";
import { PanelDots } from "@/components/ui/panel";
import { DOC_CHAINS_FILE, getDocChain } from "@/docs/chains";
import { getRunnable } from "@/docs/runnables";
import { GITHUB_BLOB } from "@/lib/github";
import { readRegion } from "@/lib/repo-source";
import { ExampleRunner } from "./example-runner";

/**
 * A runnable example on a docs page: the chain's map, its code, and its
 * sample inputs. Server component; the live runner (input chips, run,
 * trace graph, why panel) is the client <ExampleRunner>.
 *
 *   <DocExample id="docs-fridge" />                         docs chain: shows its source region
 *   <DocExample id="haunted-desk" caption={<>…</>} />       gallery example: links to its page
 *   <DocExample id="docs-bouncer" code={false} />           map + inputs only
 */
export function DocExample({
  id,
  title,
  caption,
  code,
}: {
  /** Gallery slug or docs chain id (`docs-…`). */
  id: string;
  /** Overrides the chain's title. */
  title?: string;
  /** One or two sentences on what to look at. */
  caption?: ReactNode;
  /** Show source: default true for docs chains (their #region), false for gallery examples. A string shows that code instead. */
  code?: boolean | string;
}) {
  const r = getRunnable(id);
  if (!r) throw new Error(`<DocExample id="${id}">: no gallery example or docs chain with that id`);
  const dc = getDocChain(id);
  // Gallery examples are long; their full source lives on /examples/<slug>.
  const source =
    typeof code === "string" ? code.trim() : code !== false && dc ? readRegion(DOC_CHAINS_FILE, dc.region) : undefined;

  return (
    <figure className="my-10 border-hard bg-surface shadow-[4px_4px_0_0_var(--ink)]">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-hard-b bg-paper px-4 py-2.5">
        <span className="bg-accent px-1.5 py-0.5 font-mono text-[10px] leading-none lowercase text-accent-ink">▶ run it</span>
        <span className="font-mono text-[13px] text-ink">{title ?? r.title}</span>
        <span className="ml-auto flex items-center gap-2">
          <Badge tone={r.source === "example" ? "ink" : "neutral"}>{r.source === "example" ? "gallery" : "docs chain"}</Badge>
          {r.source === "example" ? (
            <Link href={r.href} className="font-mono text-[11px] lowercase text-ink-3 hover:text-ink">
              source →
            </Link>
          ) : (
            <a
              href={`${GITHUB_BLOB}/${DOC_CHAINS_FILE}`}
              target="_blank"
              rel="noreferrer noopener"
              className="font-mono text-[11px] lowercase text-ink-3 hover:text-ink"
            >
              chains.ts ↗
            </a>
          )}
        </span>
      </header>

      <figcaption className="border-soft-b px-4 py-3 text-[14px] leading-relaxed text-ink-2 sm:px-5">
        {caption ?? r.tagline}
      </figcaption>

      {source && (
        <div className="border-hard-b">
          <div className="flex h-8 items-center justify-between border-soft-b bg-paper px-3 font-mono text-[11px] lowercase text-ink-2">
            <span className="flex items-center gap-2">
              <PanelDots />
              <span className="ml-1">{r.source === "docs" ? "chains.ts" : "example.ts"}</span>
            </span>
            <CopyButton text={source} />
          </div>
          <Code code={source} className="max-h-[28rem] overflow-y-auto bg-surface px-4 py-4" />
        </div>
      )}

      <ExampleRunner
        id={r.id}
        inputs={r.inputs}
        preview={<ChainMap chain={r.chain} detail="full" minScale={0} label={`flow graph of ${r.title}`} />}
      />
    </figure>
  );
}
