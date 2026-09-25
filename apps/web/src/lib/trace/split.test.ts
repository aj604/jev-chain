import { describe, expect, it } from "vitest";
import { cascade, choice, createJev, emit, gate, JevRateLimitError, noul, route, tier, type AnyNode, type Answer, type JevClient, type Question, type Trace } from "jevchain";
import { examples } from "jevchain-examples";
import { rehearsalClient } from "./rehearsal";
import { reaskInputs } from "./reask";
import { hasReasks, sameInput, splitHeadline, splitsOf, splitText, type Split } from "./split";
import { runSweep } from "./sweep";

/**
 * A client that answers per input: `answers[input][instructions]` is a queue,
 * one entry per ask of that input, the last one repeating. A function entry
 * throws instead (a 429, say).
 */
function byInput(answers: Record<string, Record<string, (Answer | (() => Error))[]>>): JevClient {
  const queues = new Map<string, (Answer | (() => Error))[]>();
  for (const [input, qs] of Object.entries(answers)) for (const [k, v] of Object.entries(qs)) queues.set(`${input}|${k}`, [...v]);
  return {
    model: "scripted",
    usdPerMillionTokens: 0,
    async ask(state, questions) {
      const out: Record<string, Answer> = {};
      for (const [k, q] of Object.entries(questions as Record<string, Question>)) {
        const queue = queues.get(`${String(state)}|${String(q.instructions)}`);
        if (!queue?.length) throw new Error(`no scripted answer for ${String(state)} / "${String(q.instructions)}"`);
        const next = queue.length > 1 ? queue.shift()! : queue[0]!;
        if (typeof next === "function") throw next();
        out[k] = next;
      }
      return { answers: out, model: "scripted", usage: { inputTokens: 1, outputTokens: 0 }, costUsd: 0, latencyMs: 0, attempts: 1 } as never;
    },
  };
}

/** Compare mode, then "ask both again": run a and b once each, then each input REASKS more times, the way the studio does. */
async function compareAsks(root: AnyNode, client: JevClient, a = "a", b = "b"): Promise<{ a: Trace; b: Trace; reasksA: (Trace | undefined)[]; reasksB: (Trace | undefined)[] }> {
  const jev = createJev(client);
  const ta = (await jev.run(root, a)).trace;
  const tb = (await jev.run(root, b)).trace;
  const reasksA = (await runSweep(root, reaskInputs(a), client)).rows.map((r) => r.trace);
  const reasksB = (await runSweep(root, reaskInputs(b), client)).rows.map((r) => r.trace);
  return { a: ta, b: tb, reasksA, reasksB };
}

const pick = (probabilities: Record<string, number>, confidence: number): Answer => ({
  type: "choice",
  choice: Object.entries(probabilities).reduce((x, y) => (y[1] > x[1] ? y : x))[0],
  probabilities,
  confidence,
});
const yes = (p: number): Answer => ({ type: "noul", noul: p });

// "Should I text them back?", shaped like the example: gut check (0.7), full context (0.5), then the group chat.
const verdict = choice("Reply?", ["reply", "leave"]);
const textBack = cascade("reply", {
  title: "Should I reply?",
  tiers: [tier("gut-check", { title: "Gut check", ask: verdict, minConfidence: 0.7 }), tier("full-context", { title: "Full context", ask: verdict, minConfidence: 0.5 })],
  fallback: emit("group chat", { id: "group-chat" }),
});
const leave = (c: number) => pick({ reply: 0.3, leave: 0.7 }, c);
/** One ask of the cascade: gut check refuses at 0.3, full context answers at `c` (falls back under 0.5). */
const full = (c: number) => [leave(0.3), leave(c)];

const desk = route("desk", {
  title: "Front desk",
  ask: choice("Which desk?", ["repair", "billing"]),
  lowConfidence: { below: 0.4, then: emit("dave", { id: "dave" }) },
  branches: {
    repair: gate("danger", { title: "Anyone in danger?", ask: noul("Danger?"), pass: { min: 0.5 }, then: emit("page", { id: "page" }), otherwise: emit("ticket", { id: "ticket" }) }),
    billing: emit("b", { id: "b" }),
  },
});
const toRepair = pick({ repair: 0.9, billing: 0.1 }, 0.9);
const toBilling = pick({ repair: 0.1, billing: 0.9 }, 0.9);

const one = (all: Split[], path: string) => all.find((s) => s.path === path)!;

describe("splitsOf", () => {
  it("the “lol ok” case: a and b split on one pull, but a's input goes b's way too when asked again (both ways)", async () => {
    // a: full context answers at 0.51 on the pull (→ full-context), then 0.43, 0.47, 0.51, 0.42, 0.44 (4 fall back).
    // b: always falls back.
    const { a, b, reasksA, reasksB } = await compareAsks(
      textBack,
      byInput({ a: { "Reply?": [0.51, 0.43, 0.47, 0.51, 0.42, 0.44].flatMap(full) }, b: { "Reply?": full(0.3) } }),
    );
    expect([a.spans[0]!.decision!.taken, b.spans[0]!.decision!.taken]).toEqual(["full-context", "fallback"]);

    // The one-pull headline is what the studio said before: it reads as "the edit did it".
    expect(splitHeadline(a, b).text).toBe("diverged at Should I reply?: a went “full-context”, b went “fallback”.");

    const splits = splitsOf(a, reasksA, b, reasksB);
    const s = one(splits, "$");
    expect(s).toMatchObject({
      verdict: "both-ways",
      shared: ["fallback"],
      a: { asks: 6, reached: 6, roads: [{ edge: "fallback", count: 4 }, { edge: "full-context", count: 2 }] },
      b: { asks: 6, reached: 6, roads: [{ edge: "fallback", count: 6 }] },
    });
    expect(splitText(s)).toBe("both inputs went “fallback”: a's “fallback” 4, “full-context” 2 of 6, b's “fallback” 6 of 6");
    expect(splitHeadline(a, b, splits).text).toBe(
      "diverged at Should I reply?: a went “full-context”, b went “fallback”. but asked again, both inputs went “fallback” (a on 4 of 6 asks, b on 6 of 6), so this split alone doesn't show the inputs are told apart here.",
    );
  });

  it("apart on every ask: the inputs never share a road, so the split holds up", async () => {
    const { a, b, reasksA, reasksB } = await compareAsks(
      textBack,
      byInput({ a: { "Reply?": [0.9, 0.85, 0.8, 0.95, 0.9, 0.88].map(leave) }, b: { "Reply?": [0.62, 0.55, 0.7, 0.58, 0.6, 0.51].flatMap(full) } }),
    );
    const splits = splitsOf(a, reasksA, b, reasksB);
    expect(splits.map((s) => [s.path, s.verdict, s.shared])).toEqual([["$", "apart", []]]);
    expect(splitText(splits[0]!)).toBe("apart on every ask: a's input “gut-check” 6 of 6, b's “full-context” 6 of 6");
    expect(splitHeadline(a, b, splits).text).toBe("diverged at Should I reply?, on every ask: a's input went “gut-check” 6 of 6, b's “full-context” 6 of 6.");
  });

  it("same road on one pull, but asked again one input goes elsewhere: the pull hid a difference", async () => {
    const { a, b, reasksA, reasksB } = await compareAsks(desk, byInput({ a: { "Which desk?": [toRepair], "Danger?": [yes(0.1)] }, b: { "Which desk?": [toRepair, toBilling, toRepair, toBilling, toRepair, toRepair], "Danger?": [yes(0.1)] } }));
    expect(splitHeadline(a, b).text).toBe("same road, every fork. only the numbers differ.");
    const splits = splitsOf(a, reasksA, b, reasksB);
    expect(one(splits, "$")).toMatchObject({ verdict: "both-ways", shared: ["repair"], b: { roads: [{ edge: "repair", count: 4 }, { edge: "billing", count: 2 }] } });
    // The gate only repair reaches: 6 of a's asks, 4 of b's, same road every time.
    expect(one(splits, "$/repair")).toMatchObject({ verdict: "same", a: { asks: 6, reached: 6 }, b: { asks: 6, reached: 4 } });
    expect(splitText(one(splits, "$/repair"))).toBe("“otherwise” on every ask of both inputs (6 and 4)");
    expect(splitHeadline(a, b, splits)).toEqual({
      text: "same road this pull, but not on every ask: at Front desk, a's input went “repair” 6 of 6, b's “repair” 4, “billing” 2 of 6.",
      diverged: true,
      path: "$",
    });
  });

  it("same road on every ask of both", async () => {
    const { a, b, reasksA, reasksB } = await compareAsks(desk, byInput({ a: { "Which desk?": [toRepair], "Danger?": [yes(0.1)] }, b: { "Which desk?": [toRepair], "Danger?": [yes(0.2)] } }));
    const splits = splitsOf(a, reasksA, b, reasksB);
    expect(splits.map((s) => s.verdict)).toEqual(["same", "same"]);
    expect(splitHeadline(a, b, splits)).toEqual({ text: "same road, every fork, on every ask (6 of a's input, 6 of b's). only the numbers differ.", diverged: false });
  });

  it("a decision only one input reaches is one-sided (the decision before it explains why)", async () => {
    const { a, b, reasksA, reasksB } = await compareAsks(desk, byInput({ a: { "Which desk?": [toRepair], "Danger?": [yes(0.9)] }, b: { "Which desk?": [toBilling] } }));
    const splits = splitsOf(a, reasksA, b, reasksB);
    expect(one(splits, "$").verdict).toBe("apart");
    expect(one(splits, "$/repair")).toMatchObject({ verdict: "one-sided", a: { reached: 6 }, b: { asks: 6, reached: 0, roads: [] } });
    expect(splitText(one(splits, "$/repair"))).toBe("only a's input got here (6 of its 6 asks): “then” 6 of 6");
  });

  it("decisions only a re-ask made are read too, in a's order first", async () => {
    // a goes billing on its pull, repair on a re-ask; the gate is only in that re-ask.
    const { a, b, reasksA, reasksB } = await compareAsks(desk, byInput({ a: { "Which desk?": [toBilling, toRepair, toBilling], "Danger?": [yes(0.1)] }, b: { "Which desk?": [toBilling] } }));
    const splits = splitsOf(a, reasksA, b, reasksB);
    expect(splits.map((s) => [s.path, s.verdict])).toEqual([
      ["$", "both-ways"],
      ["$/repair", "one-sided"],
    ]);
    expect(one(splits, "$/repair").a).toEqual({ asks: 6, reached: 1, roads: [{ edge: "otherwise", count: 1 }] });
  });

  it("re-asks that failed before deciding anything don't count; one side with a single answer is too thin to call apart", async () => {
    const limited = () => new JevRateLimitError(429, { error: { message: "slow down" } });
    const client = byInput({ a: { "Reply?": [leave(0.9)] }, b: { "Reply?": [...full(0.6), limited] } });
    const { a, b, reasksA, reasksB } = await compareAsks(textBack, client);
    // The first re-ask of b got the 429; the sweep stopped there.
    expect(reasksB.map((t) => t?.status)).toEqual(["error", undefined, undefined, undefined, undefined]);
    const splits = splitsOf(a, reasksA, b, reasksB);
    expect(one(splits, "$")).toMatchObject({ verdict: "thin", a: { asks: 6, reached: 6 }, b: { asks: 1, reached: 1 } });
    expect(splitText(one(splits, "$"))).toBe("b's input got here on one ask only, too few to tell · a's “gut-check” 6 of 6, b's “full-context” 1 of 1");
    // Thin says nothing either way: the headline stays the one-pull one.
    expect(splitHeadline(a, b, splits).text).toBe("diverged at Should I reply?: a went “gut-check”, b went “full-context”.");
  });

  it("a single answer on one side that shares a road is still proof the other goes both ways", async () => {
    // Only a was asked again (the studio's `a`): its re-asks go b's way. b's one pull is enough to see it.
    const client = byInput({ a: { "Reply?": [0.6, 0.3].flatMap(full) }, b: { "Reply?": full(0.3) } });
    const jev = createJev(client);
    const a = (await jev.run(textBack, "a")).trace;
    const b = (await jev.run(textBack, "b")).trace;
    const reasksA = (await runSweep(textBack, reaskInputs("a"), client)).rows.map((r) => r.trace!);
    const splits = splitsOf(a, reasksA, b, []);
    expect(one(splits, "$")).toMatchObject({ verdict: "both-ways", b: { asks: 1 } });
    expect(splitHeadline(a, b, splits).text).toMatch(/but asked again, both inputs went “fallback” \(a on 5 of 6 asks, b on 1 of 1\)/);
  });
});

describe("splitHeadline without re-asks", () => {
  it("is the one-pull headline, “unsure” for a route's low-confidence road", async () => {
    const client = byInput({ a: { "Which desk?": [toRepair], "Danger?": [yes(0.1)] }, b: { "Which desk?": [pick({ repair: 0.6, billing: 0.4 }, 0.2)] } });
    const jev = createJev(client);
    const a = (await jev.run(desk, "a")).trace;
    const b = (await jev.run(desk, "b")).trace;
    expect(splitHeadline(a, b)).toEqual({ text: "diverged at Front desk: a went “repair”, b went “unsure”.", diverged: true, path: "$" });
    expect(hasReasks(splitsOf(a, [], b, []))).toBe(false);
    // No re-asks in the splits: the same headline.
    expect(splitHeadline(a, b, splitsOf(a, [], b, [])).text).toBe("diverged at Front desk: a went “repair”, b went “unsure”.");
  });

  it("says it's jev, not the input, when a and b are the same input", async () => {
    // Key order doesn't make it a different input.
    expect(sameInput({ m: "lol ok", n: 1 }, { n: 1, m: "lol ok" })).toBe(true);
    expect(sameInput({ m: "lol ok" }, { m: "lol ok " })).toBe(false);
    expect(sameInput([1, { a: 1 }], [1, { a: 1 }])).toBe(true);
    expect(sameInput("x", undefined)).toBe(false);
    // One answer queue whatever the state: the same input, answered 0.6 then 0.3 at full context.
    const inner = byInput({ same: { "Reply?": [...full(0.6), ...full(0.3)] } });
    const jev = createJev({ ...inner, ask: (_state, q, o) => inner.ask("same", q, o) } as JevClient);
    const a = (await jev.run(textBack, { m: "lol ok", n: 1 })).trace;
    const b = (await jev.run(textBack, { n: 1, m: "lol ok" })).trace;
    expect(splitHeadline(a, b).text).toBe("diverged at Should I reply?: a went “full-context”, b went “fallback”. same input both times, so that's jev answering differently, not the input.");
  });
});

describe("every example, compared and asked again", () => {
  it("with answers that never change, a split is always apart and nothing goes both ways", async () => {
    // The rehearsal client is deterministic: the same input takes the same road every time. So re-asks can
    // never show an input going two ways, and every split between two inputs must hold on every ask.
    const client = rehearsalClient({ latencyMs: [0, 0] });
    const tally = { pairs: 0, same: 0, apart: 0, oneSided: 0 };
    for (const ex of examples) {
      // Every sample, pulled once and asked again.
      const asked = [];
      for (const x of ex.inputs) {
        const run = (await createJev(client).run(ex.chain, x.value)).trace;
        const reasks = (await runSweep(ex.chain, reaskInputs(x.value), client)).rows.map((r) => r.trace);
        asked.push({ run, reasks });
      }
      // Every pair of samples, compared.
      for (let i = 0; i < asked.length; i++) {
        for (let j = i + 1; j < asked.length; j++) {
          const [x, y] = [asked[i]!, asked[j]!];
          const splits = splitsOf(x.run, x.reasks, y.run, y.reasks);
          const where = `${ex.slug} ${i}v${j}`;
          tally.pairs++;
          for (const s of splits) {
            expect(s.verdict, `${where} ${s.path}`).not.toBe("both-ways");
            expect(s.verdict, `${where} ${s.path}`).not.toBe("thin");
            expect([s.a.asks, s.b.asks], where).toEqual([6, 6]);
            if (s.verdict === "one-sided") {
              tally.oneSided++;
              continue;
            }
            // One road per input, every ask: apart exactly when the two pulls disagreed there.
            expect([s.a.roads.length, s.b.roads.length], where).toEqual([1, 1]);
            const apart = s.a.roads[0]!.edge !== s.b.roads[0]!.edge;
            expect(s.verdict, `${where} ${s.path}`).toBe(apart ? "apart" : "same");
            tally[s.verdict === "apart" ? "apart" : "same"]++;
          }
          const head = splitHeadline(x.run, y.run, splits);
          expect(head.text, where).not.toMatch(/both inputs went|not on every ask/);
          if (head.text.startsWith("diverged at")) expect(head.text, where).toMatch(/, on every ask: /);
        }
      }
    }
    // The control has to see both outcomes to mean anything (one-sided has its own test above).
    expect(tally.pairs).toBeGreaterThanOrEqual(10);
    expect(tally.same).toBeGreaterThan(0);
    expect(tally.apart).toBeGreaterThan(0);
  });
});
