import { describe, expect, it } from "vitest";
import {
  ask,
  cascade,
  chain,
  ChainConfigError,
  choice,
  createJev,
  emit,
  gate,
  noul,
  parallel,
  route,
  score,
  step,
  tier,
  traceFromEvents,
  type TraceEvent,
} from "../src/index.js";
import { fakeFetch } from "./helpers";

const jevWith = (f: ReturnType<typeof fakeFetch>, extra = {}) =>
  createJev({ apiKey: "test", fetch: f, retry: { initialDelayMs: 1, maxDelayMs: 2 }, ...extra });

const triage = route("triage", {
  ask: choice("What is this?", ["billing", "bug", "vibes"]),
  branches: {
    billing: emit("to billing"),
    bug: gate("urgent", {
      ask: noul("Is the user blocked?"),
      pass: { min: 0.7 },
      then: emit("page on-call"),
      otherwise: emit("file a ticket"),
    }),
    vibes: emit("reply with a gif: {{input}}"),
  },
});

describe("route", () => {
  it("takes the winning branch and records the decision", async () => {
    const f = fakeFetch((_s, _k, q) => (q.type === "choice" ? { choice: "bug" } : { noul: 0.95 }));
    const r = await jevWith(f).run(triage, "the app is on fire");
    expect(r.status).toBe("ok");
    expect(r.output).toBe("page on-call");
    const paths = r.trace.spans.map((s) => s.path);
    expect(paths).toEqual(["$", "$/bug", "$/bug/then"]);
    const d = r.trace.spans[0]!.decision!;
    expect(d.taken).toBe("bug");
    expect(d.edges.map((e) => [e.edge, e.taken])).toEqual([
      ["billing", false],
      ["bug", true],
      ["vibes", false],
    ]);
    expect(d.summary).toMatch(/Went to "bug" with 90%/);
    expect(r.trace.usage.calls).toBe(2);
    expect(r.trace.usage.costUsd).toBeCloseTo((200 / 1e6) * 0.042);
  });

  it("templates emit values", async () => {
    const f = fakeFetch((_s, _k, q) => (q.type === "choice" ? { choice: "vibes" } : undefined));
    const r = await jevWith(f).run(triage, "lol");
    expect(r.output).toBe("reply with a gif: lol");
  });

  it("falls back when confidence is low", async () => {
    const shaky = route("shaky", {
      ask: choice("?", ["a", "b"]),
      branches: { a: emit("A"), b: emit("B") },
      lowConfidence: { below: 0.5, then: emit("ask a human") },
    });
    const f = fakeFetch(() => ({ confidence: 0.2 }));
    const r = await jevWith(f).run(shaky, "hmm");
    expect(r.output).toBe("ask a human");
    const d = r.trace.spans[0]!.decision!;
    expect(d.taken).toBe("lowConfidence");
    expect(d.fallback).toBe(true);
    expect(d.summary).toMatch(/low-confidence path/);
  });

  it("sends alsoAsk questions in the same call", async () => {
    const r2 = route("r2", {
      ask: choice("?", ["a", "b"]),
      alsoAsk: { spicy: noul("spicy?") },
      branches: { a: emit(1), b: emit(2) },
    });
    const f = fakeFetch();
    const r = await jevWith(f).run(r2, "x");
    expect(f.calls).toHaveLength(1);
    expect(Object.keys(f.calls[0]!.questions)).toEqual(["decision", "spicy"]);
    expect(r.trace.spans[0]!.calls[0]!.answers.spicy).toMatchObject({ type: "noul" });
  });
});

describe("gate", () => {
  const g = gate("g", { ask: noul("ok?"), pass: { min: 0.7 }, then: emit("go") });

  it("halts (not errors) when the bar isn't met and there's no otherwise", async () => {
    const r = await jevWith(fakeFetch(() => ({ noul: 0.4 }))).run(g, "x");
    expect(r.status).toBe("halted");
    expect(r.trace.halted?.nodeId).toBe("g");
    expect(r.trace.halted?.summary).toMatch(/Blocked: p\(yes\) = 0.40, short of the 0.70 bar/);
    expect(r.trace.spans[0]!.status).toBe("halted");
  });

  it("takes the unsure path near the bar", async () => {
    const u = gate("u", { ask: noul("ok?"), pass: { min: 0.7 }, then: emit("go"), otherwise: emit("no"), unsure: { margin: 0.1, then: emit("?") } });
    const r = await jevWith(fakeFetch(() => ({ noul: 0.65 }))).run(u, "x");
    expect(r.output).toBe("?");
    expect(r.trace.spans[0]!.decision!.summary).toMatch(/Too close to call/);
  });

  it("measures a choice label's probability", async () => {
    const c = gate("c", { ask: choice("?", ["yes", "no"]), pass: { label: "no", min: 0.5 }, then: emit("T"), otherwise: emit("F") });
    const r = await jevWith(fakeFetch()).run(c, "x"); // "yes" gets 0.9, "no" 0.1
    expect(r.output).toBe("F");
    expect(r.trace.spans[0]!.decision).toMatchObject({ metric: "probability", taken: "otherwise" });
    expect(r.trace.spans[0]!.decision!.value).toBeCloseTo(0.1);
  });

  it("measures scores on the raw scale", async () => {
    const s = gate("s", { ask: score("spice?", ["mild", "hot", "volcanic"]), pass: { min: 1.5 }, then: emit("T"), otherwise: emit("F") });
    const r = await jevWith(fakeFetch()).run(s, "x"); // score = 2
    expect(r.output).toBe("T");
    expect(r.trace.spans[0]!.decision!.metric).toBe("score");
  });
});

describe("parallel", () => {
  it("runs branches concurrently and batches same-state asks into one request", async () => {
    const f = fakeFetch(undefined, { latencyMs: 20 });
    const p = parallel("p", {
      branches: {
        mood: ask("mood", { questions: { m: choice("?", ["good", "bad"]) } }),
        drama: ask("drama", { questions: { d: noul("drama?") } }),
      },
      join: (r) => `${r.mood.m.choice}/${r.drama.d.noul}`,
    });
    const r = await jevWith(f).run(p, "the group chat");
    expect(r.output).toBe("good/0.9");
    expect(f.calls).toHaveLength(1);
    expect(Object.keys(f.calls[0]!.questions).sort()).toEqual(["b0.m", "b1.d"]);
    const calls = r.trace.spans.flatMap((s) => s.calls);
    expect(calls.every((c) => c.batch?.size === 2)).toBe(true);
    expect(r.trace.usage).toMatchObject({ calls: 2, requests: 1, inputTokens: 100 });
  });

  it("doesn't batch different states", async () => {
    const f = fakeFetch();
    const p = parallel("p", {
      branches: {
        a: ask("a", { questions: { x: noul("?") }, state: "{{input.a}}" }),
        b: ask("b", { questions: { x: noul("?") }, state: "{{input.b}}" }),
      },
    });
    await jevWith(f).run(p, { a: "one", b: "two" });
    expect(f.calls.map((c) => c.state).sort()).toEqual(["one", "two"]);
  });

  it("cancels siblings when one branch fails", async () => {
    const f = fakeFetch(undefined, { latencyMs: 50 });
    let sawAbort = false;
    const p = parallel("p", {
      branches: {
        boom: step("boom", async () => {
          throw new Error("kaboom");
        }),
        slow: step("slow", (_: unknown, ctx) => new Promise((res) => {
          ctx.signal.addEventListener("abort", () => { sawAbort = true; res("late"); });
          setTimeout(() => res("done"), 200);
        })),
      },
    });
    const r = await jevWith(f).run(p, "x");
    expect(r.status).toBe("error");
    expect(r.error?.message).toMatch(/Node "boom" failed: kaboom/);
    expect(sawAbort).toBe(true);
    expect(r.trace.spans.find((s) => s.nodeId === "boom")!.status).toBe("error");
  });
});

describe("cascade", () => {
  const c = cascade("c", {
    tiers: [
      tier("quick", { ask: choice("?", ["yes", "no"]), minConfidence: 0.8, state: "{{input.preview}}" }),
      tier("thorough", { ask: choice("?", ["yes", "no"]), minConfidence: 0.6 }),
    ],
    fallback: step("llm", async () => "the llm says maybe"),
  });

  it("stops at the first confident tier", async () => {
    const f = fakeFetch(() => ({ confidence: 0.9 }));
    const r = await jevWith(f).run(c, { preview: "hi" });
    expect(r.output).toMatchObject({ resolvedBy: "tier", tier: "quick" });
    expect(f.calls).toHaveLength(1);
    expect(r.trace.spans[0]!.decision!.summary).toMatch(/cheap seats/);
  });

  it("escalates, then falls back", async () => {
    const f = fakeFetch(() => ({ confidence: 0.3 }));
    const r = await jevWith(f).run(c, { preview: "hi" });
    expect(r.output).toEqual({ resolvedBy: "fallback", output: "the llm says maybe" });
    expect(f.calls).toHaveLength(2);
    const d = r.trace.spans[0]!.decision!;
    expect(d.taken).toBe("fallback");
    expect(d.edges.map((e) => e.edge)).toEqual(["quick", "thorough", "fallback"]);
    expect(r.trace.spans[0]!.calls.map((x) => x.tier)).toEqual(["quick", "thorough"]);
  });
});

describe("step", () => {
  it("retries and records retries", async () => {
    let n = 0;
    const s = step("flaky", () => {
      if (++n < 3) throw new Error("nope");
      return "ok";
    }, { retries: 2 });
    const r = await jevWith(fakeFetch()).run(s, null);
    expect(r.output).toBe("ok");
    expect(r.trace.spans[0]!.retries).toHaveLength(2);
  });

  it("times out", async () => {
    const s = step("slow", () => new Promise((r) => setTimeout(r, 200)), { timeoutMs: 10 });
    const r = await jevWith(fakeFetch()).run(s, null);
    expect(r.status).toBe("error");
    expect(r.trace.spans[0]!.error?.code).toBe("timeout");
  });

  it("gets context: logs, results, run input", async () => {
    const c = chain(
      "c",
      ask("mood", { questions: { m: choice("?", ["good", "bad"]) } }),
      step("read", (a, ctx) => {
        ctx.log("mood checked", { m: a.m.choice });
        return `${a.m.choice}:${String(ctx.runInput)}:${Object.keys(ctx.results).join(",")}`;
      }),
    );
    const r = await jevWith(fakeFetch()).run(c, "hi");
    expect(r.output).toBe("good:hi:mood");
    expect(r.trace.spans.find((s) => s.nodeId === "read")!.logs[0]!.message).toBe("mood checked");
  });
});

describe("runs", () => {
  it("streams events that fold into the final trace", async () => {
    const events: TraceEvent[] = [];
    const s = jevWith(fakeFetch()).stream(triage, "x");
    for await (const e of s) events.push(e);
    const res = await s.result;
    expect(events[0]!.type).toBe("run:start");
    expect(events.at(-1)!.type).toBe("run:end");
    // Folding all but the last event gives the same spans as the final trace.
    const partial = traceFromEvents(events.slice(0, -1))!;
    expect(partial.spans.map((x) => [x.path, x.status])).toEqual(res.trace.spans.map((x) => [x.path, x.status]));
    expect(JSON.parse(JSON.stringify(res.trace))).toEqual(res.trace);
  });

  it("aborts", async () => {
    const ac = new AbortController();
    const f = fakeFetch(undefined, { latencyMs: 100 });
    const p = jevWith(f).run(triage, "x", { signal: ac.signal });
    setTimeout(() => ac.abort(), 10);
    const r = await p;
    expect(r.status).toBe("aborted");
    expect(r.trace.spans.every((s) => s.status !== "running")).toBe(true);
  });

  it("enforces a run deadline", async () => {
    const r = await jevWith(fakeFetch(undefined, { latencyMs: 100 })).run(triage, "x", { timeoutMs: 10 });
    expect(r.status).toBe("error");
    expect(r.error?.code).toBe("timeout");
  });

  it("rejects invalid chains up front", async () => {
    const bad = route("bad", { ask: choice("?", ["a", "b"]), branches: { a: emit(1) } as never });
    await expect(jevWith(fakeFetch()).run(bad, "x")).rejects.toBeInstanceOf(ChainConfigError);
  });

  it("surfaces API errors on the failing node", async () => {
    const f = fakeFetch(undefined, { statuses: [401] });
    const r = await jevWith(f).run(triage, "x");
    expect(r.status).toBe("error");
    expect(r.error?.code).toBe("auth_error");
    expect(r.trace.error?.nodeId).toBe("triage");
    expect(r.trace.spans[0]!.error?.message).toMatch(/rejected the API key.*status 401/);
  });

  it("retries 429/529 and records the retries on the span", async () => {
    const f = fakeFetch((_s, _k, q) => (q.type === "choice" ? { choice: "billing" } : undefined), { statuses: [429, 529] });
    const r = await jevWith(f).run(triage, "x");
    expect(r.status).toBe("ok");
    expect(r.trace.spans[0]!.retries.map((x) => x.error.code)).toEqual(["rate_limited", "overloaded"]);
    expect(r.trace.spans[0]!.calls[0]!.attempts).toBe(3);
  });
});
