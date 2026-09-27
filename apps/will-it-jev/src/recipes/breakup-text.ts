import { gate, rate, recipe, scale, verdict, yesNo } from "@/lib/recipe/build";
import type { CuratedRecipe } from ".";

export const breakup: CuratedRecipe = {
  slug: "breakup-text",
  recipe: recipe(
    "Will your breakup text jev?",
    "your breakup text",
    gate(
      "lawyer",
      "Does the text mention a lawyer, a court, or legal action?",
      "no",
      gate(
        "still-friends",
        'Does the text say some version of "we can still be friends"?',
        "no",
        rate(
          "breakup-rating",
          [
            scale(
              "clarity",
              "How clearly does the text say the relationship is over?",
              3,
              ["It does not say that", "It implies it", "It says it", "It says it once, clearly"],
              "high",
            ),
            scale(
              "blame",
              "How much of the text assigns blame to the other person?",
              2,
              ["None", "A little", "Most of it", "All of it, with examples"],
              "low",
            ),
            yesNo("long", "Is the text longer than a few sentences?", 1, false),
          ],
          {
            jevs: "It jevs. Send it and put the phone in another room.",
            kinda: "It sort of jevs. Remove the second paragraph.",
            nope: "It does not jev. This is a first draft of a much worse text.",
          },
        ),
        verdict("kinda", "It sort of jevs. You will not still be friends."),
      ),
      verdict("nope", "It does not jev. This is a letter from counsel."),
    ),
  ),
  samples: [
    {
      label: "Clean",
      input:
        "Hey. I've thought about this a lot and I don't want to keep seeing each other. I'm sorry. I wish you well.",
    },
    {
      label: "Still friends",
      input:
        "I think we should break up but honestly I really hope we can still be friends, you mean so much to me and I don't want to lose you completely.",
    },
    { label: "Lawyer", input: "We're done. My lawyer will be in touch about the couch." },
  ],
};
