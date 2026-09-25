import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * CSS-only tooltip: shows on hover and keyboard focus of the wrapped element.
 * Purely supplementary — always give the trigger its own aria-label.
 */
export function Tooltip({
  label,
  side = "bottom",
  className,
  children,
}: {
  label: ReactNode;
  side?: "top" | "bottom";
  className?: string;
  children: ReactNode;
}) {
  return (
    <span className={cn("group/tt relative inline-flex", className)}>
      {children}
      <span
        role="presentation"
        className={cn(
          "pointer-events-none absolute left-1/2 z-50 -translate-x-1/2 whitespace-nowrap border-hard bg-ink px-2 py-1 font-mono text-[11px] lowercase text-paper opacity-0",
          "transition-opacity duration-(--dur-fast) group-hover/tt:opacity-100 group-has-focus-visible/tt:opacity-100",
          side === "bottom" ? "top-[calc(100%+6px)]" : "bottom-[calc(100%+6px)]",
        )}
      >
        {label}
      </span>
    </span>
  );
}
