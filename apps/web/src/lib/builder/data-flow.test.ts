import { describe, expect, it } from "vitest";
import { ask, cascade, chain, choice, emit, fromJSON, gate, noul, parallel, route, run, score, step, toJSON, type Entry, type JevClient, type Questions } from "jevchain";
import { examples } from "jevchain-examples";
import { getAt, insertAfterPath, newDocument, template, updateAt, withRoot, type NodeJson } from "./doc-ops";
import { canRead, describeShape, flowWarnings, inputAt, inputFields, missingHoles, outputOf, type FlowWarning } from "./data-flow";

/** A Jev that answers the first label / level / yes, and remembers the state it was asked about. */
function fakeJev() {
  const seen: { questions: string[]; state: Entry }[] = [];
  const jev: JevClient = {
    model: "fake",
    usdPerMillionTokens: 0,
    async ask(state: Entry, questions: Questions) {
      seen.push({ questions: Object.keys(questions), state });
      const answers: Record<string, unknown> = {};
      for (const [k, q] of Object.entries(questions)) {
        if (q.type === "choice") {
          const labels = Object.keys(q.criteria);
          answers[k] = { type: "choice", choice: labels[0], probabilities: Object.fromEntries(labels.map((l, i) => [l, i ? 0 : 1])), confidence: 1 };
        } else if (q.type === "score") answers[k] = { type: "score", score: 0, probabilities: { 0: 1 }, legend: {}, confidence: 1 };
        else answers[k] = { type: "noul", noul: 1 };
      }
      return { answers, model: "fake", usage: { inputTokens: 0, outputTokens: 0 }, costUsd: 0, latencyMs: 0, attempts: 1 } as never;
    },
  };
  return { jev, seen };
}

const runDoc = async (root: NodeJson, input: unknown) => {
  const { jev, seen } = fakeJev();
  const r = await run(fromJSON(withRoot(newDocument(), root), { missingHandlers: "passthrough" }), input, { jev });
  return { r, seen };
};

const TICKET = { message: "my toaster whispers my name", user: "sam" };

/** What a new user builds: an ask, then "add after" a route. */
const askThenRoute = () => {
  const start = template("ask", new Set());
  const r = insertAfterPath(start, "$", template("route", new Set(["ask-x"])));
  return r.root;
};

const fix = (root: NodeJson, w: FlowWarning, i = 0) => updateAt(root, w.path, w.fixes[i]!.node);

describe("inputs follow the chain", () => {
  const root = toJSON(
    chain(
      "c",
      ask("read", { questions: { vibe: choice("?", ["good", "bad"]), spicy: noul("?") } }),
      route("r", {
        ask: choice("?", ["a", "b"]),
        branches: { a: chain("inner", emit("hi", { id: "hi" }), emit({ n: 1 }, { id: "obj" })), b: emit("B", { id: "b" }) },
      }),
      emit("end", { id: "end" }),
    ),
  ).root as unknown as NodeJson;

  it("the first node gets the run input; later steps get the step before", () => {
    expect(inputAt(root, "$")).toEqual({ from: "run" });
    expect(inputAt(root, "$/0")).toEqual({ from: "run" });
    expect(inputAt(root, "$/1")).toMatchObject({ from: "node", node: { id: "read", kind: "ask", path: "$/0" }, shape: { type: "answers" } });
  });

  it("routes pass their own input down; a nested chain's first step gets it too", () => {
    expect(inputAt(root, "$/1/b")).toMatchObject({ from: "node", node: { id: "read" } });
    expect(inputAt(root, "$/1/a/0")).toMatchObject({ from: "node", node: { id: "read" } });
    expect(inputAt(root, "$/1/a/1")).toMatchObject({ from: "node", node: { id: "hi" }, shape: { type: "value", value: "hi" } });
  });

  it("a route's output is whichever branch ran", () => {
    const end = inputAt(root, "$/2");
    expect(end.from === "node" && describeShape(end.shape)).toBe('one of: {"n":1} · “B”');
  });

  it("knows which input fields exist", () => {
    const answers = outputOf(getAt(root, "$/0")!);
    expect(canRead(answers, ["vibe"])).toBe("yes");
    expect(canRead(answers, ["vibe", "choice"])).toBe("yes");
    expect(canRead(answers, ["vibe", "probabilities", "good"])).toBe("yes");
    expect(canRead(answers, ["vibe", "probabilities", "meh"])).toBe("no");
    expect(canRead(answers, ["spicy", "noul"])).toBe("yes");
    expect(canRead(answers, ["spicy", "choice"])).toBe("no");
    expect(canRead(answers, ["message"])).toBe("no");
    expect(canRead({ type: "value", value: "text" }, ["message"])).toBe("no");
    expect(canRead({ type: "unknown", says: "x" }, ["message"])).toBe("maybe");
    expect(canRead({ type: "oneOf", options: [{ type: "value", value: { n: 1 } }, { type: "value", value: "B" }] }, ["n"])).toBe("maybe");
    expect(inputFields(answers)).toEqual(["input.vibe.choice", "input.spicy.noul"]);
    expect(missingHoles("{{input.vibe.choice}} / {{input.message}} / {{run.message}} / {{input}}", answers)).toEqual(["input.message"]);
  });
});

describe("a jev node after another step, with no state", () => {
  it("is what you get by adding a route after an ask, and it asks jev about the answers, not the ticket", async () => {
    const root = askThenRoute();
    const { seen } = await runDoc(root, TICKET);
    expect(seen[0]!.state).toEqual(TICKET);
    expect(seen[1]!.state).toMatchObject({ vibe: { type: "choice" } }); // the surprise
    expect(flowWarnings(root)).toMatchObject([{ path: "$/1", rule: "implicit-state", message: expect.stringMatching(/output of ask “ask-\d+” \(answers: vibe\), not the run input/) }]);
  });

  it("“ask about the run input” makes it ask about the ticket, and the warning goes", async () => {
    const root = askThenRoute();
    const fixed = fix(root, flowWarnings(root)[0]!, 0);
    expect(getAt(fixed, "$/1")!.state).toBe("{{run}}");
    const { seen } = await runDoc(fixed, TICKET);
    expect(seen[1]!.state).toEqual(TICKET);
    expect(flowWarnings(fixed)).toEqual([]);
  });

  it("“ask about its output” keeps the behaviour, says so, and the warning goes", async () => {
    const root = askThenRoute();
    const fixed = fix(root, flowWarnings(root)[0]!, 1);
    expect(getAt(fixed, "$/1")!.state).toBe("{{input}}");
    expect((await runDoc(fixed, TICKET)).seen[1]!.state).toEqual((await runDoc(root, TICKET)).seen[1]!.state);
    expect(flowWarnings(fixed)).toEqual([]);
  });

  it("covers gates, asks and each cascade tier, but not code in between", () => {
    const root = toJSON(
      chain(
        "c",
        emit("x", { id: "x" }),
        gate("g", { ask: noul("?"), pass: { min: 0.5 }, then: emit("t", { id: "t" }) }),
        ask("a", { questions: { q: noul("?") } }),
        cascade("k", { tiers: [{ id: "t1", ask: noul("?"), minConfidence: 0.5 }, { id: "t2", ask: noul("?"), minConfidence: 0.5, state: "{{run}}" }], fallback: emit("f", { id: "f" }) }),
        step("shape-it", (v: unknown) => v),
        ask("after-code", { questions: { q: noul("?") } }),
      ),
    ).root as unknown as NodeJson;
    const ws = flowWarnings(root);
    expect(ws.map((w) => [w.path, w.tier ?? null, w.rule])).toEqual([
      ["$/1", null, "implicit-state"],
      ["$/2", null, "implicit-state"],
      ["$/3", "t1", "implicit-state"],
    ]);
    const tierFixed = fix(root, ws[2]!, 0);
    expect((getAt(tierFixed, "$/3")!.tiers as { state?: string }[]).map((t) => t.state)).toEqual(["{{run}}", "{{run}}"]);
  });
});

describe("templates reading input fields the step before doesn't have", () => {
  const emitAfterAsk = () =>
    toJSON(chain("c", ask("read", { questions: { vibe: choice("?", ["good", "bad"]) } }), emit("from {{input.user}}: {{input.vibe.choice}}", { id: "out" }))).root as unknown as NodeJson;

  it("come up empty at runtime, and are flagged", async () => {
    const root = emitAfterAsk();
    expect((await runDoc(root, TICKET)).r.output).toBe("from : good");
    expect(flowWarnings(root)).toMatchObject([{ path: "$/1", rule: "missing-field", message: expect.stringMatching(/\{\{input\.user\}\} comes up empty/) }]);
  });

  it("“read it from the run input” rewrites just those holes", async () => {
    const root = emitAfterAsk();
    const fixed = fix(root, flowWarnings(root)[0]!);
    expect(getAt(fixed, "$/1")!.value).toBe("from {{run.user}}: {{input.vibe.choice}}");
    expect((await runDoc(fixed, TICKET)).r.output).toBe("from sam: good");
    expect(flowWarnings(fixed)).toEqual([]);
  });

  it("works inside structured emit values and in state", async () => {
    const root = toJSON(
      chain(
        "c",
        emit("plain text", { id: "t" }),
        emit({ who: "{{input.user}}", n: ["{{input.length}}"] }, { id: "obj" }),
        ask("a", { state: "about {{input.who}} and {{input.what}}", questions: { q: noul("?") } }),
      ),
    ).root as unknown as NodeJson;
    const ws = flowWarnings(root);
    expect(ws.map((w) => [w.path, w.rule])).toEqual([
      ["$/1", "missing-field"],
      ["$/2", "missing-field"],
    ]);
    expect(ws[1]!.message).toMatch(/\{\{input\.what\}\}/);
    expect(ws[1]!.message).not.toMatch(/input\.who/);
    const fixed = fix(fix(root, ws[0]!), ws[1]!);
    expect(getAt(fixed, "$/1")!.value).toEqual({ who: "{{run.user}}", n: ["{{input.length}}"] });
    expect(getAt(fixed, "$/2")!.state).toBe("about {{input.who}} and {{run.what}}");
    const { seen } = await runDoc(fixed, TICKET);
    expect(seen[0]!.state).toBe("about sam and ");
  });
});

describe("no false alarms", () => {
  it("every example, as shipped, has nothing to warn about", () => {
    for (const e of examples) expect(flowWarnings(toJSON(e.chain).root as unknown as NodeJson), e.slug).toEqual([]);
  });

  it("every starter template, alone and after every other, only warns about a jev call with no state", () => {
    const kinds = ["ask", "route", "gate", "parallel", "cascade", "step", "emit", "chain"] as const;
    for (const a of kinds) {
      expect(flowWarnings(template(a)), a).toEqual([]);
      for (const b of kinds) {
        const taken = new Set<string>();
        const root = insertAfterPath(template(a, taken), "$", template(b, taken), taken).root;
        for (const w of flowWarnings(root)) expect(w.rule, `${a} → ${b}: ${w.message}`).toBe("implicit-state");
      }
    }
  });

  it("every flagged hole really does come up empty, and every fixed chain has none", async () => {
    // after each shape of step, a template reading a field it has, one it doesn't, and one it can't know
    const before = [
      ask("p", { questions: { vibe: choice("?", ["good", "bad"]), lvl: score("?", ["lo", "hi"]) } }),
      emit("text", { id: "p" }),
      emit({ a: { b: 1 }, list: [1] }, { id: "p" }),
      parallel("p", { branches: { x: emit("X", { id: "px" }), y: ask("py", { questions: { q: noul("?") } }) } }),
      cascade("p", { tiers: [{ id: "t", ask: noul("?"), minConfidence: 0.5 }], fallback: emit("f", { id: "pf" }) }),
      route("p", { ask: choice("?", ["l", "r"]), branches: { l: emit({ a: 1 }, { id: "pl" }), r: emit({ a: 2 }, { id: "pr" }) } }),
    ];
    const holes = ["vibe.choice", "vibe.chioce", "lvl.score", "a.b", "a.c", "list.0", "list.5", "x", "y.q.noul", "z", "resolvedBy", "nope", "a", "message"];
    let flagged = 0;
    for (const p of before) {
      const value = Object.fromEntries(holes.map((h) => [h, `{{input.${h}}}`]));
      const root = toJSON(chain("c", p, emit(value, { id: "out" }))).root as unknown as NodeJson;
      const ws = flowWarnings(root);
      const output = (await runDoc(root, TICKET)).r.output as Record<string, unknown>;
      const missing = new Set(ws.flatMap((w) => [...w.message.matchAll(/\{\{input\.([^}]+)\}\}/g)].map((m) => m[1]!)));
      for (const h of holes) {
        if (missing.has(h)) {
          flagged++;
          expect(output[h] === undefined || output[h] === "" || output[h] === null, `${p.id} ${h} flagged but rendered ${JSON.stringify(output[h])}`).toBe(true);
        }
      }
      // and a hole that renders something is never flagged
      for (const h of holes) if (output[h] !== undefined && output[h] !== "") expect(missing.has(h), `${h} rendered but flagged`).toBe(false);
      if (ws.length) {
        const fixed = fix(root, ws[0]!);
        expect(flowWarnings(fixed)).toEqual([]);
      }
    }
    expect(flagged).toBeGreaterThan(30);
  });
});
