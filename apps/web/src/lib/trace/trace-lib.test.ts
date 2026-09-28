import { describe, expect, it } from "vitest";
import { chain, choice, emit, gate, graphOf, handlersOf, noul, parallel, route, toJSON, traceFromEvents, type Trace, type TraceEvent } from "jevchain";
import { examples } from "jevchain-examples";
import { docChains } from "@/docs/chains";
import { documentOf, parseChainDocument, resolveChain } from "./chain-source";
import { parseInput, toEditor } from "./input";
import { stepSelection, visitOrder } from "./order";
import { decodeShare, encodeShare, fromBase64Url, ShareDecodeError, toBase64Url, type SharePayload } from "./share";

// ── fixtures ────────────────────────────────────────────────────────────────

const triage = route("triage", {
  ask: choice("What is this?", ["bug", "billing"]),
  branches: {
    bug: gate("urgent", { ask: noul("Blocked?"), pass: { min: 0.7 }, then: emit("page", { id: "page" }), otherwise: emit("ticket", { id: "ticket" }) }),
    billing: emit("billing", { id: "billing" }),
  },
});

/** A finished trace for `triage` that went bug → urgent → then, built from real events. */
function triageTrace(): Trace {
  const call = (id: string, answers: Record<string, unknown>, start: number, end: number) => ({
    id,
    model: "jev-1.13.0",
    state: "x",
    questions: {},
    answers: answers as never,
    inputTokens: 100,
    outputTokens: 0,
    costUsd: 0.0000042,
    start,
    end,
    latencyMs: end - start,
    attempts: 1,
  });
  const events: TraceEvent[] = [
    { type: "run:start", runId: "run_1", chainId: "triage", startedAt: "2026-01-01T00:00:00.000Z", input: "x" },
    { type: "span:start", at: 0, span: { path: "$", parentPath: null, edge: null, nodeId: "triage", kind: "route", input: "x" } },
    { type: "jev:call", path: "$", call: call("c1", { decision: { type: "choice", choice: "bug", probabilities: { bug: 0.8, billing: 0.2 }, confidence: 0.6 } }, 0, 40) },
    {
      type: "decision",
      path: "$",
      decision: { kind: "route", question: "decision", taken: "bug", edges: [{ edge: "bug", value: 0.8, taken: true }, { edge: "billing", value: 0.2, taken: false }], metric: "probability", value: 0.8, confidence: 0.6, summary: "Went to bug." },
    },
    { type: "span:start", at: 41, span: { path: "$/bug", parentPath: "$", edge: "bug", nodeId: "urgent", kind: "gate", input: "x" } },
    { type: "jev:call", path: "$/bug", call: call("c2", { decision: { type: "noul", noul: 0.9 } }, 41, 80) },
    {
      type: "decision",
      path: "$/bug",
      decision: { kind: "gate", question: "decision", taken: "then", edges: [{ edge: "then", value: 0.9, taken: true }, { edge: "otherwise", value: 0.9, taken: false }], metric: "noul", value: 0.9, threshold: { min: 0.7 }, summary: "Passed." },
    },
    { type: "span:start", at: 81, span: { path: "$/bug/then", parentPath: "$/bug", edge: "then", nodeId: "page", kind: "emit", input: "x" } },
    { type: "span:end", at: 82, path: "$/bug/then", status: "ok", output: "page" },
    { type: "span:end", at: 82, path: "$/bug", status: "ok", output: "page" },
    { type: "span:end", at: 83, path: "$", status: "ok", output: "page" },
  ];
  const t = traceFromEvents(events)!;
  return { ...t, status: "ok", durationMs: 83, output: "page" };
}

// ── input ───────────────────────────────────────────────────────────────────

describe("input", () => {
  it("parses text and JSON with readable errors", () => {
    expect(parseInput("hello", "text")).toEqual({ ok: true, value: "hello" });
    expect(parseInput("  ", "text").ok).toBe(false);
    expect(parseInput('{"a":1}', "json")).toEqual({ ok: true, value: { a: 1 } });
    const bad = parseInput('{\n  "a": 1,\n}', "json");
    expect(bad.ok).toBe(false);
  });

  it("round-trips values through the editor", () => {
    expect(toEditor("hi")).toEqual({ text: "hi", mode: "text" });
    const e = toEditor({ a: [1, 2] });
    expect(e.mode).toBe("json");
    expect(parseInput(e.text, e.mode)).toEqual({ ok: true, value: { a: [1, 2] } });
  });
});

// ── order ───────────────────────────────────────────────────────────────────

describe("visit order", () => {
  it("lists visited vertices in execution order and steps through them", () => {
    const g = graphOf(triage);
    const order = visitOrder(g, triageTrace());
    expect(order).toEqual(["$", "$/bug", "$/bug/then"]);
    expect(stepSelection(order, null, 1)).toBe("$");
    expect(stepSelection(order, null, -1)).toBe("$/bug/then");
    expect(stepSelection(order, "$", 1)).toBe("$/bug");
    expect(stepSelection(order, "$/bug/then", 1)).toBe("$/bug/then");
    expect(stepSelection([], "x", 1)).toBe("x");
  });

  it("places a parallel's join after its branches", () => {
    const p = chain("c", parallel("p", { branches: { a: emit("a", { id: "a" }), b: emit("b", { id: "b" }) } }), emit("done", { id: "done" }));
    const g = graphOf(p);
    const ev = (e: TraceEvent) => e;
    const t = traceFromEvents([
      ev({ type: "run:start", runId: "r", chainId: "c", startedAt: "", input: null }),
      ev({ type: "span:start", at: 0, span: { path: "$", parentPath: null, edge: null, nodeId: "c", kind: "chain" } }),
      ev({ type: "span:start", at: 0, span: { path: "$/0", parentPath: "$", edge: "0", nodeId: "p", kind: "parallel" } }),
      ev({ type: "span:start", at: 1, span: { path: "$/0/a", parentPath: "$/0", edge: "a", nodeId: "a", kind: "emit" } }),
      ev({ type: "span:start", at: 1, span: { path: "$/0/b", parentPath: "$/0", edge: "b", nodeId: "b", kind: "emit" } }),
      ev({ type: "span:end", at: 2, path: "$/0/a", status: "ok" }),
      ev({ type: "span:end", at: 2, path: "$/0/b", status: "ok" }),
      ev({ type: "span:end", at: 3, path: "$/0", status: "ok" }),
      ev({ type: "span:start", at: 3, span: { path: "$/1", parentPath: "$", edge: "1", nodeId: "done", kind: "emit" } }),
    ])!;
    expect(visitOrder(g, t)).toEqual(["$/0", "$/0/a", "$/0/b", "$/0#join", "$/1"]);
  });
});

// ── share ───────────────────────────────────────────────────────────────────

describe("share links", () => {
  it("round-trips a payload through deflate + base64url", async () => {
    const payload: SharePayload = { v: 1, chain: { example: "haunted-desk" }, input: "the toaster ✨ whispers", trace: triageTrace() };
    const encoded = await encodeShare(payload);
    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(await decodeShare(`#${encoded}`)).toEqual(payload);
  });

  it("round-trips custom chain documents", async () => {
    const doc = documentOf((resolveChain({ kind: "example", slug: "meeting-email" }) as { ok: true; chain: never }).chain);
    const payload: SharePayload = { v: 1, chain: { doc }, input: { title: "sync" }, trace: triageTrace() };
    expect(await decodeShare(await encodeShare(payload))).toEqual(payload);
  });

  it("compresses a real trace well", async () => {
    const t = triageTrace();
    const encoded = await encodeShare({ v: 1, chain: { example: "haunted-desk" }, input: "x", trace: t });
    expect(encoded.length).toBeLessThan(JSON.stringify(t).length);
  });

  it("explains broken links", async () => {
    await expect(decodeShare("")).rejects.toBeInstanceOf(ShareDecodeError);
    await expect(decodeShare("#not base64!")).rejects.toThrow(/mangled/);
    await expect(decodeShare("#AAAA")).rejects.toThrow(/truncated|corrupted/);
    const wrongVersion = await encodeShare({ v: 2 } as unknown as SharePayload).catch(() => "");
    await expect(decodeShare(wrongVersion)).rejects.toThrow(/format v2/);
  });

  it("base64url handles every byte", () => {
    const bytes = new Uint8Array(256).map((_, i) => i);
    expect(fromBase64Url(toBase64Url(bytes))).toEqual(bytes);
  });
});

// ── chain sources ───────────────────────────────────────────────────────────

describe("chain sources", () => {
  it("resolves every example and round-trips it through its document", () => {
    for (const ex of examples) {
      const r = resolveChain({ kind: "example", slug: ex.slug });
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      const doc = documentOf(r.chain);
      const back = resolveChain({ kind: "doc", doc });
      expect(back.ok, ex.slug).toBe(true);
      if (back.ok) expect(graphOf(back.chain.node).vertices.map((v) => v.id)).toEqual(graphOf(ex.chain).vertices.map((v) => v.id));
    }
  });

  it("resolves docs chains by id, like gallery slugs", () => {
    for (const dc of docChains) {
      const r = resolveChain({ kind: "example", slug: dc.id });
      expect(r.ok, dc.id).toBe(true);
      if (r.ok) expect(r.chain).toMatchObject({ origin: "docs", title: dc.title, href: dc.page });
    }
  });

  it("binds handlers on documents so steps really run", () => {
    const ex = examples.find((e) => e.slug === "pr-horoscope")!;
    const doc = toJSON(ex.chain);
    const bound = resolveChain({ kind: "doc", doc, handlers: handlersOf(ex.chain) });
    const loose = resolveChain({ kind: "doc", doc });
    expect(bound.ok && loose.ok).toBe(true);
    const stepRun = (r: typeof bound) => (r.ok ? ((r.chain.node as unknown as { steps: { run: unknown }[] }).steps[1]!.run) : null);
    expect(stepRun(bound)).toBe(handlersOf(ex.chain)["horoscope"]);
    expect(stepRun(loose)).not.toBe(handlersOf(ex.chain)["horoscope"]);
  });

  it("reports unknown examples and broken documents as issues", () => {
    expect(resolveChain({ kind: "example", slug: "nope" })).toEqual({ ok: false, issues: ['no example called "nope"'] });
    expect(parseChainDocument("")).toMatchObject({ ok: false });
    expect(parseChainDocument("{nope")).toMatchObject({ ok: false, issues: [expect.stringMatching(/not valid JSON/)] });
    const bad = parseChainDocument(JSON.stringify({ format: "jevchain/v1", root: { kind: "route", id: "r", ask: { type: "choice", criteria: { a: null, b: null } }, branches: { a: { kind: "emit", id: "e", value: 1 } } }, refs: [] }));
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.issues.join()).toMatch(/no branch for "b"/);
  });
});
