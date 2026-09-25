"use client";

import { useSyncExternalStore } from "react";
import { cn } from "@/lib/cn";
import { fmtAgo, fmtMs, previewJson } from "@/lib/trace/format";
import { isRehearsal } from "@/lib/trace/rehearsal";
import { forksOf, isWhatIf } from "@/lib/trace/what-if";
import { clearRuns, deleteRun, useSavedRuns, type SavedRun } from "@/lib/trace/saved-runs";

const STATUS_DOT: Record<string, string> = {
  ok: "bg-pass",
  halted: "bg-warn",
  error: "bg-fail",
  aborted: "bg-warn",
  running: "bg-accent",
};

// Re-render "4m ago" once a minute without a timer per row.
let minuteNow = Date.now();
const minuteSubs = new Set<() => void>();
let minuteTimer: ReturnType<typeof setInterval> | undefined;
function subscribeMinute(fn: () => void) {
  minuteSubs.add(fn);
  minuteTimer ??= setInterval(() => {
    minuteNow = Date.now();
    for (const f of minuteSubs) f();
  }, 60_000);
  return () => {
    minuteSubs.delete(fn);
    if (minuteSubs.size === 0 && minuteTimer) {
      clearInterval(minuteTimer);
      minuteTimer = undefined;
    }
  };
}

/** Date.now(), refreshed once a minute (0 during SSR). For "4m ago" labels. */
export function useMinuteNow(): number {
  return useSyncExternalStore(subscribeMinute, () => minuteNow, () => 0);
}

export function SavedRunsList({ activeId, onOpen }: { activeId?: string | null; onOpen: (run: SavedRun) => void }) {
  const runs = useSavedRuns();
  const now = useMinuteNow();

  if (runs.length === 0) {
    return <p className="px-3 pb-3 text-[12px] leading-relaxed text-ink-3">finished runs land here, in this browser only. nothing yet.</p>;
  }
  return (
    <div>
      <ul className="pb-1">
        {runs.map((r) => {
          const active = r.id === activeId;
          return (
            <li key={r.id} className={cn("group/run relative flex items-stretch", active ? "bg-accent-wash" : "hover:bg-surface-2")}>
              {active && <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-accent" />}
              <button type="button" onClick={() => onOpen(r)} className="min-w-0 flex-1 px-3 py-1.5 text-left" aria-current={active ? "true" : undefined}>
                <span className="flex items-center gap-1.5 font-mono text-[10px] text-ink-3">
                  <span aria-hidden className={cn("size-1.5 shrink-0", STATUS_DOT[r.trace.status] ?? "bg-dim")} />
                  <span className="sr-only">{r.trace.status}</span>
                  <span className="truncate">{r.chainTitle.toLowerCase()}</span>
                  <span className="ml-auto shrink-0 tabular-nums">{now ? fmtAgo(r.savedAt, now) : ""}</span>
                </span>
                <span className="mt-0.5 block truncate text-[12px] text-ink-2">{previewJson(r.input, 64)}</span>
                <span className="block font-mono text-[10px] text-ink-3 tabular-nums">
                  {fmtMs(r.trace.durationMs)} · {r.trace.usage.requests} req
                  {isRehearsal(r.trace) && <span className="text-warn"> · rehearsal</span>}
                  {isWhatIf(r.trace) && <span className="text-warn"> · what if{forksOf(r.trace).length > 1 ? ` ×${forksOf(r.trace).length}` : ""}</span>}
                </span>
              </button>
              <button
                type="button"
                onClick={() => deleteRun(r.id)}
                aria-label={`delete run from ${fmtAgo(r.savedAt)}`}
                className="grid w-7 shrink-0 place-items-center text-ink-3 opacity-0 transition-opacity duration-(--dur-fast) group-hover/run:opacity-100 hover:text-fail focus-visible:opacity-100"
              >
                <svg viewBox="0 0 12 12" className="size-2.5" aria-hidden>
                  <path d="M1.5 1.5l9 9M10.5 1.5l-9 9" stroke="currentColor" strokeWidth="1.2" />
                </svg>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="px-3 pb-3">
        <button type="button" onClick={clearRuns} className="font-mono text-[10px] lowercase text-ink-3 underline decoration-dotted underline-offset-4 hover:text-fail">
          clear all {runs.length}
        </button>
      </div>
    </div>
  );
}
