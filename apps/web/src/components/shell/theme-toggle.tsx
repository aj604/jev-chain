"use client";

import type { ThemePref } from "@/lib/theme";
import { useTheme } from "@/lib/use-theme";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";

const NEXT: Record<ThemePref, ThemePref> = { system: "light", light: "dark", dark: "system" };

/** Cycles system → light → dark. `t` flips light/dark directly. */
export function ThemeToggle() {
  const { pref, setPref } = useTheme();
  const label = `theme: ${pref} (click for ${NEXT[pref]})`;
  return (
    <Tooltip label={`theme: ${pref} · t`}>
      <Button variant="ghost" size="icon" aria-label={label} onClick={() => setPref(NEXT[pref])}>
        <ThemeIcon pref={pref} />
      </Button>
    </Tooltip>
  );
}

function ThemeIcon({ pref }: { pref: ThemePref }) {
  const common = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.2, "aria-hidden": true } as const;
  if (pref === "light")
    return (
      <svg {...common}>
        <circle cx="8" cy="8" r="3" />
        <path d="M8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1" />
      </svg>
    );
  if (pref === "dark")
    return (
      <svg {...common}>
        <path d="M13.5 9.6A5.8 5.8 0 0 1 6.4 2.5a5.8 5.8 0 1 0 7.1 7.1Z" />
      </svg>
    );
  return (
    <svg {...common}>
      <rect x="1.6" y="2.6" width="12.8" height="8.8" />
      <path d="M5.5 13.9h5M8 11.4v2.5" />
      <path d="M1.6 2.6h12.8v8.8H8Z" fill="currentColor" stroke="none" />
    </svg>
  );
}
