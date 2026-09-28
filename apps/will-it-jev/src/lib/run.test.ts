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
  it("reports each growing trace and resolves with the result", async () => {
    const { client } = fakeJev();
    const traces: Trace[] = [];
    const out = await runRecipe(createJev(client), ladder(4), "the ladder", { onTrace: (t) => traces.push(t) });

    expect(traces.length).toBeGreaterThan(4);
    for (let i = 1; i < traces.length; i++) {
      expect(traces[i]).not.toBe(traces[i - 1]);
      expect(traces[i]!.spans.length).toBeGreaterThanOrEqual(traces[i - 1]!.spans.length);
    }
    expect(traces.at(-1)).toBe(out.run.trace);
    expect(out.run.status).toBe("ok");
    expect(out.result).toMatchObject({ outcome: { key: "through" }, score: null, gates: 4, depth: 4 });
    expect(out.failure).toBeNull();
  });

  it("sends template-looking input to Jev unchanged, as plain text", async () => {
    const { client, requests } = fakeJev();
    const input = "{{results.g1}} and {{input}}";
    const out = await runRecipe(createJev(client), ladder(2), input);

    expect(requests.length).toBe(2);
    for (const r of requests) expect(r.state).toBe(input);
    expect(out.result).toMatchObject({ outcome: { key: "through" } });
  });

  it("resolves a 500 as an error with no answer", async () => {
    const { client } = fakeJev(undefined, { status: 500 });
    const out = await runRecipe(createJev(client), ladder(2), "x");

    expect(out.run.status).toBe("error");
    expect(out.result).toBeNull();
    expect(out.failure).toBe("no-answer");
    // The circuit so far stays: the first gate's span is there.
    expect(out.run.trace.spans.map((s) => s.nodeId)).toEqual(["g1"]);
  });

  it("reads a 429 as rate-limited", async () => {
    const { client } = fakeJev(undefined, { status: 429 });
    const out = await runRecipe(createJev(client), ladder(2), "x");
    expect(out.run.status).toBe("error");
    expect(out.result).toBeNull();
    expect(out.failure).toBe("rate-limited");
  });

  it("reads the proxy's pause response as paused", async () => {
    const { client } = fakeJev(undefined, { status: 503, body: PAUSED_BODY });
    const out = await runRecipe(createJev(client), ladder(2), "x");
    expect(out.run.status).toBe("error");
    expect(out.failure).toBe("paused");
  });

  it("reads the paused message alone as paused", async () => {
    const { client } = fakeJev(undefined, { status: 503, body: { error: { message: COPY.paused } } });
    const out = await runRecipe(createJev(client), ladder(2), "x");
    expect(out.failure).toBe("paused");
  });

  it("reads the paused error type alone as paused", async () => {
    const { client } = fakeJev(undefined, { status: 503, body: { error: { type: "paused" } } });
    const out = await runRecipe(createJev(client), ladder(2), "x");
    expect(out.run.status).toBe("error");
    expect(out.failure).toBe("paused");
  });

  it("reads an ordinary 503 as no answer", async () => {
    const { client } = fakeJev(undefined, { status: 503, body: { error: { type: "overloaded", message: "Busy." } } });
    const out = await runRecipe(createJev(client), ladder(2), "x");
    expect(out.failure).toBe("no-answer");
  });

  it("resolves an already-aborted signal as aborted, with no failure", async () => {
    const { client, requests } = fakeJev();
    const out = await runRecipe(createJev(client), ladder(2), "x", { signal: AbortSignal.abort() });
    expect(out.run.status).toBe("aborted");
    expect(out.result).toBeNull();
    expect(out.failure).toBeNull();
    expect(requests).toEqual([]);
  });

  it("stops a run aborted part way and keeps the circuit so far", async () => {
    const { client } = fakeJev();
    const controller = new AbortController();
    const out = await runRecipe(createJev(client), ladder(4), "x", {
      signal: controller.signal,
      onTrace: (t) => {
        if (t.spans.some((s) => s.nodeId === "g2" && s.decision)) controller.abort();
      },
    });
    expect(out.run.status).toBe("aborted");
    expect(out.result).toBeNull();
    expect(out.failure).toBeNull();
    expect(out.run.trace.spans.map((s) => s.nodeId).slice(0, 2)).toEqual(["g1", "g2"]);
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
    const out = await pending;

    expect(RUN_TIMEOUT_MS).toBe(60_000);
    expect(out.run.status).toBe("error");
    expect(out.run.error?.cause).toMatchObject({ code: "timeout" });
    expect(out.result).toBeNull();
    expect(out.failure).toBe("no-answer");
  });

  it("resolves instead of throwing when the client throws something odd", async () => {
    const client: JevClient = {
      model: "jev-fake",
      usdPerMillionTokens: 0,
      ask: () => Promise.reject("not even an Error"),
    };
    const out = await runRecipe(createJev(client), ladder(1), "x");
    expect(out.run.status).toBe("error");
    expect(out.failure).toBe("no-answer");
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
    const out = await runRecipe(createJev(client), ladder(1), "x");
    expect(out.run.trace.error?.message).toContain(COPY.paused);
    expect(out.failure).toBe("paused");
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
