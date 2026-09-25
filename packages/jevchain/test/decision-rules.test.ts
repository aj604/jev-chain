/**
 * Decisions record the rules they were checked against — a route's
 * low-confidence bar, a gate's unsure band, a cascade's tier bars — whether or
 * not those rules fired, and the summary measures from where the road would
 * actually change, not just from the headline bar.
 */
import { describe, expect, it } from "vitest";
import { cascade, choice, createJev, emit, gate, noul, route, score, tier } from "../src/index.js";
import { fakeFetch } from "./helpers";

const jevWith = (f: ReturnType<typeof fakeFetch>) => createJev({ apiKey: "test", fetch: f, retry: { initialDelayMs: 1, maxDelayMs: 2 } });

// "by a hair" / "by 0.06" / "comfortably (by 0.20)" / "easily (by 0.49)": four capture groups.
const BY = String.raw`(by a hair|by (\d+\.\d+)|comfortably \(by (\d+\.\d+)\)|easily \(by (\d+\.\d+)\))`;
const readBy = (m: RegExpMatchArray, at: number) => {
  const n = m[at + 1] ?? m[at + 2] ?? m[at + 3];
  return { word: m[at] === "by a hair" ? "hair" : m[at]!.split(" ")[0]!, n: n === undefined ? undefined : Number(n) };
};
/** The word has to fit the distance, and the number (rounded to 0.01) has to be it. */
const expectFits = (b: ReturnType<typeof readBy>, actual: number, why: string) => {
  const want = actual < 0.03 ? "hair" : actual < 0.1 ? "by" : actual < 0.25 ? "comfortably" : "easily";
  expect(b.word, why).toBe(want);
  if (b.n !== undefined) expect(Math.abs(b.n - actual), why).toBeLessThanOrEqual(0.005 + 1e-9);
};

describe("decisions record the rules they were checked against", () => {
  it("a route that didn't fall back says how far its confidence was over the low-confidence bar", async () => {
    // haunted-desk "Double charge", as the studio saw it: 0.06 from being sent to Dave.
    const desk = route("desk", {
      ask: choice("?", ["repair", "billing", "paranormal"]),
      branches: { repair: emit("R"), billing: emit("B"), paranormal: emit("P") },
      lowConfidence: { below: 0.4, then: emit("Dave") },
    });
    const probabilities = { billing: 0.62, repair: 0.2, paranormal: 0.18 };
    const at = async (confidence: number) =>
      (await jevWith(fakeFetch(() => ({ choice: "billing", probabilities, confidence }))).run(desk, "charged twice")).trace.spans[0]!.decision!;
    const d = await at(0.46);
    expect(d.taken).toBe("billing");
    expect(d.lowConfidence).toEqual({ below: 0.4 });
    expect(d.summary).toBe(
      'Went to "billing" with 62%, a comfortable win over "repair" at 20% (confidence 0.46, 0.06 over the 0.40 low-confidence bar).',
    );
    // Recorded when it fires too; the fallback sentence is unchanged.
    const low = await at(0.3);
    expect(low).toMatchObject({ taken: "lowConfidence", fallback: true, lowConfidence: { below: 0.4 } });
    expect(low.summary).toBe('Jev leaned "billing" but only at 0.30 confidence, under the 0.40 bar, so it took the low-confidence path instead of guessing.');
    const exact = await at(0.4);
    expect(exact.taken).toBe("billing");
    expect(exact.summary).toMatch(/\(confidence 0\.40, exactly at the 0\.40 low-confidence bar\)\.$/);
  });

  it("a gate with an unsure band measures from the band's edge, where the road changes", async () => {
    // meeting-email "Incident retro": 0.89 over the bar, but only 0.49 from the counter-offer.
    const meeting = gate("needs-a-meeting", {
      ask: score("?", ["slack", "email", "doc", "call", "live"]),
      pass: { min: 2.5 },
      then: emit("keep"),
      otherwise: emit("decline"),
      unsure: { margin: 0.4, then: emit("counter") },
    });
    const at = async (s: number) => (await jevWith(fakeFetch(() => ({ score: s, confidence: 0.7 }))).run(meeting, "retro")).trace.spans[0]!.decision!;
    const d = await at(3.39);
    expect(d.taken).toBe("then");
    expect(d.unsure).toEqual({ margin: 0.4 });
    expect(d.summary).toBe("Passed: the score came in at 3.39, 0.89 over the 2.50 bar and clear of its 0.40 unsure margin easily (by 0.49).");
    // Exactly on the band's edge isn't in it (the margin is strict).
    const g = gate("g", { ask: noul("?"), pass: { min: 0.5 }, then: emit("go"), otherwise: emit("no"), unsure: { margin: 0.25, then: emit("?") } });
    expect((await jevWith(fakeFetch(() => ({ noul: 0.25 }))).run(g, "x")).trace.spans[0]!.decision!.summary).toBe(
      'Blocked: p(yes) = 0.25, 0.25 short of the 0.50 bar and exactly on the edge of its 0.25 unsure margin, so took "otherwise".',
    );
  });

  it("a gate with minConfidence says how far confidence cleared it, noul gates included", async () => {
    const g = gate("g", { ask: noul("ok?"), pass: { min: 0.5 }, then: emit("go"), unsure: { minConfidence: 0.6, then: emit("?") } });
    const d = (await jevWith(fakeFetch(() => ({ noul: 0.9 }))).run(g, "x")).trace.spans[0]!.decision!;
    expect(d).toMatchObject({ taken: "then", unsure: { minConfidence: 0.6 } });
    expect(d.confidence).toBeCloseTo(0.8);
    expect(d.summary).toBe(
      "Passed: p(yes) = 0.90, clearing the 0.50 bar easily (by 0.40), with confidence 0.80 over the 0.60 unsure minimum comfortably (by 0.20).",
    );
  });

  it("sweep: a gate's distance to its unsure minimum is true and routing is untouched", async () => {
    const g = gate("g", {
      ask: choice("?", ["yes", "no"]),
      pass: { label: "yes", min: 0.5 },
      then: emit("then"),
      otherwise: emit("otherwise"),
      unsure: { minConfidence: 0.6, then: emit("unsure") },
    });
    const run = async (confidence: number) => (await jevWith(fakeFetch(() => ({ choice: "yes", confidence }))).run(g, "x")).trace.spans[0]!.decision!;
    let checked = 0;
    for (let i = 0; i <= 100; i++) {
      const c = i / 100;
      const d = await run(c);
      expect(d.taken).toBe(c < 0.6 ? "unsure" : "then");
      if (d.taken === "unsure" || c === 0.6) continue;
      const m = d.summary.match(new RegExp(String.raw`, with confidence (\d+\.\d+) over the 0\.60 unsure minimum ${BY}\.$`));
      expect(m, d.summary).not.toBeNull();
      const b = readBy(m!, 2);
      expectFits(b, c - 0.6, `c=${c}`);
      expect((await run(c - ((b.n ?? 0.03) + 0.006))).taken).toBe("unsure");
      if (b.n !== undefined && b.n > 0.006) expect((await run(c - (b.n - 0.006))).taken).toBe("then");
      checked++;
    }
    expect(checked).toBe(40);
    expect((await run(0.6)).summary).toMatch(/, with confidence 0\.60 exactly at the 0\.60 unsure minimum\.$/);
  });

  it("a cascade records each tier's bar", async () => {
    const c = cascade("c", {
      tiers: [
        tier("quick", { ask: choice("?", ["yes", "no"]), minConfidence: 0.8 }),
        tier("thorough", { ask: choice("?", ["yes", "no"]), minConfidence: 0.6 }),
      ],
      fallback: emit("llm"),
    });
    const d = (await jevWith(fakeFetch(() => ({ confidence: 0.7 }))).run(c, "x")).trace.spans[0]!.decision!;
    expect(d).toMatchObject({ taken: "thorough", tierBars: { quick: 0.8, thorough: 0.6 } });
  });

  it("nodes without those rules record nothing new and say what they always said", async () => {
    const plain = route("p", { ask: choice("?", ["a", "b"]), branches: { a: emit(1), b: emit(2) } });
    const d = (await jevWith(fakeFetch(() => ({ choice: "a" }))).run(plain, "x")).trace.spans[0]!.decision!;
    expect(d).not.toHaveProperty("lowConfidence");
    expect(d.summary).toBe('Went to "a" with 90%, a landslide over "b" at 10% (confidence 0.85).');
    const g = gate("g", { ask: noul("ok?"), pass: { min: 0.7 }, then: emit("go") });
    const gd = (await jevWith(fakeFetch(() => ({ noul: 0.99 }))).run(g, "x")).trace.spans[0]!.decision!;
    expect(gd).not.toHaveProperty("unsure");
    expect(gd).not.toHaveProperty("confidence");
    expect(gd.summary).toBe("Passed: p(yes) = 0.99, clearing the 0.70 bar easily (by 0.29).");
  });

  // Every stated distance is the real one, in the right direction, and moving
  // the value by it (and not by less) is exactly what changes the road.
  it("sweep: gate distances to the unsure band are true, point the right way, and routing is untouched", async () => {
    const shapes: { min?: number; max?: number }[] = [{ min: 0.5 }, { max: 0.5 }, { min: 0.3, max: 0.7 }];
    let checked = 0;
    for (const pass of shapes) {
      for (const margin of [0.05, 0.1, 0.2]) {
        for (const withOtherwise of [true, false]) {
          const g = gate("g", {
            ask: noul("?"),
            pass,
            then: emit("then"),
            ...(withOtherwise ? { otherwise: emit("otherwise") } : {}),
            unsure: { margin, then: emit("unsure") },
          });
          const run = async (v: number) => (await jevWith(fakeFetch(() => ({ noul: v }))).run(g, "x")).trace.spans[0]!.decision!;
          const bars = [pass.min, pass.max].filter((b): b is number => b !== undefined);
          for (let i = 0; i <= 100; i++) {
            const v = i / 100;
            const why = `${JSON.stringify(pass)} margin=${margin} otherwise=${withOtherwise} v=${v}`;
            const d = await run(v);
            // Routing, computed independently from the documented rule.
            const near = bars.reduce((a, b) => (Math.abs(v - b) < Math.abs(v - a) ? b : a));
            const inside = (pass.min === undefined || v >= pass.min) && (pass.max === undefined || v <= pass.max);
            const want = Math.abs(v - near) < margin ? "unsure" : inside ? "then" : withOtherwise ? "otherwise" : "halt";
            expect(d.taken, why).toBe(want);
            expect(d.unsure, why).toEqual({ margin });
            if (d.taken === "unsure") continue;
            const m = d.summary.match(
              new RegExp(String.raw`, (\d+\.\d+) (over|under|short of|inside) the .*? and (?:exactly on the edge of|clear of) its (\d+\.\d+) unsure margin(?: ${BY})?`),
            );
            expect(m, `${why}: ${d.summary}`).not.toBeNull();
            const dist = Math.abs(v - near);
            expect(Math.abs(Number(m![1]) - dist), why).toBeLessThanOrEqual(0.005 + 1e-9);
            const dir = m![2]!;
            if (dir === "over") expect(v, why).toBeGreaterThan(near);
            if (dir === "under" || dir === "short of") expect(v, why).toBeLessThan(near);
            // Passing words only on a pass, blocking words only on a block.
            expect(["inside", "under"].includes(dir) || (dir === "over" && pass.max === undefined), why).toBe(inside);
            expect(Number(m![3]), why).toBe(margin);
            const gap = dist - margin;
            const toward = Math.sign(near - v);
            if (m![4] === undefined) {
              expect(gap, why).toBeLessThan(1e-9); // "exactly on the edge"
              expect((await run(v + toward * 0.001)).taken, why).toBe("unsure");
            } else {
              const b = readBy(m!, 4);
              expectFits(b, gap, why);
              // Moving past the stated gap lands in the band...
              expect((await run(v + toward * ((b.n ?? 0.03) + 0.006))).taken, why).toBe("unsure");
              // ...and moving just short of it doesn't change the road.
              if (b.n !== undefined && b.n > 0.006) expect((await run(v + toward * (b.n - 0.006))).taken, why).toBe(d.taken);
            }
            checked++;
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(900);
  });

  it("sweep: a route's distance to its low-confidence bar is true and routing is untouched", async () => {
    const r = route("r", { ask: choice("?", ["a", "b"]), branches: { a: emit("a"), b: emit("b") }, lowConfidence: { below: 0.4, then: emit("low") } });
    const run = async (confidence: number) => (await jevWith(fakeFetch(() => ({ choice: "a", confidence }))).run(r, "x")).trace.spans[0]!.decision!;
    let checked = 0;
    for (let i = 0; i <= 100; i++) {
      const c = i / 100;
      const d = await run(c);
      expect(d.taken).toBe(c < 0.4 ? "lowConfidence" : "a");
      expect(d.lowConfidence).toEqual({ below: 0.4 });
      if (d.taken === "lowConfidence" || c === 0.4) continue;
      const m = d.summary.match(/\(confidence (\d+\.\d+), (\d+\.\d+) over the 0\.40 low-confidence bar\)\.$/);
      expect(m, d.summary).not.toBeNull();
      expect(Number(m![1])).toBeCloseTo(c);
      const stated = Number(m![2]);
      expect(Math.abs(stated - (c - 0.4)), `c=${c}`).toBeLessThanOrEqual(0.005 + 1e-9);
      // Dropping confidence by the stated distance (and a rounding step) hands it to the fallback; by less doesn't.
      expect((await run(c - (stated + 0.006))).taken).toBe("lowConfidence");
      if (stated > 0.006) expect((await run(c - (stated - 0.006))).taken).toBe("a");
      checked++;
    }
    expect(checked).toBe(60);
  });
});
