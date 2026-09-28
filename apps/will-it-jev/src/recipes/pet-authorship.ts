import { gate, outcome, recipe, route } from "@/lib/recipe/build";
import type { CuratedRecipe } from ".";

/**
 * Works on any text at all. Jev weighs four household animals as suspects,
 * and the percentages are the joke. When no animal clearly did it, the
 * hamster is brought in.
 */
export const petAuthorship: CuratedRecipe = {
  slug: "pet-authorship",
  recipe: recipe(
    "The Bureau of Animal Authorship",
    "this text",
    route(
      "suspect",
      "Which animal wrote it?",
      "Judging only by its tone and style, which household animal most likely wrote this text?",
      {
        dog: "Unconditionally enthusiastic. Everything is the best thing. Wants to know if you are coming back.",
        cat: "Aloof and entitled. Expects service. Has knocked something off a table to make a point.",
        goldfish: "Starts over every few seconds. Repeats itself. Surprised by its own previous sentence.",
        parrot: "Repeats phrases it has heard other people say, with total confidence and no understanding.",
      },
      {
        dog: gate("mentions-food", "Food mentioned?", "Does the text mention food, eating or treats?", {
          yes: outcome(
            "treat-authorised",
            "Treat authorised",
            "Authorship assigned to the dog. One (1) treat has been authorised and is already gone.",
          ),
          no: outcome(
            "walk-scheduled",
            "Walk scheduled for now",
            "Authorship assigned to the dog. A walk has been scheduled, and the dog has been told, so it is happening now.",
          ),
        }),
        cat: gate(
          "makes-demands",
          "Demands made?",
          "Does the text ask for something, or imply that something is owed to the writer?",
          {
            means: {
              yes: "Makes a request, sets a condition, or expects service",
              no: "Wants nothing from anyone, and would like that noted",
            },
            yes: outcome(
              "demands-forwarded",
              "Demands forwarded to staff",
              "Authorship assigned to the cat. Its demands have been forwarded to staff. You are staff.",
            ),
            no: outcome(
              "glassware-relocated",
              "Glassware relocated",
              "Authorship assigned to the cat. All glasses have been moved away from the edge of the table as a precaution.",
            ),
          },
        ),
        goldfish: outcome(
          "copy-to-goldfish",
          "Copy mailed to the goldfish",
          "Authorship assigned to the goldfish. A copy has been mailed to the bowl. It will be very surprised to read it.",
        ),
        parrot: outcome(
          "speaker-traced",
          "Original speaker traced",
          "Authorship assigned to the parrot. The person it learned this from is being traced. Suspect: middle management.",
        ),
      },
      outcome(
        "hamster-questioned",
        "Hamster brought in",
        "Paws on the keyboard, species unclear. The hamster has been brought in for questioning and is running on its wheel.",
      ),
    ),
  ),
  samples: [
    {
      label: "Are you leaving",
      input:
        "Hi. Hi. Are we going to the park. Is that the park. I love the park. I love you. Are you leaving. Why are you leaving. You're back. Best day ever.",
    },
    {
      label: "Breakfast terms",
      input:
        "Breakfast will be served at 5am. Not 5:15. The previous arrangement was unacceptable, and I have left a response on the stairs.",
    },
    {
      label: "Circle back",
      input:
        "Let's circle back and leverage our core synergies going forward. Going forward, let's make sure we circle back on the synergies.",
    },
  ],
};
