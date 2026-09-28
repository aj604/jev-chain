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
import { gate, outcome, pick, rate, recipe, route, scale, yesNo } from "@/test/build";
import { byQuestion, fakeJev } from "@/test/fake-jev";
import { desk, ladder } from "@/test/fixtures";
import { compileRecipe } from "./compile";
import { ESCAPE, type Recipe, type RecipeNode } from "./types";
import { validateRecipe } from "./validate";

/** Validated, so every test compiles a recipe the site could actually get. */
function valid(root: RecipeNode): Recipe {
  const check = validateRecipe(recipe("The Test Desk", "it", root));
  if (!check.ok) throw new Error(check.message);
  return check.recipe;
}

const yes = () => outcome("said-yes", "Yes", "It said yes.");
const no = () => outcome("said-no", "No", "It said no.");

/** A route over a gate and a rate with every question kind. */
function mixed(): Recipe {
  return valid(
    route(
      "vibe",
      "What is the vibe?",
      { calm: "A quiet night", loud: "A loud night" },
      {
        calm: gate(
          "booked",
          "Is anything booked?",
          outcome("go", "Go", "Go out."),
          outcome("book", "Book it", "Book something."),
          { title: "Booked?" },
        ),
        loud: rate(
          "loud",
          [
            yesNo("friends", "Are friends coming?", 2, true),
            scale("cost", "How expensive is it?", 1, ["cheap", "fine", "steep"], "low"),
            pick("where", "Where is it?", 1, { home: "At home", out: "Out somewhere" }, ["home"]),
          ],
          [
            [0.5, outcome("loud-ok", "Fine", "Loud but fine.")],
            [0, outcome("loud-no", "Too loud", "Too loud.")],
          ],
          { title: "Loudness" },
        ),
      },
      { title: "Vibe" },
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

/** Round-trips through JSON and expects a clean, handler-free chain. */
function expectPortable(root: AnyNode) {
  const doc = toJSON(root);
  expect(doc.refs).toEqual([]);
  const loaded = fromJSON(JSON.parse(JSON.stringify(doc)));
  expect(chainIssues(loaded)).toEqual([]);
  expect(toJSON(loaded)).toEqual(doc);
}

describe("compileRecipe", () => {
  it("maps a gate to a noul at min 0.5, yes to then and no to otherwise", () => {
    const node = compileRecipe(valid(gate("booked", "Is anything booked?", yes(), no(), { title: "Booked?" }))) as GateNode;
    expect(node).toMatchObject({
      kind: "gate",
      id: "booked",
      title: "Booked?",
      then: { kind: "emit", id: "said-yes" },
      otherwise: { kind: "emit", id: "said-no" },
    });
    expect(node.pass).toEqual({ min: 0.5 });
    expect(node.ask).toEqual({ type: "noul", instructions: "Is anything booked?" });
    expect(node).not.toHaveProperty("unsure");
  });

  it("describes a gate's answers with means", () => {
    const node = compileRecipe(
      valid(gate("fire", "Is anything on fire?", yes(), no(), { means: { yes: "flames or smoke", no: "cold and calm" } })),
    ) as GateNode;
    expect(node.ask).toEqual({
      type: "noul",
      instructions: "Is anything on fire?",
      criteria: { true: "flames or smoke", false: "cold and calm" },
    });
  });

  it("adds unsure at the escape margin when the gate has one", () => {
    const node = compileRecipe(
      valid(gate("fire", "Is anything on fire?", yes(), no(), { unsure: outcome("shrug", "Unclear", "Nobody knows.") })),
    ) as GateNode;
    expect(node.unsure).toEqual({
      margin: ESCAPE.unsureMargin,
      then: { kind: "emit", id: "shrug", title: "Unclear", value: { key: "shrug", stamp: "Unclear", line: "Nobody knows." } },
    });
  });

  it("maps a route to a choice with one branch per label", () => {
    const node = compileRecipe(mixed()) as RouteNode;
    expect(node).toMatchObject({ kind: "route", id: "vibe", title: "Vibe" });
    expect(node.ask).toEqual({
      type: "choice",
      instructions: "What is the vibe?",
      criteria: { calm: "A quiet night", loud: "A loud night" },
    });
    expect(Object.keys(node.branches)).toEqual(["calm", "loud"]);
    expect(node.branches.calm).toMatchObject({ kind: "gate", id: "booked" });
    expect(node.branches.loud).toMatchObject({ kind: "ask", id: "loud" });
    expect(node).not.toHaveProperty("lowConfidence");
  });

  it("adds lowConfidence at the escape bar when the route has one", () => {
    const node = compileRecipe(
      valid(
        route("mood", "Mood?", { up: "Up", down: "Down" }, { up: yes(), down: no() }, { lowConfidence: outcome("dave", "Dave", "Ask Dave.") }),
      ),
    ) as RouteNode;
    expect(node.lowConfidence).toEqual({
      below: ESCAPE.lowConfidenceBelow,
      then: { kind: "emit", id: "dave", title: "Dave", value: { key: "dave", stamp: "Dave", line: "Ask Dave." } },
    });
  });

  it("maps a rate to one ask titled with its title, questions in order", () => {
    const node = (compileRecipe(mixed()) as RouteNode).branches.loud as AskNode;
    expect(node.kind).toBe("ask");
    expect(node.id).toBe("loud");
    expect(node.title).toBe("Loudness");
    expect(Object.keys(node.questions)).toEqual(["friends", "cost", "where"]);
    expect(node.questions).toEqual({
      friends: { type: "noul", instructions: "Are friends coming?" },
      cost: { type: "score", instructions: "How expensive is it?", criteria: ["cheap", "fine", "steep"] },
      where: { type: "choice", instructions: "Where is it?", criteria: { home: "At home", out: "Out somewhere" } },
    });
  });

  it("maps an outcome to an emit of { key, stamp, line }, keyed and titled with its stamp", () => {
    const node = compileRecipe(valid(outcome("exorcist", "Exorcist booked", "Booked: one (1) exorcist."))) as EmitNode;
    expect(node).toEqual({
      kind: "emit",
      id: "exorcist",
      title: "Exorcist booked",
      value: { key: "exorcist", stamp: "Exorcist booked", line: "Booked: one (1) exorcist." },
    });
  });

  it("keeps every recipe key as its node id, escape hatches included", () => {
    expect(ids(compileRecipe(ladder(3)))).toEqual(["g1", "stop-1", "g2", "stop-2", "g3", "stop-3", "through"]);
    const all = ids(compileRecipe(desk()));
    expect(all).toEqual(["kind", "danger", "evacuate", "exorcist", "priest", "refund", "drafty", "ask-dave"]);
    expect(new Set(all).size).toBe(all.length);
  });

  it("adds no step nodes", () => {
    const kinds = new Set<string>();
    walk(compileRecipe(mixed()), (node) => {
      kinds.add(node.kind);
    });
    expect([...kinds].sort()).toEqual(["ask", "emit", "gate", "route"]);
  });
});

describe("compiled chains", () => {
  it("serialize with empty refs and load back with no issues", () => {
    const doc = toJSON(compileRecipe(ladder(10)));
    expect(doc.refs).toEqual([]);
    expect(chainIssues(fromJSON(doc))).toEqual([]);
    expectPortable(compileRecipe(ladder(10)));
  });

  it("round-trip a route, gate and rate tree, and one with both escape hatches", () => {
    expectPortable(compileRecipe(mixed()));
    expectPortable(compileRecipe(desk()));
  });

  it("print with toTypeScript", () => {
    const source = toTypeScript(toJSON(compileRecipe(ladder(2))));
    expect(source).toContain('import { emit, gate, noul } from "jevchain";');
    expect(source).toContain('gate("g1", {');
    expect(source).toContain('ask: noul("Does it stop at gate 1?")');
    expect(source).toContain("pass: { min: 0.5 }");
    expect(source).toContain('key: "through",');
    expect(source).toContain('{ id: "through", title: "Cleared" }');
    expect(source).not.toContain("step(");
  });

  it("print a route and rate tree, and the escape hatches, with toTypeScript", () => {
    const source = toTypeScript(toJSON(compileRecipe(mixed())));
    expect(source).toContain('route("vibe", {');
    expect(source).toContain('ask("loud", {');
    expect(source).toContain('score("How expensive is it?"');
    const escapes = toTypeScript(toJSON(compileRecipe(desk())));
    expect(escapes).toContain("lowConfidence: {");
    expect(escapes).toContain("unsure: {");
    expect(escapes).toContain("spooky but harmless");
  });
});

describe("running a compiled recipe", () => {
  it("runs ladder(10) to its last outcome in exactly 10 requests", async () => {
    const { client, requests } = fakeJev();
    const result = await run(compileRecipe(ladder(10)), "the ladder", { jev: client });
    expect(result.status).toBe("ok");
    expect(result.output).toEqual({ key: "through", stamp: "Cleared", line: "Cleared every gate on the ladder." });
    expect(requests).toHaveLength(10);
    expect(requests.map((r) => Object.keys(r.questions))).toEqual(Array(10).fill(["decision"]));
    expect(requests[0]!.state).toBe("the ladder");
  });

  it("stops at gate 3's outcome after 3 requests when gate 3 says 0.9", async () => {
    const { client, requests } = fakeJev(byQuestion({ "gate 3?": { noul: 0.9 } }));
    const result = await run(compileRecipe(ladder(10)), "the ladder", { jev: client });
    expect(result.output).toMatchObject({ key: "stop-3" });
    expect(requests).toHaveLength(3);
    expect(requests.map((r) => r.questions.decision!.instructions)).toEqual([
      "Does it stop at gate 1?",
      "Does it stop at gate 2?",
      "Does it stop at gate 3?",
    ]);
  });

  it("takes yes at exactly 0.5 and no just under it", async () => {
    const at = await run(compileRecipe(ladder(1)), "x", { jev: fakeJev(() => ({ noul: 0.5 })).client });
    const under = await run(compileRecipe(ladder(1)), "x", { jev: fakeJev(() => ({ noul: 0.49 })).client });
    expect(at.output).toMatchObject({ key: "stop-1" });
    expect(under.output).toMatchObject({ key: "through" });
  });

  it("takes unsure only strictly inside the margin", async () => {
    const r = compileRecipe(desk());
    const danger = (noul: number) => fakeJev(byQuestion({ "physical danger": { noul } })).client;
    for (const [noul, key] of [
      [0.5, "priest"],
      [0.41, "priest"],
      [0.59, "priest"],
      [0.39, "exorcist"],
      [0.61, "evacuate"],
    ] as const) {
      const result = await run(r, "a ghost", { jev: danger(noul) });
      expect(result.output, String(noul)).toMatchObject({ key });
    }
  });

  it("takes lowConfidence under the bar, and the label at or over it", async () => {
    const r = compileRecipe(desk());
    const route = (confidence: number) => fakeJev(byQuestion({ "Which team": { confidence } })).client;
    expect((await run(r, "x", { jev: route(0.39) })).output).toMatchObject({ key: "ask-dave" });
    // The first label, "ghost", then the danger gate's default 0.1: no.
    expect((await run(r, "x", { jev: route(0.4) })).output).toMatchObject({ key: "exorcist" });
  });

  it("asks a rate's questions in one request", async () => {
    const { client, requests } = fakeJev(byQuestion({ "vibe?": { choice: "loud" } }));
    const result = await run(compileRecipe(mixed()), "a night out", { jev: client });
    expect(result.status).toBe("ok");
    expect(requests).toHaveLength(2);
    expect(Object.keys(requests[1]!.questions)).toEqual(["friends", "cost", "where"]);
    expect(Object.keys(result.output as object)).toEqual(["friends", "cost", "where"]);
  });

  it("routes by label", async () => {
    const { client, requests } = fakeJev();
    const result = await run(compileRecipe(mixed()), "a night out", { jev: client });
    // "calm" is the first label, then the fake says 0.1 to "booked": no.
    expect(result.output).toEqual({ key: "book", stamp: "Book it", line: "Book something." });
    expect(requests).toHaveLength(2);
  });
});
