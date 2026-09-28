import {
  childPath,
  childrenOf,
  DECISION_KEY,
  ROOT_PATH,
  toJSON,
  toJsonSafe,
  TRACE_VERSION,
  walk,
  type AnyJevNode,
  type AnyNode,
  type ChainDocument,
  type GateNode,
  type JevCall,
  type Json,
  type Question,
  type Questions,
  type RouteNode,
  type Span,
  type Trace,
} from "jevchain";
import { CURATED, getCurated } from "@/recipes";
import { COPY } from "./copy";
import { compileRecipe } from "./recipe/compile";
import { LIMITS, type Recipe } from "./recipe/types";
import { validateRecipe } from "./recipe/validate";
import { verdictOf, type Verdict } from "./recipe/verdict";
import { TIERS, type Tier } from "./tiers";

/**
 * Share links. Nothing is stored server-side: a link is the verdict page
 * path, a query string of bounded counts for previews, and a hash that
 * carries the whole run. The hash never reaches the server.
 *
 * `/v?t=jevs&g=10&d=10&r=tonight#<blob>`
 *
 * The hash is the truth. The query never holds user text, and the verdict
 * page recomputes everything it shows from the hash, so a query that
 * disagrees with it changes nothing but a preview. The hash is untrusted:
 * `readVerdictPayload` is its one door. A forged but valid recipe with a
 * trace that fits it is accepted by design.
 */

/** A shared input keeps its first 499 characters and then "…". */
export const MAX_SHARED_INPUT = 500;
/** The longest encoded hash `decodeBlob` looks at. */
export const MAX_HASH_BYTES = 64 * 1024;
/** Decompression stops once the payload passes this. */
export const MAX_PAYLOAD_BYTES = 64 * 1024;
/** Where "Open in the studio" goes. No trailing slash. */
export const STUDIO_URL = trimSlashes(process.env.NEXT_PUBLIC_STUDIO_URL || "https://jev-chain.com");

/** The studio's share page. It reads the same blob encoding as ours. */
const STUDIO_SHARE_PATH = "/studio/share";
const VERDICT_PATH = "/v";
const ELLIPSIS = "…";

/** Every failure a share link can have. Visitors see `COPY.badLink`. */
export class ShareError extends Error {
  constructor(message: string = COPY.badLink) {
    super(message);
    this.name = "ShareError";
  }
}

/** A decoded verdict link. The trace is restored: every call state is back. */
export interface VerdictPayload {
  v: 1;
  recipe: Recipe;
  input: string;
  trace: Trace;
}

/** The query string's counts. They are only ever read for previews. */
export interface ShareQuery {
  tier: Tier;
  gates: number;
  depth: number;
  /** A curated recipe's slug, or null for a generated recipe. */
  slug: string | null;
}

/** The studio's `SharePayload` (apps/web/src/lib/trace/share.ts), doc form only. */
interface StudioPayload {
  v: 1;
  chain: { doc: ChainDocument };
  input: Json;
  trace: Trace;
}

// ---------------------------------------------------------------------------
// Input

/** `input` cut to `max` characters, the last of them "…". Shorter input comes back unchanged. */
export function truncateInput(input: string, max: number = MAX_SHARED_INPUT): string {
  if (input.length <= max) return input;
  let head = input.slice(0, max - 1);
  // Don't split a surrogate pair: a lone high surrogate is not text.
  if (/[\uD800-\uDBFF]$/.test(head)) head = head.slice(0, -1);
  return head + ELLIPSIS;
}

/**
 * Whether a shared input was cut by `truncateInput`: it ends in "…" at the
 * cap (or one short, when the cut fell inside a surrogate pair). The verdict
 * page shows `COPY.trimmed` and the "(trimmed input)" studio label for it.
 */
export function isTrimmed(input: string, max: number = MAX_SHARED_INPUT): boolean {
  return input.endsWith(ELLIPSIS) && (input.length === max || input.length === max - 1);
}

// ---------------------------------------------------------------------------
// Blobs: JSON, deflate-raw, base64url with no padding. The studio's encoding.

export async function encodeBlob(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return toBase64Url(new Uint8Array(await new Response(stream).arrayBuffer()));
}

/**
 * The JSON value in an encoded blob. Rejects with `ShareError(COPY.badLink)`
 * when the blob is empty, over `MAX_HASH_BYTES`, not base64url, not
 * deflate-raw, inflates past `maxBytes`, or is not UTF-8 JSON.
 *
 * Decompression is fed the blob a small slice at a time and stops as soon as
 * the total passes `maxBytes`, so a small blob can't make it inflate megabytes.
 */
export async function decodeBlob(encoded: string, maxBytes: number = MAX_PAYLOAD_BYTES): Promise<unknown> {
  if (!encoded || encoded.length > MAX_HASH_BYTES) throw new ShareError();
  const bytes = fromBase64Url(encoded);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(await inflate(bytes, maxBytes));
  } catch {
    throw new ShareError();
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ShareError();
  }
}

/**
 * How much compressed input the decompressor gets at a time. Some browsers
 * (Chromium) inflate each input chunk in full whether or not the output is
 * read, so the input goes in small slices, and only when the decompressor
 * asks. At deflate's best ratio (about 1032:1) one slice is about 0.5 MB.
 */
const INFLATE_SLICE = 512;

/** Inflates deflate-raw `bytes`, throwing once the output passes `maxBytes`. */
async function inflate(bytes: Uint8Array, maxBytes: number): Promise<Uint8Array> {
  const reader = slices(bytes, INFLATE_SLICE).pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new ShareError();
      chunks.push(value);
    }
  } catch (error) {
    // Stops the decompressor. It may already have errored, which is fine.
    await reader.cancel().catch(() => {});
    throw error;
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.byteLength;
  }
  return out;
}

/** `bytes` as a stream of `size`-byte slices, each made only when it is pulled. */
function slices(bytes: Uint8Array, size: number): ReadableStream<BufferSource> {
  let at = 0;
  return new ReadableStream<BufferSource>(
    {
      pull(controller) {
        if (at >= bytes.byteLength) controller.close();
        else controller.enqueue(bytes.subarray(at, (at += size)) as Uint8Array<ArrayBuffer>);
      },
    },
    { highWaterMark: 0 },
  );
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Strict: the base64url alphabet only, no padding, and a length base64 can have. */
function fromBase64Url(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/.test(s) || s.length % 4 === 1) throw new ShareError();
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    throw new ShareError();
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------------------------------------------------------------------------
// The query string: `t`, `g`, `d` and, for curated recipes, `r`. Never user text.

export function shareQueryString(q: ShareQuery): string {
  const params = new URLSearchParams({ t: q.tier, g: String(q.gates), d: String(q.depth) });
  if (q.slug !== null) params.set("r", q.slug);
  return params.toString();
}

type QueryInput = URLSearchParams | Record<string, string | string[] | undefined>;

/**
 * The query's counts, for previews only, or null for the plain card. Null
 * when `t`, `g` or `d` is missing, repeated or out of bounds, or `r` is
 * present and not exactly one curated slug. Accepts Next's `searchParams`.
 */
export function parseShareQuery(params: QueryInput): ShareQuery | null {
  const all = (key: string): string[] => {
    if (params instanceof URLSearchParams) return params.getAll(key);
    const value = params[key];
    return value === undefined ? [] : Array.isArray(value) ? value : [value];
  };
  const one = (key: string): string | undefined => {
    const values = all(key);
    return values.length === 1 ? values[0] : undefined;
  };

  const tier = one("t");
  if (!(TIERS as readonly (string | undefined)[]).includes(tier)) return null;
  const gates = count(one("g"), LIMITS.questions);
  const depth = count(one("d"), LIMITS.depth);
  if (gates === null || depth === null) return null;

  const slugs = all("r");
  if (slugs.length > 1) return null;
  const slug = slugs.length === 1 ? slugs[0] : null;
  if (slug !== null && !getCurated(slug)) return null;

  return { tier: tier as Tier, gates, depth, slug };
}

/** A whole number from 0 to `max`, written plainly ("7", not "07" or "7.0"), or null. */
function count(value: string | undefined, max: number): number | null {
  if (value === undefined || !/^(0|[1-9][0-9]*)$/.test(value)) return null;
  const n = Number(value);
  return n <= max ? n : null;
}

// ---------------------------------------------------------------------------
// Verdict links

/**
 * The hash's JSON. The trace is slimmed: everything in it that is a copy of
 * the input or of the recipe is dropped, and `restoreTrace` puts it back.
 *
 * - The input: span inputs and call states (a compiled recipe sets no state).
 * - The recipe: span titles and call questions, which the compiled node has.
 * - Outputs: an emit's is its node's value, an ask's is its call's answers,
 *   and a gate's or route's is its child's. The trace's is the root span's.
 */
interface WirePayload {
  v: 1;
  recipe: Recipe;
  input: string;
  trace: WireTrace;
}

type WireCall = Omit<JevCall, "state" | "questions">;
type WireSpan = Omit<Span, "input" | "title" | "output" | "calls"> & { calls: WireCall[] };
type WireTrace = Omit<Trace, "output" | "spans"> & { spans: WireSpan[] };

/**
 * Everything that makes a hash smaller lives here: the input is truncated
 * and the trace slimmed to match.
 */
function slimPayload(p: { recipe: Recipe; input: string; trace: Trace }): WirePayload {
  const input = truncateInput(p.input);
  const spans = p.trace.spans.map((span) => ({
    ...without(span, "input", "title", "output"),
    calls: span.calls.map((call) => without(call, "state", "questions")),
  }));
  return { v: 1, recipe: p.recipe, input, trace: { ...without(p.trace, "output"), input, spans } };
}

/** A shallow copy of `value` minus `keys`. */
function without<T extends object, K extends keyof T>(value: T, ...keys: K[]): Omit<T, K> {
  const copy = { ...value };
  for (const key of keys) delete copy[key];
  return copy;
}

/**
 * The inverse of `slimPayload`: the trace input, span inputs and call states
 * become `input`, and titles, call questions and outputs come back from the
 * compiled chain, the way the jevchain runtime wrote them. Expects a trace
 * that passed `checkTrace` against `chain`: one ok span per node on one path
 * from the root, and one call on each span that asks.
 */
function restoreTrace(trace: WireTrace, input: string, chain: AnyNode): Trace {
  const nodes = nodesById(chain);
  const spans: Span[] = [];
  // Last span first: a gate's or route's output is its child's.
  let childOutput: Json | undefined;
  for (let i = trace.spans.length - 1; i >= 0; i--) {
    const wire = trace.spans[i]!;
    const node = nodes.get(wire.nodeId)!;
    const calls = wire.calls.map((call): JevCall => ({ ...call, state: input, questions: questionsOf(node) }));
    const output = node.kind === "emit" ? json(node.value) : node.kind === "ask" ? json(calls[0]!.answers) : childOutput!;
    spans.unshift({ ...wire, ...(node.title ? { title: node.title } : {}), input, output, calls });
    childOutput = output;
  }
  return { ...trace, input, output: childOutput!, spans };
}

/** The node's own questions, as the runtime sends them. A compiled recipe has no `alsoAsk`. */
function questionsOf(node: AnyJevNode): Questions {
  if (node.kind === "ask") return node.questions;
  if (node.kind === "gate" || node.kind === "route") return { [DECISION_KEY]: node.ask };
  return {};
}

/** A trace's copy of `value`: the runtime keeps outputs through `toJsonSafe`. */
function json(value: unknown): Json {
  return toJsonSafe(value);
}

/** Every node in a compiled chain by id. A compiled recipe's ids are unique. */
function nodesById(chain: AnyNode): Map<string, AnyJevNode> {
  const nodes = new Map<string, AnyJevNode>();
  walk(chain, (node) => nodes.set(node.id, node as AnyJevNode));
  return nodes;
}

/**
 * The relative link to the verdict page for one run. The query's counts come
 * from `verdict`. `r` is set only when `slug` names a curated recipe.
 */
export async function verdictHref(p: {
  recipe: Recipe;
  input: string;
  trace: Trace;
  verdict: Verdict;
  slug?: string | null;
}): Promise<string> {
  const slug = p.slug != null && getCurated(p.slug) ? p.slug : null;
  const query = shareQueryString({ tier: p.verdict.tier, gates: p.verdict.gates, depth: p.verdict.depth, slug });
  const blob = await encodeBlob(slimPayload(p));
  return `${VERDICT_PATH}?${query}#${blob}`;
}

/**
 * Decodes and checks a verdict link's hash (a leading "#" is fine). The
 * returned trace is restored, so it is a whole jevchain `Trace` again.
 * Rejects with `ShareError(COPY.badLink)` for anything it can't trust.
 *
 * The steps, in order:
 * 1. `decodeBlob`: size caps, base64url, deflate-raw, JSON.
 * 2. `readWirePayload`: `v`, the input and the recipe.
 * 3. `checkTrace`: the trace's shape, and that it fits the compiled recipe.
 * 4. `restoreTrace`, then the verdict must recompute from recipe and trace.
 */
export async function readVerdictPayload(hash: string): Promise<VerdictPayload> {
  return verdictPayloadOf(await decodeBlob(hash.startsWith("#") ? hash.slice(1) : hash));
}

/**
 * Steps 2 to 4 of `readVerdictPayload`, on a hash that is already decoded.
 * Throws `ShareError(COPY.badLink)`.
 */
export function verdictPayloadOf(data: unknown): VerdictPayload {
  const { recipe, input, trace: wire } = readWirePayload(data);
  const chain = compileRecipe(recipe);
  checkTrace(wire, chain);
  const trace = restoreTrace(wire, input, chain);
  if (!verdictOf(recipe, { status: trace.status, output: trace.output, trace })) throw new ShareError();
  return { v: 1, recipe, input, trace };
}

/** The payload's version, input and recipe. The recipe comes back cleaned by `validateRecipe`. */
function readWirePayload(data: unknown): { recipe: Recipe; input: string; trace: unknown } {
  if (!isRecord(data) || data.v !== 1 || typeof data.input !== "string") throw new ShareError();
  const check = validateRecipe(data.recipe);
  if (!check.ok) throw new ShareError();
  return { recipe: check.recipe, input: data.input, trace: data.trace };
}

/**
 * The trace check before the trace is restored and the verdict recomputed.
 * It passes what a finished run of `chain` writes, and nothing a run of it
 * could not have written:
 *
 * - Shape: every field the restored trace keeps has its jevchain type, so
 *   the verdict, the circuit and the studio read what they expect.
 * - Fit: the spans walk one path down from the root of `chain`, one span per
 *   node, each on the edge the decision above it took, ending at a leaf. So
 *   every node is in the chain and every span is reachable from the root.
 *   Each span has its node's kind. A gate or route has a decision on its own
 *   edges. A verdict's emit makes no call, and every other span makes one,
 *   whose answers are exactly its node's questions, each fitting its kind.
 *
 * The run must have finished "ok", so every span did too: a compiled recipe
 * has one path and no fallbacks, so any failure fails the run.
 */
function checkTrace(trace: unknown, chain: AnyNode): asserts trace is WireTrace {
  const t = record(trace);
  if (t.version !== TRACE_VERSION || t.status !== "ok") throw new ShareError();
  strings(t, "runId", "chainId", "startedAt");
  numbers(t, "durationMs");
  numbers(record(t.usage), "calls", "requests", "inputTokens", "outputTokens", "costUsd");
  if (!list(t.models).every((model) => typeof model === "string")) throw new ShareError();

  let node: AnyJevNode | undefined = chain as AnyJevNode;
  let parentPath: string | null = null;
  let edge: string | null = null;
  for (const raw of list(t.spans)) {
    // A span after the leaf.
    if (!node) throw new ShareError();
    const span = record(raw);
    const path: string = parentPath === null ? ROOT_PATH : childPath(parentPath, edge!);
    if (span.path !== path || span.parentPath !== parentPath || span.edge !== edge) throw new ShareError();
    if (span.nodeId !== node.id || span.kind !== node.kind || span.status !== "ok") throw new ShareError();
    numbers(span, "start", "end");
    records(span.retries);
    records(span.logs);

    const calls = list(span.calls);
    if (calls.length !== (node.kind === "emit" ? 0 : 1)) throw new ShareError();
    for (const call of calls) checkCall(call, questionsOf(node));

    parentPath = path;
    if (node.kind === "gate" || node.kind === "route") {
      edge = checkDecision(span.decision, node);
      node = childrenOf(node).find((child) => child.edge === edge)!.node as AnyJevNode;
    } else {
      if (span.decision !== undefined) throw new ShareError();
      node = undefined;
    }
  }
  // No spans, or a path that stops before a leaf.
  if (node) throw new ShareError();
}

/** A call's fields, and answers that are exactly `questions`, each fitting its question. */
function checkCall(raw: unknown, questions: Questions): void {
  const call = record(raw);
  strings(call, "id", "model");
  numbers(call, "inputTokens", "outputTokens", "costUsd", "start", "end", "latencyMs", "attempts");
  if (call.requestId !== undefined) strings(call, "requestId");
  if (call.tier !== undefined) strings(call, "tier");
  if (call.batch !== undefined) numbers(record(call.batch), "size", "questions");

  const answers = record(call.answers);
  const keys = Object.keys(questions);
  // Own keys only, so a JSON "__proto__" key counts as an extra answer.
  if (Object.keys(answers).length !== keys.length) throw new ShareError();
  for (const key of keys) {
    if (!Object.hasOwn(answers, key)) throw new ShareError();
    checkAnswer(answers[key], questions[key]!);
  }
}

/**
 * An answer of the question's kind: a noul from 0 to 1, a choice of one of
 * its labels with probabilities only for its labels, or a score within its
 * levels (0 to the top level's index).
 */
function checkAnswer(raw: unknown, question: Question): void {
  const answer = record(raw);
  if (answer.type !== question.type) throw new ShareError();
  switch (question.type) {
    case "noul":
      if (!within(answer.noul, 0, 1)) throw new ShareError();
      return;
    case "score":
      if (!within(answer.score, 0, question.criteria.length - 1)) throw new ShareError();
      return;
    case "choice": {
      const labels = question.criteria;
      if (typeof answer.choice !== "string" || !Object.hasOwn(labels, answer.choice)) throw new ShareError();
      const probabilities = Object.entries(record(answer.probabilities));
      if (!probabilities.every(([label, p]) => Object.hasOwn(labels, label) && within(p, 0, 1))) throw new ShareError();
      return;
    }
  }
}

/**
 * A gate's or route's decision: on its own question, with one edge score per
 * edge of the node in the node's order, and exactly the taken one marked
 * taken. Returns the edge taken.
 */
function checkDecision(raw: unknown, node: GateNode | RouteNode): string {
  const decision = record(raw);
  if (decision.kind !== node.kind || decision.question !== DECISION_KEY) throw new ShareError();
  strings(decision, "taken", "metric", "summary");
  numbers(decision, "value");
  if (decision.confidence !== undefined) numbers(decision, "confidence");
  if (decision.threshold !== undefined) record(decision.threshold);

  const edges = childrenOf(node).map((child) => child.edge);
  const scores = list(decision.edges);
  if (!edges.includes(decision.taken as string) || scores.length !== edges.length) throw new ShareError();
  scores.forEach((raw, i) => {
    const score = record(raw);
    if (score.edge !== edges[i] || score.taken !== (score.edge === decision.taken)) throw new ShareError();
    if (score.value !== null) numbers(score, "value");
  });
  return decision.taken as string;
}

/** `value` as an object, or a `ShareError`. */
function record(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw new ShareError();
  return value;
}

/** `value` as an array, or a `ShareError`. */
function list(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new ShareError();
  return value;
}

/** An array of objects, or a `ShareError`. */
function records(value: unknown): void {
  if (!list(value).every(isRecord)) throw new ShareError();
}

function strings(value: Record<string, unknown>, ...keys: string[]): void {
  if (!keys.every((key) => typeof value[key] === "string")) throw new ShareError();
}

/** Finite numbers: JSON can spell Infinity as `1e999`. */
function numbers(value: Record<string, unknown>, ...keys: string[]): void {
  if (!keys.every((key) => Number.isFinite(value[key]))) throw new ShareError();
}

function within(value: unknown, min: number, max: number): boolean {
  return typeof value === "number" && value >= min && value <= max;
}

/**
 * The curated recipe this one deep-equals, so a re-share from the verdict
 * page keeps `r` without reading the query. Null for anything else.
 */
export function curatedSlugFor(recipe: Recipe): string | null {
  return CURATED.find((c) => deepEqual(c.recipe, recipe))?.slug ?? null;
}

// ---------------------------------------------------------------------------
// Studio links

/**
 * "Open in the studio": `<studio>/studio/share#<blob>`, the blob being the
 * studio's own `SharePayload` with the compiled recipe as its chain. It
 * encodes exactly the input and trace it is given: a live run's full ones, or
 * a shared page's trimmed input and restored trace.
 */
export async function studioHref(
  p: { recipe: Recipe; input: string; trace: Trace },
  studioUrl: string = STUDIO_URL,
): Promise<string> {
  const payload: StudioPayload = {
    v: 1,
    chain: { doc: toJSON(compileRecipe(p.recipe), { name: p.recipe.title }) },
    input: p.input,
    trace: p.trace,
  };
  return `${trimSlashes(studioUrl)}${STUDIO_SHARE_PATH}#${await encodeBlob(payload)}`;
}

// ---------------------------------------------------------------------------

function trimSlashes(url: string): string {
  return url.replace(/\/+$/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Structural equality for JSON values. Object key order doesn't matter. */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const aKeys = Object.keys(a);
  const bRecord = b as Record<string, unknown>;
  return (
    aKeys.length === Object.keys(b).length &&
    aKeys.every((key) => Object.hasOwn(bRecord, key) && deepEqual((a as Record<string, unknown>)[key], bRecord[key]))
  );
}
