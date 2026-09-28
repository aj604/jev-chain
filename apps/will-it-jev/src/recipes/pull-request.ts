import { gate, outcome, recipe, route } from "@/lib/recipe/build";
import type { CuratedRecipe } from ".";

/**
 * Changes are routed by kind. Migrations go down a ladder of checkpoints,
 * including one sensible one (a rollback plan) and one that needs a seance.
 */
export const pullRequest: CuratedRecipe = {
  slug: "pull-request",
  recipe: recipe(
    "The Pull Request Customs and Excise Office",
    "your pull request",
    route(
      "change-kind",
      "Kind of change",
      "What kind of change does this pull request make?",
      {
        typo: "Docs, copy, or a one-line fix.",
        feature: "New functionality a user will see or touch.",
        refactor: "Restructuring code without changing behaviour, supposedly.",
        migration: "Database, infrastructure or dependency changes.",
      },
      {
        typo: gate("typo-files", "More than one file?", "Does the fix change more than one file?", {
          yes: outcome(
            "auditor-sent",
            "Auditor sent to count files",
            "A typo fix touching several files has been flagged. An auditor has been sent to count them.",
          ),
          no: outcome(
            "merged-by-acclamation",
            "Merged by acclamation",
            "Merged by acclamation. The misspelled word has been escorted from the building.",
          ),
        }),
        feature: gate("feature-flag", "Behind a flag?", "Is the feature behind a feature flag?", {
          yes: outcome(
            "flag-planted",
            "Flag planted",
            "Shipped behind a flag. The flag will be removed in two weeks, per tradition, in four years.",
          ),
          no: gate("feature-tests", "Tests included?", "Does the pull request add or update tests?", {
            yes: outcome(
              "tuesday-booked",
              "Scheduled for Tuesday",
              "Scheduled for the Tuesday release. Tuesday has been informed and is ready.",
            ),
            no: outcome(
              "test-appointed",
              "Test appointed by the state",
              "No tests found. A test asserting that true equals true has been appointed to your case by the state.",
            ),
          }),
        }),
        refactor: gate(
          "admits-behaviour",
          "Admits a behaviour change?",
          "Does the description admit to any change in behaviour?",
          {
            yes: outcome(
              "reclassified-feature",
              "Reclassified as a feature",
              "Reclassified as a feature. The paperwork has been backdated to Monday.",
            ),
            no: gate("refactor-size", "More than twenty files?", "Does it touch more than twenty files?", {
              yes: outcome(
                "split-by-order",
                "Split by order of the board",
                "Divided into three (3) smaller pull requests by order of the review board. Reviewers have been given the afternoon off.",
              ),
              no: outcome(
                "recorded-invisible",
                "Recorded as invisible",
                "Refactor accepted. Nobody will notice, and this has been recorded as the point.",
              ),
            }),
          },
        ),
        migration: gate(
          "friday",
          "Friday deploy?",
          "Does it mention deploying on a Friday, or just before a holiday?",
          {
            yes: outcome(
              "weekend-cancelled",
              "Weekend cancelled",
              "Deploy blocked. The on-call engineer's weekend has been cancelled anyway, as a precaution.",
            ),
            no: gate("rollback", "Rollback plan?", "Does it describe how to roll the change back?", {
              means: {
                yes: "Gives actual steps for undoing the change",
                no: "Undoing it is left as an exercise for the future",
              },
              yes: gate("drops-column", "Column dropped?", "Does it drop or rename a database column?", {
                yes: outcome(
                  "seance-booked",
                  "Seance booked for column",
                  "A seance has been booked to ask the column whether anything still reads from it.",
                ),
                no: gate(
                  "should-be-fine",
                  '"Should be fine"?',
                  'Does the description say "should be fine", or something similar?',
                  {
                    yes: outcome(
                      "candle-lit",
                      "Candle lit in server room",
                      "A candle has been lit in the server room. It should be fine.",
                    ),
                    no: outcome(
                      "witness-assigned",
                      "Witness assigned",
                      "Cleared to run at 10am on a Tuesday, with one (1) witness and a fire extinguisher.",
                    ),
                  },
                ),
              }),
              no: outcome(
                "deploy-held",
                "Deploy held at the border",
                'Held until a rollback plan is written. A sticky note that says "undo" does not count.',
              ),
            }),
          },
        ),
      },
      outcome(
        "mark-paged",
        "Paged: Mark (left in 2016)",
        "Change unclear. Mark, who wrote this module in 2014, has been paged. Mark left in 2016. His comments remain.",
      ),
    ),
  ),
  samples: [
    { label: "Typo", input: "Fix typo in README: 'recieve' to 'receive'." },
    {
      label: "Friday migration",
      input: "Drop legacy_email column from users. Should be fine. Deploying Friday evening so it's quiet.",
    },
    {
      label: "Flagged feature",
      input:
        "Add CSV export to reports. Streams rows so large reports don't time out. Unit tests for the serializer, an e2e test for the download. Behind the csv_export flag.",
    },
  ],
};
