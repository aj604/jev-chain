"use client";

/**
 * Live validation under the canvas: what `documentIssues` says (broken links,
 * which block running), then what `flowWarnings` says (inputs that will
 * surprise you and outputs nothing reads, which don't). Each row selects the node it's about; a
 * warning also carries its one-click fixes.
 */
import { useState } from "react";
import { cn } from "@/lib/cn";
import type { FlowFix, FlowWarning } from "@/lib/builder/data-flow";
import { issueMessage, issueTarget } from "@/lib/builder/question-ops";

export function IssuesPanel({
  issues,
  warnings = [],
  onPick,
  onFix,
}: {
  issues: string[];
  warnings?: FlowWarning[];
  onPick: (path: string, tier?: string) => void;
  onFix?: (warning: FlowWarning, fix: FlowFix) => void;
}) {
  const [open, setOpen] = useState(true);
  const ok = issues.length === 0;
  const quiet = ok && warnings.length === 0;
  const unused = warnings.filter((w) => w.rule === "unused-output").length;
  const dead = warnings.filter((w) => w.rule === "dead-read").length;
  const inputs = warnings.length - unused - dead;
  const checks = [
    dead && `${dead} ${dead === 1 ? "node reads a result that's" : "nodes read results that are"} always empty`,
    inputs && `${inputs} input${inputs === 1 ? "" : "s"} to check`,
    unused && `${unused} output${unused === 1 ? "" : "s"} nothing reads`,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="border-hard-t bg-paper">
      <div className="flex h-8 items-center gap-2 px-3">
        <span aria-hidden className={cn("size-2", !ok ? "bg-fail" : warnings.length ? "bg-warn" : "bg-pass")} />
        <h2 className="font-mono text-[10px] tracking-[0.12em] text-ink-3 uppercase">checks</h2>
        <span role="status" className={cn("font-mono text-[11px]", ok ? "text-pass" : "text-fail")}>
          {ok ? "all links hold · ready to pull" : `${issues.length} broken link${issues.length === 1 ? "" : "s"} · fix before running`}
          {warnings.length > 0 && <span className="text-warn"> · {checks}</span>}
        </span>
        {!quiet && (
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="ml-auto font-mono text-[10px] lowercase text-ink-3 hover:text-ink">
            {open ? "hide ▾" : "show ▴"}
          </button>
        )}
      </div>
      {!quiet && open && (
        <ul className="max-h-40 overflow-y-auto border-soft-t py-1">
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
          {warnings.map((w) => {
            const where = w.tier ? `${w.path}/${w.tier}` : w.path;
            return (
              <li key={`${where}:${w.rule}`} className="group/w flex items-baseline gap-2 px-3 py-1 hover:bg-warn-wash" aria-label={`warning at ${where}`}>
                <button type="button" onClick={() => onPick(w.path, w.tier)} className="flex min-w-0 flex-1 items-baseline gap-2 text-left">
                  <span aria-hidden className="font-mono text-[11px] text-warn">!</span>
                  <span className="shrink-0 font-mono text-[10.5px] text-ink-3 group-hover/w:text-ink">{where}</span>
                  <span className="min-w-0 font-mono text-[11px] break-words text-ink">{w.message}</span>
                </button>
                {onFix && (
                  <span className="flex shrink-0 gap-1">
                    {w.fixes.map((f) => (
                      <FixButton key={f.label} fix={f} onClick={() => onFix(w, f)} />
                    ))}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function FixButton({ fix, onClick }: { fix: FlowFix; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-5 items-center border-soft px-1.5 font-mono text-[10px] lowercase text-ink-2 transition-colors duration-(--dur-fast) hover:border-warn hover:bg-warn-wash hover:text-ink"
    >
      {fix.label}
    </button>
  );
}
