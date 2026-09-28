/** Every string the site shows lives here, so the tone test can read them all. */

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function gatesAndDepth(gates: number, depth: number): string {
  return `${plural(gates, "gate", "gates")}. ${depth} deep.`;
}

const score = (n: number) => `Score ${n.toFixed(2)}.`;

export const COPY = {
  siteTitle: "Will it jev?",
  tagline: "Paste anything. Jev routes it through a small, serious bureaucracy, and you watch every decision it makes.",
  motto: "Every computer is AND gates. Every decision is jev gates.",

  /** The stamp every finished run gets: the thing became gates and Jev decided them all. */
  jevs: "It jevs.",

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
    "This is the desk as jevchain code. The site works out a rating's outcome from its answers, so that part is not in the code.",
  again: "Jev something else",

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
  /** The result card's numbers. A rating's score goes last. */
  stats: (gates: number, depth: number, ms: number, n: number | null = null) =>
    `${gatesAndDepth(gates, depth)} ${ms}ms.${n === null ? "" : ` ${score(n)}`}`,
  score,
  shape: (decisions: number, maxDepth: number) =>
    decisions === 1
      ? `1 decision. ${maxDepth} deep.`
      : `${decisions} decisions. Up to ${maxDepth} deep.`,
} as const;
