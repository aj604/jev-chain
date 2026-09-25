import { describe, expect, it } from "vitest";
import { ask, cascade, chain, choice, emit, fromJSON, gate, noul, parallel, route, run, score, step, toJSON, type Entry, type JevClient, type Questions } from "jevchain";
import { examples } from "jevchain-examples";
import { allIds, childEdges, getAt, insertAfterPath, insertBeforePath, newDocument, renameNode, renameTyped, template, updateAt, withRoot, type IdEdit, type NodeJson } from "./doc-ops";
import { keyProblem } from "./question-ops";
import { canRead, describeShape, flowWarnings, inputAt, inputFields, missingHoles, outputOf, type FlowWarning } from "./data-flow";
import { mapTemplates, readsIn } from "./reads";

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

const fix = (root: NodeJson, w: FlowWarning, i = 0) => updateAt(root, w.fixes[i]!.at ?? w.path, w.fixes[i]!.node);

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

  it("“ask about the run input” makes it ask about the ticket, and the warning goes (leaving the ask unused)", async () => {
    const root = askThenRoute();
    const fixed = fix(root, flowWarnings(root)[0]!, 0);
    expect(getAt(fixed, "$/1")!.state).toBe("{{run}}");
    const { seen } = await runDoc(fixed, TICKET);
    expect(seen[1]!.state).toEqual(TICKET);
    expect(flowWarnings(fixed).map((w) => [w.path, w.rule])).toEqual([["$/0", "unused-output"]]);
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

// ---------------------------------------------------------------------------
// Outputs nothing reads
// ---------------------------------------------------------------------------

/** A Jev whose answers depend on what it's asked (plus a seed), not on call order: runs take different branches, and dropping a call leaves the others' answers alone. */
function hashJev(seed: number): JevClient {
  const hash = (s: string) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
  };
  return {
    model: "fake",
    usdPerMillionTokens: 0,
    async ask(state: Entry, questions: Questions) {
      const answers: Record<string, unknown> = {};
      for (const [k, q] of Object.entries(questions)) {
        const h = hash(`${seed}|${k}|${JSON.stringify(q)}|${JSON.stringify(state)}`);
        const confidence = (h % 97) / 96;
        if (q.type === "choice") {
          const labels = Object.keys(q.criteria);
          const choice = labels[h % labels.length]!;
          answers[k] = { type: "choice", choice, probabilities: Object.fromEntries(labels.map((l) => [l, l === choice ? 0.8 : 0.2])), confidence };
        } else if (q.type === "score") {
          const score = (h >>> 3) % q.criteria.length;
          answers[k] = { type: "score", score, probabilities: { [score]: 1 }, legend: {}, confidence };
        } else answers[k] = { type: "noul", noul: ((h >>> 5) % 101) / 100 };
      }
      return { answers, model: "fake", usage: { inputTokens: 0, outputTokens: 0 }, costUsd: 0, latencyMs: 0, attempts: 1 } as never;
    },
  };
}

/** How a run ends: what every caller of the chain sees. */
async function ending(root: NodeJson, input: unknown, seed: number) {
  const r = await run(fromJSON(withRoot(newDocument(), root), { missingHandlers: "passthrough" }), input, { jev: hashJev(seed) });
  return { r, end: { status: r.status, output: r.status === "ok" ? r.output : undefined, halted: r.trace.halted?.nodeId } };
}

const INPUTS = [TICKET, { message: "I was charged twice", user: "kim" }, "just a string", { message: "", user: "" }];

const unusedIn = (root: NodeJson) => flowWarnings(root).filter((w) => w.rule === "unused-output");
const removeFix = (w: FlowWarning) => w.fixes.findIndex((f) => f.label.startsWith("remove"));
const asRoot = (node: Parameters<typeof toJSON>[0]) => toJSON(node).root as unknown as NodeJson;

describe("a step whose output the next step never reads", () => {
  it("is what taking “ask about the run input” leaves behind: the ask's answers go nowhere, and removing it changes nothing", async () => {
    const root = askThenRoute();
    const fixed = fix(root, flowWarnings(root)[0]!, 0);
    const [w] = unusedIn(fixed);
    expect(w).toMatchObject({ path: "$/0", message: expect.stringMatching(/^nothing reads these answers: the next step, route “route-\d+”, never reads its input \(its state is “\{\{run\}\}”\)/) });
    expect(w!.fixes.map((f) => f.label)).toEqual(["remove this ask"]);
    const removed = fix(fixed, w!);
    expect(removed.kind).toBe("route"); // the two-step chain collapsed into the route
    expect(w!.fixes[0]!.select).toBe("$");
    for (const input of INPUTS) for (const seed of [1, 2, 3]) expect((await ending(removed, input, seed)).end).toEqual((await ending(fixed, input, seed)).end);
    expect(unusedIn(removed)).toEqual([]);
  });

  const spamThenReply = () =>
    asRoot(
      chain(
        "support",
        gate("spam", { title: "Is it spam?", ask: noul("Is this spam?"), state: "{{run.message}}", pass: { max: 0.5 }, then: emit("looks fine", { id: "fine" }), otherwise: emit("blocked as spam", { id: "blocked" }) }),
        ask("tone", { state: "{{run.message}}", questions: { tone: choice("tone?", ["calm", "angry"]) } }),
        emit("replied, {{input.tone.choice}}", { id: "reply" }),
      ),
    );

  it("a gate in the middle of a chain decides nothing: what follows runs either way", async () => {
    const root = spamThenReply();
    const [w] = unusedIn(root);
    expect(w).toMatchObject({ path: "$/0", message: expect.stringMatching(/^this gate decides nothing: the next step, ask “tone”, never reads its input .*runs the same whichever way it goes/) });
    const takes = new Set<string>();
    for (const input of INPUTS)
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const { r, end } = await ending(root, input, seed);
        takes.add(String(r.trace.spans.find((s) => s.path === "$/0")?.decision?.taken));
        expect(end.output).toMatch(/^replied, /); // even when it said "spam"
      }
    expect(takes).toEqual(new Set(["then", "otherwise"]));
  });

  it("“run the rest only if it passes” puts what follows under the gate's then, and gates it for real", async () => {
    const root = spamThenReply();
    const [w] = unusedIn(root);
    expect(w!.fixes.map((f) => f.label)).toEqual(["run the rest only if it passes", "remove this gate"]);
    const guarded = fix(root, w!, 0);
    expect(guarded).toMatchObject({ kind: "gate", id: "spam", otherwise: { id: "blocked" }, then: { kind: "chain", steps: [{ id: "tone" }, { id: "reply" }] } });
    expect(w!.fixes[0]!.select).toBe("$");
    expect(flowWarnings(guarded)).toEqual([]);
    let blocked = 0;
    for (const input of INPUTS)
      for (const seed of [1, 2, 3, 4, 5, 6]) {
        const before = await ending(root, input, seed);
        const after = await ending(guarded, input, seed);
        if (before.r.trace.spans.find((s) => s.path === "$/0")?.decision?.taken === "then") expect(after.end).toEqual(before.end);
        else {
          blocked++;
          expect(after.end.output).toBe("blocked as spam");
          expect(after.r.trace.spans.some((s) => s.nodeId === "tone")).toBe(false);
        }
      }
    expect(blocked).toBeGreaterThan(0);
  });

  it("the gate keeps a then that isn't just an emit, in front of what follows", () => {
    const root = asRoot(
      chain(
        "c",
        emit("start", { id: "s" }),
        gate("g", { ask: noul("?"), pass: { min: 0.5 }, then: chain("inner", ask("deeper", { state: "{{run}}", questions: { q: noul("?") } }), emit("x", { id: "x" })), otherwise: emit("no", { id: "no" }) }),
        emit("after {{run.user}}", { id: "after" }),
      ),
    );
    const [w] = unusedIn(root);
    expect(w!.path).toBe("$/1");
    const guarded = fix(root, w!, 0);
    expect(w!.fixes[0]!.select).toBe("$/1");
    expect(guarded).toMatchObject({ kind: "chain", steps: [{ id: "s" }, { id: "g", then: { kind: "chain", steps: [{ id: "deeper" }, { id: "x" }, { id: "after" }] } }] });
  });

  it("isn't flagged when anything could still see the output", () => {
    const tail = emit("done", { id: "done" });
    const q = { questions: { q: noul("?") } };
    const cases: [string, Parameters<typeof toJSON>[0]][] = [
      ["next step has no state", chain("c", ask("a", q), ask("b", q))],
      ["next step reads {{input}}", chain("c", ask("a", q), emit("got {{input.q.noul}}", { id: "e" }))],
      ["a route's branch reads it", chain("c", ask("a", q), route("r", { ask: choice("?", ["x", "y"]), state: "{{run}}", branches: { x: emit("{{input}}", { id: "x" }), y: emit("y", { id: "y" }) } }))],
      ["read through results", chain("c", ask("a", q), emit("was {{results.a.q.noul}}", { id: "e" }))],
      ["read through a bare {{results}}", chain("c", ask("a", q), emit("{{results}}", { id: "e" }))],
      ["a gate that can halt", chain("c", gate("g", { ask: noul("?"), pass: { min: 0.5 }, then: emit("t", { id: "t" }) }), tail)],
      ["code inside it", chain("c", parallel("p", { branches: { a: ask("a", q), b: step("s", (i: unknown) => i) } }), tail)],
      ["a join", chain("c", parallel("p", { branches: { a: ask("a", q) }, join: (x: unknown) => x }), tail)],
      ["code after it", chain("c", ask("a", q), emit("x", { id: "x" }), step("later", (i: unknown) => i))],
      ["no jev call in it", chain("c", parallel("p", { branches: { a: emit("A", { id: "ea" }) } }), tail)],
      ["the last step", chain("c", emit("x", { id: "x" }), ask("a", { ...q, state: "{{run}}" }))],
    ];
    for (const [label, node] of cases) expect(unusedIn(asRoot(node)), label).toEqual([]);
  });

  it("keeps the chain around a flagged step when its id is read through results, so no fix empties that read", async () => {
    const q = { questions: { q: noul("?") } };
    const inner = (first: Parameters<typeof chain>[1], rest: Parameters<typeof chain>[1]) => asRoot(chain("outer", chain("inner", first, rest), emit("got {{results.inner}}", { id: "got" })));
    const cases = [
      inner(ask("a", q), emit("x", { id: "x" })),
      inner(gate("g", { ask: noul("?"), state: "{{run}}", pass: { min: 0.5 }, then: emit("t", { id: "t" }), otherwise: emit("no", { id: "no" }) }), emit("rest", { id: "rest" })),
    ];
    let checked = 0;
    for (const root of cases) {
      const [w] = unusedIn(root);
      expect(w!.path).toBe("$/0/0");
      for (const [i, f] of w!.fixes.entries()) {
        const fixed = fix(root, w!, i);
        expect(getAt(fixed, "$/0"), f.label).toMatchObject({ kind: "chain", id: "inner" });
        expect(getAt(fixed, f.select!), f.label).toBeDefined();
        for (const input of INPUTS)
          for (const seed of [1, 2, 3, 4]) {
            const before = await ending(root, input, seed);
            const passed = before.r.trace.spans.find((s) => s.path === "$/0/0")?.decision?.taken;
            if (f.label.startsWith("run the rest") && passed !== "then") continue;
            expect((await ending(fixed, input, seed)).end, f.label).toEqual(before.end);
            checked++;
          }
      }
    }
    expect(checked).toBeGreaterThan(20);
  });

  it("counts {{answers.<id>}} as a read too (jevchain's coming answers root), bare {{answers}} included", () => {
    const q = { questions: { q: noul("?") } };
    expect(unusedIn(asRoot(chain("c", ask("a", q), emit("was {{answers.a.q}}", { id: "e" }))))).toEqual([]);
    expect(unusedIn(asRoot(chain("c", ask("a", q), emit("{{answers}}", { id: "e" }))))).toEqual([]);
    expect(unusedIn(asRoot(chain("c", ask("a", q), emit("was {{answers.other.q}}", { id: "e" }))))).toHaveLength(1);
  });

  it("flags only the outermost of nested unused steps", () => {
    const root = asRoot(
      chain(
        "c",
        gate("g", { ask: noul("?"), state: "{{run}}", pass: { min: 0.5 }, then: chain("in", ask("inner", { state: "{{run}}", questions: { q: noul("?") } }), emit("x", { id: "x" })), otherwise: emit("n", { id: "n" }) }),
        emit("end", { id: "end" }),
      ),
    );
    expect(unusedIn(root).map((w) => w.path)).toEqual(["$/0"]);
    expect(unusedIn(fix(root, unusedIn(root)[0]!, 1))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Against the runtime, on generated chains
// ---------------------------------------------------------------------------

function rng(seed: number) {
  let s = Math.imul(seed, 2654435761) || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 2 ** 32;
  };
}

function allPaths(root: NodeJson, at = "$"): string[] {
  return [at, ...childEdges(root).flatMap((c) => allPaths(c.node, `${at}/${c.edge}`))];
}

/** A chain built the way the builder builds them (templates, add after / before), then rewired the ways people rewire them. */
function generated(seed: number): NodeJson {
  const r = rng(seed);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(r() * xs.length)]!;
  const kinds = ["ask", "route", "gate", "cascade", "parallel", "emit", "step", "chain"] as const;
  const taken = new Set<string>();
  let root = template(pick(kinds), taken);
  for (let i = 0, n = 2 + Math.floor(r() * 5); i < n; i++) {
    const at = pick(allPaths(root));
    root = (r() < 0.7 ? insertAfterPath : insertBeforePath)(root, at, template(pick(kinds), taken), taken).root;
  }
  const states = [undefined, "{{run}}", "{{run}}", "{{run.message}}", "{{input}}", "about {{input.vibe.choice}}"];
  const setState = (n: NodeJson): NodeJson => {
    const rest: Record<string, unknown> = { ...n };
    delete rest.state;
    const s = pick(states);
    return (s === undefined ? rest : { ...rest, state: s }) as NodeJson;
  };
  const ids = [...allIds(root)];
  const chainIds = allPaths(root).map((p) => getAt(root, p)!).filter((n) => n.kind === "chain").map((n) => n.id);
  for (const p of allPaths(root)) {
    if (!getAt(root, p)) continue; // under an `otherwise` just switched off
    root = updateAt(root, p, (n) => {
      switch (n.kind) {
        case "ask":
        case "route":
          return setState(n);
        case "gate": {
          const g = setState(n);
          if (r() < 0.2) delete g.otherwise;
          return g;
        }
        case "cascade":
          return { ...n, tiers: (n.tiers as NodeJson[]).map(setState) };
        case "emit": {
          const v = pick<unknown>(["done", "done", "{{input}}", "for {{run.user}}", { ok: true, who: "{{run.user}}" }, "results", "chain results"]);
          if (v === "chain results" && chainIds.length) return { ...n, value: `got {{results.${pick(chainIds)}}}` };
          return { ...n, value: v === "results" || v === "chain results" ? `{{results.${pick(ids)}}}` : v };
        }
        default:
          return n;
      }
    });
  }
  return root;
}

describe("against the real runtime", () => {
  it("removing a flagged step never changes how a run ends; the gate fix changes it only when the gate didn't pass", async () => {
    let flagged = 0;
    let gates = 0;
    let runs = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const root = generated(seed);
      for (const w of unusedIn(root)) {
        flagged++;
        const removed = fix(root, w, removeFix(w));
        const guard = w.fixes.findIndex((f) => f.label.startsWith("run the rest"));
        const guarded = guard >= 0 ? fix(root, w, guard) : null;
        if (guarded) gates++;
        for (const input of INPUTS)
          for (const jev of [1, 2]) {
            runs++;
            const before = await ending(root, input, jev);
            expect((await ending(removed, input, jev)).end, `seed ${seed}: removing ${w.path}`).toEqual(before.end);
            if (guarded && before.r.trace.spans.find((s) => s.path === w.path)?.decision?.taken === "then") {
              expect((await ending(guarded, input, jev)).end, `seed ${seed}: guarding with ${w.path}`).toEqual(before.end);
            }
          }
      }
    }
    expect(flagged).toBeGreaterThan(40);
    expect(gates).toBeGreaterThan(5);
    expect(runs).toBeGreaterThan(300);
  }, 60_000);
});

/** Generated chains with `{{results.<id>}}` holes sprinkled into their templates: any id in the chain, or one that's gone. */
function withReads(seed: number): NodeJson {
  const r = rng(seed * 7919 + 1);
  let root = generated(seed);
  const ids = [...allIds(root), "gone"];
  const hole = () => `{{results.${ids[Math.floor(r() * ids.length)]}}}`;
  for (const p of allPaths(root)) {
    if (r() < 0.4) continue;
    root = updateAt(root, p, (n) => {
      const next = mapTemplates(n, (text) => `${text} ${hole()}`);
      return next === n && ["ask", "route", "gate"].includes(n.kind) ? { ...n, state: `{{run}} ${hole()}` } : next;
    });
  }
  return root;
}

describe("typing an id, keystroke by keystroke, against a single rename", () => {
  /** The id field: `KeyInput` commits each keystroke it accepts; build mode runs it through `renameTyped`. */
  function typeId(root: NodeJson, path: string, final: string, step = (e: IdEdit | null, cur: NodeJson, draft: string) => renameTyped(e, cur, path, draft)) {
    let edit: IdEdit | null = null;
    let cur = root;
    for (let i = 1; i <= final.length; i++) {
      const draft = final.slice(0, i);
      if (keyProblem(draft, [...allIds(cur)], getAt(cur, path)!.id)) continue;
      edit = step(edit, cur, draft);
      cur = edit.last;
    }
    return cur;
  }

  it("ends exactly where renameNode does, for every node and every id typed through (dead ones included)", () => {
    let typed = 0;
    let naiveWrong = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const root = withReads(seed);
      const finals = [...allIds(root), "gone"].flatMap((id) => [`${id}-2`, `${id}x`]);
      for (const path of allPaths(root)) {
        for (const final of finals) {
          if (keyProblem(final, [...allIds(root)], getAt(root, path)!.id)) continue;
          typed++;
          const single = renameNode(root, path, final);
          expect(typeId(root, path, final), `seed ${seed}: typing “${final}” at ${path}`).toEqual(single);
          // what the first cut did: rename from the current root at every keystroke
          const naive = typeId(root, path, final, (_e, cur, draft) => ({ path, base: cur, last: renameNode(cur, path, draft) }));
          if (JSON.stringify(naive) !== JSON.stringify(single)) naiveWrong++;
        }
      }
    }
    expect(typed).toBeGreaterThan(100_000);
    // the harness can tell the difference
    expect(naiveWrong).toBeGreaterThan(2_000);
  }, 120_000);
});

describe("{{results.<id>}} reads, against the real runtime", () => {
  /** A run, and for each span start, the node ids whose results were already in. */
  async function traced(root: NodeJson, input: unknown, seed: number) {
    const done = new Set<string>();
    const ids = new Map<string, string>();
    const doneAtStart = new Map<string, Set<string>[]>();
    const r = await run(fromJSON(withRoot(newDocument(), root), { missingHandlers: "passthrough" }), input, {
      jev: hashJev(seed),
      onEvent: (e) => {
        if (e.type === "span:start") {
          ids.set(e.span.path, e.span.nodeId);
          doneAtStart.set(e.span.path, [...(doneAtStart.get(e.span.path) ?? []), new Set(done)]);
        }
        if (e.type === "span:end" && e.status === "ok") done.add(ids.get(e.path)!);
      },
    });
    return { r, doneAtStart };
  }

  const EMPTY = /«([^»]*)»/g;
  const probes = (v: unknown) => [...(JSON.stringify(v) ?? "").matchAll(EMPTY)].map((m) => m[1]);

  it("every read it flags renders empty in every run that reaches it; every fix reads a node that has always finished by then", async () => {
    let flagged = 0;
    let reached = 0;
    let fixes = 0;
    let fixedReached = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const root = withReads(seed);
      for (const w of flowWarnings(root).filter((x) => x.rule === "dead-read")) {
        flagged++;
        const holes = new Set(w.message.match(/\{\{results\.[^}]+\}\}/g)!.map((h) => h.slice(2, -2)));
        // the probe: each template holding a flagged hole renders just those holes, between «»
        const probed = updateAt(root, w.path, (n) =>
          mapTemplates(n, (text, tier) => {
            if (tier !== w.tier) return text;
            const mine = [...holes].filter((h) => text.includes(h));
            return mine.length ? mine.map((h) => `«{{${h}}}»`).join("") : text;
          }),
        );
        for (const input of INPUTS.slice(0, 2))
          for (const jev of [1, 2]) {
            const { r } = await traced(probed, input, jev);
            for (const s of r.trace.spans.filter((x) => x.path === w.path)) {
              const seen = s.kind === "emit" ? probes(s.output) : s.calls.filter((c) => (c.tier ?? undefined) === w.tier).flatMap((c) => probes(c.state));
              if (!seen.length) continue;
              reached++;
              expect(seen, `seed ${seed}: ${w.path} ${w.message}`).toEqual(seen.map(() => ""));
            }
          }
        for (const f of w.fixes) {
          fixes++;
          const fixed = updateAt(root, f.at ?? w.path, f.node);
          // holes keep their order, so the rewritten ones line up with the originals
          const was = readsIn(getAt(root, w.path)!);
          const now = readsIn(getAt(fixed, w.path)!);
          const read = now.find((x, i) => x.id !== was[i]!.id)!.id;
          const gone = was.find((y, i) => y.id !== now[i]!.id)!.id;
          const still = flowWarnings(fixed).filter((x) => x.rule === "dead-read" && x.path === w.path && x.tier === w.tier);
          expect(still.some((x) => new RegExp(`\\{\\{results\\.${gone}[.}]`).test(x.message)), `seed ${seed}: fix "${f.label}" at ${w.path} left it dead`).toBe(false);
          for (const input of INPUTS.slice(0, 2))
            for (const jev of [1, 2]) {
              const { doneAtStart } = await traced(fixed, input, jev);
              for (const d of doneAtStart.get(w.path) ?? []) {
                fixedReached++;
                expect(d.has(read), `seed ${seed}: fix "${f.label}" at ${w.path}`).toBe(true);
              }
            }
        }
      }
    }
    expect(flagged).toBeGreaterThan(1000);
    expect(reached).toBeGreaterThan(2500);
    expect(fixes).toBeGreaterThan(1500);
    expect(fixedReached).toBeGreaterThan(3500);
  }, 120_000);
});
