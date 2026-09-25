"use client";

/**
 * Inspector: everything recorded about one node. Kind, timing, cost, the
 * decision and its reasoning, every Jev call with every question's full
 * distribution, input/output, logs, retries and errors.
 *
 *   <Inspector graph={graph} trace={trace} selected={id} onSelect={setId} />
 *
 * `selected` is a graph vertex id (which equals the span path for real nodes)
 * or a span path with no vertex (e.g. a `chain` span from the timeline).
 */
import type { ReactNode } from "react";
import { spanAt, type Decision, type FlowGraph, type JevCall, type Question, type Span, type Trace, type Vertex } from "jevchain";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { entryText, fmtMetric, fmtMs, fmtNum, fmtThreshold, fmtTokens, fmtUsd, questionLabels } from "@/lib/trace/format";
import { Distribution } from "./distribution";
import { JsonView } from "./json-view";
import { KindTag, StateMark, type AnyState } from "./kinds";

const DECISION_KEY = "decision";

export interface InspectorProps {
  graph: FlowGraph;
  trace?: Trace;
  selected: string;
  onSelect?: (id: string | null) => void;
  className?: string;
}

export function Inspector({ graph, trace, selected, onSelect, className }: InspectorProps) {
  const vertex = graph.vertices.find((v) => v.id === selected);
  const spanPath = vertex?.spanPath ?? selected;
  const span = trace ? spanAt(trace, spanPath) : undefined;
  const kind = vertex?.kind ?? span?.kind ?? "step";
  const title = vertex?.label ?? span?.title ?? span?.nodeId ?? selected;

  const calls =
    !span || vertex?.kind === "halt" || vertex?.kind === "join"
      ? []
      : vertex?.kind === "tier"
        ? span.calls.filter((c) => c.tier === vertex.tier)
        : span.calls;
  const state: AnyState = stateOf(vertex, span, trace);
  const decision = span?.decision && (vertex?.kind === "route" || vertex?.kind === "gate" || vertex?.kind === "cascade" || vertex?.kind === "tier" || !vertex) ? span.decision : undefined;
  const duration = vertex?.kind === "tier" ? (calls[0] ? calls[0].end - calls[0].start : undefined) : span?.end !== undefined ? span.end - span.start : undefined;
  const tokens = calls.reduce((n, c) => n + c.inputTokens, 0);
  const cost = calls.reduce((n, c) => n + c.costUsd, 0);
  const attempts = calls.reduce((n, c) => n + c.attempts, 0);
  const models = [...new Set(calls.map((c) => c.model))];

  return (
    <div className={cn("fade-up min-w-0", className)} key={selected}>
      <header className="space-y-2 border-soft-b px-4 py-3">
        <div className="flex items-center gap-2">
          <KindTag kind={kind} tone={state === "ok" ? "lit" : state === "error" ? "fail" : state === "halted" ? "warn" : "plain"} />
          <StateMark state={state} showLabel />
          {onSelect && (
            <button
              type="button"
              onClick={() => onSelect(null)}
              className="ml-auto font-mono text-[11px] lowercase text-ink-3 hover:text-ink"
              aria-label="close inspector, back to the story"
            >
              ← why
            </button>
          )}
        </div>
        <h2 className="text-base leading-snug font-medium text-ink">{title}</h2>
        <p className="truncate font-mono text-[10.5px] text-ink-3" title={spanPath}>
          id {vertex?.nodeId ?? span?.nodeId} · {spanPath}
        </p>
      </header>

      {!trace || !span ? (
        <NotRun vertex={vertex} trace={trace} graph={graph} onSelect={onSelect} />
      ) : (
        <>
          <dl className="grid grid-cols-3 border-soft-b">
            <Stat label="latency" value={fmtMs(duration)} />
            <Stat label="calls" value={calls.length ? `${calls.length}${calls.some((c) => c.batch) ? " ⧉" : ""}` : "0"} />
            <Stat label="tokens in" value={calls.length ? fmtTokens(tokens) : "—"} />
            <Stat label="cost" value={calls.length ? fmtUsd(cost) : "—"} />
            <Stat label="attempts" value={calls.length ? `${attempts}${span.retries.length ? ` · ↻${span.retries.length}` : ""}` : span.retries.length ? `↻${span.retries.length}` : "—"} />
            <Stat label="model" value={models.join(", ") || "—"} mono />
          </dl>

          {vertex?.kind === "halt" && trace.halted && (
            <Section title="halted">
              <p className="text-[13px] leading-relaxed text-ink-2">{trace.halted.summary}</p>
            </Section>
          )}

          {decision && <DecisionSection decision={decision} tier={vertex?.kind === "tier" ? vertex.tier : undefined} />}

          {span.error && (
            <Section title="error">
              <div className="border-(length:--bw) border-fail bg-fail-wash px-3 py-2 font-mono text-[11px] leading-relaxed text-fail">
                <div>
                  {span.error.name} · {span.error.code}
                  {span.error.status ? ` · ${span.error.status}` : ""}
                </div>
                <div className="mt-1 text-ink">{span.error.message}</div>
              </div>
            </Section>
          )}

          {calls.map((call, i) => (
            <CallSection key={call.id} call={call} index={i} total={calls.length} decision={span.decision} />
          ))}

          {span.retries.length > 0 && (
            <Section title={`retries · ${span.retries.length}`}>
              <ul className="space-y-1.5 font-mono text-[11px]">
                {span.retries.map((r, i) => (
                  <li key={i} className="flex gap-2 text-ink-2">
                    <span className="text-warn">↻ {r.attempt}</span>
                    <span className="text-ink-3">+{fmtMs(r.at)}</span>
                    <span className="min-w-0 flex-1 truncate" title={r.error.message}>
                      {r.source} · {r.error.code} · waited {fmtMs(r.delayMs)}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {span.logs.length > 0 && (
            <Section title={`logs · ${span.logs.length}`}>
              <ul className="space-y-1 font-mono text-[11px]">
                {span.logs.map((l, i) => (
                  <li key={i} className="flex gap-2">
                    <span className="shrink-0 tabular-nums text-ink-3">+{fmtMs(l.at)}</span>
                    <span className="text-ink-2">{l.message}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {vertex?.kind !== "tier" && vertex?.kind !== "halt" && (
            <>
              <Section title="input">
                <JsonView value={span.input ?? null} />
              </Section>
              {span.output !== undefined && (
                <Section title={vertex?.kind === "join" ? "joined output" : "output"}>
                  <JsonView value={span.output} />
                </Section>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}

function stateOf(vertex: Vertex | undefined, span: Span | undefined, trace: Trace | undefined): AnyState {
  if (!trace) return "idle";
  if (vertex?.kind === "halt") return span?.decision?.taken === "halt" ? "halted" : trace.status === "running" ? "idle" : "skipped";
  if (vertex?.kind === "tier") {
    if (span?.calls.some((c) => c.tier === vertex.tier)) return "ok";
    return span?.status === "running" ? "running" : trace.status === "running" ? "idle" : "skipped";
  }
  if (!span) return trace.status === "running" ? "idle" : "skipped";
  return span.status;
}

function Stat({ label, value, mono = true }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0 border-soft-r px-3 py-2 [&:nth-child(3n)]:border-r-0 [&:nth-child(-n+3)]:border-soft-b">
      <dt className="font-mono text-[10px] lowercase text-ink-3">{label}</dt>
      <dd className={cn("truncate text-[13px] text-ink tabular-nums", mono && "font-mono text-[12px]")} title={typeof value === "string" ? value : undefined}>
        {value}
      </dd>
    </div>
  );
}

export function Section({ title, children, actions }: { title: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <section className="border-soft-b px-4 py-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="font-mono text-[10px] tracking-[0.12em] text-ink-3 uppercase">{title}</h3>
        {actions}
      </div>
      {children}
    </section>
  );
}

function DecisionSection({ decision, tier }: { decision: Decision; tier?: string }) {
  const threshold = fmtThreshold(decision.threshold);
  return (
    <Section
      title="decision"
      actions={
        <Badge tone={decision.fallback ? "warn" : "accent"}>
          {decision.kind} → {decision.taken === "lowConfidence" ? "unsure" : decision.taken}
        </Badge>
      }
    >
      <p className="text-[13px] leading-relaxed text-ink">{decision.summary}</p>
      <ul className="mt-3 space-y-1">
        {decision.edges.map((e) => {
          const v = fmtMetric(decision.kind === "cascade" ? "confidence" : decision.metric, e.value);
          const mine = tier !== undefined && e.edge === tier;
          return (
            <li
              key={e.edge}
              className={cn(
                "flex items-center gap-2 px-2 py-1 font-mono text-[11px]",
                e.taken ? "border-hard bg-accent-wash text-ink" : "border-soft text-ink-3",
                mine && !e.taken && "border-hard",
              )}
            >
              <span aria-hidden className="w-3">{e.taken ? "✓" : e.value === null ? "·" : "✕"}</span>
              <span className="min-w-0 flex-1 truncate">{e.edge === "lowConfidence" ? "unsure (low confidence)" : e.edge}</span>
              <span className="tabular-nums">{v ?? (e.value === null ? "not tried" : "—")}</span>
              <span className="sr-only">{e.taken ? "taken" : "not taken"}</span>
            </li>
          );
        })}
      </ul>
      <p className="mt-2 font-mono text-[10px] text-ink-3">
        metric {decision.metric}
        {threshold && ` · bar ${threshold}`}
        {decision.threshold?.label && ` on "${decision.threshold.label}"`}
        {decision.confidence !== undefined && ` · confidence ${fmtNum(decision.confidence)}`}
      </p>
    </Section>
  );
}

function CallSection({ call, index, total, decision }: { call: JevCall; index: number; total: number; decision?: Decision }) {
  const keys = Object.keys(call.questions);
  return (
    <Section
      title={
        <>
          jev call{total > 1 ? ` ${index + 1}/${total}` : ""}
          {call.tier ? ` · tier ${call.tier}` : ""}
        </>
      }
      actions={
        <span className="flex items-center gap-1.5 font-mono text-[10px] text-ink-3">
          <span className="tabular-nums">{fmtMs(call.latencyMs)}</span>
          {call.batch && <Badge tone="neutral">⧉ batched ×{call.batch.size}</Badge>}
        </span>
      }
    >
      <div className="space-y-4">
        {keys.map((key) => {
          const q = call.questions[key]!;
          const a = call.answers[key];
          const isDecision = key === DECISION_KEY;
          return (
            <div key={key}>
              <div className="mb-1 flex items-center gap-1.5">
                <span className="font-mono text-[11px] text-ink">{key}</span>
                <span className="font-mono text-[10px] text-ink-3">{q.type}</span>
                {isDecision && <Badge tone="ink">decides</Badge>}
                {!isDecision && keys.includes(DECISION_KEY) && <Badge tone="dim">also asked</Badge>}
              </div>
              {q.instructions !== undefined && q.instructions !== null && (
                <p className="mb-2 text-[12.5px] leading-snug text-ink-2">{entryText(q.instructions)}</p>
              )}
              {a ? (
                <Distribution
                  answer={a}
                  question={q}
                  marks={
                    isDecision && decision
                      ? {
                          ...(decision.threshold ? { threshold: decision.threshold } : {}),
                          ...(decision.kind === "route" ? { taken: decision.taken } : {}),
                        }
                      : undefined
                  }
                />
              ) : (
                <p className="font-mono text-[11px] text-ink-3">no answer recorded</p>
              )}
            </div>
          );
        })}
      </div>
      <details className="group/state mt-3">
        <summary className="cursor-pointer list-none font-mono text-[10px] lowercase text-ink-3 hover:text-ink">
          <span className="inline-block transition-transform duration-(--dur-fast) group-open/state:rotate-90">▸</span> state sent to jev
          <span className="ml-2 tabular-nums">
            {fmtTokens(call.inputTokens)} tok · {fmtUsd(call.costUsd)}
            {call.attempts > 1 ? ` · ${call.attempts} attempts` : ""}
            {call.requestId ? ` · ${call.requestId}` : ""}
          </span>
        </summary>
        <JsonView value={call.state} className="mt-2" />
      </details>
    </Section>
  );
}

function NotRun({ vertex, trace, graph, onSelect }: { vertex?: Vertex; trace?: Trace; graph: FlowGraph; onSelect?: (id: string | null) => void }) {
  // Which decision routed around this node?
  const incoming = vertex ? graph.edges.find((e) => e.target === vertex.id && e.decidedBy) : undefined;
  const decider = incoming?.decidedBy && trace ? spanAt(trace, incoming.decidedBy.spanPath) : undefined;
  return (
    <>
      <Section title={trace ? "not reached" : "not run yet"}>
        <p className="text-[13px] leading-relaxed text-ink-2">
          {!trace
            ? "run the chain and this node will fill in with everything jev said here."
            : trace.status === "running"
              ? "hasn't happened yet. the chain is still being pulled."
              : decider?.decision
                ? `the road not taken. ${decider.title ?? decider.nodeId} went "${decider.decision.taken}" instead of "${incoming!.label}".`
                : "this node didn't run on this trace."}
        </p>
        {decider && onSelect && (
          <button
            type="button"
            onClick={() => onSelect(decider.path)}
            className="mt-2 font-mono text-[11px] lowercase text-accent-strong underline decoration-dotted underline-offset-4 hover:text-ink"
          >
            inspect {decider.nodeId} →
          </button>
        )}
      </Section>
      {vertex?.question && <QuestionDef question={vertex.question} />}
    </>
  );
}

function QuestionDef({ question }: { question: Question }) {
  const labels = questionLabels(question);
  return (
    <Section title={`asks · ${question.type}`}>
      {question.instructions !== undefined && <p className="text-[13px] leading-snug text-ink">{entryText(question.instructions ?? null)}</p>}
      <ul className="mt-2 space-y-1">
        {question.type === "choice" &&
          labels.map((l) => (
            <li key={l} className="text-[12px] leading-snug text-ink-2">
              <span className="font-mono text-[11px] text-ink">{l}</span>
              {question.criteria[l] ? <span className="text-ink-3"> · {entryText(question.criteria[l])}</span> : null}
            </li>
          ))}
        {question.type === "score" &&
          question.criteria.map((c, i) => (
            <li key={i} className="text-[12px] leading-snug text-ink-2">
              <span className="font-mono text-[11px] text-ink">{i}</span> <span className="text-ink-3">· {entryText(c)}</span>
            </li>
          ))}
        {question.type === "noul" && question.criteria && (
          <>
            {question.criteria.true !== undefined && (
              <li className="text-[12px] text-ink-2">
                <span className="font-mono text-[11px] text-ink">yes</span> <span className="text-ink-3">· {entryText(question.criteria.true)}</span>
              </li>
            )}
            {question.criteria.false !== undefined && (
              <li className="text-[12px] text-ink-2">
                <span className="font-mono text-[11px] text-ink">no</span> <span className="text-ink-3">· {entryText(question.criteria.false)}</span>
              </li>
            )}
          </>
        )}
      </ul>
    </Section>
  );
}
