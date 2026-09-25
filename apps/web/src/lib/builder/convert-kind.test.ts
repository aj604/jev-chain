import { describe, expect, it } from "vitest";
import { ask, cascade, chain, choice, emit, fromJSON, gate, handlersOf, noul, parallel, route, run, score, step, toJSON, type AnyNode, type ChainDocument, type Entry, type Handler, type JevClient, type Json, type Questions } from "jevchain";
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
const everythingChain = () =>
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
    );
const everything = () => asRoot(everythingChain());

/** Deciders whose conversions can be exact: two-way routes and halfway gates, a one-tier cascade, confidence bars on choices. */
const decidersChain = () =>
  chain(
    "deciders",
    route("two-way", { ask: choice("which way?", ["left", "right"]), branches: { left: emit("L", { id: "l" }), right: emit("R", { id: "r" }) }, lowConfidence: { below: 0.4, then: emit("?", { id: "lost" }) } }),
    gate("halfway", { ask: noul("worth it?"), pass: { min: 0.5 }, then: emit("yes", { id: "worth" }), otherwise: emit("no", { id: "not-worth" }) }),
    gate("at-most", { ask: choice("mood?", ["calm", "cross"]), pass: { label: "cross", max: 0.5 }, then: emit("fine", { id: "fine" }), otherwise: emit("careful", { id: "careful" }), unsure: { minConfidence: 0.5, then: emit("hm", { id: "hm" }) } }),
    cascade("one-tier", { tiers: [{ id: "only", ask: choice("sure?", ["a", "b"]), minConfidence: 0.6 }], fallback: emit("person", { id: "fallback-person" }) }),
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
    // three labels: a gate on p(bug) ≥ 0.5 isn't "bug is the top pick", and the dialog says so
    expect(c.changed).toEqual(["swaps the top pick for p(bug) ≥ 0.5"]);
    expect(describeChange(c)).toBe("keeps 2 questions, 2 paths, the low-confidence path (as unsure) · drops 3 nodes · swaps the top pick for p(bug) ≥ 0.5");
    expect(issuesOf(withRoot(newDocument(), c.root))).toEqual([]);
  });

  it("a noul gate becomes a route on yes / no: then → yes, otherwise → no, unsure → low confidence, and the noul's descriptions come along", () => {
    const c = convertKind(everything(), "$/1/bug", "route");
    const r = at(c.root, "$/1/bug");
    expect(r).toMatchObject({ kind: "route", id: "sure", ask: { type: "choice", instructions: "is it?", criteria: { yes: "yes it is", no: null } }, lowConfidence: { below: 0.4, then: { id: "hmm" } } });
    expect(Object.fromEntries(Object.entries(r.branches as Record<string, NodeJson>).map(([k, v]) => [k, v.id]))).toEqual({ yes: "fix", no: "nah" });
    // p(yes) ≥ 0.7 isn't "yes is the top pick", and a noul's closeness to 0.5 isn't a choice's confidence
    expect(c.changed).toEqual(["swaps p(yes) ≥ 0.7 for the top pick", "judges low confidence on the choice, not the noul"]);
    expect(losesWork(c)).toBe(true);
  });

  it("a noul gate at the halfway bar becomes a route that routes the same, with nothing to confirm", () => {
    const g = asRoot(gate("g", { ask: noul("safe?"), pass: { min: 0.5 }, then: emit("go", { id: "go" }), otherwise: emit("stop", { id: "stop" }) }));
    const c = convertKind(g, "$", "route");
    expect(Object.fromEntries(Object.entries(at(c.root, "$").branches as Record<string, NodeJson>).map(([k, v]) => [k, v.id]))).toEqual({ yes: "go", no: "stop" });
    expect(losesWork(c)).toBe(false);
  });

  it("a gate that passes on a max puts then on the no side (haunted-desk's “anyone in danger?”)", () => {
    const g = asRoot(gate("danger", { ask: noul("in danger?"), pass: { max: 0.5 }, then: emit("carry on", { id: "carry" }), otherwise: emit("evacuate", { id: "evacuate" }) }));
    const c = convertKind(g, "$", "route");
    expect(Object.fromEntries(Object.entries(at(c.root, "$").branches as Record<string, NodeJson>).map(([k, v]) => [k, v.id]))).toEqual({ yes: "evacuate", no: "carry" });
    expect(c.changed).toEqual([]);
  });

  it("a choice gate becomes a route whose measured label gets the then path", () => {
    const c = convertKind(everything(), "$/1/billing", "route");
    const r = at(c.root, "$/1/billing");
    // then sits on the measured label; the gate had no otherwise (it halted), so refund gets a placeholder
    expect(Object.fromEntries(Object.entries(r.branches as Record<string, NodeJson>).map(([k, n]) => [k, isPlaceholder(n) ? "placeholder" : n.id]))).toEqual({ refund: "placeholder", credit: "credit" });
    expect(c.changed).toEqual(["swaps p(credit) ≥ 0.6 for the top pick", "stops halting when it doesn't pass"]);
  });

  it("a score gate, or one with an unsure margin, says what a route can't keep", () => {
    const c = convertKind(everything(), "$/1/other", "route");
    expect(c.changed).toEqual(["swaps score ≥ 1.5 for the top pick"]);
    const r = at(c.root, "$/1/other");
    expect(Object.fromEntries(Object.entries(r.branches as Record<string, NodeJson>).map(([k, n]) => [k, isPlaceholder(n) ? "placeholder" : n.id]))).toEqual({ fine: "ok", meh: "placeholder", awful: "bad" });
    const m = asRoot(gate("g", { ask: choice("?", ["a", "b"]), pass: { label: "a", min: 0.5 }, then: emit("A", { id: "ea" }), otherwise: emit("B", { id: "eb" }), unsure: { margin: 0.4, then: emit("?", { id: "eu" }) } }));
    expect(convertKind(m, "$", "route").changed).toEqual(["loses the unsure margin ±0.4", "takes it below confidence 0.6 instead"]);
  });

  it("chain steps that read each other say so when they'd become sibling branches", () => {
    const c = asRoot(chain("c", emit("one", { id: "s1" }), emit("then {{results.s1}}", { id: "s2" })));
    for (const kind of ["route", "gate"] as const) expect(convertKind(c, "$", kind).changed, kind).toEqual(["runs one step instead of all 2 in order", "leaves reads in “s2” coming up empty"]);
    // data-flow doesn't flag reads between parallel siblings (they're maybe-run), so it's the running order that's named
    expect(convertKind(c, "$", "parallel").changed).toEqual(["runs the steps side by side, not in order"]);
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
    // the first tier's bar is the old unsure bar, so the fallback runs exactly when the unsure path did
    expect(n.tiers).toEqual([{ id: "decision", ask: { type: "noul", instructions: "is it?", criteria: { true: "yes it is" } }, minConfidence: 0.4 }]);
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

const docs: { slug: string; doc: ChainDocument; handlers: Record<string, Handler>; inputs: unknown[] }[] = [
  ...examples.map((e) => ({ slug: e.slug, doc: toJSON(e.chain, { name: e.title, examples: e.inputs.map((i) => i.value as Json) }), handlers: handlersOf(e.chain as AnyNode), inputs: e.inputs.map((i) => i.value) })),
  { slug: "everything", doc: withRoot(newDocument(), everything()), handlers: handlersOf(everythingChain() as AnyNode), inputs: [{ m: "hi" }, "x"] },
  { slug: "deciders", doc: withRoot(newDocument(), asRoot(decidersChain())), handlers: {}, inputs: ["a", { b: 2 }, "c"] },
];

/** Dead reads, as "node id / tier", with a renamed id mapped to its new name. */
function deadReadsIn(root: NodeJson, rename?: [string, string]): Set<string> {
  return new Set(
    flowWarnings(root)
      .filter((w) => w.rule === "dead-read")
      .map((w) => {
        const id = at(root, w.path).id;
        return `${rename && id === rename[0] ? rename[1] : id}/${w.tier ?? ""}`;
      }),
  );
}

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
            // …and a read that could run before (the node's there, but it can't have finished) is newly dead only if the change says so
            const deadBefore = deadReadsIn(root, renamed ? [from.id, node.id] : undefined);
            const newlyDead = [...deadReadsIn(c.root)].filter((k) => !deadBefore.has(k) && !dropped.has(k.split("/")[0]!));
            for (const k of newlyDead) if (!c.changed.includes(`leaves reads in “${k.split("/")[0]}” coming up empty`)) throw new Error(`reads in ${k} newly dead, unreported`);
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

  it("between route, gate and cascade: a change the dialog doesn't mention routes every run as before on the real runtime", async () => {
    // Which of the old node's children ran, run by run, before and after. A change that routes any run differently must
    // either have dropped the child the old run took, or open the dialog naming what changed (`changed`).
    const DECIDERS = new Set(["route", "gate", "cascade"]);
    const failures: string[] = [];
    let silent = 0;
    let runs = 0;
    let announced = 0;
    for (const { slug, doc, handlers, inputs } of docs) {
      const root = doc.root as unknown as NodeJson;
      for (const p of paths(root)) {
        const from = at(root, p);
        if (!DECIDERS.has(from.kind)) continue;
        const kids = childEdges(from).map((e) => e.node.id);
        for (const kind of ["route", "gate", "cascade"] as const) {
          if (kind === from.kind) continue;
          const c = convertKind(root, p, kind);
          const after = allIds(c.root);
          if (!c.changed.length) silent++;
          const took = async (r: NodeJson, seed: number, input: unknown) => {
            const res = await run(fromJSON(withRoot(doc, r), { handlers, missingHandlers: "passthrough" }), input, { jev: beliefJev(seed) });
            const ran = new Set(res.trace.spans.map((s) => s.nodeId));
            return kids.filter((k) => ran.has(k));
          };
          for (let seed = 0; seed < 30; seed++) {
            for (const input of inputs) {
              runs++;
              const a = await took(root, seed, input);
              const b = await took(c.root, seed, input);
              if (a.join() === b.join()) continue;
              if (a.some((k) => !after.has(k))) continue; // it took a child the change reports dropping
              announced++;
              if (!c.changed.length) {
                failures.push(`${slug} ${p} ${from.kind}→${kind} seed ${seed}: took ${a.join() || "nothing"}, now ${b.join() || "nothing"}, and the dialog doesn't say`);
                break;
              }
            }
          }
        }
      }
    }
    console.info(`routing: ${runs} run pairs; ${silent} changes with nothing to confirm; ${announced} runs routed differently after a change that says so; ${failures.length} unannounced`);
    expect(failures).toEqual([]);
    expect(silent).toBeGreaterThan(0);
    expect(announced).toBeGreaterThan(100); // the check has teeth: plenty of announced changes do reroute
  }, 120_000);
});

describe("every example gate turned into a route", () => {
  it("haunted-desk's “anyone in danger?” (pass: max 0.5) keeps evacuating on yes, with nothing to confirm, on 600 runs", async () => {
    const e = examples.find((x) => x.slug === "haunted-desk")!;
    const doc = toJSON(e.chain);
    const root = doc.root as unknown as NodeJson;
    const c = convertKind(root, "$/paranormal/0", "route");
    expect(losesWork(c)).toBe(false);
    expect((at(c.root, "$/paranormal/0/yes") as NodeJson).id).toBe("evacuate");
    const handlers = handlersOf(e.chain as AnyNode);
    const outputs = new Set<string>();
    for (let seed = 0; seed < 120; seed++) {
      for (const input of e.inputs.map((i) => i.value)) {
        const a = await run(fromJSON(doc, { handlers }), input, { jev: beliefJev(seed) });
        const b = await run(fromJSON(withRoot(doc, c.root), { handlers }), input, { jev: beliefJev(seed) });
        expect(b.status).toBe(a.status);
        expect(JSON.stringify(b.status === "ok" && b.output)).toBe(JSON.stringify(a.status === "ok" && a.output));
        outputs.add(JSON.stringify(a.status === "ok" && a.output));
      }
    }
    expect(outputs.size).toBeGreaterThan(3);
  });

  it("meeting-email's score gate with an unsure margin names everything a route can't keep", () => {
    const e = examples.find((x) => x.slug === "meeting-email")!;
    const c = convertKind(toJSON(e.chain).root as unknown as NodeJson, "$", "route");
    expect(c.changed).toEqual(["swaps score ≥ 2.5 for the top pick", "loses the unsure margin ±0.4", "takes it below confidence 0.6 instead"]);
    expect(losesWork(c)).toBe(true);
  });
});

/**
 * A Jev with one belief per question text (plus the run's state and a seed),
 * whatever type the question is asked as: a noul gets p(yes) = u, a yes/no
 * choice gets { yes: u, no: 1 − u }, so converting a question between them
 * doesn't change what Jev thinks. A choice's confidence is its own number (as
 * Jev's is), which is why a noul's closeness to 0.5 and a choice's confidence
 * don't agree. Never exactly 0.5, so ties don't decide anything.
 */
function beliefJev(seed: number): JevClient {
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
        const key = `${seed}|${JSON.stringify(q.instructions)}|${JSON.stringify(state)}`;
        const u = ((hash(key) % 1000) + 0.5) / 1000;
        const confidence = (hash(`${key}|confidence`) % 97) / 96;
        if (q.type === "noul") answers[k] = { type: "noul", noul: u };
        else if (q.type === "choice") {
          const labels = Object.keys(q.criteria);
          const yesNo = labels.length === 2 && labels.includes("yes") && labels.includes("no");
          const weights = labels.map((l) => (yesNo ? (l === "yes" ? u : 1 - u) : (hash(`${key}|${l}`) % 1000) + 1));
          const sum = weights.reduce((a, b) => a + b, 0);
          const probabilities = Object.fromEntries(labels.map((l, i) => [l, weights[i]! / sum]));
          const pick = labels[weights.indexOf(Math.max(...weights))]!;
          answers[k] = { type: "choice", choice: pick, probabilities, confidence };
        } else {
          const s = hash(key) % q.criteria.length;
          answers[k] = { type: "score", score: s, probabilities: { [s]: 1 }, legend: {}, confidence };
        }
      }
      return { answers, model: "fake", usage: { inputTokens: 0, outputTokens: 0 }, costUsd: 0, latencyMs: 0, attempts: 1 } as never;
    },
  };
}

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
