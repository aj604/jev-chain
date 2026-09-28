import { run } from "jevchain";
import { describe, expect, it } from "vitest";
import { gate, outcome, pick, rate, recipe, route, scale, yesNo } from "@/test/build";
import { fakeJev } from "@/test/fake-jev";
import { COPY } from "./copy";
import { MAX_BODY_BYTES, validateJevRequest, type JevRequestBody } from "./jev-request";
import { validateRecipeRequest } from "./recipe-request";
import { compileRecipe } from "./recipe/compile";
import { CAPS } from "./recipe/types";
import { validateRecipe } from "./recipe/validate";

/** `seed` padded out to exactly `length` characters. */
const at = (length: number, seed: string) => seed.padEnd(length, "x");

const labelsAtCap = (seed: string) =>
  Object.fromEntries(
    Array.from({ length: CAPS.labels.max }, (_, i) => [
      at(CAPS.label, `${seed}-${i}-`),
      at(CAPS.labelDescription, `Label ${i} of ${seed}. `),
    ]),
  );

const ok: JevRequestBody = {
  state: "my breakup text",
  model: "jev-latest",
  questions: {
    decision: { type: "noul", instructions: "Is it kind?" },
    means: { type: "noul", instructions: "Is it kind?", criteria: { true: "warm", false: "cold" } },
    which: { type: "choice", instructions: "Which?", criteria: { calm: "Quiet.", loud: "Not quiet." } },
    how: { type: "score", instructions: "How much?", criteria: ["low", "high"] },
  },
};

type Question = JevRequestBody["questions"][string];

/** `ok` with one question swapped in (or the whole questions map). */
const withQuestion = (q: Question): JevRequestBody => ({ ...ok, questions: { q } });

describe("validateRecipeRequest", () => {
  it("accepts a noul with and without criteria, a choice and a score", () => {
    expect(validateRecipeRequest(ok)).toEqual({ ok: true });
  });

  it("accepts every string and list at its cap", () => {
    const questions = Object.fromEntries(
      Array.from({ length: CAPS.rateQuestions.max }, (_, i) => [
        `q${i}`,
        {
          type: "choice",
          instructions: at(CAPS.question, "Which? "),
          criteria: labelsAtCap("label"),
        },
      ]),
    );
    expect(validateRecipeRequest({ ...ok, state: at(CAPS.input, "state "), questions })).toEqual({ ok: true });
    expect(
      validateRecipeRequest(
        withQuestion({
          type: "score",
          instructions: "How much?",
          criteria: Array.from({ length: CAPS.levels.max }, (_, i) => at(CAPS.level, `level ${i} `)),
        }),
      ),
    ).toEqual({ ok: true });
  });

  const noul = (instructions: unknown): Question => ({ type: "noul", instructions });
  const choice = (criteria: unknown): Question => ({ type: "choice", instructions: "Which?", criteria });
  const score = (criteria: unknown): Question => ({ type: "score", instructions: "How much?", criteria });
  const many = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`q${i}`, noul("Is it?")]));

  it.each<[string, JevRequestBody, RegExp]>([
    ["state over the input cap", { ...ok, state: "x".repeat(CAPS.input + 1) }, /state.*2000/],
    ["whitespace state", { ...ok, state: "  \n " }, /state/],
    ["object state", { ...ok, state: { text: "hi" } }, /state/],
    ["array state", { ...ok, state: ["hi"] }, /state/],
    ["an extra body field", { ...ok, stream: true } as JevRequestBody, /stream/],
    ["no questions", { ...ok, questions: {} }, /1 to 6 questions, got 0/],
    ["7 questions", { ...ok, questions: many(CAPS.rateQuestions.max + 1) }, /1 to 6 questions, got 7/],
    ["another question type", withQuestion({ type: "rank", instructions: "Rank?" }), /"rank"/],
    ["missing instructions", withQuestion({ type: "noul" }), /instructions/],
    ["empty instructions", withQuestion(noul("   ")), /instructions/],
    ["object instructions", withQuestion(noul({ text: "Is it?" })), /instructions/],
    ["instructions over 200", withQuestion(noul("x".repeat(CAPS.question + 1))), /instructions.*200/],
    ["an extra question field", withQuestion({ type: "noul", instructions: "Is it?", model: "x" }), /model/],
    ["a noul with only true", withQuestion({ type: "noul", instructions: "Is it?", criteria: { true: "yes" } }), /exactly true and false/],
    ["a noul with an extra criterion", withQuestion({ type: "noul", instructions: "Is it?", criteria: { true: "y", false: "n", maybe: "m" } }), /exactly true and false/],
    ["a noul with null criteria", withQuestion({ type: "noul", instructions: "Is it?", criteria: null }), /object with true and false/],
    ["a noul with list criteria", withQuestion({ type: "noul", instructions: "Is it?", criteria: ["y", "n"] }), /object with true and false/],
    ["a noul with an empty false", withQuestion({ type: "noul", instructions: "Is it?", criteria: { true: "y", false: " " } }), /up to 120/],
    ["a noul with a true over 120", withQuestion({ type: "noul", instructions: "Is it?", criteria: { true: "x".repeat(CAPS.means + 1), false: "n" } }), /up to 120/],
    ["a choice with a list", withQuestion(choice(["a", "b"])), /criteria/],
    ["a choice with 1 label", withQuestion(choice({ a: "A." })), /2 to 6 labels/],
    ["a choice with 7 labels", withQuestion(choice({ a: "A", b: "B", c: "C", d: "D", e: "E", f: "F", g: "G" })), /2 to 6 labels/],
    ["a choice label over 40", withQuestion(choice({ [at(CAPS.label + 1, "a")]: "A.", b: "B." })), /label pattern/],
    ["an uppercase choice label", withQuestion(choice({ Calm: "A.", b: "B." })), /label pattern/],
    ["a null description", withQuestion(choice({ a: null, b: "B." })), /description/],
    ["a description over 120", withQuestion(choice({ a: "x".repeat(CAPS.labelDescription + 1), b: "B." })), /description.*120/],
    ["a score with an object", withQuestion(score({ low: "l", high: "h" })), /list/],
    ["a score with 1 level", withQuestion(score(["low"])), /2 to 5 levels/],
    ["a score with 6 levels", withQuestion(score(["a", "b", "c", "d", "e", "f"])), /2 to 5 levels/],
    ["a level over 40", withQuestion(score(["low", "x".repeat(CAPS.level + 1)])), /level 1/],
    ["an object level", withQuestion(score(["low", { text: "high" }])), /level 1/],
  ])("rejects %s", (_, body, reason) => {
    const check = validateRecipeRequest(body);
    expect(check.ok).toBe(false);
    expect(!check.ok && check.message).toMatch(reason);
  });

  it("uses the same input cap the copy tells visitors", () => {
    expect(COPY.tooLong).toContain(CAPS.input.toLocaleString("en-US"));
  });
});

/**
 * The biggest recipe the validator allows on one path: a 6-label route, two
 * gates and a six-question rate leaf, with every string at its cap.
 */
function recipeAtCaps() {
  const key = (seed: string) => at(CAPS.key, `${seed}-`);
  const question = (seed: string) => at(CAPS.question, `${seed}? `);
  const end = (seed: string) => outcome(key(seed), at(CAPS.stamp, `${seed} `), at(CAPS.line, `${seed}. `));
  const levels = (seed: string) => Array.from({ length: CAPS.levels.max }, (_, i) => at(CAPS.level, `${seed} ${i} `));
  const means = (seed: string) => ({ yes: at(CAPS.means, `${seed} yes `), no: at(CAPS.means, `${seed} no `) });
  const choiceLabels = labelsAtCap("pick");

  const leaf = rate(
    key("rate"),
    [
      yesNo(key("noul-a"), question("Noul a"), CAPS.maxWeight, true),
      scale(key("score-a"), question("Score a"), CAPS.maxWeight, levels("score a"), "high"),
      pick(key("choice-a"), question("Choice a"), CAPS.maxWeight, choiceLabels, [Object.keys(choiceLabels)[0]]),
      yesNo(key("noul-b"), question("Noul b"), 1, false),
      scale(key("score-b"), question("Score b"), 1, levels("score b"), "low"),
      pick(key("choice-b"), question("Choice b"), 1, labelsAtCap("other"), [at(CAPS.label, "other-5-")]),
    ],
    [
      [0.75, end("band-a")],
      [0.5, end("band-b")],
      [0.25, end("band-c")],
      [0, end("band-d")],
    ],
    { title: at(CAPS.nodeTitle, "Rating ") },
  );
  // The fake says 0.1 to every noul, so gates go on to `no`.
  const gates = gate(
    key("gate-a"),
    question("Gate a"),
    end("stopped-at-a"),
    gate(key("gate-b"), question("Gate b"), end("stopped-at-b"), leaf, {
      title: at(CAPS.nodeTitle, "Gate b "),
      means: means("b"),
      unsure: end("unsure-at-b"),
    }),
    { title: at(CAPS.nodeTitle, "Gate a "), means: means("a") },
  );
  const routeLabels = labelsAtCap("route");
  const [first, ...rest] = Object.keys(routeLabels);
  const branches = { [first]: gates, ...Object.fromEntries(rest.map((l, i) => [l, end(`branch-${i}`)])) };
  return recipe(
    at(CAPS.title, "The Desk "),
    at(CAPS.thing, "the thing "),
    route(key("route"), question("Route"), routeLabels, branches, {
      title: at(CAPS.nodeTitle, "Route "),
      lowConfidence: end("low"),
    }),
  );
}

describe("a compiled recipe's own requests", () => {
  it("all pass the recipe-shape check, with every string at its cap", async () => {
    const checked = validateRecipe(recipeAtCaps());
    if (!checked.ok) throw new Error(checked.message);

    const input = at(CAPS.input, "A visitor's text. ");
    const { client, requests } = fakeJev();
    const result = await run(compileRecipe(checked.recipe), input, { jev: client });

    expect(result.status).toBe("ok");
    // Route, gate a, gate b, then the rate leaf in one request.
    expect(requests.map((r) => Object.values(r.questions).map((q) => q.type))).toEqual([
      ["choice"],
      ["noul"],
      ["noul"],
      ["noul", "score", "choice", "noul", "score", "choice"],
    ]);
    // The caps really are reached, so the check below is at the edge.
    const all = requests.flatMap((r) => Object.values(r.questions));
    expect(Math.max(...all.map((q) => String(q.instructions).length))).toBe(CAPS.question);
    expect(Math.max(...all.map((q) => (Array.isArray(q.criteria) ? q.criteria.length : 0)))).toBe(CAPS.levels.max);
    const means = all.flatMap((q) => (q.type === "noul" && q.criteria ? [String((q.criteria as { true: string }).true)] : []));
    expect(means.map((m) => m.length)).toEqual([CAPS.means, CAPS.means]);

    for (const { state, questions } of requests) {
      expect(state).toBe(input);
      const valid = validateJevRequest({ state, model: client.model, questions });
      if (!valid.ok) throw new Error(valid.message);
      expect(validateRecipeRequest(valid.body)).toEqual({ ok: true });
      expect(JSON.stringify(valid.body).length).toBeLessThan(MAX_BODY_BYTES);
    }
  });
});
