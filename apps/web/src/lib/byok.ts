/**
 * Bring-your-own-key. The key lives in this browser's localStorage and is sent
 * only to our own `/api/jev` proxy (as the `x-typesafe-key` header), which
 * forwards it to TypeSafe and never stores it.
 */
export const BYOK_STORAGE_KEY = "jevchain.byok";
export const BYOK_HEADER = "x-typesafe-key";
export const BYOK_CHANGE_EVENT = "jevchain:byok";

export function getByok(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(BYOK_STORAGE_KEY) || null;
  } catch {
    return null;
  }
}

export function setByok(key: string | null): void {
  const value = key?.trim() || null;
  try {
    if (value) window.localStorage.setItem(BYOK_STORAGE_KEY, value);
    else window.localStorage.removeItem(BYOK_STORAGE_KEY);
  } catch {
    // storage blocked (private mode etc.) — nothing sensible to do
  }
  window.dispatchEvent(new Event(BYOK_CHANGE_EVENT));
}

/** Headers to send to `/api/jev`, including the BYOK key when one is set. */
export function jevHeaders(init?: HeadersInit): Headers {
  const headers = new Headers(init);
  headers.set("content-type", "application/json");
  const key = getByok();
  if (key) headers.set(BYOK_HEADER, key);
  return headers;
}

/** Show enough of a key to recognise it, never enough to use it. */
export function maskKey(key: string): string {
  if (key.length <= 10) return "•".repeat(key.length);
  return `${key.slice(0, 4)}…${key.slice(-4)}`;
}
