import type { Tier } from "./tiers";

/** Every string the site shows lives here, so the tone test can read them all. */

export const TIER_TEXT: Record<Tier, string> = {
  jevs: "It jevs.",
  kinda: "It sort of jevs.",
  nope: "It does not jev.",
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function gatesAndDepth(gates: number, depth: number): string {
  return `${plural(gates, "gate", "gates")}. ${depth} deep.`;
}

export const COPY = {
  siteTitle: "Will it jev?",
  tagline: "Every computer is AND gates. Every decision is jev gates.",

  prompt: "What do you want to jev?",
  placeholder: "Paste a text, a pitch, a plan. Anything that needs deciding.",
  submit: "Jev it",
  examplesHeading: "Or jev one of these.",
  writeYourOwn: "Write your own",
  disclosure:
    "Your text goes to an LLM provider to be broken down into gates. This site keeps none of it.",

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
    "This is the circuit. The site works out the verdict from its answers, so that part is not in the code.",
  again: "Jev something else",
  rating: "Rating",

  badLink: "This link is damaged. Part of it is missing.",
  jevSomething: "Jev something yourself",
  generatedTitle: "Something was jevved.",
  sentThis: "Someone sent you this.",
  trimmed: "The text was trimmed to keep the link short.",

  // Server error lines.
  noKey: "This server has no TYPESAFE_API_KEY. Nothing can be jevved.",
  tooLarge: "That request is too large to jev.",
  notJson: "The request is not JSON.",
  notRecipe: "This site would not make that request.",

  gatesAndDepth,
  stats: (gates: number, depth: number, ms: number) => `${gatesAndDepth(gates, depth)} ${ms}ms.`,
  score: (n: number) => `Score ${n.toFixed(2)}.`,
  gateLabel: (n: number) => `Gate ${n}`,
  shape: (decisions: number, maxDepth: number) =>
    decisions === 1
      ? `1 decision. ${maxDepth} deep.`
      : `${decisions} decisions. Up to ${maxDepth} deep.`,
} as const;

/** A verdict line minus its leading tier sentence. Other lines come back unchanged. */
export function lineRest(line: string, tier: Tier): string {
  const head = TIER_TEXT[tier];
  return line.startsWith(head) ? line.slice(head.length).trimStart() : line;
}
