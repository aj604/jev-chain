import { gate, rate, recipe, route, scale, verdict, yesNo } from "@/lib/recipe/build";
import type { CuratedRecipe } from ".";

export const weddingSpeech: CuratedRecipe = {
  slug: "wedding-speech",
  recipe: recipe(
    "Will your wedding speech jev?",
    "your wedding speech",
    route(
      "role",
      "Who is giving the speech?",
      {
        best: "The best man or best woman",
        honour: "The maid or man of honour",
        parent: "A parent of one of the couple",
        other: "Someone else, and it is not clear why",
      },
      {
        // A ladder: each gate ends at its verdict or goes on to the next.
        best: gate(
          "ex",
          "Does the speech mention anyone's ex?",
          "no",
          gate(
            "stag",
            "Does it tell a story from the stag or hen weekend?",
            "no",
            gate(
              "long",
              "Would it take more than five minutes to read aloud?",
              "no",
              gate(
                "toast",
                "Does it end with a toast?",
                "yes",
                rate(
                  "best-rating",
                  [
                    scale(
                      "context",
                      "How many of the jokes need context only a few guests have?",
                      2,
                      ["None", "One or two", "Most", "All of them"],
                      "low",
                    ),
                    yesNo("sincere", "Is there at least one sincere moment about the couple?", 3, true),
                  ],
                  {
                    jevs: "It jevs. Do not add anything tonight.",
                    kinda: "It sort of jevs. Cut the second joke.",
                    nope: "It does not jev. Say something kind and sit down.",
                  },
                ),
                verdict("kinda", "It sort of jevs. End with a toast. People need to know when to clap."),
              ),
              verdict("kinda", "It sort of jevs. Nobody has ever wished a speech were longer."),
            ),
            verdict("nope", "It does not jev. The stag weekend is not a speech."),
          ),
          verdict("nope", "It does not jev. Remove the ex."),
        ),
        honour: gate(
          "honour-ex",
          "Does the speech mention anyone's ex?",
          "no",
          gate(
            "honour-tears",
            "Is the speech likely to make the couple cry in a good way?",
            "yes",
            verdict("jevs", "It jevs. Bring tissues. Not for you."),
            rate(
              "honour-rating",
              [
                yesNo("inside-jokes", "Does it rely on inside jokes?", 2, false),
                scale(
                  "warmth",
                  "How warm is it toward both people in the couple?",
                  3,
                  ["Cold", "Polite", "Warm", "Warm to both, equally"],
                  "high",
                ),
              ],
              {
                jevs: "It jevs. Read it slowly.",
                kinda: "It sort of jevs. Mention the other one more.",
                nope: "It does not jev. The couple is two people.",
              },
            ),
          ),
          verdict("nope", "It does not jev. Some of the guests remember the ex."),
        ),
        parent: gate(
          "baby-story",
          "Does the speech include a story from when one of the couple was a baby?",
          "yes",
          gate(
            "parent-long",
            "Would it take more than five minutes to read aloud?",
            "no",
            verdict("jevs", "It jevs. This is what parents are for."),
            verdict("kinda", "It sort of jevs. The baby story can be shorter."),
          ),
          verdict("kinda", "It sort of jevs. Everyone was expecting a baby story."),
        ),
        other: verdict("nope", "It does not jev. Check you are on the list."),
      },
    ),
  ),
  samples: [
    {
      label: "Best man",
      input:
        "For those who don't know me, I'm Tom, the best man. I've known Dan since we were eleven. There was the time in Magaluf, which I promised not to talk about, so I'll just say the police were very understanding. Priya, you are the best thing that has happened to him. To Dan and Priya.",
    },
    {
      label: "Mother of the bride",
      input:
        "When Anna was two, she refused to wear shoes for an entire summer. She has not changed much. She still knows exactly what she wants. Marco, thank you for loving her. Please raise your glasses.",
    },
    {
      label: "Someone else",
      input:
        "Hi everyone. I'm not totally sure why I was asked to speak. I sat next to Chris in a statistics class in 2011.",
    },
  ],
};
