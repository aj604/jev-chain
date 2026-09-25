import { describe, expect, it } from "vitest";
import { chain, choice, emit, fromJSON, gate, graphOf, noul, parallel, route, toJSON } from "jevchain";
import { editTarget, selectionAfterRemove, vertexFor } from "./selection";
import {
  allIds,
  canDuplicate,
  documentIssues,
  duplicateAt,
  getAt,
  insertAfterPath,
  isPlaceholder,
  newDocument,
  removeAt,
  subtreeSize,
  template,
  withRoot,
  type NodeJson,
} from "./doc-ops";
import { deleteDraft, listDrafts, renameDraft, saveDraft, type Draft, type DraftStore } from "./drafts";
import { COALESCE_MS, HISTORY_LIMIT, historyReducer, initHistory } from "./history";
import {
  addLabel,
  addLevel,
  convertQuestion,
  followLabel,
  freshKey,
  issueMessage,
  issueTarget,
  keyProblem,
  labelsOf,
  levelsOf,
  moveLevel,
  normalizePass,
  removeLabel,
  removeLevel,
  renameKey,
  renameLabel,
  setNoulSide,
  type QuestionJson,
} from "./question-ops";

describe("history", () => {
  it("undoes and redoes", () => {
    let h = initHistory(1);
    h = historyReducer(h, { type: "commit", value: 2 });
    h = historyReducer(h, { type: "commit", value: 3 });
    h = historyReducer(h, { type: "undo" });
    expect(h.present).toBe(2);
    h = historyReducer(h, { type: "undo" });
    expect(h.present).toBe(1);
    expect(historyReducer(h, { type: "undo" })).toBe(h); // nothing left
    h = historyReducer(h, { type: "redo" });
    expect(h.present).toBe(2);
    expect(h.future).toEqual([3]);
  });

  it("a new commit clears redo", () => {
    let h = initHistory("a");
    h = historyReducer(h, { type: "commit", value: "b" });
    h = historyReducer(h, { type: "undo" });
    h = historyReducer(h, { type: "commit", value: "c" });
    expect(h.future).toEqual([]);
    expect(h.past).toEqual(["a"]);
  });

  it("coalesces same-key commits inside the window", () => {
    let h = initHistory("");
    h = historyReducer(h, { type: "commit", value: "h", key: "title", at: 0 });
    h = historyReducer(h, { type: "commit", value: "he", key: "title", at: 100 });
    h = historyReducer(h, { type: "commit", value: "hey", key: "title", at: 200 });
    expect(h.past).toEqual([""]);
    h = historyReducer(h, { type: "commit", value: "hey!", key: "title", at: 200 + COALESCE_MS + 1 });
    expect(h.past).toEqual(["", "hey"]);
    h = historyReducer(h, { type: "commit", value: "x", key: "other", at: 200 + COALESCE_MS + 2 });
    expect(h.past).toEqual(["", "hey", "hey!"]);
  });

  it("ignores no-op commits and caps the stack", () => {
    const h0 = initHistory(0);
    expect(historyReducer(h0, { type: "commit", value: 0 })).toBe(h0);
    let h = h0;
    for (let i = 1; i <= HISTORY_LIMIT + 10; i++) h = historyReducer(h, { type: "commit", value: i });
    expect(h.past).toHaveLength(HISTORY_LIMIT);
  });
});

describe("question ops", () => {
  const q = (): QuestionJson => ({ type: "choice", instructions: "?", criteria: { a: null, b: "bee" } });

  it("renames labels in place and refuses collisions", () => {
    const next = renameLabel(q(), "a", "alpha");
    expect(labelsOf(next)).toEqual(["alpha", "b"]);
    expect(renameLabel(q(), "a", "b")).toEqual(q());
    expect(renameLabel(q(), "a", "")).toEqual(q());
    expect((renameLabel(q(), "b", "c").criteria as Record<string, unknown>).c).toBe("bee");
  });

  it("adds and removes labels, never below two", () => {
    const three = addLabel(q());
    expect(labelsOf(three)).toEqual(["a", "b", "option"]);
    expect(labelsOf(addLabel(three))).toContain("option-2");
    expect(labelsOf(removeLabel(three, "a"))).toEqual(["b", "option"]);
    expect(removeLabel(q(), "a")).toEqual(q());
  });

  it("edits score levels within 2–10", () => {
    let s: QuestionJson = { type: "score", criteria: ["lo", "hi"] };
    expect(removeLevel(s, 0)).toBe(s);
    s = addLevel(s, "mid");
    expect(moveLevel(s, 2, 1).criteria).toEqual(["lo", "mid", "hi"]);
    for (let i = 0; i < 20; i++) s = addLevel(s);
    expect(levelsOf(s)).toHaveLength(10);
  });

  it("converts between types, carrying labels ↔ levels", () => {
    const score = convertQuestion(q(), "score");
    expect(score.criteria).toEqual(["a", "b"]);
    const back = convertQuestion({ type: "score", criteria: ["mild", "spicy", "mild"] }, "choice");
    expect(labelsOf(back)).toEqual(["mild", "spicy", "mild-2"]);
    expect(convertQuestion(q(), "noul")).toEqual({ type: "noul", instructions: "?" });
    expect(labelsOf(convertQuestion({ type: "noul" }, "choice"))).toHaveLength(2);
  });

  it("sets and clears noul descriptions", () => {
    const n = setNoulSide({ type: "noul", instructions: "x" }, "true", "yes means yes");
    expect(n.criteria).toEqual({ true: "yes means yes" });
    expect(setNoulSide(n, "true", "")).toEqual({ type: "noul", instructions: "x" });
  });

  it("normalizes gate thresholds to the question", () => {
    expect(normalizePass(q(), { min: 0.7 })).toEqual({ label: "a", min: 0.7 });
    expect(normalizePass(q(), { label: "b", min: 2 })).toEqual({ label: "b", min: 1 });
    expect(normalizePass({ type: "score", criteria: [1, 2, 3, 4, 5] }, { min: 9 })).toEqual({ min: 4 });
    expect(normalizePass({ type: "noul" }, {})).toEqual({ min: 0.5 });
    expect(followLabel({ label: "a", min: 0.5 }, "a", "alpha")).toEqual({ label: "alpha", min: 0.5 });
  });

  it("checks keys", () => {
    expect(keyProblem("", ["a"])).toMatch(/empty/);
    expect(keyProblem("a", ["a"])).toMatch(/taken/);
    expect(keyProblem("a", ["a"], "a")).toBeNull();
    expect(keyProblem("a/b", [])).toMatch(/slash/);
    expect(freshKey("x", ["x", "x-2"])).toBe("x-3");
    const obj = { a: 1, b: 2, c: 3 };
    expect(Object.keys(renameKey(obj, "b", "z"))).toEqual(["a", "z", "c"]);
    expect(renameKey(obj, "b", "c")).toBe(obj);
  });
});

describe("issue targets", () => {
  it("parses the node path (and tier) off an issue", () => {
    expect(issueTarget('$/0 (route "r"): no branch for "b"')).toEqual({ path: "$/0" });
    expect(issueTarget("$: every node needs a non-empty string id")).toEqual({ path: "$" });
    expect(issueTarget('$/0/b (gate "g").pass: set min and/or max')).toEqual({ path: "$/0/b" });
    expect(issueTarget('$/2 (cascade "c").tiers.quick.minConfidence: expected 0–1')).toEqual({ path: "$/2", tier: "quick" });
    expect(issueTarget("Unsupported format")).toBeNull();
  });

  it("strips the prefix for display", () => {
    expect(issueMessage('$/0 (route "r"): no branch for "b"')).toBe('no branch for "b"');
    expect(issueMessage('$/0/b (gate "g").pass: set min and/or max')).toBe("pass · set min and/or max");
  });
});

describe("structure ops", () => {
  const root = () =>
    toJSON(
      chain(
        "c",
        route("r", { ask: choice("?", ["a", "b"]), branches: { a: emit("A", { id: "ea" }), b: emit("B", { id: "eb" }) } }),
        parallel("p", { branches: { x: emit("X", { id: "ex" }), y: emit("Y", { id: "ey" }) } }),
      ),
    ).root as unknown as NodeJson;

  it("reports where an inserted node lands", () => {
    const inChain = insertAfterPath(root(), "$/0", template("emit"));
    expect(inChain.path).toBe("$/1");
    expect(getAt(inChain.root, inChain.path)!.kind).toBe("emit");
    const wrapped = insertAfterPath(root(), "$/0/a", template("gate"));
    expect(wrapped.path).toBe("$/0/a/1");
    expect(getAt(wrapped.root, wrapped.path)!.kind).toBe("gate");
  });

  it("duplicates into chains and parallels with fresh ids", () => {
    const r = root();
    expect(canDuplicate(r, "$/0")).toBe(true);
    expect(canDuplicate(r, "$/0/a")).toBe(false);
    expect(canDuplicate(r, "$")).toBe(false);
    const dup = duplicateAt(r, "$/0")!;
    expect(dup.path).toBe("$/1");
    expect(getAt(dup.root, "$/1")!.id).toBe("r-copy");
    expect(getAt(dup.root, "$/1/a")!.id).toBe("ea-copy");
    const par = duplicateAt(r, "$/1/x")!;
    expect(Object.keys(getAt(par.root, "$/1")!.branches as object)).toEqual(["x", "x-copy", "y"]);
    const ids = [...allIds(dup.root)];
    expect(new Set(ids).size).toBe(ids.length);
    expect(duplicateAt(r, "$/0/a")).toBeNull();
    expect(documentIssues(withRoot(newDocument(), par.root))).toEqual([]);
  });

  it("counts subtrees and spots placeholders", () => {
    expect(subtreeSize(root())).toBe(7);
    const removed = removeAt(root(), "$/0/a");
    expect(isPlaceholder(getAt(removed, "$/0/a"))).toBe(true);
    expect(isPlaceholder(getAt(removed, "$/0/b"))).toBe(false);
  });

  it("keeps step refs on copies so handlers stay bound", () => {
    const doc = toJSON(chain("c", gate("g", { ask: noul("?"), pass: { min: 0.5 }, then: emit("ok") }), emit("x", { id: "x" })));
    const withStep = insertAfterPath(doc.root as unknown as NodeJson, "$/1", { kind: "step", id: "s", run: { $ref: "s" } });
    const dup = duplicateAt(withStep.root, withStep.path)!;
    expect(withRoot(doc, dup.root).refs).toEqual(["s"]);
  });
});

describe("drafts", () => {
  const memory = (): DraftStore & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
  };
  const draft = (id: string, at: number): Draft => ({ id, name: id, doc: newDocument(id), updatedAt: at });

  it("saves newest first, renames, deletes", () => {
    const store = memory();
    saveDraft(draft("a", 1), store);
    saveDraft(draft("b", 2), store);
    saveDraft({ ...draft("a", 3) }, store);
    expect(listDrafts(store).map((d) => d.id)).toEqual(["a", "b"]);
    renameDraft("b", "bee", store);
    const b = listDrafts(store).find((d) => d.id === "b")!;
    expect(b.name).toBe("bee");
    expect(b.doc.name).toBe("bee");
    deleteDraft("a", store);
    expect(listDrafts(store).map((d) => d.id)).toEqual(["b"]);
  });

  it("survives broken or hostile storage", () => {
    const store = memory();
    store.data.set("jevchain.builder.drafts", "{nope");
    expect(listDrafts(store)).toEqual([]);
    const throwing: DraftStore = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(listDrafts(throwing)).toEqual([]);
    expect(saveDraft(draft("x", 1), throwing)).toBe(false);
    expect(listDrafts(null)).toEqual([]);
  });
});

describe("selection", () => {
  const doc = () =>
    toJSON(
      chain(
        "c",
        gate("g", { ask: noul("?"), pass: { min: 0.5 }, then: emit("T", { id: "t" }) }),
        parallel("p", { branches: { x: emit("X", { id: "ex" }), y: emit("Y", { id: "ey" }) } }),
      ),
    );

  it("maps graph-only vertices to their owner", () => {
    const d = doc();
    const root = d.root as unknown as NodeJson;
    const graph = graphOf(fromJSON(d));
    expect(editTarget(graph, root, "$/0/halt")!.node.id).toBe("g");
    expect(editTarget(graph, root, "$/1#join")!.node.id).toBe("p");
    expect(editTarget(graph, root, "$/1/x")!.path).toBe("$/1/x");
    expect(editTarget(graph, root, "$/nope")).toBeNull();
    expect(editTarget(graph, root, null)).toBeNull();
  });

  it("finds cascade tiers and chain stand-ins", () => {
    const root = template("cascade");
    const d = withRoot(newDocument(), root);
    const graph = graphOf(fromJSON(d, { missingHandlers: "passthrough" }));
    expect(editTarget(graph, root, "$/quick")).toMatchObject({ path: "$", tier: "quick" });
    expect(vertexFor(root, "$", "quick")).toBe("$/quick");
    const c = doc().root as unknown as NodeJson;
    expect(vertexFor(c, "$")).toBe("$/0");
  });

  it("picks something sensible after a delete", () => {
    const root = doc().root as unknown as NodeJson;
    const after = removeAt(root, "$/0");
    expect(selectionAfterRemove(after, "$/0")).toBe("$"); // chain collapsed to the parallel
    const inPar = removeAt(root, "$/1/x");
    expect(selectionAfterRemove(inPar, "$/1/x")).toBe("$/1");
  });
});
