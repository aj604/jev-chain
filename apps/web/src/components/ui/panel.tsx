import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Hard-bordered box. Give it a `title` to get a mono title bar (think terminal
 * window chrome), with optional `actions` on the right.
 */
export function Panel({
  title,
  actions,
  className,
  bodyClassName,
  children,
  ...props
}: {
  title?: ReactNode;
  actions?: ReactNode;
  bodyClassName?: string;
} & Omit<ComponentProps<"section">, "title">) {
  return (
    <section className={cn("border-hard bg-surface", className)} {...props}>
      {(title || actions) && (
        <header className="flex h-8 items-center justify-between gap-3 border-hard-b bg-paper px-3 font-mono text-[11px] lowercase text-ink-2">
          <div className="flex min-w-0 items-center gap-2 truncate">{title}</div>
          {actions && <div className="flex shrink-0 items-center gap-1.5">{actions}</div>}
        </header>
      )}
      <div className={cn(bodyClassName)}>{children}</div>
    </section>
  );
}

/** Three hollow squares — window chrome, but make it brutalist. */
export function PanelDots() {
  return (
    <span aria-hidden className="flex items-center gap-1">
      <span className="size-2 border-hard bg-accent" />
      <span className="size-2 border-hard" />
      <span className="size-2 border-hard" />
    </span>
  );
}
