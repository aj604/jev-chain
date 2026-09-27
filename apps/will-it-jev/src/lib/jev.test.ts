import { afterEach, describe, expect, it, vi } from "vitest";
import { ladder } from "@/test/fixtures";
import { COPY } from "./copy";
import { BROWSER_TIMEOUT_MS, browserJev } from "./jev";
import { runRecipe } from "./run";

interface Sent {
  url: string;
  headers: Record<string, string>;
  signal: AbortSignal | undefined;
}

/**
 * Replaces the global fetch, which `browserJev` picks up when it's made.
 * Every request gets `respond()`, or hangs until aborted when it's undefined.
 */
function stubFetch(respond?: () => Response): Sent[] {
  const sent: Sent[] = [];
  vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
    sent.push({ url, headers: { ...(init?.headers as Record<string, string>) }, signal: init?.signal ?? undefined });
    if (respond) return Promise.resolve(respond());
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
    });
  });
  return sent;
}

function proxyError(status: number, type: string, message: string, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify({ error: { type, message } }), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("browserJev", () => {
  it("posts to the same-origin proxy with no key", async () => {
    // Even where a key is lying around, the proxy adds it, never the browser.
    vi.stubEnv("TYPESAFE_API_KEY", "not-a-real-key");
    const sent = stubFetch(() => proxyError(500, "upstream_unreachable", COPY.jevCrashed));
    await runRecipe(browserJev(), ladder(1), "x");
    expect(sent.length).toBeGreaterThan(0);
    for (const s of sent) {
      expect(s.url).toBe("/api/jev");
      expect(Object.keys(s.headers).map((h) => h.toLowerCase())).not.toContain("authorization");
    }
  });

  it("ends a rate-limited run fast, without waiting out a long retry-after", async () => {
    const sent = stubFetch(() => proxyError(429, "rate_limited", COPY.rateLimited, { "retry-after": "20" }));
    const started = performance.now();
    const run = await runRecipe(browserJev(), ladder(1), "x");
    const elapsed = performance.now() - started;

    expect(run.failure).toBe("rate-limited");
    expect(elapsed).toBeLessThan(2_000);
    // One quick retry, then it gives up.
    expect(sent).toHaveLength(2);
  });

  it("ends a paused run fast", async () => {
    stubFetch(() => proxyError(503, "paused", COPY.paused));
    const started = performance.now();
    const run = await runRecipe(browserJev(), ladder(1), "x");
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(run.failure).toBe("paused");
  });

  it("waits past the proxy's 30-second upstream wait before giving up on a request", async () => {
    vi.useFakeTimers();
    const sent = stubFetch();
    const asked = browserJev().ask("x", { a: { type: "noul", instructions: "A?" } });
    asked.catch(() => {});

    await vi.advanceTimersByTimeAsync(30_000);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(BROWSER_TIMEOUT_MS - 30_000);
    expect(sent[0]!.signal?.aborted).toBe(true);
  });
});
