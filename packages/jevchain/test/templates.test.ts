import { describe, expect, it } from "vitest";
import {
  ask,
  cascade,
  chain,
  ChainConfigError,
  chainIssues,
  choice,
  createJev,
  emit,
  fromJSON,
  gate,
  noul,
  parallel,
  route,
  step,
  tier,
  toJSON,
  walk,
  type AnyNode,
} from "../src/index.js";
import { fakeFetch } from "./helpers";

const jevWith = (f: ReturnType<typeof fakeFetch>) => createJev({ apiKey: "test", fetch: f, retry: { initialDelayMs: 1, maxDelayMs: 2 } });
const q = { x: noul("?") };

describe("template references", () => {
  it("rejects a hole with an unknown root, and suggests the right one", () => {
    const c = chain("c", ask("read", { questions: q, state: "From {{inptu.user}}: {{input.text}}" }));
    expect(chainIssues(c)).toEqual([
      `$/0 (ask "read").state: "{{inptu.user}}" reads "inptu", which templates don't have; start with input, run, results, answers (did you mean "input"?)`,
    ]);
  });

  it("rejects results of an id no node has", () => {
    const c = chain("c", step("lookup", (s: string) => ({ s })), emit("{{results.lookpu.s}}"));
    expect(chainIssues(c)).toEqual([`$/1 (emit "emit").value: "{{results.lookpu.s}}" reads results of "lookpu", but no node has that id (did you mean "lookup"?)`]);
  });

  it("rejects results that can't have finished yet: ancestors, itself, later steps", () => {
    const c = chain(
      "c",
      route("triage", {
        ask: choice("?", ["bug", "other"]),
        branches: {
          bug: gate("urgent", { ask: noul("?"), state: "{{results.triage.decision}}", pass: { min: 0.5 }, then: emit("page") }),
          other: ask("self", { questions: q, state: "{{results.self}}" }),
        },
      }),
      ask("early", { questions: q, state: "{{results.late}}" }),
      step("late", () => 2),
    );
    expect(chainIssues(c)).toEqual([
      `$/0/bug (gate "urgent").state: "{{results.triage.decision}}" reads results of "triage", which is still running at $/0 (results are set when a node finishes; what Jev answered it is in {{answers.triage}})`,
      `$/0/other (ask "self").state: "{{results.self}}" reads results of "self", this node's own output, which doesn't exist until it finishes`,
      `$/1 (ask "early").state: "{{results.late}}" reads results of "late", which is at $/2 and never finishes before this node runs`,
    ]);
  });

  it("accepts results of anything under an earlier step, including a branch that might not run", () => {
    const c = chain(
      "c",
      route("triage", { ask: choice("?", ["bug", "other"]), branches: { bug: emit({ n: 1 }, { id: "bug-note" }), other: emit({ n: 2 }, { id: "other-note" }) } }),
      parallel("fan", {
        branches: {
          a: ask("a", { questions: q, state: "{{results.triage}} {{results.bug-note.n}} {{run}} {{results}}" }),
          b: chain("b", step("inner", () => 1), emit("{{results.inner}} {{results.other-note}}")),
        },
      }),
      cascade("cc", { tiers: [tier("t1", { ask: noul("?"), minConfidence: 0.9, state: "{{results.a.x}}" })], fallback: emit("{{results.fan.b}}") }),
    );
    expect(chainIssues(c)).toEqual([]);
  });

  it("accepts a parallel sibling's results, which a fast sibling has already set", async () => {
    const c = parallel("fan", {
      branches: {
        slow: chain("slow", ask("a", { questions: q }), emit("{{results.ea}} {{results.sa}}", { id: "reader" })),
        fastEmit: emit("EA", { id: "ea" }),
        fastStep: step("sa", () => "SA"),
      },
    });
    expect(chainIssues(c)).toEqual([]);
    const r = await jevWith(fakeFetch()).run(c, "hi");
    expect(r.output).toEqual({ slow: "EA SA", fastEmit: "EA", fastStep: "SA" });
  });

  it("checks cascade tiers and nested emit values, with a path the builder can point at", () => {
    const c = chain(
      "c",
      cascade("cc", { tiers: [tier("quick", { ask: noul("?"), minConfidence: 0.9, state: "{{input.a}} {{resluts.x}}" })], fallback: emit({ reply: ["ok", "{{results.nope}}"] }) }),
    );
    expect(chainIssues(c)).toEqual([
      `$/0 (cascade "cc").tiers.quick.state: "{{resluts.x}}" reads "resluts", which templates don't have; start with input, run, results, answers (did you mean "results"?)`,
      `$/0/fallback (emit "emit").value.reply.1: "{{results.nope}}" reads results of "nope", but no node has that id`,
    ]);
  });

  it("fails the run before any call is made, and fails fromJSON", async () => {
    const c = chain("c", ask("first", { questions: q }), ask("second", { questions: q, state: "{{results.frist.x}}" }));
    const f = fakeFetch();
    const err = await jevWith(f)
      .run(c, "hi")
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ChainConfigError);
    expect((err as ChainConfigError).issues[0]).toMatch(/"frist", but no node has that id \(did you mean "first"\?\)/);
    expect(f.calls).toHaveLength(0);
    expect(() => fromJSON(toJSON(c))).toThrow(/did you mean "first"/);
  });
});

describe("empty template holes at runtime", () => {
  it("notes each empty hole on the span, and nothing when every hole resolves", async () => {
    const c = chain(
      "c",
      ask("read", { questions: q, state: "{{input.text}} from {{input.usr.name}}" }),
      emit({ said: "{{run.text}}", who: "{{run.nobody}}", tag: "{{input.x.type}}" }, { id: "out" }),
    );
    const f = fakeFetch();
    const r = await jevWith(f).run(c, { text: "the printer hums", user: { name: "sam" } });
    expect(r.status).toBe("ok");
    expect(f.calls[0]!.state).toBe("the printer hums from ");
    const logs = (id: string) => r.trace.spans.find((s) => s.nodeId === id)!.logs.map((l) => l.message);
    expect(logs("read")).toEqual([`Template hole "{{input.usr.name}}" was empty`]);
    expect(logs("out")).toEqual([`Template hole "{{run.nobody}}" was empty`]);
    expect(r.trace.spans.find((s) => s.nodeId === "c")!.logs).toEqual([]);
  });

  it("doesn't count an explicit null as missing", async () => {
    const r = await jevWith(fakeFetch()).run(emit({ v: "{{input.v}}" }), { v: null });
    expect(r.output).toEqual({ v: null });
    expect(r.trace.spans[0]!.logs).toEqual([]);
  });
});

describe("answers: what Jev said, as soon as it said it", () => {
  const team = choice("Which team?", { billing: "money", bug: "broken" });
  const angry = noul("Is the customer angry?");

  it("lets a branch use the route's alsoAsk and its decision, with no second call", async () => {
    const desk = route("desk", {
      ask: team,
      alsoAsk: { angry },
      branches: {
        billing: emit({ angry: "{{answers.desk.angry.noul}}", sure: "{{answers.desk.decision.confidence}}" }, { id: "to-billing" }),
        bug: step("to-bug", (_: unknown, ctx) => ctx.answers.desk),
      },
    });
    expect(chainIssues(desk)).toEqual([]);
    const f = fakeFetch((_s, k) => (k === "angry" ? { noul: 0.8 } : undefined));
    const r = await jevWith(f).run(desk, "charged twice!!");
    expect(r.output).toEqual({ angry: 0.8, sure: 0.85 });
    expect(f.calls).toHaveLength(1);

    const bug = await jevWith(fakeFetch((_s, k) => (k === "decision" ? { choice: "bug" } : undefined))).run(desk, "it crashed");
    expect(bug.output).toMatchObject({ decision: { type: "choice", choice: "bug" }, angry: { type: "noul", noul: 0.9 } });
  });

  it("covers gates, asks and cascade tiers (by tier id), in steps, joins and templates", async () => {
    const cc = cascade("cc", {
      tiers: [tier("quick", { ask: noul("?"), minConfidence: 0.99 }), tier("careful", { ask: noul("?"), minConfidence: 0.99 })],
      fallback: step("llm", (_: unknown, ctx) => Object.keys(ctx.answers.cc ?? {})),
    });
    const c = chain(
      "c",
      parallel("fan", {
        branches: { mood: ask("mood", { questions: { angry } }), echo: emit("x", { id: "echo" }) },
        join: (r, _input, ctx) => ({ ...r, fromCtx: ctx.answers.mood?.angry }),
      }),
      gate("worth-it", { ask: noul("Worth it?"), pass: { min: 0.5 }, then: emit("{{answers.worth-it.decision.noul}} / {{answers.mood.angry.noul}}", { id: "yes" }) }),
      cc,
      emit("{{answers.cc.careful.noul}}", { id: "last" }),
    );
    expect(chainIssues(c)).toEqual([]);
    const f = fakeFetch((_s, _k, q) => (q.instructions === "?" ? { noul: 0.6 } : undefined));
    const r = await jevWith(f).run(c, "hi");
    expect(r.status).toBe("ok");
    const out = (id: string) => r.trace.spans.filter((s) => s.nodeId === id).map((s) => s.output);
    expect(out("fan")[0]).toMatchObject({ fromCtx: { type: "noul", noul: 0.9 } });
    expect(out("yes")).toEqual(["0.9 / 0.9"]);
    expect(out("llm")).toEqual([["quick", "careful"]]);
    expect(out("last")).toEqual([0.6]);
  });

  it("starts a re-run cascade's tiers fresh, so an untried tier is empty, not stale", async () => {
    let n = 0;
    const cc = cascade("cc", {
      tiers: [tier("quick", { ask: noul("?"), minConfidence: 0.5 }), tier("careful", { ask: noul("?"), minConfidence: 0.5 })],
      fallback: emit("fb"),
    });
    const c = chain("c", cc, cc, emit({ careful: "{{answers.cc.careful.noul}}" }, { id: "out" }));
    // First pass: quick is a coin flip (confidence 0), so careful answers. Second pass: quick is sure.
    const f = fakeFetch(() => ({ noul: n++ === 0 ? 0.5 : 0.95 }));
    const r = await jevWith(f).run(c, "hi");
    expect(f.calls).toHaveLength(3);
    const out = r.trace.spans.find((s) => s.nodeId === "out")!;
    expect(out.output).toEqual({});
    expect(out.logs.map((l) => l.message)).toEqual([`Template hole "{{answers.cc.careful.noul}}" was empty`]);
  });

  it("rejects answers that can never be there, and says why", () => {
    const c = chain(
      "c",
      ask("mood", { questions: { angry }, state: "{{answers.mood}}" }),
      step("lookup", (x: unknown) => x),
      route("desk", {
        ask: team,
        alsoAsk: { angry },
        branches: {
          billing: emit("{{answers.desk.angy}} {{answers.moood.angry}} {{answers.lookup}} {{answers.c.x}}", { id: "b" }),
          bug: emit("{{answers.later}} {{answers.cc.fallback}}", { id: "g" }),
        },
      }),
      ask("later", { questions: { angry } }),
      cascade("cc", { tiers: [tier("quick", { ask: angry, minConfidence: 0.5 })], fallback: emit("{{answers.cc.quick.noul}}") }),
    );
    expect(chainIssues(c)).toEqual([
      `$/0 (ask "mood").state: "{{answers.mood}}" reads answers of "mood", this node's own, which don't exist until its call comes back`,
      `$/2/billing (emit "b").value: "{{answers.desk.angy}}" reads answers of "desk", which has no "angy" (it has "decision", "angry") (did you mean "angry"?)`,
      `$/2/billing (emit "b").value: "{{answers.moood.angry}}" reads answers of "moood", but no node has that id (did you mean "mood"?)`,
      `$/2/billing (emit "b").value: "{{answers.lookup}}" reads answers of "lookup", a step, which doesn't ask Jev itself`,
      `$/2/billing (emit "b").value: "{{answers.c.x}}" reads answers of "c", a chain, which doesn't ask Jev itself; read the ask, route, gate or cascade inside it`,
      `$/2/bug (emit "g").value: "{{answers.later}}" reads answers of "later", which is at $/3 and never asks Jev before this node runs`,
      `$/2/bug (emit "g").value: "{{answers.cc.fallback}}" reads answers of "cc", which is at $/4 and never asks Jev before this node runs`,
    ]);
  });

  it("accepts answers from a parallel sibling, a whole-map read, and a key any same-id node asks", () => {
    const c = chain(
      "c",
      route("r", { ask: team, branches: { billing: ask("read", { questions: { a: angry } }), bug: ask("read", { questions: { b: angry } }) } }),
      parallel("fan", { branches: { one: ask("one", { questions: { angry } }), two: emit("{{answers.one.angry}} {{answers}} {{answers.r}}", { id: "two" }) } }),
      emit("{{answers.read.a}} {{answers.read.b}}", { id: "end" }),
    );
    expect(chainIssues(c)).toEqual([]);
    expect(() => fromJSON(toJSON(c))).not.toThrow();
  });

  // A rejected hole must be one that is empty in every run. Random chains get
  // probes that read `{{answers.<id>.<key>}}`: once as an emit (what
  // chainIssues judges), once as a step at the same spot that records whether
  // the answer was ever there, over runs where every decision goes both ways.
  it("never rejects a hole that some run would fill (random sweep)", async () => {
    let probes = 0;
    let rejected = 0;
    const wrong: string[] = [];
    for (let seed = 1; seed <= 250; seed++) {
      const filled = new Set<string>();
      const judged = randomChain(seed, "emit", filled);
      const issues = chainIssues(judged.root);
      expect(issues.filter((i) => !/ \(emit "probe\d+"\)/.test(i))).toEqual([]);
      const probed = randomChain(seed, "step", filled);
      for (let i = 0; i < 8; i++) {
        const next = lcg(seed * 1000 + i);
        const f = fakeFetch((_s, _k, q) => (q.type === "choice" ? { choice: next() < 0.5 ? "l1" : "l2", confidence: next() } : q.type === "noul" ? { noul: next() } : { confidence: next() }));
        expect((await jevWith(f).run(probed.root, "in")).status).not.toBe("error");
      }
      for (const p of judged.probes) {
        probes++;
        const issue = issues.find((i) => i.includes(`(emit "${p.name}")`));
        if (issue) rejected++;
        if (issue && filled.has(p.name)) wrong.push(`seed ${seed}: ${issue}`);
      }
    }
    expect(wrong).toEqual([]);
    expect(probes).toBeGreaterThan(1000);
    expect(rejected / probes).toBeGreaterThan(0.3); // the sweep exercises real rejections, not just passes
  });
});

function lcg(seed: number) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
}

/** A random, valid chain with probe leaves that read `{{answers.<id>.<key>}}` (as emits) or record whether it's there (as steps). */
function randomChain(seed: number, as: "emit" | "step", filled: Set<string>) {
  const next = lcg(seed);
  const pick = <T,>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)]!;
  let unique = 0;
  const id = () => (next() < 0.6 ? pick(["n1", "n2", "n3", "n4", "n5", "n6", "n7"]) : `u${unique++}`);
  const probes: { name: string; hole: string }[] = [];
  const ids: string[] = [];
  const leaf = (): AnyNode => {
    if (next() < 0.45) {
      const probe = { name: `probe${probes.length}`, hole: "" };
      probes.push(probe);
      if (as === "emit") return { kind: "emit", id: probe.name, get value() { return `{{${probe.hole}}}`; } } as unknown as AnyNode;
      return step(probe.name, (_: unknown, ctx) => {
        const [, target, key] = probe.hole.split(".");
        const v = ctx.answers[target!];
        if ((key ? v?.[key] : v) !== undefined) filled.add(probe.name);
        return null;
      });
    }
    return next() < 0.5 ? emit("e", { id: id() }) : step(id(), (x: unknown) => x);
  };
  const node = (depth: number): AnyNode => {
    const k = depth > 3 ? 1 : next();
    const sub = () => node(depth + 1);
    const maybe = <T,>(p: number, v: () => T) => (next() < p ? v() : {});
    if (k < 0.15) return ask(id(), { questions: next() < 0.5 ? { a: noul("?") } : { a: noul("?"), b: noul("?") } });
    if (k < 0.3)
      return route(id(), {
        ask: choice("?", ["l1", "l2"]),
        branches: { l1: sub(), l2: sub() },
        ...maybe(0.5, () => ({ alsoAsk: { x: noul("?") } })),
        ...maybe(0.3, () => ({ lowConfidence: { below: 0.5, then: sub() } })),
      });
    if (k < 0.45)
      return gate(id(), {
        ask: noul("?"),
        pass: { min: 0.5 },
        then: sub(),
        ...maybe(0.6, () => ({ otherwise: sub() })),
        ...maybe(0.3, () => ({ unsure: { margin: 0.2, then: sub() } })),
        ...maybe(0.4, () => ({ alsoAsk: { x: noul("?") } })),
      });
    if (k < 0.58) return parallel(id(), { branches: { p1: sub(), p2: sub(), ...maybe(0.4, () => ({ p3: sub() })) } });
    if (k < 0.7) {
      const t1 = tier("t1", { ask: noul("?"), minConfidence: 0.5 });
      return cascade(id(), { tiers: next() < 0.5 ? [t1] : [t1, tier("t2", { ask: choice("?", ["l1", "l2"]), minConfidence: 0.5 })], fallback: sub() });
    }
    if (k < 0.88) return (chain as (id: string, ...nodes: AnyNode[]) => AnyNode)(id(), sub(), ...Array.from({ length: Math.floor(next() * 3) }, sub));
    return leaf();
  };
  const root = chain("root", node(0), node(0), node(0));
  walk(root, (n) => {
    if (!n.id.startsWith("probe")) ids.push(n.id);
  });
  const aim = lcg(seed * 7 + 1);
  for (const p of probes) {
    const key = aim() < 0.2 ? undefined : pick(["a", "b", "x", "decision", "t1", "t2", "zz"]);
    p.hole = `answers.${ids[Math.floor(aim() * ids.length)]}${key ? `.${key}` : ""}`;
  }
  return { root, probes };
}
