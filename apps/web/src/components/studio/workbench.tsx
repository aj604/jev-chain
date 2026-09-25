"use client";

/**
 * The studio's working area, shared by the live studio and read-only share
 * links: graph in the middle, inspector / story on the right, waterfall at
 * the bottom, optional rail on the left.
 */
import { useCallback, useRef, useState, type ReactNode } from "react";
import type { AnyNode, FlowGraph, Trace } from "jevchain";
import { Inspector } from "@/components/trace/inspector";
import { RunSummary } from "@/components/trace/run-summary";
import { Timeline } from "@/components/trace/timeline";
import { TraceGraph, type TraceGraphProps } from "@/components/trace/trace-graph";
import { WhyPanel } from "@/components/trace/why-panel";
import { cn } from "@/lib/cn";
import type { ResolvedChain } from "@/lib/trace/chain-source";
import type { RunIssue } from "@/lib/trace/run-error";
import { CompareSummary, diffHeadline } from "./compare-summary";

export type Target = "a" | "b" | "diff";

export interface WorkbenchProps {
  chain: ResolvedChain;
  graph: FlowGraph;
  trace?: Trace;
  issue?: RunIssue | null;
  now?: number;
  /** Compare mode: the B run. */
  compare?: { trace?: Trace; issue?: RunIssue | null; now?: number };
  target: Target;
  onTarget: (t: Target) => void;
  selected: string | null;
  onSelect: (id: string | null) => void;
  fitSignal?: number;
  header: ReactNode;
  rail?: ReactNode;
  issueAction?: ReactNode;
  issueActionB?: ReactNode;
  /** Builder mode: replaces the inspector / story column. */
  aside?: ReactNode;
  /** Builder mode: replaces the timeline strip. */
  footer?: ReactNode;
  /** Drawn over the canvas (e.g. a code drawer). */
  canvasOverlay?: ReactNode;
  /** Draw this tree instead of `chain.node` (the builder's raw document, valid or not). */
  graphNode?: AnyNode;
  /** Extra TraceGraph props for the builder. */
  graphProps?: Pick<TraceGraphProps, "decorations" | "onNodeContextMenu" | "children">;
}

const TIMELINE_MIN = 72;
const TIMELINE_DEFAULT = 208;

export function Workbench({
  chain,
  graph,
  trace,
  issue,
  now,
  compare,
  target,
  onTarget,
  selected,
  onSelect,
  fitSignal,
  header,
  rail,
  issueAction,
  issueActionB,
  aside,
  footer,
  canvasOverlay,
  graphNode,
  graphProps,
}: WorkbenchProps) {
  const [timelineH, setTimelineH] = useState(TIMELINE_DEFAULT);
  const [timelineOpen, setTimelineOpen] = useState(true);
  const drag = useRef<{ y: number; h: number } | null>(null);

  const comparing = compare !== undefined;
  const showB = comparing && target === "b";
  const focusTrace = showB ? compare.trace : trace;
  const focusIssue = showB ? compare.issue : issue;
  const focusNow = showB ? compare.now : now;
  const select = useCallback((id: string | null) => onSelect(id), [onSelect]);
  const head = comparing && trace && compare.trace && trace.status !== "running" && compare.trace.status !== "running" ? diffHeadline(trace, compare.trace) : null;

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { y: e.clientY, h: timelineH };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const max = Math.round(window.innerHeight * 0.6);
    setTimelineH(Math.max(TIMELINE_MIN, Math.min(max, drag.current.h + (drag.current.y - e.clientY))));
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  return (
    <div
      className={cn(
        "flex flex-col lg:grid lg:h-[calc(100dvh-var(--nav-h))] lg:overflow-hidden",
        rail ? "lg:grid-cols-[17.5rem_minmax(0,1fr)_minmax(20rem,24rem)]" : "lg:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)]",
      )}
    >
      {rail && <aside className="min-h-0 border-hard-b bg-paper lg:overflow-y-auto lg:border-b-0 lg:border-hard-r">{rail}</aside>}

      <section className="flex min-h-0 min-w-0 flex-col">
        <div className="border-hard-b bg-paper">{header}</div>
        <div className="border-soft-b bg-paper">
          <RunSummary trace={trace} now={now} label={comparing ? "a" : undefined} />
          {comparing && <RunSummary trace={compare.trace} now={compare.now} label="b" className="border-soft-t" />}
        </div>
        {head && (
          <button
            type="button"
            onClick={() => {
              onTarget("diff");
              if (head.path) onSelect(head.path);
            }}
            className="fade-up flex items-center gap-2 border-soft-b bg-surface-2 px-3 py-1.5 text-left font-mono text-[11px] text-ink hover:bg-surface"
          >
            <span aria-hidden className="flex gap-0.5">
              <span className="size-2 border-hard bg-accent" />
              <span className="size-2 border-hard bg-compare" />
            </span>
            <span className="truncate">{head.text}</span>
          </button>
        )}
        <div className="relative h-[62vh] min-h-[22rem] lg:h-auto lg:min-h-0 lg:flex-1">
          <TraceGraph
            {...graphProps}
            chain={graphNode ?? chain.node}
            graph={graph}
            trace={trace}
            {...(comparing ? { compare: compare.trace } : {})}
            selected={selected}
            onSelect={select}
            fitSignal={fitSignal}
          />
          {canvasOverlay}
        </div>
        {footer ?? (
        <div className="border-hard-t bg-paper">
          <div className="flex h-8 items-center gap-2 border-soft-b px-3">
            <div
              role="separator"
              aria-orientation="horizontal"
              aria-label="resize timeline"
              aria-valuenow={timelineH}
              aria-valuemin={TIMELINE_MIN}
              tabIndex={timelineOpen ? 0 : -1}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onKeyDown={(e) => {
                if (e.key === "ArrowUp") setTimelineH((h) => Math.min(Math.round(window.innerHeight * 0.6), h + 24));
                if (e.key === "ArrowDown") setTimelineH((h) => Math.max(TIMELINE_MIN, h - 24));
              }}
              className={cn(
                "hidden h-full w-16 cursor-row-resize items-center justify-center lg:flex",
                !timelineOpen && "pointer-events-none opacity-0",
              )}
            >
              <span aria-hidden className="h-[3px] w-8 border-y-(length:--bw) border-ink-3" />
            </div>
            <h2 className="font-mono text-[10px] tracking-[0.12em] text-ink-3 uppercase">
              timeline{comparing ? ` · ${showB ? "b" : "a"}` : ""}
            </h2>
            {comparing && (
              <div className="ml-2 flex border-soft">
                {(["a", "b"] as const).map((t) => (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={(showB ? "b" : "a") === t}
                    onClick={() => onTarget(t)}
                    className={cn(
                      "h-5 px-2 font-mono text-[10px]",
                      (showB ? "b" : "a") === t ? (t === "a" ? "bg-accent text-accent-ink" : "bg-compare text-paper") : "text-ink-3 hover:text-ink",
                    )}
                  >
                    {t}
                  </button>
                ))}
              </div>
            )}
            <span className="ml-auto hidden font-mono text-[10px] text-ink-3 sm:inline">
              <span className="mr-1 inline-block h-2 w-3 bg-accent align-middle" /> jev call
              <span className="mr-1 ml-3 inline-block h-2 w-3 align-middle" style={{ backgroundImage: "repeating-linear-gradient(135deg, var(--accent) 0 3px, var(--accent-2) 3px 6px)" }} /> batched
            </span>
            <button
              type="button"
              onClick={() => setTimelineOpen((o) => !o)}
              aria-expanded={timelineOpen}
              className="ml-2 font-mono text-[10px] lowercase text-ink-3 hover:text-ink sm:ml-3"
            >
              {timelineOpen ? "hide ▾" : "show ▴"}
            </button>
          </div>
          {timelineOpen && (
            <div className="overflow-auto lg:h-(--tl-h)" style={{ ["--tl-h" as string]: `${timelineH}px` }}>
              <Timeline trace={focusTrace} now={focusNow} selected={selected} onSelect={select} />
            </div>
          )}
        </div>
        )}
      </section>

      <aside className="min-h-0 border-hard-t bg-paper lg:overflow-y-auto lg:border-t-0 lg:border-hard-l" aria-label={aside ? "properties" : "inspector"}>
        {aside ?? (
        <>
        {comparing && (
          <div className="sticky top-0 z-10 flex border-hard-b bg-paper" role="tablist" aria-label="which run">
            {(["a", "b", "diff"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={target === t}
                onClick={() => onTarget(t)}
                className={cn(
                  "relative h-9 flex-1 font-mono text-[11px] lowercase transition-colors duration-(--dur-fast)",
                  target === t ? "text-ink" : "text-ink-3 hover:text-ink",
                  t !== "a" && "border-soft-l",
                )}
              >
                {t === "diff" ? "a vs b" : `run ${t}`}
                {target === t && (
                  <span aria-hidden className={cn("absolute inset-x-0 bottom-0 h-[3px]", t === "a" ? "bg-accent" : t === "b" ? "bg-compare" : "bg-ink")} />
                )}
              </button>
            ))}
          </div>
        )}
        {comparing && target === "diff" && !selected ? (
          <CompareSummary a={trace} b={compare.trace} onSelect={select} />
        ) : selected ? (
          <Inspector graph={graph} trace={focusTrace} selected={selected} onSelect={select} />
        ) : (
          <WhyPanel trace={focusTrace} issue={focusIssue} onSelect={select} issueAction={showB ? issueActionB : issueAction} />
        )}
        </>
        )}
      </aside>
    </div>
  );
}
