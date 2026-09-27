import { run, type ChainDocument, type Trace } from "jevchain";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tonight } from "@/recipes";
import { fakeJev, type Oracle } from "@/test/fake-jev";
import { ladder } from "@/test/fixtures";
import { COPY } from "./copy";
import { gate, rate, recipe, verdict, yesNo } from "./recipe/build";
import { compileRecipe } from "./recipe/compile";
import type { Recipe } from "./recipe/types";
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

  it("rejects a blob over 16 KB, even one that would decode", async () => {
    await expectBadLink(decodeBlob("A".repeat(MAX_HASH_BYTES + 1)));
    // Pseudo-random hex hardly compresses: about 30 KB of JSON, over 16 KB encoded.
    let seed = 1;
    const hex = Array.from({ length: 30_000 }, () => ((seed = (seed * 48271) % 0x7fffffff) % 16).toString(16)).join("");
    const blob = await encodeBlob({ hex });
    expect(blob.length).toBeGreaterThan(MAX_HASH_BYTES);
    expect(JSON.stringify({ hex }).length).toBeLessThan(MAX_PAYLOAD_BYTES);
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

  it("slims the hash: no span inputs and no call states", async () => {
    const { hash } = await share(tonight.recipe, TONIGHT_INPUT, "tonight");
    const wire = (await decodeBlob(hash.slice(1))) as { trace: { input: unknown; spans: Record<string, unknown>[] } };
    expect(wire.trace.input).toBe(TONIGHT_INPUT);
    for (const span of wire.trace.spans) {
      expect(span).not.toHaveProperty("input");
      for (const call of span.calls as Record<string, unknown>[]) expect(call).not.toHaveProperty("state");
    }
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

    it("that is over 16 KB encoded", async () => {
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
      await expectBadLink(readVerdictPayload(await encodeBlob({ ...wire, trace: { ...trace, output: { tier: "jevs", line: "Forged." } } })));
      await expectBadLink(readVerdictPayload(await encodeBlob({ ...wire, trace: { ...trace, output: undefined, spans: [] } })));
      // Junk spans and calls don't throw, they just score nothing.
      await expectBadLink(
        readVerdictPayload(await encodeBlob({ ...wire, trace: { ...trace, output: null, spans: [1, null, { calls: [2] }] } })),
      );
    });
  });
});

describe("curatedSlugFor", () => {
  it("names a curated recipe, including one that came back from a link", async () => {
    expect(curatedSlugFor(tonight.recipe)).toBe("tonight");
    const { hash } = await share(tonight.recipe, TONIGHT_INPUT);
    expect(curatedSlugFor((await readVerdictPayload(hash)).recipe)).toBe("tonight");
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
