import { describe, expect, it } from "vitest";
import { clientKey, createRateLimiter, slide } from "./rate-limit";

const cfg = { limit: 3, windowMs: 1000 };

describe("slide", () => {
  it("allows hits under the limit and counts down remaining", () => {
    let hits: number[] = [];
    const results = [0, 10, 20].map((t) => {
      const r = slide(hits, t, cfg);
      hits = r.hits;
      return r;
    });
    expect(results.map((r) => r.allowed)).toEqual([true, true, true]);
    expect(results.map((r) => r.remaining)).toEqual([2, 1, 0]);
  });

  it("denies at the limit with retry-after until the oldest hit expires", () => {
    const r = slide([0, 100, 200], 500, cfg);
    expect(r.allowed).toBe(false);
    expect(r.remaining).toBe(0);
    expect(r.retryAfterMs).toBe(500);
    expect(r.hits).toEqual([0, 100, 200]); // denied hits are not recorded
  });

  it("slides: old hits fall out of the window", () => {
    const r = slide([0, 100, 200], 1001, cfg);
    expect(r.allowed).toBe(true);
    expect(r.hits).toEqual([100, 200, 1001]);
  });

  it("does not mutate its input", () => {
    const hits = [0, 1];
    slide(hits, 2, cfg);
    expect(hits).toEqual([0, 1]);
  });
});

describe("createRateLimiter", () => {
  it("tracks keys independently", () => {
    let now = 0;
    const rl = createRateLimiter({ ...cfg, now: () => now });
    for (let i = 0; i < 3; i++) expect(rl.check("a").allowed).toBe(true);
    expect(rl.check("a").allowed).toBe(false);
    expect(rl.check("b").allowed).toBe(true);
    now = 1500;
    expect(rl.check("a").allowed).toBe(true);
  });

  it("prunes idle keys and respects maxKeys", () => {
    let now = 0;
    const rl = createRateLimiter({ ...cfg, maxKeys: 2, now: () => now });
    rl.check("a");
    rl.check("b");
    now = 5000;
    rl.check("c"); // over capacity → prune drops a and b
    expect(rl.size).toBe(1);
    rl.check("d");
    rl.check("e"); // both live → evicts oldest
    expect(rl.size).toBe(2);
  });
});

describe("clientKey", () => {
  it("prefers the first x-forwarded-for address", () => {
    expect(clientKey(new Headers({ "x-forwarded-for": "1.2.3.4, 10.0.0.1" }))).toBe("1.2.3.4");
  });
  it("falls back to x-real-ip, then anonymous", () => {
    expect(clientKey(new Headers({ "x-real-ip": "5.6.7.8" }))).toBe("5.6.7.8");
    expect(clientKey(new Headers())).toBe("anonymous");
  });
});
