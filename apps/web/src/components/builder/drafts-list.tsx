"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { fmtAgo } from "@/lib/trace/format";
import { useDrafts, type Draft } from "@/lib/builder/drafts";
import { useMinuteNow } from "@/components/studio/saved-runs-list";

/** Autosaved builder drafts: open, rename in place, delete (via the caller's confirm). */
export function DraftsList({
  activeId,
  onOpen,
  onRename,
  onDelete,
}: {
  activeId?: string;
  onOpen: (d: Draft) => void;
  onRename: (d: Draft, name: string) => void;
  onDelete: (d: Draft) => void;
}) {
  const drafts = useDrafts();
  const now = useMinuteNow();
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null);

  if (drafts.length === 0) {
    return <p className="px-3 pb-3 text-[12px] leading-relaxed text-ink-3">edits autosave here, in this browser only. nothing yet.</p>;
  }
  const commit = () => {
    if (!editing) return;
    const d = drafts.find((x) => x.id === editing.id);
    if (d && editing.text.trim() && editing.text.trim() !== d.name) onRename(d, editing.text.trim());
    setEditing(null);
  };

  return (
    <ul className="pb-2">
      {drafts.map((d) => {
        const active = d.id === activeId;
        return (
          <li key={d.id} className={cn("group/draft relative flex items-stretch", active ? "bg-accent-wash" : "hover:bg-surface-2")}>
            {active && <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-accent" />}
            {editing?.id === d.id ? (
              <form
                className="min-w-0 flex-1 px-3 py-1.5"
                onSubmit={(e) => {
                  e.preventDefault();
                  commit();
                }}
              >
                <input
                  autoFocus
                  aria-label="draft name"
                  value={editing.text}
                  onChange={(e) => setEditing({ id: d.id, text: e.target.value })}
                  onBlur={commit}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") {
                      e.stopPropagation();
                      setEditing(null);
                    }
                  }}
                  className="block h-6 w-full border-hard bg-surface px-1.5 font-mono text-[12px] text-ink outline-none"
                />
              </form>
            ) : (
              <button type="button" onClick={() => onOpen(d)} className="min-w-0 flex-1 px-3 py-1.5 text-left" aria-current={active ? "true" : undefined}>
                <span className="block truncate text-[12.5px] leading-5 text-ink">{d.name}</span>
                <span className="flex items-center gap-1.5 font-mono text-[10px] text-ink-3">
                  <span className="truncate">{d.forkedFrom ? `fork of ${d.forkedFrom}` : "from scratch"}</span>
                  <span className="ml-auto shrink-0 tabular-nums">{now ? fmtAgo(new Date(d.updatedAt).toISOString(), now) : ""}</span>
                </span>
              </button>
            )}
            {editing?.id !== d.id && (
              <span className="flex shrink-0 items-center opacity-0 transition-opacity duration-(--dur-fast) group-hover/draft:opacity-100 group-focus-within/draft:opacity-100">
                <button
                  type="button"
                  onClick={() => setEditing({ id: d.id, text: d.name })}
                  aria-label={`rename ${d.name}`}
                  className="grid h-full w-6 place-items-center font-mono text-[11px] text-ink-3 hover:text-ink"
                >
                  ✎
                </button>
                <button type="button" onClick={() => onDelete(d)} aria-label={`delete ${d.name}`} className="grid h-full w-7 place-items-center text-ink-3 hover:text-fail">
                  <svg viewBox="0 0 12 12" className="size-2.5" aria-hidden>
                    <path d="M1.5 1.5l9 9M10.5 1.5l-9 9" stroke="currentColor" strokeWidth="1.2" />
                  </svg>
                </button>
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}
