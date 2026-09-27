import { gate, rate, recipe, scale, verdict, yesNo } from "@/lib/recipe/build";
import type { CuratedRecipe } from ".";

export const tweet: CuratedRecipe = {
  slug: "tweet",
  recipe: recipe(
    "Will this tweet jev?",
    "this tweet",
    gate(
      "unpopular",
      'Does the tweet start with "Unpopular opinion" or "Hot take"?',
      "yes",
      gate(
        "popular",
        "Is the opinion in the tweet one that most people already hold?",
        "no",
        rate(
          "take",
          [
            scale(
              "ratio",
              "How likely are the replies to outnumber the likes?",
              3,
              ["Unlikely", "Possible", "Likely", "It is already happening"],
              "low",
            ),
            yesNo("defensible", "Could the author defend this take in person without leaving the room?", 2, true),
          ],
          {
            jevs: "It jevs. Post it and log off.",
            kinda: "It sort of jevs. Expect quote tweets.",
            nope: "It does not jev. Draft it, then delete it.",
          },
        ),
        verdict("nope", "It does not jev. That opinion is popular. You know that."),
      ),
      rate(
        "energy",
        [
          scale(
            "main-character",
            "How much main-character energy does the tweet have?",
            2,
            ["None", "Some", "A lot", "It is a monologue"],
            "low",
          ),
          yesNo("one-point", "Does the tweet make one clear point?", 2, true),
          yesNo("thread", "Does the tweet announce a thread?", 1, false),
        ],
        {
          jevs: "It jevs. Post it.",
          kinda: "It sort of jevs. Nobody asked, but it is fine.",
          nope: "It does not jev. This is a diary entry.",
        },
      ),
    ),
  ),
  samples: [
    { label: "Popular", input: "Unpopular opinion: breakfast is the most important meal of the day." },
    { label: "Hot take", input: "Hot take: most meetings would be better as a shared doc with comments." },
    { label: "Thread", input: "Just landed in Lisbon. The light here is different. I am different. A thread." },
  ],
};
