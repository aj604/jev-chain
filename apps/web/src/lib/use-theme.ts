"use client";

import { useSyncExternalStore } from "react";
import {
  DARK_QUERY,
  THEME_CHANGE_EVENT,
  THEME_STORAGE_KEY,
  isPref,
  readPref,
  readResolved,
  setThemePref,
  toggleTheme,
  type ResolvedTheme,
  type ThemePref,
} from "./theme";

function subscribe(onChange: () => void) {
  const mq = window.matchMedia(DARK_QUERY);
  const onStorage = (e: StorageEvent) => {
    if (e.key !== THEME_STORAGE_KEY) return;
    document.documentElement.dataset.theme = isPref(e.newValue) ? e.newValue : "system";
    onChange();
  };
  window.addEventListener(THEME_CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  mq.addEventListener("change", onChange);
  return () => {
    window.removeEventListener(THEME_CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
    mq.removeEventListener("change", onChange);
  };
}

export function useTheme(): {
  pref: ThemePref;
  resolved: ResolvedTheme;
  setPref: (pref: ThemePref) => void;
  toggle: () => void;
} {
  const pref = useSyncExternalStore(subscribe, readPref, () => "system" as const);
  const resolved = useSyncExternalStore(subscribe, readResolved, () => "light" as const);
  return { pref, resolved, setPref: setThemePref, toggle: toggleTheme };
}
