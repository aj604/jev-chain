import { describe, expect, it } from "vitest";
import { countWord } from "./count-word";

describe("countWord", () => {
  it("spells small counts, lowercase unless it starts a sentence", () => {
    expect(countWord(6)).toBe("six");
    expect(countWord(6, { capital: true })).toBe("Six");
    expect(countWord(12)).toBe("twelve");
  });

  it("keeps larger counts as digits", () => {
    expect(countWord(13)).toBe("13");
    expect(countWord(13, { capital: true })).toBe("13");
  });
});
