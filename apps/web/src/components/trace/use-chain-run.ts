"use client";

/**
 * useChainRun: owns one run of one chain. Start, stop, and a live trace that
 * updates on every event (folded with the runtime's own `reduceTrace`, so the
 * live trace and the final one are the same object).
 *
 *   const run = useChainRun({ onFinish: (trace, input) => save(trace) });
 *   run.start(chain, input);   // resolves with the final trace
 *   run.stop();                // aborts; trace ends "aborted"
 *   run.trace, run.status, run.issue
 *   run.show(trace, input);    // display a saved trace without running
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { createJev, reduceTrace, type AnyNode, type Json, type Trace } from "jevchain";
import { BYOK_HEADER, getByok } from "@/lib/byok";
import { configIssues } from "@/lib/trace/chain-source";
import { traceIssue, type RunIssue } from "@/lib/trace/run-error";

export type RunPhase = "idle" | "running" | "done";

export interface ChainRunState {
  phase: RunPhase;
  trace?: Trace;
  input?: Json;
  issue: RunIssue | null;
  /** performance.now() at run start, for live elapsed time. */
  startedAtPerf?: number;
}

export interface UseChainRun extends ChainRunState {
  start: (node: AnyNode, input: Json) => Promise<Trace | undefined>;
  stop: () => void;
  reset: () => void;
  show: (trace: Trace, input: Json) => void;
}

/** The browser-side Jev: everything goes through our proxy, BYOK header if set. */
export function browserJev() {
  const key = getByok();
  return createJev({ apiKey: null, baseURL: "/api/jev", path: "", ...(key ? { headers: { [BYOK_HEADER]: key } } : {}) });
}

export function useChainRun(options: { onFinish?: (trace: Trace, input: Json) => void } = {}): UseChainRun {
  const [state, setState] = useState<ChainRunState>({ phase: "idle", issue: null });
  const controller = useRef<AbortController | null>(null);
  const seq = useRef(0);
  const onFinish = useRef(options.onFinish);
  useEffect(() => {
    onFinish.current = options.onFinish;
  });

  // Abort in-flight work if the component goes away.
  useEffect(() => () => controller.current?.abort(), []);

  const start = useCallback(async (node: AnyNode, input: Json) => {
    controller.current?.abort();
    const ac = new AbortController();
    controller.current = ac;
    const mine = ++seq.current;
    const alive = () => seq.current === mine;
    setState({ phase: "running", input, issue: null, startedAtPerf: performance.now() });

    try {
      const result = await browserJev().run(node, input, {
        signal: ac.signal,
        onEvent: (event) => {
          if (!alive()) return;
          setState((s) => ({
            ...s,
            trace: reduceTrace(event.type === "run:start" ? undefined : s.trace, event),
            ...(event.type === "run:start" ? { startedAtPerf: performance.now() } : {}),
          }));
        },
      });
      if (!alive()) return result.trace;
      setState((s) => ({ ...s, phase: "done", trace: result.trace, issue: traceIssue(result.trace, result.error) }));
      onFinish.current?.(result.trace, input);
      return result.trace;
    } catch (e) {
      // run() only throws for an invalid chain.
      if (alive()) {
        setState({
          phase: "done",
          input,
          issue: { kind: "config", title: "this chain doesn't hold together", detail: configIssues(e).join("\n") },
        });
      }
      return undefined;
    } finally {
      if (controller.current === ac) controller.current = null;
    }
  }, []);

  const stop = useCallback(() => controller.current?.abort(new Error("stopped from the studio")), []);

  const reset = useCallback(() => {
    controller.current?.abort();
    seq.current++;
    setState({ phase: "idle", issue: null });
  }, []);

  const show = useCallback((trace: Trace, input: Json) => {
    controller.current?.abort();
    seq.current++;
    setState({ phase: "done", trace, input, issue: traceIssue(trace) });
  }, []);

  return { ...state, start, stop, reset, show };
}

/**
 * Milliseconds since `startedAtPerf`, ticking on animation frames while
 * `running`. Returns `fallback` when not running.
 */
export function useRunClock(running: boolean, startedAtPerf: number | undefined, fallback: number | undefined): number | undefined {
  const [now, setNow] = useState<number | undefined>(undefined);
  useEffect(() => {
    if (!running || startedAtPerf === undefined) return;
    let raf = 0;
    let last = 0;
    const tick = (t: number) => {
      if (t - last > 33) {
        last = t;
        setNow(performance.now() - startedAtPerf);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running, startedAtPerf]);
  return running ? (now ?? 0) : fallback;
}
