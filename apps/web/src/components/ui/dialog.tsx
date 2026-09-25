"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Accessible modal built on native <dialog>: focus trapping, Esc to close,
 * top-layer rendering and focus restoration come from the platform.
 * Controlled via `open` / `onClose`.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  footer,
  className,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  footer?: ReactNode;
  className?: string;
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onClose={onClose}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      // Clicking the backdrop lands on the <dialog> element itself.
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className={cn(
        "m-auto w-[min(34rem,calc(100vw-2rem))] max-h-[calc(100dvh-4rem)] overflow-visible bg-transparent p-0 text-ink",
        "open:animate-[dialog-in_var(--dur-slow)_var(--ease-out)]",
        className,
      )}
    >
      <div className="flex max-h-[calc(100dvh-4rem)] flex-col border-hard bg-paper shadow-[6px_6px_0_0_var(--ink)]">
        <header className="flex items-start justify-between gap-4 border-hard-b px-5 py-4">
          <div className="min-w-0">
            <h2 id={titleId} className="font-mono text-sm lowercase text-ink">
              {title}
            </h2>
            {description && (
              <p id={descId} className="mt-1 text-sm text-ink-2">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="close"
            className="-mr-1.5 -mt-0.5 grid size-7 shrink-0 place-items-center text-ink-3 transition-colors duration-(--dur-fast) hover:bg-surface-2 hover:text-ink"
          >
            <svg viewBox="0 0 12 12" className="size-3" aria-hidden>
              <path d="M1.5 1.5l9 9M10.5 1.5l-9 9" stroke="currentColor" strokeWidth="1.2" />
            </svg>
          </button>
        </header>
        <div className="min-h-0 overflow-y-auto px-5 py-4">{children}</div>
        {footer && (
          <footer className="flex items-center justify-end gap-2 border-hard-t bg-surface-2 px-5 py-3">
            {footer}
          </footer>
        )}
      </div>
    </dialog>
  );
}
