import {
  chainIssues,
  fromJSON,
  run,
  toJSON,
  toTypeScript,
  walk,
  type AnyNode,
  type AskNode,
  type EmitNode,
  type GateNode,
  type RouteNode,
} from "jevchain";
import { describe, expect, it } from "vitest";
import { byQuestion, fakeJev } from "@/test/fake-jev";
import { ladder } from "@/test/fixtures";
import { gate, pick, rate, recipe, route, scale, verdict, yesNo } from "./build";
import { compileRecipe } from "./compile";
import type { Recipe, RecipeNode } from "./types";
import { validateRecipe } from "./validate";

const VERDICTS = { jevs: "It jevs.", kinda: "It sort of jevs.", nope: "It does not jev." };

/** Validated, so every test compiles a recipe the site could actually get. */
function valid(root: RecipeNode): Recipe {
  const check = validateRecipe(recipe("Will it jev?", "it", root));
  if (!check.ok) throw new Error(check.message);
  return check.recipe;
}

/** A route over a gate and a rate with every question kind. */
function mixed(): Recipe {
  return valid(
    route(
      "vibe",
      "What is the vibe?",
      { calm: "A quiet night", loud: "A loud night" },
      {
        calm: gate("booked", "Is anything booked?", "yes", verdict("jevs", "It jevs. Go."), verdict("nope", "Book something.")),
        loud: rate(
          "loud",
          [
            yesNo("friends", "Are friends coming?", 2, true),
            scale("cost", "How expensive is it?", 1, ["cheap", "fine", "steep"], "low"),
            pick("where", "Where is it?", 1, { home: "At home", out: "Out somewhere" }, ["home"]),
          ],
          VERDICTS,
        ),
      },
    ),
  );
}

function ids(root: AnyNode): string[] {
  const out: string[] = [];
  walk(root, (node) => {
    out.push(node.id);
  });
  return out;
}

function expectUniqueIds(root: AnyNode) {
  const all = ids(root);
  expect(new Set(all).size).toBe(all.length);
}

/** Round-trips through JSON and expects a clean, handler-free chain. */
function expectPortable(root: AnyNode) {
  const doc = toJSON(root);
  expect(doc.refs).toEqual([]);
  const loaded = fromJSON(JSON.parse(JSON.stringify(doc)));
  expect(chainIssues(loaded)).toEqual([]);
  expect(toJSON(loaded)).toEqual(doc);
}

describe("compileRecipe", () => {
  it("maps a yes gate to a noul at min 0.5", () => {
    const node = compileRecipe(
      valid(gate("booked", "Is anything booked?", "yes", verdict("jevs", "Yes."), verdict("nope", "No."))),
    ) as GateNode;
    expect(node).toMatchObject({
      kind: "gate",
      id: "booked",
      title: "Is anything booked?",
      ask: { type: "noul", instructions: "Is anything booked?" },
      pass: { min: 0.5 },
      then: { kind: "emit", id: "booked-then" },
      otherwise: { kind: "emit", id: "booked-otherwise" },
    });
    expect(node.pass).toEqual({ min: 0.5 });
    expect(node.ask).toEqual({ type: "noul", instructions: "Is anything booked?" });
    expect(node.unsure).toBeUndefined();
  });

  it("maps a no gate to a noul at max 0.5", () => {
    const node = compileRecipe(
      valid(gate("late", "Is it late?", "no", verdict("jevs", "Yes."), verdict("nope", "No."))),
    ) as GateNode;
    expect(node).toMatchObject({ kind: "gate", id: "late", title: "Is it late?" });
    expect(node.ask).toEqual({ type: "noul", instructions: "Is it late?" });
    expect(node.pass).toEqual({ max: 0.5 });
    expect(node.then.id).toBe("late-then");
    expect(node.otherwise?.id).toBe("late-otherwise");
    expect(node.unsure).toBeUndefined();
  });

  it("maps a route to a choice with one branch per label", () => {
    const node = compileRecipe(mixed()) as RouteNode;
    expect(node).toMatchObject({ kind: "route", id: "vibe", title: "What is the vibe?" });
    expect(node.ask).toEqual({
      type: "choice",
      instructions: "What is the vibe?",
      criteria: { calm: "A quiet night", loud: "A loud night" },
    });
    expect(Object.keys(node.branches)).toEqual(["calm", "loud"]);
    expect(node.branches.calm).toMatchObject({ kind: "gate", id: "booked" });
    expect(node.branches.loud).toMatchObject({ kind: "ask", id: "loud" });
  });

  it("names a route's verdicts <route>-<label>", () => {
    const node = compileRecipe(
      valid(route("mood", "Mood?", { up: "Up", down: "Down" }, { up: verdict("jevs", "Up."), down: verdict("nope", "Down.") })),
    ) as RouteNode;
    expect(node.branches.up.id).toBe("mood-up");
    expect(node.branches.down.id).toBe("mood-down");
  });

  it("maps a rate to one ask titled Rating, questions in order", () => {
    const node = (compileRecipe(mixed()) as RouteNode).branches.loud as AskNode;
    expect(node.kind).toBe("ask");
    expect(node.id).toBe("loud");
    expect(node.title).toBe("Rating");
    expect(Object.keys(node.questions)).toEqual(["friends", "cost", "where"]);
    expect(node.questions).toEqual({
      friends: { type: "noul", instructions: "Are friends coming?" },
      cost: { type: "score", instructions: "How expensive is it?", criteria: ["cheap", "fine", "steep"] },
      where: { type: "choice", instructions: "Where is it?", criteria: { home: "At home", out: "Out somewhere" } },
    });
  });

  it("maps a lone verdict to an emit with id verdict", () => {
    const node = compileRecipe(valid(verdict("kinda", "It sort of jevs."))) as EmitNode;
    expect(node).toEqual({
      kind: "emit",
      id: "verdict",
      title: "It sort of jevs.",
      value: { tier: "kinda", line: "It sort of jevs." },
    });
  });

  it("maps a verdict under a gate to an emit of { tier, line } titled with the line", () => {
    const node = compileRecipe(ladder(1)) as GateNode;
    expect(node.then).toEqual({
      kind: "emit",
      id: "g1-then",
      title: "It jevs.",
      value: { tier: "jevs", line: "It jevs." },
    });
  });

  it("keeps the spec'd ids for the ladder", () => {
    expect(ids(compileRecipe(ladder(3)))).toEqual([
      "g1",
      "g2",
      "g3",
      "g3-then",
      "g3-otherwise",
      "g2-otherwise",
      "g1-otherwise",
    ]);
  });

  it("adds no step nodes", () => {
    const kinds = new Set<string>();
    walk(compileRecipe(mixed()), (node) => {
      kinds.add(node.kind);
    });
    expect([...kinds].sort()).toEqual(["ask", "emit", "gate", "route"]);
  });
});

describe("compileRecipe ids on a clash", () => {
  it("suffixes a verdict whose id is another node's key", () => {
    const root = compileRecipe(
      valid(
        gate(
          "a",
          "First?",
          "yes",
          verdict("jevs", "Yes."),
          gate("a-then", "Second?", "yes", verdict("jevs", "Yes again."), verdict("nope", "No.")),
        ),
      ),
    );
    expect(ids(root)).toEqual(["a", "a-then-2", "a-then", "a-then-then", "a-then-otherwise"]);
    expectUniqueIds(root);
  });

  it("lets the first verdict in document order keep an id two verdicts want", () => {
    // Route "a" label "b-then" and gate "a-b"'s then side both want "a-b-then".
    const root = compileRecipe(
      valid(
        route(
          "a",
          "Which?",
          { "b-then": "First", c: "Second" },
          {
            "b-then": verdict("jevs", "Route verdict."),
            c: gate("a-b", "Gate?", "yes", verdict("jevs", "Gate verdict."), verdict("nope", "No.")),
          },
        ),
      ),
    );
    expect(ids(root)).toEqual(["a", "a-b-then", "a-b", "a-b-then-2", "a-b-otherwise"]);
    expectUniqueIds(root);
  });

  it("never takes a suffix another verdict wants as its own id", () => {
    // "g"'s then side wants "g-then", which is route "g-then"'s key. That
    // route's verdicts want "g-then-2" and "g-then-3", so the clash skips both.
    const root = compileRecipe(
      valid(
        gate(
          "g",
          "Gate?",
          "yes",
          verdict("jevs", "Yes."),
          route("g-then", "Which?", { "2": "Two", "3": "Three" }, { "2": verdict("jevs", "Two."), "3": verdict("nope", "Three.") }),
        ),
      ),
    );
    expect(ids(root)).toEqual(["g", "g-then-4", "g-then", "g-then-2", "g-then-3"]);
    expectUniqueIds(root);
  });

  it("gives a shared verdict object a distinct id at each use", () => {
    const stop = verdict("nope", "No.");
    const root = compileRecipe(recipe("t", "t", gate("a", "A?", "yes", gate("b", "B?", "yes", stop, stop), stop)));
    expect(ids(root)).toEqual(["a", "b", "b-then", "b-otherwise", "a-otherwise"]);
  });
});

describe("compiled chains", () => {
  it("serialize with empty refs and load back with no issues", () => {
    const doc = toJSON(compileRecipe(ladder(10)));
    expect(doc.refs).toEqual([]);
    expect(chainIssues(fromJSON(doc))).toEqual([]);
    expectPortable(compileRecipe(ladder(10)));
  });

  it("round-trip a route, gate and rate tree", () => {
    expectPortable(compileRecipe(mixed()));
  });

  it("print with toTypeScript", () => {
    const source = toTypeScript(toJSON(compileRecipe(ladder(2))));
    expect(source).toContain('import { emit, gate, noul } from "jevchain";');
    expect(source).toContain('gate("g1", {');
    expect(source).toContain('ask: noul("Does it stop at gate 1?")');
    expect(source).toContain("pass: { max: 0.5 }");
    expect(source).toContain('emit({ tier: "jevs", line: "It jevs." }, { id: "g2-then", title: "It jevs." })');
    expect(source).not.toContain("step(");
  });

  it("print a route and rate tree with toTypeScript", () => {
    const source = toTypeScript(toJSON(compileRecipe(mixed())));
    expect(source).toContain('route("vibe", {');
    expect(source).toContain('ask("loud", {');
    expect(source).toContain('score("How expensive is it?"');
  });
});

describe("running a compiled recipe", () => {
  it("runs ladder(10) to It jevs. in exactly 10 requests", async () => {
    const { client, requests } = fakeJev();
    const result = await run(compileRecipe(ladder(10)), "the ladder", { jev: client });
    expect(result.status).toBe("ok");
    expect(result.output).toEqual({ tier: "jevs", line: "It jevs." });
    expect(requests).toHaveLength(10);
    expect(requests.map((r) => Object.keys(r.questions))).toEqual(Array(10).fill(["decision"]));
    expect(requests[0].state).toBe("the ladder");
  });

  it("stops at gate 3's verdict after 3 requests when gate 3 says 0.9", async () => {
    const { client, requests } = fakeJev(byQuestion({ "gate 3?": { noul: 0.9 } }));
    const result = await run(compileRecipe(ladder(10)), "the ladder", { jev: client });
    expect(result.output).toEqual({ tier: "nope", line: "It does not jev at gate 3." });
    expect(requests).toHaveLength(3);
    expect(requests.map((r) => r.questions.decision.instructions)).toEqual([
      "Does it stop at gate 1?",
      "Does it stop at gate 2?",
      "Does it stop at gate 3?",
    ]);
  });

  it("takes the passing side at exactly 0.5 for a yes gate and a no gate", async () => {
    for (const pass of ["yes", "no"] as const) {
      const { client } = fakeJev(() => ({ noul: 0.5 }));
      const result = await run(compileRecipe(ladder(1, pass)), "x", { jev: client });
      expect(result.output, `pass: "${pass}"`).toEqual({ tier: "jevs", line: "It jevs." });
    }
  });

  it("takes the failing side just past 0.5", async () => {
    const yes = await run(compileRecipe(ladder(1, "yes")), "x", { jev: fakeJev(() => ({ noul: 0.49 })).client });
    const no = await run(compileRecipe(ladder(1, "no")), "x", { jev: fakeJev(() => ({ noul: 0.51 })).client });
    expect(yes.output).toEqual({ tier: "nope", line: "It does not jev at gate 1." });
    expect(no.output).toEqual({ tier: "nope", line: "It does not jev at gate 1." });
  });

  it("asks a rate's questions in one request", async () => {
    const { client, requests } = fakeJev(byQuestion({ "vibe?": { choice: "loud" } }));
    const result = await run(compileRecipe(mixed()), "a night out", { jev: client });
    expect(result.status).toBe("ok");
    expect(requests).toHaveLength(2);
    expect(Object.keys(requests[1].questions)).toEqual(["friends", "cost", "where"]);
    expect(Object.keys(result.output as object)).toEqual(["friends", "cost", "where"]);
  });

  it("routes by label", async () => {
    const { client, requests } = fakeJev();
    const result = await run(compileRecipe(mixed()), "a night out", { jev: client });
    // "calm" is the first label, then "booked" passes on yes, and the fake says 0.1.
    expect(result.output).toEqual({ tier: "nope", line: "Book something." });
    expect(requests).toHaveLength(2);
  });
});
