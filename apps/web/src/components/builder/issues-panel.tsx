"use client";

/**
 * Live validation under the canvas: what `documentIssues` says, each issue a
 * button that selects the node it's about.
 */
import { useState } from "react";
import { cn } from "@/lib/cn";
import { issueMessage, issueTarget } from "@/lib/builder/question-ops";

export function IssuesPanel({ issues, onPick }: { issues: string[]; onPick: (path: string, tier?: string) => void }) {
  const [open, setOpen] = useState(true);
  const ok = issues.length === 0;
  return (
    <div className="border-hard-t bg-paper">
      <div className="flex h-8 items-center gap-2 px-3">
        <span aria-hidden className={cn("size-2", ok ? "bg-pass" : "bg-fail")} />
        <h2 className="font-mono text-[10px] tracking-[0.12em] text-ink-3 uppercase">checks</h2>
        <span role="status" className={cn("font-mono text-[11px]", ok ? "text-pass" : "text-fail")}>
          {ok ? "all links hold · ready to pull" : `${issues.length} broken link${issues.length === 1 ? "" : "s"} · fix before running`}
        </span>
        {!ok && (
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="ml-auto font-mono text-[10px] lowercase text-ink-3 hover:text-ink">
            {open ? "hide ▾" : "show ▴"}
          </button>
        )}
      </div>
      {!ok && open && (
        <ul className="max-h-32 overflow-y-auto border-soft-t py-1">
          {issues.map((issue) => {
            const t = issueTarget(issue);
            return (
              <li key={issue}>
                <button
                  type="button"
                  disabled={!t}
                  onClick={() => t && onPick(t.path, t.tier)}
                  className="group/i flex w-full items-baseline gap-2 px-3 py-1 text-left hover:bg-fail-wash disabled:hover:bg-transparent"
                >
                  <span aria-hidden className="font-mono text-[11px] text-fail">✕</span>
                  {t && <span className="shrink-0 font-mono text-[10.5px] text-ink-3 group-hover/i:text-ink">{t.tier ? `${t.path}/${t.tier}` : t.path}</span>}
                  <span className="min-w-0 font-mono text-[11px] break-words text-ink">{t ? issueMessage(issue) : issue}</span>
                  {t && <span className="ml-auto shrink-0 font-mono text-[10px] text-ink-3 opacity-0 group-hover/i:opacity-100">select →</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
