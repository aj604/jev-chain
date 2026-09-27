import { gate, rate, recipe, route, scale, verdict, yesNo } from "@/lib/recipe/build";
import type { CuratedRecipe } from ".";

export const excuse: CuratedRecipe = {
  slug: "excuse",
  recipe: recipe(
    "Will your excuse jev?",
    "your excuse for being late",
    gate(
      "grandmother",
      "Does the excuse involve a grandmother?",
      "yes",
      route(
        "which-grandmother",
        "Which grandmother is it?",
        {
          alive: "A living grandmother, doing something specific",
          late: "A grandmother who has died, recently or otherwise",
          unclear: "It is not clear whether this grandmother exists",
        },
        {
          alive: verdict("jevs", "It jevs. Nobody questions a living grandmother."),
          late: gate(
            "used-before",
            "Does the excuse suggest this grandmother has been used as an excuse before?",
            "no",
            verdict("kinda", "It sort of jevs. Do not use her again."),
            verdict("nope", "It does not jev. She has died several times this year."),
          ),
          unclear: verdict("nope", "It does not jev. The grandmother is doing a lot of work here."),
        },
      ),
      rate(
        "excuse-rating",
        [
          scale("specific", "How specific is the excuse?", 2, ["Vague", "Some detail", "Specific and plausible"], "high"),
          yesNo("overexplained", "Does the excuse go on longer than the lateness deserves?", 2, false),
          yesNo("apology", "Does it include an apology?", 1, true),
        ],
        {
          jevs: "It jevs. Sit down quietly.",
          kinda: "It sort of jevs. Do not elaborate.",
          nope: "It does not jev. Just say you were late.",
        },
      ),
    ),
  ),
  samples: [
    { label: "Groceries", input: "Sorry, my grandma needed help getting her groceries up the stairs." },
    {
      label: "Again",
      input: "So sorry, my grandmother passed away. Again. I mean, I have to go to the funeral. Another one.",
    },
    { label: "Train", input: "The train stopped between stations for twenty minutes. Sorry." },
  ],
};
