"use client";

import { useEffect, useId, useRef, useState } from "react";
import { toTypeScript, type ChainDocument } from "jevchain";
import { Button, type ButtonVariant } from "@/components/ui/button";
import { cn } from "@/lib/cn";

type Done = "json" | "ts" | "file" | "error" | null;

/** Export the chain on screen: JSON (toJSON), TypeScript (toTypeScript), or a file. */
export function ExportMenu({ doc, filename, variant = "ghost" }: { doc: () => ChainDocument; filename: string; variant?: ButtonVariant }) {
  const [open, setOpen] = useState(false);
  const [done, setDone] = useState<Done>(null);
  const ref = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  useEffect(() => {
    if (!done) return;
    const t = setTimeout(() => setDone(null), 1400);
    return () => clearTimeout(t);
  }, [done]);

  const copy = async (kind: "json" | "ts") => {
    try {
      const d = doc();
      await navigator.clipboard.writeText(kind === "json" ? JSON.stringify(d, null, 2) : toTypeScript(d));
      setDone(kind);
    } catch {
      setDone("error");
    }
    setOpen(false);
  };

  const download = () => {
    const blob = new Blob([JSON.stringify(doc(), null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename}.jevchain.json`;
    a.click();
    URL.revokeObjectURL(url);
    setDone("file");
    setOpen(false);
  };

  const item = "flex w-full items-center justify-between gap-6 px-3 py-2 text-left font-mono text-[11px] lowercase text-ink-2 hover:bg-surface-2 hover:text-ink";

  return (
    <div ref={ref} className="relative">
      <Button variant={variant} size="sm" aria-haspopup="menu" aria-expanded={open} aria-controls={menuId} onClick={() => setOpen((o) => !o)}>
        <span aria-live="polite">
          {done === "json" ? "json copied ✓" : done === "ts" ? "typescript copied ✓" : done === "file" ? "downloaded ✓" : done === "error" ? "clipboard blocked" : "export"}
        </span>
        <span aria-hidden className={cn("text-[9px] transition-transform duration-(--dur-fast)", open && "rotate-180")}>
          ▾
        </span>
      </Button>
      {open && (
        <div id={menuId} role="menu" className="fade-up absolute top-[calc(100%+4px)] right-0 z-30 w-52 border-hard bg-paper shadow-[4px_4px_0_0_var(--ink)]">
          <button type="button" role="menuitem" className={item} onClick={() => void copy("json")}>
            copy json <span className="text-ink-3">toJSON</span>
          </button>
          <button type="button" role="menuitem" className={cn(item, "border-soft-t")} onClick={() => void copy("ts")}>
            copy typescript <span className="text-ink-3">.ts</span>
          </button>
          <button type="button" role="menuitem" className={cn(item, "border-soft-t")} onClick={download}>
            download .json <span className="text-ink-3">↓</span>
          </button>
        </div>
      )}
    </div>
  );
}
