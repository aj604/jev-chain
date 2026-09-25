import { describe, expect, it } from "vitest";
import { graphOf, fromJSON, toJSON, route, choice, emit, chain, gate, noul } from "jevchain";
import {
  allIds,
  documentIssues,
  getAt,
  insertAfter,
  newDocument,
  parentOf,
  removeAt,
  replaceKind,
  syncRouteBranches,
  template,
  updateAt,
  withRoot,
  type BuilderKind,
  type NodeJson,
} from "./doc-ops";

const sample = () =>
  toJSON(
    chain(
      "c",
      route("r", {
        ask: choice("?", ["a", "b"]),
        branches: {
          a: emit("A", { id: "ea" }),
          b: gate("g", { ask: noul("?"), pass: { min: 0.5 }, then: emit("T", { id: "t" }), otherwise: emit("F", { id: "f" }) }),
        },
      }),
      emit("end", { id: "end" }),
    ),
  ).root as unknown as NodeJson;

describe("paths", () => {
  it("resolves the same paths the graph uses", () => {
    const root = sample();
    const doc = { ...newDocument(), root: root as never };
    const graphIds = graphOf(fromJSON(doc)).vertices.filter((v) => v.kind !== "halt" && v.kind !== "join" && v.kind !== "tier").map((v) => v.id);
    for (const id of graphIds) expect(getAt(root, id), id).toBeDefined();
    expect(getAt(root, "$/0/b/then")!.id).toBe("t");
    expect(parentOf("$/0/b/then")).toEqual({ parent: "$/0/b", edge: "then" });
    expect(parentOf("$")).toBeNull();
  });

  it("updates immutably", () => {
    const root = sample();
    const next = updateAt(root, "$/0/b/then", (n) => ({ ...n, value: "changed" }));
    expect(getAt(next, "$/0/b/then")!.value).toBe("changed");
    expect(getAt(root, "$/0/b/then")!.value).toBe("T");
    expect(getAt(next, "$/0/a")).toBe(getAt(root, "$/0/a")); // untouched subtrees are shared
  });
});

describe("templates", () => {
  it("every kind is valid out of the box (steps pass through)", () => {
    for (const kind of ["ask", "route", "gate", "parallel", "cascade", "step", "emit", "chain"] as BuilderKind[]) {
      const doc = withRoot(newDocument(), template(kind));
      expect(documentIssues(doc), kind).toEqual([]);
    }
  });
});

describe("edits", () => {
  it("syncs route branches with labels, keeping renamed subtrees", () => {
    const root = sample();
    const r = getAt(root, "$/0")!;
    const next = syncRouteBranches(r, ["a", "b"], ["a", "bee", "c"], allIds(root));
    const branches = next.branches as Record<string, NodeJson>;
    expect(Object.keys(branches)).toEqual(["a", "bee", "c"]);
    expect(branches.bee!.id).toBe("g");
    expect(branches.c!.kind).toBe("emit");
  });

  it("inserts into chains or wraps in a new one", () => {
    const root = sample();
    const inChain = insertAfter(root, "$/0", template("emit"));
    expect((inChain.steps as unknown[]).length).toBe(3);
    const wrapped = insertAfter(root, "$/0/a", template("emit"));
    expect(getAt(wrapped, "$/0/a")!.kind).toBe("chain");
    expect(getAt(wrapped, "$/0/a/0")!.id).toBe("ea");
  });

  it("removes cleanly", () => {
    const root = sample();
    const noOtherwise = removeAt(root, "$/0/b/otherwise");
    expect(getAt(noOtherwise, "$/0/b")!.otherwise).toBeUndefined();
    const collapsed = removeAt(root, "$/1");
    expect(collapsed.kind).toBe("route"); // one-step chain collapses
    const placeholder = removeAt(root, "$/0/a");
    expect(getAt(placeholder, "$/0/a")!.kind).toBe("emit");
    expect(documentIssues(withRoot(newDocument(), placeholder))).toEqual([]);
  });

  it("replaces kinds and tracks refs", () => {
    const root = replaceKind(sample(), "$/1", "step");
    const doc = withRoot(newDocument(), root);
    expect(doc.refs).toHaveLength(1);
    expect(documentIssues(doc)).toEqual([]);
  });

  it("reports issues", () => {
    const root = updateAt(sample(), "$/0", (r) => ({ ...r, branches: { a: (r.branches as Record<string, NodeJson>).a } }));
    expect(documentIssues(withRoot(newDocument(), root))[0]).toMatch(/no branch for "b"/);
  });
});
