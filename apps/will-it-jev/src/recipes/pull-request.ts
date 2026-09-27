import { gate, rate, recipe, route, scale, verdict, yesNo } from "@/lib/recipe/build";
import type { CuratedRecipe } from ".";

export const pullRequest: CuratedRecipe = {
  slug: "pull-request",
  recipe: recipe(
    "Will your PR jev?",
    "your pull request",
    route(
      "kind",
      "What kind of change is this?",
      {
        typo: "Docs, copy, or a one-line fix",
        feature: "New user-facing functionality",
        refactor: "Restructuring code without changing behaviour",
        migration: "Database, infrastructure, or dependency changes",
      },
      {
        typo: gate(
          "typo-scope",
          "Does the fix change more than one file?",
          "no",
          verdict("jevs", "It jevs. Merge it."),
          verdict("kinda", "It sort of jevs. That is not a typo fix."),
        ),
        feature: gate(
          "feature-tests",
          "Does the PR add or update tests?",
          "yes",
          gate(
            "feature-flag",
            "Is the feature behind a flag?",
            "yes",
            verdict("jevs", "It jevs. Ship it on a Tuesday."),
            rate(
              "feature-rating",
              [
                scale(
                  "description",
                  "How clearly does the description explain what changed and why?",
                  2,
                  ["No description", "Vague", "Clear", "Clear, with screenshots"],
                  "high",
                ),
                yesNo("rushed", "Does the description suggest it was rushed?", 2, false),
              ],
              {
                jevs: "It jevs. Ship it.",
                kinda: "It sort of jevs. Add a flag.",
                nope: "It does not jev. Add a flag and a description.",
              },
            ),
          ),
          verdict("nope", "It does not jev. Write one test. Any test."),
        ),
        refactor: gate(
          "behaviour-change",
          "Does the description admit to any change in behaviour?",
          "no",
          gate(
            "refactor-size",
            "Does it touch more than twenty files?",
            "no",
            verdict("jevs", "It jevs. Nobody will notice, which is the point."),
            verdict("kinda", "It sort of jevs. Split it into three."),
          ),
          verdict("nope", "It does not jev. That is a feature."),
        ),
        // A ladder: each gate ends at its verdict or goes on to the next.
        migration: gate(
          "friday",
          "Does it mention deploying on a Friday or before a holiday?",
          "no",
          gate(
            "rollback",
            "Does it describe how to roll back?",
            "yes",
            gate(
              "column-in-use",
              "Does it drop or rename a column that is still in use?",
              "no",
              gate(
                "auth",
                "Does it touch authentication or permissions?",
                "no",
                gate(
                  "should-be-fine",
                  'Does the description say "should be fine" or something similar?',
                  "no",
                  verdict("jevs", "It jevs. Run it with someone watching."),
                  verdict("kinda", "It sort of jevs. It should be fine."),
                ),
                verdict("kinda", "It sort of jevs. Get a second reviewer from security."),
              ),
              verdict("nope", "It does not jev. Something still reads that column."),
            ),
            verdict("nope", "It does not jev. Write the rollback first."),
          ),
          verdict("nope", "It does not jev. It is Friday."),
        ),
      },
    ),
  ),
  samples: [
    { label: "Typo", input: "Fix typo in README: 'recieve' to 'receive'." },
    {
      label: "Friday migration",
      input: "Drop legacy_email column from users. Should be fine. Deploying Friday evening so it's quiet.",
    },
    {
      label: "Good feature",
      input:
        "Add CSV export to reports. Streams rows so large reports don't time out. Unit tests for the serializer, an e2e test for the download. Behind the csv_export flag.",
    },
  ],
};
