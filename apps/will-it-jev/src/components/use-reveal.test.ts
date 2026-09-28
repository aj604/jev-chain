import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  REVEAL_STEP_MS,
  createRevealer,
  prefersReducedMotion,
  revealed,
  subscribeReducedMotion,
  useReveal,
  type Revealer,
} from "./use-reveal";

const STEP = 100;
const paced = { stepMs: STEP, reduced: false };

/** What the hook would return right now for `total`. */
const shownFor = (r: Revealer, total: number, reduced = false) => revealed(r.get(), total, reduced);

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("createRevealer", () => {
  it("paces one row per step up to total, then stops", () => {
    const r = createRevealer();
    r.update(3, paced);
    expect(r.get().shown).toBe(1);
    vi.advanceTimersByTime(STEP - 1);
    expect(r.get().shown).toBe(1);
    vi.advanceTimersByTime(1);
    expect(r.get().shown).toBe(2);
    vi.advanceTimersByTime(STEP);
    expect(r.get().shown).toBe(3);
    vi.advanceTimersByTime(STEP * 10);
    expect(r.get().shown).toBe(3);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps pacing from where it is when total grows, without restarting the step", () => {
    const r = createRevealer();
    r.update(2, paced);
    vi.advanceTimersByTime(STEP);
    expect(r.get().shown).toBe(2);
    // A new row lands halfway through the step after the last reveal.
    vi.advanceTimersByTime(STEP / 2);
    r.update(4, paced);
    expect(r.get().shown).toBe(2);
    vi.advanceTimersByTime(STEP / 2);
    expect(r.get().shown).toBe(3);
    vi.advanceTimersByTime(STEP);
    expect(r.get().shown).toBe(4);
  });

  it("does not stall when rows arrive faster than the step", () => {
    const r = createRevealer();
    let total = 1;
    r.update(total, paced);
    for (let i = 0; i < 10; i++) {
      vi.advanceTimersByTime(STEP / 4);
      r.update(++total, paced);
    }
    // 250ms in: the first row at 0, then one per 100ms.
    expect(r.get().shown).toBe(3);
  });

  it("shows a row as soon as it lands once the pacing has caught up", () => {
    const r = createRevealer();
    r.update(1, paced);
    vi.advanceTimersByTime(STEP * 5);
    r.update(2, paced);
    expect(r.get().shown).toBe(2);
  });

  it("resets when total drops, then paces the new run", () => {
    const r = createRevealer();
    r.update(5, paced);
    vi.advanceTimersByTime(STEP * 10);
    expect(r.get().shown).toBe(5);

    r.update(3, paced);
    expect(r.get()).toEqual({ shown: 1, total: 3 });
    vi.advanceTimersByTime(STEP);
    expect(r.get().shown).toBe(2);

    r.update(0, paced);
    expect(r.get()).toEqual({ shown: 0, total: 0 });
  });

  it("shows everything at once under reduced motion", () => {
    const r = createRevealer();
    r.update(7, { stepMs: STEP, reduced: true });
    expect(r.get().shown).toBe(7);
    expect(vi.getTimerCount()).toBe(0);
    r.update(9, { stepMs: STEP, reduced: true });
    expect(r.get().shown).toBe(9);
  });

  it("stops a waiting step and picks up again on the next update", () => {
    const r = createRevealer();
    r.update(3, paced);
    r.stop();
    vi.advanceTimersByTime(STEP * 5);
    expect(r.get().shown).toBe(1);
    r.update(3, paced);
    expect(r.get().shown).toBe(2);
  });

  it("tells subscribers about each change, with a new snapshot", () => {
    const r = createRevealer();
    const seen: number[] = [];
    const unsubscribe = r.subscribe(() => seen.push(r.get().shown));
    const before = r.get();
    r.update(2, paced);
    expect(r.get()).not.toBe(before);
    vi.advanceTimersByTime(STEP);
    unsubscribe();
    r.update(0, paced);
    expect(seen).toEqual([0, 1, 2]);
  });
});

describe("revealed", () => {
  it("is the revealer's count, capped at total", () => {
    const r = createRevealer();
    r.update(4, paced);
    expect(shownFor(r, 4)).toBe(1);
    expect(shownFor(r, 6)).toBe(1);
  });

  it("is 0 for a dropped total before the revealer hears of it", () => {
    expect(revealed({ shown: 8, total: 8 }, 3, false)).toBe(0);
  });

  it("is total under reduced motion, whatever was shown", () => {
    expect(revealed({ shown: 0, total: 0 }, 5, true)).toBe(5);
    expect(revealed({ shown: 8, total: 8 }, 3, true)).toBe(3);
  });
});

describe("reduced motion", () => {
  function stubMatchMedia(matches: boolean) {
    const listeners = new Set<() => void>();
    const matchMedia = vi.fn((query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)" && matches,
      addEventListener: (_: string, fn: () => void) => listeners.add(fn),
      removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
    }));
    vi.stubGlobal("window", { matchMedia });
    return listeners;
  }

  it("reads prefers-reduced-motion", () => {
    stubMatchMedia(true);
    expect(prefersReducedMotion()).toBe(true);
    stubMatchMedia(false);
    expect(prefersReducedMotion()).toBe(false);
  });

  it("is false with no window or no matchMedia", () => {
    expect(prefersReducedMotion()).toBe(false);
    vi.stubGlobal("window", {});
    expect(prefersReducedMotion()).toBe(false);
    expect(subscribeReducedMotion(() => {})).toBeTypeOf("function");
  });

  it("subscribes to preference changes and unsubscribes", () => {
    const listeners = stubMatchMedia(true);
    const unsubscribe = subscribeReducedMotion(() => {});
    expect(listeners.size).toBe(1);
    unsubscribe();
    expect(listeners.size).toBe(0);
  });
});

describe("useReveal", () => {
  it("renders on the server with nothing revealed yet", () => {
    function Probe({ total }: { total: number }) {
      return createElement("span", null, String(useReveal(total)));
    }
    expect(renderToStaticMarkup(createElement(Probe, { total: 4 }))).toBe("<span>0</span>");
  });

  it("paces at 260ms by default", () => {
    expect(REVEAL_STEP_MS).toBe(260);
  });
});
