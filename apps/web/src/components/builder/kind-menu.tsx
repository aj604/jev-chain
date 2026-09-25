"use client";

/**
 * Picking a node kind: a popover list (toolbar), a grid (empty slots) and the
 * canvas right-click menu. Every kind has a one-letter key while a menu is
 * open; the menu swallows keys so global hotkeys don't fire underneath.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { KIND_GLYPH } from "@/components/trace/kinds";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/cn";
import type { BuilderKind } from "@/lib/builder/doc-ops";

export const KINDS: { kind: BuilderKind; key: string; blurb: string }[] = [
  { kind: "ask", key: "a", blurb: "ask jev things, get probabilities" },
  { kind: "route", key: "r", blurb: "pick a lane; every label gets a branch" },
  { kind: "gate", key: "g", blurb: "only the worthy pass" },
  { kind: "parallel", key: "p", blurb: "several at once, then collect" },
  { kind: "cascade", key: "c", blurb: "cheap first, escalate when unsure" },
  { kind: "step", key: "s", blurb: "your code goes here" },
  { kind: "emit", key: "e", blurb: "say a fixed thing. great leaf" },
];

/** Swallow keys while a menu is open: letters pick, escape closes. */
function useMenuKeys(onPick: ((k: BuilderKind) => void) | null, onClose: () => void, extra?: (key: string) => boolean) {
  const pick = useRef(onPick);
  const close = useRef(onClose);
  const more = useRef(extra);
  useEffect(() => {
    pick.current = onPick;
    close.current = onClose;
    more.current = extra;
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === "escape") {
        e.preventDefault();
        e.stopPropagation();
        close.current();
        return;
      }
      if (more.current?.(key)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      const hit = pick.current && KINDS.find((k) => k.key === key);
      if (hit) {
        e.preventDefault();
        e.stopPropagation();
        pick.current!(hit.kind);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
}

function useOutside(ref: React.RefObject<HTMLElement | null>, onClose: () => void) {
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) close.current();
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [ref]);
}

function KindList({ onPick, current, title }: { onPick: (k: BuilderKind) => void; current?: BuilderKind; title: string }) {
  return (
    <div role="menu" aria-label={title}>
      <div className="border-soft-b px-3 py-1.5 font-mono text-[10px] tracking-[0.12em] text-ink-3 uppercase">{title}</div>
      {KINDS.map(({ kind, key, blurb }) => (
        <button
          key={kind}
          type="button"
          role="menuitem"
          disabled={kind === current}
          onClick={() => onPick(kind)}
          className="group/k flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors duration-(--dur-fast) hover:bg-accent-wash disabled:opacity-40"
        >
          <span aria-hidden className="grid size-5 shrink-0 place-items-center border-soft bg-surface-2 font-mono text-[11px] text-ink-2 group-hover/k:border-hard group-hover/k:bg-accent group-hover/k:text-accent-ink">
            {KIND_GLYPH[kind]}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-mono text-[11.5px] leading-4 text-ink">{kind}</span>
            <span className="block truncate text-[11px] leading-4 text-ink-3">{blurb}</span>
          </span>
          <Kbd className="shrink-0">{key}</Kbd>
        </button>
      ))}
    </div>
  );
}

/** A dropdown kind picker under a trigger. */
export function KindMenu({ title, onPick, onClose, current, className }: { title: string; onPick: (k: BuilderKind) => void; onClose: () => void; current?: BuilderKind; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useMenuKeys(
    (k) => {
      if (k !== current) onPick(k);
    },
    onClose,
  );
  useOutside(ref, onClose);
  return (
    <div ref={ref} className={cn("fade-up absolute top-[calc(100%+4px)] left-0 z-40 w-64 border-hard bg-paper shadow-[4px_4px_0_0_var(--ink)]", className)}>
      <KindList title={title} onPick={onPick} current={current} />
    </div>
  );
}

/** Big buttons for an empty slot: "what goes here?" */
export function KindGrid({ onPick }: { onPick: (k: BuilderKind) => void }) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {KINDS.map(({ kind, blurb }) => (
        <button
          key={kind}
          type="button"
          onClick={() => onPick(kind)}
          className="group/g flex items-start gap-2 border-soft bg-surface px-2 py-2 text-left transition-[transform,box-shadow,border-color] duration-(--dur-fast) ease-snap hover:-translate-x-px hover:-translate-y-px hover:border-(--line) hover:shadow-[2px_2px_0_0_var(--accent)]"
        >
          <span aria-hidden className="grid size-5 shrink-0 place-items-center border-soft bg-surface-2 font-mono text-[11px] text-ink-2 group-hover/g:border-hard group-hover/g:bg-accent group-hover/g:text-accent-ink">
            {KIND_GLYPH[kind]}
          </span>
          <span className="min-w-0">
            <span className="block font-mono text-[11.5px] leading-4 text-ink">{kind}</span>
            <span className="block text-[10.5px] leading-[1.35] text-ink-3">{blurb}</span>
          </span>
        </button>
      ))}
    </div>
  );
}

export interface ContextAction {
  label: string;
  hint?: string;
  onSelect: () => void;
  disabled?: boolean;
  danger?: boolean;
}

/** The canvas right-click menu, fixed at the pointer and kept on screen. */
export function ContextMenu({
  at,
  title,
  kind,
  onAdd,
  onChangeKind,
  actions,
  onClose,
}: {
  at: { x: number; y: number };
  title: ReactNode;
  kind?: BuilderKind;
  onAdd: (k: BuilderKind) => void;
  onChangeKind: (k: BuilderKind) => void;
  actions: ContextAction[];
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [sub, setSub] = useState<"add" | "kind" | null>(null);
  const [pos, setPos] = useState(at);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = Math.min(at.x, window.innerWidth - r.width - 8);
    const y = Math.min(at.y, window.innerHeight - r.height - 8);
    setPos((p) => (p.x === x && p.y === y ? p : { x: Math.max(8, x), y: Math.max(8, y) }));
  }, [at, sub]);
  useMenuKeys(
    sub
      ? (k) => {
          if (sub === "add") onAdd(k);
          else if (k !== kind) onChangeKind(k);
        }
      : null,
    () => (sub ? setSub(null) : onClose()),
    (key) => {
      if (sub) return false;
      if (key === "n") setSub("add");
      else if (key === "k") setSub("kind");
      else return false;
      return true;
    },
  );
  useOutside(ref, onClose);

  const item = "flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left font-mono text-[11.5px] lowercase transition-colors duration-(--dur-fast) disabled:opacity-40";
  return (
    <div ref={ref} role="menu" style={{ left: pos.x, top: pos.y }} className="fade-up fixed z-50 w-64 border-hard bg-paper shadow-[4px_4px_0_0_var(--ink)]" onContextMenu={(e) => e.preventDefault()}>
      {sub ? (
        <>
          <button type="button" onClick={() => setSub(null)} className="flex w-full items-center gap-1.5 border-soft-b px-3 py-1.5 font-mono text-[10.5px] text-ink-3 hover:text-ink">
            ← back
          </button>
          <KindList title={sub === "add" ? "add after" : "change kind to"} onPick={sub === "add" ? onAdd : onChangeKind} current={sub === "kind" ? kind : undefined} />
        </>
      ) : (
        <>
          <div className="truncate border-soft-b px-3 py-1.5 font-mono text-[10.5px] text-ink-3">{title}</div>
          <button type="button" role="menuitem" className={cn(item, "text-ink hover:bg-surface-2")} onClick={() => setSub("add")}>
            add node after <span className="flex items-center gap-1.5 text-ink-3"><Kbd>n</Kbd>▸</span>
          </button>
          <button type="button" role="menuitem" className={cn(item, "text-ink hover:bg-surface-2")} onClick={() => setSub("kind")}>
            change kind <span className="flex items-center gap-1.5 text-ink-3"><Kbd>k</Kbd>▸</span>
          </button>
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              role="menuitem"
              disabled={a.disabled}
              onClick={() => {
                a.onSelect();
                onClose();
              }}
              className={cn(item, "border-soft-t", a.danger ? "text-fail hover:bg-fail-wash" : "text-ink hover:bg-surface-2")}
            >
              {a.label}
              {a.hint && <Kbd>{a.hint}</Kbd>}
            </button>
          ))}
        </>
      )}
    </div>
  );
}
