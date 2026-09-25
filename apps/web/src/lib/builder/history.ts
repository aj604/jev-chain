/**
 * Undo/redo as a stack of values (the builder keeps whole documents; doc-ops
 * never mutate, so each entry shares every untouched subtree with its
 * neighbours and costs almost nothing).
 *
 * Typing into a field would otherwise push one entry per keystroke, so commits
 * can carry a `key`: consecutive commits with the same key inside `windowMs`
 * replace the present instead of pushing. One word typed = one undo step.
 */

export interface History<T> {
  past: T[];
  present: T;
  future: T[];
  /** Coalescing state for the last commit. */
  last?: { key: string; at: number };
}

export type HistoryAction<T> =
  | { type: "commit"; value: T; key?: string; at?: number }
  | { type: "undo" }
  | { type: "redo" }
  | { type: "reset"; value: T };

export const HISTORY_LIMIT = 200;
export const COALESCE_MS = 1200;

export function initHistory<T>(value: T): History<T> {
  return { past: [], present: value, future: [] };
}

export function historyReducer<T>(state: History<T>, action: HistoryAction<T>): History<T> {
  switch (action.type) {
    case "commit": {
      if (Object.is(action.value, state.present)) return state;
      const at = action.at ?? Date.now();
      const coalesce = action.key !== undefined && state.last?.key === action.key && at - state.last.at <= COALESCE_MS && state.past.length > 0;
      const past = coalesce ? state.past : [...state.past, state.present].slice(-HISTORY_LIMIT);
      return { past, present: action.value, future: [], ...(action.key !== undefined ? { last: { key: action.key, at } } : {}) };
    }
    case "undo": {
      if (!state.past.length) return state;
      const prev = state.past[state.past.length - 1]!;
      return { past: state.past.slice(0, -1), present: prev, future: [state.present, ...state.future] };
    }
    case "redo": {
      if (!state.future.length) return state;
      const [next, ...rest] = state.future;
      return { past: [...state.past, state.present], present: next!, future: rest };
    }
    case "reset":
      return initHistory(action.value);
  }
}
