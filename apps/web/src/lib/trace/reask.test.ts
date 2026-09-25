import { describe, expect, it } from "vitest";
import { cascade, choice, createJev, emit, gate, JevAuthError, JevRateLimitError, noul, route, tier, type AnyNode, type Answer, type JevClient, type Json, type Question, type Trace } from "jevchain";
import { examples } from "jevchain-examples";
import { rehearsalClient } from "./rehearsal";
import { answeredReasks, REASKS, reaskBlocker, reaskInputs, steadinessOf, steadyHeadline, steadyText, type Steadiness } from "./reask";
import { runSweep } from "./sweep";
import { whatIfClient } from "./what-if";

/** A client that answers each question (by its instructions) from a queue: one entry per ask, the last one repeating. */
function scripted(answers: Record<string, Answer[]>): JevClient {
  const queues = new Map(Object.entries(answers).map(([k, v]) => [k, [...v]]));
  return {
    model: "scripted",
    usdPerMillionTokens: 0,
    async ask(_state, questions) {
      const out: Record<string, Answer> = {};
      for (const [k, q] of Object.entries(questions as Record<string, Question>)) {
        const queue = queues.get(String(q.instructions));
        if (!queue?.length) throw new Error(`no scripted answer for "${String(q.instructions)}"`);
        out[k] = queue.length > 1 ? queue.shift()! : queue[0]!;
      }
      return { answers: out, model: "scripted", usage: { inputTokens: 1, outputTokens: 0 }, costUsd: 0, latencyMs: 0, attempts: 1 } as never;
    },
  };
}

/** The run and its re-asks, the way the studio makes them: one client, the same input over and over. */
async function asks(root: AnyNode, answers: Record<string, Answer[]>, input: Json = "x"): Promise<{ base: Trace; reasks: Trace[] }> {
  const client = scripted(answers);
  const base = (await createJev(client).run(root, input)).trace;
  const { rows } = await runSweep(root, reaskInputs(input), client);
  return { base, reasks: rows.map((r) => r.trace!) };
}

const yes = (p: number): Answer => ({ type: "noul", noul: p });
const pick = (probabilities: Record<string, number>, confidence: number): Answer => ({
  type: "choice",
  choice: Object.entries(probabilities).reduce((a, b) => (b[1] > a[1] ? b : a))[0],
  probabilities,
  confidence,
});

// "Should I text them back?", shaped like the example: two tiers and a fallback.
const verdict = choice("Reply?", ["reply", "leave"]);
const textBack = cascade("reply", {
  title: "Should I reply?",
  tiers: [tier("gut-check", { title: "Gut check", ask: verdict, minConfidence: 0.7 }), tier("full-context", { title: "Full context", ask: verdict, minConfidence: 0.5 })],
  fallback: emit("group chat", { id: "group-chat" }),
});
const leave = (c: number) => pick({ reply: 0.3, leave: 0.7 }, c);

const desk = route("desk", {
  title: "Front desk",
  ask: choice("Which desk?", ["repair", "billing"]),
  lowConfidence: { below: 0.4, then: emit("dave", { id: "dave" }) },
  branches: {
    repair: gate("danger", {
      title: "Anyone in danger?",
      ask: noul("Danger?"),
      pass: { min: 0.5 },
      then: emit("page", { id: "page" }),
      otherwise: emit("ticket", { id: "ticket" }),
    }),
    billing: emit("b", { id: "b" }),
  },
});

const one = (all: Steadiness[], path: string) => all.find((s) => s.path === path)!;

describe("steadinessOf", () => {
  it("counts every ask that made the decision, and where the others went (the “lol ok” case)", async () => {
    // Gut check always refuses; full context lands either side of its 0.5 bar.
    const { base, reasks } = await asks(textBack, {
      "Reply?": [leave(0.28), leave(0.5), leave(0.33), leave(0.43), leave(0.3), leave(0.42), leave(0.33), leave(0.51), leave(0.29), leave(0.47), leave(0.3), leave(0.44)],
    });
    expect(base.spans[0]!.decision!.taken).toBe("full-context");
    const [s] = steadinessOf(textBack, base, reasks);
    expect(s).toMatchObject({ title: "Should I reply?", taken: "full-context", asked: 6, held: 2, missed: 0, verdict: "flipped" });
    // Ask 2 (re-ask 0) was the first to fall back.
    expect(s!.elsewhere).toEqual([{ edge: "fallback", count: 4, first: 0 }]);
    // Measured on the number the closest call moves: full context's confidence.
    expect(s!.flip).toMatchObject({ edge: "fallback", measure: "confidence at Full context", by: 0 });
    expect(s!.moved).toEqual({ min: 0.42, max: 0.51, by: 0.09, n: 6 });
    expect(steadyText(s!)).toBe("went “fallback” on 4 of 6 asks · jev's confidence at Full context ranged 0.42–0.51");
    expect(steadyHeadline([s!])).toBe("the decision went another way on at least one ask.");
  });

  it("held on every ask, but the wobble reaches a flip: could-flip", async () => {
    // Confidence 0.45 against a 0.4 bar: 0.05 from unsure. Re-asks move it 0.41–0.49 and never cross.
    const { base, reasks } = await asks(desk, {
      "Which desk?": [0.45, 0.41, 0.49, 0.44, 0.46, 0.47].map((c) => pick({ repair: 0.7, billing: 0.3 }, c)),
      "Danger?": [yes(0.1)],
    });
    const s = one(steadinessOf(desk, base, reasks), "$");
    expect(s).toMatchObject({ asked: 6, held: 6, verdict: "could-flip" });
    expect(s.flip).toMatchObject({ edge: "lowConfidence", by: 0.05 });
    expect(s.moved).toMatchObject({ min: 0.41, max: 0.49, by: 0.08 });
    expect(steadyText(s)).toBe("held on all 6 asks, but jev's confidence moved 0.08 between them: more than the 0.05 it takes to go “unsure”");
  });

  it("held with room to spare: the wobble stays short of every flip", async () => {
    const { base, reasks } = await asks(desk, {
      "Which desk?": [0.9, 0.91, 0.89, 0.9, 0.92, 0.9].map((c) => pick({ repair: 0.95, billing: 0.05 }, c)),
      "Danger?": [yes(0.1), yes(0.12), yes(0.09)],
    });
    const all = steadinessOf(desk, base, reasks);
    expect(all.map((s) => s.verdict)).toEqual(["held", "held"]);
    expect(steadyText(one(all, "$/repair"))).toBe("held on all 6 asks · jev's p(yes) moved 0.03; it'd take 0.40 to go “then”");
    expect(steadyHeadline(all)).toBe("every ask took the same road, and jev's numbers never moved far enough to flip one.");
  });

  it("judges the nearest flip the wobble reaches, even when a nearer one never moved", async () => {
    // The lead over billing (0.1) never moves; confidence (0.2 over the unsure bar) moves 0.2.
    const { base, reasks } = await asks(desk, {
      "Which desk?": [0.6, 0.8].map((c) => pick({ repair: 0.55, billing: 0.45 }, c)),
      "Danger?": [yes(0.1)],
    });
    const s = one(steadinessOf(desk, base, reasks), "$");
    expect(s.verdict).toBe("could-flip");
    expect(s.flip).toMatchObject({ edge: "lowConfidence", by: 0.2 });
    expect(s.moved?.by).toBe(0.2);
    // With nothing reached, the nearest flip is the one reported.
    const steady = await asks(desk, { "Which desk?": [pick({ repair: 0.55, billing: 0.45 }, 0.6)], "Danger?": [yes(0.1)] });
    expect(one(steadinessOf(desk, steady.base, steady.reasks), "$")).toMatchObject({ verdict: "held", flip: { edge: "billing", measure: "lead" }, moved: { by: 0 } });
  });

  it("a decision later asks never reached says so, and still judges the asks that did", async () => {
    // Asks 3 and 5 go unsure at the front desk, so they never ask about danger.
    const { base, reasks } = await asks(desk, {
      "Which desk?": [0.8, 0.8, 0.3, 0.8, 0.35, 0.8].map((c) => pick({ repair: 0.7, billing: 0.3 }, c)),
      "Danger?": [yes(0.1)],
    });
    const all = steadinessOf(desk, base, reasks);
    expect(one(all, "$")).toMatchObject({ asked: 6, held: 4, verdict: "flipped", elsewhere: [{ edge: "lowConfidence", count: 2, first: 1 }] });
    expect(one(all, "$/repair")).toMatchObject({ asked: 4, held: 4, missed: 2, verdict: "held" });
    expect(steadyText(one(all, "$/repair"))).toBe("held on all 4 asks · jev's p(yes) didn't move; it'd take 0.40 to go “then” · 2 re-asks never got here");
    expect(steadyHeadline(all)).toBe("1 of 2 decisions went another way on at least one ask.");
  });

  it("re-ask indices survive asks that haven't finished yet (the studio passes its rows as they fill in)", async () => {
    const { base, reasks } = await asks(desk, {
      "Which desk?": [0.8, 0.8, 0.8, 0.3].map((c) => pick({ repair: 0.7, billing: 0.3 }, c)),
      "Danger?": [yes(0.1)],
    });
    const partial: (Trace | undefined)[] = [reasks[0], undefined, { ...reasks[1]!, status: "aborted" }, reasks[2]];
    expect(answeredReasks(partial)).toHaveLength(2);
    const s = one(steadinessOf(desk, base, partial), "$");
    expect(s).toMatchObject({ asked: 3, held: 2, missed: 0 });
    // The one that went unsure is partial[3]: that's the index "open" gets.
    expect(s.elsewhere).toEqual([{ edge: "lowConfidence", count: 1, first: 3 }]);
  });

  it("with no re-asks back yet, no decision gets a verdict", async () => {
    const { base } = await asks(desk, { "Which desk?": [pick({ repair: 0.7, billing: 0.3 }, 0.8)], "Danger?": [yes(0.1)] });
    const all = steadinessOf(desk, base, []);
    expect(all.every((s) => s.asked === 1 && s.held === 1 && s.moved === undefined && s.verdict === "unasked")).toBe(true);
    expect(steadyText(all[0]!)).toBe("only this run got here, so there's no second answer to compare");
    expect(steadyHeadline(all)).toBe("no re-ask got as far as any decision this run made, so there's nothing to compare.");
  });

  it("route leads: measured as the gap to the other road, negative once it wins", async () => {
    const r = route("r", { ask: choice("Which?", ["a", "b"]), branches: { a: emit("a", { id: "a" }), b: emit("b", { id: "b" }) } });
    const a55 = pick({ a: 0.55, b: 0.45 }, 0.9);
    const a60 = pick({ a: 0.6, b: 0.4 }, 0.9);
    const b60 = pick({ a: 0.4, b: 0.6 }, 0.9);
    const { base, reasks } = await asks(r, { "Which?": [a55, b60, b60, a60, b60, b60] });
    const [s] = steadinessOf(r, base, reasks);
    expect(s).toMatchObject({ verdict: "flipped", asked: 6, held: 2, flip: { edge: "b", measure: "lead", by: 0.1 } });
    expect(s!.moved).toMatchObject({ min: -0.2, max: 0.2 });
    expect(steadyText(s!)).toBe("went “b” on 4 of 6 asks · the lead over “b” ranged -0.20–0.20");
  });
});

/** `client`, but ask number `n` (0-based, counting every ask the client gets: the run's, then each re-ask's) throws `error`. */
function failingAt(client: JevClient, failures: Record<number, () => Error>): JevClient {
  let n = 0;
  return {
    ...client,
    ask: (async (...args: Parameters<JevClient["ask"]>) => {
      const i = n++;
      const fail = failures[i];
      if (fail) throw fail();
      return client.ask(...args);
    }) as JevClient["ask"],
  };
}

/** The run, then the re-asks the way the studio makes them, with some asks failing. */
async function asksFailing(root: AnyNode, answers: Record<string, Answer[]>, failures: Record<number, () => Error>) {
  const client = failingAt(scripted(answers), failures);
  const base = (await createJev(client).run(root, "x")).trace;
  const { rows, stoppedBy } = await runSweep(root, reaskInputs("x"), client);
  return { base, rows, reasks: rows.map((r) => r.trace), stoppedBy };
}

describe("re-asks that fail", () => {
  // desk → repair → danger: two asks per run. The run is asks 0–1; re-ask k is asks 2k+2 and 2k+3.
  const steadyDesk = { "Which desk?": [pick({ repair: 0.7, billing: 0.3 }, 0.8)], "Danger?": [yes(0.1)] };

  for (const [name, error, kind] of [
    ["a 429", () => new JevRateLimitError(429, { error: { message: "slow down" } }), "rate-limited"],
    ["a 401", () => new JevAuthError(401, { error: { message: "bad key" } }), "bad-key"],
  ] as const) {
    it(`the first re-ask gets ${name}: no ask counted, no verdict anywhere`, async () => {
      const { base, rows, reasks, stoppedBy } = await asksFailing(desk, steadyDesk, { 2: error });
      expect(stoppedBy?.kind).toBe(kind);
      // The sweep kept the failed trace; it isn't an ask.
      expect(rows[0]!.trace?.status).toBe("error");
      expect(answeredReasks(reasks)).toHaveLength(0);
      const all = steadinessOf(desk, base, reasks);
      expect(all.map((s) => [s.verdict, s.asked, s.missed, s.failed])).toEqual([
        ["unasked", 1, 0, 0],
        ["unasked", 1, 0, 0],
      ]);
      expect(steadyHeadline(all)).not.toMatch(/same road|held/);
      expect(all.some((s) => /held/.test(steadyText(s)))).toBe(false);
    });
  }

  it("a 429 mid-way: only the re-asks jev answered count", async () => {
    // Re-asks 0–2 answer; re-ask 3's first ask (ask 8) is rate limited and the sweep stops.
    const { base, reasks, stoppedBy } = await asksFailing(desk, steadyDesk, { 8: () => new JevRateLimitError(429, { error: { message: "slow down" } }) });
    expect(stoppedBy?.kind).toBe("rate-limited");
    expect(reasks.filter(Boolean)).toHaveLength(4);
    expect(answeredReasks(reasks)).toHaveLength(3);
    const all = steadinessOf(desk, base, reasks);
    expect(all.map((s) => [s.verdict, s.asked, s.held, s.missed, s.failed])).toEqual([
      ["held", 4, 4, 0, 0],
      ["held", 4, 4, 0, 0],
    ]);
    expect(steadyText(all[0]!)).toMatch(/^held on all 4 asks/);
  });

  it("a re-ask that breaks after deciding something counts for what it decided, and as failed (not “never got here”) for the rest", async () => {
    // Re-ask 0 decides the front desk, then its danger ask (ask 3) is rate limited.
    const { base, reasks } = await asksFailing(desk, steadyDesk, { 3: () => new JevRateLimitError(429, { error: { message: "slow down" } }) });
    expect(reasks[0]!.status).toBe("error");
    expect(answeredReasks(reasks)).toHaveLength(1);
    const all = steadinessOf(desk, base, reasks);
    expect(one(all, "$")).toMatchObject({ verdict: "held", asked: 2, held: 2, failed: 0, missed: 0 });
    expect(one(all, "$/repair")).toMatchObject({ verdict: "unasked", asked: 1, failed: 1, missed: 0 });
    expect(steadyText(one(all, "$/repair"))).toBe("only this run got here, so there's no second answer to compare · 1 re-ask failed before getting here");
    expect(steadyHeadline(all)).toBe("every ask took the same road, and jev's numbers never moved far enough to flip it. one decision no re-ask got to.");
  });
});

describe("reaskBlocker", () => {
  it("lets a finished real run with a decision be asked again", async () => {
    const { base } = await asks(desk, { "Which desk?": [pick({ repair: 0.7, billing: 0.3 }, 0.8)], "Danger?": [yes(0.1)] });
    expect(reaskBlocker(base)).toBeNull();
    expect(reaskBlocker({ ...base, status: "halted" })).toBeNull();
  });

  it("refuses what it can't honestly re-ask", async () => {
    expect(reaskBlocker(undefined)).toBe("run it first");
    const { base } = await asks(desk, { "Which desk?": [pick({ repair: 0.7, billing: 0.3 }, 0.8)], "Danger?": [yes(0.1)] });
    expect(reaskBlocker({ ...base, status: "running" })).toBe("run it first");
    expect(reaskBlocker({ ...base, status: "aborted" })).toMatch(/stopped/);
    // A rehearsal answers from a hash of the input: the same every time.
    const rehearsed = (await createJev(rehearsalClient({ latencyMs: [0, 0] })).run(desk, "x")).trace;
    expect(reaskBlocker(rehearsed)).toMatch(/hash of the input/);
    // A what-if's numbers were bent.
    const forked = (await createJev(whatIfClient(scripted({ "Which desk?": [pick({ repair: 0.7, billing: 0.3 }, 0.8)], "Danger?": [yes(0.1)] }), { root: desk, trace: base, fork: { path: "$", edge: "billing" } })).run(desk, "x")).trace;
    expect(reaskBlocker(forked)).toMatch(/what-if/);
    // Nothing decided, nothing to hold.
    const plain = (await createJev(scripted({})).run(emit("hi", { id: "hi" }), "x")).trace;
    expect(reaskBlocker(plain)).toMatch(/nothing here was decided/);
  });
});

describe("reaskInputs", () => {
  it("is the same input REASKS times, labelled as the asks after the run", () => {
    const rows = reaskInputs({ message: "lol ok" });
    expect(rows).toHaveLength(REASKS);
    expect(rows.map((r) => r.label)).toEqual(["ask 2", "ask 3", "ask 4", "ask 5", "ask 6"]);
    expect(new Set(rows.map((r) => JSON.stringify(r.value)))).toEqual(new Set([JSON.stringify({ message: "lol ok" })]));
  });
});

describe("every example, asked again", () => {
  it("judges every decision a run made, and a run that always answers the same holds everywhere", async () => {
    // The rehearsal client is deterministic, so its re-asks are a clean control: nothing may flip or move.
    for (const ex of examples) {
      for (const sample of ex.inputs) {
        const client = rehearsalClient({ latencyMs: [0, 0] });
        const base = (await createJev(client).run(ex.chain, sample.value)).trace;
        const { rows } = await runSweep(ex.chain, reaskInputs(sample.value), client);
        const all = steadinessOf(ex.chain, base, rows.map((r) => r.trace));
        const where = `${ex.slug} · ${sample.label}`;
        expect(all.length, where).toBe(base.spans.filter((s) => s.decision).length);
        for (const s of all) {
          expect(s, where).toMatchObject({ asked: REASKS + 1, held: REASKS + 1, missed: 0 });
          if (s.moved) expect(s.moved.by, where).toBe(0);
          // A flip at 0 distance with no wobble is "sitting on the line": the only way a steady run reads as could-flip.
          expect(s.verdict === "held" || (s.verdict === "could-flip" && s.flip?.by === 0), where).toBe(true);
        }
      }
    }
  });
});
