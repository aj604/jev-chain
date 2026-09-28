/**
 * Rehearsal: run a chain without asking Jev. A stand-in client answers every
 * question with numbers derived from a hash of the state and the question, so
 * the same input always takes the same path and different inputs can take
 * different ones. The chain, the runtime, the decisions and the trace are all
 * real; only the judgement is made up.
 *
 * For exploring a chain's shape (every branch, gate and fallback) when there's
 * no key, or when you don't want to spend one. Rehearsal traces say so in
 * `trace.models`, and the UI badges them wherever a trace is shown.
 */
import type { Answer, AskResult, Entry, JevClient, Question, Questions, Trace } from "jevchain";

/** The model id every rehearsal call reports. `isRehearsal` keys off it. */
export const REHEARSAL_MODEL = "rehearsal";

export interface RehearsalOptions {
  /** Simulated latency range per ask, ms. Default [24, 72]: enough to watch the trace paint. */
  latencyMs?: readonly [number, number];
}

/** A JevClient that never touches the network. */
export function rehearsalClient(options: RehearsalOptions = {}): JevClient {
  const [lo, hi] = options.latencyMs ?? [24, 72];
  let n = 0;
  return {
    model: REHEARSAL_MODEL,
    usdPerMillionTokens: 0,
    async ask<const Q extends Questions>(state: Entry, questions: Q, askOptions: { signal?: AbortSignal } = {}): Promise<AskResult<Q>> {
      const i = n++;
      const answers = Object.fromEntries(Object.entries(questions).map(([k, q]) => [k, rehearsalAnswer(state, k, q)]));
      const latencyMs = Math.round(lo + (hi - lo) * rng(seedOf(state, "latency"))());
      await sleep(latencyMs, askOptions.signal);
      return {
        answers: answers as AskResult<Q>["answers"],
        model: REHEARSAL_MODEL,
        usage: { inputTokens: Math.round((JSON.stringify(state).length + JSON.stringify(questions).length) / 4), outputTokens: 0 },
        costUsd: 0,
        latencyMs,
        attempts: 1,
        requestId: `rehearsal_${i + 1}`,
      };
    },
  };
}

/**
 * The made-up answer to one question: deterministic in (state, key, question).
 * Distributions are softmaxed from hashed logits, so most answers have a clear
 * winner and some are close calls (which is what exercises low-confidence
 * fallbacks and unsure bands).
 */
export function rehearsalAnswer(state: Entry, key: string, question: Question): Answer {
  const next = rng(seedOf(state, key, question));
  switch (question.type) {
    case "noul":
      return { type: "noul", noul: round(next()) };
    case "choice": {
      const labels = Object.keys(question.criteria);
      const probs = softmax(labels.map(() => next() * 7));
      const probabilities = Object.fromEntries(labels.map((l, i) => [l, probs[i]!]));
      const choice = labels[probs.indexOf(Math.max(...probs))]!;
      return { type: "choice", choice, probabilities, confidence: confidence(probs) };
    }
    case "score": {
      const probs = softmax(question.criteria.map(() => next() * 7));
      return {
        type: "score",
        score: round(probs.reduce((s, p, i) => s + i * p, 0)),
        probabilities: Object.fromEntries(probs.map((p, i) => [String(i), p])),
        legend: Object.fromEntries(question.criteria.map((c, i) => [String(i), c])),
        confidence: confidence(probs),
      };
    }
  }
}

/**
 * True when any call in this trace was answered by the rehearsal client,
 * including a call a stand-in client relabelled (a what-if reports model
 * `"what-if"` but keeps `…:rehearsal` at the end of the requestId).
 */
export function isRehearsal(trace: (Pick<Trace, "models"> & Partial<Pick<Trace, "spans">>) | undefined): boolean {
  if (!trace) return false;
  return trace.models.includes(REHEARSAL_MODEL) || Boolean(trace.spans?.some((s) => s.calls.some((c) => c.requestId?.endsWith(`:${REHEARSAL_MODEL}`))));
}

function softmax(logits: number[]): number[] {
  const max = Math.max(...logits);
  const exps = logits.map((l) => Math.exp(l - max));
  const sum = exps.reduce((a, b) => a + b, 0);
  const probs = exps.map((e) => round(e / sum));
  // Rounding can leave the total a hair off 1; give the remainder to the leader.
  const lead = probs.indexOf(Math.max(...probs));
  probs[lead] = round(probs[lead]! + 1 - probs.reduce((a, b) => a + b, 0));
  return probs;
}

/** 1 − normalized entropy: 0 for uniform, 1 for all-in. */
function confidence(ps: number[]): number {
  if (ps.length < 2) return 1;
  const h = -ps.reduce((s, p) => (p > 0 ? s + p * Math.log(p) : s), 0);
  return round(Math.max(0, 1 - h / Math.log(ps.length)));
}

function seedOf(...parts: unknown[]): number {
  const s = JSON.stringify(parts);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** mulberry32: small, fast, good enough to make up numbers with. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round = (v: number) => Math.round(v * 1000) / 1000;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}
