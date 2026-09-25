"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/cn";

export function CopyButton({ text, className, label = "copy" }: { text: string; className?: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1400);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
        } catch {
          // clipboard blocked; nothing to do
        }
      }}
      className={cn(
        "font-mono text-[11px] lowercase text-ink-3 transition-colors duration-(--dur-fast) hover:text-ink",
        copied && "text-pass hover:text-pass",
        className,
      )}
      aria-label={copied ? "copied" : `${label} to clipboard`}
    >
      <span aria-live="polite">{copied ? "copied ✓" : label}</span>
    </button>
  );
}
