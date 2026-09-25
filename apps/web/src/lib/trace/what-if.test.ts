import { describe, expect, it } from "vitest";
import { ask, cascade, chain, choice, createJev, emit, gate, noul, route, score, spanAt, tier, type AnyNode, type Json, type JevClient, type Trace } from "jevchain";
import { examples } from "jevchain-examples";
import { isRehearsal, rehearsalClient } from "./rehearsal";
import { forkableEdges, forkOf, isWhatIf, WHAT_IF_MODEL, whatIfClient } from "./what-if";

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
