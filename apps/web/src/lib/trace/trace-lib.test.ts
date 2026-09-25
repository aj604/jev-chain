import { describe, expect, it } from "vitest";
import { chain, choice, emit, gate, graphOf, handlersOf, noul, parallel, route, toJSON, traceFromEvents, type Trace, type TraceEvent } from "jevchain";
import { examples } from "jevchain-examples";
import { docChains } from "@/docs/chains";
import { documentOf, parseChainDocument, resolveChain } from "./chain-source";
import { answerBrief, fmtAgo, fmtMetric, fmtMs, fmtPct, fmtThreshold, fmtTokens, fmtUsd, previewJson } from "./format";
import { parseInput, toEditor } from "./input";
import { chipRows, edgePath, fitZoom, layoutGraph, nodeSize, pickDirection, vertexHints } from "./layout";
import { stepSelection, visitOrder } from "./order";
import { describeRunError, retryAfterFrom, traceIssue } from "./run-error";
import { decodeShare, encodeShare, fromBase64Url, ShareDecodeError, toBase64Url, type SharePayload } from "./share";
import { pathDepth, timeTicks } from "./ticks";

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

// ── format ──────────────────────────────────────────────────────────────────

describe("format", () => {
  it("formats durations", () => {
    expect(fmtMs(0)).toBe("0ms");
    expect(fmtMs(0.2)).toBe("0.20ms");
    expect(fmtMs(38.4)).toBe("38ms");
    expect(fmtMs(1234)).toBe("1.23s");
    expect(fmtMs(61_000)).toBe("1m 1s");
    expect(fmtMs(undefined)).toBe("—");
  });

  it("formats tiny dollar amounts honestly", () => {
    expect(fmtUsd(0)).toBe("$0");
    expect(fmtUsd(0.000049)).toBe("$0.000049");
    expect(fmtUsd(0.0000042)).toBe("$0.0000042");
    expect(fmtUsd(0.0123)).toBe("$0.012");
    expect(fmtUsd(0.5)).toBe("$0.50");
    expect(fmtUsd(1.5)).toBe("$1.50");
  });

  it("formats tokens, percents, thresholds and metrics", () => {
    expect(fmtTokens(1156.6)).toBe("1,157");
    expect(fmtTokens(12_345)).toBe("12.3k");
    expect(fmtPct(0.712)).toBe("71%");
    expect(fmtPct(0.001)).toBe("<1%");
    expect(fmtThreshold({ min: 0.7 })).toBe("≥ 0.70");
    expect(fmtThreshold({ max: 0.5 })).toBe("≤ 0.50");
    expect(fmtThreshold({ min: 0.2, max: 0.8 })).toBe("0.20–0.80");
    expect(fmtMetric("probability", 0.71)).toBe("71%");
    expect(fmtMetric("noul", 0.84)).toBe("p 0.84");
    expect(fmtMetric("confidence", 0.52)).toBe("conf 0.52");
    expect(fmtMetric("score", 2.256)).toBe("2.26");
    expect(fmtMetric("score", null)).toBeNull();
  });

  it("summarizes answers and inputs", () => {
    expect(answerBrief({ type: "choice", choice: "plans", probabilities: { plans: 0.64, money: 0.36 }, confidence: 0.3 })).toBe("plans 64%");
    expect(answerBrief({ type: "score", score: 2.26, probabilities: { "0": 0.1, "1": 0.1, "2": 0.2, "3": 0.6 }, legend: {}, confidence: 0.4 })).toBe("2.26 / 3");
    expect(answerBrief({ type: "noul", noul: 0.123 })).toBe("p 0.12");
    expect(previewJson({ a: "b" })).toBe('{"a":"b"}');
    expect(previewJson("x".repeat(100), 10)).toBe(`${"x".repeat(9)}…`);
    expect(fmtAgo("2026-01-01T00:00:00Z", Date.parse("2026-01-01T00:05:00Z"))).toBe("5m ago");
  });
});

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

// ── layout ──────────────────────────────────────────────────────────────────

describe("layout", () => {
  it("lays out every example in both directions without overlapping nodes", () => {
    for (const ex of examples) {
      const graph = graphOf(ex.chain);
      const hints = vertexHints(ex.chain, graph);
      for (const dir of ["LR", "TB"] as const) {
        const l = layoutGraph(graph, (v) => nodeSize(v, hints[v.id]), dir);
        expect(Object.keys(l.positions)).toHaveLength(graph.vertices.length);
        const boxes = graph.vertices.map((v) => ({ ...l.positions[v.id]!, ...l.sizes[v.id]! }));
        for (let i = 0; i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i]!;
            const b = boxes[j]!;
            const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
            expect(overlap, `${ex.slug} ${dir}: ${graph.vertices[i]!.id} overlaps ${graph.vertices[j]!.id}`).toBe(false);
          }
        }
        // every labeled edge gets a reserved pill position
        for (const e of graph.edges) if (e.label || e.decidedBy) expect(l.labels[e.id], `${ex.slug} ${e.id}`).toBeDefined();
      }
    }
  });

  it("is deterministic", () => {
    const g = graphOf(triage);
    expect(layoutGraph(g)).toEqual(layoutGraph(g));
  });

  it("describes nodes from the chain", () => {
    const g = graphOf(triage);
    const hints = vertexHints(triage, g);
    expect(hints["$"]!.chips).toEqual(["bug", "billing"]);
    expect(hints["$/bug"]!.bar).toMatchObject({ measure: "p(yes)", text: "≥ 0.70", min: 0.7 });
    expect(hints["$/billing"]!.line).toBe("billing");
  });

  it("sizes cards for wrapped chips", () => {
    expect(chipRows(["a", "b"])).toBe(1);
    expect(chipRows(Array.from({ length: 12 }, (_, i) => `question-${i}`))).toBe(3);
    expect(nodeSize({ kind: "ask" }, { chips: ["x"] }).height).toBeLessThan(nodeSize({ kind: "ask" }, { chips: Array(8).fill("long-question:score") }).height);
    expect(nodeSize({ kind: "join" })).toEqual({ width: 92, height: 36 });
  });

  it("picks the direction that draws bigger, preferring left→right", () => {
    const wide = { width: 1600, height: 200 } as Parameters<typeof pickDirection>[0];
    const tall = { width: 500, height: 700 } as Parameters<typeof pickDirection>[0];
    expect(fitZoom(wide, 800, 500)).toBeCloseTo((800 * 0.84) / 1600);
    expect(pickDirection(wide, tall, 800, 600)).toBe("TB");
    expect(pickDirection(wide, tall, 3000, 400)).toBe("LR");
    expect(pickDirection(wide, tall, 0, 0)).toBe("LR");
  });

  it("routes edges through their label point", () => {
    const p = edgePath(0, 0, 200, 100, { x: 100, y: 40 });
    expect(p.label).toEqual({ x: 100, y: 40 });
    expect(p.d).toContain("100,40");
    const tb = edgePath(0, 0, 100, 200, { x: 40, y: 100 }, "TB");
    expect(tb.d).toContain("40,100");
    expect(edgePath(0, 0, 200, 0).d.startsWith("M 0,0 C")).toBe(true);
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

// ── run errors ──────────────────────────────────────────────────────────────

describe("run errors", () => {
  it("recognizes a missing key from the proxy", () => {
    const i = describeRunError({ name: "NodeError", code: "auth_error", message: 'Node "x" failed: TypeSafe rejected the API key (401): no API key: this server has no TYPESAFE_API_KEY configured.', nodeId: "x" });
    expect(i).toMatchObject({ kind: "missing-key", action: "add-key", nodeId: "x" });
  });

  it("carries retry-after for rate limits, live or serialized", () => {
    const live = { cause: { retryAfterMs: 3000 } };
    expect(retryAfterFrom(live)).toBe(3000);
    expect(retryAfterFrom(undefined, "Rate limited by TypeSafe (retry after 1500ms)")).toBe(1500);
    expect(retryAfterFrom(undefined, "try again in 12s")).toBe(12_000);
    expect(describeRunError({ name: "NodeError", code: "rate_limited", message: "Rate limited by TypeSafe (retry after 2000ms)" })).toMatchObject({ kind: "rate-limited", retryAfterMs: 2000, action: "retry" });
  });

  it("classifies other failures", () => {
    expect(describeRunError({ name: "E", code: "aborted", message: "Aborted" }).kind).toBe("aborted");
    expect(describeRunError({ name: "E", code: "validation_error", message: "bad", status: 400 }).kind).toBe("invalid");
    expect(describeRunError({ name: "E", code: "connection_error", message: "offline" }).kind).toBe("network");
    expect(describeRunError({ name: "E", code: "unknown", message: "boom", nodeId: "n" })).toMatchObject({ kind: "failed", title: '"n" broke' });
  });

  it("explains halted and ok traces", () => {
    const ok = triageTrace();
    expect(traceIssue(ok)).toBeNull();
    const halted: Trace = { ...ok, status: "halted", halted: { path: "$/bug", nodeId: "urgent", summary: "Blocked." } };
    expect(traceIssue(halted)).toMatchObject({ kind: "halted", nodeId: "urgent", detail: "Blocked." });
  });
});

// ── ticks ───────────────────────────────────────────────────────────────────

describe("timeline ticks", () => {
  it("picks round steps", () => {
    expect(timeTicks(700)).toEqual([0, 200, 400, 600]);
    expect(timeTicks(1000)).toEqual([0, 200, 400, 600, 800, 1000]);
    expect(timeTicks(83)).toEqual([0, 20, 40, 60, 80]);
    expect(timeTicks(0)).toEqual([0]);
  });
  it("measures path depth", () => {
    expect(pathDepth("$")).toBe(0);
    expect(pathDepth("$/0/bug")).toBe(2);
  });
});
