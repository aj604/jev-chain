/**
 * The json tab's gate, tested the systematic way: take every example, mutate
 * every field at every depth (delete it, or set it to null, a number, a
 * string, a list, an object, a boolean, `{ a: null }`), and for each mutation
 * `readDocumentEdit` accepts, run it through everything build mode does with
 * a document: the canvas (graph, hints, layout, node cards), the checks strip,
 * the property editor for every vertex, the document panel, the code drawer,
 * the structural edits, the data-flow warnings and their fixes, and a draft
 * save + reload. A mutation must either be
 * refused or survive all of it.
 */
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ask, cascade, chain, choice, emit, gate, graphOf, noul, overlayTrace, parallel, route, score, step, toJSON, toTypeScript, type AnyNode, type ChainDocument, type Json } from "jevchain";
import { examples } from "jevchain-examples";
import { ReactFlowProvider } from "@xyflow/react";
import { CodeDrawer } from "@/components/builder/code-drawer";
import { IssuesPanel } from "@/components/builder/issues-panel";
import { DocumentEditor, PropertyEditor } from "@/components/builder/property-editor";
import { TraceNode } from "@/components/trace/graph-node";
import { resolveChain } from "@/lib/trace/chain-source";
import { layoutGraph, nodeSize, vertexHints } from "@/lib/trace/layout";
import { pasteAt } from "./clipboard";
import { flowWarnings, inputAt } from "./data-flow";
import {
  allIds,
  canDuplicate,
  canMove,
  childEdges,
  duplicateAt,
  getAt,
  insertAfterPath,
  insertBeforePath,
  moveStep,
  removeAt,
  replaceKind,
  subtreeSize,
  template,
  updateAt,
  withRoot,
  type NodeJson,
} from "./doc-ops";
import { listDrafts, saveDraft, type DraftStore } from "./drafts";
import { formatDocument, readDocumentEdit } from "./json-edit";
import { issueMessage, issueTarget } from "./question-ops";
import { editTarget, selectionAfterRemove, vertexFor } from "./selection";

type Mutation = { label: string; doc: unknown };

const VALUES: [string, unknown][] = [
  ["null", null],
  ["number", 7],
  ["negative", -1],
  ["string", "x"],
  ["empty string", ""],
  ["list", []],
  ["list of null", [null]],
  ["object", {}],
  ["boolean", true],
  ["{a:null}", { a: null }],
];

/** Every mutation of every value inside `doc` (the whole document, root and meta alike). */
function mutations(doc: ChainDocument): Mutation[] {
  const out: Mutation[] = [];
  const visit = (value: unknown, trail: (string | number)[]) => {
    if (trail.length) {
      const where = trail.join(".");
      out.push({ label: `delete ${where}`, doc: mutate(doc, trail, undefined) });
      for (const [name, v] of VALUES) out.push({ label: `${where} = ${name}`, doc: mutate(doc, trail, v) });
    }
    if (value && typeof value === "object") for (const [k, v] of Object.entries(value)) visit(v, [...trail, Array.isArray(value) ? Number(k) : k]);
  };
  visit(doc, []);
  return out;
}

function mutate(doc: ChainDocument, trail: (string | number)[], value: unknown): unknown {
  const copy = structuredClone(doc) as unknown as Record<string, unknown>;
  let cur = copy as Record<string | number, unknown>;
  for (const k of trail.slice(0, -1)) cur = cur[k] as Record<string | number, unknown>;
  const last = trail[trail.length - 1]!;
  if (value === undefined) {
    if (Array.isArray(cur)) cur.splice(Number(last), 1);
    else delete cur[last];
  } else cur[last] = value;
  return copy;
}

const noop = () => {};
const memoryStore = (): DraftStore => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
};

/** Everything build mode does with an applied document. Throws on the first thing that breaks. */
function exercise(doc: ChainDocument) {
  const root = doc.root as unknown as NodeJson;
  const issues = resolveChain({ kind: "doc", doc, handlers: {} });
  const list = issues.ok ? [] : issues.issues;
  for (const i of list) {
    issueTarget(i);
    issueMessage(i);
  }
  const warnings = flowWarnings(root);
  renderToString(createElement(IssuesPanel, { issues: list, warnings, onPick: noop, onFix: noop }));

  // the canvas: studio falls back to an empty graph if graphOf throws, so only what follows it matters
  let graph;
  try {
    graph = graphOf(root as unknown as AnyNode);
  } catch {
    graph = { vertices: [], edges: [], entry: "" };
  }
  const hints = vertexHints(root as unknown as AnyNode, graph);
  const sizeOf = (v: Parameters<typeof nodeSize>[0] & { id: string }) => nodeSize(v, hints[v.id]);
  layoutGraph(graph, sizeOf, "LR");
  layoutGraph(graph, sizeOf, "TB");
  const overlay = overlayTrace(graph, undefined);
  for (const v of graph.vertices) {
    const data = { vertex: v, hint: hints[v.id] ?? {}, overlay: overlay.vertices[v.id] ?? { state: "idle" as const }, selected: false, compact: false, direction: "LR" as const };
    renderToString(createElement(ReactFlowProvider, null, createElement(TraceNode, { id: v.id, data, type: "trace" } as never)));
  }

  // the property editor, for every vertex (and so every node, and every cascade tier)
  const ids = new Map<string, number>();
  const count = (n: NodeJson) => {
    ids.set(n.id, (ids.get(n.id) ?? 0) + 1);
    for (const c of childEdges(n)) count(c.node);
  };
  count(root);
  const targets = [...graph.vertices.map((v) => editTarget(graph, root, v.id)), ...paths(root).map((p) => editTarget(graph, root, p))];
  for (const t of targets) {
    if (!t) continue;
    renderToString(
      createElement(PropertyEditor, {
        node: t.node,
        path: t.path,
        ...(t.tier ? { tier: t.tier } : {}),
        ids,
        handlers: {},
        update: noop,
        taken: () => allIds(root),
        onSelect: noop,
        confirmRemove: noop,
        actions: null,
        flow: { input: inputAt(root, t.path), warnings: warnings.filter((w) => w.path === t.path), onFix: noop },
      }),
    );
  }
  renderToString(
    createElement(
      DocumentEditor,
      { name: doc.name ?? "", description: doc.description ?? "", examples: doc.examples ?? [], onName: noop, onDescription: noop, onRemoveExample: noop },
      null,
    ),
  );

  // the code drawer, both tabs
  renderToString(createElement(CodeDrawer, { doc, onClose: noop, draft: null, setDraft: noop, onApply: noop }));
  renderToString(createElement(CodeDrawer, { doc, onClose: noop, draft: { text: formatDocument(doc), base: doc }, setDraft: noop, onApply: noop }));
  try {
    toTypeScript(doc);
  } catch {
    // the drawer catches this and shows a comment
  }

  // structural edits on every node
  for (const p of paths(root)) {
    vertexFor(root, p);
    selectionAfterRemove(removeAt(root, p), p);
    insertAfterPath(root, p, template("emit"));
    insertBeforePath(root, p, template("emit"));
    if (canDuplicate(root, p)) duplicateAt(root, p);
    if (canMove(root, p, 1)) moveStep(root, p, 1);
    replaceKind(root, p, "gate");
    pasteAt(root, p, root, "replace");
    subtreeSize(root);
  }
  withRoot(doc, root);

  // every data-flow fix makes a document the json tab still takes, that jevchain likes no less, and that clears its warning
  for (const w of warnings) {
    for (const f of w.fixes) {
      const fixed = withRoot(doc, updateAt(root, f.at ?? w.path, f.node));
      if (!readDocumentEdit(JSON.stringify(fixed), doc).ok) throw new Error(`fix "${f.label}" at ${w.path} made a document the json tab refuses`);
      const after = resolveChain({ kind: "doc", doc: fixed, handlers: {} });
      if (!after.ok && after.issues.length > list.length) throw new Error(`fix "${f.label}" at ${w.path} added issues: ${after.issues.join("; ")}`);
      const fixedRoot = fixed.root as unknown as NodeJson;
      // a fix that reshapes the chain moves what follows into the flagged slot, so it's the flagged node that must be clear
      const was = getAt(root, w.path)!.id;
      if (flowWarnings(fixedRoot).some((x) => x.path === w.path && x.tier === w.tier && x.rule === w.rule && getAt(fixedRoot, x.path)?.id === was)) throw new Error(`fix "${f.label}" at ${w.path} didn't clear its warning`);
      if (f.select && !getAt(fixedRoot, f.select)) throw new Error(`fix "${f.label}" at ${w.path} selects ${f.select}, which isn't there`);
    }
  }

  // a draft save and reload
  const store = memoryStore();
  saveDraft({ id: "d", name: doc.name?.trim() || "untitled chain", doc, updatedAt: 1 }, store);
  const back = listDrafts(store);
  if (back.length !== 1) throw new Error("draft didn't reload");
}

function paths(root: NodeJson, at = "$"): string[] {
  return [at, ...childEdges(root).flatMap((c) => paths(c.node, `${at}/${c.edge}`))];
}

/** Every kind with every optional field set, so fields the examples leave out get mutated too. */
const kitchenSink = () =>
  toJSON(
    chain(
      "all",
      ask("a", { title: "A", description: "asks", state: "{{input}}", model: "jev-x", questions: { tone: choice("tone?", { calm: "chill", mad: null }), n: noul("?", { true: "yes", false: ["no"] }) } }),
      route("r", {
        ask: choice({ task: "which?" }, ["x", "y"]),
        alsoAsk: { s: score("how?", ["lo", "mid", "hi"]) },
        state: (i: unknown) => String(i),
        branches: {
          x: gate("g", {
            ask: choice("?", ["ok", "no"]),
            pass: { label: "ok", min: 0.2, max: 0.9 },
            then: parallel("p", { branches: { u: step("s", (i: unknown) => i, { timeoutMs: 100, retries: 2, ref: "sref" }), v: emit({ obj: [1, "two"] }, { id: "ev" }) }, join: (res: unknown) => res }),
            otherwise: gate("g2", { ask: score("?", ["a", "b", "c"]), pass: { min: 1 }, then: emit("t", { id: "t2" }) }),
            unsure: { margin: 0.1, minConfidence: 0.6, then: emit("u", { id: "u" }) },
          }),
          y: cascade("c", { tiers: [{ id: "t1", title: "first", ask: noul("?"), minConfidence: 0.8, state: "{{input}}", model: "m" }], fallback: emit(null, { id: "f" }) }),
        },
        lowConfidence: { below: 0.3, then: emit("lc", { id: "lc" }) },
      }),
    ),
    { name: "kitchen sink", description: "every field", examples: ["hi", { a: 1 }] },
  );

/** A chain a newcomer might build, full of data-flow warnings, so their fixes get mutated too. */
const surprises = () =>
  toJSON(
    chain(
      "flow",
      ask("read", { questions: { vibe: choice("?", ["good", "bad"]), lvl: score("?", ["lo", "hi"]) } }),
      route("then-route", {
        ask: choice("which?", ["x", "y"]),
        branches: {
          x: emit({ who: "{{input.user}}", said: ["{{input.vibe.choice}}", "{{input.message}}"] }, { id: "ex" }),
          y: gate("then-gate", { ask: noul("?"), state: "about {{input.message}}", pass: { min: 0.5 }, then: emit("ok {{input.nope}}", { id: "ey" }) }),
        },
      }),
      cascade("then-cascade", { tiers: [{ id: "t1", ask: noul("?"), minConfidence: 0.8 }, { id: "t2", ask: noul("?"), minConfidence: 0.5, state: "{{input.nah}}" }], fallback: emit("f", { id: "cf" }) }),
    ),
    { name: "surprises" },
  );

/** The same newcomer after taking the "read the run input" fixes: every step's output is thrown away by the next. */
const deadEnds = () =>
  toJSON(
    chain(
      "dead-ends",
      ask("read", { questions: { vibe: choice("?", ["good", "bad"]) } }),
      gate("spam", { ask: noul("spam?"), state: "{{run.message}}", pass: { max: 0.5 }, then: route("inner", { ask: choice("?", ["a", "b"]), state: "{{run}}", branches: { a: emit("A", { id: "ia" }), b: emit("B", { id: "ib" }) } }), otherwise: emit("blocked", { id: "blocked" }) }),
      parallel("both", { branches: { x: ask("px", { state: "{{run}}", questions: { q: noul("?") } }), y: emit("y", { id: "py" }) } }),
      cascade("tiers", { tiers: [{ id: "t1", ask: noul("?"), minConfidence: 0.8, state: "{{run}}" }], fallback: emit("f", { id: "cf" }) }),
      route("tone", { ask: choice("tone?", ["calm", "mad"]), state: "{{run}}", branches: { calm: emit("calm", { id: "rc" }), mad: emit("mad", { id: "rm" }) } }),
      emit({ done: true, who: "{{run.user}}" }, { id: "done" }),
    ),
    { name: "dead ends" },
  );

const docs = [
  ...examples.map((e) => ({ slug: e.slug, doc: toJSON(e.chain, { name: e.title, description: e.tagline, examples: e.inputs.map((i) => i.value as Json) }) })),
  { slug: "kitchen-sink", doc: kitchenSink() },
  { slug: "surprises", doc: surprises() },
  { slug: "dead-ends", doc: deadEnds() },
];

describe("the json tab's gate, against every example mutated every way", () => {
  it("the surprises fixture really is full of data-flow warnings", () => {
    const ws = flowWarnings(surprises().root as unknown as NodeJson);
    expect(ws.map((w) => `${w.path}${w.tier ? `/${w.tier}` : ""} ${w.rule}`)).toEqual([
      "$/1 implicit-state",
      "$/1/x missing-field",
      "$/1/y missing-field",
      "$/1/y/then missing-field",
      "$/2/t1 implicit-state",
      "$/2/t2 missing-field",
    ]);
  });

  it("the dead-ends fixture really is full of unused outputs", () => {
    const ws = flowWarnings(deadEnds().root as unknown as NodeJson);
    expect(ws.map((w) => `${w.path} ${w.rule} ${w.fixes.length}`)).toEqual([
      "$/0 unused-output 1",
      "$/1 unused-output 2",
      "$/2 unused-output 1",
      "$/3 unused-output 1",
      "$/4 unused-output 1",
    ]);
  });

  it("each example is accepted untouched and survives the whole build mode", () => {
    for (const { slug, doc } of docs) {
      const r = readDocumentEdit(formatDocument(doc), doc);
      expect(r.ok, slug).toBe(true);
      if (r.ok) expect(() => exercise(r.doc), slug).not.toThrow();
    }
  });

  it("every mutation is either refused or survives the whole build mode", () => {
    const failures: string[] = [];
    const kinds = new Set<string>();
    const fields = new Set<string>();
    let total = 0;
    let refused = 0;
    for (const { slug, doc } of docs) {
      for (const n of paths(doc.root as unknown as NodeJson)) kinds.add(String((getAt(doc.root as unknown as NodeJson, n) ?? {}).kind));
      for (const m of mutations(doc)) {
        total++;
        fields.add(m.label.replace(/^delete /, "").replace(/ = .*$/, "").split(".").pop()!);
        const r = readDocumentEdit(JSON.stringify(m.doc), doc);
        if (!r.ok) {
          refused++;
          continue;
        }
        try {
          exercise(r.doc);
        } catch (e) {
          failures.push(`${slug}: ${m.label} → ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
        }
      }
    }
    console.info(`json-edit mutations: ${total} tried across ${docs.length} documents, ${kinds.size} node kinds, ${fields.size} distinct field names; ${refused} refused, ${total - refused} accepted and exercised, ${failures.length} broke build mode`);
    expect([...kinds].sort()).toEqual(["ask", "cascade", "chain", "emit", "gate", "parallel", "route", "step"]);
    expect(total).toBeGreaterThan(2000);
    expect(failures).toEqual([]);
  }, 120_000);

  it("refuses nesting too deep to walk, without overflowing the stack", () => {
    const doc = docs[0]!.doc;
    // built as text: JSON.stringify itself would overflow on these
    const withRootText = (root: string) => JSON.stringify({ ...doc, root: 0 }).replace('"root":0', `"root":${root}`);
    const n = 5000;
    const chains = '{"kind":"chain","id":"c","steps":['.repeat(n) + '{"kind":"emit","id":"e","value":"x"}' + "]}".repeat(n);
    expect(readDocumentEdit(withRootText(chains), doc)).toMatchObject({ ok: false, error: expect.stringMatching(/nested/) });
    const lists = `{"kind":"emit","id":"e","value":${"[".repeat(20000)}"x"${"]".repeat(20000)}}`;
    expect(readDocumentEdit(withRootText(lists), doc)).toMatchObject({ ok: false, error: expect.stringMatching(/nested/) });
    // a realistically deep chain is fine
    const ok = '{"kind":"chain","id":"c","steps":['.repeat(40) + '{"kind":"emit","id":"e","value":"x"}' + "]}".repeat(40);
    expect(readDocumentEdit(withRootText(ok), doc)).toMatchObject({ ok: true });
  });
});
