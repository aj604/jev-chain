import { constants as zlibConstants, createInflateRaw, inflateRawSync } from "node:zlib";
import { run, type Answer, type ChainDocument, type Trace } from "jevchain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CURATED, tonight } from "@/recipes";
import { everyCapRecipe, Words } from "@/test/every-cap";
import { fakeJev, type Oracle } from "@/test/fake-jev";
import { ladder } from "@/test/fixtures";
import { COPY } from "./copy";
import { gate, pick, rate, recipe, route, scale, verdict, yesNo } from "./recipe/build";
import { compileRecipe } from "./recipe/compile";
import { recipeShape } from "./recipe/tree";
import { CAPS, LIMITS, type Recipe, type RecipeNode } from "./recipe/types";
import { validateRecipe } from "./recipe/validate";
import { verdictOf, type Verdict } from "./recipe/verdict";
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
  verdictPayloadOf,
  type VerdictPayload,
} from "./share";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

const TONIGHT_INPUT = tonight.samples[1].input;

async function runRecipe(r: Recipe, input: string, oracle?: Oracle) {
  const { client } = fakeJev(oracle);
  const result = await run(compileRecipe(r), input, { jev: client });
  const trace = result.trace;
  const verdict = verdictOf(r, { status: result.status, output: result.status === "ok" ? result.output : undefined, trace });
  if (!verdict) throw new Error("the run has no verdict");
  return { trace, verdict };
}

/** A verdict link for `r` run on `input`, split into its query and hash. */
async function share(r: Recipe, input: string, slug?: string | null) {
  const { trace, verdict } = await runRecipe(r, input);
  const href = await verdictHref({ recipe: r, input, trace, verdict, slug });
  const hashAt = href.indexOf("#");
  return { href, path: href.slice(0, hashAt), hash: href.slice(hashAt), trace, verdict };
}

function callStates(trace: Trace): unknown[] {
  return trace.spans.flatMap((span) => span.calls.map((call) => call.state));
}

/** The verdict the page shows, recomputed from a decoded payload. */
function recomputed(p: { recipe: Recipe; trace: Trace }): Verdict | null {
  return verdictOf(p.recipe, { status: p.trace.status, output: p.trace.output, trace: p.trace });
}

async function expectBadLink(promise: Promise<unknown>) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(ShareError);
  expect((error as ShareError).message).toBe(COPY.badLink);
}

/** Every noul says 0.9, every score the top level, every choice the last label. As in the recipes' tests. */
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

/** Every string in a recipe by what it is, and its node count. */
function everyString(r: Recipe) {
  const out = { nodes: 0, keys: [] as string[], questions: [] as string[], labels: [] as string[] };
  const more = { descriptions: [] as string[], levels: [] as string[], lines: [] as string[] };
  const labelled = (labels: Record<string, string>) => {
    out.labels.push(...Object.keys(labels));
    more.descriptions.push(...Object.values(labels));
  };
  const visit = (node: RecipeNode) => {
    out.nodes++;
    switch (node.kind) {
      case "verdict":
        more.lines.push(node.line);
        return;
      case "rate":
        out.keys.push(node.key);
        more.lines.push(...Object.values(node.verdicts));
        for (const q of node.questions) {
          out.keys.push(q.key);
          out.questions.push(q.question);
          if (q.kind === "choice") labelled(q.labels);
          if (q.kind === "score") more.levels.push(...q.levels);
        }
        return;
      case "gate":
        out.keys.push(node.key);
        out.questions.push(node.question);
        visit(node.then);
        visit(node.otherwise);
        return;
      case "route":
        out.keys.push(node.key);
        out.questions.push(node.question);
        labelled(node.labels);
        Object.values(node.branches).forEach(visit);
    }
  };
  visit(r.root);
  return { ...out, ...more };
}

/** A generated recipe: one rate leaf, whatever the title. */
function rated(title: string): Recipe {
  return recipe(
    title,
    "it",
    gate(
      "ok",
      "Is it ok?",
      "no",
      rate("vibes", [yesNo("fun", "Is it fun?", 1, true)], {
        jevs: "It jevs.",
        kinda: "It sort of jevs.",
        nope: "It does not jev.",
      }),
      verdict("nope", "It is not ok."),
    ),
  );
}

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
    const value = { v: 1, text: "Just one drink. 🍺", n: [1, 2, 3] };
    const blob = await encodeBlob(value);
    expect(blob).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(await decodeBlob(blob)).toEqual(value);
  });

  it("rejects an empty blob, padding and characters outside base64url", async () => {
    const blob = await encodeBlob({ v: 1 });
    await expectBadLink(decodeBlob(""));
    // Padded the way plain base64 would be, so only the padding is wrong.
    let unpadded = blob;
    for (let n = 0; unpadded.length % 4 === 0; n++) unpadded = await encodeBlob({ v: 1, n });
    expect(await decodeBlob(unpadded)).toBeTruthy();
    await expectBadLink(decodeBlob(unpadded + "=".repeat(4 - (unpadded.length % 4))));
    await expectBadLink(decodeBlob(blob.slice(0, 5) + "+/" + blob.slice(5)));
    await expectBadLink(decodeBlob(blob.slice(0, 5) + " " + blob.slice(5)));
    await expectBadLink(decodeBlob("A"));
  });

  it(`rejects a blob over ${MAX_HASH_BYTES} bytes, even one that would decode`, async () => {
    await expectBadLink(decodeBlob("A".repeat(MAX_HASH_BYTES + 1)));
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
    const bomb = () => encodeBlob({ v: 1, input: "a".repeat(BOMB_BYTES) });
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

    it("stops decompressing soon after the 64 KB cap", async () => {
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
      // The 64 KB cap is about 64 compressed bytes of this bomb, and the
      // decompressor inflates every byte it is fed. It must not be fed it all.
      expect(eager.fed).toBeGreaterThan(0);
      expect(eager.fed).toBeLessThan(compressedBytes(blob) / 4);
      expect(eager.bytes).toBeLessThan(BOMB_BYTES / 4);
    });

    it("decodes an honest blob through a decompressor that inflates whatever it gets", async () => {
      const value = { v: 1, text: "x".repeat(40_000), n: Array.from({ length: 2_000 }, (_, i) => i) };
      const blob = await encodeBlob(value);
      const eager = inflateEagerly();
      expect(await decodeBlob(blob)).toEqual(value);
      expect(eager.fed).toBe(compressedBytes(blob));
    });
  });
});

describe("shareQueryString and parseShareQuery", () => {
  it("writes t, g, d and r in that order", () => {
    expect(shareQueryString({ tier: "jevs", gates: 10, depth: 10, slug: "tonight" })).toBe("t=jevs&g=10&d=10&r=tonight");
    expect(shareQueryString({ tier: "nope", gates: 0, depth: 0, slug: null })).toBe("t=nope&g=0&d=0");
  });

  it("reads good values back", () => {
    const q = { tier: "kinda", gates: 30, depth: 10, slug: "tonight" } as const;
    expect(parseShareQuery(new URLSearchParams(shareQueryString(q)))).toEqual(q);
    expect(parseShareQuery(new URLSearchParams("t=nope&g=0&d=0"))).toEqual({ tier: "nope", gates: 0, depth: 0, slug: null });
    expect(parseShareQuery(new URLSearchParams("t=jevs&g=3&d=2&utm=x"))).toEqual({
      tier: "jevs",
      gates: 3,
      depth: 2,
      slug: null,
    });
  });

  it("reads Next's searchParams record", () => {
    expect(parseShareQuery({ t: "jevs", g: "10", d: "10", r: "tonight" })).toEqual({
      tier: "jevs",
      gates: 10,
      depth: 10,
      slug: "tonight",
    });
    expect(parseShareQuery({ t: "jevs", g: "1", d: "1", r: undefined })).toEqual({ tier: "jevs", gates: 1, depth: 1, slug: null });
    expect(parseShareQuery({ t: ["jevs", "nope"], g: "1", d: "1" })).toBeNull();
    expect(parseShareQuery({ t: ["jevs"], g: ["1"], d: ["1"] })).toEqual({ tier: "jevs", gates: 1, depth: 1, slug: null });
  });

  it.each([
    ["a bad tier", "t=great&g=1&d=1"],
    ["g=31", "t=jevs&g=31&d=1"],
    ["d=11", "t=jevs&g=1&d=11"],
    ["a negative count", "t=jevs&g=-1&d=1"],
    ["a fractional count", "t=jevs&g=1.5&d=1"],
    ["a count written oddly", "t=jevs&g=07&d=1"],
    ["a count that isn't a number", "t=jevs&g=ten&d=1"],
    ["an empty count", "t=jevs&g=&d=1"],
    ["an unknown slug", "t=jevs&g=1&d=1&r=nonsense"],
    ["an empty slug", "t=jevs&g=1&d=1&r="],
    ["a repeated slug", "t=jevs&g=1&d=1&r=tonight&r=tonight"],
    ["a missing tier", "g=1&d=1"],
    ["missing gates", "t=jevs&d=1"],
    ["missing depth", "t=jevs&g=1"],
    ["a repeated tier", "t=jevs&t=jevs&g=1&d=1"],
    ["repeated gates", "t=jevs&g=1&g=1&d=1"],
    ["repeated depth", "t=jevs&g=1&d=1&d=1"],
    ["nothing", ""],
  ])("gives the plain card for %s", (_, query) => {
    expect(parseShareQuery(new URLSearchParams(query))).toBeNull();
  });
});

describe("verdictHref and readVerdictPayload", () => {
  it("round-trips tonight", async () => {
    const { path, hash, trace } = await share(tonight.recipe, TONIGHT_INPUT, "tonight");
    expect(path).toBe("/v?t=jevs&g=10&d=10&r=tonight");

    const payload = await readVerdictPayload(hash);
    expect(payload.v).toBe(1);
    expect(payload.recipe).toEqual(tonight.recipe);
    expect(payload.input).toBe(TONIGHT_INPUT);
    expect(payload.trace.input).toBe(TONIGHT_INPUT);
    const states = callStates(payload.trace);
    expect(states).toHaveLength(10);
    expect(states.every((s) => s === TONIGHT_INPUT)).toBe(true);
    expect(payload.trace.spans.every((s) => s.input === TONIGHT_INPUT)).toBe(true);
    // Restored, it is the trace the run returned.
    expect(payload.trace).toEqual(JSON.parse(JSON.stringify(trace)));
    expect(recomputed(payload)).toMatchObject({ tier: "jevs", gates: 10, depth: 10 });
  });

  it("slims the hash: the trimmed input, no span inputs and no call states", async () => {
    const long = "Drinks at eight, then the late show at eleven. ".repeat(40);
    expect(long.length).toBeGreaterThan(MAX_SHARED_INPUT);
    const { hash } = await share(tonight.recipe, long, "tonight");
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
    const { hash, trace } = await share(tonight.recipe, TONIGHT_INPUT, "tonight");
    const wire = (await decodeBlob(hash.slice(1))) as { trace: { spans: Record<string, unknown>[] } };
    expect(wire.trace).not.toHaveProperty("output");
    expect(wire.trace.spans).toHaveLength(trace.spans.length);
    for (const span of wire.trace.spans) {
      expect(span).not.toHaveProperty("title");
      expect(span).not.toHaveProperty("output");
      for (const call of span.calls as Record<string, unknown>[]) expect(call).not.toHaveProperty("questions");
    }
    // The lines and questions are in the hash once: in the recipe.
    const json = JSON.stringify(wire);
    const line = "It jevs. This is a plan, not a night out.";
    expect(json.split(line)).toHaveLength(2);
    expect(json.split("Does the plan end at karaoke?")).toHaveLength(2);
  });

  it("restores the trace input from the payload's input, not the trace's own", async () => {
    const { hash } = await share(tonight.recipe, TONIGHT_INPUT, "tonight");
    const wire = (await decodeBlob(hash.slice(1))) as Record<string, unknown> & { trace: Record<string, unknown> };
    const forged = await encodeBlob({ ...wire, trace: { ...wire.trace, input: "forged" } });
    expect((await readVerdictPayload(forged)).trace.input).toBe(TONIGHT_INPUT);
  });

  it("restores outputs from the recipe and the answers, not the trace's own", async () => {
    const { hash, verdict } = await share(tonight.recipe, TONIGHT_INPUT, "tonight");
    const wire = (await decodeBlob(hash.slice(1))) as Record<string, unknown> & { trace: { spans: object[] } };
    const forgedOutput = { tier: "nope", line: "Forged." };
    const spans = wire.trace.spans.map((span) => ({ ...span, title: "Forged.", output: forgedOutput }));
    const payload = await readVerdictPayload(await encodeBlob({ ...wire, trace: { ...wire.trace, output: forgedOutput, spans } }));
    expect(payload.trace.output).toEqual({ tier: "jevs", line: "It jevs. This is a plan, not a night out." });
    expect(payload.trace.spans.every((s) => s.output !== undefined && s.title !== "Forged.")).toBe(true);
    expect(recomputed(payload)).toEqual(verdict);
  });

  it("accepts the hash without its #", async () => {
    const { hash } = await share(tonight.recipe, TONIGHT_INPUT, "tonight");
    expect((await readVerdictPayload(hash.slice(1))).input).toBe(TONIGHT_INPUT);
  });

  it("never puts user text in the query", async () => {
    const { path, hash } = await share(rated("Will zanzibar jev?"), "quetzalcoatl is the password", "tonight-not");
    expect(path).toMatch(/^\/v\?t=(jevs|kinda|nope)&g=\d+&d=\d+$/);
    expect(path).not.toContain("zanzibar");
    expect(path).not.toContain("quetzalcoatl");
    expect(path).not.toContain("r=");
    expect((await readVerdictPayload(hash)).recipe.title).toBe("Will zanzibar jev?");
  });

  it("sets r only for a curated slug", async () => {
    expect((await share(ladder(2), "x")).path).not.toContain("r=");
    expect((await share(ladder(2), "x", null)).path).not.toContain("r=");
    expect((await share(ladder(2), "x", "nonsense")).path).not.toContain("r=");
  });

  it("trims a long input to 500 characters ending in …", async () => {
    const long = "The plan is dinner and then the film. ".repeat(20);
    expect(long.length).toBeGreaterThan(MAX_SHARED_INPUT);
    const payload = await readVerdictPayload((await share(tonight.recipe, long, "tonight")).hash);
    expect(payload.input).toHaveLength(MAX_SHARED_INPUT);
    expect(payload.input.endsWith("…")).toBe(true);
    expect(payload.input).toBe(truncateInput(long));
    expect(isTrimmed(payload.input)).toBe(true);
    expect(payload.trace.input).toBe(payload.input);
    expect(callStates(payload.trace).every((s) => s === payload.input)).toBe(true);
  });

  it("recomputes the verdict from the hash whatever the query says", async () => {
    const real = await share(ladder(3), "x", null);
    expect(real.path).toBe("/v?t=jevs&g=3&d=3");

    const url = new URL(`/v?t=nope&g=30&d=0&r=tonight${real.hash}`, "https://example.test");
    expect(parseShareQuery(url.searchParams)).toEqual({ tier: "nope", gates: 30, depth: 0, slug: "tonight" });

    const payload = await readVerdictPayload(url.hash);
    expect(recomputed(payload)).toEqual(real.verdict);
    expect(recomputed(payload)).toMatchObject({ tier: "jevs", gates: 3, depth: 3 });
    expect(curatedSlugFor(payload.recipe)).toBeNull();
  });

  it("keeps the verdict of a run that ended early", async () => {
    const { client } = fakeJev(() => ({ noul: 0.9 }));
    const r = ladder(3);
    const result = await run(compileRecipe(r), "x", { jev: client });
    const v = verdictOf(r, { status: result.status, output: result.status === "ok" ? result.output : undefined, trace: result.trace });
    expect(v).toMatchObject({ tier: "nope", gates: 1, depth: 1 });
    const href = await verdictHref({ recipe: r, input: "x", trace: result.trace, verdict: v! });
    expect(href.startsWith("/v?t=nope&g=1&d=1#")).toBe(true);
    expect(recomputed(await readVerdictPayload(href.slice(href.indexOf("#"))))).toEqual(v);
  });

  describe("rejects a damaged link", () => {
    async function goodWire() {
      const { hash } = await share(tonight.recipe, TONIGHT_INPUT, "tonight");
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
      const { hash } = await share(tonight.recipe, TONIGHT_INPUT, "tonight");
      await expectBadLink(readVerdictPayload(hash.slice(0, Math.floor(hash.length / 2))));
      await expectBadLink(readVerdictPayload(hash.slice(0, -1)));
    });

    it(`that is over ${MAX_HASH_BYTES} bytes encoded`, async () => {
      await expectBadLink(readVerdictPayload("#" + "A".repeat(MAX_HASH_BYTES + 1)));
    });

    it("that isn't JSON", async () => {
      const blob = await encodeBlob({ v: 1 });
      const text = new Blob([new TextEncoder().encode("{ not json")]).stream().pipeThrough(new CompressionStream("deflate-raw"));
      const bytes = new Uint8Array(await new Response(text).arrayBuffer());
      const notJson = btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
      expect(blob).not.toBe(notJson);
      await expectBadLink(readVerdictPayload(notJson));
    });

    it("with the wrong v, or none", async () => {
      const wire = await goodWire();
      await expectBadLink(readVerdictPayload(await encodeBlob({ ...wire, v: 2 })));
      await expectBadLink(readVerdictPayload(await encodeBlob({ ...wire, v: "1" })));
      await expectBadLink(readVerdictPayload(await encodeBlob({ ...wire, v: undefined })));
      await expectBadLink(readVerdictPayload(await encodeBlob([wire])));
      await expectBadLink(readVerdictPayload(await encodeBlob(null)));
    });

    it("with an input that isn't a string", async () => {
      const wire = await goodWire();
      await expectBadLink(readVerdictPayload(await encodeBlob({ ...wire, input: 7 })));
      await expectBadLink(readVerdictPayload(await encodeBlob({ ...wire, input: { text: "x" } })));
      await expectBadLink(readVerdictPayload(await encodeBlob({ ...wire, input: undefined })));
    });

    it("with a recipe that fails validateRecipe", async () => {
      const wire = await goodWire();
      await expectBadLink(readVerdictPayload(await encodeBlob({ ...wire, recipe: { ...tonight.recipe, title: "" } })));
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

    it("that verdictOf can't score", async () => {
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

describe("every curated run round-trips", () => {
  const runs = CURATED.flatMap((c) =>
    c.samples.flatMap((s) => [
      [c.slug, s.label, "default", c, s.input, undefined] as const,
      [c.slug, s.label, "agreeable", c, s.input, agreeable] as const,
    ]),
  );

  it.each(runs)("%s, %s, %s answers", async (_slug, _label, _answers, c, input, oracle) => {
    expect(input.length).toBeLessThanOrEqual(MAX_SHARED_INPUT);
    const { trace, verdict } = await runRecipe(c.recipe, input, oracle);
    const href = await verdictHref({ recipe: c.recipe, input, trace, verdict, slug: c.slug });
    const payload = await readVerdictPayload(href.slice(href.indexOf("#")));
    // Restored, it is exactly the trace the run returned.
    expect(asJson(payload.trace)).toStrictEqual(asJson(trace));
    expect(recomputed(payload)).toEqual(verdict);
  });
});

describe("readVerdictPayload checks the trace against its recipe", () => {
  /** Every question kind: a gate, a route, then a rate with a choice, a score and a noul. */
  const mixed = recipe(
    "Will the mix jev?",
    "the mix",
    gate(
      "first",
      "Is it the first try?",
      "no",
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
            { jevs: "It jevs.", kinda: "It sort of jevs.", nope: "It does not jev." },
          ),
          right: verdict("kinda", "It goes right, sort of."),
        },
      ),
      verdict("nope", "It is not the first try."),
    ),
  );

  type WireSpan = Record<string, unknown> & {
    decision?: Record<string, unknown> & { edges: Record<string, unknown>[] };
    calls: (Record<string, unknown> & { answers: Record<string, Record<string, unknown>> })[];
  };
  type Wire = Record<string, unknown> & { trace: Record<string, unknown> & { spans: WireSpan[] } };

  /** The hash's JSON for `r` run with default answers: for `mixed`, gate, route, rate. */
  async function wireOf(r: Recipe = mixed): Promise<Wire> {
    const { hash } = await share(r, "Some input.");
    return (await decodeBlob(hash.slice(1))) as Wire;
  }

  /** Reads the wire after `edit` changes a copy of it in place. Untouched, the wire must be accepted. */
  async function edited(edit: (wire: Wire) => void, r?: Recipe): Promise<VerdictPayload> {
    const wire = await wireOf(r);
    expect(recomputed(await readVerdictPayload(await encodeBlob(wire)))).not.toBeNull();
    const copy = structuredClone(wire);
    edit(copy);
    return readVerdictPayload(await encodeBlob(copy));
  }

  const rejects = (edit: (wire: Wire) => void, r?: Recipe) => expectBadLink(edited(edit, r));

  it("accepts the untouched run of every question kind", async () => {
    const wire = await wireOf();
    expect(wire.trace.spans.map((s) => s.kind)).toEqual(["gate", "route", "ask"]);
    const payload = await readVerdictPayload(await encodeBlob(wire));
    expect(recomputed(payload)).toMatchObject({ gates: 5, depth: 2 });
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
      ["a decision marking another edge taken", (w) => (w.trace.spans[1]!.decision!.edges[1]!.taken = true)],
      ["a decision on a rate", (w) => (w.trace.spans[2]!.decision = w.trace.spans[1]!.decision)],
      ["a decision that took the other edge", (w) => (w.trace.spans[0]!.decision!.taken = "otherwise")],
      ["no call on a gate", (w) => (w.trace.spans[0]!.calls = [])],
      ["a second call on a rate", (w) => w.trace.spans[2]!.calls.push(w.trace.spans[2]!.calls[0]!)],
      ["a span that isn't ok", (w) => (w.trace.spans[1]!.status = "error")],
      ["no spans", (w) => (w.trace.spans = [])],
      ["the root span missing", (w) => w.trace.spans.shift()],
      ["the leaf span missing", (w) => w.trace.spans.pop()],
      ["a span after the leaf", (w) => w.trace.spans.push(w.trace.spans[2]!)],
      ["spans out of order", (w) => w.trace.spans.reverse()],
      ["a span at another path", (w) => (w.trace.spans[1]!.path = "$/otherwise")],
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

    it("rejects calls on a verdict's emit", async () => {
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
});

describe("the every-cap recipe", () => {
  const r = everyCapRecipe();
  /** Over 500 characters, so it is trimmed. Words, like the recipe, so it doesn't compress by repeating. */
  const input = new Words(500).text(CAPS.input);

  /** The recipe's run along its deepest path, shared, with the hash's JSON read without the hash cap. */
  async function shared() {
    const { trace, verdict } = await runRecipe(r, input);
    const href = await verdictHref({ recipe: r, input, trace, verdict });
    const b64 = href.slice(href.indexOf("#") + 1).replace(/-/g, "+").replace(/_/g, "/");
    const inflated = inflateRawSync(Buffer.from(b64, "base64"));
    return { trace, verdict, href, inflated, wire: JSON.parse(inflated.toString("utf8")) as unknown };
  }

  it("is valid and at every cap", () => {
    const check = validateRecipe(r);
    expect(check.ok && check.recipe).toEqual(r);
    expect(recipeShape(r)).toEqual({ decisions: LIMITS.depth, maxDepth: LIMITS.depth, questions: LIMITS.questions });
    const strings = everyString(r);
    expect(strings.nodes).toBe(LIMITS.nodes);
    expect(r.title).toHaveLength(CAPS.title);
    expect(r.thing).toHaveLength(CAPS.thing);
    for (const [cap, values] of [
      [CAPS.key, strings.keys],
      [CAPS.question, strings.questions],
      [CAPS.label, strings.labels],
      [CAPS.labelDescription, strings.descriptions],
      [CAPS.level, strings.levels],
      [CAPS.line, strings.lines],
    ] as const) {
      expect(values.length).toBeGreaterThan(0);
      expect(values.every((s) => s.length === cap)).toBe(true);
    }
    expect(strings.questions).toHaveLength(LIMITS.questions);
    // Nothing repeats, so the link isn't small by compressing repeats.
    const all = [...strings.questions, ...strings.descriptions, ...strings.levels, ...strings.lines];
    expect(new Set(all).size).toBe(all.length);
  });

  it("runs along its deepest path: 10 decisions, then a 6-question rate", async () => {
    const { trace, verdict } = await runRecipe(r, input);
    expect(trace.spans).toHaveLength(LIMITS.depth + 1);
    expect(verdict).toMatchObject({ depth: LIMITS.depth, gates: LIMITS.depth + CAPS.rateQuestions.max });
  });

  it("round-trips exactly, under the 64 KB inflate cap", async () => {
    const { trace, verdict, inflated, wire } = await shared();
    expect(inflated.byteLength).toBeLessThan(MAX_PAYLOAD_BYTES);
    const payload = verdictPayloadOf(wire);
    expect(payload.input).toHaveLength(MAX_SHARED_INPUT);
    expect(payload.input.endsWith("…")).toBe(true);
    expect(payload.recipe).toEqual(r);
    // The live trace with its input trimmed the way the link trims it.
    expect(asJson(payload.trace)).toStrictEqual(asJson(withInput(trace, payload.input)));
    expect(recomputed(payload)).toEqual(verdict);
  });

  it("adds little to the link beyond the recipe and the input", async () => {
    const { href } = await shared();
    const bare = await encodeBlob({ v: 1, recipe: r, input: truncateInput(input) });
    // The deepest run's trace: 11 spans and 16 answers, most of them six-label choices.
    expect(href.length - bare.length).toBeLessThan(4_500);
  });

  /**
   * The every-cap recipe plus a 500-character input and its full trace is the
   * worst case a share link can be: about 29.5 KB, well over 8192 but under
   * the 64 KB (`MAX_HASH_BYTES`) budget the owner set for #63. It still
   * decodes through the public `readVerdictPayload` path, same as any other
   * link.
   */
  it("gives a link under 65536 characters", async () => {
    const { href, trace, verdict } = await shared();
    expect(href.length).toBeLessThan(65536);
    const payload = await readVerdictPayload(href.slice(href.indexOf("#")));
    expect(payload.input).toHaveLength(MAX_SHARED_INPUT);
    expect(payload.input.endsWith("…")).toBe(true);
    expect(payload.recipe).toEqual(r);
    // The live trace with its input trimmed the way the link trims it.
    expect(asJson(payload.trace)).toStrictEqual(asJson(withInput(trace, payload.input)));
    expect(recomputed(payload)).toEqual(verdict);
  });
});

describe("every curated recipe's share link stays short", () => {
  const runs = CURATED.flatMap((c) => c.samples.map((s) => [c.slug, s.label, c, s.input] as const));

  it.each(runs)("%s, %s", async (_slug, _label, c, input) => {
    const { trace, verdict } = await runRecipe(c.recipe, input);
    const href = await verdictHref({ recipe: c.recipe, input, trace, verdict, slug: c.slug });
    expect(href.length).toBeLessThan(8192);
  });
});

describe("curatedSlugFor", () => {
  it("names a curated recipe, including one that came back from a link", async () => {
    expect(curatedSlugFor(tonight.recipe)).toBe("tonight");
    const { hash } = await share(tonight.recipe, TONIGHT_INPUT);
    expect(curatedSlugFor((await readVerdictPayload(hash)).recipe)).toBe("tonight");
  });

  it("doesn't care about key order", () => {
    const reversed = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(reversed)
        : typeof value === "object" && value !== null
          ? Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reversed(v)]))
          : value;
    const reordered = reversed(tonight.recipe) as Recipe;
    expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(tonight.recipe));
    expect(curatedSlugFor(reordered)).toBe("tonight");
  });

  it("is null for anything else", () => {
    expect(curatedSlugFor(ladder(3))).toBeNull();
    expect(curatedSlugFor({ ...tonight.recipe, title: "Will your plan for tomorrow jev?" })).toBeNull();
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
    const long = "Four bars on Dean Street, then karaoke. ".repeat(20);
    expect(long.length).toBeGreaterThan(MAX_SHARED_INPUT);
    const { trace } = await runRecipe(tonight.recipe, long);
    const href = await studioHref({ recipe: tonight.recipe, input: long, trace }, "https://studio.example/");
    expect(href.startsWith("https://studio.example/studio/share#")).toBe(true);

    const payload = await studioPayload(href);
    expect(payload.v).toBe(1);
    expect(payload.chain.doc.refs).toEqual([]);
    expect(payload.chain.doc.name).toBe(tonight.recipe.title);
    expect(payload.input).toBe(long);
    const states = callStates(payload.trace);
    expect(states).toHaveLength(10);
    expect(states.every((s) => s === long)).toBe(true);
  });

  it("links a shared page with its trimmed input and restored trace", async () => {
    const long = "Dinner at 7, then the 9:15 film, then home. ".repeat(20);
    const { hash } = await share(tonight.recipe, long, "tonight");
    const shared = await readVerdictPayload(hash);
    const payload = await studioPayload(await studioHref(shared));
    expect(payload.input).toBe(shared.input);
    expect(isTrimmed(payload.input as string)).toBe(true);
    const states = callStates(payload.trace);
    expect(states).toHaveLength(10);
    expect(states.every((s) => s === shared.input)).toBe(true);
  });

  it("defaults to jev-chain.com", async () => {
    expect(STUDIO_URL).toBe("https://jev-chain.com");
    const { trace } = await runRecipe(tonight.recipe, TONIGHT_INPUT);
    const href = await studioHref({ recipe: tonight.recipe, input: TONIGHT_INPUT, trace });
    expect(href.startsWith("https://jev-chain.com/studio/share#")).toBe(true);
  });

  it("reads NEXT_PUBLIC_STUDIO_URL, trailing slashes trimmed", async () => {
    vi.stubEnv("NEXT_PUBLIC_STUDIO_URL", "http://localhost:3000//");
    vi.resetModules();
    const fresh = await import("./share");
    expect(fresh.STUDIO_URL).toBe("http://localhost:3000");
  });
});
