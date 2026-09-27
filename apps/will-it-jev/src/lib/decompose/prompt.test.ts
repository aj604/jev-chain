import { describe, expect, it } from "vitest";
import { toneIssue } from "@/lib/deadpan";
import { CAPS, LIMITS } from "@/lib/recipe/types";
import { breakup, startup } from "@/recipes";
import { SYSTEM_PROMPT } from "./prompt";

describe("SYSTEM_PROMPT", () => {
  it("is in the house voice", () => {
    expect(toneIssue(SYSTEM_PROMPT)).toBeNull();
  });

  it("contains both example recipes' JSON", () => {
    expect(SYSTEM_PROMPT).toContain(JSON.stringify(breakup.recipe));
    expect(SYSTEM_PROMPT).toContain(JSON.stringify(startup.recipe));
  });

  it("states the depth rule with the number 10", () => {
    expect(LIMITS.depth).toBe(10);
    expect(SYSTEM_PROMPT).toContain(`At most ${LIMITS.depth} gates or routes on any path`);
    expect(SYSTEM_PROMPT).toContain("At most 10 gates or routes on any path");
  });

  it("states the other limits and caps from the constants", () => {
    for (const rule of [
      `At most ${LIMITS.nodes} nodes`,
      `At most ${LIMITS.questions} questions`,
      `up to ${CAPS.key} characters`,
      `Labels are lowercase letters, digits and dashes, up to ${CAPS.label} characters`,
      `positive numbers up to ${CAPS.maxWeight}`,
      `Questions are up to ${CAPS.question} characters`,
      `up to ${CAPS.line} characters`,
    ]) {
      expect(SYSTEM_PROMPT).toContain(rule);
    }
  });

  it("teaches the node kinds, the rated question kinds and the verdict lines", () => {
    for (const kind of ["gate", "route", "rate", "verdict", "noul", "score", "choice"]) {
      expect(SYSTEM_PROMPT).toContain(`- ${kind}: `);
    }
    expect(SYSTEM_PROMPT).toContain("Levels are listed lowest first");
    expect(SYSTEM_PROMPT).toContain('starts with "Will"');
    for (const opener of ["It jevs.", "It sort of jevs.", "It does not jev."]) {
      expect(SYSTEM_PROMPT).toContain(`"${opener}"`);
    }
  });

  it("describes the curly brace rule without writing the braces", () => {
    expect(SYSTEM_PROMPT).toContain("Never use double curly braces");
    expect(SYSTEM_PROMPT).not.toContain("{{");
  });
});
