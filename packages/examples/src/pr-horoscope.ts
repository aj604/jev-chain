/**
 * Pull Request Horoscope
 * Pattern: one call, many questions, combined in code.
 *
 * A single `ask` sends five questions about the same PR in one request. A step
 * turns the typed answers into a risk number and a horoscope. Note how
 * `a.scope.choice` is typed as the literal union of labels: no string typos.
 */
import { ask, chain, choice, noul, score, step, type OutputOf } from "jevchain";
import type { Example } from "./types";

const read = ask("read-the-pr", {
  title: "Read the PR",
  questions: {
    clarity: score("How clearly does the description explain what changed and why?", ["no description", "vague", "clear", "exemplary"]),
    tests: noul("Does the PR add or update tests?"),
    yolo: noul("Does the description suggest it was rushed? ('quick fix', 'should be fine', 'lgtm', no testing notes)"),
    friday: noul("Does the PR mention deploying on a Friday or right before a holiday?"),
    scope: choice("What kind of change is this?", {
      typo: "Docs, copy or a one-line fix",
      feature: "New user-facing functionality",
      refactor: "Restructuring code without changing behaviour",
      migration: "Database, infrastructure or dependency changes",
    }),
  },
});

const SCOPE_RISK = { typo: 0.05, feature: 0.4, refactor: 0.5, migration: 0.8 } as const;

const horoscope = step("horoscope", (a: OutputOf<typeof read>) => {
  const risk =
    0.35 * SCOPE_RISK[a.scope.choice] +
    0.2 * (1 - a.clarity.score / 3) +
    0.15 * (1 - a.tests.noul) +
    0.15 * a.yolo.noul +
    0.15 * a.friday.noul;
  const sign = risk < 0.25 ? "♉ Taurus: steady, dependable, merge it." : risk < 0.5 ? "♊ Gemini: two reviewers, minimum." : risk < 0.7 ? "♏ Scorpio: something is hiding in this diff." : "♈ Aries: chaos. Roll back before you roll out.";
  return { risk: Math.round(risk * 100) / 100, scope: a.scope.choice, sign };
}, { title: "Cast the horoscope" });

export const prHoroscope = chain("pr-horoscope", read, horoscope);

export const example: Example = {
  slug: "pr-horoscope",
  title: "Pull Request Horoscope",
  tagline: "Mercury is in retrograde and so is your migration.",
  pattern: "Multi-question ask + composite scoring",
  lesson:
    "Ask everything you need about one input in a single call (it's cheaper and faster than one call per question), then combine typed answers in plain code.",
  chain: prHoroscope,
  file: "pr-horoscope.ts",
  inputs: [
    {
      label: "Friday migration",
      value: {
        title: "quick fix for users table",
        description: "drops the legacy_email column, should be fine. deploying friday evening so it's quiet",
        filesChanged: 1,
      },
    },
    {
      label: "Typo fix",
      value: { title: "Fix typo in README", description: "'recieve' → 'receive'.", filesChanged: 1 },
    },
    {
      label: "Well-behaved feature",
      value: {
        title: "Add CSV export to reports",
        description:
          "Adds an Export button to the reports page. Streams rows so large reports don't time out. Added unit tests for the serializer and an e2e test for the download. Behind the `csv_export` flag.",
        filesChanged: 7,
      },
    },
  ],
};
