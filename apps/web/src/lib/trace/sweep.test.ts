import { describe, expect, it } from "vitest";
import {
  cascade,
  chain,
  choice,
  decisions,
  emit,
  gate,
  graphOf,
  JevAuthError,
  noul,
  parallel,
  route,
  step,
  tier,
  type AnyNode,
  type Answer,
  type FlowGraph,
  type JevClient,
  type Json,
  type Question,
  type Trace,
} from "jevchain";
import { examples } from "jevchain-examples";
import { rehearsalClient } from "./rehearsal";
import { MAX_SWEEP, parseSweepLines, routeOf, runSweep, sweepInputs, tallyDecisions, trafficOf, unfinished, unreachedRoads, visits } from "./sweep";

/**
 * A client whose judgement is readable: a choice goes to whichever label the
 * text mentions (0.9), a yes/no is "yes" when the text shouts.
 */
function literal(): JevClient & { asked: number } {
  const c = {
    asked: 0,
    model: "literal",
    usdPerMillionTokens: 0,
    async ask(state: unknown, questions: Record<string, Question>) {
      c.asked++;
      const text = typeof state === "string" ? state : JSON.stringify(state);
      const answers: Record<string, Answer> = {};
      for (const [k, q] of Object.entries(questions)) {
        if (q.type === "choice") {
          const labels = Object.keys(q.criteria);
          const hit = labels.find((l) => text.includes(l));
          const probabilities = Object.fromEntries(labels.map((l) => [l, hit ? (l === hit ? 0.9 : 0.1 / (labels.length - 1)) : 1 / labels.length]));
          answers[k] = { type: "choice", choice: hit ?? labels[0]!, probabilities, confidence: hit ? 0.9 : 0.1 };
        } else if (q.type === "noul") {
          const noulValue = text.includes("!") ? 0.9 : 0.1;
          answers[k] = { type: "noul", noul: noulValue };
        } else {
          throw new Error(`unexpected ${q.type} question`);
        }
      }
      return { answers, model: "literal", usage: { inputTokens: 1, outputTokens: 0 }, costUsd: 0, latencyMs: 0, attempts: 1 } as never;
    },
  };
  return c;
}

const triage = chain(
  "support",
  route("triage", {
    ask: choice("What is this?", ["bug", "billing", "other"]),
    lowConfidence: { below: 0.5, then: emit("human", { id: "human" }) },
    branches: {
      bug: gate("urgent", {
        ask: noul("Blocked?"),
        pass: { min: 0.5 },
        then: emit("page", { id: "page" }),
        otherwise: emit("ticket", { id: "ticket" }),
      }),
      billing: emit("billing", { id: "billing" }),
      other: emit("other", { id: "other" }),
    },
  }),
);
const graph = graphOf(triage);
const TRIAGE = "$/0";
const vertexOf = (nodeId: string) => graph.vertices.find((v) => v.nodeId === nodeId)!.id;

async function sweep(inputs: string[], client: JevClient = literal()): Promise<Trace[]> {
  const { rows } = await runSweep(
    triage,
    inputs.map((value) => ({ label: value, value })),
    client,
  );
  return rows.map((r) => r.trace!);
}

describe("parseSweepLines", () => {
  it("reads text lines, json lines, and skips blanks", () => {
    expect(parseSweepLines('my toaster hums\n\n  {"a": 1}  \n"quoted"\n[1,2]\n')).toEqual({ ok: true, values: ["my toaster hums", { a: 1 }, "quoted", [1, 2]] });
  });
  it("points at a line that looks like json but isn't", () => {
    expect(parseSweepLines("fine\n{nope")).toEqual({ ok: false, error: "line 2 looks like json but doesn't parse", line: 2 });
  });
});

describe("sweepInputs", () => {
  const samples = [
    { label: "a", value: "one" },
    { label: "b", value: { x: 1 } },
  ];
  it("runs the samples, then your input, then the extras, without duplicates", () => {
    expect(sweepInputs(samples, "mine", ["one", { x: 1 }, "two", { y: 2 }]).inputs).toEqual([
      { label: "a", value: "one" },
      { label: "b", value: { x: 1 } },
      { label: "your input", value: "mine" },
      { label: "two", value: "two" },
      { label: '{"y":2}', value: { y: 2 } },
    ]);
  });
  it("doesn't repeat the editor's input when it's a sample", () => {
    expect(sweepInputs(samples, { x: 1 }).inputs.map((i) => i.label)).toEqual(["a", "b"]);
  });
  it(`caps at ${MAX_SWEEP} and says how many it left out`, () => {
    const extra = Array.from({ length: 30 }, (_, i) => `input ${i}`);
    const { inputs, dropped } = sweepInputs(samples, undefined, extra);
    expect(inputs).toHaveLength(MAX_SWEEP);
    expect(dropped).toBe(32 - MAX_SWEEP);
  });
});

describe("runSweep + reading it", () => {
  it("counts how each decision split the inputs, and the roads none of them took", async () => {
    const traces = await sweep(["a bug!", "a bug", "billing again", "another bug!", "hm"]);
    expect(traces.map((t) => t.output)).toEqual(["page", "ticket", "billing", "page", "human"]);

    const tallies = tallyDecisions(graph, traces);
    expect(tallies.map((t) => [t.title, t.decided, Object.fromEntries(t.roads.map((r) => [r.label, r.count]))])).toEqual([
      ["triage", 5, { bug: 3, billing: 1, other: 0, unsure: 1 }],
      ["urgent", 3, { then: 2, otherwise: 1 }],
    ]);

    const traffic = trafficOf(graph, traces);
    expect(traffic.total).toBe(5);
    expect(traffic.vertices[TRIAGE]).toBe(5);
    expect(traffic.vertices[vertexOf("page")]).toBe(2);
    expect(traffic.vertices[vertexOf("other")]).toBe(0);
    expect(traffic.edges[`${TRIAGE}->${vertexOf("urgent")}`]).toBe(3);
    expect(traffic.edges[`${TRIAGE}->${vertexOf("other")}`]).toBe(0);

    expect(unfinished(traces.map((trace) => ({ label: "", value: "", trace })))).toBe(0);
    const dead = unreachedRoads(graph, traffic);
    expect(dead.map((r) => [r.vertex.nodeId, r.via?.title, r.via?.edge])).toEqual([["other", "triage", "other"]]);

    expect(routeOf(traces[4]!)).toEqual([{ path: TRIAGE, title: "triage", edge: "unsure" }]);
    expect(visits(graph, traces[1]!, vertexOf("ticket"))).toBe(true);
    expect(visits(graph, traces[1]!, vertexOf("page"))).toBe(false);
  });

  it("reports a dead subtree once, at its entrance", async () => {
    const traces = await sweep(["billing", "other stuff"]);
    const dead = unreachedRoads(graph, trafficOf(graph, traces)).map((r) => r.vertex.nodeId);
    expect(dead.sort()).toEqual(["human", "urgent"]);
    // page and ticket sit behind urgent, which nothing reached.
    expect(dead).not.toContain("page");
  });

  it("agrees with every trace's own decisions on the example chains (rehearsal)", async () => {
    for (const ex of examples) {
      const g = graphOf(ex.chain);
      const { rows, stoppedBy } = await runSweep(ex.chain, ex.inputs, rehearsalClient({ latencyMs: [0, 0] }));
      expect(stoppedBy).toBeUndefined();
      const traces = rows.map((r) => r.trace!);
      expect(traces.every(Boolean)).toBe(true);
      const traffic = trafficOf(g, traces);
      expect(traffic.vertices[g.entry]).toBe(ex.inputs.length);
      for (const t of tallyDecisions(g, traces)) {
        const made = traces.flatMap((tr) => decisions(tr).filter((d) => d.path === t.path));
        expect(t.decided).toBe(made.length);
        expect(t.roads.reduce((n, r) => n + r.count, 0)).toBe(t.decided);
        for (const r of t.roads) expect(r.count).toBe(made.filter((d) => d.decision.taken === r.edge).length);
      }
      for (const road of unreachedRoads(g, traffic)) {
        expect(traffic.vertices[road.vertex.id]).toBe(0);
        expect(traces.some((tr) => visits(g, tr, road.vertex.id))).toBe(false);
      }
    }
  });

  it("stops at the first input when every later one would fail the same way", async () => {
    const client = literal();
    const inner = client.ask;
    client.ask = async (...args: Parameters<JevClient["ask"]>) => {
      await inner(...(args as [string, Record<string, Question>]));
      throw new JevAuthError(401, { error: { message: "bad key" } });
    };
    const onRow: number[] = [];
    const { rows, stoppedBy } = await runSweep(
      triage,
      ["a", "b", "c"].map((v) => ({ label: v, value: v })),
      client,
      { onRow: (i) => onRow.push(i) },
    );
    expect(stoppedBy?.kind).toBe("bad-key");
    // The failed input never chose a road, so the sweep can't say which roads nothing takes.
    expect(unfinished(rows)).toBe(3);
    expect(client.asked).toBe(1);
    expect(onRow).toEqual([0]);
    expect(rows.map((r) => Boolean(r.trace))).toEqual([true, false, false]);
  });

  it("stops when aborted", async () => {
    const ac = new AbortController();
    const { rows } = await runSweep(
      triage,
      ["bug", "billing", "other"].map((v) => ({ label: v, value: v })),
      literal(),
      { signal: ac.signal, onRow: (i) => i === 0 && ac.abort() },
    );
    expect(rows.map((r) => r.trace?.status)).toEqual(["ok", undefined, undefined]);
  });
});

/**
 * Traffic tallied by hand from the spans, without the graph overlay: a node
 * counts when its span exists, a tier when it made a call, a halt when its gate
 * halted, a join when the parallel finished ok or every branch under it did.
 * An edge counts when both its ends do (and, for a road a decision picks, when
 * it picked that one). A decision counts when its span decided.
 */
function handTally(graph: FlowGraph, traces: readonly Trace[]) {
  const vertices: Record<string, number> = {};
  const edges: Record<string, number> = {};
  const decided: Record<string, number> = {};
  for (const t of traces) {
    const hit = new Set<string>();
    for (const v of graph.vertices) {
      const span = t.spans.find((s) => s.path === v.spanPath);
      const kids = t.spans.filter((s) => s.parentPath === v.spanPath);
      const yes =
        v.kind === "tier"
          ? Boolean(span?.calls.some((c) => c.tier === v.tier))
          : v.kind === "halt"
            ? span?.decision?.taken === "halt"
            : v.kind === "join"
              ? Boolean(span) && (span!.status === "ok" || (kids.length > 0 && kids.every((k) => k.status === "ok")))
              : Boolean(span);
      if (yes) hit.add(v.id);
      vertices[v.id] = (vertices[v.id] ?? 0) + (yes ? 1 : 0);
      if ((v.kind === "route" || v.kind === "gate" || v.kind === "cascade") && span?.decision) decided[v.spanPath] = (decided[v.spanPath] ?? 0) + 1;
    }
    for (const e of graph.edges) {
      // A road a decision picks (not an escalation) also needs that decision to have picked it:
      // a cascade tier that escalated and the tier that accepted both reach the next node.
      const by = e.decidedBy;
      const picked = !by || by.key.startsWith("escalate:") || t.spans.find((s) => s.path === by.spanPath)?.decision?.taken === by.key;
      edges[e.id] = (edges[e.id] ?? 0) + (hit.has(e.source) && hit.has(e.target) && picked ? 1 : 0);
    }
  }
  return { vertices, edges, decided };
}

async function expectHandTally(root: AnyNode, inputs: readonly Json[], client: JevClient) {
  const g = graphOf(root);
  const { rows } = await runSweep(
    root,
    inputs.map((value, i) => ({ label: String(i), value })),
    client,
  );
  const traces = rows.map((r) => r.trace!);
  const hand = handTally(g, traces);
  const traffic = trafficOf(g, traces);
  expect(traffic.vertices).toEqual(hand.vertices);
  expect(traffic.edges).toEqual(hand.edges);
  for (const v of g.vertices) expect(traces.filter((t) => visits(g, t, v.id)).length).toBe(hand.vertices[v.id]);
  const tallies = tallyDecisions(g, traces);
  for (const t of tallies) expect(t.decided).toBe(hand.decided[t.path]);
  expect(tallies.map((t) => t.path).sort()).toEqual(Object.keys(hand.decided).sort());
  return { g, traces, traffic };
}

describe("traffic agrees with a hand tally of the spans", () => {
  it("doesn't count a join the parallel never reached (a branch halted)", async () => {
    const fan = parallel("fan", {
      branches: {
        guard: gate("guard", { ask: noul("Shout?"), pass: { min: 0.5 }, then: emit("loud", { id: "loud" }) }),
        other: emit("other", { id: "other" }),
      },
    });
    const root = chain("halting", fan, emit("after", { id: "after" }));
    const { g, traces, traffic } = await expectHandTally(root, ["go!", "go"], literal());
    expect(traces.map((t) => t.status)).toEqual(["ok", "halted"]);
    const join = g.vertices.find((v) => v.kind === "join")!;
    expect(traffic.vertices[join.id]).toBe(1);
    const into = g.edges.filter((e) => e.target === join.id);
    expect(into).toHaveLength(2);
    for (const e of into) expect(traffic.edges[e.id]).toBe(1);
    expect(visits(g, traces[1]!, join.id)).toBe(false);
    expect(traffic.vertices[g.vertices.find((v) => v.nodeId === "after")!.id]).toBe(1);
  });

  it("on a chain with every shape: halt, branch error, cancelled sibling, cascade escalation, low confidence, nested chain", async () => {
    const slow = step("slow", async (_input: unknown, ctx) => {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, 30);
        ctx.signal.addEventListener("abort", () => {
          clearTimeout(t);
          reject(ctx.signal.reason ?? new Error("aborted"));
        });
      });
      return "slow";
    });
    const root = chain(
      "kitchen",
      route("sort", {
        ask: choice("Which?", ["alpha", "beta", "gamma"]),
        lowConfidence: { below: 0.5, then: emit("unsure", { id: "shrug" }) },
        branches: {
          alpha: parallel("fan", {
            branches: {
              guard: gate("guard", { ask: noul("Shout?"), pass: { min: 0.5 }, then: emit("loud", { id: "loud" }) }),
              boom: step("boom", (input: unknown) => {
                if (String(input).includes("boom")) throw new Error("boom");
                return "fine";
              }),
              wait: slow,
            },
          }),
          beta: cascade("tiers", {
            tiers: [tier("t1", { ask: choice("Pet?", ["cat", "dog"]), minConfidence: 0.5 }), tier("t2", { ask: choice("Other?", ["fish", "bird"]), minConfidence: 0.5 })],
            fallback: emit("nobody", { id: "nobody" }),
          }),
          gamma: chain("inner", emit("first", { id: "first" }), emit("second", { id: "second" })),
        },
      }),
      emit("done", { id: "done" }),
    );
    const { g, traces, traffic } = await expectHandTally(root, ["alpha!", "alpha", "alpha! boom", "beta fish", "beta cat", "beta", "gamma", "hm"], literal());
    // The parallel joined once ("alpha!"): not when the guard halted (cancelling "wait"), not when "boom" threw.
    expect(traces.slice(0, 3).map((t) => t.status)).toEqual(["ok", "halted", "error"]);
    expect(traffic.vertices[g.vertices.find((v) => v.kind === "join")!.id]).toBe(1);
    expect(traffic.vertices[g.vertices.find((v) => v.tier === "t2")!.id]).toBe(2);
    expect(traffic.vertices[g.vertices.find((v) => v.nodeId === "nobody")!.id]).toBe(1);
    expect(traffic.vertices[g.vertices.find((v) => v.nodeId === "shrug")!.id]).toBe(1);
    expect(traffic.vertices[g.vertices.find((v) => v.nodeId === "second")!.id]).toBe(1);
  });

  it("on every example (rehearsal)", async () => {
    for (const ex of examples) {
      await expectHandTally(
        ex.chain,
        ex.inputs.map((i) => i.value),
        rehearsalClient({ latencyMs: [0, 0] }),
      );
    }
  });
});
