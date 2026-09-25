/**
 * The docs, checked against the framework.
 *
 * Part one proves every entry in `claims.ts` (the output the pages print) by
 * producing it with the real runtime. Part two pins the behaviour the pages
 * describe in prose, one `describe` per page anchor, so a framework change
 * that makes a page wrong fails here with the page's address on it.
 *
 * Jev is faked: `jevFrom(oracle)` answers every question from a function, so
 * the numbers are hand-picked and everything else is genuine.
 */
import {
  ask,
  cascade,
  chain,
  ChainConfigError,
  choice,
  createJev,
  emit,
  fromJSON,
  gate,
  noul,
  parallel,
  route,
  score,
  step,
  tier,
  toJSON,
  type Answer,
  type AnyNode,
  type Decision,
  type Json,
  type JevClient,
  type Question,
  type Questions,
} from "jevchain";
import { describe, expect, it } from "vitest";
import { claims, type ClaimId } from "./claims";
import { docChains } from "./chains";

// ---------------------------------------------------------------------------
// A fake Jev
// ---------------------------------------------------------------------------

/** Pick an answer for one question; return only the fields you care about. */
type Oracle = (key: string, q: Question) => Partial<Answer> | undefined;

function answer(q: Question, o: Partial<Answer> = {}): Answer {
  if (q.type === "noul") return { type: "noul", noul: 0.9, ...o } as Answer;
  if (q.type === "score") return { type: "score", score: 0, probabilities: {}, legend: {}, confidence: 0.8, ...o } as Answer;
  return { type: "choice", choice: Object.keys(q.criteria)[0]!, probabilities: {}, confidence: 0.8, ...o } as Answer;
}

/** A client that answers from `oracle`, optionally slowly (and abortably). */
function jevFrom(oracle: Oracle = () => undefined, latencyMs = 0) {
  const client = {
    model: "jev-latest",
    usdPerMillionTokens: 0.042,
    async ask(_state: unknown, questions: Questions, opts?: { signal?: AbortSignal }) {
      if (latencyMs) {
        await new Promise<void>((resolve, reject) => {
          const t = setTimeout(resolve, latencyMs);
          opts?.signal?.addEventListener("abort", () => {
            clearTimeout(t);
            reject(opts.signal!.reason);
          });
        });
      }
      const answers = Object.fromEntries(Object.entries(questions).map(([k, q]) => [k, answer(q, oracle(k, q))]));
      return { answers, model: "jev-1.13.0", usage: { inputTokens: 1, outputTokens: 1 }, costUsd: 0, latencyMs: 1, attempts: 1 };
    },
  } as unknown as JevClient;
  return createJev(client);
}

/** Run a one-node chain and return the root span's decision. */
async function decide(node: AnyNode, oracle: Oracle, input: Json = "x"): Promise<Decision> {
  const { trace } = await jevFrom(oracle).run(node, input);
  return trace.spans[0]!.decision!;
}

const configIssues = async (thunk: () => unknown): Promise<readonly string[]> => {
  try {
    await thunk();
  } catch (e) {
    if (e instanceof ChainConfigError) return e.issues;
    throw e;
  }
  throw new Error("expected a ChainConfigError");
};

// The chains the pages show, rebuilt with the same numbers.
const dressCode = (otherwise: boolean) =>
  gate("dress-code", {
    ask: noul("Is this outfit appropriate for a fancy rooftop bar?"),
    pass: { min: 0.6 },
    then: emit("Welcome in."),
    ...(otherwise ? { otherwise: emit("Not tonight.") } : {}),
    unsure: { margin: 0.1, then: emit("Wait here. The manager is coming.") },
  });
const goldilocks = gate("goldilocks", {
  ask: noul("Is the porridge hot?"),
  pass: { min: 0.4, max: 0.6 },
  then: emit("eat"),
  otherwise: emit("wait"),
  unsure: { margin: 0.1, then: emit("blow on it") },
});
const frontDesk = route("front-desk", {
  ask: choice("Which team should handle this ticket?", ["repair", "billing", "paranormal"]),
  lowConfidence: { below: 0.4, then: emit("A human will read this. Probably Dave.") },
  branches: { repair: emit("repair"), billing: emit("billing"), paranormal: emit("paranormal") },
});

// ---------------------------------------------------------------------------
// Part one: every claim, produced
// ---------------------------------------------------------------------------

/** How to produce each claim for real. Typed against `claims`, so a new claim without a proof doesn't compile. */
const proofs: { [K in ClaimId]: () => Promise<unknown> } = {
  gatePassed: async () =>
    (await decide(gate("g", { ask: noul("?"), pass: { min: 0.6 }, then: emit("t"), otherwise: emit("o") }), () => ({ noul: 0.83 }))).summary,
  gateBlockedScore: async () =>
    (
      await decide(
        gate("g", { ask: score("?", ["slack", "email", "doc", "call", "meeting"]), pass: { min: 2.5 }, then: emit("t"), otherwise: emit("o") }),
        () => ({ score: 1.4 }),
      )
    ).summary,
  gateUnderCeiling: async () => (await decide(gate("g", { ask: noul("?"), pass: { max: 0.5 }, then: emit("t") }), () => ({ noul: 0.04 }))).summary,
  gateUnsure: async () => (await decide(dressCode(true), () => ({ noul: 0.64 }))).summary,
  gateWindowUnsure: async () => (await decide(goldilocks, () => ({ noul: 0.55 }))).summary,
  gateHalted: async () => {
    const r = await jevFrom(() => ({ noul: 0.12 })).run(dressCode(false), "Running shorts and one AirPod.");
    expect(r.status).toBe("halted");
    expect(r.output).toBeUndefined();
    expect(r.trace.halted).toMatchObject({ path: "$", nodeId: "dress-code" });
    return r.trace.halted!.summary;
  },
  routeDecision: async () =>
    JSON.stringify(
      await decide(frontDesk, () => ({
        choice: "paranormal",
        probabilities: { repair: 0.02, billing: 0.004, paranormal: 0.976 },
        confidence: 0.887,
      })),
    ),
  routeLowConfidence: async () =>
    (await decide(frontDesk, () => ({ choice: "repair", probabilities: { repair: 0.5, billing: 0.3, paranormal: 0.2 }, confidence: 0.31 })))
      .summary,
  routeIssues: async () => {
    const doc = toJSON(
      route("triage", {
        ask: choice("What is this?", ["billing", "bug", "vibes"]),
        branches: { billing: emit("b"), bug: emit("o"), vibes: emit("v") },
      }),
    );
    const branches = (doc.root as { branches: Record<string, unknown> }).branches;
    branches.refunds = branches.vibes;
    delete branches.vibes;
    return configIssues(() => fromJSON(doc));
  },
  cascadeSummary: async () => {
    const verdict = choice("Should the recipient reply?", { reply: "yes", "leave-on-read": "no" });
    const decideReply = cascade("should-i-reply", {
      tiers: [tier("gut-check", { ask: verdict, minConfidence: 0.7 }), tier("full-context", { ask: verdict, minConfidence: 0.5 })],
      fallback: emit("Screenshot it and send it to the group chat."),
    });
    let call = 0;
    return (await decide(decideReply, () => ({ confidence: call++ === 0 ? 0.41 : 0.78 }))).summary;
  },
  templateInput: async () => claims.templateInput, // the input the next two claims are rendered over
  templates: async () =>
    Promise.all(
      claims.templates.map(async ({ template }) => {
        const r = await jevFrom().run(emit(template), claims.templateInput as unknown as Json);
        return { template, output: r.output };
      }),
    ),
  templateEmptyLog: async () => {
    const r = await jevFrom().run(emit("{{input.nope}}!"), claims.templateInput as unknown as Json);
    return r.trace.spans[0]!.logs[0]!.message;
  },
  templateTypo: async () => {
    const [issue] = await configIssues(() => jevFrom().run(chain("c", emit("Hi {{inptu.name}}", { id: "greet" }), step("lookup", (s: string) => s)), { name: "Mo" }));
    return issue;
  },
  templateTooEarly: async () => {
    const [issue] = await configIssues(() => jevFrom().run(chain("c", emit("{{results.lookup}}", { id: "greet" }), step("lookup", (s: unknown) => s)), "x"));
    return issue;
  },
  errorTrace: async () => {
    const fetch429 = (async () =>
      new Response(JSON.stringify({ detail: { error_type: "rate_limited", message: "slow down" } }), {
        status: 429,
        headers: { "content-type": "application/json", "retry-after": "2" },
      })) as unknown as typeof fetch;
    const jev = createJev({ apiKey: "test", fetch: fetch429, retry: { maxRetries: 0 } });
    const r = await jev.run(frontDesk, "My toaster whispers my name at 3am.");
    return { run: r.trace.error, span: r.trace.spans[0]!.error };
  },
  errorConfig: async () => {
    const fridge = docChains.find((c) => c.id === "docs-fridge")!.chain;
    const doc = toJSON(fridge);
    const ask = (doc.root as { ask: { criteria: Record<string, string> } }).ask;
    ask.criteria.compost = "the worms will eat well tonight";
    return configIssues(() => fromJSON(doc));
  },
};

describe("claims.ts: what the docs print is what jevchain prints", () => {
  it("has a proof for every claim, and no proof without a claim", () => {
    expect(Object.keys(proofs).sort()).toEqual(Object.keys(claims).sort());
  });

  for (const id of Object.keys(claims) as ClaimId[]) {
    it(id, async () => {
      const actual = await proofs[id]();
      const claimed = claims[id];
      // JSON strings are compared as data, so pages can align them by hand.
      if (typeof claimed === "string" && claimed.trimStart().startsWith("{")) {
        expect(JSON.parse(actual as string)).toEqual(JSON.parse(claimed));
      } else {
        expect(actual).toEqual(claimed);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// Part two: what the pages say, in prose
// ---------------------------------------------------------------------------

describe("/docs/gate#unsure", () => {
  it("measures the margin from the nearest edge of a window, inside or out", async () => {
    const at = async (p: number) => (await decide(goldilocks, () => ({ noul: p }))).taken;
    expect(await at(0.45)).toBe("unsure"); // 0.05 above the floor
    expect(await at(0.55)).toBe("unsure"); // 0.05 below the ceiling: a min-only rule would call this a pass
    expect(await at(0.65)).toBe("unsure"); // 0.05 over the ceiling
    expect(await at(0.35)).toBe("unsure"); // 0.05 under the floor
    expect(await at(0.5)).toBe("then"); // 0.10 from both edges: exactly the margin, so outside it
    expect(await at(0.3)).toBe("otherwise");
    expect(await at(0.7)).toBe("otherwise");
  });

  it("0.5 < p(yes) < 0.7 is unsure for the dress code, and the ends are not", async () => {
    const at = async (p: number) => (await decide(dressCode(true), () => ({ noul: p }))).taken;
    expect(await at(0.51)).toBe("unsure");
    expect(await at(0.69)).toBe("unsure");
    expect(await at(0.5)).toBe("otherwise");
    expect(await at(0.7)).toBe("then");
  });
});

describe("/docs/route#also-ask, /docs/ask#ask-vs-also-ask", () => {
  // The route page's ALSO snippet, verbatim apart from the stubbed paranormal branch.
  const paranormal = emit("paranormal");
  const desk = route("front-desk", {
    ask: choice("Which team should handle this ticket?", ["repair", "billing", "paranormal"]),
    alsoAsk: {
      sarcastic: noul("Is the customer joking or being sarcastic?"),
      angry: noul("Is the customer angry?"),
    },
    branches: {
      // A template reads them by route id and key…
      repair: emit("Repair ticket. p(angry) = {{answers.front-desk.angry.noul}}"),
      // …and so does a step, where each one is a typed Answer.
      billing: step("apologise", (ticket: string, ctx) => {
        const angry = ctx.answers["front-desk"]?.angry;
        return angry?.type === "noul" && angry.noul > 0.5 ? `Sorry! ${ticket}` : ticket;
      }),
      paranormal,
    },
  });
  const oracle =
    (pick: string, angry: number): Oracle =>
    (k) =>
      k === "decision" ? { choice: pick, confidence: 0.73 } : k === "angry" ? { noul: angry } : { noul: 0.1 };

  it("alsoAsk answers reach the branch through {{answers.<route>.<key>}}", async () => {
    expect((await jevFrom(oracle("repair", 0.08)).run(desk, "x")).output).toBe("Repair ticket. p(angry) = 0.08");
  });
  it("…and through ctx.answers in a step", async () => {
    expect((await jevFrom(oracle("billing", 0.9)).run(desk, "my invoice")).output).toBe("Sorry! my invoice");
    expect((await jevFrom(oracle("billing", 0.1)).run(desk, "my invoice")).output).toBe("my invoice");
  });
  it("don't change which branch is taken, or the route's output", async () => {
    const r = await jevFrom(oracle("paranormal", 0.99)).run(desk, "x");
    expect(r.trace.spans[0]!.decision!.taken).toBe("paranormal");
    expect(r.output).toBe("paranormal");
  });
  it("the route's own answer is there under `decision`", async () => {
    const d = route("front-desk", { ask: choice("?", ["a", "b"]), branches: { a: emit("{{answers.front-desk.decision.confidence}}"), b: emit("b") } });
    expect((await jevFrom(oracle("a", 0)).run(d, "x")).output).toBe(0.73);
  });
  it("a key the route never asks, or a route that hasn't answered yet, is rejected before the run", async () => {
    const typo = route("front-desk", { ask: choice("?", ["a", "b"]), branches: { a: emit("{{answers.front-desk.angy}}"), b: emit("b") } });
    expect(await configIssues(() => jevFrom().run(typo, "x"))).toHaveLength(1);
    const early = chain("c", emit("{{answers.front-desk.decision}}"), typo);
    expect(await configIssues(() => jevFrom().run(early, "x"))).not.toHaveLength(0);
  });
});

describe("/docs/step-and-emit#context", () => {
  it("ctx.answers holds an ask's answers by node id, and the route's decision under `decision`", async () => {
    const seen = await jevFrom().run(
      chain(
        "c",
        ask("mood", { questions: { calm: noul("Calm?") } }),
        route("pick", { ask: choice("Which?", ["a", "b"]), branches: { a: step("look", (_: unknown, ctx) => ctx.answers), b: emit("b") } }),
      ),
      "x",
    );
    const answers = seen.output as Record<string, Record<string, Answer>>;
    expect(Object.keys(answers).sort()).toEqual(["mood", "pick"]);
    expect(Object.keys(answers.mood!)).toEqual(["calm"]);
    expect(answers.pick!.decision!.type).toBe("choice");
  });
});

describe("/docs/step-and-emit#template-checks", () => {
  const rejects = async (template: string) => {
    const c = chain("c", step("first", (s: string) => s), chain("inner", emit(template, { id: "me" })), step("later", (s: unknown) => s));
    try {
      await jevFrom().run(c, "x");
      return 0;
    } catch (e) {
      if (e instanceof ChainConfigError) return e.issues.length;
      throw e;
    }
  };

  it("rejects an unknown root, and results of a later step, the node itself or an ancestor", async () => {
    expect(await rejects("{{inptu}}")).toBe(1);
    expect(await rejects("{{results.later}}")).toBe(1);
    expect(await rejects("{{results.me}}")).toBe(1);
    expect(await rejects("{{results.inner}}")).toBe(1);
    expect(await rejects("{{results.first}} {{run}} {{input}}")).toBe(0);
  });

  it("fromJSON rejects them too", async () => {
    expect(await configIssues(() => fromJSON(toJSON(emit("Hi {{inptu.name}}", { id: "greet" }))))).toHaveLength(1);
  });

  it("ctx.answers files a cascade's answers under its id, keyed by tier id", async () => {
    const c = chain(
      "c",
      cascade("climb", { tiers: [tier("quick", { ask: noul("?"), minConfidence: 0.9 }), tier("slow", { ask: noul("?"), minConfidence: 0.1 })], fallback: emit("f") }),
      step("look", (_: unknown, ctx) => Object.keys(ctx.answers.climb ?? {}).sort()),
    );
    expect((await jevFrom(() => ({ noul: 0.7 })).run(c, "x")).output).toEqual(["quick", "slow"]);
  });
});

describe("/docs/running#cancellation", () => {
  const slow = parallel("p", {
    branches: {
      a: ask("a", { questions: { q: noul("?") } }),
      b: step("b", (_: string, ctx) => new Promise((resolve, reject) => {
        const t = setTimeout(resolve, 500);
        ctx.signal.addEventListener("abort", () => (clearTimeout(t), reject(ctx.signal.reason)));
      })),
    },
  });
  const openSpans = (spans: { path: string; status: string; error?: { code: string } }[]) =>
    spans.map((s) => `${s.path} ${s.status} ${s.error?.code}`);

  it("your signal: status aborted, and every span still running closes as an error with code aborted", async () => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);
    const r = await jevFrom(undefined, 200).run(slow, "x", { signal: controller.signal });
    expect(r.status).toBe("aborted");
    expect(r.error?.code).toBe("aborted");
    expect(openSpans(r.trace.spans)).toEqual(["$ error aborted", "$/a error aborted", "$/b error aborted"]);
  });

  it("the run deadline: status error, code timeout, spans closed with code timeout", async () => {
    const r = await jevFrom(undefined, 200).run(slow, "x", { timeoutMs: 20 });
    expect(r.status).toBe("error");
    expect(r.error?.code).toBe("timeout");
    expect(openSpans(r.trace.spans)).toEqual(["$ error timeout", "$/a error timeout", "$/b error timeout"]);
  });

  it("leaving a stream's loop early aborts the run", async () => {
    const s = jevFrom(undefined, 50).stream(chain("c", ask("a", { questions: { q: noul("?") } }), ask("b", { questions: { q: noul("?") } })), "x");
    for await (const e of s) if (e.type === "span:start") break;
    const r = await s.result;
    expect(r.status).toBe("aborted");
    expect(r.trace.usage.calls).toBe(0);
  });

  it("…and a stream nobody iterates runs to the end", async () => {
    expect((await jevFrom().stream(ask("a", { questions: { q: noul("?") } }), "x").result).status).toBe("ok");
  });

  it("calls queued for a concurrency slot are never sent", async () => {
    let sent = 0;
    const slowFetch = (async (_url: string, init?: RequestInit) => {
      sent++;
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, 500);
        init?.signal?.addEventListener("abort", () => (clearTimeout(t), reject(init.signal!.reason)));
      });
      return new Response("{}");
    }) as unknown as typeof fetch;
    const jev = createJev({ apiKey: "test", fetch: slowFetch, maxConcurrency: 1, batch: false });
    const three = parallel("p", { branches: { a: ask("a", { questions: { q: noul("a?") } }), b: ask("b", { questions: { q: noul("b?") } }), c: ask("c", { questions: { q: noul("c?") } }) } });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);
    expect((await jev.run(three, "x", { signal: controller.signal })).status).toBe("aborted");
    expect(sent).toBe(1);
  });

  it("a retry backoff wakes up on abort instead of sleeping it out", async () => {
    const fetch503 = (async () => new Response("{}", { status: 503 })) as unknown as typeof fetch;
    const jev = createJev({ apiKey: "test", fetch: fetch503, retry: { initialDelayMs: 5_000, jitter: 0 } });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);
    const started = Date.now();
    expect((await jev.run(ask("a", { questions: { q: noul("?") } }), "x", { signal: controller.signal })).status).toBe("aborted");
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("a step's ctx.jev calls are cancelled with it", async () => {
    let askSignal: AbortSignal | undefined;
    const client = {
      model: "jev-latest",
      usdPerMillionTokens: 0,
      ask: (_s: unknown, _q: unknown, opts?: { signal?: AbortSignal }) =>
        new Promise((_, reject) => {
          askSignal = opts?.signal;
          opts?.signal?.addEventListener("abort", () => reject(opts.signal!.reason));
        }),
    } as unknown as JevClient;
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);
    const r = await createJev(client).run(step("adhoc", (s: string, ctx) => ctx.jev.ask(s, { q: noul("?") })), "x", { signal: controller.signal });
    expect(r.status).toBe("aborted");
    expect(askSignal?.aborted).toBe(true);
  });
});

describe("/docs/parallel#failures, /docs/errors", () => {
  it("siblings cut short by a failing branch close with a CancelledError whose cause is the failure", async () => {
    const r = await jevFrom(undefined, 200).run(
      parallel("p", { branches: { a: ask("a", { questions: { q: noul("?") } }), b: step("b", () => { throw new Error("boom"); }) } }),
      "x",
    );
    expect(r.status).toBe("error");
    const a = r.trace.spans.find((s) => s.path === "$/a")!;
    expect(a.status).toBe("error");
    expect(a.error).toMatchObject({ name: "CancelledError", code: "cancelled" });
    expect(r.trace.error).toMatchObject({ name: "NodeError", nodeId: "b", path: "$/b" });
  });

  it("a halting branch halts the run, and siblings still running close as halted", async () => {
    const r = await jevFrom((_k, q) => (q.instructions === "halt?" ? { noul: 0.1 } : undefined), 0).run(
      parallel("p", {
        branches: {
          slow: step("slow", (_: string, ctx) => new Promise((resolve, reject) => {
            const t = setTimeout(resolve, 500);
            ctx.signal.addEventListener("abort", () => (clearTimeout(t), reject(ctx.signal.reason)));
          })),
          guard: gate("guard", { ask: noul("halt?"), pass: { min: 0.5 }, then: emit("ok") }),
        },
      }),
      "x",
    );
    expect(r.status).toBe("halted");
    expect(r.trace.spans.find((s) => s.path === "$/slow")!.status).toBe("halted");
  });
});

describe("/docs/traces#decisions", () => {
  it("records the rules a decision was checked against, fired or not", async () => {
    expect((await decide(frontDesk, () => ({ confidence: 0.9 }))).lowConfidence).toEqual({ below: 0.4 });
    const g = await decide(
      gate("g", { ask: noul("?"), pass: { min: 0.6 }, then: emit("t"), otherwise: emit("o"), unsure: { margin: 0.1, minConfidence: 0.5, then: emit("u") } }),
      () => ({ noul: 0.95 }),
    );
    expect(g.unsure).toEqual({ margin: 0.1, minConfidence: 0.5 });
    expect(g.confidence).toBe(0.9); // a noul gate records confidence when minConfidence is set
    const plain = await decide(gate("g", { ask: noul("?"), pass: { min: 0.6 }, then: emit("t"), otherwise: emit("o") }), () => ({ noul: 0.95 }));
    expect(plain.confidence).toBeUndefined(); // …and not otherwise
    const c = await decide(cascade("c", { tiers: [tier("quick", { ask: noul("?"), minConfidence: 0.7 })], fallback: emit("f") }), () => ({ noul: 0.99 }));
    expect(c.tierBars).toEqual({ quick: 0.7 });
  });
});
