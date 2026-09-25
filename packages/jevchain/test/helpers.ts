import type { Answer, Entry, Question, Questions } from "../src/index.js";

/** Decide an answer for one question. Return a partial to override the default. */
export type Oracle = (state: Entry, key: string, q: Question) => Partial<Answer> | undefined;

export interface FakeCall {
  state: Entry;
  model: string;
  questions: Questions;
}

/** Build a canned answer: first label wins with p=0.9, nouls 0.9, scores at the top. */
export function answerFor(q: Question, override?: Partial<Answer>): Answer {
  if (q.type === "choice") {
    const labels = Object.keys(q.criteria);
    const want = (override as { choice?: string } | undefined)?.choice ?? labels[0]!;
    const rest = (1 - 0.9) / Math.max(1, labels.length - 1);
    const probabilities = Object.fromEntries(labels.map((l) => [l, l === want ? 0.9 : rest]));
    return { type: "choice", choice: want, probabilities, confidence: 0.85, ...override } as Answer;
  }
  if (q.type === "score") {
    const n = q.criteria.length;
    const probabilities = Object.fromEntries(q.criteria.map((_, i) => [String(i), i === n - 1 ? 1 : 0]));
    const legend = Object.fromEntries(q.criteria.map((d, i) => [String(i), d]));
    return { type: "score", score: n - 1, probabilities, legend, confidence: 0.9, ...override } as Answer;
  }
  return { type: "noul", noul: 0.9, ...override } as Answer;
}

/**
 * A fetch that speaks TypeSafe's wire format, driven by an oracle.
 * Records every call. `script` can force statuses for the first N calls.
 */
export function fakeFetch(oracle: Oracle = () => undefined, opts: { latencyMs?: number; statuses?: number[]; headers?: Record<string, string> } = {}) {
  const calls: FakeCall[] = [];
  const statuses = [...(opts.statuses ?? [])];
  const fn = (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as FakeCall;
    calls.push(body);
    if (opts.latencyMs) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, opts.latencyMs);
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(t);
          reject(init.signal!.reason ?? new Error("aborted"));
        });
      });
    }
    const status = statuses.shift();
    if (status && status !== 200) {
      return new Response(JSON.stringify({ detail: { error_type: "nope", message: `status ${status}` } }), {
        status,
        headers: { "content-type": "application/json", ...opts.headers },
      });
    }
    const answers = Object.fromEntries(Object.entries(body.questions).map(([k, q]) => [k, answerFor(q, oracle(body.state, k, q))]));
    return new Response(JSON.stringify({ model: "jev-1.13.0", answers, usage: { input_tokens: 100, output_tokens: 10 } }), {
      status: 200,
      headers: { "content-type": "application/json", "x-typesafe-request-id": `req_${calls.length}` },
    });
  }) as typeof fetch;
  return Object.assign(fn, { calls });
}
