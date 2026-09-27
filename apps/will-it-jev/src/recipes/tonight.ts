import { gate, recipe, verdict } from "@/lib/recipe/build";
import type { CuratedRecipe } from ".";

/**
 * A ladder of ten gates, all passing on "no". Each asks whether something is
 * wrong: "no" goes on to the next gate and "yes" ends at its verdict.
 *
 * The studio's tonight example is checked against this recipe character for
 * character, so change the two together.
 */
export const tonight: CuratedRecipe = {
  slug: "tonight",
  recipe: recipe(
    "Will your plan for tonight jev?",
    "your plan for tonight",
    gate(
      "one-drink",
      'Does the plan include the phrase "just one drink"?',
      "no",
      gate(
        "venues",
        "Does the plan involve more than two venues?",
        "no",
        gate(
          "getting-home",
          "Is it unclear how everyone gets home?",
          "no",
          gate(
            "early-start",
            "Does anyone involved have to be at work early tomorrow?",
            "no",
            gate(
              "thumbs-up",
              "Is a thumbs-up reaction the only sign that people agreed to the plan?",
              "no",
              gate(
                "no-booking",
                "Does the plan depend on getting a table somewhere without a booking?",
                "no",
                gate(
                  "ex",
                  "Is there a chance of running into someone's ex?",
                  "no",
                  gate(
                    "karaoke",
                    "Does the plan end at karaoke?",
                    "no",
                    gate(
                      "budget",
                      "Has nobody said the budget out loud?",
                      "no",
                      gate(
                        "dinner",
                        "Does the plan skip eating a proper meal?",
                        "no",
                        verdict("jevs", "It jevs. This is a plan, not a night out."),
                        verdict("nope", "It does not jev. Eat something."),
                      ),
                      verdict("kinda", "It sort of jevs. Check your account on Sunday, not Saturday."),
                    ),
                    verdict("jevs", "It jevs. Karaoke is where plans go to be complete."),
                  ),
                  verdict("kinda", "It sort of jevs. Have an exit line ready."),
                ),
                verdict("kinda", "It sort of jevs. You will eat at the place next door."),
              ),
              verdict("nope", "It does not jev. A thumbs-up is not agreement."),
            ),
            verdict("kinda", "It sort of jevs. Someone will leave at nine and be right."),
          ),
          verdict("nope", "It does not jev. Decide who is driving now."),
        ),
        verdict("kinda", "It sort of jevs. You will lose someone between the second and third venue."),
      ),
      verdict("nope", "It does not jev. It is never one drink."),
    ),
  ),
  samples: [
    { label: "Just one drink", input: "Just one drink at the Crown after work, then we'll see." },
    {
      label: "Booked",
      input:
        "Dinner at 7 at Luca, booked for six. Then the 9:15 film. Sam is driving everyone home. Everyone in the chat said yes. Forty each, max.",
    },
    {
      label: "Crawl",
      input:
        "Four bars on Dean Street, then karaoke. We'll figure out getting home later. Kev and Jo gave it a thumbs up.",
    },
  ],
};
