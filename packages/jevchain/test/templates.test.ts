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
} from "../src/index.js";
import { fakeFetch } from "./helpers";

const jevWith = (f: ReturnType<typeof fakeFetch>) => createJev({ apiKey: "test", fetch: f, retry: { initialDelayMs: 1, maxDelayMs: 2 } });
const q = { x: noul("?") };

describe("template references", () => {
  it("rejects a hole with an unknown root, and suggests the right one", () => {
    const c = chain("c", ask("read", { questions: q, state: "From {{inptu.user}}: {{input.text}}" }));
    expect(chainIssues(c)).toEqual([
      `$/0 (ask "read").state: "{{inptu.user}}" reads "inptu", which templates don't have; start with input, run, results (did you mean "input"?)`,
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
      `$/0/bug (gate "urgent").state: "{{results.triage.decision}}" reads results of "triage", which is still running at $/0 (results are set when a node finishes)`,
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
      `$/0 (cascade "cc").tiers.quick.state: "{{resluts.x}}" reads "resluts", which templates don't have; start with input, run, results (did you mean "results"?)`,
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
