import { describe, expect, it } from "vitest";
import { COPY } from "./copy";
import { toneIssue } from "./deadpan";

describe("COPY", () => {
  const strings = Object.entries(COPY).flatMap(([key, value]) =>
    typeof value === "string" ? [[key, value] as const] : [],
  );

  it("holds exactly the strings and key names the spec lists", () => {
    const actual = Object.fromEntries(strings);
    expect(actual).toEqual({
      siteTitle: "Will it jev?",
      jevs: "It jevs.",
      tagline: "Paste anything. Jev routes it through a small, serious bureaucracy, and you watch every decision it makes.",
      motto: "Every computer is AND gates. Every decision is jev gates.",
      prompt: "What do you want to jev?",
      placeholder: "Paste a text, a pitch, a plan. Anything that needs deciding.",
      submit: "Jev it",
      desksHeading: "Pick a desk",
      newDesk: "New desk for anything",
      newDeskTitle: "A new desk",
      newDeskNote: "Paste anything and Jev sets up a desk for it: the gates, the departments and where it all ends up.",
      noDeskYet: "The desk is drawn here once your text is broken down.",
      samplesLabel: "Sample input",
      graphHint: "Click any gate to see Jev's numbers.",
      whyHeading: "Every decision, and why",
      decomposing: "Breaking it down into gates.",
      running: "Jevving.",
      decomposerOff: "Free-form jevving is off. The examples still work.",
      wontJev: "This could not be broken down. Try one of the examples.",
      rateLimited: "That is enough jevving for one minute. Try again shortly.",
      paused: "Jevving is paused. Try again later.",
      tooShort: "There is nothing here to jev.",
      tooLong: "That is too long to jev. Keep it under 2,000 characters.",
      jevCrashed: "Jev did not answer. This happens.",
      retry: "Try again",
      share: "Copy link",
      copied: "Copied.",
      openInStudio: "Open in the studio",
      openInStudioTrimmed: "Open in the studio (trimmed input)",
      showCode: "Show the code",
      hideCode: "Hide the code",
      codeNote:
        "This is the desk as jevchain code. The site works out a rating's outcome from its answers, so that part is not in the code.",
      again: "Jev something else",
      badLink: "This link is damaged. Part of it is missing.",
      jevSomething: "Jev something yourself",
      generatedTitle: "Something was jevved.",
      sentThis: "Someone sent you this.",
      trimmed: "The text was trimmed to keep the link short.",
      disclosure:
        "Your text goes to an LLM provider to be broken down into gates. This site keeps none of it.",
      noKey: "This server has no TYPESAFE_API_KEY. Nothing can be jevved.",
      tooLarge: "That request is too large to jev.",
      notJson: "The request is not JSON.",
      notRecipe: "This site would not make that request.",
    });
  });

  it("keeps every string flat", () => {
    expect(strings.length).toBeGreaterThan(30);
    for (const [key, text] of [...strings]) {
      expect(toneIssue(text), key).toBeNull();
    }
  });

  it("keeps every formatter's output flat", () => {
    const outputs = [
      COPY.gatesAndDepth(1, 1),
      COPY.gatesAndDepth(9, 4),
      COPY.stats(9, 4, 212),
      COPY.stats(9, 4, 212, 0.5),
      COPY.score(0.7),
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
    expect(COPY.stats(9, 4, 212, null)).toBe("9 gates. 4 deep. 212ms.");
  });

  it("puts a rating's score last in the stats", () => {
    expect(COPY.stats(1, 0, 90, 0.5)).toBe("1 gate. 0 deep. 90ms. Score 0.50.");
  });

  it("formats a score to two places", () => {
    expect(COPY.score(0.7)).toBe("Score 0.70.");
    expect(COPY.score(1)).toBe("Score 1.00.");
  });

  it("describes a shape, one decision or many", () => {
    expect(COPY.shape(1, 1)).toBe("1 decision. 1 deep.");
    expect(COPY.shape(10, 10)).toBe("10 decisions. Up to 10 deep.");
  });
});
