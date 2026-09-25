"use client";

/**
 * "Where does everything go?": a sweep read three ways. How each decision
 * split the inputs that reached it, the roads no input took, and every input
 * with the road it went down (click one to open it as a normal run).
 *
 * Selecting a node on the graph filters the inputs to the ones that got there.
 */
import type { ReactNode } from "react";
import type { FlowGraph } from "jevchain";
import { ChainLinks } from "@/components/brand/chain-links";
import { Badge } from "@/components/ui/badge";
import { KbdCombo } from "@/components/ui/kbd";
import { KindTag } from "@/components/trace/kinds";
import { IssueBox } from "@/components/trace/why-panel";
import { cn } from "@/lib/cn";
import { fmtUsd, previewJson } from "@/lib/trace/format";
import type { RunIssue } from "@/lib/trace/run-error";
import { finishedTraces, routeOf, tallyDecisions, trafficOf, unfinished, unreachedRoads, visits, type SweepInput, type SweepRow } from "@/lib/trace/sweep";

export interface SweepPanelProps {
  graph: FlowGraph;
  rows: SweepRow[];
  running: boolean;
  rehearsed: boolean;
  stoppedBy?: RunIssue;
  /** What the next sweep would run (shown before the first one). */
  queued: SweepInput[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** Open one input's run as run a. */
  onOpen: (row: SweepRow) => void;
  /** Rendered under `stoppedBy` (e.g. an "add key" button). */
  issueAction?: ReactNode;
}

const STATUS_TONE = { ok: "pass", halted: "warn", error: "fail", aborted: "warn", running: "accent" } as const;

export function SweepPanel({ graph, rows, running, rehearsed, stoppedBy, queued, selected, onSelect, onOpen, issueAction }: SweepPanelProps) {
  const traces = finishedTraces(rows);
  const done = traces.length;

  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-start gap-4 px-4 py-6">
        <ChainLinks count={7} progress={0} size={16} className="text-ink-3" />
        <div>
          <h2 className="font-display text-2xl leading-tight italic">where does everything go?</h2>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
            one run shows why one input went where it did. a sweep runs {queued.length === 1 ? "an input" : `${queued.length} inputs`} through the chain, one after another, and
            shows how every decision split them, and which roads none of them ever reach.
          </p>
        </div>
        <ul className="w-full space-y-1 border-soft px-2.5 py-2">
          {queued.map((q, i) => (
            <li key={i} className="flex gap-2 font-mono text-[11px]">
              <span className="w-5 shrink-0 text-right tabular-nums text-ink-3">{i + 1}</span>
              <span className="min-w-0 truncate text-ink-2">{q.label}</span>
            </li>
          ))}
        </ul>
        <p className="flex items-center gap-2 font-mono text-[11px] lowercase text-ink-3">
          <KbdCombo combo="mod+enter" /> sweep them
        </p>
      </div>
    );
  }

  const traffic = trafficOf(graph, traces);
  const tallies = tallyDecisions(graph, traces);
  // "Nothing took this road" is only a claim once every input has walked its whole way.
  const complete = !running && unfinished(rows) === 0;
  const dead = complete ? unreachedRoads(graph, traffic) : [];
  const branches = graph.vertices.some((v) => v.kind === "route" || v.kind === "gate" || v.kind === "cascade");
  const vertex = selected ? graph.vertices.find((v) => v.id === selected) : undefined;
  const through = vertex ? rows.filter((r) => r.trace && visits(graph, r.trace, vertex.id)) : rows;

  return (
    <div className="px-4 py-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-mono text-[10px] tracking-[0.12em] text-ink-3 uppercase">where does everything go?</h2>
        {running && (
          <span className="flex items-center gap-2 font-mono text-[10px] text-ink-3 tabular-nums">
            {done}/{rows.length}
            <ChainLinks variant="loading" count={5} size={10} label="sweeping" />
          </span>
        )}
      </div>

      {rehearsed && (
        <p className="mb-3 border-(length:--bw) border-dashed border-warn px-2.5 py-2 text-[12.5px] leading-relaxed text-ink-2">
          <span className="font-mono text-[11px] lowercase text-warn">rehearsal.</span> jev wasn&rsquo;t asked. each input&rsquo;s numbers came from a hash of it, so this shows
          which roads are walkable, not how jev would really split these inputs.
        </p>
      )}

      {stoppedBy && (
        <IssueBox issue={{ ...stoppedBy, detail: `${stoppedBy.detail}\nthe sweep stopped after ${done} of ${rows.length}: every other input would hit this too.` }} className="mb-3">
          {issueAction}
        </IssueBox>
      )}

      {!branches && done > 0 && !running && (
        <p className="mb-4 text-[13px] leading-relaxed text-ink-2">
          no forks in this road: this chain doesn&rsquo;t branch, so every input walks the same way. what differs is what each one came out as, below.
        </p>
      )}

      {tallies.length > 0 && (
        <section className="mb-4">
          <h3 className="mb-2 font-mono text-[10px] tracking-[0.12em] text-ink-3 uppercase">how each decision split them</h3>
          <ul className="space-y-3">
            {tallies.map((t) => (
              <li key={t.path}>
                <button type="button" onClick={() => onSelect(t.path)} className="flex w-full items-center gap-1.5 text-left hover:text-ink">
                  <KindTag kind={t.kind} />
                  <span className="min-w-0 truncate font-mono text-xs text-ink">{t.title}</span>
                  <span className="ml-auto shrink-0 font-mono text-[10px] text-ink-3 tabular-nums">
                    reached by {t.reached}/{done}
                  </span>
                </button>
                <ul className="mt-1.5 space-y-1">
                  {t.roads.map((r) => (
                    <li key={r.edge} className="grid grid-cols-[minmax(4.5rem,38%)_1fr_2.5rem] items-center gap-2 font-mono text-[11px]">
                      <span className={cn("truncate", r.count ? "text-ink" : "text-ink-3")}>{r.label}</span>
                      <span className="relative h-2 border-soft bg-surface-2">
                        <span className="bar-grow absolute inset-y-0 left-0 bg-accent" style={{ width: `${(r.count / Math.max(1, t.reached)) * 100}%` }} />
                      </span>
                      <span className={cn("text-right tabular-nums", r.count ? "text-ink" : "text-ink-3")}>{r.count || "none"}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}

      {dead.length > 0 && (
        <section className="mb-4">
          <h3 className="mb-2 font-mono text-[10px] tracking-[0.12em] text-ink-3 uppercase">roads nothing took · {dead.length}</h3>
          <ul className="space-y-1">
            {dead.map((d) => (
              <li key={d.vertex.id}>
                <button
                  type="button"
                  onClick={() => onSelect(d.vertex.id)}
                  className="flex w-full items-baseline gap-1.5 border-(length:--bw) border-dashed border-dim px-2 py-1 text-left text-[12px] text-ink-2 hover:border-ink-3 hover:text-ink"
                >
                  <span className="shrink-0 font-mono text-[11px] text-ink">{d.vertex.label}</span>
                  {d.via && (
                    <span className="min-w-0 truncate text-ink-3">
                      · {d.via.title} never went &ldquo;{d.via.edge === "lowConfidence" ? "unsure" : d.via.edge}&rdquo;
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {!running && !complete && done > 0 && (
        <p className="mb-4 font-mono text-[10.5px] leading-relaxed text-ink-3">
          {unfinished(rows)} of {rows.length} inputs didn&rsquo;t make it to the end, so there&rsquo;s no telling which roads nothing takes.
        </p>
      )}

      <section>
        <div className="mb-2 flex items-center gap-2">
          <h3 className="font-mono text-[10px] tracking-[0.12em] text-ink-3 uppercase">
            {vertex ? `through ${vertex.label} · ${through.length} of ${rows.length}` : `inputs · ${rows.length}`}
          </h3>
          {vertex && (
            <button type="button" onClick={() => onSelect(null)} className="ml-auto font-mono text-[10px] lowercase text-ink-3 underline decoration-dotted underline-offset-4 hover:text-ink">
              show all
            </button>
          )}
        </div>
        {through.length === 0 && <p className="text-[12.5px] leading-relaxed text-ink-3">no input got here.</p>}
        <ul className="space-y-1.5">
          {through.map((r) => {
            const i = rows.indexOf(r);
            const status = r.trace?.status;
            const pending = !r.trace && !r.issue;
            return (
              <li key={i}>
                <button
                  type="button"
                  disabled={!r.trace || status === "running"}
                  onClick={() => onOpen(r)}
                  className="block w-full border-soft px-2 py-1.5 text-left transition-colors duration-(--dur-fast) enabled:hover:bg-surface-2 disabled:opacity-60"
                  aria-label={`open ${r.label} as a run`}
                >
                  <span className="flex items-center gap-1.5">
                    <span className="w-4 shrink-0 text-right font-mono text-[10px] text-ink-3 tabular-nums">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink">{r.label}</span>
                    {status ? (
                      <Badge tone={STATUS_TONE[status]}>{status}</Badge>
                    ) : r.issue ? (
                      <Badge tone="fail">{r.issue.kind}</Badge>
                    ) : (
                      <span className="font-mono text-[10px] text-ink-3">{running && pending ? "waiting" : "not run"}</span>
                    )}
                  </span>
                  {r.trace && status !== "running" && (
                    <span className="mt-1 flex flex-wrap items-center gap-1 pl-5.5 font-mono text-[10px]">
                      {routeOf(r.trace).map((step) => (
                        <span key={step.path} className="inline-flex h-[18px] items-center border-soft px-1 text-ink-2">
                          {step.title} → <span className="ml-1 text-ink">{step.edge}</span>
                        </span>
                      ))}
                      {r.trace.output !== undefined && <span className="min-w-0 truncate text-ink-3">= {previewJson(r.trace.output, 48)}</span>}
                      {r.issue && r.issue.kind !== "halted" && <span className="min-w-0 truncate text-fail">{r.issue.title}</span>}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        {!running && done > 0 && <p className="mt-2 font-mono text-[10px] lowercase text-ink-3">click an input to open its run and ask why.</p>}
      </section>
    </div>
  );
}

/** The sweep in one strip, in place of the run summary: how many ran, how they ended, what it cost. */
export function SweepSummary({ rows, running, rehearsed }: { rows: SweepRow[]; running: boolean; rehearsed: boolean }) {
  const traces = finishedTraces(rows);
  const count = (status: string) => traces.filter((t) => t.status === status).length;
  const requests = traces.reduce((n, t) => n + t.usage.requests, 0);
  const cost = traces.reduce((n, t) => n + t.usage.costUsd, 0);
  return (
    <div className="flex h-9 min-w-0 items-center gap-x-4 overflow-x-auto px-3 font-mono text-[11px] whitespace-nowrap text-ink-3" aria-live="polite">
      <Badge tone="accent" dot={!running}>
        {running ? <ChainLinks variant="loading" count={3} size={8} label="sweeping" cycleMs={900} /> : null}
        sweep
      </Badge>
      {rehearsed && <Badge tone="warn">rehearsal · made-up answers</Badge>}
      <span className="flex items-baseline gap-1.5">
        inputs <span className="text-ink tabular-nums">{rows.length ? `${traces.length}/${rows.length}` : "—"}</span>
      </span>
      {(["ok", "halted", "error"] as const).map((s) =>
        count(s) > 0 ? (
          <span key={s} className="flex items-baseline gap-1.5">
            {s} <span className="text-ink tabular-nums">{count(s)}</span>
          </span>
        ) : null,
      )}
      <span className="flex items-baseline gap-1.5">
        requests <span className="text-ink tabular-nums">{requests}</span>
      </span>
      <span className="flex items-baseline gap-1.5">
        cost <span className="text-ink tabular-nums">{fmtUsd(cost)}</span>
      </span>
    </div>
  );
}
