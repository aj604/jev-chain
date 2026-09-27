import { gate, rate, recipe, scale, verdict, yesNo } from "@/lib/recipe/build";
import type { CuratedRecipe } from ".";

export const slack: CuratedRecipe = {
  slug: "slack-message",
  recipe: recipe(
    "Will your Slack message jev?",
    "your Slack message",
    gate(
      "no-rush",
      'Does the message end with "no rush" or something like it?',
      "no",
      gate(
        "just-hey",
        "Is the message only a greeting, with the actual question still to come?",
        "no",
        rate(
          "slack-rating",
          [
            scale(
              "passive",
              "How passive-aggressive is the message?",
              3,
              ["Not at all", "Slightly", "Noticeably", "It is a formal complaint"],
              "low",
            ),
            yesNo("clear-ask", "Does the message contain a clear request?", 2, true),
            yesNo("thread", "Would this be better as a reply in an existing thread?", 1, false),
          ],
          {
            jevs: "It jevs. Send it.",
            kinda: 'It sort of jevs. Remove "per my last message".',
            nope: "It does not jev. Write it again tomorrow.",
          },
        ),
        verdict("nope", "It does not jev. Just ask the question."),
      ),
      verdict("nope", "It does not jev. There is a rush. Everyone can tell."),
    ),
  ),
  samples: [
    { label: "No rush", input: "Hey, any update on the Q3 numbers? No rush!" },
    { label: "Hey", input: "hey" },
    { label: "Clear", input: "Could you review the pricing doc by Thursday? I need it for the board prep." },
  ],
};
