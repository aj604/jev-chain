import { describe, expect, it } from "vitest";
import { toneIssue } from "./deadpan";

describe("toneIssue", () => {
  it("passes flat sentences", () => {
    expect(toneIssue("It jevs. Send it.")).toBeNull();
    expect(toneIssue("Every decision is jev gates.")).toBeNull();
  });

  it("fails on an exclamation mark", () => {
    expect(toneIssue("It jevs!")).toBe("no exclamation marks. keep it flat");
  });

  it("fails on emoji", () => {
    expect(toneIssue("It jevs. \u{1F389}")).toBe("no emoji");
    expect(toneIssue("Nice ❤️")).toBe("no emoji");
  });

  it("fails on lol and lmao as whole words, in any case", () => {
    expect(toneIssue("lol it jevs.")).toBe("no lol");
    expect(toneIssue("It jevs, LMAO.")).toBe("no lol");
  });

  it("lets lol inside a longer word through", () => {
    expect(toneIssue("Lollipop.")).toBeNull();
  });
});
