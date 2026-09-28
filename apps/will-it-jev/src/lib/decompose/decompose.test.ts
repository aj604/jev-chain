import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { outcome, recipe, route } from "@/test/build";
import { desk } from "@/test/fixtures";
import {
  decompose,
  DEFAULT_LLM_BASE_URL,
  FIRST_ATTEMPT_MS,
  llmConfigFromEnv,
  MAX_THING,
  MIN_THING,
  parseRecipeText,
  TOTAL_MS,
  type LlmConfig,
} from "./decompose";
import { SYSTEM_PROMPT } from "./prompt";

// The real prompt shows curated recipes, which this test doesn't depend on.
vi.mock("./prompt", () => ({ SYSTEM_PROMPT: "You turn a thing someone wrote into a recipe." }));

const DESK = desk();

const COMPLETIONS = "https://llm.test/v1/chat/completions";
const THING = "Hey. I don't want to keep seeing each other. I wish you well.";

const GOOD = JSON.stringify(DESK);
/** A route whose first label breaks the label pattern. */
const BAD = JSON.stringify(
  recipe(
    "The Plan Desk",
    "your plan",
    route(
      "vibe",
      "What is the vibe?",
      { Bad: "A loud night", calm: "A quiet night" },
      { Bad: outcome("stay-in", "Stayed in", "Stay in."), calm: outcome("sleep", "Slept", "Sleep well.") },
    ),
  ),
);
const BAD_MESSAGE = "root.labels.Bad: labels are lowercase letters, digits and dashes, up to 40 characters";
/** Valid JSON, but the recipe breaks the tone rule in its title. */
const LOUD = GOOD.replace("The Appliance Dispatch Desk", "The Appliance Dispatch Desk!");
const LOUD_MESSAGE = "recipe.title: no exclamation marks. keep it flat";

interface ChatBody {
  model: string;
  messages: { role: string; content: string }[];
  temperature: number;
  response_format: { type: string };
}

/** An OpenAI-style chat completion whose first choice says `content`. */
const completion = (content: unknown) =>
  Response.json({ id: "c1", choices: [{ index: 0, message: { role: "assistant", content } }] });

type Responder = (init: RequestInit) => Response | Promise<Response>;

/** A fetch that answers call n with `responders[n]`, and fails the test on an extra call. */
function scripted(...responders: Responder[]): Mock<typeof fetch> {
  let n = 0;
  return vi.fn<typeof fetch>(async (_url, init) => {
    const respond = responders[n++];
    if (!respond) throw new Error(`unexpected call ${n}`);
    return respond(init ?? {});
  });
}

const replying = (content: unknown): Responder => () => completion(content);

/** Answers after `ms`, or rejects with the signal's reason when it aborts first. */
const after =
  (ms: number, respond: () => Response): Responder =>
  ({ signal }) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(respond()), ms);
      signal?.addEventListener("abort", () => {
        clearTimeout(timer);
        reject(signal.reason);
      });
    });

/** Never answers. Rejects with the signal's reason when it aborts. */
const hanging: Responder = ({ signal }) =>
  new Promise((_, reject) => {
    signal?.addEventListener("abort", () => reject(signal.reason));
  });

function config(llm: typeof fetch, extra: Partial<LlmConfig> = {}): LlmConfig {
  return { baseUrl: "https://llm.test/v1", apiKey: "sk-test", model: "some/model", fetch: llm, ...extra };
}

function bodyOf(llm: Mock<typeof fetch>, call: number): ChatBody {
  return JSON.parse(llm.mock.calls[call][1]?.body as string) as ChatBody;
}

describe("constants", () => {
  it("match the brief", () => {
    expect(MIN_THING).toBe(2);
    expect(MAX_THING).toBe(2000);
    expect(FIRST_ATTEMPT_MS).toBe(20_000);
    expect(TOTAL_MS).toBe(30_000);
    expect(DEFAULT_LLM_BASE_URL).toBe("https://openrouter.ai/api/v1");
  });
});

describe("llmConfigFromEnv", () => {
  const env = { LLM_API_KEY: "sk-live", LLM_MODEL: "some/model" };

  it.each([
    ["no key", { LLM_MODEL: "some/model" }],
    ["no model", { LLM_API_KEY: "sk-live" }],
    ["a blank key", { ...env, LLM_API_KEY: "  " }],
    ["a blank model", { ...env, LLM_MODEL: "\n\t" }],
    ["nothing", {}],
  ])("is null with %s", (_, vars: Record<string, string | undefined>) => {
    expect(llmConfigFromEnv(vars)).toBeNull();
  });

  it("defaults the base URL", () => {
    expect(llmConfigFromEnv(env)).toEqual({ baseUrl: DEFAULT_LLM_BASE_URL, apiKey: "sk-live", model: "some/model" });
    expect(llmConfigFromEnv({ ...env, LLM_BASE_URL: "   " })?.baseUrl).toBe(DEFAULT_LLM_BASE_URL);
  });

  it("trims whitespace and trailing slashes", () => {
    const vars = { LLM_BASE_URL: " https://llm.test/v1// \n", LLM_API_KEY: " sk-live ", LLM_MODEL: " some/model " };
    expect(llmConfigFromEnv(vars)).toEqual({ baseUrl: "https://llm.test/v1", apiKey: "sk-live", model: "some/model" });
    expect(llmConfigFromEnv({ ...env, LLM_BASE_URL: "https://llm.test/v1/" })?.baseUrl).toBe("https://llm.test/v1");
  });

  it("reads process.env by default", () => {
    vi.stubEnv("LLM_BASE_URL", "");
    vi.stubEnv("LLM_API_KEY", "sk-env");
    vi.stubEnv("LLM_MODEL", "");
    expect(llmConfigFromEnv()).toBeNull();
    vi.stubEnv("LLM_MODEL", "env/model");
    expect(llmConfigFromEnv()).toEqual({ baseUrl: DEFAULT_LLM_BASE_URL, apiKey: "sk-env", model: "env/model" });
    vi.unstubAllEnvs();
  });
});

describe("parseRecipeText", () => {
  it.each([
    ["bare JSON", GOOD],
    ["fenced JSON", "```json\n" + GOOD + "\n```"],
    ["prose-wrapped JSON", `Here is the recipe.\n\n${GOOD}\n\nIt has two gates and a rate.`],
  ])("parses %s to the desk recipe", (_, text) => {
    expect(parseRecipeText(text)).toEqual({ ok: true, recipe: DESK });
  });

  it("says when there is no object", () => {
    expect(parseRecipeText("I cannot do that.")).toEqual({
      ok: false,
      message: "recipe: the reply has no JSON object in it",
    });
    // A closing brace before the only opening one is not an object either.
    expect(parseRecipeText("} and then {")).toEqual({
      ok: false,
      message: "recipe: the reply has no JSON object in it",
    });
  });

  it("keeps the escape hatches, means and bands of a v2 recipe", () => {
    expect(parseRecipeText(GOOD)).toEqual({ ok: true, recipe: JSON.parse(GOOD) });
    expect(GOOD).toContain('"lowConfidence"');
    expect(GOOD).toContain('"unsure"');
    expect(GOOD).toContain('"means"');
    expect(GOOD).toContain('"bands"');
  });

  it("rejects a v1 recipe with the validator's message", () => {
    const v1 = JSON.stringify({ v: 1, title: "Will it jev?", thing: "it", root: { kind: "verdict", tier: "jevs", line: "It jevs." } });
    expect(parseRecipeText(v1)).toEqual({ ok: false, message: "recipe.v: must be 2" });
    expect(parseRecipeText(GOOD.replace('"v":2', '"v":1'))).toEqual({ ok: false, message: "recipe.v: must be 2" });
  });

  it("says when the object is not JSON", () => {
    expect(parseRecipeText("{ nope }")).toEqual({ ok: false, message: "recipe: the reply is not valid JSON" });
  });

  it("reads a } in prose after the object as part of it, so the JSON is invalid", () => {
    expect(parseRecipeText(`${GOOD}\nThe last gate is the rate }`)).toEqual({
      ok: false,
      message: "recipe: the reply is not valid JSON",
    });
  });

  it("passes parsed JSON through validateRecipe", () => {
    expect(parseRecipeText(BAD)).toEqual({ ok: false, message: BAD_MESSAGE });
    expect(parseRecipeText(LOUD)).toEqual({ ok: false, message: LOUD_MESSAGE });
  });
});

describe("decompose", () => {
  it("returns the recipe from a valid first reply after one call", async () => {
    const llm = scripted(replying(GOOD));
    expect(await decompose(THING, config(llm))).toEqual({ ok: true, recipe: DESK });

    expect(llm).toHaveBeenCalledOnce();
    const [url, init] = llm.mock.calls[0];
    expect(url).toBe(COMPLETIONS);
    expect(init?.method).toBe("POST");
    const headers = new Headers(init?.headers);
    expect(headers.get("authorization")).toBe("Bearer sk-test");
    expect(headers.get("content-type")).toBe("application/json");

    const body = bodyOf(llm, 0);
    expect(body.model).toBe("some/model");
    expect(body.temperature).toBe(0.7);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages.map((m) => m.role)).toEqual(["system", "user"]);
    expect(body.messages[0].content).toBe(SYSTEM_PROMPT);
    expect(body.messages[1].content).toBe(THING);
  });

  it("retries an invalid reply once, carrying the reply and the validator's message", async () => {
    const llm = scripted(replying(BAD), replying(GOOD));
    expect(await decompose(THING, config(llm))).toEqual({ ok: true, recipe: DESK });

    expect(llm).toHaveBeenCalledTimes(2);
    const { messages } = bodyOf(llm, 1);
    expect(messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "user"]);
    expect(messages[1].content).toBe(THING);
    expect(messages[2].content).toBe(BAD);
    expect(messages[3].content).toContain(BAD_MESSAGE);
    expect(messages[3].content).toContain("whole corrected recipe");
    expect(messages[3].content).toContain("JSON");
  });

  it("echoes the reply as the model sent it, prose and all", async () => {
    const reply = "Sure. Here it is.";
    const llm = scripted(replying(reply), replying(GOOD));
    expect((await decompose(THING, config(llm))).ok).toBe(true);
    const { messages } = bodyOf(llm, 1);
    expect(messages[2].content).toBe(reply);
    expect(messages[3].content).toContain("recipe: the reply has no JSON object in it");
  });

  it("gives up after two invalid replies with the last message", async () => {
    const llm = scripted(replying(BAD), replying(LOUD));
    expect(await decompose(THING, config(llm))).toEqual({ ok: false, reason: "invalid", message: LOUD_MESSAGE });
    expect(llm).toHaveBeenCalledTimes(2);
  });

  it.each<[string, Responder]>([
    ["a 500", () => new Response("oops", { status: 500 })],
    ["a 429", () => Response.json({ error: "slow down" }, { status: 429 })],
    [
      "a thrown network error",
      () => {
        throw new TypeError("fetch failed");
      },
    ],
    ["a 200 with no content", () => Response.json({ choices: [{ message: { role: "assistant" } }] })],
    ["a 200 with null content", replying(null)],
    ["a 200 with blank content", replying("  \n")],
    ["a 200 with content parts", replying([{ type: "text", text: GOOD }])],
    ["a 200 with no choices", () => Response.json({ choices: [] })],
    ["a 200 that is not JSON", () => new Response("<html>gateway</html>", { status: 200 })],
    ["a 200 that is a JSON string", () => Response.json("hello")],
  ])("gives upstream for %s, without a retry", async (_, respond) => {
    const llm = scripted(respond);
    const result = await decompose(THING, config(llm));
    expect(result).toMatchObject({ ok: false, reason: "upstream" });
    expect(llm).toHaveBeenCalledOnce();
  });

  it("names the status in the upstream message", async () => {
    const result = await decompose(THING, config(scripted(() => new Response("", { status: 503 }))));
    expect(result).toEqual({ ok: false, reason: "upstream", message: "llm: answered 503" });
  });

  it("gives upstream when the retry fails upstream", async () => {
    const llm = scripted(replying(BAD), () => new Response("", { status: 502 }));
    expect(await decompose(THING, config(llm))).toEqual({ ok: false, reason: "upstream", message: "llm: answered 502" });
    expect(llm).toHaveBeenCalledTimes(2);
  });

  describe("never throws", () => {
    it("when fetch throws synchronously", async () => {
      const llm = vi.fn<typeof fetch>(() => {
        throw new Error("sync");
      });
      await expect(decompose(THING, config(llm))).resolves.toMatchObject({ ok: false, reason: "upstream" });
    });

    it("when the body's json() rejects", async () => {
      const res = { ok: true, status: 200, json: () => Promise.reject(new Error("body")) } as unknown as Response;
      const llm = vi.fn<typeof fetch>(async () => res);
      await expect(decompose(THING, config(llm))).resolves.toEqual({
        ok: false,
        reason: "upstream",
        message: "llm: the reply has no content",
      });
    });

    it("when the response is not a response at all", async () => {
      const llm = vi.fn<typeof fetch>(async () => null as unknown as Response);
      await expect(decompose(THING, config(llm))).resolves.toMatchObject({ ok: false, reason: "upstream" });
    });

    it("when reading the config throws", async () => {
      const hostile = config(scripted(replying(GOOD)));
      Object.defineProperty(hostile, "totalMs", {
        get(): never {
          throw new Error("getter");
        },
      });
      await expect(decompose(THING, hostile)).resolves.toEqual({
        ok: false,
        reason: "upstream",
        message: "llm: the call failed",
      });
    });

    it("when reading the body's shape throws", async () => {
      const body = {
        get choices(): never {
          throw new Error("getter");
        },
      };
      const res = { ok: true, status: 200, json: async () => body } as unknown as Response;
      const llm = vi.fn<typeof fetch>(async () => res);
      await expect(decompose(THING, config(llm))).resolves.toMatchObject({ ok: false, reason: "upstream" });
    });
  });

  describe("time budget", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    /** Starts `decompose` under fake timers and tracks when it settles. */
    function start(llm: typeof fetch, extra: Partial<LlmConfig>) {
      vi.useFakeTimers();
      const t0 = Date.now();
      const state: { result?: Awaited<ReturnType<typeof decompose>>; at?: number } = {};
      const done = decompose(THING, config(llm, extra)).then((result) => {
        state.result = result;
        state.at = Date.now() - t0;
      });
      return { t0, state, done };
    }

    /** Wraps a responder to record when its call started and when its signal aborted, relative to `t0`. */
    function timed(respond: Responder, log: { started?: number; aborted?: number }, t0: () => number): Responder {
      return (init) => {
        log.started = Date.now() - t0();
        init.signal?.addEventListener("abort", () => (log.aborted = Date.now() - t0()));
        return respond(init);
      };
    }

    it("cuts a hanging first attempt at the first-attempt budget", async () => {
      const log: { started?: number; aborted?: number } = {};
      let t0 = 0;
      const llm = scripted(timed(hanging, log, () => t0));
      const run = start(llm, { firstAttemptMs: 50, totalMs: 150 });
      t0 = run.t0;

      await vi.advanceTimersByTimeAsync(49);
      expect(run.state.result).toBeUndefined();
      await vi.advanceTimersByTimeAsync(1);
      await run.done;

      expect(run.state).toEqual({
        result: { ok: false, reason: "upstream", message: "llm: took too long" },
        at: 50,
      });
      expect(log.aborted).toBe(50);
      expect(llm).toHaveBeenCalledOnce();
    });

    it("gives the first attempt no more than the total budget", async () => {
      const llm = scripted(hanging);
      const run = start(llm, { firstAttemptMs: 100, totalMs: 40 });
      await vi.advanceTimersByTimeAsync(100);
      await run.done;
      expect(run.state.at).toBe(40);
      expect(run.state.result).toMatchObject({ reason: "upstream" });
    });

    it("gives the retry only what is left of the total", async () => {
      const first: { started?: number; aborted?: number } = {};
      const second: { started?: number; aborted?: number } = {};
      let t0 = 0;
      const llm = scripted(
        timed(after(80, () => completion(BAD)), first, () => t0),
        timed(hanging, second, () => t0),
      );
      const run = start(llm, { firstAttemptMs: 100, totalMs: 150 });
      t0 = run.t0;

      await vi.advanceTimersByTimeAsync(149);
      expect(run.state.result).toBeUndefined();
      expect(second.started).toBe(80);
      await vi.advanceTimersByTimeAsync(1);
      await run.done;

      // 70 ms: less than a fresh first-attempt budget, and far less than a fresh total.
      expect(second.aborted).toBe(150);
      expect(first.aborted).toBeUndefined();
      expect(run.state).toEqual({
        result: { ok: false, reason: "upstream", message: "llm: took too long" },
        at: 150,
      });
      expect(llm).toHaveBeenCalledTimes(2);
    });

    it("lets a retry that answers inside the remaining total succeed", async () => {
      const llm = scripted(
        after(80, () => completion(BAD)),
        after(60, () => completion(GOOD)),
      );
      const run = start(llm, { firstAttemptMs: 100, totalMs: 150 });
      await vi.advanceTimersByTimeAsync(150);
      await run.done;
      expect(run.state).toEqual({ result: { ok: true, recipe: DESK }, at: 140 });
    });

    it("cuts a retry that would fit a fresh first-attempt budget but not the remaining total", async () => {
      const llm = scripted(
        after(80, () => completion(BAD)),
        after(80, () => completion(GOOD)),
      );
      const run = start(llm, { firstAttemptMs: 100, totalMs: 150 });
      await vi.advanceTimersByTimeAsync(200);
      await run.done;
      expect(run.state).toEqual({
        result: { ok: false, reason: "upstream", message: "llm: took too long" },
        at: 150,
      });
    });

    it("cuts a fetch that ignores its signal", async () => {
      const llm = vi.fn<typeof fetch>(() => new Promise<Response>(() => {}));
      const run = start(llm, { firstAttemptMs: 50, totalMs: 150 });
      await vi.advanceTimersByTimeAsync(50);
      await run.done;
      expect(run.state).toEqual({
        result: { ok: false, reason: "upstream", message: "llm: took too long" },
        at: 50,
      });
    });

    it("stops when the caller aborts", async () => {
      const caller = new AbortController();
      const log: { started?: number; aborted?: number } = {};
      let t0 = 0;
      const llm = scripted(timed(hanging, log, () => t0));
      const run = start(llm, { signal: caller.signal, firstAttemptMs: 100, totalMs: 150 });
      t0 = run.t0;

      await vi.advanceTimersByTimeAsync(30);
      caller.abort();
      await vi.advanceTimersByTimeAsync(0);
      await run.done;

      expect(log.aborted).toBe(30);
      expect(run.state).toEqual({
        result: { ok: false, reason: "upstream", message: "llm: stopped by the caller" },
        at: 30,
      });
      expect(llm).toHaveBeenCalledOnce();
    });

    it("stops a retry when the caller aborts", async () => {
      const caller = new AbortController();
      const llm = scripted(after(20, () => completion(BAD)), hanging);
      const run = start(llm, { signal: caller.signal, firstAttemptMs: 100, totalMs: 150 });
      await vi.advanceTimersByTimeAsync(40);
      expect(llm).toHaveBeenCalledTimes(2);
      caller.abort();
      await vi.advanceTimersByTimeAsync(0);
      await run.done;
      expect(run.state.result).toEqual({ ok: false, reason: "upstream", message: "llm: stopped by the caller" });
    });
  });

  it("does not call the model when the caller has already aborted", async () => {
    const llm = scripted(replying(GOOD));
    const result = await decompose(THING, config(llm, { signal: AbortSignal.abort() }));
    expect(result).toEqual({ ok: false, reason: "upstream", message: "llm: stopped by the caller" });
    expect(llm).not.toHaveBeenCalled();
  });

  describe("privacy", () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("logs nothing, whatever happens", async () => {
      const methods = ["log", "info", "warn", "error", "debug", "trace"] as const;
      const spies = methods.map((method) => vi.spyOn(console, method).mockImplementation(() => {}));

      const runs: [Responder[], Partial<LlmConfig>][] = [
        [[replying(GOOD)], {}],
        [[replying(BAD), replying(GOOD)], {}],
        [[replying(BAD), replying(LOUD)], {}],
        [[replying("I cannot do that."), replying("{ nope }")], {}],
        [[() => new Response(THING, { status: 500 })], {}],
        [
          [
            () => {
              throw new Error(THING);
            },
          ],
          {},
        ],
        [[replying(null)], {}],
        [[hanging], { firstAttemptMs: 5, totalMs: 10 }],
        [[replying(BAD), hanging], { firstAttemptMs: 5, totalMs: 10 }],
      ];
      for (const [responders, extra] of runs) await decompose(THING, config(scripted(...responders), extra));

      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    });
  });
});
