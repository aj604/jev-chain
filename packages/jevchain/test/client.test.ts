import { describe, expect, it } from "vitest";
import { choice, createJevClient, JevAuthError, JevRateLimitError, JevTimeoutError, JevValidationError, noul } from "../src/index.js";
import { backoff, semaphore, stableStringify } from "../src/client.js";
import { fakeFetch } from "./helpers";

const fast = { initialDelayMs: 1, maxDelayMs: 2 };

describe("client", () => {
  it("sends the exact TypeSafe wire format", async () => {
    const f = fakeFetch();
    const jev = createJevClient({ apiKey: "k", fetch: f, batch: false });
    const r = await jev.ask("hello", { dept: choice("Which?", { billing: "money", bug: null }) });
    expect(f.calls[0]).toEqual({
      state: "hello",
      model: "jev-latest",
      questions: { dept: { type: "choice", instructions: "Which?", criteria: { billing: "money", bug: null } } },
    });
    expect(r.answers.dept.choice).toBe("billing");
    expect(r.model).toBe("jev-1.13.0");
    expect(r.requestId).toBe("req_1");
    expect(r.costUsd).toBeCloseTo(100 * 0.042e-6);
  });

  it("maps statuses to error classes and doesn't retry non-retryables", async () => {
    for (const [status, cls] of [
      [401, JevAuthError],
      [422, JevValidationError],
    ] as const) {
      const f = fakeFetch(undefined, { statuses: [status] });
      const jev = createJevClient({ apiKey: "k", fetch: f, retry: fast });
      await expect(jev.ask("x", { q: noul("?") })).rejects.toBeInstanceOf(cls);
      expect(f.calls).toHaveLength(1);
    }
  });

  it("gives up after maxRetries", async () => {
    const f = fakeFetch(undefined, { statuses: [429, 429, 429, 429] });
    const jev = createJevClient({ apiKey: "k", fetch: f, retry: { ...fast, maxRetries: 2 } });
    await expect(jev.ask("x", { q: noul("?") })).rejects.toBeInstanceOf(JevRateLimitError);
    expect(f.calls).toHaveLength(3);
  });

  it("honors retry-after", () => {
    const policy = { maxRetries: 2, initialDelayMs: 100, maxDelayMs: 1000, jitter: 0, maxRetryAfterMs: 5000 };
    expect(backoff(policy, 1)).toBe(100);
    expect(backoff(policy, 3)).toBe(400);
    expect(backoff(policy, 10)).toBe(1000);
    expect(backoff(policy, 1, new JevRateLimitError(429, null, 1234))).toBe(1234);
    expect(backoff(policy, 1, new JevRateLimitError(429, null, 60_000))).toBe(100);
  });

  it("times out slow attempts", async () => {
    const f = fakeFetch(undefined, { latencyMs: 100 });
    const jev = createJevClient({ apiKey: "k", fetch: f, timeoutMs: 10, retry: { maxRetries: 0 } });
    await expect(jev.ask("x", { q: noul("?") })).rejects.toBeInstanceOf(JevTimeoutError);
  });

  it("batches same-state asks in one tick and splits usage", async () => {
    const f = fakeFetch();
    const jev = createJevClient({ apiKey: "k", fetch: f });
    const [a, b, c] = await Promise.all([
      jev.ask("s", { q: noul("a?") }),
      jev.ask("s", { q: noul("b?") }),
      jev.ask("other", { q: noul("c?") }),
    ]);
    expect(f.calls).toHaveLength(2);
    expect(a.batch).toMatchObject({ size: 2, questions: 2 });
    expect(a.usage.inputTokens).toBe(50);
    expect(b.usage.inputTokens).toBe(50);
    expect(c.batch).toBeUndefined();
    expect(c.usage.inputTokens).toBe(100);
  });

  it("splits oversized batches", async () => {
    const f = fakeFetch();
    const jev = createJevClient({ apiKey: "k", fetch: f, batch: { maxQuestions: 2 } });
    await Promise.all([1, 2, 3].map((i) => jev.ask("s", { q: noul(`${i}?`) })));
    expect(f.calls.map((c) => Object.keys(c.questions).length)).toEqual([2, 1]);
  });

  it("batches by structural state equality", () => {
    expect(stableStringify({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe(stableStringify({ a: [1, { c: 3, d: 2 }], b: 1 }));
  });

  it("limits concurrency", async () => {
    const limit = semaphore(2);
    let active = 0;
    let peak = 0;
    await Promise.all(
      Array.from({ length: 6 }, () =>
        limit(async () => {
          peak = Math.max(peak, ++active);
          await new Promise((r) => setTimeout(r, 5));
          active--;
        }),
      ),
    );
    expect(peak).toBe(2);
  });

  it("drops a queued task whose signal aborts before it gets a slot", async () => {
    const limit = semaphore(1);
    const ran: string[] = [];
    const task = (name: string) => async () => {
      ran.push(name);
      await new Promise((r) => setTimeout(r, 20));
    };
    const ac = new AbortController();
    const first = limit(task("first"));
    const dropped = limit(task("dropped"), ac.signal);
    const next = limit(task("next"));
    ac.abort();
    await expect(dropped).rejects.toMatchObject({ code: "aborted" });
    await Promise.all([first, next]);
    expect(ran).toEqual(["first", "next"]);
  });

  it("never sends a call that was aborted while waiting for a concurrency slot", async () => {
    const f = fakeFetch(undefined, { latencyMs: 100 });
    const jev = createJevClient({ apiKey: "k", fetch: f, maxConcurrency: 1, batch: false });
    const ac = new AbortController();
    const one = jev.ask("one", { q: noul("?") }, { signal: ac.signal });
    const two = jev.ask("two", { q: noul("?") }, { signal: ac.signal });
    setTimeout(() => ac.abort(), 10);
    await expect(one).rejects.toMatchObject({ code: "aborted" });
    await expect(two).rejects.toMatchObject({ code: "aborted" });
    await new Promise((r) => setTimeout(r, 150));
    expect(f.calls.map((c) => c.state)).toEqual(["one"]);
  });

  it("omits the auth header when apiKey is null (proxy mode)", async () => {
    let headers: Record<string, string> = {};
    const f = fakeFetch();
    const spy = (async (url: string, init?: RequestInit) => {
      headers = init?.headers as Record<string, string>;
      return f(url, init);
    }) as typeof fetch;
    const jev = createJevClient({ apiKey: null, baseURL: "/api/jev", path: "", fetch: spy });
    await jev.ask("x", { q: noul("?") });
    expect(headers.authorization).toBeUndefined();
  });
});
