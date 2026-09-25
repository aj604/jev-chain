"use client";

/**
 * The run in one strip: status, duration, requests vs calls (batching made
 * visible), tokens, cost, model. Live while running. Rehearsal runs get a
 * badge that says the numbers are made up, here and on share links alike.
 */
import type { Trace } from "jevchain";
import { ChainLinks } from "@/components/brand/chain-links";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { fmtMs, fmtTokens, fmtUsd } from "@/lib/trace/format";
import { isRehearsal } from "@/lib/trace/rehearsal";
import { forkOf } from "@/lib/trace/what-if";

const STATUS: Record<Trace["status"], { tone: BadgeTone; label: string }> = {
  running: { tone: "accent", label: "running" },
  ok: { tone: "pass", label: "ok" },
  halted: { tone: "warn", label: "halted" },
  error: { tone: "fail", label: "error" },
  aborted: { tone: "warn", label: "aborted" },
};

export function RunSummary({ trace, now, label, className }: { trace?: Trace; now?: number; label?: string; className?: string }) {
  if (!trace) {
    return (
      <div className={cn("flex h-9 items-center gap-3 px-3 font-mono text-[11px] lowercase text-ink-3", className)}>
        {label && <span className="text-ink-2">{label}</span>}
        <span>no run yet</span>
      </div>
    );
  }
  const s = STATUS[trace.status];
  const u = trace.usage;
  const saved = u.calls - u.requests;
  const fork = forkOf(trace);
  return (
    <div className={cn("flex h-9 min-w-0 items-center gap-x-4 overflow-x-auto px-3 font-mono text-[11px] whitespace-nowrap text-ink-3", className)} aria-live="polite">
      {label && <span className="text-ink-2">{label}</span>}
      <Badge tone={s.tone} dot={trace.status !== "running"}>
        {trace.status === "running" ? <ChainLinks variant="loading" count={3} size={8} label="running" cycleMs={900} /> : null}
        {s.label}
      </Badge>
      {isRehearsal(trace) && (
        <span title="jev wasn't asked: every answer came from a hash of the input. the path is real, the judgement isn't.">
          <Badge tone="warn">rehearsal · made-up answers</Badge>
        </span>
      )}
      {fork && (
        <span title="one decision was forced down a road it didn't take. earlier answers are replayed; only the new road was asked.">
          <Badge tone="warn">
            what if · {fork.title ?? fork.nodeId} → {fork.edge === "lowConfidence" ? "unsure" : fork.edge}
          </Badge>
        </span>
      )}
      <Metric k="time" v={fmtMs(trace.durationMs ?? now)} />
      <Metric
        k="requests"
        v={
          <>
            {u.requests}
            <span className="text-ink-3"> / {u.calls} calls</span>
            {saved > 0 && <span className="ml-1 text-accent-strong">⧉ {saved} batched</span>}
          </>
        }
      />
      <Metric k="tokens" v={fmtTokens(u.inputTokens)} />
      <Metric k="cost" v={fmtUsd(u.costUsd)} />
      {trace.models.length > 0 && <Metric k="model" v={trace.models.join(", ")} />}
    </div>
  );
}

function Metric({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span>{k}</span>
      <span className="text-ink tabular-nums">{v}</span>
    </span>
  );
}
