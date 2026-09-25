import { cn } from "@/lib/cn";

/** Two interlocked links: one accent, one ink. Works at 16px and up. */
export function LogoMark({ size = 20, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" aria-hidden className={cn("shrink-0", className)}>
      {/* left link sits behind, right link's near side crosses over it */}
      <rect x="2.2" y="7" width="12" height="10" rx="5" stroke="currentColor" strokeWidth="1.6" fill="var(--accent)" />
      <path d="M9.8 7h7a5 5 0 0 1 0 10h-7" stroke="currentColor" strokeWidth="1.6" />
      <path d="M9.8 17a5 5 0 0 1 0-10" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

/** Wordmark: link glyph + "jevchain" in Geist Mono, lowercase. */
export function Logo({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-mono text-[15px] font-medium tracking-tight text-ink", className)}>
      <LogoMark />
      {!compact && (
        <span>
          jev<span className="text-ink-3">chain</span>
        </span>
      )}
    </span>
  );
}
