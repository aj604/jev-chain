/**
 * A small, dependency-free client for TypeSafe's System One API.
 *
 * - Retries with exponential backoff + jitter, honoring `retry-after`.
 * - Per-attempt timeouts and caller cancellation via `AbortSignal`.
 * - A concurrency limit shared by every call made through the client.
 * - Automatic batching: asks against the *same state* issued in the same tick
 *   are merged into one HTTP request (Jev ingests state once and answers every
 *   question in parallel, so this is strictly cheaper and faster).
 */
import {
  JevAbortError,
  JevChainError,
  JevConnectionError,
  JevResponseError,
  JevTimeoutError,
  errorFromResponse,
  JevRateLimitError,
} from "./errors";
import type { Answers, Entry, Questions, Answer } from "./questions";

export const DEFAULT_BASE_URL = "https://api.typesafe.ai";
export const DEFAULT_MODEL = "jev-latest";
/** jev-1.13 list price: $0.042 per million input tokens. Output tokens are free. */
export const DEFAULT_USD_PER_MTOK = 0.042;

export interface RetryPolicy {
  /** Retries after the first attempt. 0 disables retries. Default 2. */
  maxRetries: number;
  /** First backoff delay; doubles each retry. Default 250ms. */
  initialDelayMs: number;
  /** Backoff ceiling. Default 4000ms. */
  maxDelayMs: number;
  /** Fraction of each delay randomly shaved off (0–1). Default 0.25. */
  jitter: number;
  /** Largest `retry-after` we'll honor; longer values fall back to backoff. Default 30s. */
  maxRetryAfterMs: number;
}

export interface BatchOptions {
  /** How long to wait for siblings before sending. 0 = same microtask tick. Default 0. */
  windowMs?: number;
  /** Max questions merged into one request. Default 64. */
  maxQuestions?: number;
}

export interface JevClientOptions {
  /**
   * TypeSafe API key. Defaults to `process.env.TYPESAFE_API_KEY` where that exists.
   * Pass `null` when talking to a proxy that injects the key server-side.
   */
  apiKey?: string | null;
  /** API root. Point this at your own proxy in the browser. Default `https://api.typesafe.ai`. */
  baseURL?: string;
  /** Path appended to `baseURL`. Default `/v1/systemone`. Set to "" if `baseURL` is the full endpoint. */
  path?: string;
  /** Default model for every ask. Default `jev-latest`. */
  model?: string;
  /** Per-attempt timeout. Default 10s. */
  timeoutMs?: number;
  retry?: Partial<RetryPolicy>;
  /** Max HTTP requests in flight at once. Default 8. */
  maxConcurrency?: number;
  /** Merge same-state asks into one request. Default on; pass `false` to disable. */
  batch?: boolean | BatchOptions;
  /** Price used for cost estimates. Default $0.042 / Mtok input. */
  usdPerMillionTokens?: number;
  headers?: Record<string, string>;
  /** Custom fetch (tests, proxies, instrumentation). Default: global `fetch`. */
  fetch?: typeof fetch;
}

export interface AskOptions {
  model?: string;
  signal?: AbortSignal;
  /** Opt this call out of batching. */
  batch?: boolean;
  /** Called before each retry (the trace uses this). */
  onRetry?: (info: RetryInfo) => void;
}

export interface RetryInfo {
  attempt: number;
  delayMs: number;
  error: JevChainError;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

/** Everything we know about one answered ask. */
export interface AskResult<Q extends Questions = Questions> {
  answers: Answers<Q>;
  /** Versioned model id that actually answered, e.g. `jev-1.13.0`. */
  model: string;
  /** This ask's share of the request's usage (split evenly when batched). */
  usage: Usage;
  costUsd: number;
  /** Wall time of the HTTP exchange, including retries. */
  latencyMs: number;
  attempts: number;
  requestId?: string;
  /** Present when this ask rode along in a merged request. */
  batch?: { id: string; size: number; questions: number };
}

export interface JevClient {
  ask<const Q extends Questions>(state: Entry, questions: Q, options?: AskOptions): Promise<AskResult<Q>>;
  readonly model: string;
  readonly usdPerMillionTokens: number;
}

interface WireResponse {
  model: string;
  answers: Record<string, Answer>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

interface Pending {
  questions: Questions;
  options: AskOptions;
  resolve: (r: AskResult) => void;
  reject: (e: unknown) => void;
}

const RETRY_STATUSES = new Set([408, 409, 429, 500, 502, 503, 504, 529]);

export function createJevClient(options: JevClientOptions = {}): JevClient {
  const apiKey = options.apiKey === undefined ? readEnvKey() : options.apiKey;
  const baseURL = (options.baseURL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  const endpoint = baseURL + (options.path ?? "/v1/systemone");
  const model = options.model ?? DEFAULT_MODEL;
  const timeoutMs = options.timeoutMs ?? 10_000;
  const retry: RetryPolicy = {
    maxRetries: 2,
    initialDelayMs: 250,
    maxDelayMs: 4_000,
    jitter: 0.25,
    maxRetryAfterMs: 30_000,
    ...options.retry,
  };
  const usdPerMillionTokens = options.usdPerMillionTokens ?? DEFAULT_USD_PER_MTOK;
  const batchOpts = options.batch === false ? null : { windowMs: 0, maxQuestions: 64, ...(options.batch === true ? {} : options.batch) };
  const doFetch = options.fetch ?? globalThis.fetch?.bind(globalThis);
  if (!doFetch) throw new JevChainError("no_fetch", "No global fetch available; pass `fetch` to createJevClient()");
  const limit = semaphore(options.maxConcurrency ?? 8);

  let batchSeq = 0;
  // Pending batches keyed by model + serialized state.
  const queues = new Map<string, { items: Pending[]; state: Entry; model: string }>();

  /** One HTTP exchange with retries. Returns the parsed body plus bookkeeping. */
  async function send(state: Entry, questions: Questions, callModel: string, signal: AbortSignal | undefined, onRetry: ((i: RetryInfo) => void)[]) {
    const body = JSON.stringify({ state, model: callModel, questions });
    const headers: Record<string, string> = { "content-type": "application/json", ...options.headers };
    if (apiKey) headers.authorization = `Bearer ${apiKey}`;
    const started = now();
    let attempt = 0;
    for (;;) {
      attempt++;
      throwIfAborted(signal);
      try {
        // Waiting for a slot is abortable too: a call cancelled in the queue never goes out.
        const res = await limit(() => fetchWithTimeout(doFetch, endpoint, { method: "POST", headers, body }, timeoutMs, signal), signal);
        if (!res.ok) throw errorFromResponse(res.status, res.body, parseRetryAfter(res.headers));
        const wire = validateResponse(res.body, questions);
        return { wire, attempts: attempt, latencyMs: now() - started, requestId: res.headers.get("x-typesafe-request-id") ?? undefined };
      } catch (raw) {
        const err = normalizeError(raw, signal);
        if (attempt > retry.maxRetries || !isRetryable(err)) throw err;
        const delayMs = backoff(retry, attempt, err);
        for (const cb of onRetry) cb({ attempt, delayMs, error: err });
        await sleep(delayMs, signal);
      }
    }
  }

  function toResult<Q extends Questions>(
    wire: WireResponse,
    keys: Record<string, string>,
    share: number,
    meta: { attempts: number; latencyMs: number; requestId?: string; batch?: AskResult["batch"] },
  ): AskResult<Q> {
    const answers: Record<string, Answer> = {};
    for (const [wireKey, key] of Object.entries(keys)) answers[key] = wire.answers[wireKey]!;
    const inputTokens = (wire.usage?.input_tokens ?? 0) * share;
    const outputTokens = (wire.usage?.output_tokens ?? 0) * share;
    return {
      answers: answers as Answers<Q>,
      model: wire.model,
      usage: { inputTokens, outputTokens },
      costUsd: (inputTokens / 1_000_000) * usdPerMillionTokens,
      latencyMs: meta.latencyMs,
      attempts: meta.attempts,
      ...(meta.requestId ? { requestId: meta.requestId } : {}),
      ...(meta.batch ? { batch: meta.batch } : {}),
    };
  }

  async function flush(key: string) {
    const queue = queues.get(key);
    if (!queue) return;
    queues.delete(key);
    // Callers that aborted while queued drop out before we send.
    const items = queue.items.filter((p) => {
      if (p.options.signal?.aborted) {
        p.reject(abortError(p.options.signal));
        return false;
      }
      return true;
    });
    // Respect maxQuestions by splitting into chunks.
    const chunks: Pending[][] = [];
    let current: Pending[] = [];
    let count = 0;
    for (const p of items) {
      const n = Object.keys(p.questions).length;
      if (current.length && count + n > batchOpts!.maxQuestions) {
        chunks.push(current);
        current = [];
        count = 0;
      }
      current.push(p);
      count += n;
    }
    if (current.length) chunks.push(current);
    await Promise.all(chunks.map((chunk) => sendChunk(chunk, queue.state, queue.model)));
  }

  async function sendChunk(chunk: Pending[], state: Entry, callModel: string) {
    if (chunk.length === 1) {
      const p = chunk[0]!;
      try {
        const keys = Object.fromEntries(Object.keys(p.questions).map((k) => [k, k]));
        const r = await send(state, p.questions, callModel, p.options.signal, p.options.onRetry ? [p.options.onRetry] : []);
        p.resolve(toResult(r.wire, keys, 1, r));
      } catch (e) {
        p.reject(e);
      }
      return;
    }
    const merged: Record<string, Questions[string]> = {};
    const keyMaps = chunk.map((p, i) => {
      const map: Record<string, string> = {};
      for (const [k, q] of Object.entries(p.questions)) {
        // Question keys aren't seen by the model, so namespacing them is free.
        const wireKey = `b${i}.${k}`;
        merged[wireKey] = q;
        map[wireKey] = k;
      }
      return map;
    });
    // The merged request is cancelled only if *every* caller cancels.
    const signal = anySignalAll(chunk.map((p) => p.options.signal));
    const onRetry = chunk.flatMap((p) => (p.options.onRetry ? [p.options.onRetry] : []));
    const batch = { id: `batch_${++batchSeq}`, size: chunk.length, questions: Object.keys(merged).length };
    try {
      const r = await send(state, merged, callModel, signal, onRetry);
      chunk.forEach((p, i) => p.resolve(toResult(r.wire, keyMaps[i]!, 1 / chunk.length, { ...r, batch })));
    } catch (e) {
      for (const p of chunk) p.reject(e);
    }
  }

  return {
    model,
    usdPerMillionTokens,
    ask(state, questions, askOptions = {}) {
      if (!questions || Object.keys(questions).length === 0) {
        return Promise.reject(new JevChainError("no_questions", "ask() needs at least one question"));
      }
      const callModel = askOptions.model ?? model;
      if (!batchOpts || askOptions.batch === false) {
        return (async () => {
          const r = await send(state, questions, callModel, askOptions.signal, askOptions.onRetry ? [askOptions.onRetry] : []);
          const keys = Object.fromEntries(Object.keys(questions).map((k) => [k, k]));
          return toResult(r.wire, keys, 1, r);
        })();
      }
      return new Promise((resolve, reject) => {
        const key = `${callModel}\u0000${stableStringify(state)}`;
        let queue = queues.get(key);
        if (!queue) {
          queue = { items: [], state, model: callModel };
          queues.set(key, queue);
          if (batchOpts.windowMs > 0) setTimeout(() => void flush(key), batchOpts.windowMs);
          else queueMicrotask(() => void flush(key));
        }
        queue.items.push({ questions, options: askOptions, resolve: resolve as (r: AskResult) => void, reject });
      });
    },
  };
}

// ---------------------------------------------------------------------------
// internals
// ---------------------------------------------------------------------------

function readEnvKey(): string | null {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  return env?.TYPESAFE_API_KEY ?? env?.JEV_API_KEY ?? null;
}

function now(): number {
  return globalThis.performance?.now() ?? Date.now();
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError(signal);
}

/** The error to throw for an aborted signal: its reason if that's already ours (e.g. a run deadline). */
function abortError(signal: AbortSignal): JevChainError {
  return signal.reason instanceof JevChainError ? signal.reason : new JevAbortError(signal.reason);
}

async function fetchWithTimeout(
  doFetch: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ ok: boolean; status: number; headers: Headers; body: unknown }> {
  throwIfAborted(signal);
  const controller = new AbortController();
  const timeoutError = new JevTimeoutError(timeoutMs);
  const timer = setTimeout(() => controller.abort(timeoutError), timeoutMs);
  const onAbort = () => controller.abort(signal!.reason);
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    // The timeout covers reading the body too, not just the headers.
    const res = await doFetch(url, { ...init, signal: controller.signal });
    return { ok: res.ok, status: res.status, headers: res.headers, body: await readBody(res) };
  } catch (e) {
    if (controller.signal.aborted) {
      throw controller.signal.reason === timeoutError ? timeoutError : abortError(signal!);
    }
    throw new JevConnectionError(e);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener("abort", onAbort);
  }
}

async function readBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function validateResponse(body: unknown, questions: Questions): WireResponse {
  if (!body || typeof body !== "object") throw new JevResponseError("Expected a JSON object from TypeSafe", body);
  const b = body as Partial<WireResponse>;
  if (!b.answers || typeof b.answers !== "object") throw new JevResponseError("Response is missing `answers`", body);
  for (const [key, q] of Object.entries(questions)) {
    const a = b.answers[key];
    if (!a) throw new JevResponseError(`Response is missing an answer for "${key}"`, body);
    if (a.type !== q.type) throw new JevResponseError(`Answer "${key}" has type ${a.type}, expected ${q.type}`, body);
  }
  return { model: typeof b.model === "string" ? b.model : "unknown", answers: b.answers, ...(b.usage ? { usage: b.usage } : {}) };
}

function normalizeError(raw: unknown, signal?: AbortSignal): JevChainError {
  if (raw instanceof JevChainError) return raw;
  if (signal?.aborted) return abortError(signal);
  return new JevConnectionError(raw);
}

function isRetryable(err: JevChainError): boolean {
  if (err instanceof JevAbortError) return false;
  if (err instanceof JevTimeoutError || err instanceof JevConnectionError) return true;
  const status = (err as { status?: number }).status;
  return status !== undefined && RETRY_STATUSES.has(status);
}

export function backoff(policy: RetryPolicy, attempt: number, err?: JevChainError, random = Math.random): number {
  if (err instanceof JevRateLimitError && err.retryAfterMs !== undefined && err.retryAfterMs <= policy.maxRetryAfterMs) {
    return err.retryAfterMs;
  }
  const base = Math.min(policy.maxDelayMs, policy.initialDelayMs * 2 ** (attempt - 1));
  return Math.round(base * (1 - policy.jitter * random()));
}

function parseRetryAfter(headers: Headers): number | undefined {
  const ms = headers.get("retry-after-ms");
  if (ms && !Number.isNaN(Number(ms))) return Number(ms);
  const s = headers.get("retry-after");
  if (!s) return undefined;
  if (!Number.isNaN(Number(s))) return Number(s) * 1000;
  const date = Date.parse(s);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal));
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(abortError(signal!));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** A signal that aborts only once every input signal has aborted. */
function anySignalAll(signals: (AbortSignal | undefined)[]): AbortSignal | undefined {
  if (signals.some((s) => !s)) return undefined; // someone can't cancel, so the request must run
  const controller = new AbortController();
  const check = () => {
    if (signals.every((s) => s!.aborted)) controller.abort(signals[0]!.reason);
  };
  for (const s of signals) s!.addEventListener("abort", check, { once: true });
  check();
  return controller.signal;
}

/**
 * Limits concurrent async work to `max`. FIFO. If `signal` aborts while `fn`
 * is still waiting for a slot, it gives up its place and rejects without
 * running `fn`.
 */
export function semaphore(max: number) {
  if (!(max >= 1)) throw new RangeError("maxConcurrency must be >= 1");
  let active = 0;
  const waiting: (() => void)[] = [];
  const acquire = (signal?: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(abortError(signal));
      const onAbort = () => {
        waiting.splice(waiting.indexOf(grant), 1);
        reject(abortError(signal!));
      };
      const grant = () => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      };
      waiting.push(grant);
      signal?.addEventListener("abort", onAbort, { once: true });
    });
  return async function run<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (active >= max) await acquire(signal);
    active++;
    try {
      return await fn();
    } finally {
      active--;
      waiting.shift()?.();
    }
  };
}

/** JSON.stringify with sorted keys, so equal states batch together regardless of key order. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj)
    .sort()
    .filter((k) => obj[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`)
    .join(",")}}`;
}
