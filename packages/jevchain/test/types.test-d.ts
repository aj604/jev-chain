import { expectTypeOf, test } from "vitest";
import { ask, chain, choice, emit, gate, noul, parallel, route, score, step, cascade, tier } from "../src/index.js";
import type { ChoiceAnswer, NoulAnswer, OutputOf, InputOf, ScoreAnswer } from "../src/index.js";

test("choice labels come back as a literal union", () => {
  const n = ask("x", { questions: { dept: choice("?", ["billing", "bug", "vibes"]), urgent: noul("?"), spice: score("?", ["a", "b"]) } });
  type O = OutputOf<typeof n>;
  expectTypeOf<O["dept"]>().toEqualTypeOf<ChoiceAnswer<"billing" | "bug" | "vibes">>();
  expectTypeOf<O["dept"]["choice"]>().toEqualTypeOf<"billing" | "bug" | "vibes">();
  expectTypeOf<O["urgent"]>().toEqualTypeOf<NoulAnswer>();
  expectTypeOf<O["spice"]>().toEqualTypeOf<ScoreAnswer>();
  const obj = ask("y", { questions: { d: choice("?", { a: "desc", b: null }) } });
  expectTypeOf<OutputOf<typeof obj>["d"]["choice"]>().toEqualTypeOf<"a" | "b">();
});

test("route is exhaustive", () => {
  const r = route("r", {
    ask: choice("?", ["billing", "bug"]),
    branches: { billing: emit(1), bug: step("s", (i: string) => i.length > 3) },
  });
  expectTypeOf<OutputOf<typeof r>>().toEqualTypeOf<1 | boolean>();
  expectTypeOf<InputOf<typeof r>>().toEqualTypeOf<string>();

  route("missing", {
    ask: choice("?", ["billing", "bug"]),
    // @ts-expect-error: no branch for "bug"
    branches: { billing: emit(1) },
  });

  route("extra", {
    ask: choice("?", ["billing", "bug"]),
    // @ts-expect-error: "vibes" isn't an option
    branches: { billing: emit(1), bug: emit(2), vibes: emit(3) },
  });
});

test("gate output unions then/otherwise", () => {
  const g = gate("g", { ask: noul("?"), pass: { min: 0.5 }, then: emit("yes"), otherwise: emit(false) });
  expectTypeOf<OutputOf<typeof g>>().toEqualTypeOf<string | false>();
  const c = gate("c", { ask: choice("?", ["a", "b"]), pass: { label: "a", min: 0.5 }, then: emit(1) });
  expectTypeOf<OutputOf<typeof c>>().toEqualTypeOf<1>();
  // @ts-expect-error: label must be an option
  gate("bad", { ask: choice("?", ["a", "b"]), pass: { label: "zzz", min: 0.5 }, then: emit(1) });
});

test("chain threads types and rejects mismatches", () => {
  const c = chain(
    "c",
    ask("a", { questions: { mood: choice("?", ["cursed", "blessed"]) } }),
    step("s", (a) => a.mood.choice),
    step("t", (m) => (m === "cursed" ? 0 : 1)),
  );
  expectTypeOf<OutputOf<typeof c>>().toEqualTypeOf<0 | 1>();
  // @ts-expect-error: number output into a string-only step
  chain("bad", step("n", (_: unknown) => 1), step("s", (x: string) => x));
});

test("parallel joins", () => {
  const p = parallel("p", { branches: { a: emit(1), b: step("s", (_: unknown) => "x") } });
  expectTypeOf<OutputOf<typeof p>>().toEqualTypeOf<{ a: 1; b: string }>();
  const j = parallel("j", { branches: { a: emit(1), b: emit(2) }, join: (r) => r.a + r.b });
  expectTypeOf<OutputOf<typeof j>>().toEqualTypeOf<number>();
});

test("cascade result", () => {
  const c = cascade("c", {
    tiers: [tier("fast", { ask: choice("?", ["y", "n"]), minConfidence: 0.8 })],
    fallback: step("llm", async (_: string) => "maybe"),
  });
  type O = OutputOf<typeof c>;
  expectTypeOf<Extract<O, { resolvedBy: "tier" }>["answer"]>().toEqualTypeOf<ChoiceAnswer<"y" | "n">>();
  expectTypeOf<Extract<O, { resolvedBy: "fallback" }>["output"]>().toEqualTypeOf<string>();
});
