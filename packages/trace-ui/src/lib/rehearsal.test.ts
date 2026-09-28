import { describe, expect, it } from "vitest";
import { choice, createJev, emit, gate, noul, route, score } from "jevchain";
import { examples } from "jevchain-examples";
import { isRehearsal, REHEARSAL_MODEL, rehearsalAnswer, rehearsalClient } from "./rehearsal";

const fast = () => createJev(rehearsalClient({ latencyMs: [0, 0] }));

const triage = route("triage", {
  ask: choice("What is this?", ["bug", "billing", "other"]),
  branches: {
    bug: gate("urgent", { ask: noul("Blocked?"), pass: { min: 0.5 }, then: emit("page", { id: "page" }), otherwise: emit("ticket", { id: "ticket" }) }),
    billing: emit("billing", { id: "billing" }),
    other: emit("other", { id: "other" }),
  },
});

describe("rehearsalAnswer", () => {
  it("is deterministic in the state and the question", () => {
    const q = choice("What is this?", ["bug", "billing", "other"]);
    expect(rehearsalAnswer("my app crashed", "kind", q)).toEqual(rehearsalAnswer("my app crashed", "kind", q));
    const others = ["refund please", "hello", "it's on fire", "why"].map((s) => rehearsalAnswer(s, "kind", q));
    expect(new Set(others.map((a) => JSON.stringify(a))).size).toBeGreaterThan(1);
  });

  it("answers every question type in the shape Jev does", () => {
    const c = rehearsalAnswer("x", "c", choice("?", ["a", "b", "c"]));
    if (c.type !== "choice") throw new Error("expected a choice");
    const ps = Object.values(c.probabilities);
    expect(ps.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(c.probabilities[c.choice]).toBe(Math.max(...ps));
    expect(c.confidence).toBeGreaterThanOrEqual(0);
    expect(c.confidence).toBeLessThanOrEqual(1);

    const s = rehearsalAnswer("x", "s", score("How spicy?", ["mild", "medium", "hot", "volcanic"]));
    if (s.type !== "score") throw new Error("expected a score");
    expect(Object.keys(s.probabilities)).toEqual(["0", "1", "2", "3"]);
    expect(Object.values(s.probabilities).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
    expect(s.score).toBeGreaterThanOrEqual(0);
    expect(s.score).toBeLessThanOrEqual(3);
    expect(s.legend["3"]).toBe("volcanic");

    const n = rehearsalAnswer("x", "n", noul("Blocked?"));
    if (n.type !== "noul") throw new Error("expected a noul");
    expect(n.noul).toBeGreaterThanOrEqual(0);
    expect(n.noul).toBeLessThanOrEqual(1);
  });
});

describe("rehearsalClient", () => {
  it("runs a chain end to end, and the trace says it was a rehearsal", async () => {
    const { trace } = await fast().run(triage, "the login button does nothing");
    expect(trace.status).toBe("ok");
    expect(trace.models).toEqual([REHEARSAL_MODEL]);
    expect(trace.usage.costUsd).toBe(0);
    expect(isRehearsal(trace)).toBe(true);
    expect(trace.spans[0]!.decision?.edges.map((e) => e.edge).sort()).toEqual(["billing", "bug", "other"]);
  });

  it("takes the same path for the same input, and different paths across inputs", async () => {
    const pathOf = async (input: string) =>
      (await fast().run(triage, input)).trace.spans.map((s) => s.nodeId).join(" > ");
    expect(await pathOf("same input")).toBe(await pathOf("same input"));
    const inputs = Array.from({ length: 24 }, (_, i) => `ticket #${i}`);
    const paths = new Set(await Promise.all(inputs.map(pathOf)));
    expect(paths.size).toBeGreaterThanOrEqual(3);
  });

  it("stops when the run is aborted", async () => {
    const ac = new AbortController();
    const running = createJev(rehearsalClient({ latencyMs: [5_000, 5_000] })).run(triage, "slow", { signal: ac.signal });
    ac.abort(new Error("stopped"));
    const { trace } = await running;
    expect(trace.status).toBe("aborted");
  });

  it("rehearses every bundled example without breaking the chain", async () => {
    for (const ex of examples) {
      for (const { value } of ex.inputs) {
        const { trace } = await fast().run(ex.chain, value);
        expect(["ok", "halted"], `${ex.slug}: ${trace.error?.message ?? ""}`).toContain(trace.status);
        expect(isRehearsal(trace)).toBe(true);
      }
    }
  });
});

describe("isRehearsal", () => {
  it("is false for real traces and for no trace at all", () => {
    expect(isRehearsal({ models: ["jev-1.13.0"] })).toBe(false);
    expect(isRehearsal({ models: [] })).toBe(false);
    expect(isRehearsal(undefined)).toBe(false);
  });
});
