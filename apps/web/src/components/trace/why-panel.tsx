"use client";

/**
 * "Why did it go here?": the run as a numbered story, one line per decision
 * (straight from each decision's templated summary), then how it ended.
 * Each step is clickable, so the story doubles as navigation.
 */
import type { ReactNode } from "react";
import { decisions, type Span, type Trace } from "jevchain";
import { ChainLinks } from "@/components/brand/chain-links";
import { Badge } from "@/components/ui/badge";
import { KbdCombo } from "@/components/ui/kbd";
import { cn } from "@/lib/cn";
import { answerBrief, fmtMetric, fmtMs } from "@/lib/trace/format";
import { isRehearsal } from "@/lib/trace/rehearsal";
import { forkOf } from "@/lib/trace/what-if";
import type { RunIssue } from "@/lib/trace/run-error";
import { JsonView } from "./json-view";
import { KindTag } from "./kinds";

export interface WhyPanelProps {
  trace?: Trace;
  issue?: RunIssue | null;
  onSelect?: (id: string) => void;
  /** Rendered under the story when there's an issue (e.g. an "add key" button). */
  issueAction?: ReactNode;
  className?: string;
}

export function WhyPanel({ trace, issue, onSelect, issueAction, className }: WhyPanelProps) {
  if (!trace) {
    return (
      <div className={cn("flex flex-col items-start gap-4 px-4 py-6", className)}>
        <ChainLinks count={7} progress={0} size={16} className="text-ink-3" />
        <div>
          <h2 className="font-display text-2xl leading-tight italic">no links in this chain yet.</h2>
          <p className="mt-2 text-[13px] leading-relaxed text-ink-2">
            run it and this panel tells the story: every decision jev made, the number that decided it, and the roads not taken.
          </p>
        </div>
        <p className="flex items-center gap-2 font-mono text-[11px] lowercase text-ink-3">
          <KbdCombo combo="mod+enter" /> pull the chain
        </p>
        {issue && <IssueBox issue={issue}>{issueAction}</IssueBox>}
      </div>
    );
  }

  // Decisions tell the story; plain asks (no branch) are chapters too.
  const story = trace.spans.filter((s) => s.decision || (s.kind === "ask" && s.calls.length > 0));
  const forks = decisions(trace).length;
  const running = trace.status === "running";
  const lastSpan = trace.spans.at(-1);
  const fork = forkOf(trace);

  return (
    <div className={cn("px-4 py-4", className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-mono text-[10px] tracking-[0.12em] text-ink-3 uppercase">why did it go here?</h2>
        {running && <ChainLinks variant="loading" count={5} size={10} label="running" />}
      </div>

      {isRehearsal(trace) && (
        <p className="mb-3 border-(length:--bw) border-dashed border-warn px-2.5 py-2 text-[12.5px] leading-relaxed text-ink-2">
          <span className="font-mono text-[11px] lowercase text-warn">rehearsal.</span> jev wasn&rsquo;t asked. every number below came from a hash of
          the input, so the roads are real but the judgement isn&rsquo;t. same input, same path.
        </p>
      )}

      {fork && (
        <p className="mb-3 border-(length:--bw) border-dashed border-compare px-2.5 py-2 text-[12.5px] leading-relaxed text-ink-2">
          <span className="font-mono text-[11px] lowercase text-compare">what if.</span> {fork.title ?? fork.nodeId} was forced to go &ldquo;
          {edgeName(fork.edge)}&rdquo;. every answer before it is replayed from the run it forked; the numbers at that fork were bent to go this way; everything after
          it was asked fresh.
        </p>
      )}

      {forks === 0 && trace.status === "ok" && (
        <p className="mb-3 text-[13px] leading-relaxed text-ink-2">
          no forks in this road: this chain doesn&rsquo;t branch, it asks and then does math. click any node to see every probability.
        </p>
      )}

      <ol className="space-y-0">
        {story.map((span, i) => {
          const { path, nodeId, decision } = span;
          if (!decision) return <AskStep key={path} span={span} n={i + 1} onSelect={onSelect} />;
          const taken = decision.edges.find((e) => e.edge === decision.taken);
          const value = fmtMetric(decision.kind === "cascade" ? "confidence" : decision.metric, taken?.value ?? decision.value);
          return (
            <li key={path} className="fade-up relative grid grid-cols-[1.5rem_1fr] gap-3">
              <div className="flex flex-col items-center">
                <span className="grid size-6 place-items-center border-hard bg-accent font-mono text-[10px] text-accent-ink">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <span aria-hidden className="w-(--bw) flex-1 bg-ink" />
              </div>
              <button
                type="button"
                onClick={() => onSelect?.(path)}
                className="group/step -mx-1.5 mb-3 min-w-0 px-1.5 py-0.5 text-left transition-colors duration-(--dur-fast) hover:bg-surface-2"
              >
                <span className="flex flex-wrap items-center gap-1.5">
                  <KindTag kind={decision.kind} />
                  <span className="truncate font-mono text-xs text-ink">{span.title ?? nodeId}</span>
                  {fork?.path === path && <Badge tone="warn">forced</Badge>}
                  <Badge tone={decision.fallback ? "warn" : "accent"} className="ml-auto">
                    → {decision.taken === "lowConfidence" ? "unsure" : decision.taken}
                    {value && decision.taken !== "fallback" ? ` · ${value}` : ""}
                  </Badge>
                </span>
                <span className="mt-1.5 block text-[13px] leading-relaxed text-ink-2 group-hover/step:text-ink">{decision.summary}</span>
              </button>
            </li>
          );
        })}
        {running && (
          <li className="grid grid-cols-[1.5rem_1fr] gap-3">
            <span className="grid size-6 place-items-center border-(length:--bw) border-dashed border-ink-3" aria-hidden />
            <p className="pt-1 font-mono text-[11px] lowercase text-ink-3">
              {lastSpan ? `pulling ${lastSpan.title ?? lastSpan.nodeId}…` : "starting…"}
            </p>
          </li>
        )}
        {!running && (
          <li className="fade-up grid grid-cols-[1.5rem_1fr] gap-3">
            <span
              className={cn(
                "grid size-6 place-items-center border-hard font-mono text-[11px]",
                trace.status === "ok" ? "bg-ink text-paper" : trace.status === "halted" ? "bg-warn-wash text-warn" : "bg-fail-wash text-fail",
              )}
              aria-hidden
            >
              {trace.status === "ok" ? "✓" : trace.status === "halted" ? "■" : "✕"}
            </span>
            <div className="min-w-0 pt-0.5">
              <p className="font-mono text-xs text-ink">
                {trace.status === "ok" ? "and so it was decided" : trace.status === "halted" ? "halted on purpose" : trace.status === "aborted" ? "stopped" : "it broke"}
                <span className="text-ink-3"> · {fmtMs(trace.durationMs)}</span>
              </p>
              {trace.status === "ok" && trace.output !== undefined && <JsonView value={trace.output} className="mt-2" maxLines={10} />}
              {issue && (
                <IssueBox issue={issue} className="mt-2" onSelect={onSelect} trace={trace}>
                  {issueAction}
                </IssueBox>
              )}
            </div>
          </li>
        )}
      </ol>
    </div>
  );
}

function AskStep({ span, n, onSelect }: { span: Span; n: number; onSelect?: (id: string) => void }) {
  const answers = span.calls.flatMap((c) => Object.entries(c.answers));
  const batched = span.calls.some((c) => c.batch);
  return (
    <li className="fade-up relative grid grid-cols-[1.5rem_1fr] gap-3">
      <div className="flex flex-col items-center">
        <span className="grid size-6 place-items-center border-hard bg-paper font-mono text-[10px] text-ink">{String(n).padStart(2, "0")}</span>
        <span aria-hidden className="w-(--bw) flex-1 bg-ink" />
      </div>
      <button
        type="button"
        onClick={() => onSelect?.(span.path)}
        className="group/step -mx-1.5 mb-3 min-w-0 px-1.5 py-0.5 text-left transition-colors duration-(--dur-fast) hover:bg-surface-2"
      >
        <span className="flex flex-wrap items-center gap-1.5">
          <KindTag kind="ask" />
          <span className="truncate font-mono text-xs text-ink">{span.title ?? span.nodeId}</span>
          {batched && <Badge className="ml-auto">⧉ shared a request</Badge>}
        </span>
        <span className="mt-1.5 block text-[13px] leading-relaxed text-ink-2 group-hover/step:text-ink">
          Asked {answers.length === 1 ? "one question" : `${answers.length} questions in one call`}:
        </span>
        <span className="mt-1 flex flex-wrap gap-1">
          {answers.map(([k, a]) => (
            <span key={k} className="inline-flex h-[18px] items-center border-soft px-1 font-mono text-[10px] text-ink">
              {k} {answerBrief(a)}
            </span>
          ))}
        </span>
      </button>
    </li>
  );
}

export function IssueBox({
  issue,
  children,
  className,
  onSelect,
  trace,
}: {
  issue: RunIssue;
  children?: ReactNode;
  className?: string;
  onSelect?: (id: string) => void;
  trace?: Trace;
}) {
  const tone = issue.kind === "halted" || issue.kind === "aborted" || issue.kind === "rate-limited" ? "warn" : "fail";
  const nodePath = issue.nodeId && trace ? (trace.halted?.nodeId === issue.nodeId ? trace.halted.path : trace.spans.find((s) => s.nodeId === issue.nodeId && s.status !== "ok")?.path) : undefined;
  return (
    <div
      role={tone === "fail" ? "alert" : "status"}
      className={cn(
        "border-(length:--bw) px-3 py-2.5",
        tone === "warn" ? "border-warn bg-warn-wash" : "border-fail bg-fail-wash",
        className,
      )}
    >
      <p className={cn("font-mono text-xs lowercase", tone === "warn" ? "text-warn" : "text-fail")}>{issue.title}</p>
      <p className="mt-1 text-[12.5px] leading-relaxed whitespace-pre-line text-ink">{issue.detail}</p>
      {(children || (nodePath && onSelect)) && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {children}
          {nodePath && onSelect && (
            <button type="button" onClick={() => onSelect(nodePath)} className="font-mono text-[11px] lowercase text-ink-2 underline decoration-dotted underline-offset-4 hover:text-ink">
              inspect {issue.nodeId} →
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const edgeName = (edge: string) => (edge === "lowConfidence" ? "unsure" : edge);
