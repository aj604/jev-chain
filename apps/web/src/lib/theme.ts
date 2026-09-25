/**
 * Theme preference: "light" | "dark" | "system", stored in localStorage and
 * mirrored to <html data-theme>. CSS does the rest via `color-scheme` +
 * `light-dark()`, so "system" tracks the OS without any JS listener.
 */
export type ThemePref = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "jevchain.theme";
export const THEME_CHANGE_EVENT = "jevchain:theme";
export const DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * Inlined into <head> before paint so the first frame is already themed.
 * Keep it tiny and dependency-free.
 */
export const themeInitScript = `(function(){try{var p=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(p!=="light"&&p!=="dark")p="system";document.documentElement.dataset.theme=p}catch(e){document.documentElement.dataset.theme="system"}})()`;

export const isPref = (v: unknown): v is ThemePref =>
  v === "light" || v === "dark" || v === "system";

export function readPref(): ThemePref {
  const attr = document.documentElement.dataset.theme;
  return isPref(attr) ? attr : "system";
}

export function readResolved(): ResolvedTheme {
  const pref = readPref();
  if (pref !== "system") return pref;
  return window.matchMedia(DARK_QUERY).matches ? "dark" : "light";
}

export function setThemePref(pref: ThemePref): void {
  document.documentElement.dataset.theme = pref;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    // ignore
  }
  window.dispatchEvent(new Event(THEME_CHANGE_EVENT));
}

/** Flip to the opposite of whatever is currently on screen. */
export function toggleTheme(): void {
  setThemePref(readResolved() === "dark" ? "light" : "dark");
}
