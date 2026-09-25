import { describe, expect, it } from "vitest";
import { ask, cascade, chain, choice, emit, fromJSON, gate, noul, parallel, route, run, toJSON, type Entry, type JevClient, type Questions } from "jevchain";
import { pasteAt, withUniqueIds } from "./clipboard";
import { deadReads, flowWarnings, finishedBefore, type FlowWarning } from "./data-flow";
import { allIds, cloneWithFreshIds, duplicateAt, getAt, moveStep, newDocument, removeAt, renameNode, updateAt, withRoot, type NodeJson } from "./doc-ops";
import { readsIn, withReadsRenamed } from "./reads";

/** A Jev that picks the first label, so runs are predictable. */
const jev: JevClient = {
  model: "fake",
  usdPerMillionTokens: 0,
  async ask(_state: Entry, questions: Questions) {
    const answers: Record<string, unknown> = {};
    for (const [k, q] of Object.entries(questions)) {
      if (q.type === "choice") {
        const labels = Object.keys(q.criteria);
        answers[k] = { type: "choice", choice: labels[0], probabilities: Object.fromEntries(labels.map((l, i) => [l, i ? 0 : 1])), confidence: 1 };
      } else if (q.type === "score") answers[k] = { type: "score", score: 0, probabilities: { 0: 1 }, legend: {}, confidence: 1 };
      else answers[k] = { type: "noul", noul: 1 };
    }
    return { answers, model: "fake", usage: { inputTokens: 0, outputTokens: 0 }, costUsd: 0, latencyMs: 0, attempts: 1 } as never;
  },
};

const output = async (root: NodeJson, input: unknown = "my toaster whispers") => {
  const r = await run(fromJSON(withRoot(newDocument(), root), { missingHandlers: "passthrough" }), input, { jev });
  return r.status === "ok" ? r.output : r.status;
};

const asRoot = (node: Parameters<typeof toJSON>[0]) => toJSON(node).root as unknown as NodeJson;
const dead = (root: NodeJson) => flowWarnings(root).filter((w) => w.rule === "dead-read");
const fix = (root: NodeJson, w: FlowWarning, i = 0) => updateAt(root, w.fixes[i]!.at ?? w.path, w.fixes[i]!.node);

/** What someone builds from the docs: an ask, then a route whose replies quote the ask's answer through `results`. */
const ticket = () =>
  asRoot(
    chain(
      "flow",
      ask("triage", { state: "{{input}}", questions: { urgency: choice("How urgent is this?", ["low", "high"]) } }),
      route("team", {
        state: "{{run}}",
        ask: choice("Which team?", ["billing", "repair"]),
        branches: { billing: emit("Billing ({{results.triage.urgency.choice}} urgency)", { id: "to-billing" }), repair: emit("Repair ({{results.triage.urgency.choice}} urgency)", { id: "to-repair" }) },
      }),
    ),
  );

describe("renaming a node in the property panel", () => {
  it("before: changing just the id leaves the reads pointing at a node that's gone; the reply loses its urgency, and the only warning says to delete the ask", async () => {
    const root = ticket();
    expect(await output(root)).toBe("Billing (low urgency)");
    const idOnly = updateAt(root, "$/0", (n) => ({ ...n, id: "urgency-check" }));
    expect(await output(idOnly)).toBe("Billing ( urgency)");
    expect(flowWarnings(idOnly).find((w) => w.rule === "unused-output")?.fixes.map((f) => f.label)).toContain("remove this ask");
    // and now it's flagged where the value goes missing, with the node it meant as the fix
    const [a, b] = dead(idOnly);
    expect([a!.path, b!.path]).toEqual(["$/1/billing", "$/1/repair"]);
    expect(a!.message).toBe("{{results.triage.urgency.choice}} is always empty here: no node has the id “triage”");
    expect(a!.fixes.map((f) => f.label)).toEqual(["read ask “urgency-check”"]);
    expect(await output(fix(idOnly, a!))).toBe("Billing (low urgency)");
  });

  it("renameNode points every read at the new id, so every run ends the same", async () => {
    const root = ticket();
    const renamed = renameNode(root, "$/0", "urgency-check");
    expect(getAt(renamed, "$/0")!.id).toBe("urgency-check");
    expect(getAt(renamed, "$/1/billing")!.value).toBe("Billing ({{results.urgency-check.urgency.choice}} urgency)");
    expect(await output(renamed)).toBe("Billing (low urgency)");
    expect(flowWarnings(renamed)).toEqual([]);
  });

  it("typing a new id one keystroke at a time ends up in the same place", () => {
    let root = ticket();
    for (const id of ["u", "ur", "urg", "urgency", "urgency-", "urgency-check"]) root = renameNode(root, "$/0", id);
    expect(root).toEqual(renameNode(ticket(), "$/0", "urgency-check"));
  });

  it("rewrites state, cascade tier states and nested emit values, and nothing that isn't a rendered template", () => {
    const root = asRoot(
      chain(
        "c",
        ask("a", { questions: { q: noul("what was {{results.a}}?") } }),
        ask("b", { state: "{{ results.a.q.noul }} and {{results.ab}} and {{results}}", questions: { q: noul("?") } }),
        cascade("k", { tiers: [{ id: "t", ask: noul("?"), minConfidence: 0.5, state: "{{results.a.q}}" }], fallback: emit({ deep: ["{{results.a}}", { x: "{{answers.a.q}}" }] }, { id: "f" }) }),
      ),
    );
    const r = renameNode(root, "$/0", "z");
    expect((getAt(r, "$/0")!.questions as Record<string, { instructions: string }>).q.instructions).toBe("what was {{results.a}}?");
    expect(getAt(r, "$/1")!.state).toBe("{{ results.z.q.noul }} and {{results.ab}} and {{results}}");
    expect((getAt(r, "$/2")!.tiers as { state: string }[])[0]!.state).toBe("{{results.z.q}}");
    expect(getAt(r, "$/2/fallback")!.value).toEqual({ deep: ["{{results.z}}", { x: "{{answers.z.q}}" }] });
    // nodes nobody reads keep their identity (cheap re-renders, a clean undo diff)
    const t = ticket();
    expect(getAt(renameNode(t, "$/1", "desk"), "$/0")).toBe(getAt(t, "$/0"));
  });

  it("leaves reads alone when they might not have meant this node, or the new id can't be read; they show up as dead instead", () => {
    const shared = updateAt(ticket(), "$/1/repair", (n) => ({ ...n, id: "triage" }));
    expect(getAt(renameNode(shared, "$/0", "x"), "$/1/billing")!.value).toBe("Billing ({{results.triage.urgency.choice}} urgency)");
    const spaced = renameNode(ticket(), "$/0", "urgency check");
    expect(getAt(spaced, "$/1/billing")!.value).toBe("Billing ({{results.triage.urgency.choice}} urgency)");
    expect(dead(spaced)).toHaveLength(2);
    const onto = renameNode(ticket(), "$/0", "team");
    expect(getAt(onto, "$/1/billing")!.value).toBe("Billing ({{results.triage.urgency.choice}} urgency)");
  });
});

describe("copies", () => {
  const branchy = () => asRoot(parallel("p", { branches: { one: chain("inner", ask("a", { state: "{{input}}", questions: { q: choice("?", ["yes", "no"]) } }), emit("got {{results.a.q.choice}} after {{results.outside}}", { id: "e" })) } }));

  it("duplicate: reads inside the copy follow the copied nodes; reads of nodes outside it stay", () => {
    const r = duplicateAt(branchy(), "$/one")!;
    expect(r.path).toBe("$/one-copy");
    expect(getAt(r.root, "$/one-copy/1")!.value).toBe("got {{results.a-copy.q.choice}} after {{results.outside}}");
    expect(getAt(r.root, "$/one/1")!.value).toBe("got {{results.a.q.choice}} after {{results.outside}}");
  });

  it("paste: the same, for the ids it renames; a cut → paste keeps its ids and its reads", () => {
    const root = branchy();
    const copied = pasteAt(root, "$/one", getAt(root, "$/one")!, "after");
    expect(getAt(copied.root, `${copied.path}/1`)!.value).toBe("got {{results.a-copy.q.choice}} after {{results.outside}}");
    const moved = pasteAt(removeAt(root, "$/one"), "$", getAt(root, "$/one")!, "replace");
    expect(getAt(moved.root, "$/1")!.value).toBe("got {{results.a.q.choice}} after {{results.outside}}");
  });

  it("an id the copied subtree held twice is ambiguous, so reads of it stay put", () => {
    const twice = asRoot(chain("c", ask("a", { questions: { q: noul("?") } }), emit("{{results.a}}", { id: "a" })));
    expect(getAt(cloneWithFreshIds(twice, allIds(twice)), "$/1")!.value).toBe("{{results.a}}");
    expect(getAt(withUniqueIds(twice, new Set(["a"])), "$/1")!.value).toBe("{{results.a}}");
  });

  it("at runtime, the copy quotes its own ask (before: it quoted the original's, from another branch, and came up empty)", async () => {
    const root = asRoot(
      route("r", {
        ask: choice("?", ["second", "first"]),
        branches: { first: chain("inner", ask("a", { state: "{{input}}", questions: { q: choice("?", ["yes", "no"]) } }), emit("got {{results.a.q.choice}}", { id: "e" })), second: emit("placeholder", { id: "ph" }) },
      }),
    );
    const pasted = pasteAt(root, "$/second", getAt(root, "$/first")!, "replace").root;
    expect(await output(pasted)).toBe("got yes");
    const stale = updateAt(pasted, "$/second/1", (n) => ({ ...n, value: "got {{results.a.q.choice}}" }));
    expect(await output(stale)).toBe("got ");
    expect(dead(stale).map((w) => w.message)).toEqual(["{{results.a.q.choice}} is always empty here: “a” can't have run yet: it's on another branch of route “r”, and only one of those runs"]);
  });
});

describe("reads that can only come up empty", () => {
  const q = { questions: { q: noul("?") } };
  const reasons = (root: NodeJson) => dead(root).map((w) => `${w.path}${w.tier ? `/${w.tier}` : ""}: ${w.message.split(": ").slice(1).join(": ")}`);

  it("says why: missing, itself, an enclosing node, a node inside it, a later step, another branch", () => {
    const root = asRoot(
      chain(
        "c",
        emit("{{results.nope}} {{results.c}}", { id: "e0" }),
        ask("a", { state: "{{results.a}}", ...q }),
        route("r", { state: "{{results.x}}", ask: choice("?", ["x", "y"]), branches: { x: emit("{{results.y}}", { id: "x" }), y: emit("y", { id: "y" }) } }),
        emit("{{results.later}}", { id: "e3" }),
        emit("later", { id: "later" }),
        cascade("k", { tiers: [{ id: "t", ask: noul("?"), minConfidence: 0.5, state: "{{results.k}}" }], fallback: emit("f", { id: "f" }) }),
      ),
    );
    expect(reasons(root)).toEqual([
      "$/0: no node has the id “nope”; “c” can't have run yet: it encloses this node, so it isn't done yet",
      "$/1: “a” can't have run yet: it's this node: its result is only there once it's done",
      "$/2: “x” can't have run yet: it runs inside this node, after this is read",
      "$/2/x: “y” can't have run yet: it's on another branch of route “r”, and only one of those runs",
      "$/3: “later” can't have run yet: it comes later in the chain",
      "$/5/t: “k” can't have run yet: it's this node: its result is only there once it's done",
    ]);
  });

  it("stays quiet about what has or may have run: an earlier step, something inside one, a parallel sibling, a shared id, bare {{results}}, {{answers…}}", () => {
    const root = asRoot(
      chain(
        "c",
        ask("a", q),
        gate("g", { ask: noul("?"), pass: { min: 0.5 }, then: emit("t", { id: "inside" }), otherwise: emit("o", { id: "o" }) }),
        parallel("p", { branches: { l: emit("{{results.r}}", { id: "l" }), r: emit("r", { id: "r" }) } }),
        emit("{{results.a}} {{results.inside}} {{results}} {{answers.nope}} {{results.dup}}", { id: "e" }),
        emit("d", { id: "dup" }),
      ),
    );
    const withDup = updateAt(root, "$/0", (n) => ({ ...n, id: "dup" }));
    expect(dead(root).map((w) => w.message)).toEqual(["{{results.dup}} is always empty here: “dup” can't have run yet: it comes later in the chain"]);
    expect(dead(updateAt(withDup, "$/3", (n) => ({ ...n, value: "{{results.dup}}" })))).toEqual([]);
  });

  it("offers the steps sure to have run, nearest first, and each fix clears it", async () => {
    const root = asRoot(chain("c", ask("first", q), ask("second", { state: "{{run}}", ...q }), ask("third", { state: "{{run}}", ...q }), ask("fourth", { state: "{{run}}", ...q }), emit("{{results.gone.q.noul}}", { id: "e" })));
    const [w] = dead(root);
    expect(w!.fixes.map((f) => f.label)).toEqual(["read ask “fourth”", "read ask “third”", "read ask “second”"]);
    for (const [i] of w!.fixes.entries()) {
      const fixed = fix(root, w!, i);
      expect(dead(fixed)).toEqual([]);
      expect(await output(fixed)).toBe(1);
    }
  });

  it("moving a step past the node that reads it is flagged too", () => {
    const root = asRoot(chain("c", ask("a", q), emit("{{results.a.q.noul}}", { id: "e" })));
    expect(dead(root)).toEqual([]);
    expect(dead(moveStep(root, "$/0", 1)!.root).map((w) => w.path)).toEqual(["$/0"]);
  });

  it("finishedBefore and readsIn agree with the helpers they're built from", () => {
    const root = ticket();
    expect(finishedBefore(root, "$/0", "$/1/billing")).toEqual({ when: "yes" });
    expect(readsIn(getAt(root, "$/1/billing")!)).toEqual([{ hole: "results.triage.urgency.choice", root: "results", id: "triage" }]);
    expect(withReadsRenamed(getAt(root, "$/0")!, new Map([["triage", "x"]]))).toBe(getAt(root, "$/0"));
    expect(deadReads(root, getAt(root, "$/1/billing")!, "$/1/billing")).toEqual([]);
  });
});
