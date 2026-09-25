"use client";

/**
 * Recent runs, kept in this browser. Every finished run lands here so you can
 * flip back to it, compare, or share it later. Capped so localStorage stays
 * well under quota even with chatty traces.
 */
import { useSyncExternalStore } from "react";
import type { Json, Trace } from "jevchain";
import type { ChainSource } from "./chain-source";

export interface SavedRun {
  id: string;
  savedAt: string;
  source: ChainSource;
  chainTitle: string;
  input: Json;
  trace: Trace;
}

export const SAVED_RUNS_KEY = "jevchain.studio.runs";
const CHANGE_EVENT = "jevchain:runs";
export const MAX_SAVED_RUNS = 25;

let cache: { raw: string | null; runs: SavedRun[] } = { raw: null, runs: [] };
const EMPTY: SavedRun[] = [];

function read(): SavedRun[] {
  if (typeof window === "undefined") return EMPTY;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(SAVED_RUNS_KEY);
  } catch {
    return EMPTY;
  }
  if (raw === cache.raw) return cache.runs;
  let runs: SavedRun[] = [];
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    runs = Array.isArray(parsed) ? (parsed as SavedRun[]).filter((r) => r && typeof r.id === "string" && r.trace) : [];
  } catch {
    runs = [];
  }
  cache = { raw, runs };
  return runs;
}

function write(runs: SavedRun[]) {
  let list = runs.slice(0, MAX_SAVED_RUNS);
  // If we hit the quota, drop the oldest until it fits.
  for (;;) {
    try {
      window.localStorage.setItem(SAVED_RUNS_KEY, JSON.stringify(list));
      break;
    } catch {
      if (list.length <= 1) break;
      list = list.slice(0, -1);
    }
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function saveRun(run: Omit<SavedRun, "id" | "savedAt">): SavedRun {
  const saved: SavedRun = { ...run, id: run.trace.runId || `run_${Date.now().toString(36)}`, savedAt: new Date().toISOString() };
  write([saved, ...read().filter((r) => r.id !== saved.id)]);
  return saved;
}

export function deleteRun(id: string) {
  write(read().filter((r) => r.id !== id));
}

export function clearRuns() {
  write([]);
}

function subscribe(onChange: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === SAVED_RUNS_KEY) onChange();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function useSavedRuns(): SavedRun[] {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}
