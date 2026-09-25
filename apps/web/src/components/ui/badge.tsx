import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type BadgeTone = "neutral" | "ink" | "accent" | "pass" | "warn" | "fail" | "dim";

const tones: Record<BadgeTone, string> = {
  neutral: "border-soft bg-surface-2 text-ink-2",
  ink: "border-hard bg-ink text-paper",
  accent: "border-hard bg-accent text-accent-ink",
  pass: "border-(length:--bw) border-pass bg-pass-wash text-pass",
  warn: "border-(length:--bw) border-warn bg-warn-wash text-warn",
  fail: "border-(length:--bw) border-fail bg-fail-wash text-fail",
  dim: "border-dashed border-(length:--bw) border-dim text-ink-3",
};

/** Small mono pill for statuses, node kinds, probabilities. */
export function Badge({
  tone = "neutral",
  dot = false,
  className,
  children,
}: {
  tone?: BadgeTone;
  /** Leading status square in the tone's color. */
  dot?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1.5 px-1.5 font-mono text-[11px] leading-none lowercase",
        tones[tone],
        className,
      )}
    >
      {dot && <span aria-hidden className="size-1.5 bg-current" />}
      {children}
    </span>
  );
}
