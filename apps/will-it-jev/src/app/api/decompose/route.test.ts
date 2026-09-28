import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { COPY } from "@/lib/copy";
import { FIRST_ATTEMPT_MS, MAX_THING, MIN_THING, TOTAL_MS } from "@/lib/decompose/decompose";
import { MAX_BODY_BYTES } from "@/lib/jev-request";
import { desk } from "@/test/fixtures";

// The real prompt shows curated recipes, which this test doesn't depend on.
vi.mock("@/lib/decompose/prompt", () => ({ SYSTEM_PROMPT: "You turn a thing someone wrote into a recipe." }));

type Route = typeof import("./route");

const COMPLETIONS = "https://llm.test/v1/chat/completions";
const THING = "Hey. I don't want to keep seeing each other. I wish you well.";
const DESK = desk();
const GOOD = JSON.stringify(DESK);
/** Valid JSON, but the title breaks the tone rule, so the validator's message quotes the reply. */
const LOUD = GOOD.replace("The Appliance Dispatch Desk", "The Appliance Dispatch Desk!");

/** An OpenAI-style chat completion whose first choice says `content`. */
const completion = (content: string) =>
  Response.json({ id: "c1", choices: [{ index: 0, message: { role: "assistant", content } }] });

/** A fetch that never answers, and rejects with the signal's reason when it aborts. */
const hanging = (_url: unknown, init?: RequestInit) =>
  new Promise<Response>((_, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
  });

let route: Route;
let fetchMock: Mock<typeof fetch>;

/** POSTs `payload`, forwarded from `ip`, or with no forwarding header when `ip` is null. */
function post(
  payload: unknown,
  {
    ip = "203.0.113.7",
    headers = {},
    signal,
  }: { ip?: string | null; headers?: Record<string, string>; signal?: AbortSignal } = {},
) {
  return route.POST(
    new Request("http://localhost/api/decompose", {
      method: "POST",
      headers: { "content-type": "application/json", ...(ip ? { "x-forwarded-for": ip } : {}), ...headers },
      body: typeof payload === "string" ? payload : JSON.stringify(payload),
      signal,
    }),
  );
}

async function expectError(res: Response, status: number, message: string) {
  expect(res.status).toBe(status);
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(await res.json()).toEqual({ error: message });
}

beforeEach(async () => {
  // A fresh module per test, so the module-level rate limiter starts empty
  // and test order doesn't matter.
  vi.resetModules();
  route = await import("./route");
  vi.stubEnv("PAUSED", "");
  vi.stubEnv("LLM_API_KEY", "sk-llm");
  vi.stubEnv("LLM_MODEL", "some/model");
  vi.stubEnv("LLM_BASE_URL", "https://llm.test/v1");
  fetchMock = vi.fn<typeof fetch>(async () => completion(GOOD));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("GET /api/decompose", () => {
  it("reports enabled only with both the key and the model, uncached", async () => {
    vi.stubEnv("LLM_API_KEY", "");
    vi.stubEnv("LLM_MODEL", "");
    let res = route.GET();
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true, enabled: false, paused: false });

    vi.stubEnv("LLM_API_KEY", "sk-llm");
    expect(await route.GET().json()).toEqual({ ok: true, enabled: false, paused: false });

    vi.stubEnv("LLM_MODEL", "some/model");
    res = route.GET();
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true, enabled: true, paused: false });

    vi.stubEnv("LLM_API_KEY", "   ");
    expect(await route.GET().json()).toEqual({ ok: true, enabled: false, paused: false });
  });

  it("reports paused", async () => {
    vi.stubEnv("PAUSED", "1");
    const res = route.GET();
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true, enabled: true, paused: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("POST /api/decompose", () => {
  it("returns exactly { recipe }, the validated recipe, for a good model reply", async () => {
    const res = await post({ thing: `  ${THING}\n` });

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-ratelimit-limit")).toBe("20");
    expect(res.headers.get("x-ratelimit-remaining")).toBe("19");
    expect(await res.json()).toStrictEqual({ recipe: DESK });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(COMPLETIONS);
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer sk-llm");
    const sent = JSON.parse(String(init?.body)) as { model: string; messages: { role: string; content: string }[] };
    expect(sent.model).toBe("some/model");
    // The thing goes to the model trimmed.
    expect(sent.messages.at(-1)).toEqual({ role: "user", content: THING });
  });

  it("returns 502 with the wontJev line after two bad replies", async () => {
    fetchMock.mockImplementation(async () => completion(LOUD));
    await expectError(await post({ thing: THING }), 502, COPY.wontJev);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns 502 when the model answers with an error status", async () => {
    fetchMock.mockResolvedValue(new Response("overloaded", { status: 529 }));
    await expectError(await post({ thing: THING }), 502, COPY.wontJev);
  });

  it("returns 502 when the model can't be reached", async () => {
    fetchMock.mockRejectedValue(new TypeError("fetch failed"));
    await expectError(await post({ thing: THING }), 502, COPY.wontJev);
  });

  describe("time budget (fake timers, the route's real budgets)", () => {
    /** Starts a POST under fake timers and records when it settles. */
    function start() {
      vi.useFakeTimers();
      const t0 = Date.now();
      const state: { res?: Response; at?: number } = {};
      const done = post({ thing: THING }).then((res) => {
        state.res = res;
        state.at = Date.now() - t0;
      });
      return { state, done };
    }

    it("gives 502 within the total budget when the model never answers", async () => {
      fetchMock.mockImplementation(hanging);
      const run = start();

      await vi.advanceTimersByTimeAsync(FIRST_ATTEMPT_MS - 1);
      expect(run.state.res).toBeUndefined();
      await vi.advanceTimersByTimeAsync(TOTAL_MS - FIRST_ATTEMPT_MS + 1);
      await run.done;

      // Cut at the first attempt's budget; running out of time isn't retried.
      expect(run.state.at).toBe(FIRST_ATTEMPT_MS);
      expect(run.state.at).toBeLessThanOrEqual(TOTAL_MS);
      await expectError(run.state.res!, 502, COPY.wontJev);
      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it("cuts a hanging retry at the total budget", async () => {
      fetchMock.mockImplementationOnce(async () => completion(LOUD)).mockImplementation(hanging);
      const run = start();

      await vi.advanceTimersByTimeAsync(TOTAL_MS - 1);
      expect(run.state.res).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      await run.done;

      expect(run.state.at).toBe(TOTAL_MS);
      await expectError(run.state.res!, 502, COPY.wontJev);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  it("stops the model call when the caller disconnects", async () => {
    fetchMock.mockImplementation(hanging);
    const caller = new AbortController();
    const pending = post({ thing: THING }, { signal: caller.signal });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const upstreamSignal = fetchMock.mock.calls[0][1]?.signal;
    expect(upstreamSignal?.aborted).toBe(false);

    caller.abort();
    await expectError(await pending, 502, COPY.wontJev);
    expect(upstreamSignal?.aborted).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  describe("PAUSED", () => {
    it.each([["1"], ["yes"], [" 0 "]])("returns 503 and never calls fetch when PAUSED is %j", async (value) => {
      vi.stubEnv("PAUSED", value);
      await expectError(await post({ thing: THING }), 503, COPY.paused);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("comes before every other check", async () => {
      vi.stubEnv("PAUSED", "1");
      vi.stubEnv("LLM_API_KEY", "");
      await expectError(await post("not json"), 503, COPY.paused);
    });

    it("does nothing when blank", async () => {
      vi.stubEnv("PAUSED", "  ");
      expect((await post({ thing: THING })).status).toBe(200);
    });
  });

  describe("disabled", () => {
    it.each([
      ["no key", { LLM_API_KEY: "" }],
      ["no model", { LLM_MODEL: "" }],
      ["a blank key", { LLM_API_KEY: "  " }],
    ])("returns 503 with the decomposer-off line with %s", async (_, env) => {
      for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
      await expectError(await post({ thing: THING }), 503, COPY.decomposerOff);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("comes before the rate limit and the body", async () => {
      vi.stubEnv("LLM_MODEL", "");
      for (let i = 0; i < 21; i++) await expectError(await post("not json"), 503, COPY.decomposerOff);
      // Disabled requests weren't charged.
      vi.stubEnv("LLM_MODEL", "some/model");
      expect((await post({ thing: THING })).headers.get("x-ratelimit-remaining")).toBe("19");
    });
  });

  describe("rate limit", () => {
    it("gives the 21st request in a minute from one IP a 429 with retry-after", async () => {
      for (let i = 0; i < 20; i++) expect((await post({ thing: THING })).status).toBe(200);

      const res = await post({ thing: THING });
      expect(res.headers.get("retry-after")).toMatch(/^\d+$/);
      expect(Number(res.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
      expect(Number(res.headers.get("retry-after"))).toBeLessThanOrEqual(60);
      expect(res.headers.get("x-ratelimit-limit")).toBe("20");
      expect(res.headers.get("x-ratelimit-remaining")).toBe("0");
      await expectError(res, 429, COPY.rateLimited);
      expect(fetchMock).toHaveBeenCalledTimes(20);

      // Another IP has its own bucket.
      expect((await post({ thing: THING }, { ip: "198.51.100.1" })).status).toBe(200);
    });

    it("frees up after a minute", async () => {
      vi.useFakeTimers();
      // The limiter takes its clock when the module loads, so load it under fake timers.
      vi.resetModules();
      route = await import("./route");
      for (let i = 0; i < 20; i++) await post({ thing: THING });
      expect((await post({ thing: THING })).status).toBe(429);
      vi.advanceTimersByTime(60_000);
      expect((await post({ thing: THING })).status).toBe(200);
    });

    it("reads x-real-ip when there is no x-forwarded-for", async () => {
      const opts = { ip: null, headers: { "x-real-ip": "198.51.100.9" } };
      for (let i = 0; i < 20; i++) expect((await post({ thing: THING }, opts)).status).toBe(200);
      expect((await post({ thing: THING }, opts)).status).toBe(429);
      expect((await post({ thing: THING })).status).toBe(200);
    });

    it("puts requests with no forwarding header in one shared bucket", async () => {
      const client = (i: number) => ({ ip: null, headers: { "user-agent": `client ${i}` } });
      for (let i = 0; i < 20; i++) expect((await post({ thing: THING }, client(i))).status).toBe(200);
      await expectError(await post({ thing: THING }, client(20)), 429, COPY.rateLimited);
      // Forwarded requests don't draw on it.
      expect((await post({ thing: THING })).status).toBe(200);
    });

    it("is charged before the body is read, so bad bodies count", async () => {
      for (let i = 0; i < 20; i++) await expectError(await post("not json"), 400, COPY.tooShort);
      await expectError(await post("not json"), 429, COPY.rateLimited);
      await expectError(await post({ thing: THING }), 429, COPY.rateLimited);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("the body", () => {
    it.each<[string, unknown]>([
      ["not JSON", "{ thing: nope"],
      ["empty", ""],
      ["JSON null", "null"],
      ["a bare string", JSON.stringify(THING)],
      ["an array", [{ thing: THING }]],
      ["missing thing", { text: THING }],
      ["a number", { thing: 42 }],
      ["null", { thing: null }],
      ["an array thing", { thing: [THING] }],
      ["an object thing", { thing: { text: THING } }],
    ])("returns 400 with the too-short line for %s", async (_, payload) => {
      await expectError(await post(payload), 400, COPY.tooShort);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("length", () => {
    it.each([[""], ["x"], [" x "], ["   \n\t "]])("returns 400 with the too-short line for %j", async (thing) => {
      await expectError(await post({ thing }), 400, COPY.tooShort);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("returns 400 with the too-long line over 2000 characters", async () => {
      await expectError(await post({ thing: "x".repeat(MAX_THING + 1) }), 400, COPY.tooLong);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("measures after trimming", async () => {
      expect((await post({ thing: " xy " })).status).toBe(200);
      expect((await post({ thing: `  ${"x".repeat(MAX_THING)}  ` })).status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("accepts exactly the bounds", async () => {
      expect((await post({ thing: "x".repeat(MIN_THING) })).status).toBe(200);
      expect((await post({ thing: "x".repeat(MAX_THING) })).status).toBe(200);
    });

    it("says the real cap in the too-long line", () => {
      expect(MAX_THING).toBe(2000);
      expect(COPY.tooLong).toContain(MAX_THING.toLocaleString("en-US"));
    });

    it("returns 400 with the too-long line for a body over the size cap, before reading it", async () => {
      await expectError(await post({ thing: THING, pad: "x".repeat(MAX_BODY_BYTES) }), 400, COPY.tooLong);
      const res = await post({ thing: THING }, { headers: { "content-length": String(MAX_BODY_BYTES + 1) } });
      await expectError(res, 400, COPY.tooLong);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it("never logs the body, the thing, the model's reply or the validator's message", async () => {
    const spies = (["log", "info", "warn", "error", "debug", "trace"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );

    await post({ thing: THING });
    fetchMock.mockImplementation(async () => completion(LOUD));
    await post({ thing: THING });
    fetchMock.mockResolvedValue(new Response(`upstream said: ${THING}`, { status: 500 }));
    await post({ thing: THING });
    fetchMock.mockRejectedValue(new TypeError(`fetch failed for ${THING}`));
    await post({ thing: THING });
    await post(`{ "thing": ${JSON.stringify(THING)}`);
    await post({ thing: "x".repeat(MAX_THING + 1) });

    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
