"use client";

import { decisions, type Decision, type Trace } from "jevchain";
import { ChainLinks } from "@/components/brand/chain-links";
import { cn } from "@/lib/cn";
import { fmtMetric, fmtMs, fmtUsd, previewJson } from "@/lib/trace/format";
import type { RunIssue } from "@/lib/trace/run-error";
import { hasReasks, splitHeadline, splitText, type Split, type SplitVerdict } from "@/lib/trace/split";
import { edgeName, forksOf } from "@/lib/trace/what-if";
import { ForkList } from "@/components/trace/fork-list";

/**
 * "Ask both again": send a's input and b's input to Jev a few more times
 * each, and read every decision across both (see `lib/trace/split`).
 */
export interface CompareAskControl {
  /** Why the two inputs can't be asked again (a rehearsal, a what-if, the same input twice…), or null. */
  blocker: string | null;
  running: boolean;
  /** Re-asks finished so far per side (answered or failed), of `total` each. */
  done: { a: number; b: number };
  total: number;
  /** Every decision either run made, across both inputs' asks so far (once any re-ask of either finished). */
  splits?: Split[];
  /** What stopped the re-asks early (no key, rate limited…). */
  stoppedBy?: RunIssue;
  start: () => void;
}

const VERDICT_TAG: Record<SplitVerdict, { label: string; tone: string } | null> = {
  apart: { label: "apart", tone: "border-pass text-pass" },
  "both-ways": { label: "both ways", tone: "border-warn text-warn" },
  same: { label: "same", tone: "border-dim text-ink-3" },
  thin: null,
  "one-sided": null,
};

function AskBoth({ ask }: { ask: CompareAskControl }) {
  const splits = ask.splits && hasReasks(ask.splits) ? ask.splits : undefined;
  return (
    <div className="mb-4 border-(length:--bw) border-dashed border-dim px-2.5 py-2 text-[12.5px] leading-relaxed text-ink-2">
      <div className="flex items-center gap-3">
        <span className="font-mono text-[11px] lowercase text-ink-3">input, or jev?</span>
        {ask.running ? (
          <span className="ml-auto flex items-center gap-2 font-mono text-[10.5px] lowercase text-ink-3" aria-live="polite">
            <ChainLinks variant="loading" count={3} size={9} label="asking again" />
            asking again · a {ask.done.a}/{ask.total} · b {ask.done.b}/{ask.total}
          </span>
        ) : (
          <button
            type="button"
            onClick={ask.start}
            disabled={ask.blocker !== null}
            title={ask.blocker ?? `send each input to jev ${ask.total} more times and see whether they part at the same places every time`}
            className="ml-auto font-mono text-[10.5px] lowercase text-ink-2 underline decoration-dotted underline-offset-4 hover:text-ink disabled:cursor-not-allowed disabled:no-underline disabled:opacity-45"
          >
            ask both again ×{ask.total}
          </button>
        )}
      </div>
      <p className="mt-1">
        {splits
          ? "each decision below is read across every ask of each input. “apart” means the two inputs never shared a road there; “both ways” means at least one input goes either way by itself, so a single pull of each can split there without the edit mattering. a handful of asks can catch a coin toss, not prove there isn't one."
          : ask.blocker && !ask.running
            ? ask.blocker
            : "one pull of each input is one sample of each. the same input can come back down a different road, so a split here may be jev, not your edit. ask both again to tell."}
      </p>
      {ask.stoppedBy && (
        <p className="mt-1 font-mono text-[11px] text-warn">
          stopped early: {ask.stoppedBy.title}
          {ask.stoppedBy.detail ? `. ${ask.stoppedBy.detail}` : ""}
        </p>
      )}
    </div>
  );
}

function Side({ tone, decision, missing }: { tone: "a" | "b"; decision?: Decision; missing: boolean }) {
  if (!decision) {
    return <p className="font-mono text-[11px] text-ink-3">{missing ? "didn't get here" : "…"}</p>;
  }
  const taken = decision.edges.find((e) => e.edge === decision.taken);
  const v = fmtMetric(decision.kind === "cascade" ? "confidence" : decision.metric, taken?.value ?? decision.value);
  return (
    <div className="min-w-0">
      <span
        className={cn(
          "inline-block h-[18px] max-w-full truncate px-1 font-mono text-[10px] leading-[16px]",
          tone === "a" ? "border-hard bg-accent text-accent-ink" : "border-hard bg-compare text-paper",
        )}
      >
        → {decision.taken === "lowConfidence" ? "unsure" : decision.taken}
        {v && decision.taken !== "fallback" ? ` · ${v}` : ""}
      </span>
      <p className="mt-1 text-[12px] leading-snug text-ink-2">{decision.summary}</p>
    </div>
  );
}

/**
 * `canFork` says run b can be forked again (the studio, not a share page);
 * `onUndo` puts back the b this one was forked from, when there is one.
 */
export function CompareSummary({
  a,
  b,
  onSelect,
  canFork,
  onUndo,
  ask,
}: {
  a?: Trace;
  b?: Trace;
  onSelect?: (id: string) => void;
  canFork?: boolean;
  onUndo?: () => void;
  /** "Ask both again" (the studio, when both runs are real). */
  ask?: CompareAskControl;
}) {
  if (!a || !b) {
    return (
      <p className="px-4 py-6 text-[13px] leading-relaxed text-ink-2">
        run both inputs to see where they part ways. same chain, two inputs, one graph: a in pink, b in blue.
      </p>
    );
  }
  const da = decisions(a);
  const db = decisions(b);
  const splits = ask?.splits && hasReasks(ask.splits) ? ask.splits : undefined;
  // Decisions only a re-ask made get a row too: that's where some ask of an input went instead.
  const paths = [...new Set([...da.map((d) => d.path), ...db.map((d) => d.path), ...(splits ?? []).map((s) => s.path)])];
  const done = a.status !== "running" && b.status !== "running";
  const head = done ? splitHeadline(a, b, splits) : null;
  const forks = forksOf(b);

  return (
    <div className="px-4 py-4">
      <h2 className="mb-3 font-mono text-[10px] tracking-[0.12em] text-ink-3 uppercase">a vs b</h2>
      {forks.length === 1 && (
        <p className="mb-3 text-[12.5px] leading-relaxed text-ink-2">
          b is a what-if: same input, with <span className="font-mono text-[11px] text-ink">{forks[0]!.title ?? forks[0]!.nodeId}</span> forced to go &ldquo;
          {edgeName(forks[0]!.edge)}&rdquo;. before it, b replays a&rsquo;s answers; after it, the new road was asked fresh.
        </p>
      )}
      {forks.length > 1 && (
        <div className="mb-3 text-[12.5px] leading-relaxed text-ink-2">
          <p>b is a what-if of a what-if: same input, with {forks.length} decisions forced in turn:</p>
          <ForkList forks={forks} onSelect={onSelect} className="my-1.5" />
          <p>everything jev already said is replayed; only roads no run had walked were asked fresh.</p>
        </div>
      )}
      {forks.length > 0 && canFork && b.status !== "running" && (
        <p className="mb-3 font-mono text-[10.5px] leading-relaxed text-ink-3">
          open run b and pick any decision to force it too; what b already forced stays forced.
          {onUndo && (
            <>
              {" "}
              <button type="button" onClick={onUndo} className="text-ink-2 lowercase underline decoration-dotted underline-offset-4 hover:text-ink">
                ↩ undo the last what-if
              </button>
            </>
          )}
        </p>
      )}
      {head && (
        <button
          type="button"
          onClick={() => head.path && onSelect?.(head.path)}
          className={cn(
            "fade-up mb-4 block w-full border-(length:--bw) px-3 py-2 text-left text-[13px] leading-snug",
            head.diverged ? "border-line bg-surface shadow-[3px_3px_0_0_var(--accent),6px_6px_0_0_var(--compare)]" : "border-soft bg-surface-2",
          )}
        >
          {head.text}
        </button>
      )}
      {ask && done && forks.length === 0 && <AskBoth ask={ask} />}
      <ol className="space-y-3">
        {paths.map((path) => {
          const x = da.find((d) => d.path === path);
          const y = db.find((d) => d.path === path);
          const sp = splits?.find((z) => z.path === path);
          const tag = sp ? VERDICT_TAG[sp.verdict] : null;
          const name = a.spans.find((s) => s.path === path)?.title ?? b.spans.find((s) => s.path === path)?.title ?? sp?.title ?? x?.nodeId ?? y?.nodeId;
          const split = x && y && x.decision.taken !== y.decision.taken;
          return (
            <li key={path} className="fade-up">
              <button
                type="button"
                onClick={() => onSelect?.(path)}
                className="mb-1.5 flex w-full items-center gap-2 font-mono text-[11px] text-ink hover:text-accent-strong"
              >
                <span className="truncate">{name}</span>
                {split && <span className="ml-auto shrink-0 border-(length:--bw) border-warn px-1 text-[9px] leading-4 text-warn">fork</span>}
                {tag && <span className={cn("shrink-0 border-(length:--bw) px-1 text-[9px] leading-4", !split && "ml-auto", tag.tone)}>{tag.label}</span>}
              </button>
              <div className="grid grid-cols-2 gap-3">
                <Side tone="a" decision={x?.decision} missing={a.status !== "running"} />
                <Side tone="b" decision={y?.decision} missing={b.status !== "running"} />
              </div>
              {sp && <p className="mt-1.5 font-mono text-[10.5px] leading-relaxed text-ink-3">⇄ {splitText(sp)}</p>}
            </li>
          );
        })}
      </ol>
      {done && (
        <div className="mt-4 grid grid-cols-2 gap-3 border-soft-t pt-3 font-mono text-[10.5px] text-ink-3">
          {[a, b].map((t, i) => (
            <div key={i} className="min-w-0 space-y-1">
              <p className="text-ink">{i === 0 ? "a" : "b"} · {t.status}</p>
              <p className="tabular-nums">
                {fmtMs(t.durationMs)} · {t.usage.requests} req · {fmtUsd(t.usage.costUsd)}
              </p>
              {t.output !== undefined && <p className="line-clamp-3 break-words text-ink-2">{previewJson(t.output, 140)}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
