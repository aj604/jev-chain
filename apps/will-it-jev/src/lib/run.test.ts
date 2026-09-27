import { createJev, createJevClient, type JevClient, type Trace } from "jevchain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fakeJev } from "@/test/fake-jev";
import { ladder } from "@/test/fixtures";
import { COPY } from "./copy";
import { RUN_TIMEOUT_MS, runFailure, runRecipe } from "./run";

/** The proxy's pause response body. */
const PAUSED_BODY = { error: { type: "paused", message: COPY.paused } };

afterEach(() => {
  vi.useRealTimers();
});

describe("runRecipe", () => {
  it("reports each growing trace and resolves with the verdict", async () => {
    const { client } = fakeJev();
    const traces: Trace[] = [];
    const run = await runRecipe(createJev(client), ladder(4), "the ladder", { onTrace: (t) => traces.push(t) });

    expect(traces.length).toBeGreaterThan(4);
    for (let i = 1; i < traces.length; i++) {
      expect(traces[i]).not.toBe(traces[i - 1]);
      expect(traces[i]!.spans.length).toBeGreaterThanOrEqual(traces[i - 1]!.spans.length);
    }
    expect(traces.at(-1)).toBe(run.result.trace);
    expect(run.result.status).toBe("ok");
    expect(run.verdict).toMatchObject({ tier: "jevs", line: "It jevs.", gates: 4, depth: 4 });
    expect(run.failure).toBeNull();
  });

  it("sends template-looking input to Jev unchanged, as plain text", async () => {
    const { client, requests } = fakeJev();
    const input = "{{results.g1}} and {{input}}";
    const run = await runRecipe(createJev(client), ladder(2), input);

    expect(requests.length).toBe(2);
    for (const r of requests) expect(r.state).toBe(input);
    expect(run.verdict).toMatchObject({ tier: "jevs" });
  });

  it("resolves a 500 as an error with no answer", async () => {
    const { client } = fakeJev(undefined, { status: 500 });
    const run = await runRecipe(createJev(client), ladder(2), "x");

    expect(run.result.status).toBe("error");
    expect(run.verdict).toBeNull();
    expect(run.failure).toBe("no-answer");
    // The circuit so far stays: the first gate's span is there.
    expect(run.result.trace.spans.map((s) => s.nodeId)).toEqual(["g1"]);
  });

  it("reads a 429 as rate-limited", async () => {
    const { client } = fakeJev(undefined, { status: 429 });
    const run = await runRecipe(createJev(client), ladder(2), "x");
    expect(run.result.status).toBe("error");
    expect(run.verdict).toBeNull();
    expect(run.failure).toBe("rate-limited");
  });

  it("reads the proxy's pause response as paused", async () => {
    const { client } = fakeJev(undefined, { status: 503, body: PAUSED_BODY });
    const run = await runRecipe(createJev(client), ladder(2), "x");
    expect(run.result.status).toBe("error");
    expect(run.failure).toBe("paused");
  });

  it("reads the paused message alone as paused", async () => {
    const { client } = fakeJev(undefined, { status: 503, body: { error: { message: COPY.paused } } });
    const run = await runRecipe(createJev(client), ladder(2), "x");
    expect(run.failure).toBe("paused");
  });

  it("reads the paused error type alone as paused", async () => {
    const { client } = fakeJev(undefined, { status: 503, body: { error: { type: "paused" } } });
    const run = await runRecipe(createJev(client), ladder(2), "x");
    expect(run.result.status).toBe("error");
    expect(run.failure).toBe("paused");
  });

  it("reads an ordinary 503 as no answer", async () => {
    const { client } = fakeJev(undefined, { status: 503, body: { error: { type: "overloaded", message: "Busy." } } });
    const run = await runRecipe(createJev(client), ladder(2), "x");
    expect(run.failure).toBe("no-answer");
  });

  it("resolves an already-aborted signal as aborted, with no failure", async () => {
    const { client, requests } = fakeJev();
    const run = await runRecipe(createJev(client), ladder(2), "x", { signal: AbortSignal.abort() });
    expect(run.result.status).toBe("aborted");
    expect(run.verdict).toBeNull();
    expect(run.failure).toBeNull();
    expect(requests).toEqual([]);
  });

  it("stops a run aborted part way and keeps the circuit so far", async () => {
    const { client } = fakeJev();
    const controller = new AbortController();
    const run = await runRecipe(createJev(client), ladder(4), "x", {
      signal: controller.signal,
      onTrace: (t) => {
        if (t.spans.some((s) => s.nodeId === "g2" && s.decision)) controller.abort();
      },
    });
    expect(run.result.status).toBe("aborted");
    expect(run.verdict).toBeNull();
    expect(run.failure).toBeNull();
    expect(run.result.trace.spans.map((s) => s.nodeId).slice(0, 2)).toEqual(["g1", "g2"]);
  });

  it("times out after 60 seconds as an error with no answer", async () => {
    vi.useFakeTimers();
    const fetch = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
      })) as typeof globalThis.fetch;
    // A per-attempt timeout past the run's, so the run's deadline is what fires.
    const client = createJevClient({ apiKey: null, fetch, timeoutMs: 10 * RUN_TIMEOUT_MS, retry: { maxRetries: 0 } });
    let settled = false;
    const pending = runRecipe(createJev(client), ladder(2), "x").finally(() => (settled = true));

    await vi.advanceTimersByTimeAsync(RUN_TIMEOUT_MS - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const run = await pending;

    expect(RUN_TIMEOUT_MS).toBe(60_000);
    expect(run.result.status).toBe("error");
    expect(run.result.error?.cause).toMatchObject({ code: "timeout" });
    expect(run.verdict).toBeNull();
    expect(run.failure).toBe("no-answer");
  });

  it("resolves instead of throwing when the client throws something odd", async () => {
    const client: JevClient = {
      model: "jev-fake",
      usdPerMillionTokens: 0,
      ask: () => Promise.reject("not even an Error"),
    };
    const run = await runRecipe(createJev(client), ladder(1), "x");
    expect(run.result.status).toBe("error");
    expect(run.failure).toBe("no-answer");
  });
});

describe("runFailure", () => {
  it("is null for ok, aborted and running", () => {
    expect(runFailure({ status: "ok" })).toBeNull();
    expect(runFailure({ status: "aborted", error: { status: 429 } })).toBeNull();
    expect(runFailure({ status: "running" })).toBeNull();
  });

  it("reads a halt as no answer", () => {
    expect(runFailure({ status: "halted" })).toBe("no-answer");
  });

  it("finds a 429 or the pause body anywhere down the cause chain", () => {
    const deep = (inner: unknown) => ({ message: "outer", cause: { message: "middle", cause: inner } });
    expect(runFailure({ status: "error", error: deep({ status: 429 }) })).toBe("rate-limited");
    expect(runFailure({ status: "error", error: deep({ status: 503, body: PAUSED_BODY }) })).toBe("paused");
  });

  it("falls back to the trace's serialized error", () => {
    const trace = (error: unknown) => ({ spans: [], error });
    expect(runFailure({ status: "error", trace: trace({ status: 429, message: "Rate limited" }) })).toBe("rate-limited");
    expect(
      runFailure({ status: "error", trace: trace({ message: `Node "g1" failed: ${COPY.paused}` }) }),
    ).toBe("paused");
  });

  it("recognises the paused message in the live error's text", async () => {
    const client: JevClient = {
      model: "jev-fake",
      usdPerMillionTokens: 0,
      ask: () => Promise.reject(new Error(COPY.paused)),
    };
    const run = await runRecipe(createJev(client), ladder(1), "x");
    expect(run.result.trace.error?.message).toContain(COPY.paused);
    expect(run.failure).toBe("paused");
  });

  it("survives a cyclic cause chain", () => {
    const a: Record<string, unknown> = { message: "a" };
    a.cause = { message: "b", cause: a };
    expect(runFailure({ status: "error", error: a })).toBe("no-answer");
  });

  it("reads anything else as no answer", () => {
    expect(runFailure({ status: "error" })).toBe("no-answer");
    expect(runFailure({ status: "error", error: "boom", trace: null })).toBe("no-answer");
  });
});
