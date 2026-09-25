/**
 * A number exactly on an edge is on the edge. Distances the framework works
 * out by subtraction (a gate value's distance from its bar, a noul's distance
 * from a coin flip) are measured as the decimals they are, not as the float
 * noise left by subtracting doubles: 2.9 − 2.5 is 0.4, not 0.3999999999999999.
 * So the documented strict rules hold on both sides of every bar, and the
 * sentence never contradicts the road ("0.40 over the bar, inside the 0.40
 * margin"; "confidence 0.90 was under the 0.90 minimum").
 */
import { describe, expect, it } from "vitest";
import { cascade, choice, confidenceOf, createJev, emit, gate, noul, route, score, tier } from "../src/index.js";
import { fakeFetch } from "./helpers";

const jevWith = (f: ReturnType<typeof fakeFetch>) => createJev({ apiKey: "test", fetch: f, retry: { initialDelayMs: 1, maxDelayMs: 2 } });
/** Hundredths as integers, so the oracle never subtracts a float. */
const h = (x: number) => Math.round(x * 100);

describe("edges are decimal edges", () => {
  it("the docs' dress-code gate: 0.5 < p(yes) < 0.7 is unsure, and 0.5 and 0.7 themselves are not", async () => {
    const dressCode = gate("dress-code", {
      ask: noul("Is this outfit appropriate for a fancy rooftop bar?"),
      pass: { min: 0.6 },
      then: emit("welcome"),
      otherwise: emit("turn away"),
      unsure: { margin: 0.1, then: emit("get the manager") },
    });
    const at = async (p: number) => (await jevWith(fakeFetch(() => ({ noul: p }))).run(dressCode, "blazer")).trace.spans[0]!.decision!;
    expect((await at(0.7)).taken).toBe("then");
    expect((await at(0.5)).taken).toBe("otherwise");
    expect((await at(0.69)).taken).toBe("unsure");
    expect((await at(0.51)).taken).toBe("unsure");
    expect((await at(0.7)).summary).toBe("Passed: p(yes) = 0.70, 0.10 over the 0.60 bar and exactly on the edge of its 0.10 unsure margin.");
    expect((await at(0.5)).summary).toBe('Blocked: p(yes) = 0.50, 0.10 short of the 0.60 bar and exactly on the edge of its 0.10 unsure margin, so took "otherwise".');
  });

  it("meeting-email at 2.90 and 2.10: exactly 0.40 from the 2.50 bar is outside the 0.40 margin", async () => {
    const meeting = gate("needs-a-meeting", {
      ask: score("?", ["slack", "email", "doc", "call", "live"]),
      pass: { min: 2.5 },
      then: emit("keep"),
      otherwise: emit("decline"),
      unsure: { margin: 0.4, then: emit("counter") },
    });
    const at = async (s: number) => (await jevWith(fakeFetch(() => ({ score: s, confidence: 0.7 }))).run(meeting, "retro")).trace.spans[0]!.decision!;
    const up = await at(2.9);
    expect(up.taken).toBe("then");
    expect(up.summary).toBe("Passed: the score came in at 2.90, 0.40 over the 2.50 bar and exactly on the edge of its 0.40 unsure margin.");
    const down = await at(2.1);
    expect(down.taken).toBe("otherwise");
    expect(down.summary).toBe('Blocked: the score came in at 2.10, 0.40 short of the 2.50 bar and exactly on the edge of its 0.40 unsure margin, so took "otherwise".');
    expect((await at(2.89)).taken).toBe("unsure");
    expect((await at(2.11)).taken).toBe("unsure");
  });

  // Every hundredth against every bar and margin in hundredths, all three bar shapes.
  it("sweep: exactly `margin` from the nearest edge is never unsure, on either side, and says so", async () => {
    const run = async (pass: { min?: number; max?: number }, margin: number, v: number) => {
      const g = gate("g", { ask: noul("?"), pass, then: emit("then"), otherwise: emit("otherwise"), unsure: { margin, then: emit("unsure") } });
      return (await jevWith(fakeFetch(() => ({ noul: v }))).run(g, "x")).trace.spans[0]!.decision!;
    };
    let onEdge = 0;
    for (const pass of [{ min: 0.35 }, { max: 0.6 }, { min: 0.2, max: 0.8 }, { min: 0.7 }]) {
      const bars = [pass.min, pass.max].filter((b): b is number => b !== undefined).map(h);
      for (const margin of [0.05, 0.1, 0.15, 0.2, 0.3]) {
        for (let i = 0; i <= 100; i++) {
          const v = i / 100;
          const dist = Math.min(...bars.map((b) => Math.abs(i - b)));
          const inside = (pass.min === undefined || i >= h(pass.min)) && (pass.max === undefined || i <= h(pass.max));
          const d = await run(pass, margin, v);
          const why = `${JSON.stringify(pass)} margin=${margin} v=${v}`;
          expect(d.taken, why).toBe(dist < h(margin) ? "unsure" : inside ? "then" : "otherwise");
          if (dist === h(margin)) {
            expect(d.summary, why).toContain(`exactly on the edge of its ${margin.toFixed(2)} unsure margin`);
            onEdge++;
          }
          if (d.taken !== "unsure") expect(d.summary, why).not.toMatch(/inside the \d\.\d\d margin/);
        }
      }
    }
    expect(onEdge).toBeGreaterThan(30);
  });

  it("a noul's confidence is its decimal distance from a coin flip, so minConfidence holds at the edge", async () => {
    expect(confidenceOf({ type: "noul", noul: 0.16 })).toBe(0.68);
    expect(confidenceOf({ type: "noul", noul: 0.95 })).toBe(0.9);
    let checked = 0;
    for (let i = 0; i <= 100; i++) {
      const p = i / 100;
      const conf = Math.abs(i - 50) * 2; // in hundredths
      const minConfidence = conf / 100;
      const g = gate("g", { ask: noul("?"), pass: { min: 0.5 }, then: emit("then"), otherwise: emit("otherwise"), unsure: { minConfidence, then: emit("unsure") } });
      const d = (await jevWith(fakeFetch(() => ({ noul: p }))).run(g, "x")).trace.spans[0]!.decision!;
      expect(d.taken, `p=${p}`).toBe(i >= 50 ? "then" : "otherwise");
      expect(d.confidence, `p=${p}`).toBe(minConfidence);
      expect(d.summary, `p=${p}`).toContain(`with confidence ${minConfidence.toFixed(2)} exactly at the ${minConfidence.toFixed(2)} unsure minimum`);
      checked++;
    }
    expect(checked).toBe(101);
  });

  it("a cascade tier whose noul confidence is exactly its bar answers, without paying for the next tier", async () => {
    const c = cascade("c", {
      tiers: [tier("quick", { ask: noul("?"), minConfidence: 0.68 }), tier("thorough", { ask: noul("?"), minConfidence: 0.2 })],
      fallback: emit("llm"),
    });
    const f = fakeFetch(() => ({ noul: 0.16 }));
    const r = await jevWith(f).run(c, "x");
    const d = r.trace.spans[0]!.decision!;
    expect(d.taken).toBe("quick");
    expect(f.calls).toHaveLength(1);
    expect(d.summary).toBe('"quick" answered at 0.68 confidence (needed 0.68). No escalation needed, the cheap seats had it.');
  });

  it("a value exactly on a bar with no unsure band says it's exactly on it, not 'by a hair'", async () => {
    const at = async (pass: { min?: number; max?: number }, v: number) => {
      const g = gate("g", { ask: noul("?"), pass, then: emit("go"), otherwise: emit("no") });
      return (await jevWith(fakeFetch(() => ({ noul: v }))).run(g, "x")).trace.spans[0]!.decision!.summary;
    };
    expect(await at({ min: 0.5 }, 0.5)).toBe("Passed: p(yes) = 0.50, exactly on the 0.50 bar.");
    expect(await at({ max: 0.6 }, 0.6)).toBe("Passed: p(yes) = 0.60, exactly on the 0.60 ceiling.");
    expect(await at({ min: 0.4, max: 0.6 }, 0.4)).toBe("Passed: p(yes) = 0.40, exactly on the 0.40 floor of the 0.40–0.60 window.");
    expect(await at({ min: 0.4, max: 0.6 }, 0.6)).toBe("Passed: p(yes) = 0.60, exactly on the 0.60 ceiling of the 0.40–0.60 window.");
    // Near but not on it is still a hair.
    expect(await at({ min: 0.5 }, 0.51)).toBe("Passed: p(yes) = 0.51, clearing the 0.50 bar by a hair.");
  });

  it("the words fit the decimal distance, not the float noise under it", async () => {
    // 0.36 − 0.33 is 0.029999999999999971 in floats; it's 0.03, which is "by 0.03", not "by a hair".
    const g = gate("g", { ask: noul("?"), pass: { min: 0.33 }, then: emit("go"), otherwise: emit("no") });
    expect((await jevWith(fakeFetch(() => ({ noul: 0.36 }))).run(g, "x")).trace.spans[0]!.decision!.summary).toBe(
      "Passed: p(yes) = 0.36, clearing the 0.33 bar by 0.03.",
    );
    // 0.6 − 0.45 is 0.14999999999999997; a 0.15 split is "a clear lead".
    const r = route("r", { ask: choice("?", ["a", "b"]), branches: { a: emit("a"), b: emit("b") } });
    const d = (await jevWith(fakeFetch(() => ({ choice: "a", probabilities: { a: 0.6, b: 0.45 }, confidence: 0.7 }))).run(r, "x")).trace.spans[0]!.decision!;
    expect(d.summary).toBe('Went to "a" with 60%, a clear lead over "b" at 45% (confidence 0.70).');
  });
});
