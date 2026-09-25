"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/cn";
import { CopyButton } from "@/components/ui/copy-button";

const TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:e[+-]?\d+)?)/gi;

/** Pretty JSON with light syntax color. Long payloads collapse behind a toggle. */
export function JsonView({ value, className, maxLines = 14 }: { value: unknown; className?: string; maxLines?: number }) {
  const text = useMemo(() => {
    if (typeof value === "string") return value;
    try {
      return JSON.stringify(value, null, 2) ?? "undefined";
    } catch {
      return String(value);
    }
  }, [value]);
  const lines = text.split("\n").length;
  const [open, setOpen] = useState(false);
  const clipped = lines > maxLines && !open;
  const isString = typeof value === "string";

  return (
    <div className={cn("group/json relative border-soft bg-surface-2", className)}>
      <div className="absolute top-1 right-1.5 opacity-0 transition-opacity duration-(--dur-fast) group-hover/json:opacity-100 group-focus-within/json:opacity-100">
        <CopyButton text={text} />
      </div>
      <pre
        className={cn(
          "px-2.5 py-2 font-mono text-[11px] leading-[1.6] break-words whitespace-pre-wrap text-ink",
          clipped && "overflow-y-hidden [mask-image:linear-gradient(to_bottom,black_70%,transparent)]",
        )}
        style={clipped ? { maxHeight: `calc(${maxLines} * 1.6 * 11px + 1rem)` } : undefined}
      >
        <code>{isString ? text : highlight(text)}</code>
      </pre>
      {lines > maxLines && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="w-full border-soft-t px-2.5 py-1 text-left font-mono text-[10px] lowercase text-ink-3 hover:bg-surface hover:text-ink"
          aria-expanded={open}
        >
          {open ? "collapse" : `show all ${lines} lines`}
        </button>
      )}
    </div>
  );
}

function highlight(text: string) {
  const out: React.ReactNode[] = [];
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(TOKEN)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const [whole, str, colon, lit, num] = m;
    if (str && colon) {
      out.push(
        <span key={i++} className="text-ink-2">
          {str}
        </span>,
        colon,
      );
    } else if (str) out.push(<span key={i++} className="text-pass">{str}</span>);
    else if (lit) out.push(<span key={i++} className="text-accent-strong">{lit}</span>);
    else if (num) out.push(<span key={i++} className="text-accent-strong">{num}</span>);
    else out.push(whole);
    last = at + whole.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
