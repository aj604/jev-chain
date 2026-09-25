import { describe, expect, it } from "vitest";
import { chain, choice, decisions, emit, gate, graphOf, JevAuthError, noul, route, type Answer, type JevClient, type Question, type Trace } from "jevchain";
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
    expect(tallies.map((t) => [t.title, t.reached, Object.fromEntries(t.roads.map((r) => [r.label, r.count]))])).toEqual([
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
        expect(t.reached).toBe(made.length);
        expect(t.roads.reduce((n, r) => n + r.count, 0)).toBe(t.reached);
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
