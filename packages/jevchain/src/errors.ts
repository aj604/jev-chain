/**
 * Error types. Everything JevChain throws is a `JevChainError`, so one
 * `instanceof` catches the lot; the subclasses tell you what to do next.
 */

export class JevChainError extends Error {
  /** Stable machine-readable code, safe to switch on and to serialize. */
  readonly code: string;
  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
    this.code = code;
  }
}

// --- API errors -------------------------------------------------------------

/** TypeSafe answered with a non-2xx status. */
export class JevAPIError extends JevChainError {
  readonly status: number;
  readonly body: unknown;
  constructor(status: number, body: unknown, message?: string, code = "api_error") {
    super(code, message ?? `TypeSafe API returned ${status}${describeBody(body)}`);
    this.status = status;
    this.body = body;
  }
}

/** 401/403: the key is missing, wrong, or not allowed to do this. */
export class JevAuthError extends JevAPIError {
  constructor(status: number, body: unknown) {
    super(status, body, `TypeSafe rejected the API key (${status})${describeBody(body)}`, "auth_error");
  }
}

/** 400/422: the request was malformed. Retrying won't help. */
export class JevValidationError extends JevAPIError {
  constructor(status: number, body: unknown) {
    super(status, body, `TypeSafe couldn't process the request (${status})${describeBody(body)}`, "validation_error");
  }
}

/** 429: slow down. `retryAfterMs` is set when the server told us how long. */
export class JevRateLimitError extends JevAPIError {
  readonly retryAfterMs: number | undefined;
  constructor(status: number, body: unknown, retryAfterMs?: number) {
    super(status, body, `Rate limited by TypeSafe${retryAfterMs ? ` (retry after ${retryAfterMs}ms)` : ""}`, "rate_limited");
    this.retryAfterMs = retryAfterMs;
  }
}

/** 529 or 5xx: TypeSafe is having a moment. */
export class JevServerError extends JevAPIError {
  constructor(status: number, body: unknown) {
    super(status, body, `TypeSafe is ${status === 529 ? "overloaded" : "having a moment"} (${status})`, status === 529 ? "overloaded" : "server_error");
  }
}

/** A single attempt took longer than the configured timeout. */
export class JevTimeoutError extends JevChainError {
  readonly timeoutMs: number;
  constructor(timeoutMs: number, what = "Request") {
    super("timeout", `${what} timed out after ${timeoutMs}ms`);
    this.timeoutMs = timeoutMs;
  }
}

/** The network failed before we got a response. */
export class JevConnectionError extends JevChainError {
  constructor(cause: unknown) {
    super("connection_error", `Couldn't reach TypeSafe: ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
  }
}

/** The caller aborted via `AbortSignal`. */
export class JevAbortError extends JevChainError {
  constructor(reason?: unknown) {
    super("aborted", `Aborted${reason instanceof Error && reason.message ? `: ${reason.message}` : ""}`, { cause: reason });
  }
}

/** The API returned 200 but the body wasn't what we expected. */
export class JevResponseError extends JevChainError {
  constructor(message: string, readonly body?: unknown) {
    super("bad_response", message);
  }
}

// --- Chain errors -----------------------------------------------------------

/** The chain definition is invalid (duplicate ids, missing handlers, bad JSON...). */
export class ChainConfigError extends JevChainError {
  readonly issues: readonly string[];
  constructor(issues: readonly string[] | string) {
    const list = typeof issues === "string" ? [issues] : issues;
    super("chain_config", list.length === 1 ? list[0]! : `Invalid chain:\n  - ${list.join("\n  - ")}`);
    this.issues = list;
  }
}

/** A node failed while running. `nodeId` points at the culprit; `cause` is the original error. */
export class NodeError extends JevChainError {
  readonly nodeId: string;
  constructor(nodeId: string, cause: unknown) {
    const inner = cause instanceof Error ? cause.message : String(cause);
    super(cause instanceof JevChainError ? cause.code : "node_error", `Node "${nodeId}" failed: ${inner}`, { cause });
    this.nodeId = nodeId;
  }
}

// --- helpers ----------------------------------------------------------------

/** A plain-JSON view of any error, for traces. */
export interface SerializedError {
  name: string;
  code: string;
  message: string;
  status?: number;
  nodeId?: string;
}

export function serializeError(err: unknown): SerializedError {
  if (err instanceof JevChainError) {
    const out: SerializedError = { name: err.name, code: err.code, message: err.message };
    if (err instanceof JevAPIError) out.status = err.status;
    if (err instanceof NodeError) out.nodeId = err.nodeId;
    return out;
  }
  if (err instanceof Error) return { name: err.name, code: "unknown", message: err.message };
  return { name: "Error", code: "unknown", message: String(err) };
}

export function errorFromResponse(status: number, body: unknown, retryAfterMs?: number): JevAPIError {
  if (status === 401 || status === 403) return new JevAuthError(status, body);
  if (status === 400 || status === 422) return new JevValidationError(status, body);
  if (status === 429) return new JevRateLimitError(status, body, retryAfterMs);
  if (status >= 500) return new JevServerError(status, body);
  return new JevAPIError(status, body);
}

function describeBody(body: unknown): string {
  if (!body || typeof body !== "object") return typeof body === "string" && body ? `: ${body.slice(0, 200)}` : "";
  const b = body as Record<string, unknown>;
  // TypeSafe errors look like { detail: { error_type, message } } (or FastAPI-style { detail: [...] }).
  const detail = b.detail ?? b.message ?? (b.error as Record<string, unknown> | undefined)?.message ?? b.error;
  if (typeof detail === "string") return `: ${detail}`;
  if (detail && typeof detail === "object" && typeof (detail as Record<string, unknown>).message === "string") {
    return `: ${(detail as Record<string, unknown>).message as string}`;
  }
  if (detail) return `: ${JSON.stringify(detail).slice(0, 300)}`;
  return "";
}
