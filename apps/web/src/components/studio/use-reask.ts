"use client";

/**
 * useReask: ask Jev the same input again, `REASKS` more times, one after
 * another, and remember which run it was asking about (see `lib/trace/reask`).
 *
 *   const reask = useReask();
 *   await reask.start(node, trace, input);   // trace = the run being asked about; resolves with the final state
 *   reask.base, reask.rows, reask.phase, reask.stoppedBy
 *   reask.stop();  reask.reset();
 *
 * Always the real client: a rehearsal would answer the same every time.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { AnyNode, Json, Trace } from "jevchain";
import { reaskInputs } from "@/lib/trace/reask";
import type { RunIssue } from "@/lib/trace/run-error";
import { runSweep, type SweepRow } from "@/lib/trace/sweep";
import { browserClient, type RunPhase } from "@/components/trace/use-chain-run";

export interface ReaskState {
  phase: RunPhase;
  /** The run the re-asks are about. */
  base?: Trace;
  rows: SweepRow[];
  /** The issue that made it give up early (no key, rate limited…). */
  stoppedBy?: RunIssue;
}

export interface UseReask extends ReaskState {
  /** Resolves with how it ended, or undefined when a later start or reset took over. */
  start: (node: AnyNode, base: Trace, input: Json) => Promise<ReaskState | undefined>;
  stop: () => void;
  reset: () => void;
}

export function useReask(): UseReask {
  const [state, setState] = useState<ReaskState>({ phase: "idle", rows: [] });
  const controller = useRef<AbortController | null>(null);
  const seq = useRef(0);

  useEffect(() => () => controller.current?.abort(), []);

  const start = useCallback(async (node: AnyNode, base: Trace, input: Json) => {
    controller.current?.abort();
    const ac = new AbortController();
    controller.current = ac;
    const mine = ++seq.current;
    const alive = () => seq.current === mine;
    const inputs = reaskInputs(input);
    setState({ phase: "running", base, rows: inputs.map((i) => ({ ...i })) });
    try {
      const result = await runSweep(node, inputs, browserClient(), {
        signal: ac.signal,
        onRow: (i, row) => {
          if (alive()) setState((s) => ({ ...s, rows: s.rows.map((r, j) => (j === i ? row : r)) }));
        },
      });
      if (!alive()) return undefined;
      const done: ReaskState = { phase: "done", base, rows: result.rows, ...(result.stoppedBy ? { stoppedBy: result.stoppedBy } : {}) };
      setState(done);
      return done;
    } finally {
      if (controller.current === ac) controller.current = null;
    }
  }, []);

  const stop = useCallback(() => controller.current?.abort(new Error("stopped from the studio")), []);

  const reset = useCallback(() => {
    controller.current?.abort();
    seq.current++;
    setState({ phase: "idle", rows: [] });
  }, []);

  return { ...state, start, stop, reset };
}
