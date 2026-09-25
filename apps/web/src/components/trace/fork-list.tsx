"use client";

/**
 * The chain of "what ifs" behind a what-if trace: every decision that was
 * forced, in the order the run reached them, each one clickable.
 */
import { cn } from "@/lib/cn";
import { edgeName, type ForcedDecision } from "@/lib/trace/what-if";

export function ForkList({ forks, onSelect, className }: { forks: ForcedDecision[]; onSelect?: (path: string) => void; className?: string }) {
  if (forks.length === 0) return null;
  return (
    <ol className={cn("space-y-1", className)} aria-label="forced decisions">
      {forks.map((f, i) => (
        <li key={f.path} className="flex min-w-0 items-center gap-2 font-mono text-[11px]">
          <span aria-hidden className="grid size-4 shrink-0 place-items-center border-(length:--bw) border-dashed border-compare text-[9px] text-compare">
            {i + 1}
          </span>
          <button
            type="button"
            onClick={() => onSelect?.(f.path)}
            className="min-w-0 truncate text-left text-ink underline decoration-dotted underline-offset-4 hover:text-accent-strong"
            title={f.path}
          >
            {f.title ?? f.nodeId}
          </button>
          <span className="shrink-0 text-ink-3">→ {edgeName(f.edge)}</span>
        </li>
      ))}
    </ol>
  );
}
