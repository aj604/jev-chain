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

test("chains of eight or more still thread types and reject mismatches", () => {
  const inc = (id: string) => step(id, (n: number) => n + 1);
  const long = chain(
    "long",
    step("parse", (s: string) => s.length),
    inc("a"),
    inc("b"),
    inc("c"),
    inc("d"),
    inc("e"),
    inc("f"),
    step("show", (n: number) => `${n}!`),
    emit({ done: true }),
  );
  expectTypeOf<InputOf<typeof long>>().toEqualTypeOf<string>();
  expectTypeOf<OutputOf<typeof long>>().toEqualTypeOf<{ readonly done: true }>();
  const eight = chain("eight", inc("a"), inc("b"), inc("c"), inc("d"), inc("e"), inc("f"), inc("g"), step("s", (n: number) => String(n)));
  expectTypeOf<InputOf<typeof eight>>().toEqualTypeOf<number>();
  expectTypeOf<OutputOf<typeof eight>>().toEqualTypeOf<string>();
  // Loose nodes (what generated code is made of) compose at any length.
  const loose = (id: string) => step(id, async (input: any) => input);
  chain("loose", loose("1"), loose("2"), loose("3"), loose("4"), loose("5"), loose("6"), loose("7"), loose("8"), loose("9"), loose("10"));
  chain(
    "bad",
    // @ts-expect-error: the eighth node takes a number but gets the string before it
    inc("a"),
    inc("b"),
    inc("c"),
    inc("d"),
    inc("e"),
    inc("f"),
    step("show", (n: number) => `${n}!`),
    inc("g"),
  );
});
