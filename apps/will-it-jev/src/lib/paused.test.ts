import { afterEach, describe, expect, it, vi } from "vitest";
import { isPaused } from "./paused";

describe("isPaused", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([["1"], ["true"], ["no"], ["0"], [" yes "]])("is paused when PAUSED is %j", (value) => {
    expect(isPaused({ PAUSED: value })).toBe(true);
  });

  it.each([
    ["unset", {}],
    ["empty", { PAUSED: "" }],
    ["only whitespace", { PAUSED: "  \n\t" }],
  ])("is not paused when PAUSED is %s", (_, env: Record<string, string | undefined>) => {
    expect(isPaused(env)).toBe(false);
  });

  it("reads process.env by default", () => {
    vi.stubEnv("PAUSED", "");
    expect(isPaused()).toBe(false);
    vi.stubEnv("PAUSED", "1");
    expect(isPaused()).toBe(true);
  });
});
