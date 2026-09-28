import { reduceTrace, type Jev, type RunResult, type Trace } from "jevchain";
import { COPY } from "./copy";
import { compileRecipe } from "./recipe/compile";
import type { Recipe } from "./recipe/types";
import { resultOf, type Result } from "./recipe/result";

/** Why a run gave no result, for the page's plain message. */
export type RunFailure = "rate-limited" | "paused" | "no-answer";

export interface RecipeRun {
  run: RunResult<unknown>;
  /** Null unless the run finished `"ok"` at one of the recipe's leaves. */
  result: Result | null;
  /** Null for a successful or aborted run. */
  failure: RunFailure | null;
}

/** The deadline for a whole run. It ends with `status: "error"`, which reads as `"no-answer"`. */
export const RUN_TIMEOUT_MS = 60_000;

/**
 * Runs `recipe` on `input` and reports the trace as it grows.
 *
 * `input` is the Jev state exactly as given. Compiled nodes have no state
 * template, so text that looks like one (`{{input}}`) goes to Jev as plain
 * text. Every event is folded with `reduceTrace` and the new trace goes to
 * `onTrace`. The last one is `run.trace` itself.
 *
 * A failed, halted, timed-out or aborted run resolves too, with a null
 * result; `run.status` and `failure` say why. It only throws when the
 * recipe doesn't compile to a valid chain, so validate untrusted recipes
 * first, or when `onTrace` throws (which also stops the run).
 */
export async function runRecipe(
  jev: Pick<Jev, "stream">,
  recipe: Recipe,
  input: string,
  opts: { onTrace?: (t: Trace) => void; signal?: AbortSignal } = {},
): Promise<RecipeRun> {
  // jevchain ORs the deadline with the signal: the deadline fails the run
  // ("error"), the signal aborts it ("aborted").
  const s = jev.stream(compileRecipe(recipe), input, {
    timeoutMs: RUN_TIMEOUT_MS,
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  let trace: Trace | undefined;
  for await (const event of s) {
    trace = reduceTrace(trace, event);
    opts.onTrace?.(trace);
  }
  const run = await s.result;
  return { run, result: resultOf(recipe, run), failure: runFailure(run) };
}

/**
 * Why a run failed, for the page's message.
 *
 * - `"paused"`: the proxy's pause switch. Seen as the proxy's body
 *   (`{ error: { type: "paused" } }`) on any error in the live error's
 *   cause chain, or as its paused line in any error message there or in the
 *   trace's serialized error.
 * - `"rate-limited"`: HTTP 429 anywhere in the same places.
 * - `"no-answer"`: any other error, and a halt.
 * - null: ok, aborted, or still running.
 */
export function runFailure(result: { status: string; error?: unknown; trace?: unknown }): RunFailure | null {
  if (result.status === "halted") return "no-answer";
  if (result.status !== "error") return null;
  const errors = [...causes(result.error)];
  const traced = isRecord(result.trace) ? result.trace.error : undefined;
  if (isRecord(traced)) errors.push(traced);
  if (errors.some(isPaused)) return "paused";
  if (errors.some((e) => e.status === 429)) return "rate-limited";
  return "no-answer";
}

function isPaused(e: Record<string, unknown>): boolean {
  if (typeof e.message === "string" && e.message.includes(COPY.paused)) return true;
  const body = e.body;
  if (!isRecord(body) || !isRecord(body.error)) return false;
  return body.error.type === "paused" || body.error.message === COPY.paused;
}

/** `error` and its causes, outermost first. Stops at a cycle or after a few links. */
function causes(error: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  let e: unknown = error;
  while (isRecord(e) && !out.includes(e) && out.length < 8) {
    out.push(e);
    e = e.cause;
  }
  return out;
}

/** Objects, Error instances included. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
