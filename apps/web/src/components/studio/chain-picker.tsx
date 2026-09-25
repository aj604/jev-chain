"use client";

import { examples } from "jevchain-examples";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/cn";
import type { ChainSource } from "@/lib/trace/chain-source";

export function ChainPicker({
  source,
  customTitle,
  customNote,
  docsChain,
  onPick,
  onImport,
  onPickCustom,
  onNew,
  disabled,
}: {
  source: ChainSource;
  /** Title of the loaded custom chain, if any. */
  customTitle?: string;
  /** Subtitle for the custom chain (defaults to "custom · from json"). */
  customNote?: string;
  /** A docs chain opened by deep link (`?example=docs-…`); shown while it's on screen. */
  docsChain?: { title: string; href?: string };
  onPick: (slug: string) => void;
  onImport: () => void;
  onPickCustom?: () => void;
  /** Start a blank chain in the builder. */
  onNew?: () => void;
  disabled?: boolean;
}) {
  const item = (active: boolean) =>
    cn(
      "group/pick relative flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors duration-(--dur-fast) disabled:opacity-50",
      active ? "bg-accent-wash" : "hover:bg-surface-2",
    );
  return (
    <nav aria-label="chains">
      <ul>
        {examples.map((ex, i) => {
          const active = source.kind === "example" && source.slug === ex.slug;
          return (
            <li key={ex.slug}>
              <button type="button" className={item(active)} onClick={() => onPick(ex.slug)} disabled={disabled} aria-current={active ? "true" : undefined}>
                {active && <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-accent" />}
                <Kbd className={cn("mt-px shrink-0", active && "border-hard bg-accent text-accent-ink")}>{i + 1}</Kbd>
                <span className="min-w-0">
                  <span className={cn("block truncate text-[13px] leading-5", active ? "font-medium text-ink" : "text-ink-2 group-hover/pick:text-ink")}>
                    {ex.title}
                  </span>
                  <span className="block truncate font-mono text-[10px] lowercase text-ink-3">{ex.pattern}</span>
                </span>
              </button>
            </li>
          );
        })}
        {docsChain && (
          <li>
            <div className={item(true)} aria-current="true">
              <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-accent" />
              <Kbd className="mt-px shrink-0 border-hard bg-accent text-accent-ink">§</Kbd>
              <span className="min-w-0">
                <span className="block truncate text-[13px] leading-5 font-medium text-ink">{docsChain.title}</span>
                <span className="block truncate font-mono text-[10px] lowercase text-ink-3">
                  from the docs
                  {docsChain.href && (
                    <>
                      {" · "}
                      <a href={docsChain.href} className="underline decoration-dotted underline-offset-2 hover:text-ink">
                        read the page
                      </a>
                    </>
                  )}
                </span>
              </span>
            </div>
          </li>
        )}
        {customTitle && (
          <li>
            <button
              type="button"
              className={item(source.kind === "doc")}
              onClick={onPickCustom}
              disabled={disabled || !onPickCustom}
              aria-current={source.kind === "doc" ? "true" : undefined}
            >
              {source.kind === "doc" && <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-accent" />}
              <Kbd className="mt-px shrink-0">{"{}"}</Kbd>
              <span className="min-w-0">
                <span className="block truncate text-[13px] leading-5 text-ink">{customTitle}</span>
                <span className="block truncate font-mono text-[10px] lowercase text-ink-3">{customNote ?? "custom · from json"}</span>
              </span>
            </button>
          </li>
        )}
      </ul>
      <div className={cn("gap-1.5 px-3 pt-1 pb-2", onNew ? "grid grid-cols-2" : "flex")}>
        {onNew && (
          <button type="button" onClick={onNew} disabled={disabled} className={dashed}>
            <span aria-hidden>✎</span> build one
          </button>
        )}
        <button type="button" onClick={onImport} disabled={disabled} className={dashed}>
          <span aria-hidden>+</span> {onNew ? "import json" : "import a chain (json)"}
        </button>
      </div>
    </nav>
  );
}

const dashed =
  "flex h-7 w-full items-center justify-center gap-1.5 border-(length:--bw) border-dashed border-ink-3 font-mono text-[11px] lowercase text-ink-2 transition-colors duration-(--dur-fast) hover:border-ink hover:bg-surface-2 hover:text-ink disabled:opacity-50";
