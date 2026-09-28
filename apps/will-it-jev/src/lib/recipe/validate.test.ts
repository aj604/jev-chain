import { describe, expect, it } from "vitest";
import { bands3, gate, outcome, pick, rate, recipe, route, scale, yesNo } from "@/test/build";
import { ladder } from "@/test/fixtures";
import {
  CAPS,
  LIMITS,
  type Recipe,
  type RecipeGate,
  type RecipeNode,
  type RecipeOutcome,
  type RecipeRate,
  type RecipeRoute,
} from "./types";
import { validateRecipe } from "./validate";

/**
 * A gate with `means` and `unsure`, a route with `lowConfidence`, a rate with
 * every question kind and three bands, and outcomes.
 */
function base(): Recipe {
  return recipe(
    "The Plan Dispatch Desk",
    "your plan",
    gate(
      "booked",
      "Is anything booked?",
      route(
        "vibe",
        "What is the vibe?",
        { calm: "A quiet night", loud: "A loud night" },
        {
          calm: outcome("early", "Early night", "Sent home early. Sleep well."),
          loud: rate(
            "loud-rating",
            [
              yesNo("friends", "Are friends coming?", 2, true),
              scale("cost", "How expensive is it?", 1, ["cheap", "fine", "steep"], "low"),
              pick("where", "Where is it?", 1, { home: "At home", out: "Out somewhere" }, ["home"]),
            ],
            [
              [0.66, outcome("go", "Cleared to go", "Cleared to go. Bring a coat.")],
              [0.4, outcome("maybe", "Under review", "Under review. Check again at nine.")],
              [0, outcome("stay-in", "Stay in", "Filed under staying in.")],
            ],
            { title: "Loud enough?" },
          ),
        },
        { title: "Vibe check", lowConfidence: outcome("ask-dave", "Sent to Dave", "A human will read this. Probably Dave.") },
      ),
      outcome("unbooked", "Nothing booked", "Nothing is booked. Book something."),
      {
        title: "Anything booked?",
        means: { yes: "a table, ticket or room", no: "only intentions" },
        unsure: outcome("pending", "Pending", "Filed as pending until further notice."),
      },
    ),
  );
}

const RATE = "root.yes.branches.loud";
const band = (i: number) => `${RATE}.bands[${i}]`;
/** Where an eleventh gate sits, down a ladder's no side. */
const TENTH = `root${".no".repeat(10)}`;
/** The tenth gate of a ladder. */
const NINTH = `root${".no".repeat(9)}`;
const TOO_DEEP = `too deep. the limit is ${LIMITS.depth} decisions on any path`;

/** A copy of `raw` with the value at `path` replaced, or removed when `value` is undefined. */
function at(path: string, value: unknown, raw: unknown = base()): unknown {
  const copy = structuredClone(raw) as Record<string, unknown>;
  const steps = path.replace(/\[(\d+)\]/g, ".$1").split(".");
  if (steps[0] === "recipe") steps.shift();
  let target = copy;
  for (const step of steps.slice(0, -1)) target = target[step] as Record<string, unknown>;
  const last = steps[steps.length - 1];
  if (value === undefined) delete target[last];
  else target[last] = value;
  return copy;
}

function problem(raw: unknown): string {
  const check = validateRecipe(raw);
  if (check.ok) throw new Error("expected the recipe to fail");
  return check.message;
}

function passes(raw: unknown): Recipe {
  const check = validateRecipe(raw);
  if (!check.ok) throw new Error(check.message);
  return check.recipe;
}

const end = (key: string): RecipeOutcome => outcome(key, "Filed", `Filed under ${key}.`);

/** `n` nested gates keyed `<prefix>1`..`<prefix>n`, continuing on yes, each stopping on no. */
function chain(prefix: string, n: number): RecipeNode {
  let node: RecipeNode = end(`${prefix}-end`);
  for (let i = n; i >= 1; i--) {
    node = gate(`${prefix}${i}`, `Question ${prefix} ${i}?`, node, end(`${prefix}${i}-stop`));
  }
  return node;
}

function rating(key: string, count: number): RecipeRate {
  const questions = Array.from({ length: count }, (_, i) => yesNo(`${key}-q${i}`, `Question ${i}?`, 1, true));
  return rate(key, questions, bands3(key));
}

function fan(
  labels: string[],
  branch: (label: string) => RecipeNode,
  opts: { lowConfidence?: RecipeNode } = {},
): RecipeRoute {
  return route(
    "fan",
    "Which way?",
    Object.fromEntries(labels.map((l) => [l, `Way ${l}`])),
    Object.fromEntries(labels.map((l) => [l, branch(l)])),
    opts,
  );
}

/** 4 + 2 * 18 = 40 nodes, 10 deep: a route, two 9-gate chains and one leaf `c`. */
const forty = (c: RecipeNode = end("c-end"), opts: { lowConfidence?: RecipeNode } = {}) =>
  fan(["a", "b", "c"], (l) => (l === "c" ? c : chain(l, 9)), opts);

const wrap = (root: RecipeNode) => recipe("The Test Desk", "it", root);

describe("validateRecipe", () => {
  it("passes a recipe that uses every node and question kind and both escape hatches", () => {
    expect(passes(base())).toEqual(base());
  });

  it("returns a plain copy, not the input", () => {
    const raw = base();
    const clean = passes(raw);
    expect(clean).not.toBe(raw);
    expect(clean.root).not.toBe(raw.root);
    const rated = (clean.root as RecipeGate).yes as RecipeRoute;
    const rawRated = (raw.root as RecipeGate).yes as RecipeRoute;
    expect((rated.branches.loud as RecipeRate).bands).not.toBe((rawRated.branches.loud as RecipeRate).bands);
  });

  it("trims every string and returns ok", () => {
    // Pads text, keys and choice labels. Enum values (kind, a score's good) must match exactly.
    const exact = (field: string, value: unknown) =>
      field === "kind" || (field === "good" && typeof value === "string");
    const pad = (value: unknown): unknown =>
      typeof value === "string"
        ? `  ${value}\n`
        : Array.isArray(value)
          ? value.map(pad)
          : typeof value === "object" && value !== null
            ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, exact(k, v) ? v : pad(v)]))
            : value;
    const padded = pad(base()) as Recipe;
    expect(padded.title).toBe("  The Plan Dispatch Desk\n");
    expect(padded.root).toMatchObject({ key: "  booked\n", means: { yes: "  a table, ticket or room\n" } });
    expect(validateRecipe(padded)).toEqual({ ok: true, recipe: base() });
  });

  it("does not trim enum values", () => {
    expect(problem(at("root.kind", " gate"))).toBe('root.kind: must be "gate", "route", "rate" or "outcome"');
    expect(problem(at(`${RATE}.questions[1].good`, "low "))).toBe(
      `${RATE}.questions[1].good: must be "high" or "low"`,
    );
    expect(problem(at(`${band(0)}.outcome.kind`, "outcome "))).toBe(
      `${band(0)}.outcome: must be an object with kind "outcome"`,
    );
  });

  it("drops fields it does not know", () => {
    let raw = at("recipe.extra", 1);
    for (const path of [
      "root.extra",
      "root.means.maybe",
      "root.no.extra",
      "root.unsure.extra",
      "root.yes.lowConfidence.extra",
      `${RATE}.extra`,
      `${band(0)}.extra`,
      `${band(0)}.outcome.extra`,
    ]) {
      raw = at(path, "x", raw);
    }
    expect(passes(raw)).toEqual(base());
  });

  describe("hostile input", () => {
    it("fails instead of throwing when reading a field throws", () => {
      const boom = () => {
        throw new Error("boom");
      };
      const root = structuredClone(base().root);
      Object.defineProperty(root, "kind", { get: boom });
      expect(problem({ ...base(), root })).toBe("recipe: could not be read");
      expect(problem(new Proxy({}, { get: boom }))).toBe("recipe: could not be read");
      const means = {};
      Object.defineProperty(means, "yes", { get: boom, enumerable: true });
      expect(problem(at("root.means", means))).toBe("recipe: could not be read");
    });

    it("checks the holes in a sparse list", () => {
      // A hole must fail like a missing entry, not pass through as ok.
      const questions = [, yesNo("friends", "Are friends coming?", 2, true)];
      expect(problem(at(`${RATE}.questions`, questions))).toBe(`${RATE}.questions[0]: must be an object`);
      const levels = [, "fine", "steep"];
      expect(problem(at(`${RATE}.questions[1].levels`, levels))).toBe(
        `${RATE}.questions[1].levels[0]: must be a string`,
      );
      // An all-holes choice good must not pass as an empty list.
      expect(problem(at(`${RATE}.questions[2].good`, new Array(2)))).toBe(
        `${RATE}.questions[2].good[0]: must be a string`,
      );
      expect(problem(at(`${RATE}.questions[2].good`, [, "home"]))).toBe(
        `${RATE}.questions[2].good[0]: must be a string`,
      );
      const bands = [, { atLeast: 0, outcome: end("low") }];
      expect(problem(at(`${RATE}.bands`, bands))).toBe(`${band(0)}: must be an object`);
      expect(problem(at(`${RATE}.bands`, new Array(3)))).toBe(`${band(0)}: must be an object`);
    });
  });

  describe("the envelope", () => {
    it("rejects anything that is not an object", () => {
      for (const raw of [undefined, null, "recipe", 3, [], true]) {
        expect(problem(raw)).toBe("recipe: must be an object");
      }
    });

    it("rejects any v but 2, including v1 recipes", () => {
      expect(problem(at("recipe.v", 1))).toBe("recipe.v: must be 2");
      expect(problem(at("recipe.v", "2"))).toBe("recipe.v: must be 2");
      expect(problem(at("recipe.v", 3))).toBe("recipe.v: must be 2");
      expect(problem(at("recipe.v", undefined))).toBe("recipe.v: must be 2");
    });

    it("rejects a whole v1 recipe on v", () => {
      const v1 = {
        v: 1,
        title: "Will it jev?",
        thing: "it",
        root: { kind: "verdict", tier: "jevs", line: "It jevs." },
      };
      expect(problem(v1)).toBe("recipe.v: must be 2");
      expect(problem({ ...v1, v: 2 })).toBe('root.kind: must be "gate", "route", "rate" or "outcome"');
    });

    it("checks v before title, and title before the tree", () => {
      const raw = at("root.key", "Bad", at("recipe.title", "Hey!", at("recipe.v", 1)));
      expect(problem(raw)).toBe("recipe.v: must be 2");
      expect(problem(at("recipe.v", 2, raw))).toBe("recipe.title: no exclamation marks. keep it flat");
    });

    it("needs a root node", () => {
      expect(problem(at("root", undefined))).toBe("root: must be an object");
      expect(problem(at("root", []))).toBe("root: must be an object");
    });

    it("passes a lone outcome as the root", () => {
      expect(passes(wrap(end("only"))).root).toEqual(end("only"));
    });
  });

  describe("walk order", () => {
    it("checks a gate's fields before its children, and yes, no, unsure in that order", () => {
      const badNo = at("root.no.stamp", "Hey!");
      expect(problem(at("root.question", "Hey!", badNo))).toBe("root.question: no exclamation marks. keep it flat");
      expect(problem(at("root.means.no", "Hey!", badNo))).toBe("root.means.no: no exclamation marks. keep it flat");
      expect(problem(at("root.unsure.stamp", "Hey!", badNo))).toBe("root.no.stamp: no exclamation marks. keep it flat");
      expect(problem(at(`${RATE}.title`, "Hey!", badNo))).toBe(`${RATE}.title: no exclamation marks. keep it flat`);
    });

    it("checks a route's branches before lowConfidence", () => {
      const raw = at("root.yes.lowConfidence.line", "Hey!", at(`${RATE}.title`, "Hey!"));
      expect(problem(raw)).toBe(`${RATE}.title: no exclamation marks. keep it flat`);
    });

    it("checks a rate's questions before its bands", () => {
      const raw = at(`${band(0)}.outcome.stamp`, "Hey!", at(`${RATE}.questions[2].question`, "Hey!"));
      expect(problem(raw)).toBe(`${RATE}.questions[2].question: no exclamation marks. keep it flat`);
    });
  });

  describe("depth", () => {
    it("passes ten gates and fails eleven", () => {
      expect(passes(ladder(10)).root).toMatchObject({ key: "g1", no: { key: "g2" } });
      expect(passes(ladder(10, "yes")).root).toMatchObject({ key: "g1", yes: { key: "g2" } });
      expect(problem(ladder(11))).toBe(`${TENTH}: ${TOO_DEEP}`);
    });

    it("does not count a rate leaf as a decision", () => {
      const raw = at(TENTH, rating("last", 2), ladder(10));
      expect(passes(raw).title).toBe("The Ladder Desk");
    });

    it("counts a route as a decision", () => {
      const raw = at(TENTH, fan(["a", "b"], (l) => end(`fan-${l}`)), ladder(10));
      expect(problem(raw)).toBe(`${TENTH}: ${TOO_DEEP}`);
    });

    it("adds a route to the depth of the decisions below it", () => {
      const raw = wrap(fan(["a", "b"], (l) => (l === "a" ? chain("g", 10) : end("b-end"))));
      expect(problem(raw)).toBe(`root.branches.a${".yes".repeat(9)}: ${TOO_DEEP}`);
    });

    it("measures each path on its own", () => {
      const raw = wrap(fan(["a", "b"], (l) => chain(l, 9)));
      expect(passes(raw).root.kind).toBe("route");
    });

    it("puts an unsure child one decision below its gate", () => {
      const extra = gate("extra", "Is there more?", end("extra-yes"), end("extra-no"));
      expect(problem(at(`${NINTH}.unsure`, extra, ladder(10)))).toBe(`${NINTH}.unsure: ${TOO_DEEP}`);
      expect(passes(at(`${NINTH}.unsure`, end("unsure-end"), ladder(10))).title).toBe("The Ladder Desk");
      expect(passes(at(`root${".no".repeat(8)}.unsure`, extra, ladder(10))).title).toBe("The Ladder Desk");
    });

    it("puts a lowConfidence child one decision below its route", () => {
      const extra = gate("extra", "Is there more?", end("extra-yes"), end("extra-no"));
      const tenth = (lowConfidence: RecipeNode) => fan(["a", "b"], (l) => end(`fan-${l}`), { lowConfidence });
      expect(problem(at(NINTH, tenth(extra), ladder(9)))).toBe(`${NINTH}.lowConfidence: ${TOO_DEEP}`);
      expect(passes(at(NINTH, tenth(end("fan-low")), ladder(9))).title).toBe("The Ladder Desk");
      expect(passes(at(NINTH, tenth(rating("fan-rate", 1)), ladder(9))).title).toBe("The Ladder Desk");
    });
  });

  describe("totals", () => {
    it("passes 40 nodes and fails 41", () => {
      // 5 + 2 * 18 = 41: two chains and two leaves.
      const fortyOne = fan(["a", "b", "c", "d"], (l) => (l === "a" || l === "b" ? chain(l, 9) : end(`${l}-end`)));
      expect(passes(wrap(forty())).root.kind).toBe("route");
      expect(problem(wrap(fortyOne))).toBe(`root: too many nodes. the limit is ${LIMITS.nodes}`);
    });

    it("does not count a rate's band outcomes as nodes", () => {
      // The leaf becomes a rate: still 40 nodes, plus band outcomes.
      const fourBands = rate("c-rate", [yesNo("c-q", "Is it c?", 1, true)], [
        [0.75, end("c-top")],
        [0.5, end("c-high")],
        [0.25, end("c-low")],
        [0, end("c-bottom")],
      ]);
      expect(passes(wrap(forty(fourBands))).root.kind).toBe("route");
      expect(passes(wrap(forty(rating("c-rate", 1)))).root.kind).toBe("route");
    });

    it("counts escape hatches as nodes", () => {
      expect(problem(wrap(forty(undefined, { lowConfidence: end("fan-low") })))).toBe(
        `root: too many nodes. the limit is ${LIMITS.nodes}`,
      );
      const unsure = at("branches.a.unsure", end("a1-unsure"), forty());
      expect(problem(wrap(unsure as RecipeNode))).toBe(`root: too many nodes. the limit is ${LIMITS.nodes}`);
      // One fewer leaf makes room for the hatch.
      const thirtyNine = fan(["a", "b"], (l) => chain(l, 9), { lowConfidence: end("fan-low") });
      expect(passes(wrap(thirtyNine)).root).toMatchObject({ lowConfidence: { key: "fan-low" } });
    });

    it("passes 30 questions and fails 31", () => {
      // The route asks one, each rate one per rated question.
      const sizes: Record<string, number> = { a: 6, b: 6, c: 6, d: 6, e: 5 };
      const thirty = fan(Object.keys(sizes), (l) => rating(`rate-${l}`, sizes[l]));
      expect(passes(wrap(thirty)).root.kind).toBe("route");

      const thirtyOne = fan(Object.keys(sizes), (l) => rating(`rate-${l}`, 6));
      expect(problem(wrap(thirtyOne))).toBe(`root: too many questions. the limit is ${LIMITS.questions}`);
    });

    it("counts a gate as one question", () => {
      const sizes: Record<string, number> = { a: 6, b: 6, c: 6, d: 6, e: 5 };
      const thirty = fan(Object.keys(sizes), (l) => rating(`rate-${l}`, sizes[l]));
      const raw = wrap(gate("top", "Is it on?", thirty, end("off")));
      expect(problem(raw)).toBe(`root: too many questions. the limit is ${LIMITS.questions}`);
    });

    it("does not count an escape hatch as a question", () => {
      const sizes: Record<string, number> = { a: 6, b: 6, c: 6, d: 6, e: 5 };
      const thirty = fan(Object.keys(sizes), (l) => rating(`rate-${l}`, sizes[l]), { lowConfidence: end("low") });
      expect(passes(wrap(thirty)).root.kind).toBe("route");
    });
  });

  describe("kinds", () => {
    it("rejects an unknown node kind, including v1's verdict", () => {
      const message = 'must be "gate", "route", "rate" or "outcome"';
      expect(problem(at("root.kind", "loop"))).toBe(`root.kind: ${message}`);
      expect(problem(at("root.yes.kind", undefined))).toBe(`root.yes.kind: ${message}`);
      expect(problem(at("root.no.kind", "verdict"))).toBe(`root.no.kind: ${message}`);
    });

    it("rejects an unknown rated question kind", () => {
      expect(problem(at(`${RATE}.questions[1].kind`, "slider"))).toBe(
        `${RATE}.questions[1].kind: must be "noul", "score" or "choice"`,
      );
    });

    it("rejects a node that is not an object", () => {
      expect(problem(at("root.yes.branches.calm", "It jevs."))).toBe("root.yes.branches.calm: must be an object");
      expect(problem(at(`${RATE}.questions[0]`, 3))).toBe(`${RATE}.questions[0]: must be an object`);
    });
  });

  describe("gates", () => {
    it("needs both children", () => {
      expect(problem(at("root.no", undefined))).toBe("root.no: missing. a gate needs both yes and no");
      expect(problem(at("root.yes", null))).toBe("root.yes: missing. a gate needs both yes and no");
    });

    it("needs a title", () => {
      expect(problem(at("root.title", undefined))).toBe("root.title: must be a string");
      expect(problem(at("root.title", " "))).toBe("root.title: must not be empty");
    });

    it("keeps means, and needs it to be an object with yes and no", () => {
      expect(passes(base()).root).toMatchObject({ means: { yes: "a table, ticket or room", no: "only intentions" } });
      const message = "must be an object with yes and no";
      for (const means of ["yes", ["a", "b"], 1, true]) {
        expect(problem(at("root.means", means)), String(means)).toBe(`root.means: ${message}`);
      }
      expect(problem(at("root.means.yes", undefined))).toBe("root.means.yes: must be a string");
      expect(problem(at("root.means.no", 2))).toBe("root.means.no: must be a string");
      expect(problem(at("root.means.no", ""))).toBe("root.means.no: must not be empty");
    });

    it("treats missing or null means as absent and leaves it out", () => {
      for (const means of [undefined, null]) {
        const root = passes(at("root.means", means)).root;
        expect(Object.hasOwn(root, "means"), String(means)).toBe(false);
      }
    });

    it("checks unsure as a node", () => {
      expect(problem(at("root.unsure", "Maybe"))).toBe("root.unsure: must be an object");
      expect(problem(at("root.unsure", false))).toBe("root.unsure: must be an object");
      expect(problem(at("root.unsure.kind", "maybe"))).toBe(
        'root.unsure.kind: must be "gate", "route", "rate" or "outcome"',
      );
      expect(problem(at("root.unsure.key", "Bad"))).toBe(
        `root.unsure.key: keys are lowercase letters, digits and dashes, up to ${CAPS.key} characters`,
      );
      const deeper = gate("again", "Ask again?", end("again-yes"), end("again-no"));
      expect(passes(at("root.unsure", deeper)).root).toMatchObject({ unsure: { kind: "gate", key: "again" } });
      expect(passes(at("root.unsure", rating("unsure-rate", 2))).root).toMatchObject({
        unsure: { kind: "rate", key: "unsure-rate" },
      });
    });

    it("treats missing or null unsure as absent and leaves it out", () => {
      for (const unsure of [undefined, null]) {
        const root = passes(at("root.unsure", unsure)).root;
        expect(Object.hasOwn(root, "unsure"), String(unsure)).toBe(false);
      }
    });
  });

  describe("routes", () => {
    it("needs a title", () => {
      expect(problem(at("root.yes.title", undefined))).toBe("root.yes.title: must be a string");
    });

    it("needs 2 to 6 labels", () => {
      const one = at("root.yes.branches.loud", undefined, at("root.yes.labels.loud", undefined));
      expect(problem(one)).toBe("root.yes.labels: needs 2 to 6 labels");

      const labels = Object.fromEntries("abcdefg".split("").map((l) => [l, `Way ${l}`]));
      const branches = Object.fromEntries("abcdefg".split("").map((l) => [l, end(`end-${l}`)]));
      const seven = wrap(route("r", "Which?", labels, branches));
      expect(problem(seven)).toBe("root.labels: needs 2 to 6 labels");

      const six = fan("abcdef".split(""), (l) => end(`end-${l}`));
      expect(passes(wrap(six)).root.kind).toBe("route");
    });

    it("needs a branch for every label and a label for every branch", () => {
      const two = { a: end("end-a"), b: end("end-b") };
      const labels = { a: "A", b: "B" };
      expect(problem(wrap(route("r", "Which?", labels, { a: two.a } as typeof two)))).toBe(
        'root.branches: missing branch "b"',
      );
      expect(problem(wrap(route("r", "Which?", labels, { ...two, c: end("end-c") } as typeof two)))).toBe(
        'root.branches: "c" is not a label',
      );
      expect(problem(at("root.yes.branches", undefined))).toBe("root.yes.branches: must be an object");
    });

    it("needs labels to be an object", () => {
      expect(problem(at("root.yes.labels", ["calm", "loud"]))).toBe("root.yes.labels: must be an object");
    });

    it("checks lowConfidence as a node", () => {
      expect(problem(at("root.yes.lowConfidence", "Dave"))).toBe("root.yes.lowConfidence: must be an object");
      expect(problem(at("root.yes.lowConfidence.kind", "dave"))).toBe(
        'root.yes.lowConfidence.kind: must be "gate", "route", "rate" or "outcome"',
      );
      const deeper = gate("again", "Ask again?", end("again-yes"), end("again-no"));
      expect(passes(at("root.yes.lowConfidence", deeper)).root).toMatchObject({
        yes: { lowConfidence: { kind: "gate", key: "again" } },
      });
    });

    it("treats missing or null lowConfidence as absent and leaves it out", () => {
      for (const lowConfidence of [undefined, null]) {
        const root = passes(at("root.yes.lowConfidence", lowConfidence)).root as RecipeGate;
        expect(Object.hasOwn(root.yes, "lowConfidence"), String(lowConfidence)).toBe(false);
      }
    });
  });

  describe("rates", () => {
    it("needs 1 to 6 questions", () => {
      expect(passes(wrap(rating("r", 1))).root.kind).toBe("rate");
      expect(passes(wrap(rating("r", 6))).root.kind).toBe("rate");
      expect(problem(wrap(rating("r", 0)))).toBe("root.questions: needs 1 to 6 questions");
      expect(problem(wrap(rating("r", 7)))).toBe("root.questions: needs 1 to 6 questions");
      expect(problem(at(`${RATE}.questions`, "friends"))).toBe(`${RATE}.questions: must be a list`);
    });

    it("needs a title", () => {
      expect(problem(at(`${RATE}.title`, undefined))).toBe(`${RATE}.title: must be a string`);
    });
  });

  describe("bands", () => {
    const withBands = (bands: unknown) => at(`${RATE}.bands`, bands);
    const pairs = (...values: number[]) => values.map((atLeast, i) => ({ atLeast, outcome: end(`band-${i}`) }));

    it("needs a list of 2 to 4 bands", () => {
      expect(problem(withBands(undefined))).toBe(`${RATE}.bands: must be a list`);
      expect(problem(withBands({ 0: pairs(0)[0] }))).toBe(`${RATE}.bands: must be a list`);
      expect(problem(withBands([]))).toBe(`${RATE}.bands: needs 2 to 4 bands`);
      expect(problem(withBands(pairs(0)))).toBe(`${RATE}.bands: needs 2 to 4 bands`);
      expect(problem(withBands(pairs(0.8, 0.6, 0.4, 0.2, 0)))).toBe(`${RATE}.bands: needs 2 to 4 bands`);
      expect(passes(withBands(pairs(0.5, 0))).title).toBeTruthy();
      expect(passes(withBands(pairs(0.75, 0.5, 0.25, 0))).title).toBeTruthy();
    });

    it("needs each band to be an object", () => {
      expect(problem(withBands([pairs(0.5)[0], "low"]))).toBe(`${band(1)}: must be an object`);
      expect(problem(withBands([[0.5, end("x")], pairs(0)[0]]))).toBe(`${band(0)}: must be an object`);
    });

    it("needs atLeast to be a number from 0 to 1", () => {
      const message = "must be a number from 0 to 1";
      for (const value of [-0.01, 1.01, Number.NaN, Number.POSITIVE_INFINITY, "0.5", null, undefined]) {
        expect(problem(at(`${band(0)}.atLeast`, value)), String(value)).toBe(`${band(0)}.atLeast: ${message}`);
      }
      expect(passes(withBands(pairs(1, 0))).title).toBeTruthy();
    });

    it("needs bands strictly highest first", () => {
      const message = "must be lower than the band before it. bands go highest first";
      expect(problem(at(`${band(1)}.atLeast`, 0.66))).toBe(`${band(1)}.atLeast: ${message}`);
      expect(problem(at(`${band(1)}.atLeast`, 0.9))).toBe(`${band(1)}.atLeast: ${message}`);
      expect(problem(withBands(pairs(0, 0)))).toBe(`${band(1)}.atLeast: ${message}`);
    });

    it("needs the last band at exactly 0", () => {
      const message = "must be 0 on the last band";
      expect(problem(at(`${band(2)}.atLeast`, 0.1))).toBe(`${band(2)}.atLeast: ${message}`);
      expect(problem(withBands(pairs(0.9, 0.001)))).toBe(`${band(1)}.atLeast: ${message}`);
    });

    it("needs each band's outcome to be an outcome", () => {
      const message = 'must be an object with kind "outcome"';
      expect(problem(at(`${band(0)}.outcome`, undefined))).toBe(`${band(0)}.outcome: ${message}`);
      expect(problem(at(`${band(0)}.outcome`, "Go"))).toBe(`${band(0)}.outcome: ${message}`);
      expect(problem(at(`${band(0)}.outcome.kind`, undefined))).toBe(`${band(0)}.outcome: ${message}`);
      const nested = gate("nested", "Is it nested?", end("nested-yes"), end("nested-no"));
      expect(problem(at(`${band(1)}.outcome`, nested))).toBe(`${band(1)}.outcome: ${message}`);
    });

    it("checks a band outcome's fields", () => {
      expect(problem(at(`${band(0)}.outcome.stamp`, undefined))).toBe(`${band(0)}.outcome.stamp: must be a string`);
      expect(problem(at(`${band(2)}.outcome.line`, " "))).toBe(`${band(2)}.outcome.line: must not be empty`);
    });
  });

  describe("outcomes", () => {
    it("needs a key, a stamp and a line", () => {
      expect(problem(at("root.no.key", undefined))).toBe("root.no.key: must be a string");
      expect(problem(at("root.no.stamp", undefined))).toBe("root.no.stamp: must be a string");
      expect(problem(at("root.no.line", 3))).toBe("root.no.line: must be a string");
      expect(problem(at("root.no.line", ""))).toBe("root.no.line: must not be empty");
    });
  });

  describe("rated questions", () => {
    const q = (i: number) => `${RATE}.questions[${i}]`;

    it("needs a positive weight up to 10", () => {
      const message = "must be a positive number up to 10";
      for (const weight of [0, -1, 10.01, Number.NaN, Number.POSITIVE_INFINITY, "2", undefined]) {
        expect(problem(at(`${q(0)}.weight`, weight)), String(weight)).toBe(`${q(0)}.weight: ${message}`);
      }
      for (const weight of [0.1, 10]) {
        expect(passes(at(`${q(0)}.weight`, weight)).title).toBe("The Plan Dispatch Desk");
      }
    });

    it("needs a yes/no good to be true or false", () => {
      expect(problem(at(`${q(0)}.good`, "yes"))).toBe(`${q(0)}.good: must be true or false`);
    });

    it("needs a score to have 2 to 5 levels", () => {
      expect(problem(at(`${q(1)}.levels`, ["one"]))).toBe(`${q(1)}.levels: needs 2 to 5 levels`);
      const six = ["a", "b", "c", "d", "e", "f"];
      expect(problem(at(`${q(1)}.levels`, six))).toBe(`${q(1)}.levels: needs 2 to 5 levels`);
      expect(problem(at(`${q(1)}.levels`, "cheap"))).toBe(`${q(1)}.levels: must be a list`);
      expect(passes(at(`${q(1)}.levels`, ["a", "b"])).title).toBeTruthy();
      expect(passes(at(`${q(1)}.levels`, ["a", "b", "c", "d", "e"])).title).toBeTruthy();
    });

    it("needs a score good to be high or low", () => {
      expect(problem(at(`${q(1)}.good`, "middle"))).toBe(`${q(1)}.good: must be "high" or "low"`);
    });

    it("needs a choice to have 2 to 6 labels", () => {
      expect(problem(at(`${q(2)}.labels`, { home: "At home" }))).toBe(`${q(2)}.labels: needs 2 to 6 labels`);
      const seven = Object.fromEntries(["home", ..."abcdef".split("")].map((l) => [l, `At ${l}`]));
      expect(problem(at(`${q(2)}.labels`, seven))).toBe(`${q(2)}.labels: needs 2 to 6 labels`);
    });

    it("needs a choice good to be a non-empty list of its labels", () => {
      expect(problem(at(`${q(2)}.good`, ["home", "x"]))).toBe(`${q(2)}.good: "x" is not a label`);
      expect(problem(at(`${q(2)}.good`, []))).toBe(`${q(2)}.good: needs at least one label`);
      expect(problem(at(`${q(2)}.good`, "home"))).toBe(`${q(2)}.good: must be a list`);
      expect(problem(at(`${q(2)}.good`, ["home", 1]))).toBe(`${q(2)}.good[1]: must be a string`);
    });

    it("removes duplicates from a choice good", () => {
      const clean = passes(at(`${q(2)}.good`, ["home", "out", " home ", "home"]));
      const { yes } = clean.root as RecipeGate;
      const { loud } = (yes as RecipeRoute).branches;
      expect((loud as RecipeRate).questions[2]).toMatchObject({ kind: "choice", good: ["home", "out"] });
    });
  });

  describe("keys", () => {
    const rule = `keys are lowercase letters, digits and dashes, up to ${CAPS.key} characters`;

    it("needs node keys to be lowercase kebab case up to 32 characters", () => {
      for (const key of ["Vibe", "the_vibe", "the vibe", "", "a".repeat(33)]) {
        expect(problem(at("root.yes.key", key)), key).toBe(`root.yes.key: ${rule}`);
      }
      expect(problem(at("root.yes.key", 7))).toBe("root.yes.key: must be a string");
      expect(passes(at("root.yes.key", `v-2-${"a".repeat(28)}`)).title).toBeTruthy();
    });

    it("applies the same rule to rated question keys and outcome keys", () => {
      expect(problem(at(`${RATE}.questions[0].key`, "Friends"))).toBe(`${RATE}.questions[0].key: ${rule}`);
      expect(problem(at("root.no.key", "Not_booked"))).toBe(`root.no.key: ${rule}`);
      expect(problem(at(`${band(1)}.outcome.key`, "a".repeat(33)))).toBe(`${band(1)}.outcome.key: ${rule}`);
      expect(problem(at(`${band(1)}.outcome.key`, 1))).toBe(`${band(1)}.outcome.key: must be a string`);
    });

    it("rejects a node key used twice", () => {
      expect(problem(at("root.yes.key", "booked"))).toBe('root.yes.key: "booked" is used twice');
    });

    const twice: [what: string, path: string, key: string][] = [
      ["a tree outcome after a node", "root.no.key", "vibe"],
      ["a node after a tree outcome", `${RATE}.key`, "early"],
      ["a tree outcome after a tree outcome", "root.no.key", "early"],
      ["a band outcome after a node", `${band(0)}.outcome.key`, "booked"],
      ["a band outcome after its own rate", `${band(0)}.outcome.key`, "loud-rating"],
      ["a band outcome after a tree outcome", `${band(0)}.outcome.key`, "early"],
      ["a band outcome after a band outcome", `${band(2)}.outcome.key`, "go"],
      ["a band outcome after a rated question", `${band(0)}.outcome.key`, "friends"],
      ["a tree outcome after a band outcome", "root.no.key", "maybe"],
      ["a node after a band outcome", "root.no", "stay-in"],
      ["a rated question after a node", `${RATE}.questions[0].key`, "vibe"],
      ["a rated question after a rated question", `${RATE}.questions[2].key`, "friends"],
      ["a rated question after its own rate", `${RATE}.questions[0].key`, "loud-rating"],
      ["a rated question after a tree outcome", `${RATE}.questions[1].key`, "early"],
      ["a lowConfidence outcome after a band outcome", "root.yes.lowConfidence.key", "go"],
      ["an unsure outcome after a tree outcome", "root.unsure.key", "unbooked"],
      ["an unsure outcome after a band outcome", "root.unsure.key", "stay-in"],
    ];

    it.each(twice)("shares one namespace: %s", (_, path, key) => {
      if (path === "root.no") {
        // Swap the no outcome for a gate that reuses a band outcome key.
        const node = gate(key, "Is it later?", end("later-yes"), end("later-no"));
        expect(problem(at(path, node))).toBe(`root.no.key: "${key}" is used twice`);
        return;
      }
      expect(problem(at(path, key))).toBe(`${path}: "${key}" is used twice`);
    });

    it("compares keys after trimming", () => {
      expect(problem(at("root.yes.key", " booked "))).toBe('root.yes.key: "booked" is used twice');
      expect(problem(at(`${band(1)}.outcome.key`, " go\n"))).toBe(`${band(1)}.outcome.key: "go" is used twice`);
    });
  });

  describe("labels", () => {
    const rule = "labels are lowercase letters, digits and dashes, up to 40 characters";

    it("rejects a bad route label", () => {
      const labelled = at("root.yes.labels.Very Bad", "Bad");
      const raw = at("root.yes.branches.Very Bad", end("very-bad"), labelled);
      expect(problem(raw)).toBe(`root.yes.labels.Very Bad: ${rule}`);
    });

    it("rejects a bad choice label", () => {
      expect(problem(at(`${RATE}.questions[2].labels.out_side`, "Outside"))).toBe(
        `${RATE}.questions[2].labels.out_side: ${rule}`,
      );
    });

    it("allows labels up to 40 characters", () => {
      const long = "a".repeat(40);
      const tooLong = "a".repeat(41);
      expect(passes(at(`${RATE}.questions[2].labels.${long}`, "Far")).title).toBeTruthy();
      expect(problem(at(`${RATE}.questions[2].labels.${tooLong}`, "Far"))).toBe(
        `${RATE}.questions[2].labels.${tooLong}: ${rule}`,
      );
      const labelled = at(`root.yes.labels.${long}`, "Far");
      const route40 = at(`root.yes.branches.${long}`, end("far"), labelled);
      expect(passes(route40).title).toBeTruthy();
    });
  });

  describe("strings", () => {
    const caps: [path: string, cap: number][] = [
      ["recipe.title", CAPS.title],
      ["recipe.thing", CAPS.thing],
      ["root.title", CAPS.nodeTitle],
      ["root.yes.title", CAPS.nodeTitle],
      [`${RATE}.title`, CAPS.nodeTitle],
      ["root.question", CAPS.question],
      ["root.yes.question", CAPS.question],
      [`${RATE}.questions[0].question`, CAPS.question],
      ["root.means.yes", CAPS.means],
      ["root.means.no", CAPS.means],
      ["root.yes.labels.calm", CAPS.labelDescription],
      [`${RATE}.questions[2].labels.home`, CAPS.labelDescription],
      [`${RATE}.questions[1].levels[0]`, CAPS.level],
      ["root.no.stamp", CAPS.stamp],
      ["root.no.line", CAPS.line],
      ["root.unsure.stamp", CAPS.stamp],
      ["root.yes.lowConfidence.line", CAPS.line],
      [`${band(0)}.outcome.stamp`, CAPS.stamp],
      [`${band(2)}.outcome.line`, CAPS.line],
    ];

    it("uses the caps the contract names", () => {
      expect([CAPS.title, CAPS.thing, CAPS.nodeTitle, CAPS.question, CAPS.means]).toEqual([80, 60, 40, 200, 120]);
      expect([CAPS.labelDescription, CAPS.level, CAPS.stamp, CAPS.line]).toEqual([120, 40, 32, 160]);
    });

    it.each(caps)("caps %s at %i characters, after trimming", (path, cap) => {
      expect(passes(at(path, ` ${"x".repeat(cap)} `)).title).toBeTruthy();
      const message = `too long. the limit is ${cap} characters`;
      expect(problem(at(path, "x".repeat(cap + 1)))).toBe(`${path}: ${message}`);
    });

    it("needs strings to be strings and not empty", () => {
      expect(problem(at("recipe.title", 5))).toBe("recipe.title: must be a string");
      expect(problem(at("recipe.thing", undefined))).toBe("recipe.thing: must be a string");
      expect(problem(at("root.question", "   "))).toBe("root.question: must not be empty");
      expect(problem(at(`${RATE}.questions[1].levels[2]`, null))).toBe(
        `${RATE}.questions[1].levels[2]: must be a string`,
      );
    });

    const every = [
      "recipe.title",
      "recipe.thing",
      "root.title",
      "root.question",
      "root.means.yes",
      "root.means.no",
      "root.yes.title",
      "root.yes.question",
      "root.yes.labels.loud",
      "root.yes.branches.calm.stamp",
      "root.yes.branches.calm.line",
      `${RATE}.title`,
      `${RATE}.questions[0].question`,
      `${RATE}.questions[1].question`,
      `${RATE}.questions[1].levels[2]`,
      `${RATE}.questions[2].question`,
      `${RATE}.questions[2].labels.out`,
      `${band(0)}.outcome.stamp`,
      `${band(0)}.outcome.line`,
      `${band(1)}.outcome.stamp`,
      `${band(1)}.outcome.line`,
      `${band(2)}.outcome.stamp`,
      `${band(2)}.outcome.line`,
      "root.yes.lowConfidence.stamp",
      "root.yes.lowConfidence.line",
      "root.no.stamp",
      "root.no.line",
      "root.unsure.stamp",
      "root.unsure.line",
    ];
    const bad: [text: string, message: string][] = [
      ["It jevs!", "no exclamation marks. keep it flat"],
      ["It jevs. \u{1F389}", "no emoji"],
      ["lol it jevs.", "no lol"],
      ["It jevs for {{input}}.", "no {{ }}. jevchain would read it as a template"],
    ];

    it.each(every)("holds %s to the tone and template rules", (path) => {
      for (const [text, message] of bad) {
        expect(problem(at(path, text)), text).toBe(`${path}: ${message}`);
      }
    });

    it("holds keys and label names to the tone rule", () => {
      expect(problem(at("root.yes.key", "lol"))).toBe("root.yes.key: no lol");
      expect(problem(at(`${RATE}.questions[0].key`, "lol-q"))).toBe(`${RATE}.questions[0].key: no lol`);
      expect(problem(at("root.no.key", "lmao"))).toBe("root.no.key: no lol");
      expect(problem(at(`${band(0)}.outcome.key`, "lol-high"))).toBe(`${band(0)}.outcome.key: no lol`);
      const labelled = at("root.yes.labels.lmao", "Loud");
      const raw = at("root.yes.branches.lmao", end("lmao-end"), labelled);
      expect(problem(raw)).toBe("root.yes.labels.lmao: no lol");
      expect(problem(at(`${RATE}.questions[2].labels.lol`, "Far"))).toBe(
        `${RATE}.questions[2].labels.lol: no lol`,
      );
    });

    it("allows a lone brace", () => {
      const clean = passes(at("root.question", "Is {this} fine?"));
      expect(clean.root).toMatchObject({ question: "Is {this} fine?" });
    });
  });
});
