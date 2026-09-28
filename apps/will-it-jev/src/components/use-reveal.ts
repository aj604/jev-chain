"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * Reveal pacing for the circuit: rows come out at most one per `stepMs`, so
 * each gate can be read as the circuit fires. A live run that is slower than
 * the pace shows each row as it lands; one that is faster (or a finished
 * trace shown whole) is spaced out.
 *
 *   const shown = useReveal(rows.length);
 *   <Circuit rows={rows.slice(0, shown)} />
 *   const settled = done && shown === rows.length;
 *
 * The timing lives in `createRevealer`, a small store with no React in it,
 * so it can be tested with fake timers. The hook only wires it up.
 */

export const REVEAL_STEP_MS = 260;

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/** What the revealer has shown, and the total it was last aimed at. */
export interface RevealState {
  shown: number;
  total: number;
}

export interface Revealer {
  /** The current state. A new object on every change, so it works as a store snapshot. */
  get(): RevealState;
  subscribe(listener: () => void): () => void;
  /**
   * Aims at `total`.
   *
   * - `total` under the last total is a new run: back to 0, then paced again.
   * - Under reduced motion, everything is shown at once.
   * - Otherwise, when no step is waiting, one more row shows now and the
   *   rest follow one per `stepMs`. A step already waiting keeps its time,
   *   so rows arriving mid-step never hold the pacing back.
   */
  update(total: number, options: { stepMs: number; reduced: boolean }): void;
  /** Cancels a waiting step. The next `update` picks up from where it is. */
  stop(): void;
}

export function createRevealer(): Revealer {
  let state: RevealState = { shown: 0, total: 0 };
  let stepMs = REVEAL_STEP_MS;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const listeners = new Set<() => void>();

  const set = (next: RevealState) => {
    if (next.shown === state.shown && next.total === state.total) return;
    state = next;
    for (const listener of [...listeners]) listener();
  };
  const clear = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };
  /** Shows one more row if one is waiting, then holds the next for a step. */
  const step = () => {
    timer = null;
    if (state.shown >= state.total) return;
    set({ ...state, shown: state.shown + 1 });
    timer = setTimeout(step, stepMs);
  };

  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    update(total, options) {
      total = Math.max(0, Math.floor(total) || 0);
      stepMs = options.stepMs;
      if (total < state.total) {
        clear();
        set({ shown: 0, total });
      } else {
        set({ ...state, total });
      }
      if (options.reduced) {
        clear();
        set({ shown: total, total });
        return;
      }
      if (timer === null) step();
    },
    stop: clear,
  };
}

/**
 * The rows to show for `total`, from the revealer's last state. Pure, so the
 * render before the revealer hears of a new total is already right: a drop
 * (a new run) shows 0 rather than a flash of the old count.
 */
export function revealed(state: RevealState, total: number, reduced: boolean): number {
  if (reduced) return total;
  if (total < state.total) return 0;
  return Math.min(state.shown, total);
}

/** Whether the visitor asks for reduced motion. False with no `matchMedia` (the server). */
export function prefersReducedMotion(): boolean {
  try {
    return typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(REDUCED_MOTION).matches
      : false;
  } catch {
    return false;
  }
}

/** Calls `onChange` when the reduced-motion preference changes. */
export function subscribeReducedMotion(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

const noMotionPreference = () => false;

/**
 * How many of `total` rows to show: one more every `stepMs` until it catches
 * up, reset when `total` drops, and all of them at once under
 * `prefers-reduced-motion: reduce`.
 */
export function useReveal(total: number, stepMs: number = REVEAL_STEP_MS): number {
  const reduced = useSyncExternalStore(subscribeReducedMotion, prefersReducedMotion, noMotionPreference);
  const [revealer] = useState(createRevealer);
  const state = useSyncExternalStore(revealer.subscribe, revealer.get, revealer.get);

  useEffect(() => {
    revealer.update(total, { stepMs, reduced });
  }, [revealer, total, stepMs, reduced]);
  useEffect(() => () => revealer.stop(), [revealer]);

  return revealed(state, total, reduced);
}
