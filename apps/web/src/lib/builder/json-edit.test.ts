import { describe, expect, it } from "vitest";
import { cascade, chain, choice, emit, gate, noul, parallel, route, step, toJSON, type ChainDocument } from "jevchain";
import { allIds, childEdges, getAt, newDocument, removeAt, type NodeJson } from "./doc-ops";
import { formatDocument, readDocumentEdit, shapeIssues } from "./json-edit";

// Every kind the builder knows, so the shape check is exercised on real output.
const desk = (): ChainDocument =>
  toJSON(
    chain(
      "c",
      route("r", {
        ask: choice("?", ["a", "b", "p"]),
        branches: {
          a: emit("A", { id: "ea" }),
          b: gate("g", { ask: noul("?"), pass: { min: 0.5 }, then: emit("T", { id: "t" }), otherwise: emit("F", { id: "f" }), unsure: { margin: 0.1, then: emit("U", { id: "u" }) } }),
          p: parallel("par", { branches: { x: step("sx", (i: unknown) => i), y: cascade("cas", { tiers: [{ id: "quick", ask: noul("ok?"), minConfidence: 0.8 }], fallback: emit("human", { id: "h" }) }) } }),
        },
        lowConfidence: { below: 0.4, then: emit("?", { id: "lc" }) },
      }),
      emit("end", { id: "end" }),
    ),
    { name: "desk", examples: ["hi"] },
  );

/** Edit the document as the json tab would: format, change the parsed text, read it back. */
const edit = (doc: ChainDocument, fn: (d: Record<string, unknown>) => void) => {
  const d = JSON.parse(formatDocument(doc));
  fn(d);
  return readDocumentEdit(JSON.stringify(d, null, 2), doc);
};

describe("readDocumentEdit", () => {
  it("reads the formatted document back as unchanged, with no issues", () => {
    const doc = desk();
    const r = readDocumentEdit(formatDocument(doc), doc);
    expect(r).toMatchObject({ ok: true, changed: false, issues: [] });
    if (r.ok) expect(r.nodes.before).toBe(r.nodes.after);
  });

  it("brings an edit the property panel can't make back into the document", () => {
    const doc = desk();
    const r = edit(doc, (d) => {
      const root = d.root as { steps: Record<string, unknown>[] };
      root.steps[0]!.description = "front desk";
      root.steps[1] = { kind: "emit", id: "bye", value: "bye {{input}}" };
    });
    expect(r.ok && r.changed).toBe(true);
    if (!r.ok) return;
    expect(r.issues).toEqual([]);
    const root = r.doc.root as unknown as NodeJson;
    expect(getAt(root, "$/0")!.description).toBe("front desk");
    expect(getAt(root, "$/1")).toEqual({ kind: "emit", id: "bye", value: "bye {{input}}" });
    expect(r.doc.name).toBe("desk");
    expect(r.doc.examples).toEqual(["hi"]);
  });

  it("recomputes refs from the edited tree instead of trusting the text", () => {
    const doc = desk();
    expect(doc.refs).toEqual(["sx"]);
    const r = edit(doc, (d) => {
      d.refs = ["stale"];
      (d.root as { steps: unknown[] }).steps.push({ kind: "step", id: "lookup", run: { $ref: "lookup" } });
    });
    expect(r.ok && r.doc.refs).toEqual(["lookup", "sx"]);
    if (r.ok) expect(r.nodes).toEqual({ before: r.nodes.before, after: r.nodes.before + 1 });
  });

  it("accepts a document that won't run yet, and says why", () => {
    const doc = desk();
    const r = edit(doc, (d) => {
      const r0 = (d.root as { steps: { ask: { criteria: Record<string, null> } }[] }).steps[0]!;
      r0.ask.criteria.q = null; // a label with no branch
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.changed).toBe(true);
      expect(r.issues.some((i) => i.startsWith("$/0") && i.includes('no branch for "q"'))).toBe(true);
    }
  });

  it("points at the line and column of a syntax error", () => {
    const doc = desk();
    const text = formatDocument(doc).replace('"name": "desk",', '"name": "desk"');
    const r = readDocumentEdit(text, doc);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    const line = text.split("\n").findIndex((l) => l.includes('"description"') || l.includes('"examples"')) + 1;
    expect(r.line).toBe(line);
    expect(r.error).toMatch(new RegExp(`^not valid JSON \\(line ${line}, column \\d+\\)`));
    expect(text.slice(0, r.offset!).split("\n").length).toBe(line);
  });

  it("handles text that just stops", () => {
    const doc = desk();
    const text = formatDocument(doc).slice(0, 40);
    const r = readDocumentEdit(text, doc);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/^not valid JSON/);
  });

  it("refuses things that aren't a chain document", () => {
    const doc = desk();
    expect(readDocumentEdit("[]", doc)).toMatchObject({ ok: false, error: "expected a chain document object, got a list" });
    expect(edit(doc, (d) => (d.format = "jevchain/v0"))).toMatchObject({ ok: false, error: '"format" must be "jevchain/v1"' });
    expect(edit(doc, (d) => delete d.root)).toMatchObject({ ok: false, error: 'the document needs a "root" node' });
    expect(edit(doc, (d) => (d.name = 3))).toMatchObject({ ok: false, error: '"name" must be a string' });
    expect(edit(doc, (d) => (d.examples = "hi"))).toMatchObject({ ok: false });
  });

  it("refuses shapes the builder can't hold, naming the node", () => {
    const doc = desk();
    const steps = (d: Record<string, unknown>) => (d.root as { steps: Record<string, unknown>[] }).steps;
    const cases: [string, (d: Record<string, unknown>) => void, RegExp][] = [
      ["route without branches", (d) => delete steps(d)[0]!.branches, /^\$\/0 \(route "r"\): needs "branches"/],
      ["route without ask", (d) => delete steps(d)[0]!.ask, /^\$\/0 \(route "r"\): ask must be a question object/],
      ["gate without then", (d) => delete ((steps(d)[0]!.branches as Record<string, Record<string, unknown>>).b!.then), /^\$\/0\/b \(gate "g"\): needs "then"/],
      ["unknown kind", (d) => (steps(d)[1]!.kind = "emitt"), /^\$\/1: unknown kind "emitt"/],
      ["empty chain", (d) => (d.root = { kind: "chain", id: "c", steps: [] }), /^\$ \(chain "c"\): needs "steps"/],
      ["tier without ask", (d) => delete (((steps(d)[0]!.branches as Record<string, { branches: Record<string, { tiers: Record<string, unknown>[] }> }>).p!.branches.y!.tiers[0]!).ask), /^\$\/0\/p\/y \(cascade "cas"\): tiers\.0\.ask/],
      ["branch name with a slash", (d) => ((steps(d)[0]!.branches as Record<string, unknown>)["a/b"] = { kind: "emit", id: "x", value: 1 }), /branch name "a\/b"/],
      ["numeric id", (d) => (steps(d)[1]!.id = 7), /^\$\/1 \(emit\): "id" must be a string/],
      ["node is a string", (d) => ((steps(d) as unknown[])[1] = "emit"), /^\$\/1: expected a node object, got string "emit"/],
    ];
    for (const [name, fn, want] of cases) {
      const r = edit(doc, fn);
      expect(r.ok, name).toBe(false);
      if (!r.ok) expect(r.error, name).toMatch(want);
    }
  });

  it("refuses fields the canvas and property editor trust to have jevchain's types", () => {
    const doc = desk();
    type N = Record<string, unknown>;
    const r = (d: N) => (d.root as { steps: N[] }).steps[0]!; // route "r"
    const g = (d: N) => (r(d).branches as Record<string, N>).b!; // gate "g"
    const tier = (d: N) => ((((r(d).branches as Record<string, N>).p!.branches as Record<string, N>).y!.tiers as N[])[0]!);
    const cases: [string, (d: N) => void, RegExp][] = [
      ["route criteria deleted", (d) => delete (r(d).ask as N).criteria, /\$\/0 \(route "r"\): ask\.criteria must be an object of labels/],
      ["gate criteria null on a choice", (d) => (g(d).ask = { type: "choice", instructions: "?", criteria: null }), /ask\.criteria must be an object of labels/],
      ["score criteria not a list", (d) => (g(d).ask = { type: "score", instructions: "?", criteria: { a: null } }), /ask\.criteria must be a list of levels/],
      ["unknown question type", (d) => ((r(d).ask as N).type = "yesno"), /ask\.type must be "choice", "score" or "noul"/],
      ["alsoAsk entry null", (d) => (r(d).alsoAsk = { extra: null }), /alsoAsk\.extra must be a question object/],
      ["lowConfidence.below missing", (d) => delete (r(d).lowConfidence as N).below, /needs lowConfidence\.below, a number/],
      ["pass.min a string", (d) => ((g(d).pass as N).min = "0.5"), /pass\.min must be a number/],
      ["pass.max null", (d) => ((g(d).pass as N).max = null), /pass\.max must be a number/],
      ["unsure.margin a string", (d) => ((g(d).unsure as N).margin = "x"), /unsure\.margin must be a number/],
      ["unsure.minConfidence a list", (d) => ((g(d).unsure as N).minConfidence = []), /unsure\.minConfidence must be a number/],
      ["tier minConfidence missing", (d) => delete tier(d).minConfidence, /needs tiers\.0\.minConfidence, a number/],
      ["tier title an object", (d) => (tier(d).title = {}), /tiers\.0\.title must be a string/],
      ["node title an object", (d) => (r(d).title = { a: null }), /"title" must be a string/],
      ["step timeoutMs a string", (d) => (((r(d).branches as Record<string, N>).p!.branches as Record<string, N>).x!.timeoutMs = "1s"), /"timeoutMs" must be a number/],
    ];
    for (const [name, fn, want] of cases) {
      const res = edit(doc, fn);
      expect(res.ok, name).toBe(false);
      if (!res.ok) expect(res.error, name).toMatch(want);
    }
  });

  it("counts the rest when there's more than one shape problem", () => {
    const doc = desk();
    const r = edit(doc, (d) => (d.root = { kind: "chain", id: "c", steps: [{ kind: "nope" }, { kind: "nah" }, { kind: "emit", id: "ok", value: 1 }] }));
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.error).toMatch(/\(\+1 more\)$/);
  });
});

describe("shapeIssues", () => {
  it("is quiet on every document the builder itself produces", () => {
    expect(shapeIssues(desk().root)).toEqual([]);
    expect(shapeIssues(newDocument().root)).toEqual([]);
    // including the ones the checks strip complains about, like a placeholder where a node was removed
    const root = desk().root as unknown as NodeJson;
    for (const id of allIds(root)) {
      const path = findPath(root, id);
      if (path) expect(shapeIssues(removeAt(root, path)), path).toEqual([]);
    }
  });
});

function findPath(n: NodeJson, id: string, at = "$"): string | null {
  if (n.id === id) return at;
  for (const c of childEdges(n)) {
    const p = findPath(c.node, id, `${at}/${c.edge}`);
    if (p) return p;
  }
  return null;
}
