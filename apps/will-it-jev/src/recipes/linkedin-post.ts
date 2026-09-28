import { gate, outcome, recipe, route } from "@/lib/recipe/build";
import type { CuratedRecipe } from ".";

/** Every post is asked what it is declaring, and some of it is taxed. */
export const linkedin: CuratedRecipe = {
  slug: "linkedin-post",
  recipe: recipe(
    "The LinkedIn Customs and Excise Office",
    "your LinkedIn post",
    route(
      "declaration",
      "What is being declared?",
      "What is this LinkedIn post really declaring?",
      {
        humblebrag: 'An achievement wrapped in gratitude: "humbled", "honoured", "thrilled to announce".',
        "life-lesson": "An everyday event turned into a business lesson: a toddler, a barista, a flat tyre.",
        broetry: "One sentence per line, building slowly toward an insight everyone already had.",
        hiring: "A job opening, a new role, or being open to work.",
      },
      {
        humblebrag: gate("humbled", '"Humbled"?', 'Does the post use the word "humbled" or "honoured"?', {
          yes: outcome(
            "humility-tariff",
            "Humility tariff levied",
            'A 20% humility tariff has been levied on the word "humbled". It may be paid in likes.',
          ),
          no: outcome(
            "waved-through",
            "Waved through",
            'Achievement declared and waved through. Three (3) former colleagues have been sent to say "congrats".',
          ),
        }),
        "life-lesson": gate(
          "someone-else-taught",
          "Taught by a bystander?",
          "Was the lesson taught by someone who did not ask to be in a LinkedIn post, such as a child, a waiter or a stranger?",
          {
            means: {
              yes: "A child, a pet, a waiter or a stranger is credited as the teacher",
              no: "The author learned it alone, from an event, an object or a flat tyre",
            },
            yes: outcome(
              "quote-quarantined",
              "Quote held in quarantine",
              "The quote has been held in quarantine for 14 days while customs confirms the toddler said that.",
            ),
            no: outcome(
              "anecdote-appraised",
              "Anecdote appraised",
              "Anecdote appraised. Declared value: a masterclass. Assessed value: a Tuesday.",
            ),
          },
        ),
        broetry: outcome(
          "line-breaks-seized",
          "Line breaks seized",
          "Customs has seized forty-one (41) line breaks. They will be returned to the poem they were taken from.",
        ),
        hiring: outcome(
          "role-inspected",
          "Role inspected, pre-filled",
          "Declared: one (1) open role. On inspection, it contains 400 applicants and one internal candidate already chosen.",
        ),
      },
      outcome(
        "sharon-inspects",
        "Held for Sharon",
        "Contents unclear. Held for inspection by Sharon, who has endorsed you for Excel and will not say why.",
      ),
    ),
  ),
  samples: [
    {
      label: "Humbled",
      input:
        "I'm humbled and honoured to announce that I've been named one of the Top 50 Voices in Procurement. Grateful for this journey.",
    },
    {
      label: "Toddler",
      input:
        "My 3-year-old refused to put on her shoes this morning.\n\nAnd it taught me everything about stakeholder management.\n\nHere's what I learned.",
    },
    {
      label: "Never give up",
      input: "I got rejected 47 times.\nI kept going.\nI kept showing up.\nToday I got a yes.\nNever give up.\nAgree?",
    },
  ],
};
