import { describe, expect, it } from "vitest";
import { ask, cascade, chain, choice, emit, fromJSON, gate, noul, parallel, route, run, score, step, toJSON, type ChainDocument, type Entry, type JevClient, type Json, type Questions } from "jevchain";
import { examples } from "jevchain-examples";
import { convertKind, describeChange, losesWork } from "./convert-kind";
import { flowWarnings } from "./data-flow";
import { allIds, childEdges, documentIssues, getAt, isPlaceholder, newDocument, PLACEHOLDER, withRoot, type BuilderKind, type NodeJson } from "./doc-ops";
import { readDocumentEdit } from "./json-edit";
import { readsIn } from "./reads";

const KINDS: BuilderKind[] = ["ask", "route", "gate", "parallel", "cascade", "step", "emit", "chain"];
const asRoot = (node: Parameters<typeof toJSON>[0]) => toJSON(node).root as unknown as NodeJson;
const at = (root: NodeJson, path: string) => getAt(root, path)!;
/** What stops a document loading, bar the fixture's parallel join (a function, so it's a handler the test doesn't bind). */
const issuesOf = (doc: ChainDocument) => documentIssues(doc).filter((i) => !i.includes('missing handler "both.join"'));

/** Every shape a node can take: questions of each type, alsoAsk, lowConfidence, unsure, a join, tier state, a step handler, reads between them. */
const everything = () =>
  asRoot(
    chain(
      "everything",
      ask("read", { questions: { vibe: choice("?", ["good", "bad"]), spicy: noul("spicy?", { true: "hot", false: "mild" }), rate: score("how much?", ["none", "some", "lots"]) } }),
      route("triage", {
        ask: choice("where?", { bug: "it's broken", billing: "money", other: null }),
        alsoAsk: { urgent: noul("urgent?") },
        state: "{{input.vibe.choice}}",
        model: "jev-1.13.0",
        branches: {
          bug: gate("sure", { ask: noul("is it?", { true: "yes it is" }), pass: { min: 0.7 }, then: emit("fix it", { id: "fix" }), otherwise: emit("nah", { id: "nah" }), unsure: { minConfidence: 0.4, then: emit("hmm", { id: "hmm" }) } }),
          billing: gate("pick", { ask: choice("which?", ["refund", "credit"]), pass: { label: "credit", min: 0.6 }, then: emit("credit", { id: "credit" }) }),
          other: gate("rated", { ask: score("how bad?", ["fine", "meh", "awful"]), pass: { min: 1.5 }, then: emit("bad", { id: "bad" }), otherwise: emit("ok", { id: "ok" }) }),
        },
        lowConfidence: { below: 0.3, then: emit("ask a human", { id: "human" }) },
      }),
      parallel("both", { branches: { x: step("lookup", (i: unknown) => i), y: emit("{{results.triage}}", { id: "echo" }) }, join: (r: unknown) => r }),
      cascade("tiers", { tiers: [{ id: "quick", ask: noul("fine?"), minConfidence: 0.8, state: "{{run}}" }, { id: "careful", ask: noul("really fine?"), minConfidence: 0.5 }], fallback: emit("a person", { id: "person" }) }),
      emit({ done: "{{results.read.vibe.choice}}", how: "{{results.tiers}}" }, { id: "done" }),
    ),
  );

function paths(root: NodeJson, p = "$"): string[] {
  const n = getAt(root, p)!;
  return [p, ...childEdges(n).flatMap((c) => paths(root, `${p}/${c.edge}`))];
}

function idsUnder(node: NodeJson, out: string[] = []): string[] {
  if (!isPlaceholder(node)) out.push(node.id);
  for (const c of childEdges(node)) idsUnder(c.node, out);
  return out;
}

function nodeCount(node: NodeJson): number {
  return 1 + childEdges(node).reduce((n, c) => n + nodeCount(c.node), 0);
}

describe("changing a node's kind keeps what the new kind has room for", () => {
  it("a route becomes a gate: same id, same question, the first two branches as then/otherwise, low confidence as unsure", () => {
    const root = everything();
    const c = convertKind(root, "$/1", "gate");
    const g = at(c.root, "$/1");
    expect(g).toMatchObject({
      kind: "gate",
      id: "triage",
      state: "{{input.vibe.choice}}",
      model: "jev-1.13.0",
      ask: { type: "choice", instructions: "where?", criteria: { bug: "it's broken", billing: "money", other: null } },
      alsoAsk: { urgent: { type: "noul" } },
      pass: { label: "bug", min: 0.5 },
      unsure: { minConfidence: 0.3, then: { id: "human" } },
    });
    expect((g.then as NodeJson).id).toBe("sure");
    expect((g.otherwise as NodeJson).id).toBe("pick");
    expect(g.branches).toBeUndefined();
    expect(g.lowConfidence).toBeUndefined();
    expect(c.dropped).toEqual([{ what: 'branch "other"', nodes: 3 }]);
    expect(describeChange(c)).toBe("keeps 2 questions, 2 paths, the low-confidence path (as unsure) · drops 3 nodes");
    expect(issuesOf(withRoot(newDocument(), c.root))).toEqual([]);
  });

  it("a noul gate becomes a route on yes / no: then → yes, otherwise → no, unsure → low confidence, and the noul's descriptions come along", () => {
    const c = convertKind(everything(), "$/1/bug", "route");
    const r = at(c.root, "$/1/bug");
    expect(r).toMatchObject({ kind: "route", id: "sure", ask: { type: "choice", instructions: "is it?", criteria: { yes: "yes it is", no: null } }, lowConfidence: { below: 0.4, then: { id: "hmm" } } });
    expect(Object.fromEntries(Object.entries(r.branches as Record<string, NodeJson>).map(([k, v]) => [k, v.id]))).toEqual({ yes: "fix", no: "nah" });
    expect(losesWork(c)).toBe(false);
  });

  it("a choice gate becomes a route whose measured label gets the then path", () => {
    const c = convertKind(everything(), "$/1/billing", "route");
    const r = at(c.root, "$/1/billing");
    // `then` has no label to match, so it lands in order; the missing otherwise leaves a placeholder
    expect(Object.keys(r.branches as object)).toEqual(["refund", "credit"]);
    expect(Object.values(r.branches as Record<string, NodeJson>).map((n) => (isPlaceholder(n) ? "placeholder" : n.id))).toEqual(["credit", "placeholder"]);
  });

  it("a route with two labels survives route → gate → route unchanged", () => {
    const two = asRoot(route("r", { ask: choice("?", ["a", "b"]), state: "{{input}}", branches: { a: emit("A", { id: "ea" }), b: emit("B", { id: "eb" }) }, lowConfidence: { below: 0.2, then: emit("L", { id: "el" }) } }));
    const back = convertKind(convertKind(two, "$", "gate").root, "$", "route").root;
    expect(back).toEqual(two);
  });

  it("…and runs exactly like it as a gate, low confidence and all, on the real runtime", async () => {
    const two = asRoot(
      chain("c", route("r", { ask: choice("?", ["a", "b"]), branches: { a: emit("A {{input}}", { id: "ea" }), b: emit("B", { id: "eb" }) }, lowConfidence: { below: 0.5, then: emit("L", { id: "el" }) } }), emit("{{results.r}}!", { id: "tail" })),
    );
    const asGate = convertKind(two, "$/0", "gate").root;
    const outcomes = new Set<string>();
    for (let seed = 0; seed < 40; seed++) {
      for (const input of ["x", { m: 1 }, ""]) {
        const a = await run(fromJSON(withRoot(newDocument(), two), { missingHandlers: "passthrough" }), input, { jev: hashJev(seed) });
        const b = await run(fromJSON(withRoot(newDocument(), asGate), { missingHandlers: "passthrough" }), input, { jev: hashJev(seed) });
        expect(b.status).toBe(a.status);
        expect(b.status === "ok" && b.output).toEqual(a.status === "ok" && a.output);
        outcomes.add(String(a.status === "ok" && a.output).slice(0, 1));
      }
    }
    expect(outcomes.size).toBe(3); // every path got taken
  });

  it("an ask's questions become a route's question + alsoAsk (the first choice decides), and come back", () => {
    const root = everything();
    const c = convertKind(root, "$/0", "route");
    const r = at(c.root, "$/0");
    expect(r.ask).toEqual({ type: "choice", instructions: "?", criteria: { good: null, bad: null } });
    expect(Object.keys(r.alsoAsk as object)).toEqual(["spicy", "rate"]);
    expect(Object.keys(r.branches as object)).toEqual(["good", "bad"]);
    expect(losesWork(c)).toBe(false);
    const back = at(convertKind(c.root, "$/0", "ask").root, "$/0");
    expect(back.questions).toEqual({ decision: (at(root, "$/0").questions as Record<string, unknown>).vibe, spicy: (at(root, "$/0").questions as Record<string, unknown>).spicy, rate: (at(root, "$/0").questions as Record<string, unknown>).rate });
  });

  it("a noul or score question turns into a choice when it has to decide a route", () => {
    const noulAsk = asRoot(ask("q", { questions: { spicy: noul("spicy?", { true: "hot", false: "mild" }) } }));
    expect(at(convertKind(noulAsk, "$", "route").root, "$").ask).toEqual({ type: "choice", instructions: "spicy?", criteria: { yes: "hot", no: "mild" } });
    const scoreAsk = asRoot(ask("q", { questions: { rate: score("how much?", ["none", "some", "lots"]) } }));
    expect(Object.keys((at(convertKind(scoreAsk, "$", "route").root, "$").ask as { criteria: object }).criteria)).toEqual(["none", "some", "lots"]);
  });

  it("questions become cascade tiers (keeping tier state), and a gate's unsure path becomes the fallback", () => {
    const root = everything();
    const c = convertKind(root, "$/1/bug", "cascade");
    const n = at(c.root, "$/1/bug");
    expect(n.tiers).toEqual([{ id: "decision", ask: { type: "noul", instructions: "is it?", criteria: { true: "yes it is" } }, minConfidence: 0.8 }]);
    expect((n.fallback as NodeJson).id).toBe("hmm");
    expect(c.dropped).toEqual([
      { what: "the then path", nodes: 1 },
      { what: "the otherwise path", nodes: 1 },
    ]);
    const asAsk = at(convertKind(root, "$/3", "ask").root, "$/3");
    expect(Object.keys(asAsk.questions as object)).toEqual(["quick", "careful"]);
    expect(asAsk.state).toBe("{{run}}");
  });

  it("a parallel's branches become a chain's steps and back; the join is reported as dropped", () => {
    const root = everything();
    const c = convertKind(root, "$/2", "chain");
    expect(c.dropped).toEqual([{ what: "the join", nodes: 0 }]);
    const n = at(c.root, "$/2");
    expect((n.steps as NodeJson[]).map((s) => s.id)).toEqual(["lookup", "echo"]);
    const back = at(convertKind(c.root, "$/2", "parallel").root, "$/2");
    expect(Object.keys(back.branches as object)).toEqual(["lookup", "echo"]);
  });

  it("anything else turning into a chain, and a leaf turning into a parallel, is wrapped untouched", () => {
    const root = everything();
    for (const [path, kind] of [["$/1", "chain"], ["$/4", "chain"], ["$/4", "parallel"], ["$/0", "parallel"]] as const) {
      const c = convertKind(root, path, kind);
      expect(c.wrapped).toBe(true);
      expect(c.dropped).toEqual([]);
      expect(describeChange(c)).toBe("wraps it as it is");
      const w = at(c.root, path);
      expect(w.kind).toBe(kind);
      expect(childEdges(w).map((e) => e.node)).toEqual([at(root, path)]);
    }
  });

  it("keeps the id, so reads of it keep reading it", () => {
    const root = everything();
    // `echo` reads {{results.triage}}, `done` reads {{results.read…}} and {{results.tiers}}
    for (const [path, kind] of [["$/1", "gate"], ["$/1", "cascade"], ["$/0", "route"], ["$/3", "gate"]] as const) {
      const next = convertKind(root, path, kind).root;
      expect(at(next, path).id).toBe(at(root, path).id);
      expect(flowWarnings(next).filter((w) => w.rule === "dead-read")).toEqual([]);
    }
  });

  it("an id the builder made up for the old kind gets one for the new kind, and reads follow it", () => {
    const root = asRoot(chain("c", emit("x", { id: "emit-41" }), emit("{{results.emit-41}}", { id: "tail" })));
    const next = convertKind(root, "$/0", "step").root;
    const id = at(next, "$/0").id;
    expect(id).toMatch(/^step-\d+$/);
    expect(at(next, "$/1").value).toBe(`{{results.${id}}}`);
  });

  it("a placeholder just becomes a fresh node of the new kind", () => {
    const root = asRoot(chain("c", emit("a", { id: "a" }), emit(PLACEHOLDER, { id: "emit-9" })));
    const c = convertKind(root, "$/1", "route");
    expect(at(c.root, "$/1")).toMatchObject({ kind: "route", id: expect.stringMatching(/^route-\d+$/), ask: { instructions: "Which way?" } });
    expect(c.dropped).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Every node of every example, into every kind
// ---------------------------------------------------------------------------

const docs: { slug: string; doc: ChainDocument }[] = [
  ...examples.map((e) => ({ slug: e.slug, doc: toJSON(e.chain, { name: e.title, examples: e.inputs.map((i) => i.value as Json) }) })),
  { slug: "everything", doc: withRoot(newDocument(), everything()) },
];

describe("every node of every example, turned into every other kind", () => {
  it("makes a valid chain the json tab takes, keeps every node it doesn't report dropping, and leaves no read newly dangling", () => {
    const failures: string[] = [];
    let total = 0;
    let lossless = 0;
    for (const { slug, doc } of docs) {
      const root = doc.root as unknown as NodeJson;
      const before = allIds(root);
      for (const p of paths(root)) {
        const from = at(root, p);
        for (const kind of KINDS) {
          if (kind === from.kind) continue;
          total++;
          const where = `${slug} ${p} ${from.kind}→${kind}`;
          try {
            const c = convertKind(root, p, kind);
            const next = withRoot(doc, c.root);
            const issues = issuesOf(next);
            if (issues.length) throw new Error(`invalid: ${issues.join("; ")}`);
            if (!readDocumentEdit(JSON.stringify(next), doc).ok) throw new Error("the json tab refuses it");
            const node = at(c.root, p);
            if (node.kind !== kind) throw new Error(`landed as a ${node.kind}`);
            if (allIds(c.root).size !== nodeCount(c.root)) throw new Error("duplicate ids");
            // nothing vanishes unreported: the old subtree's nodes are all still here, bar the ones `dropped` counts
            const after = allIds(c.root);
            const renamed = !c.wrapped && node.id !== from.id ? 1 : 0;
            const dropped = new Set(idsUnder(from).filter((id) => !after.has(id) && !(renamed && id === from.id)));
            const gone = dropped.size;
            const reported = c.dropped.reduce((n, d) => n + d.nodes, 0);
            if (gone !== reported) throw new Error(`${gone} nodes gone, ${reported} reported`);
            if (!c.dropped.length) lossless++;
            if (c.wrapped && childEdges(node)[0]?.node !== from) throw new Error("the wrapped node was changed");
            // a read that found its node before still does, unless that node went with a reported drop (a renamed id's reads follow it)
            for (const q of paths(c.root)) {
              for (const r of readsIn(at(c.root, q))) {
                if (before.has(r.id) && !after.has(r.id) && !dropped.has(r.id)) throw new Error(`read of ${r.id} at ${q} now dangles`);
              }
            }
          } catch (e) {
            failures.push(`${where}: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      }
    }
    console.info(`kind changes: ${total} tried across ${docs.length} documents, ${lossless} lossless, ${failures.length} broke`);
    expect(failures).toEqual([]);
    expect(total).toBeGreaterThan(300);
  });
});

/** A Jev whose answers depend on what it's asked (plus a seed), not on call order. */
function hashJev(seed: number): JevClient {
  const hash = (s: string) => {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
  };
  return {
    model: "fake",
    usdPerMillionTokens: 0,
    async ask(state: Entry, questions: Questions) {
      const answers: Record<string, unknown> = {};
      for (const [k, q] of Object.entries(questions)) {
        const h = hash(`${seed}|${k}|${JSON.stringify(q)}|${JSON.stringify(state)}`);
        const confidence = (h % 97) / 96;
        if (q.type === "choice") {
          const labels = Object.keys(q.criteria);
          const pick = labels[h % labels.length]!;
          answers[k] = { type: "choice", choice: pick, probabilities: Object.fromEntries(labels.map((l) => [l, l === pick ? 0.8 : 0.2])), confidence };
        } else if (q.type === "score") {
          const s = (h >>> 3) % q.criteria.length;
          answers[k] = { type: "score", score: s, probabilities: { [s]: 1 }, legend: {}, confidence };
        } else answers[k] = { type: "noul", noul: ((h >>> 5) % 101) / 100 };
      }
      return { answers, model: "fake", usage: { inputTokens: 0, outputTokens: 0 }, costUsd: 0, latencyMs: 0, attempts: 1 } as never;
    },
  };
}
