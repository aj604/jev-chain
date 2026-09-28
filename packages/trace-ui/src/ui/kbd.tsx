"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { cn } from "./cn";

// A trimmed copy of the studio's hotkey labels: only what a keycap needs to render.
const MAC_GLYPHS = { mod: "⌘", ctrl: "⌃", meta: "⌘", alt: "⌥", shift: "⇧" };
const PC_LABELS = { mod: "ctrl", ctrl: "ctrl", meta: "win", alt: "alt", shift: "shift" };
const KEY_ALIASES: Record<string, string> = { esc: "escape", return: "enter", space: " ", del: "delete", plus: "+" };
const KEY_LABELS: Record<string, string> = {
  enter: "↵",
  escape: "esc",
  " ": "space",
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  backspace: "⌫",
  delete: "del",
  tab: "tab",
};

/** Human labels for each step, e.g. "mod+enter" → [["⌘", "↵"]]. */
export function formatCombo(combo: string, isMac: boolean): string[][] {
  const labels = isMac ? MAC_GLYPHS : PC_LABELS;
  return combo
    .trim()
    .split(/\s+/)
    .map((chunk) => {
      const parts = chunk === "+" ? ["+"] : chunk.toLowerCase().split("+");
      const mods: string[] = [];
      let key = "";
      const flags = { ctrl: false, alt: false, shift: false, mod: false, meta: false };
      for (const part of parts) {
        if (part === "mod") flags.mod = true;
        else if (part === "ctrl" || part === "control") flags.ctrl = true;
        else if (part === "meta" || part === "cmd" || part === "command") flags.meta = true;
        else if (part === "alt" || part === "option" || part === "opt") flags.alt = true;
        else if (part === "shift") flags.shift = true;
        else key = KEY_ALIASES[part] ?? part;
      }
      if (flags.ctrl) mods.push(labels.ctrl);
      if (flags.alt) mods.push(labels.alt);
      if (flags.shift) mods.push(labels.shift);
      if (flags.mod) mods.push(labels.mod);
      if (flags.meta) mods.push(labels.meta);
      return [...mods, KEY_LABELS[key] ?? key];
    });
}

function detectMac(): boolean {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform ?? nav.platform ?? "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}
const noopSubscribe = () => () => {};

/** false during SSR, then the real answer. */
function useIsMac(): boolean {
  return useSyncExternalStore(noopSubscribe, detectMac, () => false);
}

/** A single keycap. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center border-soft bg-surface-2 px-1 font-mono text-[11px] leading-none text-ink-2 shadow-[0_1px_0_0_var(--line-soft)]",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/** Renders a combo string ("mod+enter", "g s") as platform-correct keycaps. */
export function KbdCombo({ combo, className }: { combo: string; className?: string }) {
  const isMac = useIsMac();
  const steps = formatCombo(combo, isMac);
  return (
    <span className={cn("inline-flex items-center gap-1", className)} aria-label={combo}>
      {steps.map((keys, i) => (
        <span key={i} className="inline-flex items-center gap-0.5">
          {i > 0 && <span className="px-0.5 font-mono text-[10px] text-ink-3">then</span>}
          {keys.map((k, j) => (
            <Kbd key={j}>{k}</Kbd>
          ))}
        </span>
      ))}
    </span>
  );
}
