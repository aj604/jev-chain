"use client";

/**
 * Timeline: the run as a waterfall. One row per span, bars from start to end
 * on a shared ms axis, Jev calls as inner segments (hatched when batched),
 * parallel branches overlapping, running spans growing live.
 *
 *   <Timeline trace={trace} now={elapsedMs} selected={id} onSelect={setId} />
 */
import type { CSSProperties } from "react";
import type { Span, Trace } from "jevchain";
import { cn } from "@/lib/cn";
import { fmtMs } from "@/lib/trace/format";
import { pathDepth, timeTicks } from "@/lib/trace/ticks";
import { KIND_GLYPH, StateMark } from "./kinds";

export interface TimelineProps {
  trace?: Trace;
  /** Live elapsed ms while running (so running bars grow). */
  now?: number;
  selected?: string | null;
  onSelect?: (id: string) => void;
  className?: string;
}

const HATCH: CSSProperties = {
  backgroundImage: "repeating-linear-gradient(135deg, var(--accent) 0 3px, var(--accent-2) 3px 6px)",
};

export function Timeline({ trace, now, selected, onSelect, className }: TimelineProps) {
  if (!trace || trace.spans.length === 0) {
    return (
      <div className={cn("grid h-full place-items-center px-4 py-6 font-mono text-[11px] lowercase text-ink-3", className)}>
        {trace ? "starting the chain…" : "the waterfall fills in as the chain runs."}
      </div>
    );
  }
  const maxEnd = Math.max(...trace.spans.map((s) => s.end ?? s.start), 1);
  const total = Math.max(trace.durationMs ?? 0, now ?? 0, maxEnd, 1);
  const ticks = timeTicks(total);
  const pct = (ms: number) => `${Math.min(100, Math.max(0, (ms / total) * 100))}%`;
  const minDepth = Math.min(...trace.spans.map((s) => pathDepth(s.path)));

  return (
    <div className={cn("min-w-[36rem] font-mono text-[11px]", className)} role="list" aria-label="run timeline">
      {/* axis */}
      <div className="sticky top-0 z-10 grid grid-cols-[minmax(11rem,16rem)_1fr] border-soft-b bg-paper">
        <div className="px-3 py-1 text-[10px] lowercase text-ink-3">span</div>
        <div className="relative mr-12 h-6">
          {ticks.map((t) => (
            <span key={t} className="absolute top-0 flex h-full -translate-x-px items-end pb-1 text-[10px] tabular-nums text-ink-3" style={{ left: pct(t) }}>
              <span className="absolute top-0 bottom-0 left-0 w-(--bw) bg-line-soft" />
              <span className="pl-1">{fmtMs(t)}</span>
            </span>
          ))}
        </div>
      </div>
      {trace.spans.map((span) => (
        <Row
          key={span.path}
          span={span}
          depth={pathDepth(span.path) - minDepth}
          total={total}
          now={now}
          ticks={ticks}
          selected={selected === span.path}
          onSelect={onSelect}
        />
      ))}
    </div>
  );
}

function Row({
  span,
  depth,
  total,
  now,
  ticks,
  selected,
  onSelect,
}: {
  span: Span;
  depth: number;
  total: number;
  now?: number;
  ticks: number[];
  selected: boolean;
  onSelect?: (id: string) => void;
}) {
  const end = span.end ?? now ?? span.start;
  const dur = Math.max(0, end - span.start);
  const left = (span.start / total) * 100;
  const width = Math.max(0.4, (dur / total) * 100);
  const running = span.status === "running";
  const title = span.title ?? span.nodeId;
  const label = `${span.kind} ${title}: starts +${fmtMs(span.start)}, ${running ? "running" : `took ${fmtMs(dur)}`}`;

  return (
    <div
      role="listitem"
      className={cn(
        "group/row relative grid grid-cols-[minmax(11rem,16rem)_1fr] border-soft-b transition-colors duration-(--dur-fast) last:border-b-0",
        selected ? "bg-accent-wash" : "hover:bg-surface-2",
      )}
    >
      <button
        type="button"
        onClick={() => onSelect?.(span.path)}
        aria-label={label}
        aria-pressed={selected}
        className="flex h-7 min-w-0 items-center gap-1.5 pr-2 text-left"
        style={{ paddingLeft: `${12 + depth * 12}px` }}
      >
        {selected && <span aria-hidden className="absolute left-0 h-7 w-[3px] bg-accent" />}
        <span aria-hidden className="w-3 shrink-0 text-center text-ink-3">
          {KIND_GLYPH[span.kind]}
        </span>
        <span className={cn("min-w-0 flex-1 truncate", span.status === "ok" || running ? "text-ink" : "text-ink-2")}>
          {span.edge && span.parentPath && !/^\d+$/.test(span.edge) ? <span className="text-ink-3">{span.edge} → </span> : null}
          {title}
        </span>
        <StateMark state={span.status} />
      </button>
      <div className="relative mr-12 h-7 cursor-pointer" onClick={() => onSelect?.(span.path)} aria-hidden>
        {ticks.map((t) => (
          <span key={t} className="absolute inset-y-0 w-(--bw) bg-line-soft opacity-60" style={{ left: `${(t / total) * 100}%` }} />
        ))}
        <div
          className={cn(
            "absolute top-1.5 h-4 border-(length:--bw) transition-[width] duration-75",
            running && "border-accent bg-accent-wash",
            span.status === "ok" && "border-line bg-surface",
            span.status === "error" && "border-fail bg-fail-wash",
            span.status === "halted" && "border-warn bg-warn-wash",
          )}
          style={{ left: `${left}%`, width: `${width}%` }}
          title={`+${fmtMs(span.start)} → ${fmtMs(end)} (${fmtMs(dur)})`}
        >
          {span.calls.map((c) => {
            const cl = dur > 0 ? ((c.start - span.start) / dur) * 100 : 0;
            const cw = dur > 0 ? Math.max(1.5, ((c.end - c.start) / dur) * 100) : 100;
            return (
              <span
                key={c.id}
                className={cn("absolute inset-y-0", !c.batch && "bg-accent")}
                style={{ left: `${Math.max(0, cl)}%`, width: `${Math.min(100 - Math.max(0, cl), cw)}%`, ...(c.batch ? HATCH : {}) }}
                title={`jev call${c.tier ? ` (${c.tier})` : ""}: ${fmtMs(c.latencyMs)}${c.batch ? ` · batched ×${c.batch.size}` : ""}`}
              />
            );
          })}
          {span.retries.map((r, i) => (
            <span
              key={i}
              className="absolute -top-1 -bottom-1 w-[2px] bg-warn"
              style={{ left: `${dur > 0 ? ((r.at - span.start) / dur) * 100 : 0}%` }}
              title={`retry ${r.attempt}: ${r.error.code}`}
            />
          ))}
        </div>
        <span
          className="pointer-events-none absolute top-1/2 -translate-y-1/2 pl-1.5 text-[10px] whitespace-nowrap tabular-nums text-ink-3"
          style={{ left: `${Math.min(100, left + width)}%` }}
        >
          {running ? "…" : fmtMs(dur)}
        </span>
      </div>
    </div>
  );
}
