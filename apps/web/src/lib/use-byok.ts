"use client";

import { useSyncExternalStore } from "react";
import { BYOK_CHANGE_EVENT, BYOK_STORAGE_KEY, getByok } from "./byok";

function subscribe(onChange: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === BYOK_STORAGE_KEY) onChange();
  };
  window.addEventListener(BYOK_CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(BYOK_CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

/** Reactive BYOK key (null on the server and when unset). Syncs across tabs. */
export function useByok(): string | null {
  return useSyncExternalStore(subscribe, getByok, () => null);
}
