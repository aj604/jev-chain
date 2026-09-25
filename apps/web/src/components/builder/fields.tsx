"use client";

/**
 * Form primitives for the builder's property editor. Mono labels, hard
 * borders, square everything, and small: the editor is a 24rem column.
 *
 * Fields that can be mid-edit invalid (keys, JSON) keep a local draft and
 * only commit when the value is valid, so the document never holds garbage
 * and undo never replays half-typed JSON.
 */
import { useId, useState, type ReactNode } from "react";
import type { Entry } from "jevchain";
import { cn } from "@/lib/cn";
import { keyProblem } from "@/lib/builder/question-ops";

export const inputBase =
  "border-(length:--bw) bg-surface px-2 font-mono text-[12px] text-ink outline-none transition-colors duration-(--dur-fast) " +
  "placeholder:text-ink-3 focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent disabled:opacity-50";

export function Label({ htmlFor, children, className }: { htmlFor?: string; children: ReactNode; className?: string }) {
  return (
    <label htmlFor={htmlFor} className={cn("block font-mono text-[10px] tracking-[0.12em] text-ink-3 uppercase", className)}>
      {children}
    </label>
  );
}

/** Label + control + hint/error, stacked. */
export function Field({
  label,
  hint,
  error,
  warn,
  aside,
  children,
  id,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  warn?: string | null;
  aside?: ReactNode;
  children: (id: string) => ReactNode;
  id?: string;
}) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <div className="space-y-1">
      <div className="flex min-h-4 items-center gap-2">
        <Label htmlFor={fid}>{label}</Label>
        {aside && <div className="ml-auto flex items-center gap-1">{aside}</div>}
      </div>
      {children(fid)}
      {error ? (
        <p className="font-mono text-[10.5px] text-fail">✕ {error}</p>
      ) : warn ? (
        <p className="font-mono text-[10.5px] text-warn">! {warn}</p>
      ) : hint ? (
        <p className="font-mono text-[10.5px] leading-relaxed text-ink-3">{hint}</p>
      ) : null}
    </div>
  );
}

export function TextInput({
  value,
  onChange,
  invalid,
  className,
  ...props
}: { value: string; onChange: (v: string) => void; invalid?: boolean } & Omit<React.ComponentProps<"input">, "value" | "onChange">) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      spellCheck={false}
      autoComplete="off"
      aria-invalid={invalid || undefined}
      className={cn(inputBase, "block h-7 w-full min-w-0", invalid ? "border-fail" : "border-line", className)}
      {...props}
    />
  );
}

export function TextArea({
  value,
  onChange,
  invalid,
  className,
  rows = 2,
  ...props
}: { value: string; onChange: (v: string) => void; invalid?: boolean } & Omit<React.ComponentProps<"textarea">, "value" | "onChange">) {
  return (
    <textarea
      value={value}
      onChange={(e) => onChange(e.target.value)}
      rows={rows}
      aria-invalid={invalid || undefined}
      className={cn(inputBase, "block w-full min-w-0 resize-y py-1.5 leading-[1.5]", invalid ? "border-fail" : "border-line", className)}
      {...props}
    />
  );
}

/**
 * A map key (label, branch, question key, id). Keeps a local draft while it's
 * empty or colliding, commits as soon as it's valid, and snaps back on blur.
 */
export function KeyInput({
  value,
  keys,
  onCommit,
  label,
  className,
  placeholder,
  allowDuplicate = false,
  id,
}: {
  value: string;
  /** Keys already in use (may include `value`). */
  keys: string[];
  onCommit: (next: string) => void;
  label: string;
  className?: string;
  placeholder?: string;
  allowDuplicate?: boolean;
  id?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(value);
  }
  const problem = keyProblem(draft, allowDuplicate ? [] : keys, value);
  return (
    <span className={cn("relative block min-w-0", className)}>
      <TextInput
        id={id}
        value={draft}
        aria-label={label}
        placeholder={placeholder}
        invalid={Boolean(problem)}
        title={problem ?? undefined}
        onChange={(v) => {
          setDraft(v);
          if (!keyProblem(v, allowDuplicate ? [] : keys, value)) onCommit(v);
        }}
        onBlur={() => setDraft(value)}
      />
      {problem && (
        <span role="status" className="pointer-events-none absolute top-full left-0 z-10 mt-px border-(length:--bw) border-fail bg-fail-wash px-1 font-mono text-[9.5px] whitespace-nowrap text-fail">
          {problem}
        </span>
      )}
    </span>
  );
}

function entryToText(v: Entry | undefined): { text: string; mode: "text" | "json" } {
  if (v === undefined || v === null) return { text: "", mode: "text" };
  if (typeof v === "string") return { text: v, mode: "text" };
  return { text: JSON.stringify(v, null, 2), mode: "json" };
}

/**
 * An Entry (text, or a JSON object/array) as used for instructions, criteria
 * descriptions and emit values. Empty text means "none" (`emptyAs`).
 */
export function EntryField({
  value,
  onChange,
  label,
  placeholder,
  rows = 2,
  emptyAs = null,
  allowJson = true,
  anyJson = false,
  hint,
  id,
}: {
  value: Entry | undefined;
  onChange: (v: Entry | undefined) => void;
  label: ReactNode;
  placeholder?: string;
  rows?: number;
  emptyAs?: null | undefined | "";
  allowJson?: boolean;
  /** Accept any JSON value (numbers, booleans) in JSON mode. For emit values. */
  anyJson?: boolean;
  hint?: ReactNode;
  id?: string;
}) {
  const [local, setLocal] = useState(() => entryToText(value));
  const [seen, setSeen] = useState(value);
  const [error, setError] = useState<string | null>(null);
  if (seen !== value) {
    setSeen(value);
    // Only resync when the document moved underneath us (undo, another field).
    const committed = local.mode === "json" ? tryParse(local.text) : local.text || emptyAs;
    if (JSON.stringify(committed) !== JSON.stringify(value)) {
      setLocal(entryToText(value));
      setError(null);
    }
  }

  const commit = (text: string, mode: "text" | "json") => {
    setLocal({ text, mode });
    if (mode === "text") {
      setError(null);
      onChange(text === "" ? emptyAs : text);
      return;
    }
    if (!text.trim()) {
      setError(null);
      onChange(emptyAs);
      return;
    }
    try {
      const parsed: unknown = JSON.parse(text);
      if (!anyJson && (parsed === null || typeof parsed !== "object")) {
        setError("json mode wants an object or array (use text for plain strings)");
        return;
      }
      setError(null);
      onChange(parsed as Entry);
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^JSON\.parse: /, "") : "not valid json");
    }
  };

  return (
    <Field
      id={id}
      label={label}
      error={error}
      hint={hint}
      aside={
        allowJson && (
          <Segmented
            size="xs"
            label="format"
            options={[
              { value: "text", label: "text" },
              { value: "json", label: "json" },
            ]}
            value={local.mode}
            onChange={(m) => {
              if (m === local.mode) return;
              if (m === "json") {
                const text = local.text ? JSON.stringify(anyJson ? local.text : { text: local.text }, null, 2) : "";
                commit(text, "json");
              } else {
                const parsed = tryParse(local.text);
                commit(typeof parsed === "string" ? parsed : parsed === undefined ? local.text : JSON.stringify(parsed), "text");
              }
            }}
          />
        )
      }
    >
      {(fid) => (
        <TextArea
          id={fid}
          value={local.text}
          onChange={(t) => commit(t, local.mode)}
          rows={local.mode === "json" ? Math.max(rows, 4) : rows}
          placeholder={local.mode === "json" ? '{ "…": "…" }' : placeholder}
          invalid={Boolean(error)}
          spellCheck={local.mode === "text"}
        />
      )}
    </Field>
  );
}

function tryParse(text: string): unknown {
  try {
    return text.trim() ? JSON.parse(text) : undefined;
  } catch {
    return undefined;
  }
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  size = "sm",
  className,
}: {
  options: { value: T; label: ReactNode; disabled?: boolean; title?: string }[];
  value: T;
  onChange: (v: T) => void;
  label: string;
  size?: "xs" | "sm";
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("inline-flex border-soft", className)}>
      {options.map((o, i) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          disabled={o.disabled}
          title={o.title}
          onClick={() => onChange(o.value)}
          className={cn(
            "font-mono lowercase transition-colors duration-(--dur-fast) disabled:opacity-40",
            size === "xs" ? "h-5 px-1.5 text-[10px]" : "h-7 px-2.5 text-[11px]",
            i > 0 && "border-soft-l",
            value === o.value ? "bg-ink text-paper" : "text-ink-3 hover:bg-surface-2 hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** A square switch with its label. */
export function Toggle({
  checked,
  onChange,
  children,
  hint,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="group/tg flex w-full items-start gap-2.5 py-0.5 text-left disabled:opacity-50"
    >
      <span
        aria-hidden
        className={cn(
          "relative mt-px inline-flex h-4 w-7 shrink-0 border-hard transition-colors duration-(--dur-fast)",
          checked ? "bg-accent" : "bg-surface-2",
        )}
      >
        <span
          className={cn(
            "absolute top-[1.5px] size-[10px] border-hard bg-paper transition-[left] duration-(--dur-fast) ease-snap",
            checked ? "left-[13px]" : "left-[1.5px]",
          )}
        />
      </span>
      <span className="min-w-0">
        <span className="block font-mono text-[11px] lowercase text-ink">{children}</span>
        {hint && <span className="block font-mono text-[10.5px] leading-relaxed text-ink-3">{hint}</span>}
      </span>
    </button>
  );
}

/** Slider + number box for thresholds and confidences. */
export function NumberSlider({
  value,
  onChange,
  min = 0,
  max = 1,
  step = 0.01,
  label,
  disabled,
  format = (v) => v.toFixed(2),
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  label: string;
  disabled?: boolean;
  format?: (v: number) => string;
}) {
  const [text, setText] = useState(format(value));
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setText(format(value));
  }
  const pct = ((value - min) / (max - min || 1)) * 100;
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        aria-label={label}
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        className="builder-range h-5 min-w-0 flex-1 disabled:opacity-40"
        style={{ ["--pct" as string]: `${pct}%` }}
      />
      <input
        type="text"
        inputMode="decimal"
        aria-label={`${label} value`}
        value={text}
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value.trim() !== "" && Number.isFinite(n) && n >= min && n <= max) onChange(n);
        }}
        onBlur={() => setText(format(value))}
        className={cn(inputBase, "h-6 w-14 shrink-0 border-line px-1.5 text-right tabular-nums")}
      />
    </div>
  );
}

/** Tiny square icon buttons for row actions (↑ ↓ ×). */
export function RowButton({ label, onClick, disabled, children, tone = "plain" }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode; tone?: "plain" | "danger" }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "grid size-6 shrink-0 place-items-center font-mono text-[12px] leading-none text-ink-3 transition-colors duration-(--dur-fast) disabled:opacity-30",
        tone === "danger" ? "hover:bg-fail-wash hover:text-fail" : "hover:bg-surface-2 hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

/** A dashed "+ add something" row. */
export function AddRow({ onClick, children, disabled }: { onClick: () => void; children: ReactNode; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-7 w-full items-center justify-center gap-1.5 border-(length:--bw) border-dashed border-ink-3 font-mono text-[11px] lowercase text-ink-2 transition-colors duration-(--dur-fast) hover:border-ink hover:bg-surface-2 hover:text-ink disabled:opacity-40"
    >
      <span aria-hidden>+</span> {children}
    </button>
  );
}

/** A titled block in the editor. */
export function Section({ title, aside, children, className }: { title: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("border-soft-b px-4 py-3", className)}>
      <div className="mb-2.5 flex min-h-5 items-center gap-2">
        <h3 className="font-mono text-[10px] tracking-[0.12em] text-ink-3 uppercase">{title}</h3>
        {aside && <div className="ml-auto flex items-center gap-1">{aside}</div>}
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
