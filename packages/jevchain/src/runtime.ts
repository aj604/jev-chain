/**
 * The runtime: walks a chain, calls Jev, records everything.
 *
 * Every run yields a `Trace` (see trace.ts). The runtime never builds the
 * trace directly; it only emits events and folds them with `reduceTrace`,
 * the same function a UI uses. So a live view and the final trace can't
 * disagree.
 */
import { createJevClient, type AskResult, type JevClient, type JevClientOptions } from "./client";
import {
  CancelledError,
  ChainConfigError,
  JevAbortError,
  JevChainError,
  JevTimeoutError,
  NodeError,
  serializeError,
  type SerializedError,
} from "./errors";
import { explainDecision, type ExplainInput } from "./explain";
import {
  childPath,
  ROOT_PATH,
  type AnyJevNode,
  type AskNode,
  type CascadeNode,
  type ChainNode,
  type EmitNode,
  type GateNode,
  type JevNode,
  type ParallelNode,
  type RouteNode,
  type StateSpec,
  type StepContext,
  type StepNode,
} from "./nodes";
import { confidenceOf, type Answer, type Entry, type Json, type Questions } from "./questions";
import { renderJson, renderTemplate, type OnMissing } from "./template";
import { reduceTrace, type Decision, type JevCall, type RunStatus, type SpanStatus, type Trace, type TraceEvent } from "./trace";
import { chainIssues, DECISION_KEY } from "./validate";

export interface RunOptions {
  /** The client to call Jev with. `createJev().run(...)` fills this in for you. */
  jev: JevClient;
  signal?: AbortSignal;
  /** Deadline for the whole run. */
  timeoutMs?: number;
  runId?: string;
  /** Every trace event, as it happens. */
  onEvent?: (event: TraceEvent) => void;
  /** Longest string kept in trace inputs/outputs before truncating. Default 4000. */
  maxTraceString?: number;
}

export type RunResult<O> =
  | { status: "ok"; output: O; trace: Trace; error?: undefined }
  | { status: "halted"; output?: undefined; trace: Trace; error?: undefined }
  | { status: "error" | "aborted"; output?: undefined; trace: Trace; error: JevChainError };

/** Stops the run without failing it (a gate with no `otherwise`). */
class Halt {
  constructor(
    readonly path: string,
    readonly nodeId: string,
    readonly summary: string,
  ) {}
}

/**
 * Run a chain to completion. Never throws for runtime failures: check `status`.
 * (It does throw `ChainConfigError` if the chain itself is invalid.)
 */
export async function run<I, O>(node: JevNode<I, O>, input: I, options: RunOptions): Promise<RunResult<O>> {
  const issues = chainIssues(node);
  if (issues.length) throw new ChainConfigError(issues);
  return new Runner(options).start(node, input) as Promise<RunResult<O>>;
}

/** A run you can `for await` over, event by event. `result` resolves at the end. */
export interface TraceStream<O> extends AsyncIterable<TraceEvent> {
  readonly result: Promise<RunResult<O>>;
}

/**
 * Run a chain and stream its trace events.
 *
 * ```ts
 * const s = stream(triage, "the printer is haunted", { jev });
 * for await (const e of s) render(e);
 * const { output } = await s.result;
 * ```
 */
export function stream<I, O>(node: JevNode<I, O>, input: I, options: RunOptions): TraceStream<O> {
  const buffer: TraceEvent[] = [];
  let wake: (() => void) | undefined;
  let done = false;
  const result = run(node, input, {
    ...options,
    onEvent: (e) => {
      options.onEvent?.(e);
      buffer.push(e);
      wake?.();
    },
  }).finally(() => {
    done = true;
    wake?.();
  });
  return {
    result,
    async *[Symbol.asyncIterator]() {
      for (;;) {
        if (buffer.length) {
          yield buffer.shift()!;
          continue;
        }
        if (done) {
          await result; // surface config errors to the iterating caller
          return;
        }
        await new Promise<void>((r) => (wake = r));
        wake = undefined;
      }
    },
  };
}

// ---------------------------------------------------------------------------

class Runner {
  private trace: Trace | undefined;
  private t0 = 0;
  private readonly results: Record<string, unknown> = {};
  private readonly controller = new AbortController();
  private runInput: unknown;
  private callSeq = 0;

  constructor(private readonly opts: RunOptions) {}

  private now(): number {
    return Math.round(((globalThis.performance?.now() ?? Date.now()) - this.t0) * 100) / 100;
  }

  private emit(event: TraceEvent) {
    this.trace = reduceTrace(this.trace, event);
    this.opts.onEvent?.(event);
  }

  private safe(value: unknown): Json {
    return toJsonSafe(value, this.opts.maxTraceString ?? 4000);
  }

  async start(root: JevNode, input: unknown): Promise<RunResult<unknown>> {
    this.t0 = globalThis.performance?.now() ?? Date.now();
    this.runInput = input;
    const { signal: userSignal, timeoutMs } = this.opts;
    const onUserAbort = () => this.controller.abort(new JevAbortError(userSignal!.reason));
    if (userSignal?.aborted) onUserAbort();
    userSignal?.addEventListener("abort", onUserAbort, { once: true });
    const deadline = timeoutMs ? setTimeout(() => this.controller.abort(new JevTimeoutError(timeoutMs, "Run")), timeoutMs) : undefined;

    this.emit({
      type: "run:start",
      runId: this.opts.runId ?? randomId("run"),
      chainId: root.id,
      startedAt: new Date().toISOString(),
      input: this.safe(input),
    });

    let status: RunStatus = "ok";
    let output: unknown;
    let error: JevChainError | undefined;
    let halted: Trace["halted"];
    try {
      output = await this.exec(root as AnyJevNode, input, ROOT_PATH, null, null, this.controller.signal);
    } catch (e) {
      if (e instanceof Halt) {
        status = "halted";
        halted = { path: e.path, nodeId: e.nodeId, summary: e.summary };
      } else {
        error = e instanceof JevChainError ? e : new JevChainError("unknown", String(e), { cause: e });
        const root = error instanceof NodeError ? error.cause : error;
        status = root instanceof JevAbortError ? "aborted" : "error";
      }
    } finally {
      clearTimeout(deadline);
      userSignal?.removeEventListener("abort", onUserAbort);
    }

    // Close anything left open (siblings cancelled by a failure or halt).
    for (const s of this.trace!.spans) {
      if (s.status === "running") {
        this.emit({ type: "span:end", at: this.now(), path: s.path, status: status === "halted" ? "halted" : "error", error: serializeError(new CancelledError("Cancelled when the run ended")) });
      }
    }

    const final: Trace = {
      ...this.trace!,
      status,
      durationMs: this.now(),
      ...(status === "ok" ? { output: this.safe(output) } : {}),
      ...(error ? { error: serializeError(error) } : {}),
      ...(halted ? { halted } : {}),
    };
    this.emit({ type: "run:end", trace: final });
    if (status === "ok") return { status, output, trace: final };
    if (status === "halted") return { status, trace: final };
    return { status: status as "error" | "aborted", trace: final, error: error! };
  }

  private async exec(node: AnyJevNode, input: unknown, path: string, parentPath: string | null, edge: string | null, signal: AbortSignal): Promise<unknown> {
    if (signal.aborted) throw signal.reason instanceof JevChainError ? signal.reason : new JevAbortError(signal.reason);
    this.emit({
      type: "span:start",
      at: this.now(),
      span: {
        path,
        parentPath,
        edge,
        nodeId: node.id,
        kind: node.kind,
        ...(node.title ? { title: node.title } : {}),
        input: this.safe(input),
      },
    });
    try {
      const output = await this.execKind(node, input, path, signal);
      this.results[node.id] = output;
      this.emit({ type: "span:end", at: this.now(), path, status: "ok", output: this.safe(output) });
      return output;
    } catch (e) {
      if (e instanceof Halt) {
        this.emit({ type: "span:end", at: this.now(), path, status: "halted" });
        throw e;
      }
      // Attribute the failure to the innermost node only; ancestors point down at it.
      const err = e instanceof NodeError ? e : new NodeError(node.id, e, path);
      const error = serializeError(err.cause ?? err);
      if (err.path) error.path = err.path;
      this.emit({ type: "span:end", at: this.now(), path, status: "error", error });
      throw err;
    }
  }

  private execKind(node: AnyJevNode, input: unknown, path: string, signal: AbortSignal): Promise<unknown> {
    switch (node.kind) {
      case "ask":
        return this.execAsk(node, input, path, signal);
      case "route":
        return this.execRoute(node, input, path, signal);
      case "gate":
        return this.execGate(node, input, path, signal);
      case "parallel":
        return this.execParallel(node, input, path, signal);
      case "cascade":
        return this.execCascade(node, input, path, signal);
      case "step":
        return this.execStep(node, input, path, signal);
      case "emit":
        return Promise.resolve(this.execEmit(node, input, path));
      case "chain":
        return this.execChain(node, input, path, signal);
    }
  }

  // --- helpers ---------------------------------------------------------------

  private scope(input: unknown) {
    return { input, run: this.runInput, results: this.results };
  }

  /** Notes an empty template hole on the span, so a blank state or emit isn't a mystery. */
  private onMissing(path: string): OnMissing {
    return (hole) =>
      this.emit({ type: "log", path, log: { at: this.now(), message: `Template hole "{{${hole}}}" was empty: nothing at ${hole}`, data: { hole } } });
  }

  private resolveState(spec: StateSpec<unknown> | undefined, input: unknown, path: string): Entry {
    const raw = spec === undefined ? input : typeof spec === "function" ? spec(input) : renderTemplate(spec, this.scope(input), this.onMissing(path));
    return toEntry(raw);
  }

  private ctx(path: string, signal: AbortSignal): StepContext {
    return {
      runInput: this.runInput,
      results: this.results,
      signal,
      jev: this.opts.jev,
      log: (message, data) => this.emit({ type: "log", path, log: { at: this.now(), message, ...(data !== undefined ? { data } : {}) } }),
    };
  }

  private async callJev(path: string, state: Entry, questions: Questions, model: string | undefined, signal: AbortSignal, tier?: string): Promise<AskResult> {
    const start = this.now();
    const r = await this.opts.jev.ask(state, questions, {
      ...(model ? { model } : {}),
      signal,
      onRetry: ({ attempt, delayMs, error }) =>
        this.emit({ type: "retry", path, retry: { at: this.now(), attempt, delayMs, error: serializeError(error), source: "jev" } }),
    });
    const call: JevCall = {
      id: `call_${++this.callSeq}`,
      model: r.model,
      state,
      questions,
      answers: r.answers as Record<string, Answer>,
      inputTokens: r.usage.inputTokens,
      outputTokens: r.usage.outputTokens,
      costUsd: r.costUsd,
      start,
      end: this.now(),
      latencyMs: Math.round(r.latencyMs),
      attempts: r.attempts,
      ...(r.requestId ? { requestId: r.requestId } : {}),
      ...(r.batch ? { batch: r.batch } : {}),
      ...(tier ? { tier } : {}),
    };
    this.emit({ type: "jev:call", path, call });
    return r;
  }

  private decide(path: string, d: ExplainInput) {
    const decision: Decision = {
      kind: d.kind,
      question: d.question,
      taken: d.taken,
      edges: d.edges,
      metric: d.metric,
      value: d.value,
      ...(d.threshold ? { threshold: d.threshold } : {}),
      ...(d.confidence !== undefined ? { confidence: d.confidence } : {}),
      ...(d.fallback ? { fallback: true } : {}),
      summary: explainDecision(d),
    };
    this.emit({ type: "decision", path, decision });
    return decision;
  }

  // --- node kinds -------------------------------------------------------------

  private async execAsk(node: AskNode, input: unknown, path: string, signal: AbortSignal) {
    const r = await this.callJev(path, this.resolveState(node.state, input, path), node.questions, node.model, signal);
    return r.answers;
  }

  private async execRoute(node: RouteNode, input: unknown, path: string, signal: AbortSignal) {
    const questions = { [DECISION_KEY]: node.ask, ...node.alsoAsk };
    const r = await this.callJev(path, this.resolveState(node.state, input, path), questions, node.model, signal);
    const answer = r.answers[DECISION_KEY] as Answer & { type: "choice" };
    const low = node.lowConfidence && answer.confidence < node.lowConfidence.below;
    const taken = low ? "lowConfidence" : answer.choice;
    const edges = Object.keys(node.branches).map((label) => ({ edge: label, value: answer.probabilities[label] ?? 0, taken: label === taken }));
    if (node.lowConfidence) edges.push({ edge: "lowConfidence", value: answer.confidence, taken: !!low });
    this.decide(path, {
      kind: "route",
      question: DECISION_KEY,
      taken,
      edges,
      metric: "probability",
      value: answer.probabilities[answer.choice] ?? 0,
      confidence: answer.confidence,
      ...(low ? { fallback: true, wouldHaveBeen: answer.choice, lowConfidenceBelow: node.lowConfidence!.below } : {}),
    });
    const next = low ? node.lowConfidence!.then : node.branches[taken];
    if (!next) throw new JevChainError("no_branch", `Route "${node.id}" has no branch for "${taken}"`);
    return this.exec(next as AnyJevNode, input, childPath(path, taken), path, taken, signal);
  }

  private async execGate(node: GateNode, input: unknown, path: string, signal: AbortSignal) {
    const questions = { [DECISION_KEY]: node.ask, ...node.alsoAsk };
    const r = await this.callJev(path, this.resolveState(node.state, input, path), questions, node.model, signal);
    const answer = r.answers[DECISION_KEY] as Answer;
    const { value, metric } = gateValue(answer, node.pass.label);
    const { min, max } = node.pass;
    const passed = (min === undefined || value >= min) && (max === undefined || value <= max);
    const confidence = confidenceOf(answer);
    let unsure = false;
    if (node.unsure) {
      const bar = min ?? max;
      const nearBar = node.unsure.margin !== undefined && bar !== undefined && Math.abs(value - bar) < node.unsure.margin;
      const lowConf = node.unsure.minConfidence !== undefined && confidence < node.unsure.minConfidence;
      unsure = nearBar || lowConf;
    }
    const taken = unsure ? "unsure" : passed ? "then" : node.otherwise ? "otherwise" : "halt";
    const edges = [{ edge: "then", value, taken: taken === "then" }];
    if (node.otherwise) edges.push({ edge: "otherwise", value, taken: taken === "otherwise" });
    if (node.unsure) edges.push({ edge: "unsure", value, taken: taken === "unsure" });
    const decision = this.decide(path, {
      kind: "gate",
      question: DECISION_KEY,
      taken,
      edges,
      metric,
      value,
      threshold: { ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}), ...(node.pass.label ? { label: node.pass.label } : {}) },
      ...(answer.type !== "noul" ? { confidence } : {}),
    });
    if (taken === "halt") throw new Halt(path, node.id, decision.summary);
    const next = taken === "then" ? node.then : taken === "otherwise" ? node.otherwise! : node.unsure!.then;
    return this.exec(next as AnyJevNode, input, childPath(path, taken), path, taken, signal);
  }

  private async execParallel(node: ParallelNode, input: unknown, path: string, signal: AbortSignal) {
    // Siblings share a controller so one failure cancels the rest. They're
    // cancelled with a CancelledError, not the failure itself, so the trace
    // blames only the branch that actually broke. (A halt stays a halt.)
    const local = new AbortController();
    const onAbort = () => local.abort(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    const entries = Object.entries(node.branches);
    let first: { error: unknown } | undefined;
    try {
      const settled = await Promise.allSettled(
        entries.map(([key, child]) =>
          this.exec(child as AnyJevNode, input, childPath(path, key), path, key, local.signal).catch((e) => {
            first ??= { error: e };
            if (!local.signal.aborted) local.abort(e instanceof Halt ? e : cancelledBy(e));
            throw e;
          }),
        ),
      );
      if (first) throw first.error;
      const rejected = settled.find((r): r is PromiseRejectedResult => r.status === "rejected");
      if (rejected) throw rejected.reason;
      const results = Object.fromEntries(entries.map(([key], i) => [key, (settled[i] as PromiseFulfilledResult<unknown>).value]));
      return node.join ? await node.join(results, input, this.ctx(path, signal)) : results;
    } finally {
      signal.removeEventListener("abort", onAbort);
    }
  }

  private async execCascade(node: CascadeNode, input: unknown, path: string, signal: AbortSignal) {
    const edges: Decision["edges"] = node.tiers.map((t) => ({ edge: t.id, value: null, taken: false }));
    edges.push({ edge: "fallback", value: null, taken: false });
    for (const [i, tier] of node.tiers.entries()) {
      const r = await this.callJev(path, this.resolveState(tier.state, input, path), { [DECISION_KEY]: tier.ask }, tier.model, signal, tier.id);
      const answer = r.answers[DECISION_KEY] as Answer;
      const confidence = confidenceOf(answer);
      edges[i] = { edge: tier.id, value: confidence, taken: confidence >= tier.minConfidence };
      if (confidence >= tier.minConfidence) {
        this.decide(path, { kind: "cascade", question: DECISION_KEY, taken: tier.id, edges, metric: "confidence", value: confidence, threshold: { min: tier.minConfidence }, confidence });
        return { resolvedBy: "tier", tier: tier.id, answer };
      }
    }
    edges[edges.length - 1] = { edge: "fallback", value: null, taken: true };
    this.decide(path, { kind: "cascade", question: DECISION_KEY, taken: "fallback", edges, metric: "confidence", value: 0 });
    const output = await this.exec(node.fallback as AnyJevNode, input, childPath(path, "fallback"), path, "fallback", signal);
    return { resolvedBy: "fallback", output };
  }

  private async execStep(node: StepNode, input: unknown, path: string, signal: AbortSignal) {
    const retries = node.retries ?? 0;
    for (let attempt = 1; ; attempt++) {
      try {
        return await this.stepAttempt(node, input, path, signal);
      } catch (e) {
        if (signal.aborted || attempt > retries) throw e;
        const delayMs = Math.min(2000, 100 * 2 ** (attempt - 1));
        this.emit({ type: "retry", path, retry: { at: this.now(), attempt, delayMs, error: serializeError(e), source: "step" } });
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  /** One attempt of a step, raced against its timeout and the run's signal. */
  private stepAttempt(node: StepNode, input: unknown, path: string, signal: AbortSignal): Promise<unknown> {
    const attempt = new AbortController();
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onAbort);
      };
      const onAbort = () => {
        attempt.abort(signal.reason);
        cleanup();
        reject(signal.reason);
      };
      if (signal.aborted) return onAbort();
      signal.addEventListener("abort", onAbort, { once: true });
      if (node.timeoutMs) {
        timer = setTimeout(() => {
          const err = new JevTimeoutError(node.timeoutMs!, `Step "${node.id}"`);
          attempt.abort(err);
          cleanup();
          reject(err);
        }, node.timeoutMs);
      }
      Promise.resolve()
        .then(() => node.run(input, this.ctx(path, attempt.signal)))
        .then(
          (v) => {
            cleanup();
            resolve(v);
          },
          (e) => {
            cleanup();
            reject(e);
          },
        );
    });
  }

  private execEmit(node: EmitNode, input: unknown, path: string) {
    return renderJson(node.value, this.scope(input), this.onMissing(path));
  }

  private async execChain(node: ChainNode, input: unknown, path: string, signal: AbortSignal) {
    let value = input;
    for (const [i, child] of node.steps.entries()) {
      value = await this.exec(child as AnyJevNode, value, childPath(path, String(i)), path, String(i), signal);
    }
    return value;
  }
}

/** The reason a parallel's surviving branches are aborted with when a sibling fails. */
function cancelledBy(cause: unknown): CancelledError {
  const where = cause instanceof NodeError ? ` because "${cause.nodeId}" failed${cause.path ? ` at ${cause.path}` : ""}` : "";
  return new CancelledError(`Cancelled${where}`, { cause });
}

function gateValue(answer: Answer, label?: string): { value: number; metric: Decision["metric"] } {
  switch (answer.type) {
    case "noul":
      return { value: answer.noul, metric: "noul" };
    case "score":
      return { value: answer.score, metric: "score" };
    case "choice":
      return { value: label ? (answer.probabilities[label] ?? 0) : answer.confidence, metric: label ? "probability" : "confidence" };
  }
}

/** Coerce anything into something Jev accepts as `state`. */
function toEntry(value: unknown): Entry {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  return toJsonSafe(value, Infinity) as Entry;
}

/** JSON-safe copy of any value: no cycles, functions or giant strings. */
export function toJsonSafe(value: unknown, maxString = 4000, depth = 0, seen = new WeakSet<object>()): Json {
  if (value === null || value === undefined) return null;
  switch (typeof value) {
    case "string":
      return value.length > maxString ? `${value.slice(0, maxString)}… (+${value.length - maxString} chars)` : value;
    case "number":
      return Number.isFinite(value) ? value : String(value);
    case "boolean":
      return value;
    case "bigint":
      return value.toString();
    case "function":
      return `[function ${value.name || "anonymous"}]`;
    case "symbol":
      return value.toString();
  }
  const obj = value as object;
  if (seen.has(obj)) return "[circular]";
  if (depth > 12) return "[too deep]";
  seen.add(obj);
  try {
    if (obj instanceof Error) return { name: obj.name, message: obj.message };
    if (obj instanceof Date) return obj.toISOString();
    if (obj instanceof Map) return toJsonSafe(Object.fromEntries(obj), maxString, depth + 1, seen);
    if (obj instanceof Set) return toJsonSafe([...obj], maxString, depth + 1, seen);
    if (Array.isArray(obj)) return obj.map((v) => toJsonSafe(v, maxString, depth + 1, seen));
    const out: Record<string, Json> = {};
    for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = toJsonSafe(v, maxString, depth + 1, seen);
    return out;
  } finally {
    seen.delete(obj);
  }
}

function randomId(prefix: string): string {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  return `${prefix}_${[...bytes].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

// ---------------------------------------------------------------------------
// The friendly front door
// ---------------------------------------------------------------------------

export interface Jev extends JevClient {
  /** Run a chain. See `run`. */
  run<I, O>(node: JevNode<I, O>, input: I, options?: Omit<RunOptions, "jev">): Promise<RunResult<O>>;
  /** Run a chain and stream trace events. See `stream`. */
  stream<I, O>(node: JevNode<I, O>, input: I, options?: Omit<RunOptions, "jev">): TraceStream<O>;
  readonly client: JevClient;
}

/**
 * Make a Jev client with `run` and `stream` attached.
 *
 * ```ts
 * const jev = createJev(); // reads TYPESAFE_API_KEY
 * const { output, trace } = await jev.run(triage, "the toaster is whispering again");
 * ```
 */
export function createJev(options: JevClientOptions | JevClient = {}): Jev {
  const client = "ask" in options && typeof options.ask === "function" ? options : createJevClient(options as JevClientOptions);
  return {
    client,
    model: client.model,
    usdPerMillionTokens: client.usdPerMillionTokens,
    ask: client.ask.bind(client),
    run: (node, input, opts = {}) => run(node, input, { ...opts, jev: client }),
    stream: (node, input, opts = {}) => stream(node, input, { ...opts, jev: client }),
  };
}

export type { SerializedError, SpanStatus };
