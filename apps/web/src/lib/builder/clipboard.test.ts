import { describe, expect, it, vi } from "vitest";
import { chain, choice, emit, gate, noul, route, toJSON } from "jevchain";
import { clipboard, pasteAt, withUniqueIds } from "./clipboard";
import { allIds, childEdges, documentIssues, getAt, newDocument, PLACEHOLDER, removeAt, template, withRoot, type NodeJson } from "./doc-ops";

// A route whose "b" branch is a gate: $ = route r, $/b = gate g, $/b/then = t.
const desk = () =>
  toJSON(
    route("r", {
      ask: choice("?", ["a", "b"]),
      branches: {
        a: emit("A", { id: "ea" }),
        b: gate("g", { ask: noul("?"), pass: { min: 0.5 }, then: emit("T", { id: "t" }), otherwise: emit("F", { id: "f" }) }),
      },
    }),
  ).root as unknown as NodeJson;

const idList = (n: NodeJson): string[] => [n.id, ...childEdges(n).flatMap((c) => idList(c.node))];
const valid = (root: NodeJson) => expect(documentIssues(withRoot(newDocument(), root))).toEqual([]);

describe("withUniqueIds", () => {
  it("keeps free ids and renames taken ones, all the way down", () => {
    const g = getAt(desk(), "$/b")!;
    expect(withUniqueIds(g, new Set())).toBe(g); // nothing to rename → same object
    const taken = new Set(["g", "t"]);
    const out = withUniqueIds(g, taken);
    expect(out.id).toBe("g-copy");
    expect((out.then as NodeJson).id).toBe("t-copy");
    expect((out.otherwise as NodeJson).id).toBe("f");
    expect(taken).toEqual(new Set(["g", "t", "g-copy", "t-copy", "f"]));
    expect(g.id).toBe("g"); // input untouched
  });

  it("counts up past existing copies and dedupes inside the node", () => {
    const twins = toJSON(chain("c", emit("x", { id: "e" }), emit("y", { id: "e" }))).root as unknown as NodeJson;
    const out = withUniqueIds(twins, new Set(["c", "c-copy"]));
    expect(out.id).toBe("c-copy-2");
    expect(((out.steps as NodeJson[]) ?? []).map((s) => s.id)).toEqual(["e", "e-copy"]);
  });
});

describe("pasteAt", () => {
  it("cut then paste into a placeholder moves the subtree, ids intact", () => {
    const root = desk();
    const gate = getAt(root, "$/b")!;
    const cut = removeAt(root, "$/b"); // route branch → placeholder
    expect(getAt(cut, "$/b")!.value).toBe(PLACEHOLDER);
    const moved = pasteAt(cut, "$/a", gate, "replace");
    expect(moved.path).toBe("$/a");
    expect(getAt(moved.root, "$/a")).toBe(gate); // same subtree, not renamed
    valid(moved.root);
  });

  it("copy then paste renames whatever would collide", () => {
    const root = desk();
    const r = pasteAt(root, "$/a", getAt(root, "$/b")!, "replace");
    expect(getAt(r.root, "$/a")!.id).toBe("g-copy");
    expect(getAt(r.root, "$/a/then")!.id).toBe("t-copy");
    expect(getAt(r.root, "$/b")!.id).toBe("g"); // original left alone
    expect(idList(r.root)).toHaveLength(allIds(r.root).size); // no duplicates
    valid(r.root);
  });

  it("replacing frees the outgoing subtree's ids", () => {
    const root = desk();
    // paste a copy of the gate over itself: its own ids are going away, so nothing needs renaming
    const r = pasteAt(root, "$/b", getAt(root, "$/b")!, "replace");
    expect(getAt(r.root, "$/b")!.id).toBe("g");
  });

  it("after / before follow the add-node rules and report where it landed", () => {
    const root = desk();
    const leaf = template("emit");
    const after = pasteAt(root, "$/b/then", leaf, "after");
    expect(after.path).toBe("$/b/then/1");
    expect(getAt(after.root, "$/b/then")!.kind).toBe("chain");
    expect(getAt(after.root, after.path)).toBe(leaf);
    const before = pasteAt(root, "$/b/then", leaf, "before");
    expect(before.path).toBe("$/b/then/0");
    expect(getAt(before.root, "$/b/then/1")!.id).toBe("t");
    valid(after.root);
    valid(before.root);
  });

  it("with no target goes at the end or start of the whole chain", () => {
    const root = toJSON(chain("c", emit("x", { id: "x" }), emit("y", { id: "y" }))).root as unknown as NodeJson;
    const leaf = template("emit");
    expect(pasteAt(root, null, leaf, "after").path).toBe("$/2");
    expect(pasteAt(root, null, leaf, "before").path).toBe("$/0");
  });

  it("wraps the root: cut it, pick a gate, paste it over the gate's then", () => {
    const root = desk();
    const clip = root;
    const blank = removeAt(root, "$"); // root → placeholder
    const g = template("gate", allIds(blank));
    const wrapped = pasteAt(g, "$/then", clip, "replace");
    expect(getAt(wrapped.root, "$/then")!.id).toBe("r");
    expect(getAt(wrapped.root, "$/then/b/then")!.id).toBe("t");
    valid(wrapped.root);
  });
});

describe("clipboard store", () => {
  it("holds one clip and tells subscribers", () => {
    const seen = vi.fn();
    const off = clipboard.subscribe(seen);
    const node = template("emit");
    clipboard.set(node, "cut");
    expect(clipboard.get()).toEqual({ node, via: "cut" });
    clipboard.clear();
    expect(clipboard.get()).toBeNull();
    off();
    clipboard.set(node, "copy");
    expect(seen).toHaveBeenCalledTimes(2);
    clipboard.clear();
  });
});
