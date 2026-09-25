import { describe, expect, it } from "vitest";
import { cascade, chain, choice, createJev, emit, gate, graphOf, noul, overlayTrace, parallel, route, step, tier, ask, reduceTrace, type Trace } from "../src/index.js";
import { fakeFetch } from "./helpers";

const flow = chain(
  "flow",
  route("r", {
    ask: choice("?", ["a", "b"]),
    branches: { a: emit("A", { id: "ea" }), b: gate("g", { ask: noul("?"), pass: { min: 0.5 }, then: emit("B", { id: "eb" }) }) },
  }),
  parallel("p", { branches: { x: ask("x", { questions: { q: noul("?") } }), y: step("y", () => 1) } }),
  cascade("c", { tiers: [tier("t1", { ask: noul("?"), minConfidence: 0.9 }), tier("t2", { ask: noul("?"), minConfidence: 0.5 })], fallback: emit("F", { id: "fb" }) }),
);

describe("graphOf", () => {
  const g = graphOf(flow);
  const e = (s: string, t: string) => g.edges.find((x) => x.source === s && x.target === t);

  it("lays chains end to end and merges after branches", () => {
    expect(g.entry).toBe("$/0");
    expect(g.vertices.find((v) => v.id === "$")).toBeUndefined(); // chains have no vertex
    expect(e("$/0", "$/0/a")).toMatchObject({ label: "a", kind: "branch", decidedBy: { spanPath: "$/0", key: "a" } });
    // both branch leaves flow into the parallel
    expect(e("$/0/a", "$/1")).toBeDefined();
    expect(e("$/0/b/then", "$/1")).toBeDefined();
    // gate without otherwise gets a halt vertex
    expect(e("$/0/b", "$/0/b/halt")).toMatchObject({ kind: "halt" });
  });

  it("forks and joins parallels", () => {
    expect(e("$/1", "$/1/x")).toMatchObject({ kind: "fork" });
    expect(e("$/1/y", "$/1#join")).toMatchObject({ kind: "join" });
    expect(e("$/1#join", "$/2")).toBeDefined();
  });

  it("builds cascade ladders", () => {
    expect(e("$/2", "$/2/t1")).toBeDefined();
    expect(e("$/2/t1", "$/2/t2")).toMatchObject({ kind: "escalate" });
    expect(e("$/2/t2", "$/2/fallback")).toMatchObject({ kind: "escalate", decidedBy: { key: "fallback" } });
  });
});

describe("overlayTrace", () => {
  it("paints taken and untaken edges with their deciding numbers", async () => {
    const f = fakeFetch((_s, _k, q) => (q.type === "choice" ? { choice: "a" } : { noul: 0.7 }));
    const r = await createJev({ apiKey: "k", fetch: f }).run(flow, "x");
    expect(r.status).toBe("ok");
    const g = graphOf(flow);
    const o = overlayTrace(g, r.trace);
    expect(o.vertices["$/0/a"]!.state).toBe("ok");
    expect(o.vertices["$/0/b"]!.state).toBe("skipped");
    expect(o.edges["$/0->$/0/a"]).toMatchObject({ state: "taken", value: 0.9, metric: "probability" });
    expect(o.edges["$/0->$/0/b"]).toMatchObject({ state: "not-taken", value: expect.closeTo(0.1) });
    expect(o.vertices["$/1#join"]!.state).toBe("ok");
    // noul 0.7 -> confidence 0.4: t1 (0.9) escalates, t2 (0.5) escalates, fallback runs
    expect(o.vertices["$/2/t1"]!.state).toBe("ok");
    expect(o.edges["$/2/t1->$/2/t2"]).toMatchObject({ state: "taken", metric: "confidence" });
    expect(o.edges["$/2/t2->$/2/fallback"]!.state).toBe("taken");
    expect(o.vertices["$/2/fallback"]!.state).toBe("ok");
  });

  it("works mid-run", async () => {
    const f = fakeFetch(undefined, { latencyMs: 30 });
    let mid: Trace | undefined;
    let t: Trace | undefined;
    await createJev({ apiKey: "k", fetch: f }).run(flow, "x", {
      onEvent: (e) => {
        t = reduceTrace(t, e);
        if (e.type === "span:start" && e.span.path === "$/0") mid = t;
      },
    });
    const o = overlayTrace(graphOf(flow), mid);
    expect(o.vertices["$/0"]!.state).toBe("running");
    expect(o.vertices["$/1"]!.state).toBe("idle");
    expect(o.edges["$/0->$/0/a"]!.state).toBe("idle");
  });
});
