import { describe, expect, it } from "vitest";
import { toneIssue } from "@/lib/deadpan";
import { CAPS, LIMITS } from "@/lib/recipe/types";
import { breakup, excuse, startup } from "@/recipes";
import { SYSTEM_PROMPT } from "./prompt";

describe("SYSTEM_PROMPT", () => {
  it("is in the house voice", () => {
    expect(toneIssue(SYSTEM_PROMPT)).toBeNull();
  });

  it("contains the example recipes' JSON", () => {
    expect(SYSTEM_PROMPT).toContain(JSON.stringify(breakup.recipe));
    expect(SYSTEM_PROMPT).toContain(JSON.stringify(excuse.recipe));
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

  it("teaches the v2 node kinds and the rated question kinds", () => {
    for (const kind of ["gate", "route", "rate", "outcome", "noul", "score", "choice"]) {
      expect(SYSTEM_PROMPT).toContain(`- ${kind}: `);
    }
    expect(SYSTEM_PROMPT).toContain('{"v": 2,');
    expect(SYSTEM_PROMPT).toContain("Levels are listed lowest first");
    expect(SYSTEM_PROMPT).not.toContain("- verdict: ");
  });

  it("describes the curly brace rule without writing the braces", () => {
    expect(SYSTEM_PROMPT).toContain("Never use double curly braces");
    expect(SYSTEM_PROMPT).not.toContain("{{");
  });
});
