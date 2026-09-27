import { createJevClient, type Answer, type JevClient, type Question, type Questions } from "jevchain";

/**
 * A fake Jev for tests. The real jevchain client runs over a fake `fetch`
 * that speaks TypeSafe's wire format, so batching and request counts are
 * genuine. Retries are off, so a failing status fails once.
 */

/** Overrides the default answer for one question. Return undefined to keep it. */
export type Oracle = (q: Question) => Partial<Answer> | undefined;

/**
 * The default answer, with `override` on top. A noul says 0.1, a score says
 * level 0, and a choice picks the first label (or `override.choice`) at 0.9,
 * with the rest sharing 0.1.
 */
export function answerFor(q: Question, override?: Partial<Answer>): Answer {
  if (q.type === "choice") {
    const labels = Object.keys(q.criteria);
    const want = (override as { choice?: string } | undefined)?.choice ?? labels[0];
    const rest = 0.1 / Math.max(1, labels.length - 1);
    const probabilities = Object.fromEntries(labels.map((l) => [l, l === want ? 0.9 : rest]));
    return { type: "choice", choice: want, probabilities, confidence: 0.9, ...override } as Answer;
  }
  if (q.type === "score") {
    const probabilities = Object.fromEntries(q.criteria.map((_, i) => [String(i), i === 0 ? 1 : 0]));
    const legend = Object.fromEntries(q.criteria.map((level, i) => [String(i), level]));
    return { type: "score", score: 0, probabilities, legend, confidence: 0.9, ...override } as Answer;
  }
  return { type: "noul", noul: 0.1, ...override } as Answer;
}

/**
 * Answers by question text. A script key matches when it is a substring of
 * the question's instructions. When several match, the longest wins, so
 * "gate 10?" beats "gate 1".
 */
export function byQuestion(script: Record<string, Partial<Answer>>): Oracle {
  const keys = Object.keys(script).sort((a, b) => b.length - a.length);
  return (q) => {
    const text = typeof q.instructions === "string" ? q.instructions : JSON.stringify(q.instructions);
    const key = keys.find((k) => text.includes(k));
    return key === undefined ? undefined : script[key];
  };
}

export interface FakeRequest {
  state: unknown;
  questions: Questions;
}

/**
 * `status` makes every request fail with that HTTP status. `body` replaces
 * the failure's default body, e.g. to send the proxy's own error shape.
 */
export function fakeJev(
  oracle: Oracle = () => undefined,
  opts: { status?: number; body?: unknown } = {},
): { client: JevClient; requests: FakeRequest[] } {
  const requests: FakeRequest[] = [];
  const fetch = (async (_url: string, init?: RequestInit) => {
    const { state, questions } = JSON.parse(String(init?.body)) as FakeRequest;
    requests.push({ state, questions });
    if (opts.status !== undefined && opts.status !== 200) {
      const body = "body" in opts ? opts.body : { detail: { error_type: "fake", message: `status ${opts.status}` } };
      return json(opts.status, body);
    }
    const answers = Object.fromEntries(
      Object.entries(questions).map(([key, q]) => [key, answerFor(q, oracle(q))]),
    );
    return json(200, { model: "jev-fake", answers, usage: { input_tokens: 100, output_tokens: 10 } });
  }) as typeof globalThis.fetch;
  const client = createJevClient({ apiKey: null, fetch, retry: { maxRetries: 0 } });
  return { client, requests };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}
