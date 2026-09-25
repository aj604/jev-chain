"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Json } from "jevchain";
import { useShell } from "@/components/shell/shell-provider";
import { RunSummary } from "@/components/trace/run-summary";
import { useChainRun, useRunClock } from "@/components/trace/use-chain-run";
import { WhyPanel } from "@/components/trace/why-panel";
import { Button } from "@/components/ui/button";
import { getRunnable } from "@/docs/runnables";
import { cn } from "@/lib/cn";
import { previewInput, studioHref } from "@/lib/studio-link";

// React Flow is the heavy part: only load it for examples that scroll near the viewport.
const TraceGraph = dynamic(() => import("@/components/trace/trace-graph").then((m) => m.TraceGraph), {
  ssr: false,
  loading: () => null,
});

/**
 * A compact live runner for a docs example: pick an input, run it through
 * `/api/jev`, watch the trace paint onto the graph, then read why.
 *
 * Until the example nears the viewport (and with JS off), it shows `preview`,
 * the static map drawn on the server, so a page with several examples stays light.
 */
export interface ExampleRunnerProps {
  /** Gallery slug or docs chain id (`docs-…`). */
  id: string;
  inputs: { label: string; value: Json }[];
  /** The static map, drawn server-side. Shown until the live graph mounts. */
  preview: ReactNode;
}

export function ExampleRunner({ id, inputs, preview }: ExampleRunnerProps) {
  const chain = useMemo(() => getRunnable(id)?.chain, [id]);
  const run = useChainRun();
  const { openKeyDialog } = useShell();
  const [picked, setPicked] = useState(0);
  const [whyOpen, setWhyOpen] = useState(false);
  const [near, setNear] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = boxRef.current;
    if (!el || near) return;
    const io = new IntersectionObserver(([e]) => {
      if (e?.isIntersecting) setNear(true);
    }, { rootMargin: "300px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [near]);

  const running = run.phase === "running";
  const now = useRunClock(running, run.startedAtPerf, run.trace?.durationMs);
  const input = inputs[picked]?.value ?? "";

  const start = () => {
    if (!chain) return;
    setNear(true);
    void run.start(chain, input).then((trace) => {
      // Surface problems right away; a clean run keeps the story folded.
      if (!trace || trace.status !== "ok") setWhyOpen(true);
    });
  };

  return (
    <div>
      <div ref={boxRef} className="relative h-72 overflow-hidden border-hard-b bg-paper sm:h-80">
        {near && chain ? (
          <TraceGraph chain={chain} trace={run.trace} compact className="h-full" />
        ) : (
          <div className="bg-grid flex h-full items-center justify-center overflow-hidden px-4 py-5">{preview}</div>
        )}
      </div>

      <div className="space-y-3 px-4 py-4 sm:px-5">
        <div role="radiogroup" aria-label="sample input" className="flex flex-wrap gap-1.5">
          {inputs.map((inp, i) => (
            <button
              key={inp.label}
              type="button"
              role="radio"
              aria-checked={i === picked}
              disabled={running}
              onClick={() => setPicked(i)}
              className={cn(
                "h-7 px-2.5 font-mono text-[11.5px] lowercase transition-colors duration-(--dur-fast) disabled:opacity-60",
                i === picked ? "border-hard bg-ink text-paper" : "border-soft bg-surface text-ink-2 hover:border-ink-3 hover:text-ink",
              )}
            >
              {inp.label}
            </button>
          ))}
        </div>

        <p className="line-clamp-2 min-h-[3.2em] font-mono text-[12px] leading-relaxed break-words text-ink-3">
          <span aria-hidden className="text-accent-strong">&gt; </span>
          {previewInput(input, 220)}
        </p>

        <div className="flex flex-wrap items-center gap-2">
          {running ? (
            <Button variant="outline" size="sm" onClick={run.stop}>
              ■ stop
            </Button>
          ) : (
            <Button variant="accent" size="sm" onClick={start} disabled={!chain}>
              ▶ {run.trace || run.issue ? "run again" : "run it"}
            </Button>
          )}
          <span className="hidden font-mono text-[11px] lowercase text-ink-3 sm:inline">real call · via /api/jev</span>
          <Link
            href={studioHref(id, input)}
            className="ml-auto font-mono text-[11px] lowercase text-ink-2 underline decoration-line-soft underline-offset-4 hover:text-ink hover:decoration-accent"
          >
            open in studio →
          </Link>
        </div>
      </div>

      {(run.trace || run.issue) && (
        <div className="border-hard-t">
          {run.trace && <RunSummary trace={run.trace} now={now} className="border-soft-b" />}
          <button
            type="button"
            aria-expanded={whyOpen}
            onClick={() => setWhyOpen((o) => !o)}
            className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left font-mono text-[11px] lowercase text-ink-2 hover:bg-surface-2 hover:text-ink sm:px-5"
          >
            <span className={cn(run.issue && run.issue.kind !== "halted" && "text-fail")}>
              {run.issue ? run.issue.title : whyOpen ? "hide the story" : "read the story: every decision, and why"}
            </span>
            <span aria-hidden>{whyOpen ? "−" : "+"}</span>
          </button>
          {whyOpen && (
            <WhyPanel
              trace={run.trace}
              issue={run.issue}
              className="max-h-96 overflow-y-auto border-soft-t"
              issueAction={
                run.issue?.action === "add-key" ? (
                  <Button variant="outline" size="sm" onClick={openKeyDialog}>
                    add your key
                  </Button>
                ) : run.issue?.action === "retry" ? (
                  <Button variant="outline" size="sm" onClick={start}>
                    try again
                  </Button>
                ) : undefined
              }
            />
          )}
        </div>
      )}
    </div>
  );
}
