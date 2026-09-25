"use client";

import { formatCombo, useIsMac } from "@/lib/hotkeys";
import { cn } from "@/lib/cn";

/** A single keycap. */
export function Kbd({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center border-soft bg-surface-2 px-1 font-mono text-[11px] leading-none text-ink-2 shadow-[0_1px_0_0_var(--line-soft)]",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/** Renders a combo string ("mod+enter", "g s") as platform-correct keycaps. */
export function KbdCombo({ combo, className }: { combo: string; className?: string }) {
  const isMac = useIsMac();
  const steps = formatCombo(combo, isMac);
  return (
    <span className={cn("inline-flex items-center gap-1", className)} aria-label={combo}>
      {steps.map((keys, i) => (
        <span key={i} className="inline-flex items-center gap-0.5">
          {i > 0 && <span className="px-0.5 font-mono text-[10px] text-ink-3">then</span>}
          {keys.map((k, j) => (
            <Kbd key={j}>{k}</Kbd>
          ))}
        </span>
      ))}
    </span>
  );
}
