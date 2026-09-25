"use client";

import { memo, type CSSProperties } from "react";
import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import type { Decision, Span, Vertex, VertexOverlay, VertexState } from "jevchain";
import { cn } from "@/lib/cn";
import { answerBrief, fmtMetric, fmtMs, fmtPct } from "@/lib/trace/format";
import { chipRows, type Direction, type VertexHint } from "@/lib/trace/layout";
import { KIND_GLYPH, KindTag, StateMark } from "./kinds";

/** Builder extras for one vertex. */
export interface VertexDecoration {
  /** An empty slot: drawn as "+ something goes here". */
  placeholder?: boolean;
  /** A short tag in the header, e.g. "bound" / "not bound" for code steps. */
  note?: string;
  noteTone?: "pass" | "warn";
  /** Validation found a problem here. */
  issue?: boolean;
}

export type FlowNodeData = {
  vertex: Vertex;
  hint: VertexHint;
  overlay: VertexOverlay;
  /** Compare mode: the B run's overlay. */
  overlayB?: VertexOverlay;
  selected: boolean;
  compact: boolean;
  direction: Direction;
  decoration?: VertexDecoration;
  /** Sweep mode: how many of `total` runs reached this vertex. */
  traffic?: { count: number; total: number };
  onSelect?: (id: string) => void;
};

export type FlowNode = Node<FlowNodeData, "trace">;

const reached = (s: VertexState | undefined) => s !== undefined && s !== "idle" && s !== "skipped";

function nodeTone(state: VertexState, visitedA: boolean, visitedB: boolean, compare: boolean) {
  if (state === "running") return "border-accent node-running";
  if (state === "error") return "border-fail shadow-[3px_3px_0_0_var(--fail)]";
  if (state === "halted") return "border-warn shadow-[3px_3px_0_0_var(--warn)]";
  if (compare) {
    if (visitedA && visitedB) return "border-line shadow-[3px_3px_0_0_var(--accent),6px_6px_0_0_var(--compare)]";
    if (visitedA) return "border-line shadow-[3px_3px_0_0_var(--accent)]";
    if (visitedB) return "border-line shadow-[3px_3px_0_0_var(--compare)]";
    return state === "skipped" ? "border-dashed border-dim opacity-45" : "border-line";
  }
  if (state === "ok") return "border-line shadow-[3px_3px_0_0_var(--accent)]";
  if (state === "skipped") return "border-dashed border-dim opacity-45";
  return "border-line";
}

/** Batch/retry info from the span's calls, for the corner badges. */
function callBadges(span: Span | undefined, tier?: string) {
  if (!span) return { batch: undefined, retries: 0 };
  const calls = tier ? span.calls.filter((c) => c.tier === tier) : span.calls;
  const batch = calls.find((c) => c.batch)?.batch;
  const retries = span.retries.length;
  return { batch, retries };
}

function RouteChips({ labels, decision, rows }: { labels: string[]; decision?: Decision; rows: number }) {
  return (
    <div className="flex flex-wrap content-start items-center gap-1 overflow-hidden" style={{ height: rows * 22 }}>
      {labels.map((l) => {
        const e = decision?.edges.find((x) => x.edge === l);
        const taken = decision?.taken === l;
        return (
          <span
            key={l}
            className={cn(
              "inline-flex h-[18px] shrink-0 items-center gap-1 px-1 font-mono text-[10px] leading-none",
              !decision && "border-soft text-ink-2",
              decision && taken && "border-hard bg-accent text-accent-ink",
              decision && !taken && "border-soft text-ink-3",
            )}
          >
            {taken && <span aria-hidden>✓</span>}
            {l}
            {e?.value !== undefined && e.value !== null && <span className="tabular-nums opacity-80">{fmtPct(e.value)}</span>}
          </span>
        );
      })}
    </div>
  );
}

function PlainChips({ chips, lit, rows }: { chips: string[]; lit?: boolean; rows: number }) {
  return (
    <div className="flex flex-wrap content-start items-center gap-x-1 gap-y-1 overflow-hidden" style={{ height: rows * 22 }}>
      {chips.map((c, i) => (
        <span
          key={`${c}-${i}`}
          className={cn(
            "inline-flex h-[18px] shrink-0 items-center px-1 font-mono text-[10px] leading-none",
            lit ? "border-hard bg-paper text-ink" : "border-soft text-ink-2",
          )}
        >
          {c}
        </span>
      ))}
    </div>
  );
}

/** "p(yes) ≤ 0.50" with a tiny track: threshold tick, and the value once decided. */
function GateBar({ bar, value, passed }: { bar: NonNullable<VertexHint["bar"]>; value?: number; passed?: boolean }) {
  const scale = bar.scale || 1;
  const tick = ((bar.min ?? bar.max ?? 0) / scale) * 100;
  const v = value !== undefined ? Math.max(0, Math.min(1, value / scale)) * 100 : undefined;
  return (
    <div className="flex h-5 items-center gap-2 font-mono text-[10px] leading-none">
      <span className="shrink-0 text-ink-2">
        {bar.measure} <span className="text-ink">{bar.text}</span>
      </span>
      <span className="relative h-1.5 flex-1 border-soft bg-surface-2">
        {v !== undefined && (
          <span
            className={cn("bar-grow absolute inset-y-0 left-0", passed ? "bg-accent" : "bg-ink-3")}
            style={{ width: `${Math.max(2, v)}%` }}
          />
        )}
        <span aria-hidden className="absolute -inset-y-1 w-(--bw) bg-ink" style={{ left: `${tick}%` }} />
      </span>
      {value !== undefined && <span className="shrink-0 tabular-nums text-ink">{value.toFixed(2)}</span>}
    </div>
  );
}

function CompareMarks({ a, b }: { a: boolean; b: boolean }) {
  if (!a && !b) return null;
  return (
    <span className="absolute -top-2.5 right-2 flex gap-0.5 font-mono text-[9px] leading-none">
      {a && <span className="grid h-4 min-w-4 place-items-center border-hard bg-accent px-0.5 text-accent-ink">a</span>}
      {b && <span className="grid h-4 min-w-4 place-items-center border-hard bg-compare px-0.5 text-paper">b</span>}
    </span>
  );
}

function SmallNode({ data }: { data: FlowNodeData }) {
  const { vertex, overlay, overlayB } = data;
  const compare = overlayB !== undefined;
  const a = reached(overlay.state);
  const b = reached(overlayB?.state);
  return (
    <div
      className={cn(
        "relative flex h-full w-full items-center justify-center gap-1.5 border-(length:--bw) bg-surface font-mono text-[11px] lowercase transition-[opacity,box-shadow,border-color] duration-(--dur) ease-snap",
        nodeTone(compare && !a && b ? (overlayB?.state ?? "idle") : overlay.state, a, b, compare),
        vertex.kind === "halt" && overlay.state === "halted" && "bg-warn-wash text-warn",
        data.selected && "outline-2 outline-offset-4 outline-ink",
      )}
    >
      {compare && <CompareMarks a={a} b={b} />}
      <span aria-hidden>{KIND_GLYPH[vertex.kind]}</span>
      <span>{vertex.label}</span>
      {data.traffic && <span className="tabular-nums text-ink-3">{data.traffic.count}/{data.traffic.total}</span>}
    </div>
  );
}

function TraceNodeImpl({ data }: NodeProps<FlowNode>) {
  const { vertex, hint, overlay, overlayB, selected, compact } = data;
  const compare = overlayB !== undefined;
  const visitedA = reached(overlay.state);
  const visitedB = reached(overlayB?.state);
  // In compare mode show the B state when only B reached this node.
  const state: VertexState = compare && !visitedA && visitedB ? overlayB!.state : overlay.state;
  const span = overlay.span ?? overlayB?.span;
  const decision = overlay.span?.decision ?? (compare && !visitedA ? overlayB?.span?.decision : undefined);
  const { batch, retries } = callBadges(overlay.span, vertex.tier);
  const lit = state === "ok" || (compare && (visitedA || visitedB));

  // What the chips say once there's an answer.
  let body: React.ReactNode = null;
  const rows = hint.chips ? chipRows(hint.chips) : 1;
  if (vertex.kind === "route" && hint.chips) body = <RouteChips labels={hint.chips} decision={decision} rows={rows} />;
  else if (vertex.kind === "ask" && hint.chips) {
    const call = span?.calls[0];
    const chips = call ? Object.entries(call.answers).map(([k, ans]) => `${k} ${answerBrief(ans)}`) : hint.chips;
    body = <PlainChips chips={chips} lit={!!call} rows={rows} />;
  } else if (hint.chips) body = <PlainChips chips={hint.chips} rows={rows} />;

  let barValue: number | undefined;
  let barPassed: boolean | undefined;
  if (vertex.kind === "gate" && decision) {
    barValue = decision.value;
    barPassed = decision.taken === "then";
  } else if (vertex.kind === "tier" && decision) {
    const e = decision.edges.find((x) => x.edge === vertex.tier);
    if (e?.value !== null && e?.value !== undefined) {
      barValue = e.value;
      barPassed = e.taken;
    }
  }

  const style: CSSProperties = { width: "100%", height: "100%" };
  const deco = data.decoration;
  const traffic = data.traffic;
  const label = traffic
    ? `${vertex.kind} ${vertex.label}, reached by ${traffic.count} of ${traffic.total} inputs`
    : `${vertex.kind} ${vertex.label}, ${state}${overlay.durationMs !== undefined ? `, ${fmtMs(overlay.durationMs)}` : ""}`;

  return (
    <>
      <Handle type="target" position={data.direction === "TB" ? Position.Top : Position.Left} isConnectable={false} />
      {deco?.placeholder && state === "idle" ? (
        <button
          type="button"
          aria-label={`empty slot ${vertex.label}: pick what goes here`}
          aria-pressed={selected}
          onClick={() => data.onSelect?.(vertex.id)}
          style={style}
          className={cn(
            "group/node grid place-items-center border-(length:--bw) border-dashed border-accent bg-accent-wash/60 text-center transition-[transform,box-shadow,background-color] duration-(--dur) ease-snap hover:-translate-y-px hover:bg-accent-wash hover:shadow-[3px_3px_0_0_var(--accent)]",
            selected && "outline-2 outline-offset-4 outline-ink",
          )}
        >
          <span className="font-mono text-[11.5px] leading-tight text-accent-strong">
            <span aria-hidden className="mr-1 inline-grid size-4 place-items-center border-(length:--bw) border-accent align-[-3px] text-[12px] leading-none">
              +
            </span>
            something goes here
          </span>
        </button>
      ) : vertex.kind === "join" || vertex.kind === "halt" ? (
        <button type="button" aria-label={label} aria-pressed={selected} onClick={() => data.onSelect?.(vertex.id)} style={style} className="block text-left">
          <SmallNode data={data} />
        </button>
      ) : (
        <button
          type="button"
          aria-label={label}
          aria-pressed={selected}
          onClick={() => data.onSelect?.(vertex.id)}
          style={style}
          className={cn(
            "group/node relative block border-(length:--bw) bg-surface text-left transition-[opacity,box-shadow,border-color,transform] duration-(--dur) ease-snap",
            nodeTone(state, visitedA, visitedB, compare),
            deco?.issue && state === "idle" && "border-fail shadow-[3px_3px_0_0_var(--fail)]",
            selected && "outline-2 outline-offset-4 outline-ink",
            !compact && "hover:-translate-y-px",
          )}
        >
          {deco?.issue && state === "idle" && (
            <span aria-label="has issues" className="absolute -top-2.5 -right-2.5 grid size-5 place-items-center border-(length:--bw) border-fail bg-fail font-mono text-[11px] leading-none font-bold text-paper">
              !
            </span>
          )}
          {compare && <CompareMarks a={visitedA} b={visitedB} />}
          <div className="flex h-[26px] items-center gap-1.5 border-soft-b px-2">
            <KindTag
              kind={vertex.kind}
              tone={state === "error" ? "fail" : state === "halted" ? "warn" : lit ? "lit" : "plain"}
            />
            <span className="ml-auto flex items-center gap-1.5">
              {deco?.note && state === "idle" && (
                <span
                  className={cn(
                    "inline-flex h-4 items-center px-1 font-mono text-[9px] leading-none",
                    deco.noteTone === "pass" ? "border-(length:--bw) border-pass text-pass" : "border-(length:--bw) border-dashed border-warn text-warn",
                  )}
                >
                  {deco.note}
                </span>
              )}
              {batch && (
                <span
                  className="inline-flex h-4 items-center border-soft bg-surface-2 px-1 font-mono text-[9px] leading-none text-ink-2"
                  title={`shared one request with ${batch.size - 1} other node${batch.size === 2 ? "" : "s"}`}
                >
                  ⧉ ×{batch.size}
                </span>
              )}
              {retries > 0 && (
                <span className="inline-flex h-4 items-center border-(length:--bw) border-warn px-1 font-mono text-[9px] leading-none text-warn">
                  ↻{retries}
                </span>
              )}
              {traffic ? (
                <span
                  className={cn(
                    "inline-flex h-4 items-center px-1 font-mono text-[10px] leading-none tabular-nums",
                    traffic.count > 0 ? "border-hard bg-accent text-accent-ink" : "border-soft text-ink-3",
                  )}
                  title={`${traffic.count} of ${traffic.total} inputs got here`}
                >
                  {traffic.count}/{traffic.total}
                </span>
              ) : (
                state !== "idle" && <StateMark state={state} />
              )}
              {overlay.durationMs !== undefined && state !== "running" && (
                <span className="font-mono text-[10px] tabular-nums text-ink-3">{fmtMs(overlay.durationMs)}</span>
              )}
            </span>
          </div>
          <div className="px-2 pt-1.5 pb-1">
            <div className="truncate text-[13px] leading-5 font-medium text-ink">{vertex.label}</div>
            {hint.line && (
              <div className="truncate font-mono text-[10.5px] leading-5 text-ink-3" title={hint.line}>
                {vertex.kind === "emit" ? `“${hint.line}”` : hint.line}
              </div>
            )}
            {body && <div className="mt-1">{body}</div>}
            {hint.bar && (
              <div className="mt-1">
                <GateBar bar={hint.bar} value={barValue} passed={barPassed} />
              </div>
            )}
          </div>
          {decision?.fallback && vertex.kind === "route" && (
            <span className="absolute -bottom-2.5 left-2 border-(length:--bw) border-warn bg-warn-wash px-1 font-mono text-[9px] leading-4 text-warn">
              low confidence · {fmtMetric("confidence", decision.confidence)}
            </span>
          )}
        </button>
      )}
      <Handle type="source" position={data.direction === "TB" ? Position.Bottom : Position.Right} isConnectable={false} />
    </>
  );
}

export const TraceNode = memo(TraceNodeImpl);
