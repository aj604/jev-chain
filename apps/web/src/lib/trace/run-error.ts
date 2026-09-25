/**
 * Turn a failed run into something a person can act on. Works from the live
 * error when we have it (it carries `retryAfterMs`), and from the serialized
 * trace error otherwise (saved runs, share links).
 */
import type { SerializedError, Trace } from "jevchain";

export type RunIssueKind = "missing-key" | "bad-key" | "rate-limited" | "invalid" | "network" | "timeout" | "config" | "aborted" | "halted" | "failed";

export interface RunIssue {
  kind: RunIssueKind;
  title: string;
  detail: string;
  /** Node that failed, when known. */
  nodeId?: string;
  retryAfterMs?: number;
  /** Suggested fix the UI can wire to a button. */
  action?: "add-key" | "retry";
}

/** Walk `cause` chains looking for the first error with a property. */
function findInCauses<T>(err: unknown, pick: (e: Record<string, unknown>) => T | undefined): T | undefined {
  let cur: unknown = err;
  for (let i = 0; i < 6 && cur && typeof cur === "object"; i++) {
    const v = pick(cur as Record<string, unknown>);
    if (v !== undefined) return v;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}

export function retryAfterFrom(err: unknown, message?: string): number | undefined {
  const live = findInCauses(err, (e) => (typeof e.retryAfterMs === "number" ? e.retryAfterMs : undefined));
  if (live !== undefined) return live;
  const m = /retry after (\d+)\s*ms/i.exec(message ?? "") ?? /try again in (\d+)s/i.exec(message ?? "");
  if (!m) return undefined;
  return /ms/i.test(m[0]) ? Number(m[1]) : Number(m[1]) * 1000;
}

/** Strip the SDK's "Node "x" failed: " prefix; we show the node separately. */
function innerMessage(message: string): string {
  return message.replace(/^Node "[^"]+" failed:\s*/, "");
}

export function describeRunError(error: SerializedError, live?: unknown): RunIssue {
  const msg = innerMessage(error.message);
  const base = { ...(error.nodeId ? { nodeId: error.nodeId } : {}) };
  const status = error.status;
  if (error.code === "aborted") {
    return { ...base, kind: "aborted", title: "run stopped", detail: "you pulled the chain. nothing after this point ran." };
  }
  if (error.code === "chain_config") {
    return { ...base, kind: "config", title: "this chain doesn't hold together", detail: msg };
  }
  if (/no api key/i.test(msg) && (status === undefined || status === 401)) {
    return {
      ...base,
      kind: "missing-key",
      title: "no key, no jev",
      detail: "this server has no TypeSafe key configured. add your own (it stays in this browser) and run it again.",
      action: "add-key",
    };
  }
  if (status === 401 || status === 403 || error.code === "auth_error") {
    return { ...base, kind: "bad-key", title: "typesafe didn't like that key", detail: msg, action: "add-key" };
  }
  if (status === 429 || error.code === "rate_limited") {
    const retryAfterMs = retryAfterFrom(live, error.message);
    return {
      ...base,
      kind: "rate-limited",
      title: "the chain is overheating",
      detail: `too many links pulled at once.${retryAfterMs ? ` cool down for ${Math.ceil(retryAfterMs / 1000)}s` : " give it a minute"} and try again, or bring your own key and skip the line.`,
      ...(retryAfterMs !== undefined ? { retryAfterMs } : {}),
      action: "retry",
    };
  }
  if (status === 400 || status === 422 || error.code === "validation_error") {
    return { ...base, kind: "invalid", title: "typesafe rejected the request", detail: msg };
  }
  if (error.code === "timeout") {
    return { ...base, kind: "timeout", title: "jev took too long", detail: msg, action: "retry" };
  }
  if (error.code === "connection_error" || status === 502 || status === 504) {
    return { ...base, kind: "network", title: "couldn't reach jev", detail: msg, action: "retry" };
  }
  return { ...base, kind: "failed", title: error.nodeId ? `"${error.nodeId}" broke` : "run failed", detail: msg, action: "retry" };
}

/** The headline issue for a finished trace, if it didn't simply succeed. */
export function traceIssue(trace: Trace | undefined, live?: unknown): RunIssue | null {
  if (!trace) return null;
  if (trace.status === "halted") {
    return {
      kind: "halted",
      title: `halted at ${trace.halted?.nodeId ?? "a gate"}`,
      detail: trace.halted?.summary ?? "a gate with no otherwise path said no, so the run stopped on purpose.",
      ...(trace.halted?.nodeId ? { nodeId: trace.halted.nodeId } : {}),
    };
  }
  if (trace.status === "aborted") return describeRunError(trace.error ?? { name: "JevAbortError", code: "aborted", message: "Aborted" }, live);
  if (trace.status === "error" && trace.error) return describeRunError(trace.error, live);
  return null;
}
