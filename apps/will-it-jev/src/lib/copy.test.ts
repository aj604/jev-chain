import { describe, expect, it } from "vitest";
import { COPY, TIER_TEXT, lineRest } from "./copy";
import { toneIssue } from "./deadpan";
import { TIERS } from "./tiers";

describe("TIER_TEXT", () => {
  it("reads exactly, in TIERS order", () => {
    expect(TIERS.map((t) => TIER_TEXT[t])).toEqual([
      "It jevs.",
      "It sort of jevs.",
      "It does not jev.",
    ]);
  });
});

describe("COPY", () => {
  const strings = Object.entries(COPY).flatMap(([key, value]) =>
    typeof value === "string" ? [[key, value] as const] : [],
  );

  it("keeps every string flat", () => {
    expect(strings.length).toBeGreaterThan(30);
    for (const [key, text] of [...strings, ...Object.entries(TIER_TEXT)]) {
      expect(toneIssue(text), key).toBeNull();
    }
  });

  it("keeps every formatter's output flat", () => {
    const outputs = [
      COPY.gatesAndDepth(1, 1),
      COPY.gatesAndDepth(9, 4),
      COPY.stats(9, 4, 212),
      COPY.score(0.7),
      COPY.gateLabel(3),
      COPY.shape(1, 1),
      COPY.shape(10, 10),
    ];
    for (const text of outputs) expect(toneIssue(text), text).toBeNull();
  });

  it("formats gates and depth", () => {
    expect(COPY.gatesAndDepth(1, 1)).toBe("1 gate. 1 deep.");
    expect(COPY.gatesAndDepth(9, 4)).toBe("9 gates. 4 deep.");
  });

  it("formats stats", () => {
    expect(COPY.stats(9, 4, 212)).toBe("9 gates. 4 deep. 212ms.");
  });

  it("formats a score to two places", () => {
    expect(COPY.score(0.7)).toBe("Score 0.70.");
    expect(COPY.score(1)).toBe("Score 1.00.");
  });

  it("labels a gate", () => {
    expect(COPY.gateLabel(3)).toBe("Gate 3");
  });

  it("describes a shape, one decision or many", () => {
    expect(COPY.shape(1, 1)).toBe("1 decision. 1 deep.");
    expect(COPY.shape(10, 10)).toBe("10 decisions. Up to 10 deep.");
  });
});

describe("lineRest", () => {
  it("strips the tier sentence", () => {
    expect(lineRest("It jevs. Send it.", "jevs")).toBe("Send it.");
  });

  it("leaves nothing when the line is only the tier sentence", () => {
    expect(lineRest("It does not jev.", "nope")).toBe("");
  });

  it("returns other lines unchanged", () => {
    expect(lineRest("Send it anyway.", "jevs")).toBe("Send it anyway.");
    expect(lineRest("It sort of jevs. Maybe.", "jevs")).toBe("It sort of jevs. Maybe.");
  });
});
