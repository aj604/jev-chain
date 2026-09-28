import { gate, outcome, recipe, route } from "@/lib/recipe/build";
import type { CuratedRecipe } from ".";

/** Posts are sorted by what they are carrying, and hot takes get a temperature check. */
export const tweet: CuratedRecipe = {
  slug: "tweet",
  recipe: recipe(
    "The Hot Take Containment Facility",
    "this post",
    route(
      "intake",
      "Post intake",
      "What kind of post is this?",
      {
        "hot-take": 'An opinion presented as brave, often opening with "unpopular opinion" or "hot take".',
        news: "Personal news: a new job, a move, a trip, an engagement, or simply some news.",
        thread: "The first of several parts, announced with a number, an arrow or the word thread.",
        vague: "Implies something happened, or someone did something, without saying what or who.",
      },
      {
        "hot-take": gate(
          "already-popular",
          "Opinion already popular?",
          "Is the opinion in the post one that most people already hold?",
          {
            means: {
              yes: "Widely held. Saying it out loud risks nothing",
              no: "Genuinely divisive. Strangers will disagree in the replies",
            },
            yes: outcome(
              "take-reclassified",
              "Reclassified: room temperature",
              "Reclassified from hot take to room temperature. Returned to sender with a coaster.",
            ),
            no: outcome(
              "take-contained",
              "Take sealed in containment",
              "Take sealed in containment. Blast radius estimated at 400 quote posts. Staff have been issued goggles.",
            ),
          },
        ),
        news: outcome(
          "congrats-mobilised",
          "Congratulations mobilised",
          'Forty-one (41) acquaintances have been mobilised to reply "congrats" without reading past the first line.',
        ),
        thread: outcome(
          "thread-impounded",
          "Thread impounded at part 1",
          "Thread impounded at part 1. Parts 2 through 14 may be collected from the depot with photo ID.",
        ),
        vague: outcome(
          "inquiry-opened",
          "Inquiry opened",
          'Inquiry opened. Three (3) mutuals have asked "u ok?" and one has already guessed wrong.',
        ),
      },
      outcome(
        "kyle-posted-it",
        "Forwarded to Kyle",
        'Unclear. Forwarded to Kyle, who runs a brand account and has already replied "this".',
      ),
    ),
  ),
  samples: [
    { label: "Unpopular opinion", input: "Unpopular opinion: breakfast is the most important meal of the day." },
    {
      label: "A thread",
      input: "Just landed in Lisbon. The light here is different. I am different. A thread. 1/",
    },
    { label: "Noted", input: "Some people really show you who they are. Noted." },
  ],
};
