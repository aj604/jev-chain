/**
 * Jev's answers as small horizontal bar charts. Every label, every level,
 * every probability: the point of a trace is that nothing is hidden.
 */
import type { Answer, ChoiceAnswer, Entry, NoulAnswer, Question, ScoreAnswer } from "jevchain";
import { cn } from "@/lib/cn";
import { entryText, fmtNum, fmtPct } from "@/lib/trace/format";

export interface DistributionMarks {
  /** Threshold to draw (in the answer's units: probability, noul or score). */
  threshold?: { min?: number; max?: number; label?: string };
  /** For a route decision: the label that was taken (can differ from the argmax on a low-confidence fallback). */
  taken?: string;
}

export function Distribution({ answer, question, marks }: { answer: Answer; question?: Question; marks?: DistributionMarks }) {
  switch (answer.type) {
    case "choice":
      return <ChoiceBars answer={answer} question={question?.type === "choice" ? question : undefined} marks={marks} />;
    case "score":
      return <ScoreBars answer={answer} marks={marks} />;
    case "noul":
      return <NoulBar answer={answer} marks={marks} />;
  }
}

function Track({ p, lit, tick, className }: { p: number; lit: boolean; tick?: number; className?: string }) {
  return (
    <span className={cn("relative h-2 border-soft bg-surface-2", className)}>
      <span
        className={cn("bar-grow absolute inset-y-0 left-0", lit ? "bg-accent" : "bg-dim")}
        style={{ width: `${Math.max(p > 0 ? 1.5 : 0, Math.min(1, p) * 100)}%` }}
      />
      {tick !== undefined && (
        <span aria-hidden className="absolute -inset-y-1 w-(--bw) bg-ink" style={{ left: `${Math.min(1, Math.max(0, tick)) * 100}%` }} />
      )}
    </span>
  );
}

function ChoiceBars({ answer, question, marks }: { answer: ChoiceAnswer; question?: Question & { type: "choice" }; marks?: DistributionMarks }) {
  const labels = question ? Object.keys(question.criteria) : Object.keys(answer.probabilities);
  const winner = marks?.taken && marks.taken in answer.probabilities ? marks.taken : answer.choice;
  const thresholdLabel = marks?.threshold?.label;
  const bar = marks?.threshold?.min ?? marks?.threshold?.max;
  return (
    <div>
      <ul className="space-y-1">
        {labels.map((label) => {
          const p = answer.probabilities[label] ?? 0;
          const lit = label === winner;
          const desc = question ? entryText(question.criteria[label] as Entry) : "";
          return (
            <li key={label} className="grid grid-cols-[minmax(4.5rem,38%)_1fr_2.75rem] items-center gap-2 font-mono text-[11px]" title={desc || undefined}>
              <span className={cn("flex min-w-0 items-center gap-1", lit ? "text-ink" : "text-ink-3")}>
                <span aria-hidden className="w-2.5 shrink-0">{lit ? "✓" : ""}</span>
                <span className="truncate">{label}</span>
              </span>
              <Track p={p} lit={lit} tick={thresholdLabel === label ? bar : undefined} />
              <span className={cn("text-right tabular-nums", lit ? "text-ink" : "text-ink-3")}>{fmtPct(p)}</span>
            </li>
          );
        })}
      </ul>
      <p className="mt-1.5 font-mono text-[10px] text-ink-3">confidence {fmtNum(answer.confidence)}</p>
    </div>
  );
}

function ScoreBars({ answer, marks }: { answer: ScoreAnswer; marks?: DistributionMarks }) {
  const levels = Object.keys(answer.probabilities)
    .map(Number)
    .sort((a, b) => a - b);
  const max = Math.max(1, levels.at(-1) ?? 1);
  const nearest = Math.round(answer.score);
  const bar = marks?.threshold?.min ?? marks?.threshold?.max;
  return (
    <div>
      <ul className="space-y-1">
        {levels.map((lvl) => {
          const p = answer.probabilities[String(lvl)] ?? 0;
          const lit = lvl === nearest;
          const legend = entryText(answer.legend[String(lvl)]);
          return (
            <li key={lvl} className="grid grid-cols-[1.25rem_minmax(0,38%)_1fr_2.75rem] items-center gap-2 font-mono text-[11px]" title={legend}>
              <span className={cn("tabular-nums", lit ? "text-ink" : "text-ink-3")}>{lvl}</span>
              <span className={cn("truncate font-sans text-[11.5px]", lit ? "text-ink" : "text-ink-3")}>{legend}</span>
              <Track p={p} lit={lit} />
              <span className={cn("text-right tabular-nums", lit ? "text-ink" : "text-ink-3")}>{fmtPct(p)}</span>
            </li>
          );
        })}
      </ul>
      {/* the weighted score on a 0..n ruler */}
      <div className="mt-3">
        <div className="relative h-5">
          <span className="absolute inset-x-0 top-1/2 h-(--bw) bg-line-soft" />
          {levels.map((lvl) => (
            <span key={lvl} className="absolute top-1/2 h-2 w-(--bw) -translate-y-1/2 bg-ink-3" style={{ left: `${(lvl / max) * 100}%` }} />
          ))}
          {bar !== undefined && (
            <span aria-hidden className="absolute inset-y-0 w-0 border-l-(length:--bw) border-dashed border-ink" style={{ left: `${(bar / max) * 100}%` }} />
          )}
          <span
            className="absolute top-1/2 grid size-3 -translate-x-1/2 -translate-y-1/2 place-items-center border-hard bg-accent transition-[left] duration-(--dur-slow) ease-snap"
            style={{ left: `${(answer.score / max) * 100}%` }}
          />
        </div>
        <div className="mt-1 flex justify-between font-mono text-[10px] text-ink-3">
          <span>0</span>
          <span className="text-ink">
            score {fmtNum(answer.score)}
            {bar !== undefined && <span className="text-ink-3"> · bar {fmtNum(bar)}</span>}
            <span className="text-ink-3"> · conf {fmtNum(answer.confidence)}</span>
          </span>
          <span>{max}</span>
        </div>
      </div>
    </div>
  );
}

function NoulBar({ answer, marks }: { answer: NoulAnswer; marks?: DistributionMarks }) {
  const bar = marks?.threshold?.min ?? marks?.threshold?.max;
  const yes = answer.noul >= 0.5;
  return (
    <div>
      <div className="grid grid-cols-[3.5rem_1fr_2.75rem] items-center gap-2 font-mono text-[11px]">
        <span className="text-ink">p(yes)</span>
        <span className="relative">
          <Track p={answer.noul} lit className="block" tick={bar} />
          <span aria-hidden className="absolute -top-1 -bottom-1 left-1/2 w-0 border-l-(length:--bw) border-dotted border-ink-3" />
        </span>
        <span className="text-right tabular-nums text-ink">{fmtNum(answer.noul)}</span>
      </div>
      <p className="mt-1.5 font-mono text-[10px] text-ink-3">
        leans {yes ? "yes" : "no"} · {fmtPct(Math.abs(answer.noul - 0.5) * 2)} sure
        {bar !== undefined && ` · bar ${fmtNum(bar)}`} · dotted line = coin flip
      </p>
    </div>
  );
}
