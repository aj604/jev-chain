"use client";

/**
 * useSweep: run one chain over a list of inputs, one after another, with the
 * rows filling in as each finishes (see `lib/trace/sweep`).
 *
 *   const sweep = useSweep();
 *   sweep.start(node, inputs, { rehearse });
 *   sweep.stop();  sweep.reset();
 *   sweep.rows, sweep.phase, sweep.stoppedBy, sweep.rehearsed
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { AnyNode } from "jevchain";
import { rehearsalClient } from "@/lib/trace/rehearsal";
import type { RunIssue } from "@/lib/trace/run-error";
import { runSweep, type SweepInput, type SweepRow } from "@/lib/trace/sweep";
import { browserClient, type RunPhase } from "@/components/trace/use-chain-run";

export interface SweepState {
  phase: RunPhase;
  rows: SweepRow[];
  /** The issue that made the sweep give up early (no key, rate limited…). */
  stoppedBy?: RunIssue;
  /** Answered by the rehearsal client, not Jev. */
  rehearsed: boolean;
}

export interface UseSweep extends SweepState {
  start: (node: AnyNode, inputs: readonly SweepInput[], options?: { rehearse?: boolean }) => Promise<void>;
  stop: () => void;
  reset: () => void;
}

export function useSweep(): UseSweep {
  const [state, setState] = useState<SweepState>({ phase: "idle", rows: [], rehearsed: false });
  const controller = useRef<AbortController | null>(null);
  const seq = useRef(0);

  useEffect(() => () => controller.current?.abort(), []);

  const start = useCallback(async (node: AnyNode, inputs: readonly SweepInput[], options: { rehearse?: boolean } = {}) => {
    controller.current?.abort();
    const ac = new AbortController();
    controller.current = ac;
    const mine = ++seq.current;
    const alive = () => seq.current === mine;
    const rehearsed = Boolean(options.rehearse);
    setState({ phase: "running", rows: inputs.map((i) => ({ ...i })), rehearsed });
    try {
      const result = await runSweep(node, inputs, rehearsed ? rehearsalClient() : browserClient(), {
        signal: ac.signal,
        onRow: (i, row) => {
          if (alive()) setState((s) => ({ ...s, rows: s.rows.map((r, j) => (j === i ? row : r)) }));
        },
      });
      if (alive()) setState({ phase: "done", rows: result.rows, rehearsed, ...(result.stoppedBy ? { stoppedBy: result.stoppedBy } : {}) });
    } finally {
      if (controller.current === ac) controller.current = null;
    }
  }, []);

  const stop = useCallback(() => controller.current?.abort(new Error("stopped from the studio")), []);

  const reset = useCallback(() => {
    controller.current?.abort();
    seq.current++;
    setState({ phase: "idle", rows: [], rehearsed: false });
  }, []);

  return { ...state, start, stop, reset };
}
