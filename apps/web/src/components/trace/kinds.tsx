import type { SpanStatus, VertexKind, VertexState } from "jevchain";
import { ChainLinks } from "@/components/brand/chain-links";
import { cn } from "@/lib/cn";

/** A glyph per node kind, so kind never relies on color alone. */
export const KIND_GLYPH: Record<VertexKind, string> = {
  ask: "?",
  route: "⑂",
  gate: "⊢",
  parallel: "∥",
  cascade: "⇶",
  tier: "≡",
  step: "ƒ",
  emit: "↦",
  chain: "⧉",
  join: "⋈",
  halt: "■",
};

export function KindTag({ kind, className, tone = "plain" }: { kind: VertexKind; className?: string; tone?: "plain" | "lit" | "fail" | "warn" }) {
  return (
    <span
      className={cn(
        "inline-flex h-[18px] shrink-0 items-center gap-1 px-1 font-mono text-[10px] leading-none lowercase",
        tone === "plain" && "border-soft bg-surface-2 text-ink-2",
        tone === "lit" && "border-hard bg-accent text-accent-ink",
        tone === "fail" && "border-(length:--bw) border-fail bg-fail-wash text-fail",
        tone === "warn" && "border-(length:--bw) border-warn bg-warn-wash text-warn",
        className,
      )}
    >
      <span aria-hidden className="w-2.5 text-center">
        {KIND_GLYPH[kind]}
      </span>
      {kind}
    </span>
  );
}

export type AnyState = VertexState | SpanStatus | "aborted";

export const STATE_LABEL: Record<AnyState, string> = {
  idle: "idle",
  running: "running",
  ok: "ok",
  error: "error",
  halted: "halted",
  skipped: "skipped",
  aborted: "aborted",
};

/** Status as glyph + word; running gets the chain-link loader. */
export function StateMark({ state, className, showLabel = false }: { state: AnyState; className?: string; showLabel?: boolean }) {
  const color =
    state === "ok"
      ? "text-pass"
      : state === "error" || state === "aborted"
        ? "text-fail"
        : state === "halted"
          ? "text-warn"
          : state === "running"
            ? "text-ink"
            : "text-ink-3";
  return (
    <span className={cn("inline-flex items-center gap-1 font-mono text-[10px] leading-none lowercase", color, className)}>
      {state === "running" ? (
        <ChainLinks variant="loading" count={3} size={8} label="running" cycleMs={900} />
      ) : (
        <span aria-hidden>{state === "ok" ? "✓" : state === "error" || state === "aborted" ? "✕" : state === "halted" ? "■" : state === "skipped" ? "–" : "·"}</span>
      )}
      <span className={showLabel ? "" : "sr-only"}>{STATE_LABEL[state]}</span>
    </span>
  );
}
