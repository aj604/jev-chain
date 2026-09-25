import { graphOf, overlayTrace, type AnyNode, type Decision, type Span, type Trace } from "jevchain";
import { ChainLinks } from "@/components/brand/chain-links";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";
import { cn } from "@/lib/cn";

/**
 * The landing page's hero: a real trace of the landing-page `triage` chain,
 * rendered from what `jev.run` returned (see `./triage.ts`). Nothing here is
 * typed by hand: the question, the distribution, the summaries, the timings and
 * the paths not taken all come from the trace.
 */

function Dist({ edges }: { edges: Decision["edges"] }) {
  return (
    <ul className="space-y-1.5">
      {edges.map((e) => {
        const p = e.value ?? 0;
        return (
          <li key={e.edge} className="grid grid-cols-[4.5rem_1fr_2.5rem] items-center gap-2 font-mono text-[11px]">
            <span className={e.taken ? "text-ink" : "text-ink-3"}>{e.edge}</span>
            <span className="relative h-2 border-soft bg-surface-2">
              <span
                className={cn("absolute inset-y-0 left-0", e.taken ? "bg-accent" : "bg-dim")}
                style={{ width: `${Math.max(2, p * 100)}%` }}
              />
            </span>
            <span className={cn("text-right tabular-nums", e.taken ? "text-ink" : "text-ink-3")}>{p.toFixed(2)}</span>
          </li>
        );
      })}
    </ul>
  );
}

function Step({ n, span, last }: { n: number; span: Span; last?: boolean }) {
  const d = span.decision;
  const calls = span.calls;
  const ms = calls.length ? calls.reduce((s, c) => s + c.latencyMs, 0) : undefined;
  const questions = calls.flatMap((c) => Object.values(c.questions));
  return (
    <li className="relative grid grid-cols-[1.75rem_1fr] gap-3">
      <div className="flex flex-col items-center">
        <span className="grid size-6 place-items-center border-hard bg-accent font-mono text-[10px] text-accent-ink">
          {String(n).padStart(2, "0")}
        </span>
        {!last && <span aria-hidden className="w-(--bw) flex-1 bg-ink" />}
      </div>
      <div className={cn("min-w-0 space-y-2.5", !last && "pb-5")}>
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          <Badge tone="ink">{span.kind}</Badge>
          <span className="font-mono text-xs text-ink">{span.nodeId}</span>
          {d?.kind === "gate" && (
            <Badge tone={d.taken === "then" ? "pass" : "fail"} dot>
              {d.taken === "then" ? "pass" : d.taken}
            </Badge>
          )}
          {ms !== undefined && <span className="ml-auto font-mono text-[11px] tabular-nums text-ink-3">{ms}ms</span>}
        </div>
        {questions.map((q) => (
          <p key={String(q.instructions)} className="font-mono text-[11px] text-ink-3">
            <span className="text-ink-2">&ldquo;{String(q.instructions)}&rdquo;</span> · {q.type}
          </p>
        ))}
        {d?.metric === "probability" && <Dist edges={d.edges.filter((e) => e.edge !== "lowConfidence")} />}
        {d?.summary && <p className="text-[12px] leading-snug text-ink-2">{d.summary}</p>}
        {!d && !calls.length && (
          <p className="font-mono text-[11px] text-ink-3">
            output <span className="text-ink">{JSON.stringify(span.output)}</span>
          </p>
        )}
      </div>
    </li>
  );
}

export function SampleTrace({ trace, chain, className }: { trace: Trace; chain: AnyNode; className?: string }) {
  const graph = graphOf(chain);
  const overlay = overlayTrace(graph, trace);
  // Nodes that never ran, named by their path from the root (the trace's own vocabulary).
  const notTaken = graph.vertices.filter((v) => overlay.vertices[v.id]?.state === "skipped").map((v) => v.spanPath.replace(/^\$\//, ""));
  return (
    <Panel
      className={className}
      title={
        <>
          <span aria-hidden className={cn("size-2", trace.status === "ok" ? "bg-pass" : "bg-fail")} />
          <span>trace · {trace.runId}</span>
        </>
      }
      actions={<span className="text-ink-3">real runtime · scripted jev</span>}
    >
      <div className="border-soft-b px-4 py-3">
        <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">input</div>
        <p className="font-mono text-xs leading-relaxed text-ink-2">&ldquo;{String(trace.input)}&rdquo;</p>
      </div>
      <ol className="px-4 pt-4 pb-2">
        {trace.spans.map((s, i) => (
          <Step key={s.path} n={i + 1} span={s} last={i === trace.spans.length - 1} />
        ))}
      </ol>
      <div className="flex flex-wrap items-center justify-between gap-2 border-soft-t bg-surface-2 px-4 py-2.5 font-mono text-[11px] text-ink-3">
        <span className="flex items-center gap-2">
          <ChainLinks count={trace.spans.length} progress={trace.spans.length} size={10} />
          {Math.round(trace.durationMs ?? 0)}ms · {trace.usage.calls} {trace.usage.calls === 1 ? "call" : "calls"}
        </span>
        {notTaken.length > 0 && (
          <span>
            not taken:{" "}
            {notTaken.map((label, i) => (
              <span key={`${label}-${i}`}>
                {i > 0 && " · "}
                <span className="line-through decoration-dim">{label}</span>
              </span>
            ))}
          </span>
        )}
      </div>
    </Panel>
  );
}
