import { constants as zlibConstants, createInflateRaw, inflateRawSync } from "node:zlib";
import { run, type Answer, type ChainDocument, type Trace } from "jevchain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bands3, gate, outcome, pick, rate, recipe, route, scale, yesNo } from "@/test/build";
import { TEST_CURATED } from "@/test/curated";
import { everyCapRecipe, Words } from "@/test/every-cap";
import { byQuestion, fakeJev, type Oracle } from "@/test/fake-jev";
import { desk, gatedRate, ladder } from "@/test/fixtures";
import { COPY } from "./copy";
import { compileRecipe } from "./recipe/compile";
import { resultOf, type Result } from "./recipe/result";
import { recipeShape } from "./recipe/tree";
import { CAPS, LIMITS, type Recipe, type RecipeNode, type RecipeOutcome } from "./recipe/types";
import { validateRecipe } from "./recipe/validate";
import {
  MAX_HASH_BYTES,
  MAX_PAYLOAD_BYTES,
  MAX_SHARED_INPUT,
  STUDIO_URL,
  ShareError,
  curatedSlugFor,
  decodeBlob,
  encodeBlob,
  isTrimmed,
  parseShareQuery,
  readVerdictPayload,
  shareQueryString,
  studioHref,
  truncateInput,
  verdictHref,
  type VerdictPayload,
} from "./share";

vi.mock("@/recipes", async () => (await import("@/test/curated")).curatedModule);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

const DESK = TEST_CURATED.find((c) => c.slug === "desk")!;
const DESK_INPUT = DESK.samples[0]!.input;

/** Answers that send the desk down each of its paths. The default one ends at `exorcist`. */
const DANGER = "Is anyone in physical danger?";
const TEAM = "Which team should handle this ticket?";
const deskRuns: Record<string, Oracle | undefined> = {
  exorcist: undefined,
  evacuate: byQuestion({ [DANGER]: { noul: 0.9 } }),
  // Within 0.1 of 50/50. Exactly 0.5 would pass the gate, so this checks unsure wins.
  priest: byQuestion({ [DANGER]: { noul: 0.5 } }),
  "ask-dave": byQuestion({ [TEAM]: { confidence: 0.3 } }),
  drafty: byQuestion({ [TEAM]: { choice: "other" } }),
  // Charged twice 0.1 (x2), calm (x1), card 0.9 (x1): 2.1 / 4 = 0.525.
  "refund-half": byQuestion({ [TEAM]: { choice: "bill" } }),
  // 1.8 + 1 + 0.9 = 3.7 / 4 = 0.925.
  "refund-full": byQuestion({ [TEAM]: { choice: "bill" }, "charged twice": { noul: 0.9 } }),
  // 0.2 + 0 + 0.1 = 0.3 / 4 = 0.075.
  "refund-none": byQuestion({ [TEAM]: { choice: "bill" }, "How angry": { score: 2 }, "How did they pay": { choice: "cash" } }),
};

async function runRecipe(r: Recipe, input: string, oracle?: Oracle) {
  const { client } = fakeJev(oracle);
  const ran = await run(compileRecipe(r), input, { jev: client });
  const trace = ran.trace;
  const result = resultOf(r, { status: ran.status, output: ran.status === "ok" ? ran.output : undefined, trace });
  if (!result) throw new Error("the run has no result");
  return { trace, result };
}

/** A verdict link for `r` run on `input`, split into its query and hash. */
async function share(r: Recipe, input: string, slug?: string | null, oracle?: Oracle) {
  const { trace, result } = await runRecipe(r, input, oracle);
  const href = await verdictHref({ recipe: r, input, trace, result, slug });
  const hashAt = href.indexOf("#");
  return { href, path: href.slice(0, hashAt), hash: href.slice(hashAt), trace, result };
}

function callStates(trace: Trace): unknown[] {
  return trace.spans.flatMap((span) => span.calls.map((call) => call.state));
}

/** The result the page shows, recomputed from a decoded payload. */
function recomputed(p: { recipe: Recipe; trace: Trace }): Result | null {
  return resultOf(p.recipe, { status: p.trace.status, output: p.trace.output, trace: p.trace });
}

async function expectBadLink(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ShareError);
  expect((error as ShareError).message).toBe(COPY.badLink);
}

/**
 * `value`'s JSON, padded with trailing spaces and stored uncompressed in one
 * deflate-raw stored block (BTYPE=00), so the blob is exactly `length`
 * base64url characters. The same bytes whatever the JSON, so the length is
 * exact without searching. `length % 4` can't be 1: base64 has no such length.
 */
function storedBlob(value: unknown, length: number): string {
  // A stored block is a 1-byte header, then LEN and NLEN (2 bytes each), then the bytes.
  const size = Math.floor((length * 3) / 4) - 5;
  const json = new TextEncoder().encode(JSON.stringify(value));
  if (length % 4 === 1 || json.byteLength > size || size > 0xffff) throw new Error(`no stored blob is ${length} characters`);
  const bytes = new Uint8Array(5 + size).fill(0x20);
  bytes.set([0x01, size & 0xff, size >> 8, ~size & 0xff, (~size >> 8) & 0xff]);
  bytes.set(json, 5);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  const blob = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  expect(blob).toHaveLength(length);
  // It would decode: it inflates to the padded JSON, under the payload cap.
  const inflated = inflateRawSync(Buffer.from(bytes));
  expect(inflated.byteLength).toBe(size);
  expect(inflated.byteLength).toBeLessThan(MAX_PAYLOAD_BYTES);
  expect(JSON.parse(inflated.toString("utf8"))).toEqual(value);
  return blob;
}

/** Every noul says 0.9, every score the top level, every choice the last label. */
const agreeable: Oracle = (q) => {
  if (q.type === "noul") return { noul: 0.9 };
  if (q.type === "score") {
    const top = q.criteria.length - 1;
    const probabilities = Object.fromEntries(q.criteria.map((_, i) => [String(i), i === top ? 1 : 0]));
    return { score: top, probabilities } as Partial<Answer>;
  }
  const labels = Object.keys(q.criteria);
  return { choice: labels[labels.length - 1] } as Partial<Answer>;
};

/** `value` as JSON sees it: what a link can carry. */
function asJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value));
}

/** `trace` with every copy of its input (trace, span inputs, call states) set to `input`. */
function withInput(trace: Trace, input: string): Trace {
  return {
    ...trace,
    input,
    spans: trace.spans.map((span) => ({ ...span, input, calls: span.calls.map((call) => ({ ...call, state: input })) })),
  };
}

/** Every string in a recipe by what it is, and its node count. Rate bands aren't nodes. */
function everyString(r: Recipe) {
  const out = { nodes: 0, keys: [] as string[], titles: [] as string[], questions: [] as string[], labels: [] as string[] };
  const more = {
    means: [] as string[],
    descriptions: [] as string[],
    levels: [] as string[],
    stamps: [] as string[],
    lines: [] as string[],
  };
  const labelled = (labels: Record<string, string>) => {
    out.labels.push(...Object.keys(labels));
    more.descriptions.push(...Object.values(labels));
  };
  const ending = (o: RecipeOutcome) => {
    out.keys.push(o.key);
    more.stamps.push(o.stamp);
    more.lines.push(o.line);
  };
  const visit = (node: RecipeNode) => {
    out.nodes++;
    if (node.kind === "outcome") return ending(node);
    out.keys.push(node.key);
    out.titles.push(node.title);
    switch (node.kind) {
      case "rate":
        node.bands.forEach((b) => ending(b.outcome));
        for (const q of node.questions) {
          out.keys.push(q.key);
          out.questions.push(q.question);
          if (q.kind === "choice") labelled(q.labels);
          if (q.kind === "score") more.levels.push(...q.levels);
        }
        return;
      case "gate":
        out.questions.push(node.question);
        if (node.means) more.means.push(node.means.yes, node.means.no);
        [node.yes, node.no, ...(node.unsure ? [node.unsure] : [])].forEach(visit);
        return;
      case "route":
        out.questions.push(node.question);
        labelled(node.labels);
        [...Object.values(node.branches), ...(node.lowConfidence ? [node.lowConfidence] : [])].forEach(visit);
    }
  };
  visit(r.root);
  return { ...out, ...more };
}

/** A recipe in the retired v1 shape: tiers, pass/then/otherwise, verdict leaves. */
const V1_RECIPE = {
  v: 1,
  title: "Will your plan for tonight jev?",
  thing: "your plan",
  root: {
    kind: "gate",
    key: "ok",
    question: "Is it ok?",
    pass: "yes",
    then: { kind: "verdict", tier: "jevs", line: "It jevs." },
    otherwise: { kind: "verdict", tier: "nope", line: "It does not jev." },
  },
};

describe("truncateInput and isTrimmed", () => {
  it("leaves short input alone", () => {
    expect(truncateInput("short")).toBe("short");
    const atCap = "x".repeat(MAX_SHARED_INPUT);
    expect(truncateInput(atCap)).toBe(atCap);
    expect(isTrimmed("short")).toBe(false);
    // An ellipsis alone doesn't make an input trimmed: it has to be at the cap.
    expect(isTrimmed("wait…")).toBe(false);
  });

  it("keeps the first 499 characters and adds an ellipsis", () => {
    const long = "abcdefghij".repeat(60);
    const cut = truncateInput(long);
    expect(cut).toHaveLength(MAX_SHARED_INPUT);
    expect(cut).toBe(long.slice(0, 499) + "…");
    expect(isTrimmed(cut)).toBe(true);
  });

  it("doesn't split a surrogate pair", () => {
    const long = "x".repeat(498) + "😀".repeat(10);
    const cut = truncateInput(long);
    expect(cut).toBe("x".repeat(498) + "…");
    expect(isTrimmed(cut)).toBe(true);
  });
});

describe("encodeBlob and decodeBlob", () => {
  it("round-trips JSON in the studio's alphabet, without padding", async () => {
    const value = { v: 2, text: "Just one drink. 🍺", n: [1, 2, 3] };
    const blob = await encodeBlob(value);
    expect(blob).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(await decodeBlob(blob)).toEqual(value);
  });

  it("rejects an empty blob, padding and characters outside base64url", async () => {
    const blob = await encodeBlob({ v: 2 });
    await expectBadLink(decodeBlob(""));
    // Padded the way plain base64 would be, so only the padding is wrong.
    let unpadded = blob;
    for (let n = 0; unpadded.length % 4 === 0; n++) unpadded = await encodeBlob({ v: 2, n });
    expect(await decodeBlob(unpadded)).toBeTruthy();
    await expectBadLink(decodeBlob(unpadded + "=".repeat(4 - (unpadded.length % 4))));
    await expectBadLink(decodeBlob(blob.slice(0, 5) + "+/" + blob.slice(5)));
    await expectBadLink(decodeBlob(blob.slice(0, 5) + " " + blob.slice(5)));
    await expectBadLink(decodeBlob("A"));
  });

  it(`accepts a blob of exactly ${MAX_HASH_BYTES} bytes`, async () => {
    // The owner's decision on #63: 64 KB, so the site's own links for large valid recipes are accepted.
    expect(MAX_HASH_BYTES).toBe(64 * 1024);
    const value = { v: 2, text: "at the cap" };
    expect(await decodeBlob(storedBlob(value, MAX_HASH_BYTES))).toEqual(value);
  });

  it(`rejects a blob over ${MAX_HASH_BYTES} bytes, even one that would decode`, async () => {
    // The next length base64url can have after the cap.
    await expectBadLink(decodeBlob(storedBlob({ v: 2, text: "past the cap" }, MAX_HASH_BYTES + 2)));
    // Pseudo-random text from a wide, mostly-incompressible alphabet: the JSON
    // stays under the payload cap, but base64url still pushes it past the hash cap.
    const ALPHABET = Array.from({ length: 95 }, (_, i) => String.fromCharCode(33 + i))
      .filter((c) => c !== '"' && c !== "\\")
      .join("");
    let seed = 1;
    const text = Array.from({ length: 62_000 }, () => ALPHABET[(seed = (seed * 48271) % 0x7fffffff) % ALPHABET.length]).join("");
    const blob = await encodeBlob({ text });
    expect(blob.length).toBeGreaterThan(MAX_HASH_BYTES);
    expect(JSON.stringify({ text }).length).toBeLessThan(MAX_PAYLOAD_BYTES);
    await expectBadLink(decodeBlob(blob));
  });

  it("rejects bytes that aren't deflate-raw, or aren't UTF-8", async () => {
    await expectBadLink(decodeBlob("bm90IGRlZmxhdGU"));
    const latin1 = new Blob([new Uint8Array([0x22, 0xff, 0x22])]).stream().pipeThrough(new CompressionStream("deflate-raw"));
    const bytes = new Uint8Array(await new Response(latin1).arrayBuffer());
    const blob = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    await expectBadLink(decodeBlob(blob));
  });

  describe("a zip bomb", () => {
    /** 8 MB of JSON that deflates to about 8 KB, so it fits under the hash cap. */
    const BOMB_BYTES = 8 * 1024 * 1024;
    const bomb = () => encodeBlob({ v: 2, input: "a".repeat(BOMB_BYTES) });
    /** The deflate-raw bytes an unpadded base64url blob holds. */
    const compressedBytes = (blob: string) => Math.floor((blob.length * 3) / 4);

    /** Counts the bytes that come out of every DecompressionStream made from now on. */
    function countInflated() {
      const counter = { bytes: 0 };
      const Real = globalThis.DecompressionStream;
      class Counting {
        readonly writable: WritableStream<BufferSource>;
        readonly readable: ReadableStream<Uint8Array>;
        constructor(format: CompressionFormat) {
          const real = new Real(format);
          this.writable = real.writable;
          // No buffering on the way out, so this counts only what is pulled.
          this.readable = real.readable.pipeThrough(
            new TransformStream<Uint8Array, Uint8Array>(
              {
                transform(chunk, controller) {
                  counter.bytes += chunk.byteLength;
                  controller.enqueue(chunk);
                },
              },
              { highWaterMark: 1 },
              { highWaterMark: 0 },
            ),
          );
        }
      }
      vi.stubGlobal("DecompressionStream", Counting);
      return counter;
    }

    it("is small enough to pass the hash cap", async () => {
      expect((await bomb()).length).toBeLessThan(MAX_HASH_BYTES);
    });

    it("inflates in full without a cap, so the counter sees all of it", async () => {
      const blob = await bomb();
      const inflated = countInflated();
      const value = (await decodeBlob(blob, Infinity)) as { input: string };
      expect(value.input).toHaveLength(BOMB_BYTES);
      expect(inflated.bytes).toBeGreaterThan(BOMB_BYTES);
    });

    it("stops decompressing soon after the 128 KB cap", async () => {
      const blob = await bomb();
      const inflated = countInflated();
      await expectBadLink(decodeBlob(blob));
      expect(inflated.bytes).toBeGreaterThan(MAX_PAYLOAD_BYTES);
      // A chunk or two past the cap, not megabytes.
      expect(inflated.bytes).toBeLessThan(2 * MAX_PAYLOAD_BYTES);
      await expectBadLink(readVerdictPayload(blob));
    });

    /**
     * Swaps in a DecompressionStream that inflates each input chunk in full as
     * soon as it is written, read or not, the way Chromium's does. Node's
     * respects backpressure, so it can't show this. Counts the bytes fed in
     * and inflated.
     */
    function inflateEagerly() {
      const counter = { fed: 0, bytes: 0 };
      class Eager extends TransformStream<BufferSource, Uint8Array> {
        constructor() {
          const zlib = createInflateRaw();
          super(
            {
              transform(chunk, controller) {
                const bytes = ArrayBuffer.isView(chunk)
                  ? new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)
                  : new Uint8Array(chunk);
                counter.fed += bytes.byteLength;
                return new Promise<void>((resolve, reject) => {
                  const out: Buffer[] = [];
                  const onData = (data: Buffer) => out.push(data);
                  zlib.on("data", onData).once("error", reject);
                  zlib.write(bytes);
                  zlib.flush(zlibConstants.Z_SYNC_FLUSH, () => {
                    zlib.off("data", onData).off("error", reject);
                    for (const data of out) {
                      counter.bytes += data.byteLength;
                      controller.enqueue(new Uint8Array(data));
                    }
                    resolve();
                  });
                });
              },
              flush: () => void zlib.close(),
            },
            { highWaterMark: 1 },
            { highWaterMark: 0 },
          );
        }
      }
      vi.stubGlobal("DecompressionStream", Eager);
      return counter;
    }

    it("feeds a decompressor that inflates whatever it gets only a slice of the bomb", async () => {
      const blob = await bomb();
      const eager = inflateEagerly();
      await expectBadLink(decodeBlob(blob));
      // The 128 KB cap is about 128 compressed bytes of this bomb, and the
      // decompressor inflates every byte it is fed. It must not be fed it all.
      expect(eager.fed).toBeGreaterThan(0);
      expect(eager.fed).toBeLessThan(compressedBytes(blob) / 4);
      expect(eager.bytes).toBeLessThan(BOMB_BYTES / 4);
    });

    it("decodes an honest blob through a decompressor that inflates whatever it gets", async () => {
      const value = { v: 2, text: "x".repeat(40_000), n: Array.from({ length: 2_000 }, (_, i) => i) };
      const blob = await encodeBlob(value);
      const eager = inflateEagerly();
      expect(await decodeBlob(blob)).toEqual(value);
      expect(eager.fed).toBe(compressedBytes(blob));
    });
  });
});

describe("shareQueryString and parseShareQuery", () => {
  it("writes g and d, then r and o for a curated recipe", () => {
    expect(shareQueryString({ gates: 10, depth: 10, slug: "desk", outcome: "exorcist" })).toBe("g=10&d=10&r=desk&o=exorcist");
    expect(shareQueryString({ gates: 0, depth: 0, slug: null, outcome: null })).toBe("g=0&d=0");
  });

  it("reads good values back", () => {
    const q = { gates: 30, depth: 10, slug: "desk", outcome: "priest" } as const;
    expect(parseShareQuery(new URLSearchParams(shareQueryString(q)))).toEqual(q);
    expect(parseShareQuery(new URLSearchParams("g=0&d=0"))).toEqual({ gates: 0, depth: 0, slug: null, outcome: null });
    expect(parseShareQuery(new URLSearchParams("g=3&d=2&utm=x"))).toEqual({ gates: 3, depth: 2, slug: null, outcome: null });
    // A rate band's outcome is one of the recipe's outcomes too.
    expect(parseShareQuery(new URLSearchParams("g=2&d=1&r=vibes&o=vibes-high"))).toEqual({
      gates: 2,
      depth: 1,
      slug: "vibes",
      outcome: "vibes-high",
    });
    expect(parseShareQuery(new URLSearchParams("g=2&d=1&r=desk&o=refund-none"))).toMatchObject({ outcome: "refund-none" });
    // Escape-hatch outcomes too.
    expect(parseShareQuery(new URLSearchParams("g=1&d=1&r=desk&o=ask-dave"))).toMatchObject({ outcome: "ask-dave" });
  });

  it("ignores a retired t", () => {
    expect(parseShareQuery(new URLSearchParams("t=jevs&g=1&d=1"))).toEqual({ gates: 1, depth: 1, slug: null, outcome: null });
  });

  it("reads Next's searchParams record", () => {
    expect(parseShareQuery({ g: "10", d: "10", r: "desk", o: "evacuate" })).toEqual({
      gates: 10,
      depth: 10,
      slug: "desk",
      outcome: "evacuate",
    });
    expect(parseShareQuery({ g: "1", d: "1", r: undefined, o: undefined })).toEqual({
      gates: 1,
      depth: 1,
      slug: null,
      outcome: null,
    });
    expect(parseShareQuery({ g: ["1", "2"], d: "1" })).toBeNull();
    expect(parseShareQuery({ g: "1", d: "1", r: "desk", o: ["priest", "priest"] })).toBeNull();
    expect(parseShareQuery({ g: ["1"], d: ["1"], r: ["desk"], o: ["priest"] })).toEqual({
      gates: 1,
      depth: 1,
      slug: "desk",
      outcome: "priest",
    });
  });

  it.each([
    ["g=31", "g=31&d=1"],
    ["d=11", "g=1&d=11"],
    ["a negative count", "g=-1&d=1"],
    ["a fractional count", "g=1.5&d=1"],
    ["a count written oddly", "g=07&d=1"],
    ["a count that isn't a number", "g=ten&d=1"],
    ["an empty count", "g=&d=1"],
    ["missing gates", "d=1"],
    ["missing depth", "g=1"],
    ["repeated gates", "g=1&g=1&d=1"],
    ["repeated depth", "g=1&d=1&d=1"],
    ["nothing", ""],
    ["a retired tier alone", "t=jevs"],
    ["a v1 link", "t=jevs&g=10&d=10&r=tonight"],
    ["a curated slug without an outcome", "g=1&d=1&r=desk"],
    ["an outcome without a slug", "g=1&d=1&o=exorcist"],
    ["an unknown slug", "g=1&d=1&r=nonsense&o=exorcist"],
    ["an empty slug", "g=1&d=1&r=&o=exorcist"],
    ["an empty outcome", "g=1&d=1&r=desk&o="],
    ["a repeated slug", "g=1&d=1&r=desk&r=desk&o=exorcist"],
    ["a repeated outcome", "g=1&d=1&r=desk&o=exorcist&o=exorcist"],
    ["two outcomes", "g=1&d=1&r=desk&o=exorcist&o=priest"],
    ["an outcome the recipe doesn't have", "g=1&d=1&r=desk&o=nonsense"],
    ["another curated recipe's outcome", "g=1&d=1&r=desk&o=vibes-high"],
    ["a node key, not an outcome", "g=1&d=1&r=desk&o=danger"],
    ["a rate key, not an outcome", "g=1&d=1&r=desk&o=refund"],
    ["an outcome key in capitals", "g=1&d=1&r=desk&o=EXORCIST"],
    ["an outcome key with a space", "g=1&d=1&r=desk&o=exorcist%20"],
    ["an outcome key that is too long", `g=1&d=1&r=desk&o=${"a".repeat(33)}`],
    ["an inherited key as an outcome", "g=1&d=1&r=desk&o=constructor"],
  ])("gives the plain card for %s", (_, query) => {
    expect(parseShareQuery(new URLSearchParams(query))).toBeNull();
  });
});

describe("verdictHref and readVerdictPayload", () => {
  it("round-trips the desk", async () => {
    const { path, hash, trace, result } = await share(DESK.recipe, DESK_INPUT, "desk");
    expect(path).toBe("/v?g=2&d=2&r=desk&o=exorcist");
    expect(result).toMatchObject({ outcome: { key: "exorcist", stamp: "Exorcist booked" }, score: null, gates: 2, depth: 2 });

    const payload = await readVerdictPayload(hash);
    expect(payload.v).toBe(2);
    expect(payload.recipe).toEqual(DESK.recipe);
    expect(payload.input).toBe(DESK_INPUT);
    expect(payload.trace.input).toBe(DESK_INPUT);
    const states = callStates(payload.trace);
    expect(states).toHaveLength(2);
    expect(states.every((s) => s === DESK_INPUT)).toBe(true);
    expect(payload.trace.spans.every((s) => s.input === DESK_INPUT)).toBe(true);
    // Restored, it is the trace the run returned.
    expect(payload.trace).toEqual(asJson(trace));
    expect(recomputed(payload)).toEqual(result);
  });

  describe("every desk outcome round-trips, with r and o set", () => {
    it.each(Object.entries(deskRuns))("%s", async (key, oracle) => {
      const { path, hash, trace, result } = await share(DESK.recipe, DESK_INPUT, "desk", oracle);
      expect(result.outcome.key).toBe(key);
      expect(path).toBe(`/v?g=${result.gates}&d=${result.depth}&r=desk&o=${key}`);
      const payload = await readVerdictPayload(hash);
      expect(asJson(payload.trace)).toStrictEqual(asJson(trace));
      expect(recomputed(payload)).toEqual(result);
    });
  });

  it("round-trips a run through a gate's unsure", async () => {
    const { path, hash, trace, result } = await share(DESK.recipe, DESK_INPUT, "desk", deskRuns.priest);
    expect(path).toBe("/v?g=2&d=2&r=desk&o=priest");
    const gateSpan = trace.spans[1]!;
    expect(gateSpan.decision).toMatchObject({ kind: "gate", taken: "unsure" });
    expect(gateSpan.decision!.edges.map((e) => e.edge)).toEqual(["then", "otherwise", "unsure"]);
    expect(trace.spans.at(-1)!.path).toBe("$/ghost/unsure");

    const payload = await readVerdictPayload(hash);
    expect(payload.trace.output).toEqual({
      key: "priest",
      stamp: "Priest consulted",
      line: "A priest will review the file at their leisure.",
    });
    expect(recomputed(payload)).toEqual(result);
    expect(recomputed(payload)!.outcome.key).toBe("priest");
  });

  it("round-trips a run through a route's lowConfidence", async () => {
    const { path, hash, trace, result } = await share(DESK.recipe, DESK_INPUT, "desk", deskRuns["ask-dave"]);
    expect(path).toBe("/v?g=1&d=1&r=desk&o=ask-dave");
    expect(trace.spans).toHaveLength(2);
    expect(trace.spans[0]!.decision).toMatchObject({ kind: "route", taken: "lowConfidence" });
    expect(trace.spans[0]!.decision!.edges.map((e) => e.edge)).toEqual(["ghost", "bill", "other", "lowConfidence"]);
    expect(trace.spans[1]!.path).toBe("$/lowConfidence");

    const payload = await readVerdictPayload(hash);
    expect(asJson(payload.trace)).toStrictEqual(asJson(trace));
    expect(recomputed(payload)).toEqual(result);
    expect(recomputed(payload)!.outcome.key).toBe("ask-dave");
  });

  it("round-trips a rate band's outcome with its score", async () => {
    const { path, hash, result } = await share(DESK.recipe, DESK_INPUT, "desk", deskRuns["refund-half"]);
    expect(result).toMatchObject({ outcome: { key: "refund-half", stamp: "Half refunded" }, score: 0.53, gates: 4, depth: 1 });
    expect(path).toBe("/v?g=4&d=1&r=desk&o=refund-half");
    const payload = await readVerdictPayload(hash);
    expect(recomputed(payload)).toEqual(result);

    // The other curated recipe, whose band keys are all it has past its gate.
    const vibes = await share(gatedRate(), "The vibes are fine.", "vibes", byQuestion({ "Is it ok?": { noul: 0.9 } }));
    expect(vibes.result).toMatchObject({ outcome: { key: "vibes-low" }, score: 0.1 });
    expect(vibes.path).toBe("/v?g=2&d=1&r=vibes&o=vibes-low");
    expect(recomputed(await readVerdictPayload(vibes.hash))).toEqual(vibes.result);
  });

  it("slims the hash: the trimmed input, no span inputs and no call states", async () => {
    const long = "The kettle hums the national anthem at midnight. ".repeat(40);
    expect(long.length).toBeGreaterThan(MAX_SHARED_INPUT);
    const { hash } = await share(DESK.recipe, long, "desk");
    const wire = (await decodeBlob(hash.slice(1))) as { trace: { input: unknown; spans: Record<string, unknown>[] } };
    expect(wire.trace.input).toBe(truncateInput(long));
    // The part of the input past the cut is nowhere in the hash.
    expect(JSON.stringify(wire)).not.toContain(long.slice(499));
    for (const span of wire.trace.spans) {
      expect(span).not.toHaveProperty("input");
      for (const call of span.calls as Record<string, unknown>[]) expect(call).not.toHaveProperty("state");
    }
  });

  it("slims the hash: no titles, call questions or outputs, which the recipe has", async () => {
    const { hash, trace } = await share(DESK.recipe, DESK_INPUT, "desk");
    const wire = (await decodeBlob(hash.slice(1))) as { trace: { spans: Record<string, unknown>[] } };
    expect(wire.trace).not.toHaveProperty("output");
    expect(wire.trace.spans).toHaveLength(trace.spans.length);
    for (const span of wire.trace.spans) {
      expect(span).not.toHaveProperty("title");
      expect(span).not.toHaveProperty("output");
      for (const call of span.calls as Record<string, unknown>[]) expect(call).not.toHaveProperty("questions");
    }
    // The stamp, line, question and means are in the hash once: in the recipe.
    const json = JSON.stringify(wire);
    for (const text of ["Exorcist booked", "Booked: one (1) exorcist. Please remove fragile items.", DANGER, "spooky but harmless"]) {
      expect(json.split(text)).toHaveLength(2);
    }
  });

  it("restores the trace input from the payload's input, not the trace's own", async () => {
    const { hash } = await share(DESK.recipe, DESK_INPUT, "desk");
    const wire = (await decodeBlob(hash.slice(1))) as Record<string, unknown> & { trace: Record<string, unknown> };
    const forged = await encodeBlob({ ...wire, trace: { ...wire.trace, input: "forged" } });
    expect((await readVerdictPayload(forged)).trace.input).toBe(DESK_INPUT);
  });

  it("restores outputs from the recipe and the answers, not the trace's own", async () => {
    const { hash, result } = await share(DESK.recipe, DESK_INPUT, "desk");
    const wire = (await decodeBlob(hash.slice(1))) as Record<string, unknown> & { trace: { spans: object[] } };
    const forgedOutput = { key: "priest", stamp: "Priest consulted", line: "A priest will review the file at their leisure." };
    const spans = wire.trace.spans.map((span) => ({ ...span, title: "Forged.", output: forgedOutput }));
    const payload = await readVerdictPayload(await encodeBlob({ ...wire, trace: { ...wire.trace, output: forgedOutput, spans } }));
    expect(payload.trace.output).toEqual({
      key: "exorcist",
      stamp: "Exorcist booked",
      line: "Booked: one (1) exorcist. Please remove fragile items.",
    });
    expect(payload.trace.spans.every((s) => s.output !== undefined && s.title !== "Forged.")).toBe(true);
    expect(recomputed(payload)).toEqual(result);
  });

  it("accepts the hash without its #", async () => {
    const { hash } = await share(DESK.recipe, DESK_INPUT, "desk");
    expect((await readVerdictPayload(hash.slice(1))).input).toBe(DESK_INPUT);
  });

  it("never puts user text in the query", async () => {
    // A generated recipe's outcome keys are model output made from the visitor's text.
    const generated = recipe(
      "The Zanzibar Dispatch Desk",
      "your zanzibar",
      gate(
        "zanzibar-ok",
        "Is zanzibar ok?",
        outcome("zanzibar-yes", "Zanzibar approved", "Zanzibar is fine."),
        outcome("quetzalcoatl", "Quetzalcoatl filed", "Filed under quetzalcoatl."),
      ),
    );
    for (const slug of [undefined, null, "zanzibar", "desk", "vibes"]) {
      const { path, hash, result } = await share(generated, "quetzalcoatl is the password", slug);
      expect(result.outcome.key).toBe("quetzalcoatl");
      expect(path).toBe("/v?g=1&d=1");
      expect(path).not.toContain("zanzibar");
      expect(path).not.toContain("quetzalcoatl");
      expect((await readVerdictPayload(hash)).recipe.title).toBe("The Zanzibar Dispatch Desk");
    }
  });

  it("sets r and o only for a curated slug that has the outcome", async () => {
    // Generated: g and d only.
    expect((await share(ladder(2), "x")).path).toBe("/v?g=2&d=2");
    expect((await share(ladder(2), "x", null)).path).toBe("/v?g=2&d=2");
    expect((await share(ladder(2), "x", "nonsense")).path).toBe("/v?g=2&d=2");
    // A curated slug whose recipe has no such outcome: o goes, and r with it.
    expect((await share(ladder(2), "x", "desk")).path).toBe("/v?g=2&d=2");
    expect((await share(gatedRate(), "x", "desk")).path).toBe("/v?g=1&d=1");
    expect((await share(DESK.recipe, DESK_INPUT, "vibes")).path).toBe("/v?g=2&d=2");
    // Curated, and the outcome is its own.
    expect((await share(gatedRate(), "x", "vibes")).path).toBe("/v?g=1&d=1&r=vibes&o=stopped");
    for (const { path } of [await share(ladder(2), "x", "desk"), await share(DESK.recipe, DESK_INPUT, "vibes")]) {
      expect(path).not.toContain("r=");
      expect(path).not.toContain("o=");
    }
  });

  it("trims a long input to 500 characters ending in …", async () => {
    const long = "The fridge filed a complaint about the freezer. ".repeat(20);
    expect(long.length).toBeGreaterThan(MAX_SHARED_INPUT);
    const payload = await readVerdictPayload((await share(DESK.recipe, long, "desk")).hash);
    expect(payload.input).toHaveLength(MAX_SHARED_INPUT);
    expect(payload.input.endsWith("…")).toBe(true);
    expect(payload.input).toBe(truncateInput(long));
    expect(isTrimmed(payload.input)).toBe(true);
    expect(payload.trace.input).toBe(payload.input);
    expect(callStates(payload.trace).every((s) => s === payload.input)).toBe(true);
  });

  it("recomputes the result from the hash whatever the query says", async () => {
    const real = await share(ladder(3), "x", null);
    expect(real.path).toBe("/v?g=3&d=3");

    const url = new URL(`/v?g=30&d=0&r=desk&o=priest${real.hash}`, "https://example.test");
    expect(parseShareQuery(url.searchParams)).toEqual({ gates: 30, depth: 0, slug: "desk", outcome: "priest" });

    const payload = await readVerdictPayload(url.hash);
    expect(recomputed(payload)).toEqual(real.result);
    expect(recomputed(payload)).toMatchObject({ outcome: { key: "through" }, gates: 3, depth: 3 });
    expect(curatedSlugFor(payload.recipe)).toBeNull();
  });

  it("keeps the result of a run that ended at the first gate", async () => {
    const r = ladder(3);
    const { trace, result } = await runRecipe(r, "x", () => ({ noul: 0.9 }));
    expect(result).toMatchObject({ outcome: { key: "stop-1" }, score: null, gates: 1, depth: 1 });
    const href = await verdictHref({ recipe: r, input: "x", trace, result });
    expect(href.startsWith("/v?g=1&d=1#")).toBe(true);
    expect(recomputed(await readVerdictPayload(href.slice(href.indexOf("#"))))).toEqual(result);
  });

  describe("rejects a damaged link", () => {
    async function goodWire() {
      const { hash } = await share(DESK.recipe, DESK_INPUT, "desk");
      return (await decodeBlob(hash.slice(1))) as Record<string, unknown> & { trace: Record<string, unknown> };
    }

    it("that is empty", async () => {
      await expectBadLink(readVerdictPayload(""));
      await expectBadLink(readVerdictPayload("#"));
    });

    it("that isn't base64url", async () => {
      await expectBadLink(readVerdictPayload("#not base64url!"));
    });

    it("that was cut in half", async () => {
      const { hash } = await share(DESK.recipe, DESK_INPUT, "desk");
      await expectBadLink(readVerdictPayload(hash.slice(0, Math.floor(hash.length / 2))));
      await expectBadLink(readVerdictPayload(hash.slice(0, -1)));
    });

    it(`that is over ${MAX_HASH_BYTES} bytes encoded, though it would decode`, async () => {
      const wire = await goodWire();
      // The same payload at exactly the cap is a good link.
      expect(recomputed(await readVerdictPayload("#" + storedBlob(wire, MAX_HASH_BYTES)))).not.toBeNull();
      await expectBadLink(readVerdictPayload("#" + storedBlob(wire, MAX_HASH_BYTES + 2)));
    });

    it("that isn't JSON", async () => {
      const blob = await encodeBlob({ v: 2 });
      const text = new Blob([new TextEncoder().encode("{ not json")]).stream().pipeThrough(new CompressionStream("deflate-raw"));
      const bytes = new Uint8Array(await new Response(text).arrayBuffer());
      const notJson = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      expect(blob).not.toBe(notJson);
      await expectBadLink(readVerdictPayload(notJson));
    });

    it("with the wrong v, or none", async () => {
      const wire = await goodWire();
      expect(wire.v).toBe(2);
      await expectBadLink(readVerdictPayload(await encodeBlob({ ...wire, v: 3 })));
      await expectBadLink(readVerdictPayload(await encodeBlob({ ...wire, v: "2" })));
      await expectBadLink(readVerdictPayload(await encodeBlob({ ...wire, v: undefined })));
      await expectBadLink(readVerdictPayload(await encodeBlob([wire])));
      await expectBadLink(readVerdictPayload(await encodeBlob(null)));
    });

    it("from v1: a v1 wrapper, or a v1 recipe", async () => {
      const wire = await goodWire();
      // A v1 wrapper round a payload that is otherwise good today.
      await expectBadLink(readVerdictPayload(await encodeBlob({ ...wire, v: 1 })));
      // A v1 recipe, with or without a v2 wrapper, and one only relabelled v2.
      await expectBadLink(readVerdictPayload(await encodeBlob({ ...wire, v: 1, recipe: V1_RECIPE })));
      await expectBadLink(readVerdictPayload(await encodeBlob({ ...wire, recipe: V1_RECIPE })));
      await expectBadLink(readVerdictPayload(await encodeBlob({ ...wire, recipe: { ...V1_RECIPE, v: 2 } })));
      // A v2 recipe whose outcome leaves are v1 verdicts.
      const verdicts = structuredClone(DESK.recipe) as unknown as { root: { branches: Record<string, unknown> } };
      verdicts.root.branches.other = { kind: "verdict", tier: "kinda", line: "Closed a window for you, spiritually." };
      await expectBadLink(readVerdictPayload(await encodeBlob({ ...wire, recipe: verdicts })));
    });

    it("with an input that isn't a string", async () => {
      const wire = await goodWire();
      await expectBadLink(readVerdictPayload(await encodeBlob({ ...wire, input: 7 })));
      await expectBadLink(readVerdictPayload(await encodeBlob({ ...wire, input: { text: "x" } })));
      await expectBadLink(readVerdictPayload(await encodeBlob({ ...wire, input: undefined })));
    });

    it("with a recipe that fails validateRecipe", async () => {
      const wire = await goodWire();
      await expectBadLink(readVerdictPayload(await encodeBlob({ ...wire, recipe: { ...DESK.recipe, title: "" } })));
      await expectBadLink(readVerdictPayload(await encodeBlob({ ...wire, recipe: undefined })));
      await expectBadLink(readVerdictPayload(await encodeBlob({ ...wire, recipe: ladder(11) })));
    });

    it("with a trace without a spans array or a string status", async () => {
      const wire = await goodWire();
      const { spans, status, ...rest } = wire.trace;
      await expectBadLink(readVerdictPayload(await encodeBlob({ ...wire, trace: undefined })));
      await expectBadLink(readVerdictPayload(await encodeBlob({ ...wire, trace: [] })));
      await expectBadLink(readVerdictPayload(await encodeBlob({ ...wire, trace: { ...rest, status } })));
      await expectBadLink(readVerdictPayload(await encodeBlob({ ...wire, trace: { ...rest, status, spans: {} } })));
      await expectBadLink(readVerdictPayload(await encodeBlob({ ...wire, trace: { ...rest, spans } })));
      await expectBadLink(readVerdictPayload(await encodeBlob({ ...wire, trace: { ...rest, spans, status: 1 } })));
    });

    it("that has no result", async () => {
      const wire = await goodWire();
      const trace = wire.trace;
      await expectBadLink(readVerdictPayload(await encodeBlob({ ...wire, trace: { ...trace, status: "error" } })));
      await expectBadLink(readVerdictPayload(await encodeBlob({ ...wire, trace: { ...trace, output: undefined, spans: [] } })));
      await expectBadLink(
        readVerdictPayload(await encodeBlob({ ...wire, trace: { ...trace, output: null, spans: [1, null, { calls: [2] }] } })),
      );
    });
  });
});

describe("every test-curated run round-trips", () => {
  const oracles: [string, Oracle | undefined][] = [
    ["default", undefined],
    ["agreeable", agreeable],
  ];
  const runs = TEST_CURATED.flatMap((c) =>
    c.samples.flatMap((s) => oracles.map(([name, oracle]) => [c.slug, s.label, name, c, s.input, oracle] as const)),
  );

  it.each(runs)("%s, %s, %s answers", async (_slug, _label, _answers, c, input, oracle) => {
    expect(input.length).toBeLessThanOrEqual(MAX_SHARED_INPUT);
    const { trace, result } = await runRecipe(c.recipe, input, oracle);
    const href = await verdictHref({ recipe: c.recipe, input, trace, result, slug: c.slug });
    expect(href).toContain(`&r=${c.slug}&o=${result.outcome.key}#`);
    const payload = await readVerdictPayload(href.slice(href.indexOf("#")));
    // Restored, it is exactly the trace the run returned.
    expect(asJson(payload.trace)).toStrictEqual(asJson(trace));
    expect(recomputed(payload)).toEqual(result);
  });
});

describe("readVerdictPayload checks the trace against its recipe", () => {
  /** Every question kind: a gate, a route, then a rate with a choice, a score and a noul. No escape hatches. */
  const mixed = recipe(
    "The Mixed Desk",
    "the mix",
    gate(
      "first",
      "Is it the first try?",
      outcome("first-try", "First try", "It is the first try."),
      route(
        "which",
        "Which way does it go?",
        { left: "It goes left", right: "It goes right" },
        {
          left: rate(
            "vibes",
            [
              pick("colour", "What colour is it?", 2, { red: "Red", blue: "Blue", green: "Green" }, ["red"]),
              scale("size", "How big is it?", 1, ["small", "big", "huge"], "high"),
              yesNo("fun", "Is it fun?", 1, true),
            ],
            bands3("vibes"),
          ),
          right: outcome("went-right", "Went right", "It goes right, sort of."),
        },
      ),
    ),
  );

  type WireSpan = Record<string, unknown> & {
    decision?: Record<string, unknown> & { edges: Record<string, unknown>[] };
    calls: (Record<string, unknown> & { answers: Record<string, Record<string, unknown>> })[];
  };
  type Wire = Record<string, unknown> & { trace: Record<string, unknown> & { spans: WireSpan[] } };

  /** The hash's JSON for `r` run with `oracle`'s answers: for `mixed` by default, gate, route, rate. */
  async function wireOf(r: Recipe = mixed, oracle?: Oracle): Promise<Wire> {
    const { hash } = await share(r, "Some input.", null, oracle);
    return (await decodeBlob(hash.slice(1))) as Wire;
  }

  /** Reads the wire after `edit` changes a copy of it in place. Untouched, the wire must be accepted. */
  async function edited(edit: (wire: Wire) => void, r?: Recipe, oracle?: Oracle): Promise<VerdictPayload> {
    const wire = await wireOf(r, oracle);
    expect(recomputed(await readVerdictPayload(await encodeBlob(wire)))).not.toBeNull();
    const copy = structuredClone(wire);
    edit(copy);
    return readVerdictPayload(await encodeBlob(copy));
  }

  const rejects = (edit: (wire: Wire) => void, r?: Recipe, oracle?: Oracle) => expectBadLink(edited(edit, r, oracle));

  it("accepts the untouched run of every question kind", async () => {
    const wire = await wireOf();
    expect(wire.trace.spans.map((s) => s.kind)).toEqual(["gate", "route", "ask"]);
    const payload = await readVerdictPayload(await encodeBlob(wire));
    expect(recomputed(payload)).toMatchObject({ gates: 5, depth: 2 });
    expect(recomputed(payload)!.score).not.toBeNull();
  });

  describe("rejects a trace of the wrong shape", () => {
    it.each<[string, (wire: Wire) => void]>([
      ["version not 1", (w) => (w.trace.version = 2)],
      ["status not a string", (w) => (w.trace.status = 1)],
      ["durationMs missing", (w) => delete w.trace.durationMs],
      ["durationMs not a number", (w) => (w.trace.durationMs = "34")],
      ["usage missing", (w) => delete w.trace.usage],
      ["usage.requests not a number", (w) => ((w.trace.usage as Record<string, unknown>).requests = "3")],
      ["models not a list", (w) => (w.trace.models = "jev-fake")],
      ["spans not a list", (w) => (w.trace.spans = {} as never)],
      ["a span not an object", (w) => (w.trace.spans[0] = 1 as never)],
      ["span path not a string", (w) => (w.trace.spans[0]!.path = 0)],
      ["span nodeId not a string", (w) => (w.trace.spans[0]!.nodeId = null)],
      ["span kind not a string", (w) => (w.trace.spans[0]!.kind = 1)],
      ["span start not a number", (w) => (w.trace.spans[0]!.start = "0")],
      ["span calls not a list", (w) => (w.trace.spans[0]!.calls = {} as never)],
      ["span retries not a list", (w) => (w.trace.spans[0]!.retries = null)],
      ["span logs not a list", (w) => delete w.trace.spans[0]!.logs],
      ["a call not an object", (w) => (w.trace.spans[0]!.calls[0] = "call" as never)],
      ["call answers not an object", (w) => (w.trace.spans[0]!.calls[0]!.answers = [] as never)],
      ["call costUsd not a number", (w) => (w.trace.spans[0]!.calls[0]!.costUsd = "0.01")],
      ["decision missing", (w) => delete w.trace.spans[0]!.decision],
      ["decision value not a number", (w) => (w.trace.spans[0]!.decision!.value = "0.1")],
      ["decision value infinite", (w) => (w.trace.spans[0]!.decision!.value = 1e999)],
      ["decision edges not a list", (w) => (w.trace.spans[0]!.decision!.edges = {} as never)],
      ["an edge value not a number", (w) => (w.trace.spans[0]!.decision!.edges[0]!.value = "0.1")],
      ["an edge's taken not a boolean", (w) => (w.trace.spans[0]!.decision!.edges[0]!.taken = "yes")],
    ])("%s", async (_, edit) => {
      await rejects(edit);
    });
  });

  describe("rejects a trace that doesn't fit the recipe", () => {
    const answers = (w: Wire, span: number) => w.trace.spans[span]!.calls[0]!.answers;

    it.each<[string, (wire: Wire) => void]>([
      ["a node the recipe doesn't have", (w) => (w.trace.spans[1]!.nodeId = "elsewhere")],
      ["a rated question's key as a node", (w) => (w.trace.spans[2]!.nodeId = "colour")],
      ["a band's outcome key as a node", (w) => (w.trace.spans[2]!.nodeId = "vibes-high")],
      ["a span of another kind than its node", (w) => (w.trace.spans[0]!.kind = "route")],
      ["a decision of another kind than its node", (w) => (w.trace.spans[0]!.decision!.kind = "route")],
      ["a decision on another question", (w) => (w.trace.spans[0]!.decision!.question = "fun")],
      ["a decision taking an edge the node doesn't have", (w) => (w.trace.spans[1]!.decision!.taken = "up")],
      [
        "a decision taking an edge the node doesn't have, no edge marked taken",
        (w) => {
          w.trace.spans[1]!.decision!.taken = "up";
          for (const e of w.trace.spans[1]!.decision!.edges) e.taken = false;
        },
      ],
      ["a decision whose edges aren't the node's", (w) => (w.trace.spans[1]!.decision!.edges[1]!.edge = "up")],
      ["a decision with an edge missing", (w) => w.trace.spans[1]!.decision!.edges.pop()],
      ["a decision with its edges out of order", (w) => w.trace.spans[1]!.decision!.edges.reverse()],
      ["a decision marking another edge taken", (w) => (w.trace.spans[1]!.decision!.edges[1]!.taken = true)],
      ["a decision on a rate", (w) => (w.trace.spans[2]!.decision = w.trace.spans[1]!.decision)],
      ["a decision that took the other edge", (w) => (w.trace.spans[0]!.decision!.taken = "then")],
      ["no call on a gate", (w) => (w.trace.spans[0]!.calls = [])],
      ["a second call on a rate", (w) => w.trace.spans[2]!.calls.push(w.trace.spans[2]!.calls[0]!)],
      ["a span that isn't ok", (w) => (w.trace.spans[1]!.status = "error")],
      ["no spans", (w) => (w.trace.spans = [])],
      ["the root span missing", (w) => w.trace.spans.shift()],
      ["the leaf span missing", (w) => w.trace.spans.pop()],
      ["a span after the leaf", (w) => w.trace.spans.push(w.trace.spans[2]!)],
      ["spans out of order", (w) => w.trace.spans.reverse()],
      ["a span at another path", (w) => (w.trace.spans[1]!.path = "$/then")],
      ["a span under another parent", (w) => (w.trace.spans[2]!.parentPath = "$")],
      ["a span on another edge", (w) => (w.trace.spans[2]!.edge = "right")],
      ["a missing answer", (w) => delete answers(w, 2).size],
      [
        "an answer under another key",
        (w) => {
          answers(w, 2).other = answers(w, 2).size!;
          delete answers(w, 2).size;
        },
      ],
      ["an answer of another kind, otherwise fitting", (w) => (answers(w, 2).fun!.type = "score")],
      ["an extra answer", (w) => (answers(w, 2).extra = { type: "noul", noul: 0.5 })],
      ["an extra answer on a gate", (w) => (answers(w, 0).fun = { type: "noul", noul: 0.5 })],
      ["an answer that isn't an object", (w) => (answers(w, 2).fun = 0.5 as never)],
      ["a noul answer to a choice", (w) => (answers(w, 1).decision = { type: "noul", noul: 0.5 })],
      ["a choice answer to a noul", (w) => (answers(w, 2).fun = answers(w, 2).colour!)],
      ["a noul over 1", (w) => (answers(w, 0).decision!.noul = 1.5)],
      ["a noul that isn't a number", (w) => (answers(w, 2).fun!.noul = "0.5")],
      ["a route's choice of an unknown label", (w) => (answers(w, 1).decision!.choice = "up")],
      ["a rated choice of an unknown label", (w) => (answers(w, 2).colour!.choice = "purple")],
      ["a choice of an inherited key", (w) => (answers(w, 2).colour!.choice = "constructor")],
      ["a probability for an unknown label", (w) => ((answers(w, 2).colour!.probabilities as Record<string, number>).purple = 0)],
      ["a probability that isn't a number", (w) => ((answers(w, 2).colour!.probabilities as Record<string, unknown>).red = "0.9")],
      ["probabilities that aren't an object", (w) => delete answers(w, 2).colour!.probabilities],
      ["a score over the top level", (w) => (answers(w, 2).size!.score = 3)],
      ["a negative score", (w) => (answers(w, 2).size!.score = -0.5)],
      ["a score that isn't a number", (w) => (answers(w, 2).size!.score = "2")],
    ])("%s", async (_, edit) => {
      await rejects(edit);
    });

    it("rejects an own __proto__ answer, which JSON can carry", async () => {
      await rejects((w) => {
        Object.defineProperty(answers(w, 2), "__proto__", { value: { type: "noul", noul: 1 }, enumerable: true });
      });
    });

    it("rejects calls on an outcome's emit", async () => {
      const ladderWire = await wireOf(ladder(2));
      expect(ladderWire.trace.spans.at(-1)!.kind).toBe("emit");
      await rejects((w) => w.trace.spans.at(-1)!.calls.push(w.trace.spans[0]!.calls[0]!), ladder(2));
    });

    it("accepts a score between levels and any label's probability", async () => {
      const payload = await edited((w) => {
        answers(w, 2).size!.score = 1.5;
        answers(w, 0).decision!.noul = 0;
        (answers(w, 2).colour!.probabilities as Record<string, number>).blue = 1;
      });
      expect(recomputed(payload)).not.toBeNull();
    });
  });

  describe("escape hatches", () => {
    /** The edge list of a decision, as written by jevchain. */
    const edges = (w: Wire, span: number) => w.trace.spans[span]!.decision!.edges;
    const escape = (edge: string, taken = false) => ({ edge, value: 0.5, taken });

    it("accepts the desk's runs down unsure and lowConfidence as written", async () => {
      const priest = await wireOf(DESK.recipe, deskRuns.priest);
      expect(edges(priest, 1).map((e) => e.edge)).toEqual(["then", "otherwise", "unsure"]);
      expect(recomputed(await readVerdictPayload(await encodeBlob(priest)))!.outcome.key).toBe("priest");
      const dave = await wireOf(DESK.recipe, deskRuns["ask-dave"]);
      expect(edges(dave, 0).map((e) => e.edge)).toEqual(["ghost", "bill", "other", "lowConfidence"]);
      expect(recomputed(await readVerdictPayload(await encodeBlob(dave)))!.outcome.key).toBe("ask-dave");
    });

    it.each<[string, (wire: Wire) => void]>([
      ["an unsure edge on a gate without one", (w) => edges(w, 0).push(escape("unsure"))],
      [
        "an unsure edge taken on a gate without one",
        (w) => {
          for (const e of edges(w, 0)) e.taken = false;
          edges(w, 0).push(escape("unsure", true));
          w.trace.spans[0]!.decision!.taken = "unsure";
        },
      ],
      ["a lowConfidence edge on a route without one", (w) => edges(w, 1).push(escape("lowConfidence"))],
      [
        "a lowConfidence edge taken on a route without one",
        (w) => {
          for (const e of edges(w, 1)) e.taken = false;
          edges(w, 1).push(escape("lowConfidence", true));
          w.trace.spans[1]!.decision!.taken = "lowConfidence";
        },
      ],
      [
        "a lowConfidence edge on a gate, in place of otherwise",
        (w) => {
          edges(w, 0)[1]!.edge = "lowConfidence";
          w.trace.spans[0]!.decision!.taken = "lowConfidence";
        },
      ],
      [
        "a gate's escape edge taken on a route",
        (w) => {
          for (const e of edges(w, 1)) e.taken = false;
          edges(w, 1).push(escape("unsure", true));
          w.trace.spans[1]!.decision!.taken = "unsure";
        },
      ],
    ])("rejects %s", async (_, edit) => {
      await rejects(edit);
    });

    it.each<[string, (wire: Wire) => void]>([
      ["the gate's unsure edge first", (w) => edges(w, 1).unshift(edges(w, 1).pop()!)],
      ["the gate's then and otherwise swapped", (w) => edges(w, 1).splice(0, 2, edges(w, 1)[1]!, edges(w, 1)[0]!)],
      ["the route's lowConfidence edge first", (w) => edges(w, 0).unshift(edges(w, 0).pop()!)],
      ["the gate's unsure edge missing", (w) => edges(w, 1).pop()],
      ["the route's lowConfidence edge missing", (w) => edges(w, 0).pop()],
      ["the gate's unsure edge twice", (w) => edges(w, 1).push({ ...edges(w, 1).at(-1)! })],
      ["the route's lowConfidence edge in place of a label", (w) => (edges(w, 0)[2]!.edge = "lowConfidence")],
    ])("rejects a desk decision with %s", async (_, edit) => {
      await rejects(edit, DESK.recipe);
    });

    it("rejects a run down unsure rewritten to a regular edge, and back", async () => {
      // The decision says otherwise, but the next span is still at $/ghost/unsure.
      await rejects((w) => {
        w.trace.spans[1]!.decision!.taken = "otherwise";
        for (const e of edges(w, 1)) e.taken = e.edge === "otherwise";
      }, DESK.recipe, deskRuns.priest);
      // The default run's decision says unsure, but its last span is on otherwise.
      await rejects((w) => {
        w.trace.spans[1]!.decision!.taken = "unsure";
        for (const e of edges(w, 1)) e.taken = e.edge === "unsure";
      }, DESK.recipe);
    });

    it("rejects a run down lowConfidence whose leaf moved to a label's branch", async () => {
      await rejects((w) => {
        const leaf = w.trace.spans[1]!;
        leaf.path = "$/other";
        leaf.edge = "other";
        leaf.nodeId = "drafty";
      }, DESK.recipe, deskRuns["ask-dave"]);
    });

    it("rejects a span that goes down an escape edge the decision above didn't take", async () => {
      await rejects((w) => {
        const leaf = w.trace.spans[2]!;
        leaf.path = "$/ghost/unsure";
        leaf.edge = "unsure";
        leaf.nodeId = "priest";
      }, DESK.recipe);
    });
  });
});

describe("the every-cap recipe", () => {
  const r = everyCapRecipe();
  /** Over 500 characters, so it is trimmed. Words, like the recipe, so it doesn't compress by repeating. */
  const input = new Words(500).text(CAPS.input);

  /** The recipe's run along its deepest path, shared, with the hash's bytes inflated without any cap. */
  async function shared() {
    const { trace, result } = await runRecipe(r, input);
    const href = await verdictHref({ recipe: r, input, trace, result });
    const b64 = href.slice(href.indexOf("#") + 1).replace(/-/g, "+").replace(/_/g, "/");
    return { trace, result, href, inflated: inflateRawSync(Buffer.from(b64, "base64")) };
  }

  it("is valid and at every cap", () => {
    const check = validateRecipe(r);
    expect(check.ok && check.recipe).toEqual(r);
    // 26 outcome leaves, and 4 rates of 4 bands each.
    const outcomes = 26 + 4 * CAPS.bands.max;
    expect(recipeShape(r)).toEqual({ decisions: LIMITS.depth, maxDepth: LIMITS.depth, questions: LIMITS.questions, outcomes });
    const strings = everyString(r);
    expect(strings.nodes).toBe(LIMITS.nodes);
    expect(r.title).toHaveLength(CAPS.title);
    expect(r.thing).toHaveLength(CAPS.thing);
    for (const [cap, values] of [
      [CAPS.key, strings.keys],
      [CAPS.nodeTitle, strings.titles],
      [CAPS.question, strings.questions],
      [CAPS.means, strings.means],
      [CAPS.label, strings.labels],
      [CAPS.labelDescription, strings.descriptions],
      [CAPS.level, strings.levels],
      [CAPS.stamp, strings.stamps],
      [CAPS.line, strings.lines],
    ] as const) {
      expect(values.length).toBeGreaterThan(0);
      expect(values.every((s) => s.length === cap)).toBe(true);
    }
    expect(strings.questions).toHaveLength(LIMITS.questions);
    expect(strings.stamps).toHaveLength(outcomes);
    // Nothing repeats, so the link isn't small by compressing repeats.
    const all = [
      ...strings.questions,
      ...strings.means,
      ...strings.descriptions,
      ...strings.levels,
      ...strings.stamps,
      ...strings.lines,
    ];
    expect(new Set(all).size).toBe(all.length);
  });

  it("runs along its deepest path: 10 decisions, then a 6-question rate", async () => {
    const { trace, result } = await runRecipe(r, input);
    expect(trace.spans).toHaveLength(LIMITS.depth + 1);
    expect(result).toMatchObject({ depth: LIMITS.depth, gates: LIMITS.depth + CAPS.rateQuestions.max });
    expect(result.score).not.toBeNull();
  });

  it("adds little to the link beyond the recipe and the input", async () => {
    const { href } = await shared();
    const bare = await encodeBlob({ v: 2, recipe: r, input: truncateInput(input) });
    // The deepest run's trace: 11 spans and 16 answers, most of them six-label
    // choices. About 3.8 KB of the link, with the path and query.
    expect(href.length - bare.length).toBeLessThan(4_200);
  });

  /**
   * The every-cap recipe plus a 500-character input and its full trace is the
   * worst case a share link can be: about 33.7 KB (33,665 characters), well
   * over 8192 but under the 64 KB (`MAX_HASH_BYTES`) budget the owner set for
   * #63. It still decodes through the public `readVerdictPayload` path, same
   * as any other link, and round-trips exactly. Inflated it is about 65,000
   * bytes, and real answers (request ids, longer decimals) add more: the
   * 128 KB (`MAX_PAYLOAD_BYTES`) inflate cap leaves room for them.
   */
  it("gives a link under 65536 characters that round-trips exactly, under half the inflate cap", async () => {
    const { href, trace, result, inflated } = await shared();
    expect(href.length).toBeLessThan(36_000);
    expect(href.length).toBeLessThan(65536);
    expect(href.length).toBeLessThan(MAX_HASH_BYTES);
    expect(inflated.byteLength).toBeLessThan(MAX_PAYLOAD_BYTES / 1.5);
    const payload = await readVerdictPayload(href.slice(href.indexOf("#")));
    expect(payload.input).toHaveLength(MAX_SHARED_INPUT);
    expect(payload.input.endsWith("…")).toBe(true);
    expect(payload.recipe).toEqual(r);
    // The live trace with its input trimmed the way the link trims it.
    expect(asJson(payload.trace)).toStrictEqual(asJson(withInput(trace, payload.input)));
    expect(recomputed(payload)).toEqual(result);
  });
});

describe("curatedSlugFor", () => {
  it("names a curated recipe, including one that came back from a link", async () => {
    expect(curatedSlugFor(DESK.recipe)).toBe("desk");
    expect(curatedSlugFor(gatedRate())).toBe("vibes");
    const { hash } = await share(DESK.recipe, DESK_INPUT);
    expect(curatedSlugFor((await readVerdictPayload(hash)).recipe)).toBe("desk");
  });

  it("doesn't care about key order", () => {
    const reversed = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(reversed)
        : typeof value === "object" && value !== null
          ? Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reversed(v)]))
          : value;
    const reordered = reversed(DESK.recipe) as Recipe;
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(DESK.recipe));
    expect(curatedSlugFor(reordered)).toBe("desk");
  });

  it("is null for anything else", () => {
    expect(curatedSlugFor(ladder(3))).toBeNull();
    expect(curatedSlugFor(desk())).toBe("desk");
    expect(curatedSlugFor({ ...DESK.recipe, title: "The Toaster Dispatch Desk" })).toBeNull();
    // One outcome's line off by a character.
    const edited = structuredClone(DESK.recipe);
    if (edited.root.kind === "route") edited.root.lowConfidence = outcome("ask-dave", "Sent to Dave", "Probably Dave!");
    expect(curatedSlugFor(edited)).toBeNull();
  });
});

describe("studioHref", () => {
  async function studioPayload(href: string) {
    return (await decodeBlob(href.slice(href.indexOf("#") + 1))) as {
      v: number;
      chain: { doc: ChainDocument };
      input: unknown;
      trace: Trace;
    };
  }

  it("links a live run with its full input and every call state", async () => {
    const long = "The microwave counts down from 13 no matter what. ".repeat(20);
    expect(long.length).toBeGreaterThan(MAX_SHARED_INPUT);
    const { trace } = await runRecipe(DESK.recipe, long, deskRuns["refund-half"]);
    const href = await studioHref({ recipe: DESK.recipe, input: long, trace }, "https://studio.example/");
    expect(href.startsWith("https://studio.example/studio/share#")).toBe(true);

    const payload = await studioPayload(href);
    expect(payload.v).toBe(1);
    expect(payload.chain.doc.refs).toEqual([]);
    expect(payload.chain.doc.name).toBe(DESK.recipe.title);
    expect(payload.input).toBe(long);
    const states = callStates(payload.trace);
    expect(states).toHaveLength(2);
    expect(states.every((s) => s === long)).toBe(true);
  });

  it("links a shared page with its trimmed input and restored trace", async () => {
    const long = "The dishwasher sings sea shanties on the rinse cycle. ".repeat(20);
    const { hash } = await share(DESK.recipe, long, "desk", deskRuns.priest);
    const shared = await readVerdictPayload(hash);
    const payload = await studioPayload(await studioHref(shared));
    expect(payload.input).toBe(shared.input);
    expect(isTrimmed(payload.input as string)).toBe(true);
    const states = callStates(payload.trace);
    expect(states).toHaveLength(2);
    expect(states.every((s) => s === shared.input)).toBe(true);
    expect(payload.trace.spans.at(-1)!.path).toBe("$/ghost/unsure");
  });

  it("defaults to jev-chain.com", async () => {
    expect(STUDIO_URL).toBe("https://jev-chain.com");
    const { trace } = await runRecipe(DESK.recipe, DESK_INPUT);
    const href = await studioHref({ recipe: DESK.recipe, input: DESK_INPUT, trace });
    expect(href.startsWith("https://jev-chain.com/studio/share#")).toBe(true);
  });

  it("reads NEXT_PUBLIC_STUDIO_URL, trailing slashes trimmed", async () => {
    vi.stubEnv("NEXT_PUBLIC_STUDIO_URL", "http://localhost:3000//");
    vi.resetModules();
    const fresh = await import("./share");
    expect(fresh.STUDIO_URL).toBe("http://localhost:3000");
  });
});
