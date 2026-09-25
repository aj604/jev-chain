import { describe, expect, it } from "vitest";
import { handlersOf, ChainConfigError, cascade, chain, choice, createJev, emit, fromJSON, gate, noul, parallel, route, score, step, tier, toJSON, toTypeScript, ask } from "../src/index.js";
import { fakeFetch } from "./helpers";

const lookup = step("lookup", async (msg: string) => ({ msg, vip: msg.includes("ceo") }));
const everything = chain(
  "everything",
  lookup,
  parallel("read-room", {
    branches: {
      tone: ask("tone", { questions: { t: score("How heated?", ["chill", "tense", "nuclear"]) }, state: "{{input.msg}}" }),
      vip: step("is-vip", (x: { vip: boolean }) => x.vip),
    },
    join: (r) => r,
  }),
  route("next", {
    ask: choice("What now?", { escalate: "a human should see this", ignore: null }),
    state: (x) => JSON.stringify(x),
    branches: {
      escalate: gate("sure", { ask: noul("Really?"), pass: { min: 0.5 }, then: emit({ action: "escalate" }), unsure: { margin: 0.1, then: emit({ action: "ask" }) } }),
      ignore: cascade("double-check", {
        tiers: [tier("quick", { ask: noul("Safe to ignore?"), minConfidence: 0.8 })],
        fallback: emit({ action: "llm" }),
      }),
    },
  }),
);

describe("toJSON / fromJSON", () => {
  it("round-trips, turning functions into refs", () => {
    const doc = toJSON(everything, { name: "Everything", examples: ["hi"] });
    expect(doc.refs).toEqual(["is-vip", "lookup", "next.state", "read-room.join"]);
    const text = JSON.stringify(doc);
    const again = toJSON(
      fromJSON(text, {
        handlers: { lookup: () => 1, "is-vip": () => 1, "next.state": () => "s", "read-room.join": (r: unknown) => r },
      }),
      { name: "Everything", examples: ["hi"] },
    );
    expect(again).toEqual(doc);
  });

  it("handlersOf rebuilds a working chain from its own code", async () => {
    const doc = toJSON(everything);
    const handlers = handlersOf(everything);
    expect(Object.keys(handlers).sort()).toEqual(doc.refs);
    const rebuilt = fromJSON(doc, { handlers });
    const r = await createJev({ apiKey: "k", fetch: fakeFetch() }).run(rebuilt, "the ceo is mad");
    expect(r.status).toBe("ok");
  });

  it("lists missing handlers", () => {
    const doc = toJSON(everything);
    expect(() => fromJSON(doc)).toThrow(ChainConfigError);
    try {
      fromJSON(doc, { handlers: { lookup: () => 1 } });
    } catch (e) {
      expect((e as ChainConfigError).issues).toEqual([
        'missing handler "is-vip" (pass it in options.handlers)',
        'missing handler "next.state" (pass it in options.handlers)',
        'missing handler "read-room.join" (pass it in options.handlers)',
      ]);
    }
  });

  it("can pass through missing step handlers for previews", async () => {
    const doc = toJSON(chain("c", step("mystery", (x: string) => x.toUpperCase()), emit("{{input}}!")));
    const node = fromJSON(doc, { missingHandlers: "passthrough" });
    const r = await createJev({ apiKey: "k", fetch: fakeFetch() }).run(node, "hi");
    expect(r.output).toBe("hi!");
    expect(r.trace.spans[1]!.logs[0]!.message).toMatch(/no handler bound/);
  });

  it("validates structure of loaded JSON", () => {
    const bad = {
      format: "jevchain/v1",
      refs: [],
      root: { kind: "route", id: "r", ask: { type: "choice", criteria: { a: null, b: null } }, branches: { a: { kind: "emit", id: "e", value: 1 } } },
    };
    expect(() => fromJSON(bad as never)).toThrow(/no branch for "b"/);
    expect(() => fromJSON({ ...bad, format: "langchain" } as never)).toThrow(/Unsupported format/);
  });
});

describe("toTypeScript", () => {
  it("emits builder code for every node kind", () => {
    const code = toTypeScript(toJSON(everything, { description: "It has everything." }));
    expect(code).toMatch(/^import \{ ask, cascade, chain, choice, emit, gate, noul, parallel, route, score, step, tier \} from "jevchain";/);
    expect(code).toContain("/** It has everything. */");
    expect(code).toContain("export const everything = chain(");
    expect(code).toContain('route("next", {');
    expect(code).toContain('choice("What now?", { escalate: "a human should see this", ignore: null })');
    expect(code).toContain('tier("quick", { ask: noul("Safe to ignore?"), minConfidence: 0.8 })');
    expect(code).toContain('unsure: { margin: 0.1, then: emit({ action: "ask" }) }');
    expect(code).toContain('// TODO: implement "lookup"');
  });

  it("uses array shorthand for description-less choices", () => {
    const code = toTypeScript(toJSON(route("r", { ask: choice("?", ["a", "b"]), branches: { a: emit(1), b: emit(2) } })));
    expect(code).toContain('choice("?", ["a", "b"])');
  });
});
