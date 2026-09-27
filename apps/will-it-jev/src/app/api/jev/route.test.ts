import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { COPY } from "@/lib/copy";
import { MAX_BODY_BYTES } from "@/lib/jev-request";
import { CAPS } from "@/lib/recipe/types";

type Route = typeof import("./route");

const UPSTREAM = "https://api.typesafe.ai/v1/systemone";

const body = {
  state: "my breakup text",
  model: "jev-latest",
  questions: { decision: { type: "noul", instructions: "Is it kind?" } },
};

const upstreamAnswer = {
  model: "jev-1",
  answers: { decision: { type: "noul", noul: 0.2 } },
  usage: { input_tokens: 10, output_tokens: 1 },
};

let route: Route;
let fetchMock: Mock<typeof fetch>;

/** POSTs `payload`, forwarded from `ip`, or with no forwarding header when `ip` is null. */
function post(payload: unknown, { ip = "203.0.113.7", headers = {} }: { ip?: string | null; headers?: Record<string, string> } = {}) {
  return route.POST(
    new Request("http://localhost/api/jev", {
      method: "POST",
      headers: { "content-type": "application/json", ...(ip ? { "x-forwarded-for": ip } : {}), ...headers },
      body: typeof payload === "string" ? payload : JSON.stringify(payload),
    }),
  );
}

async function expectError(res: Response, status: number, type: string, message: string) {
  expect(res.status).toBe(status);
  expect(res.headers.get("cache-control")).toBe("no-store");
  expect(await res.json()).toEqual({ error: { type, message } });
}

beforeEach(async () => {
  // A fresh module per test, so the module-level rate limiters start empty
  // and test order doesn't matter.
  vi.resetModules();
  route = await import("./route");
  vi.stubEnv("TYPESAFE_API_KEY", "sk-server");
  vi.stubEnv("PAUSED", "");
  fetchMock = vi.fn<typeof fetch>(async () =>
    Response.json(upstreamAnswer, { headers: { "x-typesafe-request-id": "req-1" } }),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("GET /api/jev", () => {
  it("says whether the server has a key, uncached", async () => {
    const res = route.GET();
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ ok: true, serverKey: true });

    vi.stubEnv("TYPESAFE_API_KEY", "");
    expect(await route.GET().json()).toEqual({ ok: true, serverKey: false });
  });
});

describe("POST /api/jev", () => {
  it("forwards a valid request with the server key and passes the answer back", async () => {
    const res = await post(body);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(UPSTREAM);
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer sk-server");
    expect(init?.cache).toBe("no-store");
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(init?.body))).toEqual(body);

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("x-ratelimit-limit")).toBe("60");
    expect(res.headers.get("x-ratelimit-remaining")).toBe("59");
    expect(await res.json()).toEqual(upstreamAnswer);
  });

  it("passes an upstream error status, body and retry-after through", async () => {
    const detail = { detail: { error_type: "overloaded", message: "busy" } };
    fetchMock.mockResolvedValueOnce(Response.json(detail, { status: 529, headers: { "retry-after": "7" } }));
    const res = await post(body);
    expect(res.status).toBe(529);
    expect(res.headers.get("retry-after")).toBe("7");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual(detail);
  });

  it("ignores a bring-your-own-key header", async () => {
    await post(body, { headers: { "x-typesafe-key": "sk-visitor", authorization: "Bearer sk-visitor" } });
    const init = fetchMock.mock.calls[0][1];
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer sk-server");

    vi.stubEnv("TYPESAFE_API_KEY", "");
    await expectError(await post(body, { headers: { "x-typesafe-key": "sk-visitor" } }), 401, "missing_key", COPY.noKey);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  describe("PAUSED", () => {
    it.each([["1"], ["yes"], [" 0 "]])("returns 503 and never forwards when PAUSED is %j", async (value) => {
      vi.stubEnv("PAUSED", value);
      await expectError(await post(body), 503, "paused", COPY.paused);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("comes before every other check", async () => {
      vi.stubEnv("PAUSED", "1");
      vi.stubEnv("TYPESAFE_API_KEY", "");
      await expectError(await post("not json"), 503, "paused", COPY.paused);
    });

    it("does nothing when blank", async () => {
      vi.stubEnv("PAUSED", "  ");
      expect((await post(body)).status).toBe(200);
    });
  });

  it("returns 401 with no server key, before the rate limit", async () => {
    vi.stubEnv("TYPESAFE_API_KEY", "");
    for (let i = 0; i < 61; i++) {
      await expectError(await post(body), 401, "missing_key", COPY.noKey);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe("rate limit", () => {
    it("gives the 61st request in a minute from one IP a 429", async () => {
      for (let i = 0; i < 60; i++) expect((await post(body)).status).toBe(200);

      const res = await post(body);
      expect(res.headers.get("retry-after")).toMatch(/^\d+$/);
      expect(Number(res.headers.get("retry-after"))).toBeGreaterThanOrEqual(1);
      expect(res.headers.get("x-ratelimit-limit")).toBe("60");
      expect(res.headers.get("x-ratelimit-remaining")).toBe("0");
      await expectError(res, 429, "rate_limited", COPY.rateLimited);
      expect(fetchMock).toHaveBeenCalledTimes(60);

      // Another IP has its own bucket.
      expect((await post(body, { ip: "198.51.100.1" })).status).toBe(200);
    });

    it("reads x-real-ip when there is no x-forwarded-for", async () => {
      for (let i = 0; i < 60; i++) {
        expect((await post(body, { ip: null, headers: { "x-real-ip": "198.51.100.9" } })).status).toBe(200);
      }
      expect((await post(body, { ip: null, headers: { "x-real-ip": "198.51.100.9" } })).status).toBe(429);
    });

    it("puts requests with no forwarding header in one shared bucket of 10", async () => {
      const client = (i: number) => ({ ip: null, headers: { "user-agent": `client ${i}`, cookie: `id=${i}` } });
      for (let i = 0; i < 10; i++) {
        const res = await post(body, client(i));
        expect(res.status).toBe(200);
        expect(res.headers.get("x-ratelimit-limit")).toBe("10");
      }
      const res = await post(body, client(10));
      expect(res.headers.get("x-ratelimit-limit")).toBe("10");
      expect(res.headers.get("retry-after")).toBeTruthy();
      await expectError(res, 429, "rate_limited", COPY.rateLimited);
      expect(fetchMock).toHaveBeenCalledTimes(10);

      // Forwarded requests don't draw on the shared bucket.
      expect((await post(body)).status).toBe(200);
    });

    it("comes before reading the body", async () => {
      for (let i = 0; i < 60; i++) await post("not json");
      expect((await post("not json")).status).toBe(429);
    });
  });

  it("returns 413 over 64 KB", async () => {
    const big = { ...body, state: "x".repeat(MAX_BODY_BYTES) };
    await expectError(await post(big), 413, "payload_too_large", COPY.tooLarge);
    // Size comes before parsing.
    expect((await post("x".repeat(MAX_BODY_BYTES + 1))).status).toBe(413);
    // A lying content-length is caught before the body is read.
    const res = await post(body, { headers: { "content-length": String(MAX_BODY_BYTES + 1) } });
    expect(res.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 400 for a body that is not JSON", async () => {
    await expectError(await post("{ state: nope"), 400, "invalid_request", COPY.notJson);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 400 for a request the studio's validator rejects", async () => {
    await expectError(await post({ ...body, state: "" }), 400, "invalid_request", COPY.notRecipe);
    await expectError(await post({ ...body, model: "" }), 400, "invalid_request", COPY.notRecipe);
    await expectError(await post([body]), 400, "invalid_request", COPY.notRecipe);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe("a request no recipe could make", () => {
    const noul = (instructions: string) => ({ type: "noul", instructions });
    const one = (q: unknown) => ({ ...body, questions: { q } });

    it.each<[string, unknown]>([
      [
        "7 questions",
        { ...body, questions: Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`q${i}`, noul("Is it?")])) },
      ],
      ["a type other than noul, choice or score", one({ type: "rank", instructions: "Rank?", criteria: ["a", "b"] })],
      ["instructions over 200", one(noul("x".repeat(CAPS.question + 1)))],
      ["a choice label over 40", one({ type: "choice", instructions: "Which?", criteria: { ["a".repeat(41)]: "A.", b: "B." } })],
      ["6 score levels", one({ type: "score", instructions: "How much?", criteria: ["a", "b", "c", "d", "e", "f"] })],
      ["state over 2000", { ...body, state: "x".repeat(CAPS.input + 1) }],
      ["a noul with criteria", one({ type: "noul", instructions: "Is it?", criteria: { true: "yes" } })],
    ])("returns 400 for %s", async (_, payload) => {
      await expectError(await post(payload), 400, "invalid_request", COPY.notRecipe);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("accepts state at exactly 2000", async () => {
      expect((await post({ ...body, state: "x".repeat(CAPS.input) })).status).toBe(200);
    });
  });

  it("returns 502 when the upstream is unreachable", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed"));
    const res = await post(body);
    expect(res.headers.get("x-ratelimit-limit")).toBe("60");
    await expectError(res, 502, "upstream_unreachable", "Jev did not answer. This happens.");
  });

  it("returns 504 when the upstream times out", async () => {
    fetchMock.mockRejectedValueOnce(new DOMException("The operation timed out.", "TimeoutError"));
    await expectError(await post(body), 504, "upstream_unreachable", COPY.jevCrashed);
  });
});
