import { describe, expect, it } from "vitest";
import { formatCombo, matchesStep, parseCombo, type Stroke } from "./hotkeys";

const stroke = (key: string, mods: Partial<Omit<Stroke, "key">> = {}): Stroke => ({
  key,
  code: "",
  ctrl: false,
  meta: false,
  alt: false,
  shift: false,
  ...mods,
});

describe("parseCombo", () => {
  it("parses modifiers, aliases and sequences", () => {
    expect(parseCombo("mod+Enter")).toEqual([
      { key: "enter", mod: true, ctrl: false, meta: false, alt: false, shift: false },
    ]);
    expect(parseCombo("g s").map((s) => s.key)).toEqual(["g", "s"]);
    expect(parseCombo("esc")[0].key).toBe("escape");
  });
});

describe("matchesStep", () => {
  it("maps mod to meta on mac and ctrl elsewhere", () => {
    const [step] = parseCombo("mod+k");
    expect(matchesStep(step, stroke("k", { meta: true }), true)).toBe(true);
    expect(matchesStep(step, stroke("k", { ctrl: true }), true)).toBe(false);
    expect(matchesStep(step, stroke("k", { ctrl: true }), false)).toBe(true);
  });

  it("requires exact modifiers", () => {
    const [t] = parseCombo("t");
    expect(matchesStep(t, stroke("t"), true)).toBe(true);
    expect(matchesStep(t, stroke("t", { meta: true }), true)).toBe(false);
    expect(matchesStep(t, stroke("T", { shift: true }), true)).toBe(false);
  });

  it("ignores shift for symbols like ?", () => {
    const [q] = parseCombo("?");
    expect(matchesStep(q, stroke("?", { shift: true }), false)).toBe(true);
  });

  it("falls back to the physical key for alt combos", () => {
    const [step] = parseCombo("alt+d");
    expect(matchesStep(step, { ...stroke("∂", { alt: true }), code: "KeyD" }, true)).toBe(true);
  });
});

describe("formatCombo", () => {
  it("renders platform labels", () => {
    expect(formatCombo("mod+enter", true)).toEqual([["⌘", "↵"]]);
    expect(formatCombo("mod+enter", false)).toEqual([["ctrl", "↵"]]);
    expect(formatCombo("g s", true)).toEqual([["g"], ["s"]]);
  });
});
