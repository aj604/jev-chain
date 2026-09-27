import { describe, expect, it } from "vitest";
import { ladder } from "@/test/fixtures";
import { gate, pick, rate, recipe, route, scale, verdict, yesNo } from "./build";
import type { Recipe, RecipeGate, RecipeNode, RecipeRate, RecipeRoute } from "./types";
import { validateRecipe } from "./validate";

/** A gate, a route, a rate with every question kind, and verdicts. */
function base(): Recipe {
  return recipe(
    "Will your plan jev?",
    "your plan",
    gate(
      "booked",
      "Is anything booked?",
      "yes",
      route(
        "vibe",
        "What is the vibe?",
        { calm: "A quiet night", loud: "A loud night" },
        {
          calm: verdict("jevs", "It jevs. Sleep well."),
          loud: rate(
            "loud-rating",
            [
              yesNo("friends", "Are friends coming?", 2, true),
              scale("cost", "How expensive is it?", 1, ["cheap", "fine", "steep"], "low"),
              pick("where", "Where is it?", 1, { home: "At home", out: "Out somewhere" }, ["home"]),
            ],
            { jevs: "It jevs. Go.", kinda: "It sort of jevs. Maybe.", nope: "It does not jev. Stay in." },
          ),
        },
      ),
      verdict("nope", "It does not jev. Book something."),
    ),
  );
}

const RATE = "root.then.branches.loud";
/** Where an eleventh gate sits, down a ladder's then side. */
const TENTH = `root${".then".repeat(10)}`;
const TOO_DEEP = "too deep. the limit is 10 decisions on any path";

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

/** `n` nested gates keyed `<prefix>1`..`<prefix>n`, each ending otherwise at a verdict. */
function chain(prefix: string, n: number, leaf: RecipeNode): RecipeNode {
  let node = leaf;
  for (let i = n; i >= 1; i--) {
    const stop = verdict("nope", "It does not jev.");
    node = gate(`${prefix}${i}`, `Question ${prefix} ${i}?`, "yes", node, stop);
  }
  return node;
}

function rating(key: string, count: number): RecipeNode {
  const questions = Array.from({ length: count }, (_, i) => yesNo(`${key}-q${i}`, `Question ${i}?`, 1, true));
  return rate(key, questions, { jevs: "It jevs.", kinda: "It sort of jevs.", nope: "It does not jev." });
}

function fan(labels: string[], branch: (label: string) => RecipeNode): RecipeNode {
  return route(
    "fan",
    "Which way?",
    Object.fromEntries(labels.map((l) => [l, `Way ${l}`])),
    Object.fromEntries(labels.map((l) => [l, branch(l)])),
  );
}

const wrap = (root: RecipeNode) => recipe("Will it jev?", "it", root);

describe("validateRecipe", () => {
  it("passes a recipe that uses every node and question kind", () => {
    expect(passes(base())).toEqual(base());
  });

  it("returns a plain copy, not the input", () => {
    const raw = base();
    const clean = passes(raw);
    expect(clean).not.toBe(raw);
    expect(clean.root).not.toBe(raw.root);
  });

  it("trims every string and returns ok", () => {
    // Pads text, keys and choice labels. Enum values (kind, tier, pass, a score's good) must match exactly.
    const exact = (field: string, value: unknown) =>
      ["kind", "tier", "pass"].includes(field) || (field === "good" && typeof value === "string");
    const pad = (value: unknown): unknown =>
      typeof value === "string"
        ? `  ${value}\n`
        : Array.isArray(value)
          ? value.map(pad)
          : typeof value === "object" && value !== null
            ? Object.fromEntries(Object.entries(value).map(([k, v]) => [k, exact(k, v) ? v : pad(v)]))
            : value;
    const padded = pad(base()) as Recipe;
    expect(padded.title).toBe("  Will your plan jev?\n");
    expect(padded.root).toMatchObject({ key: "  booked\n", pass: "yes" });
    expect(validateRecipe(padded)).toEqual({ ok: true, recipe: base() });
  });

  it("does not trim enum values", () => {
    expect(problem(at("root.kind", " gate"))).toBe('root.kind: must be "gate", "route", "rate" or "verdict"');
    expect(problem(at("root.pass", "yes "))).toBe('root.pass: must be "yes" or "no"');
  });

  it("drops fields it does not know", () => {
    const raw = at("root.extra", "x", at("recipe.extra", 1));
    expect(passes(raw)).toEqual(base());
  });

  describe("the envelope", () => {
    it("rejects anything that is not an object", () => {
      for (const raw of [undefined, null, "recipe", 3, [], true]) {
        expect(problem(raw)).toBe("recipe: must be an object");
      }
    });

    it("rejects any v but 1", () => {
      expect(problem(at("recipe.v", 2))).toBe("recipe.v: must be 1");
      expect(problem(at("recipe.v", "1"))).toBe("recipe.v: must be 1");
      expect(problem(at("recipe.v", undefined))).toBe("recipe.v: must be 1");
    });

    it("checks v before title, and title before the tree", () => {
      const raw = at("root.key", "Bad", at("recipe.title", "Hey!", at("recipe.v", 2)));
      expect(problem(raw)).toBe("recipe.v: must be 1");
      expect(problem(at("recipe.v", 1, raw))).toBe("recipe.title: no exclamation marks. keep it flat");
    });

    it("needs a root node", () => {
      expect(problem(at("root", undefined))).toBe("root: must be an object");
      expect(problem(at("root", []))).toBe("root: must be an object");
    });
  });

  describe("depth", () => {
    it("passes ten gates and fails eleven", () => {
      expect(passes(ladder(10)).root).toMatchObject({ key: "g1" });
      expect(passes(ladder(10, "yes")).root).toMatchObject({ pass: "yes" });
      expect(problem(ladder(11))).toBe(`${TENTH}: ${TOO_DEEP}`);
    });

    it("does not count a rate leaf as a decision", () => {
      const raw = at(TENTH, rating("last", 2), ladder(10));
      expect(passes(raw).title).toBe("Will the ladder jev?");
    });

    it("counts a route as a decision", () => {
      const raw = at(TENTH, fan(["a", "b"], () => verdict("jevs", "It jevs.")), ladder(10));
      expect(problem(raw)).toBe(`${TENTH}: ${TOO_DEEP}`);
    });

    it("measures each path on its own", () => {
      const raw = wrap(fan(["a", "b"], (l) => chain(l, 9, verdict("jevs", "It jevs."))));
      expect(passes(raw).root.kind).toBe("route");
    });
  });

  describe("totals", () => {
    it("passes 40 nodes and fails 41", () => {
      const leaf = verdict("jevs", "It jevs.");
      // 4 + 2 * 18 = 40 nodes, and 5 + 2 * 18 = 41, both 10 deep.
      const forty = fan(["a", "b", "c"], (l) => (l === "c" ? leaf : chain(l, 9, leaf)));
      const fortyOne = fan(["a", "b", "c", "d"], (l) => (l === "a" || l === "b" ? chain(l, 9, leaf) : leaf));
      expect(passes(wrap(forty)).root.kind).toBe("route");
      expect(problem(wrap(fortyOne))).toBe("root: too many nodes. the limit is 40");
    });

    it("passes 30 questions and fails 31", () => {
      // The route asks one, each rate one per rated question.
      const sizes: Record<string, number> = { a: 6, b: 6, c: 6, d: 6, e: 5 };
      const thirty = fan(Object.keys(sizes), (l) => rating(`rate-${l}`, sizes[l]));
      expect(passes(wrap(thirty)).root.kind).toBe("route");

      const thirtyOne = fan(Object.keys(sizes), (l) => rating(`rate-${l}`, 6));
      expect(problem(wrap(thirtyOne))).toBe("root: too many questions. the limit is 30");
    });

    it("counts a gate as one question", () => {
      const sizes: Record<string, number> = { a: 6, b: 6, c: 6, d: 6, e: 5 };
      const thirty = fan(Object.keys(sizes), (l) => rating(`rate-${l}`, sizes[l]));
      const raw = wrap(gate("top", "Is it on?", "yes", thirty, verdict("nope", "It does not jev.")));
      expect(problem(raw)).toBe("root: too many questions. the limit is 30");
    });
  });

  describe("kinds and tiers", () => {
    it("rejects an unknown node kind", () => {
      const message = 'must be "gate", "route", "rate" or "verdict"';
      expect(problem(at("root.kind", "loop"))).toBe(`root.kind: ${message}`);
      expect(problem(at("root.then.kind", undefined))).toBe(`root.then.kind: ${message}`);
    });

    it("rejects an unknown rated question kind", () => {
      expect(problem(at(`${RATE}.questions[1].kind`, "slider"))).toBe(
        `${RATE}.questions[1].kind: must be "noul", "score" or "choice"`,
      );
    });

    it("rejects a bad tier", () => {
      expect(problem(at("root.otherwise.tier", "maybe"))).toBe(
        "root.otherwise.tier: must be one of jevs, kinda, nope",
      );
    });

    it("rejects a node that is not an object", () => {
      expect(problem(at("root.then.branches.calm", "It jevs."))).toBe(
        "root.then.branches.calm: must be an object",
      );
      expect(problem(at(`${RATE}.questions[0]`, 3))).toBe(`${RATE}.questions[0]: must be an object`);
    });
  });

  describe("gates", () => {
    it("needs both children", () => {
      expect(problem(at("root.otherwise", undefined))).toBe(
        "root.otherwise: missing. a gate needs both then and otherwise",
      );
      expect(problem(at("root.then", null))).toBe("root.then: missing. a gate needs both then and otherwise");
    });

    it("needs pass to be yes or no", () => {
      expect(problem(at("root.pass", "maybe"))).toBe('root.pass: must be "yes" or "no"');
      expect(problem(at("root.pass", undefined))).toBe('root.pass: must be "yes" or "no"');
      expect(problem(at("root.pass", true))).toBe('root.pass: must be "yes" or "no"');
    });
  });

  describe("routes", () => {
    it("needs 2 to 6 labels", () => {
      const one = at("root.then.branches.loud", undefined, at("root.then.labels.loud", undefined));
      expect(problem(one)).toBe("root.then.labels: needs 2 to 6 labels");

      const labels = Object.fromEntries("abcdefg".split("").map((l) => [l, `Way ${l}`]));
      const branches = Object.fromEntries("abcdefg".split("").map((l) => [l, verdict("jevs", "It jevs.")]));
      const seven = wrap(route("r", "Which?", labels, branches));
      expect(problem(seven)).toBe("root.labels: needs 2 to 6 labels");

      const six = fan("abcdef".split(""), () => verdict("jevs", "It jevs."));
      expect(passes(wrap(six)).root.kind).toBe("route");
    });

    it("needs a branch for every label and a label for every branch", () => {
      const two = { a: verdict("jevs", "It jevs."), b: verdict("nope", "It does not jev.") };
      const labels = { a: "A", b: "B" };
      expect(problem(wrap(route("r", "Which?", labels, { a: two.a } as typeof two)))).toBe(
        'root.branches: missing branch "b"',
      );
      expect(problem(wrap(route("r", "Which?", labels, { ...two, c: two.a } as typeof two)))).toBe(
        'root.branches: "c" is not a label',
      );
      expect(problem(at("root.then.branches", undefined))).toBe("root.then.branches: must be an object");
    });

    it("needs labels to be an object", () => {
      expect(problem(at("root.then.labels", ["calm", "loud"]))).toBe("root.then.labels: must be an object");
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

    it("needs all three tier lines", () => {
      expect(problem(at(`${RATE}.verdicts.kinda`, undefined))).toBe(
        `${RATE}.verdicts.kinda: must be a string`,
      );
      expect(problem(at(`${RATE}.verdicts`, undefined))).toBe(`${RATE}.verdicts: must be an object`);
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
        expect(passes(at(`${q(0)}.weight`, weight)).title).toBe("Will your plan jev?");
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
      const { then } = clean.root as RecipeGate;
      const { loud } = (then as RecipeRoute).branches;
      expect((loud as RecipeRate).questions[2]).toMatchObject({ kind: "choice", good: ["home", "out"] });
    });
  });

  describe("keys", () => {
    const rule = "keys are lowercase letters, digits and dashes, up to 32 characters";

    it("needs node keys to be lowercase kebab case up to 32 characters", () => {
      for (const key of ["Vibe", "the_vibe", "the vibe", "", "a".repeat(33)]) {
        expect(problem(at("root.then.key", key)), key).toBe(`root.then.key: ${rule}`);
      }
      expect(problem(at("root.then.key", 7))).toBe("root.then.key: must be a string");
      expect(passes(at("root.then.key", `v-2-${"a".repeat(28)}`)).title).toBeTruthy();
    });

    it("applies the same rule to rated question keys", () => {
      expect(problem(at(`${RATE}.questions[0].key`, "Friends"))).toBe(`${RATE}.questions[0].key: ${rule}`);
    });

    it("rejects a node key used twice", () => {
      expect(problem(at("root.then.key", "booked"))).toBe('root.then.key: "booked" is used twice');
    });

    it("shares one namespace between node keys and rated question keys", () => {
      expect(problem(at(`${RATE}.questions[0].key`, "vibe"))).toBe(
        `${RATE}.questions[0].key: "vibe" is used twice`,
      );
      expect(problem(at(`${RATE}.questions[2].key`, "friends"))).toBe(
        `${RATE}.questions[2].key: "friends" is used twice`,
      );
      expect(problem(at(`${RATE}.questions[0].key`, "loud-rating"))).toBe(
        `${RATE}.questions[0].key: "loud-rating" is used twice`,
      );
    });

    it("compares keys after trimming", () => {
      expect(problem(at("root.then.key", " booked "))).toBe('root.then.key: "booked" is used twice');
    });
  });

  describe("labels", () => {
    const rule = "labels are lowercase letters, digits and dashes, up to 40 characters";

    it("rejects a bad route label", () => {
      const labelled = at("root.then.labels.Very Bad", "Bad");
      const raw = at("root.then.branches.Very Bad", verdict("nope", "It does not jev."), labelled);
      expect(problem(raw)).toBe(`root.then.labels.Very Bad: ${rule}`);
    });

    it("rejects a bad choice label", () => {
      expect(problem(at(`${RATE}.questions[2].labels.out_side`, "Outside"))).toBe(
        `${RATE}.questions[2].labels.out_side: ${rule}`,
      );
    });

    it("allows labels up to 40 characters", () => {
      const forty = "a".repeat(40);
      const fortyOne = "a".repeat(41);
      expect(passes(at(`${RATE}.questions[2].labels.${forty}`, "Far")).title).toBeTruthy();
      expect(problem(at(`${RATE}.questions[2].labels.${fortyOne}`, "Far"))).toBe(
        `${RATE}.questions[2].labels.${fortyOne}: ${rule}`,
      );
      const labelled = at(`root.then.labels.${forty}`, "Far");
      const route40 = at(`root.then.branches.${forty}`, verdict("jevs", "It jevs."), labelled);
      expect(passes(route40).title).toBeTruthy();
    });
  });

  describe("strings", () => {
    const caps: [path: string, cap: number][] = [
      ["recipe.title", 80],
      ["recipe.thing", 60],
      ["root.question", 200],
      [`${RATE}.questions[0].question`, 200],
      ["root.then.labels.calm", 120],
      [`${RATE}.questions[2].labels.home`, 120],
      [`${RATE}.questions[1].levels[0]`, 40],
      ["root.otherwise.line", 140],
      [`${RATE}.verdicts.jevs`, 140],
      [`${RATE}.verdicts.nope`, 140],
    ];

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
      "root.question",
      "root.then.question",
      "root.then.labels.loud",
      "root.then.branches.calm.line",
      `${RATE}.questions[0].question`,
      `${RATE}.questions[1].question`,
      `${RATE}.questions[1].levels[2]`,
      `${RATE}.questions[2].question`,
      `${RATE}.questions[2].labels.out`,
      `${RATE}.verdicts.jevs`,
      `${RATE}.verdicts.kinda`,
      `${RATE}.verdicts.nope`,
      "root.otherwise.line",
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

    it("allows a lone brace", () => {
      const clean = passes(at("root.question", "Is {this} fine?"));
      expect(clean.root).toMatchObject({ question: "Is {this} fine?" });
    });
  });
});
