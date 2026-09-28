import { gate, outcome, recipe, route } from "@/lib/recipe/build";
import type { CuratedRecipe } from ".";

/**
 * Speeches are routed by who is giving them. The best man's desk is the
 * deepest, because it has to be.
 */
export const weddingSpeech: CuratedRecipe = {
  slug: "wedding-speech",
  recipe: recipe(
    "The Wedding Speech Clearance Board",
    "your wedding speech",
    route(
      "speaker",
      "Who is speaking?",
      "Who is giving this wedding speech?",
      {
        "best-man": "The best man or best woman, who has known one of the couple for a worrying length of time.",
        honour: "The maid or man of honour.",
        parent: "A parent of one of the couple.",
        stranger: "Someone else, and it is not clear why they were asked.",
      },
      {
        "best-man": gate("mentions-ex", "Ex mentioned?", "Does the speech mention anyone's ex?", {
          yes: outcome(
            "mic-confiscated",
            "Microphone confiscated",
            "The microphone has been confiscated. A string quartet will play over the remainder of the speech.",
          ),
          no: gate("stag-story", "Stag story?", "Does it tell a story from the stag or hen weekend?", {
            yes: gate(
              "police-involved",
              "Police involved?",
              "Does the story involve the police, a hospital, or a country someone has been asked not to return to?",
              {
                yes: outcome(
                  "redacted-by-solicitor",
                  "Redacted by solicitor",
                  "Redacted by the couple's solicitor. The weekend now reads, in full: a lovely time was had.",
                ),
                no: outcome(
                  "story-sealed",
                  "Sealed for thirty years",
                  "The stag story has been sealed for thirty (30) years, as agreed by all parties present.",
                ),
              },
            ),
            no: gate("ends-toast", "Ends with a toast?", "Does the speech end with a toast?", {
              yes: outcome(
                "glasses-charged",
                "Glasses pre-charged",
                "Cleared for delivery. Glasses will be pre-charged and the DJ is standing by.",
              ),
              no: outcome(
                "clap-cue",
                "Clap cue installed",
                'No toast found. An usher will raise a sign reading "clap now" at the end.',
              ),
            }),
          }),
        }),
        honour: gate(
          "both-mentioned",
          "Both of the couple?",
          "Does the speech talk about both people in the couple, not just one of them?",
          {
            yes: outcome(
              "tissues-distributed",
              "Tissues distributed",
              "Tissue rations have been distributed to the first four rows. The groom has been given a second packet.",
            ),
            no: outcome(
              "spouse-search",
              "Search launched for spouse",
              "A search has been launched for the other spouse, who has not been mentioned since the first line.",
            ),
          },
        ),
        parent: gate(
          "baby-story",
          "Baby story?",
          "Does the speech include a story from when one of the couple was a baby or a small child?",
          {
            yes: outcome(
              "baby-photos",
              "Baby photos cleared",
              "Baby photos have been cleared for projection onto the marquee wall. Nobody may leave.",
            ),
            no: outcome(
              "aunt-requisitioned",
              "Aunt requisitioned",
              "A baby story has been requisitioned from an aunt and will be read out after the cake.",
            ),
          },
        ),
        stranger: gate(
          "says-how",
          "Says how they know them?",
          "Does the speaker say how they know the couple?",
          {
            yes: outcome(
              "table-fourteen",
              "Located at table 14",
              "Speaker located on the seating plan at table 14, by the kitchen doors. Speech permitted.",
            ),
            no: outcome(
              "security-alerted",
              "Security alerted",
              "Security has been alerted, and has also been asked to say a few words.",
            ),
          },
        ),
      },
      outcome(
        "handed-to-dj",
        "Handed to the DJ",
        "Speaker unclear. Referred to the DJ, who will play Come On Eileen until this is resolved.",
      ),
    ),
  ),
  samples: [
    {
      label: "Best man",
      input:
        "For those who don't know me, I'm Tom, the best man. I've known Dan since we were eleven. There was the stag in Magaluf, which I promised not to talk about, so I'll just say the police were very understanding. Priya, you are the best thing that has happened to him. To Dan and Priya.",
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
