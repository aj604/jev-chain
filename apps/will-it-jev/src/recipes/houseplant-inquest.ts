import { gate, outcome, recipe, route } from "@/lib/recipe/build";
import type { CuratedRecipe } from ".";

/**
 * Works on any text. A houseplant had the text read to it every morning and
 * did not survive, and the court finds the cause. The shock branch checks
 * for a real emergency first, because the plant can wait.
 */
export const houseplantInquest: CuratedRecipe = {
  slug: "houseplant-inquest",
  recipe: recipe(
    "The Houseplant Coroner's Court",
    "this text",
    route(
      "cause-of-death",
      "Cause of death",
      "A houseplant had this text read aloud to it every morning and has died. Judging by the text, what is the most likely cause of death?",
      {
        overwatering: "Drowned in feeling: gushing, effusive, a great deal of love delivered all at once.",
        frost: "Chilled: curt, cold, dismissive, or polite in a way that lowers the room temperature.",
        boredom: "Filler, jargon and procedure. The plant stopped photosynthesising out of disinterest.",
        shock: "Alarming news, shouting in capitals, or drama the plant was not prepared for.",
        "natural-causes": "Nothing in the text could hurt anyone. The plant was old and had a good life.",
      },
      {
        overwatering: outcome(
          "watering-can-seized",
          "Watering can confiscated",
          "Ruled drowning, in sentiment. The watering can has been confiscated and the text asked to express itself in smaller cups.",
        ),
        frost: outcome(
          "scarf-issued",
          "Scarf knitted for next plant",
          "Ruled hypothermia. A small scarf has been knitted for the next plant, at public expense.",
        ),
        boredom: gate(
          "jargon",
          "Jargon found?",
          'Does the text contain office jargon, such as "circle back", "synergy", "going forward" or "action items"?',
          {
            yes: outcome(
              "jargon-extracted",
              "Jargon extracted from leaf",
              'The coroner found "circle back" lodged in a leaf. It has been extracted and placed in a jar for the jury.',
            ),
            no: outcome(
              "patience-certificate",
              "Certificate awarded posthumously",
              "Ruled death by boredom. A certificate for patience was read aloud at the funeral, which was also boring.",
            ),
          },
        ),
        shock: gate(
          "real-emergency",
          "Anyone in real danger?",
          "Does the text describe a person in real danger: an injury, a threat, or an emergency happening now?",
          {
            means: {
              yes: "Someone may be hurt or at risk right now",
              no: "Dramatic, loud or upsetting, but nobody is in danger",
            },
            yes: outcome(
              "inquest-adjourned",
              "Inquest adjourned",
              "Inquest adjourned. The plant can wait. If someone is in danger, contact your local emergency services now.",
            ),
            no: outcome(
              "succulents-evacuated",
              "Succulents evacuated",
              "Ruled death by shock. The surviving succulents have been evacuated to a quieter room and offered counselling.",
            ),
          },
        ),
        "natural-causes": outcome(
          "composted-with-honours",
          "Composted with honours",
          "Ruled natural causes. The plant lived a full life and has been composted with honours. The text is cleared.",
        ),
      },
      outcome(
        "cactus-detained",
        "Cactus detained",
        "Cause of death undetermined. The cactus has been detained for questioning, as it was the only other one in the room.",
      ),
    ),
  ),
  samples: [
    {
      label: "Love letter",
      input:
        "You are my sun, my moon, my everything. I think about you every second of every day and I will never, ever stop telling you how much I love you. Never.",
    },
    {
      label: "Status update",
      input:
        "Per the last sync, we'll circle back on the deliverables going forward to ensure alignment across all workstreams. Action items to follow.",
    },
    { label: "Fine.", input: "Fine. Do whatever you want. I don't care." },
  ],
};
