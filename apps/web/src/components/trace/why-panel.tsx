"use client";

/**
 * "Why did it go here?": the run as a numbered story, one line per decision
 * (straight from each decision's templated summary), then how it ended.
 * Each step is clickable, so the story doubles as navigation.
 *
 * Pass `reask` and the story can be asked again: the same input, sent to Jev
 * a few more times, and each decision says whether every ask took the same
 * road (see `lib/trace/reask`). An ask that went elsewhere opens as run b.
 */
import type { ReactNode } from "react";
import { decisions, type Span, type Trace } from "jevchain";
import { ChainLinks } from "@/components/brand/chain-links";
import { Badge } from "@/components/ui/badge";
import { KbdCombo } from "@/components/ui/kbd";
import { cn } from "@/lib/cn";
import { answerBrief, fmtMetric, fmtMs } from "@/lib/trace/format";
import { steadyHeadline, steadyText, type Steadiness } from "@/lib/trace/reask";
import { isRehearsal } from "@/lib/trace/rehearsal";
import { edgeName, forksOf } from "@/lib/trace/what-if";
import type { RunIssue } from "@/lib/trace/run-error";
import { ForkList } from "./fork-list";
import { JsonView } from "./json-view";
import { KindTag } from "./kinds";

/** "Ask again": re-send the run's input to Jev and see which decisions hold. */
export interface ReaskControl {
  /** Why this run can't be asked again (a rehearsal, a what-if…), or null. */
  blocker: string | null;
  running: boolean;
  /** Re-asks finished so far (answered or failed), of `total`. */
  done: number;
  /** Of those, how many Jev answered (made at least one decision): the only ones that count as asks. */
  answered: number;
  total: number;
  /** Every decision the run made, across the asks so far (once any finished). */
  steadiness?: Steadiness[];
  /** What stopped the re-asks early (no key, rate limited…). */
  stoppedBy?: RunIssue;
  start: () => void;
  /** Open re-ask `index` (0-based) next to the run, as run b. */
  open: (index: number) => void;
}

export interface WhyPanelProps {
  trace?: Trace;
  issue?: RunIssue | null;
  onSelect?: (id: string) => void;
  /** Rendered under the story when there's an issue (e.g. an "add key" button). */
  issueAction?: ReactNode;
  reask?: ReaskControl;
  className?: string;
}

export function WhyPanel({ trace, issue, onSelect, issueAction, reask, className }: WhyPanelProps) {
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
  const whatIfs = forksOf(trace);
  const forced = new Set(whatIfs.map((f) => f.path));
  const steady = new Map((reask?.steadiness ?? []).map((s) => [s.path, s]));

  return (
    <div className={cn("px-4 py-4", className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-mono text-[10px] tracking-[0.12em] text-ink-3 uppercase">why did it go here?</h2>
        {running && <ChainLinks variant="loading" count={5} size={10} label="running" />}
        {!running && reask && <ReaskButton reask={reask} />}
      </div>

      {reask && (reask.running || reask.steadiness || reask.stoppedBy) && <ReaskBox reask={reask} />}

      {isRehearsal(trace) && (
        <p className="mb-3 border-(length:--bw) border-dashed border-warn px-2.5 py-2 text-[12.5px] leading-relaxed text-ink-2">
          <span className="font-mono text-[11px] lowercase text-warn">rehearsal.</span> jev wasn&rsquo;t asked. every number below came from a hash of
          the input, so the roads are real but the judgement isn&rsquo;t. same input, same path.
        </p>
      )}

      {whatIfs.length === 1 && (
        <p className="mb-3 border-(length:--bw) border-dashed border-compare px-2.5 py-2 text-[12.5px] leading-relaxed text-ink-2">
          <span className="font-mono text-[11px] lowercase text-compare">what if.</span> {whatIfs[0]!.title ?? whatIfs[0]!.nodeId} was forced to go &ldquo;
          {edgeName(whatIfs[0]!.edge)}&rdquo;. every answer before it is replayed from the run it forked; the numbers at that fork were bent to go this way; everything after
          it was asked fresh.
        </p>
      )}
      {whatIfs.length > 1 && (
        <div className="mb-3 border-(length:--bw) border-dashed border-compare px-2.5 py-2 text-[12.5px] leading-relaxed text-ink-2">
          <p>
            <span className="font-mono text-[11px] lowercase text-compare">what if ×{whatIfs.length}.</span> {whatIfs.length} decisions were forced, one what-if on top of
            another:
          </p>
          <ForkList forks={whatIfs} onSelect={onSelect} className="my-1.5" />
          <p>every answer jev already gave is replayed; the numbers at each fork were bent to go that way; only roads never walked before were asked fresh.</p>
        </div>
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
              <div className="mb-3 min-w-0">
                <button
                  type="button"
                  onClick={() => onSelect?.(path)}
                  className="group/step -mx-1.5 block w-[calc(100%+0.75rem)] min-w-0 px-1.5 py-0.5 text-left transition-colors duration-(--dur-fast) hover:bg-surface-2"
                >
                  <span className="flex flex-wrap items-center gap-1.5">
                    <KindTag kind={decision.kind} />
                    <span className="truncate font-mono text-xs text-ink">{span.title ?? nodeId}</span>
                    {forced.has(path) && <Badge tone="warn">forced</Badge>}
                    <Badge tone={decision.fallback ? "warn" : "accent"} className="ml-auto">
                      → {decision.taken === "lowConfidence" ? "unsure" : decision.taken}
                      {value && decision.taken !== "fallback" ? ` · ${value}` : ""}
                    </Badge>
                  </span>
                  <span className="mt-1.5 block text-[13px] leading-relaxed text-ink-2 group-hover/step:text-ink">{decision.summary}</span>
                </button>
                {steady.has(path) && <SteadyLine steady={steady.get(path)!} onOpen={reask?.open} className="mt-1.5" />}
              </div>
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

function ReaskButton({ reask }: { reask: ReaskControl }) {
  if (reask.running) {
    return (
      <span className="flex items-center gap-2 font-mono text-[10.5px] lowercase text-ink-3" aria-live="polite">
        <ChainLinks variant="loading" count={3} size={9} label="asking again" />
        asking again {reask.done}/{reask.total}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={reask.start}
      disabled={reask.blocker !== null}
      title={reask.blocker ?? `send the same input to jev ${reask.total} more times and see if every decision holds`}
      className="font-mono text-[10.5px] lowercase text-ink-2 underline decoration-dotted underline-offset-4 hover:text-ink disabled:cursor-not-allowed disabled:no-underline disabled:opacity-45"
    >
      {reask.steadiness ? "ask again" : `ask again ×${reask.total}`}
    </button>
  );
}

function ReaskBox({ reask }: { reask: ReaskControl }) {
  // Asks are the run plus the re-asks jev answered; one that failed before deciding anything isn't an ask.
  const asks = 1 + reask.answered;
  const failed = reask.done - reask.answered;
  const flipped = reask.steadiness?.some((s) => s.verdict === "flipped");
  const failedNote = failed > 0 ? ` ${failed} re-ask${failed === 1 ? "" : "s"} failed before jev decided anything, so ${failed === 1 ? "it isn't" : "they aren't"} counted.` : "";
  return (
    <div
      className={cn(
        "mb-3 border-(length:--bw) border-dashed px-2.5 py-2 text-[12.5px] leading-relaxed text-ink-2",
        flipped ? "border-warn" : "border-dim",
      )}
    >
      <p>
        <span className={cn("font-mono text-[11px] lowercase", flipped ? "text-warn" : "text-ink-3")}>asked again.</span>{" "}
        {reask.steadiness
          ? `same input, ${asks} asks (this run and ${asks - 1} more${reask.running ? " so far" : ""}). ${steadyHeadline(reask.steadiness)}${failedNote}`
          : reask.running
            ? `sending the same input to jev ${reask.total} more times…${failedNote}`
            : `no re-ask got an answer back from jev, so there's nothing to compare this run with.${failedNote}`}
      </p>
      {reask.stoppedBy && (
        <p className="mt-1 font-mono text-[11px] text-warn">
          stopped after {reask.done} of {reask.total}: {reask.stoppedBy.title}
        </p>
      )}
      {reask.steadiness && !reask.running && (
        <p className="mt-1 font-mono text-[10.5px] leading-relaxed text-ink-3">
          jev doesn&rsquo;t answer the same input with exactly the same numbers twice. {asks} asks can catch a coin toss; holding on all of them doesn&rsquo;t promise it always
          will.
        </p>
      )}
    </div>
  );
}

const STEADY_MARK: Record<Steadiness["verdict"], string> = { flipped: "⇄", "could-flip": "≈", held: "=", unasked: "·" };

/** One decision across the asks: did it hold, and (if not) a way to open an ask that went elsewhere. */
export function SteadyLine({ steady, onOpen, className }: { steady: Steadiness; onOpen?: (index: number) => void; className?: string }) {
  const other = steady.elsewhere[0];
  return (
    <div className={cn("grid grid-cols-[0.75rem_1fr] gap-x-1.5 font-mono text-[11px] leading-snug", steady.verdict === "held" || steady.verdict === "unasked" ? "text-ink-3" : "text-warn", className)}>
      <span aria-hidden>{STEADY_MARK[steady.verdict]}</span>
      <p className="min-w-0">{steadyText(steady)}</p>
      {other && onOpen && (
        <button
          type="button"
          onClick={() => onOpen(other.first)}
          className="col-start-2 mt-1 justify-self-start text-left lowercase text-ink-2 underline decoration-dotted underline-offset-4 hover:text-ink"
        >
          open ask {other.first + 2} (→ {edgeName(other.edge)}) as run b →
        </button>
      )}
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
