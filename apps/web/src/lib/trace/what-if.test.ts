import { describe, expect, it } from "vitest";
import { ask, cascade, chain, choice, createJev, decisions, emit, gate, noul, route, score, spanAt, tier, type AnyNode, type Json, type JevClient, type Trace } from "jevchain";
import { examples } from "jevchain-examples";
import { isRehearsal, rehearsalClient } from "./rehearsal";
import { decodeShare, encodeShare } from "./share";
import { forkableEdges, forkOf, forksOf, isWhatIf, WHAT_IF_MODEL, whatIfClient } from "./what-if";

/** The rehearsal client, counting what reaches it. */
function counted(): { client: JevClient; asked: string[] } {
  const inner = rehearsalClient({ latencyMs: [0, 0] });
  const asked: string[] = [];
  return {
    asked,
    client: {
      model: inner.model,
      usdPerMillionTokens: inner.usdPerMillionTokens,
      ask: (state, questions, options) => {
        asked.push(Object.keys(questions).join(","));
        return inner.ask(state, questions, options);
      },
    },
  };
}

async function base(root: AnyNode, input: Json): Promise<Trace> {
  return (await createJev(rehearsalClient({ latencyMs: [0, 0] })).run(root, input)).trace;
}

async function fork(root: AnyNode, trace: Trace, path: string, edge: string, inner: JevClient = counted().client): Promise<Trace> {
  return (await createJev(whatIfClient(inner, { root, trace, fork: { path, edge } })).run(root, trace.input)).trace;
}

const triage = chain(
  "support",
  ask("read", { questions: { angry: noul("Angry?") } }),
  route("triage", {
    ask: choice("What is this?", ["bug", "billing", "other"]),
    alsoAsk: { spicy: noul("Spicy?") },
    lowConfidence: { below: 0.2, then: emit("human", { id: "human" }) },
    branches: {
      bug: gate("urgent", {
        ask: noul("Blocked?"),
        pass: { min: 0.5 },
        unsure: { margin: 0.1, then: emit("check", { id: "check" }) },
        then: emit("page", { id: "page" }),
        otherwise: emit("ticket", { id: "ticket" }),
      }),
      billing: emit("billing", { id: "billing" }),
      other: emit("other", { id: "other" }),
    },
  }),
);
const TRIAGE = "$/1";

describe("whatIfClient", () => {
  it("forces a route down every road it didn't take", async () => {
    const a = await base(triage, "my invoice is wrong");
    const edges = forkableEdges(triage, a, TRIAGE);
    expect(edges.sort()).toEqual(["billing", "bug", "lowConfidence", "other"].filter((e) => e !== spanAt(a, TRIAGE)!.decision!.taken).sort());
    for (const edge of edges) {
      const b = await fork(triage, a, TRIAGE, edge);
      expect(b.status).toBe("ok");
      expect(spanAt(b, TRIAGE)!.decision!.taken).toBe(edge);
      expect(spanAt(b, `${TRIAGE}/${edge}`)).toBeDefined();
    }
  });

  it("replays what Jev already said before the fork, and asks only about the new road", async () => {
    const a = await base(triage, "the app crashes on save");
    const { client, asked } = counted();
    const b = await fork(triage, a, TRIAGE, forkableEdges(triage, a, TRIAGE).includes("bug") ? "bug" : "billing", client);
    // The ask before the fork and the route's own call are served from the trace.
    expect(spanAt(b, "$/0")!.calls[0]!.answers).toEqual(spanAt(a, "$/0")!.calls[0]!.answers);
    expect(spanAt(b, "$/0")!.calls[0]!.costUsd).toBe(0);
    expect(asked.filter((q) => q.includes("angry"))).toEqual([]);
    expect(asked.filter((q) => q.includes("spicy"))).toEqual([]);
    // alsoAsk answers ride along untouched.
    expect(spanAt(b, TRIAGE)!.calls[0]!.answers.spicy).toEqual(spanAt(a, TRIAGE)!.calls[0]!.answers.spicy);
  });

  it("labels the one steered call, and forkOf finds the fork again", async () => {
    const a = await base(triage, "refund please");
    const edge = forkableEdges(triage, a, TRIAGE)[0]!;
    const b = await fork(triage, a, TRIAGE, edge);
    expect(isWhatIf(a)).toBe(false);
    expect(isWhatIf(b)).toBe(true);
    expect(isRehearsal(b)).toBe(true);
    expect(b.spans.flatMap((s) => s.calls).filter((c) => c.model === WHAT_IF_MODEL)).toHaveLength(1);
    expect(forkOf(b)).toMatchObject({ path: TRIAGE, nodeId: "triage", edge });
    expect(forkOf(a)).toBeUndefined();
  });

  it("asks the inner client about the road that was never walked", async () => {
    let tried = 0;
    for (const input of ["the app crashes on save", "refund please", "hello", "my invoice is wrong", "it's on fire"]) {
      const a = await base(triage, input);
      if (spanAt(a, TRIAGE)!.decision!.taken === "bug") continue;
      const { client, asked } = counted();
      const b = await fork(triage, a, TRIAGE, "bug", client);
      // The gate under "bug" never ran in a, so the inner client (here: rehearsal) answers it, and only it.
      expect(asked).toEqual(["decision"]);
      expect(spanAt(b, `${TRIAGE}/bug`)!.calls[0]!.model).not.toBe(WHAT_IF_MODEL);
      tried++;
    }
    expect(tried).toBeGreaterThan(0);
  });

  it("still explains itself after a trip through a share link", async () => {
    const a = await base(triage, "refund please");
    const edge = forkableEdges(triage, a, TRIAGE)[0]!;
    const b = await fork(triage, a, TRIAGE, edge);
    const back = await decodeShare(await encodeShare({ v: 1, chain: { example: "x" }, input: b.input, trace: b }));
    expect(forkOf(back.trace)).toEqual(forkOf(b));
  });

  it("walks a gate to then, otherwise and unsure, and to halt when there's no otherwise", async () => {
    const g = (otherwise: boolean) =>
      gate("g", {
        ask: noul("Ok?"),
        pass: { min: 0.6 },
        unsure: { margin: 0.05, then: emit("hmm", { id: "hmm" }) },
        then: emit("yes", { id: "yes" }),
        ...(otherwise ? { otherwise: emit("no", { id: "no" }) } : {}),
      });
    for (const [root, want] of [
      [g(true), ["then", "otherwise", "unsure"]],
      [g(false), ["then", "unsure", "halt"]],
    ] as const) {
      const a = await base(root, "x");
      const edges = forkableEdges(root, a, "$");
      expect(edges.sort()).toEqual(want.filter((e) => e !== spanAt(a, "$")!.decision!.taken).sort());
      for (const edge of edges) {
        const b = await fork(root, a, "$", edge);
        expect(spanAt(b, "$")!.decision!.taken).toBe(edge);
        expect(b.status).toBe(edge === "halt" ? "halted" : "ok");
      }
    }
  });

  it("steers gates on a choice label, a score, and low confidence", async () => {
    const roots = [
      gate("label", { ask: choice("Tone?", ["kind", "rude"]), pass: { label: "rude", max: 0.3 }, then: emit("ok"), otherwise: emit("flag") }),
      gate("score", { ask: score("Heat?", ["mild", "warm", "hot", "lava"]), pass: { min: 2 }, then: emit("hot"), otherwise: emit("cool") }),
      gate("doubt", {
        ask: choice("Real?", ["yes", "no"]),
        pass: { label: "yes", min: 0.5 },
        unsure: { minConfidence: 0.9, then: emit("dunno") },
        then: emit("sure"),
        otherwise: emit("nope"),
      }),
    ];
    for (const root of roots) {
      for (const input of ["one", "two", "three"]) {
        const a = await base(root, input);
        for (const edge of forkableEdges(root, a, "$")) {
          const b = await fork(root, a, "$", edge);
          expect(spanAt(b, "$")!.decision!.taken, `${root.id} → ${edge}`).toBe(edge);
        }
      }
    }
  });

  it("won't offer a road the gate's own bar makes unreachable", async () => {
    const always = gate("always", { ask: noul("?"), pass: { min: 0 }, then: emit("in"), otherwise: emit("out") });
    const a = await base(always, "x");
    expect(forkableEdges(always, a, "$")).toEqual([]);
    expect(() => whatIfClient(rehearsalClient(), { root: always, trace: a, fork: { path: "$", edge: "otherwise" } })).toThrow(/can't be forced/);
  });

  it("forces a cascade to any tier or its fallback", async () => {
    const root = cascade("ladder", {
      tiers: [tier("quick", { ask: choice("Spam?", ["spam", "ham"]), minConfidence: 0.5 }), tier("careful", { ask: noul("Spam, really?"), minConfidence: 0.3 })],
      fallback: emit("human", { id: "human" }),
    });
    for (const input of ["buy now", "hi mum", "free crypto"]) {
      const a = await base(root, input);
      const edges = forkableEdges(root, a, "$");
      expect(edges).toHaveLength(2);
      for (const edge of edges) {
        const b = await fork(root, a, "$", edge);
        expect(spanAt(b, "$")!.decision!.taken).toBe(edge);
      }
    }
  });

  it("forces noul cascade tiers whose bar doesn't survive floating point (0.4, 0.2)", async () => {
    const root = cascade("nouls", {
      tiers: [tier("t1", { ask: noul("Sure?"), minConfidence: 0.4 }), tier("t2", { ask: noul("Really sure?"), minConfidence: 0.2 })],
      fallback: emit("human", { id: "human" }),
    });
    for (const input of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
      const a = await base(root, input);
      for (const edge of forkableEdges(root, a, "$")) {
        const b = await fork(root, a, "$", edge);
        expect(spanAt(b, "$")!.decision!.taken, `${input} → ${edge}`).toBe(edge);
        expect(forkOf(b)?.edge).toBe(edge);
      }
    }
  });

  it("offers nothing on a running trace, a node that didn't decide, or a road already taken", async () => {
    const a = await base(triage, "hello");
    expect(forkableEdges(triage, a, "$/0")).toEqual([]);
    expect(forkableEdges(triage, a, TRIAGE)).not.toContain(spanAt(a, TRIAGE)!.decision!.taken);
    expect(forkableEdges(triage, { ...a, status: "running" }, TRIAGE)).toEqual([]);
    expect(forkableEdges(triage, undefined, TRIAGE)).toEqual([]);
  });

  it("can force every untaken road of every decision in every example", async () => {
    let forced = 0;
    for (const ex of examples) {
      for (const { value } of ex.inputs) {
        const a = await base(ex.chain, value);
        for (const s of a.spans.filter((x) => x.decision)) {
          for (const edge of forkableEdges(ex.chain, a, s.path)) {
            const b = await fork(ex.chain, a, s.path, edge);
            expect(spanAt(b, s.path)?.decision?.taken, `${ex.slug} ${s.path} → ${edge}`).toBe(edge);
            forced++;
          }
        }
      }
    }
    expect(forced).toBeGreaterThan(10);
  });
});

describe("forking a fork", () => {
  /** A rehearsal run of `triage` whose triage went a way `want` accepts (trying inputs until one does). */
  async function runThat(want: (taken: string) => boolean): Promise<Trace> {
    for (let i = 0; i < 64; i++) {
      const a = await base(triage, `ticket #${i}`);
      if (want(spanAt(a, TRIAGE)!.decision!.taken)) return a;
    }
    throw new Error("no input took that road");
  }
  const GATE = `${TRIAGE}/bug`;

  it("keeps the first fork and forces a decision that only exists on the new road", async () => {
    const a = await runThat((t) => t !== "bug");
    const b = await fork(triage, a, TRIAGE, "bug");
    const edge = forkableEdges(triage, b, GATE)[0]!;
    expect(edge).toBeDefined();
    const { client, asked } = counted();
    const c = await fork(triage, b, GATE, edge, client);
    expect(spanAt(c, TRIAGE)!.decision!.taken).toBe("bug");
    expect(spanAt(c, GATE)!.decision!.taken).toBe(edge);
    expect(forksOf(c)).toEqual([
      { path: TRIAGE, nodeId: "triage", edge: "bug" },
      { path: GATE, nodeId: "urgent", edge },
    ]);
    // Everything was already said in b: nothing new reaches Jev.
    expect(asked).toEqual([]);
    // The first ask is still a's answer, served for free, and says so once.
    expect(spanAt(c, "$/0")!.calls[0]!.answers).toEqual(spanAt(a, "$/0")!.calls[0]!.answers);
    expect(spanAt(c, "$/0")!.calls[0]!.requestId).toMatch(/^replay:rehearsal_\d+$/);
  });

  it("re-forcing a forced decision leaves one fork, not two", async () => {
    const a = await runThat((t) => t !== "bug" && t !== "billing");
    const b = await fork(triage, a, TRIAGE, "bug");
    const c = await fork(triage, b, TRIAGE, "billing");
    expect(spanAt(c, TRIAGE)!.decision!.taken).toBe("billing");
    expect(forksOf(c)).toEqual([{ path: TRIAGE, nodeId: "triage", edge: "billing" }]);
  });

  it("still lists every fork, and is still a rehearsal, after a trip through a share link", async () => {
    const a = await runThat((t) => t !== "bug");
    const b = await fork(triage, a, TRIAGE, "bug");
    const c = await fork(triage, b, GATE, forkableEdges(triage, b, GATE)[0]!);
    const back = await decodeShare(await encodeShare({ v: 1, chain: { example: "x" }, input: c.input, trace: c }));
    expect(forksOf(back.trace)).toEqual(forksOf(c));
    expect(forksOf(back.trace)).toHaveLength(2);
    expect(isRehearsal(back.trace)).toBe(true);
  });

  it("forcing further up drops a fork whose road no longer runs", async () => {
    const a = await runThat((t) => t === "bug");
    const b = await fork(triage, a, GATE, forkableEdges(triage, a, GATE)[0]!);
    const c = await fork(triage, b, TRIAGE, "other");
    expect(forksOf(c)).toEqual([{ path: TRIAGE, nodeId: "triage", edge: "other" }]);
  });

  it("stays a rehearsal, even when every call left is a forced one", async () => {
    const leafy = route("pick", { ask: choice("Which?", ["x", "y", "z"]), branches: { x: emit("x"), y: emit("y"), z: emit("z") } });
    const a = await base(leafy, "hello");
    const b = await fork(leafy, a, "$", forkableEdges(leafy, a, "$")[0]!);
    expect(b.models).toEqual([WHAT_IF_MODEL]);
    expect(isRehearsal(b)).toBe(true);
    const c = await fork(leafy, b, "$", forkableEdges(leafy, b, "$")[0]!);
    expect(isRehearsal(c)).toBe(true);
    // ...and a what-if of a real run is not one.
    const fake = rehearsalClient({ latencyMs: [0, 0] });
    const real: JevClient = { model: "jev-test", usdPerMillionTokens: 1, ask: async (s, q, o) => ({ ...(await fake.ask(s, q, o)), model: "jev-test", requestId: "req_1" }) };
    const r = (await createJev(real).run(leafy, "hello")).trace;
    const rb = await fork(leafy, r, "$", forkableEdges(leafy, r, "$")[0]!, real);
    expect(isWhatIf(rb)).toBe(true);
    expect(isRehearsal(rb)).toBe(false);
  });

  it("can fork every fork of every example, two decisions deep, and every fork holds", async () => {
    let deep = 0;
    for (const ex of examples) {
      for (const { value } of ex.inputs) {
        const a = await base(ex.chain, value);
        for (const d1 of decisions(a)) {
          for (const e1 of forkableEdges(ex.chain, a, d1.path)) {
            const b = await fork(ex.chain, a, d1.path, e1);
            for (const d2 of decisions(b)) {
              for (const e2 of forkableEdges(ex.chain, b, d2.path)) {
                const c = await fork(ex.chain, b, d2.path, e2);
                const where = `${ex.slug} ${d1.path}→${e1} then ${d2.path}→${e2}`;
                expect(spanAt(c, d2.path)?.decision?.taken, where).toBe(e2);
                // The first fork holds wherever it's still on the road.
                if (d1.path !== d2.path && spanAt(c, d1.path)) expect(spanAt(c, d1.path)!.decision!.taken, where).toBe(e1);
                expect(forksOf(c).map((f) => f.path), where).toContain(d2.path);
                expect(isRehearsal(c), where).toBe(true);
                if (d1.path !== d2.path) deep++;
              }
            }
          }
        }
      }
    }
    expect(deep).toBeGreaterThan(5);
  });
});
