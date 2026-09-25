"use client";

import { useId } from "react";
import type { Json } from "jevchain";
import { cn } from "@/lib/cn";
import { parseInput, toEditor, type InputMode } from "@/lib/trace/input";
import { previewJson } from "@/lib/trace/format";

export interface InputValue {
  text: string;
  mode: InputMode;
}

export function InputEditor({
  label,
  value,
  onChange,
  samples,
  disabled,
  tone,
  rows = 6,
  hideLabel = false,
}: {
  label: string;
  value: InputValue;
  onChange: (v: InputValue) => void;
  samples: { label: string; value: Json }[];
  disabled?: boolean;
  /** Compare mode color chip. */
  tone?: "a" | "b";
  rows?: number;
  /** Keep the label for screen readers only (when a section heading already says it). */
  hideLabel?: boolean;
}) {
  const id = useId();
  const parsed = parseInput(value.text, value.mode);
  const errorId = `${id}-err`;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <label htmlFor={id} className={cn("flex items-center gap-1.5 font-mono text-[10px] tracking-[0.12em] text-ink-3 uppercase", hideLabel && "sr-only")}>
          {tone && (
            <span
              aria-hidden
              className={cn(
                "grid h-4 min-w-4 place-items-center border-hard px-0.5 font-mono text-[9px] tracking-normal lowercase",
                tone === "a" ? "bg-accent text-accent-ink" : "bg-compare text-paper",
              )}
            >
              {tone}
            </span>
          )}
          {label}
        </label>
        <div role="radiogroup" aria-label={`${label} format`} className="ml-auto flex border-soft">
          {(["text", "json"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={value.mode === m}
              onClick={() => onChange({ ...value, mode: m })}
              className={cn(
                "h-5 px-1.5 font-mono text-[10px] lowercase transition-colors duration-(--dur-fast)",
                value.mode === m ? "bg-ink text-paper" : "text-ink-3 hover:text-ink",
              )}
            >
              {m}
            </button>
          ))}
        </div>
      </div>
      <textarea
        id={id}
        value={value.text}
        onChange={(e) => onChange({ ...value, text: e.target.value })}
        disabled={disabled}
        rows={rows}
        spellCheck={value.mode === "text"}
        aria-invalid={!parsed.ok}
        aria-describedby={!parsed.ok ? errorId : undefined}
        className={cn(
          "block w-full resize-y border-(length:--bw) bg-surface px-2.5 py-2 font-mono text-[12px] leading-[1.55] text-ink outline-none transition-colors duration-(--dur-fast)",
          "placeholder:text-ink-3 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent disabled:opacity-60",
          parsed.ok ? "border-line" : "border-fail",
        )}
        placeholder={value.mode === "json" ? '{ "message": "…" }' : "my toaster is haunted"}
      />
      {!parsed.ok && (
        <p id={errorId} className="font-mono text-[10.5px] text-fail">
          ✕ {parsed.error}
          {parsed.line ? ` (line ${parsed.line})` : ""}
        </p>
      )}
      {samples.length > 0 && (
        <div className="flex flex-wrap gap-1" aria-label="sample inputs">
          {samples.map((s) => {
            const next = toEditor(s.value);
            const active = next.text === value.text;
            return (
              <button
                key={s.label}
                type="button"
                disabled={disabled}
                onClick={() => onChange(next)}
                title={previewJson(s.value, 140)}
                className={cn(
                  "h-6 max-w-full truncate px-1.5 font-mono text-[10.5px] lowercase transition-colors duration-(--dur-fast) disabled:opacity-50",
                  active ? "border-hard bg-ink text-paper" : "border-soft bg-paper text-ink-2 hover:border-(--line) hover:text-ink",
                )}
              >
                {s.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
