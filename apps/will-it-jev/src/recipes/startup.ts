import { gate, outcome, recipe } from "@/lib/recipe/build";
import type { CuratedRecipe } from ".";

/**
 * A ladder of nine checkpoints. "No" at a checkpoint means it found nothing
 * to process, and the idea goes on to the next one. The few ideas that clear
 * all nine are the only ones anybody has to deal with in person.
 */
export const startup: CuratedRecipe = {
  slug: "startup",
  recipe: recipe(
    "The Venture Intake and Quarantine Office",
    "your startup idea",
    gate("uber-for", '"Uber for" invoked?', 'Is the idea described as "Uber for" something?', {
      yes: outcome(
        "forwarded-to-uber",
        "Forwarded to Uber",
        "Forwarded to Uber for comment. Uber says it is already Uber for most things and wishes you well.",
      ),
      no: gate("blockchain", "Blockchain required?", "Does the idea require a blockchain?", {
        yes: outcome(
          "appraised-database",
          "Appraised as a database",
          "Appraised as a database with extra steps. The steps have been recorded permanently, as requested.",
        ),
        no: gate("who-pays", "Payer identified?", "Does the idea say who pays for it?", {
          means: {
            yes: "Names who hands over money, and roughly for what",
            no: "Money is expected to arrive from somewhere, eventually",
          },
          yes: gate("with-ai", '"But with AI"?', "Is the idea an existing product, but with AI added?", {
            yes: outcome(
              "ai-sticker",
              "AI sticker applied",
              "An AI sticker has been applied to the product. Valuation adjusted upward by one (1) sticker.",
            ),
            no: gate(
              "regulated",
              "Heavily regulated?",
              "Does it operate in a heavily regulated industry, such as human healthcare, banking or aviation?",
              {
                yes: outcome(
                  "lawyers-retained",
                  "Seven lawyers retained",
                  "Seven (7) lawyers have been retained. They have billed you for reading this sentence.",
                ),
                no: gate(
                  "two-sided",
                  "Needs two crowds at once?",
                  "Does it need two different groups of users to show up at the same time before it works?",
                  {
                    yes: outcome(
                      "chicken-and-egg",
                      "Chicken and egg ordered",
                      "One (1) chicken and one (1) egg have been ordered. Delivery order to be determined.",
                    ),
                    no: gate(
                      "moat",
                      "Reason it cannot be copied?",
                      "Does the pitch give a reason a large company could not simply copy it?",
                      {
                        yes: gate(
                          "done-before",
                          "Done this before?",
                          "Does the founder describe having worked in this industry or built something like this before?",
                          {
                            yes: outcome(
                              "term-sheet-printed",
                              "Term sheet printed",
                              "A term sheet has been printed in 11pt Garamond. Please raise a small amount and tell no one.",
                            ),
                            no: gate(
                              "customers",
                              "Spoken to customers?",
                              "Does the pitch mention talking to real customers?",
                              {
                                yes: outcome(
                                  "garage-leased",
                                  "Garage leased",
                                  "A garage has been leased in your name. The founding myth begins Monday at 9am.",
                                ),
                                no: outcome(
                                  "customers-summoned",
                                  "Ten customers summoned",
                                  "Ten (10) customers have been summoned for interview. Attendance is voluntary but strongly implied.",
                                ),
                              },
                            ),
                          },
                        ),
                        no: outcome(
                          "google-notified",
                          "Google notified",
                          "Google has been notified as a courtesy. They have pencilled it in for next quarter.",
                        ),
                      },
                    ),
                  },
                ),
              },
            ),
          }),
          no: outcome(
            "invoice-issued",
            "Invoice issued to the market",
            'An invoice has been issued to "the market". The market has not replied.',
          ),
          unsure: outcome(
            "chad-knows-angels",
            "Referred to Chad",
            "Revenue model unclear. Referred to Chad, who says he knows some angel investors. He does not.",
          ),
        }),
      }),
    }),
  ),
  samples: [
    { label: "Uber for dogs", input: "Uber for dog walking. You tap a button and a dog walker shows up." },
    {
      label: "Tokenized",
      input:
        "A tokenized marketplace connecting freelance tax preparers with gig workers, on a blockchain so the records are permanent.",
    },
    {
      label: "Vet software",
      input:
        "Scheduling software for independent veterinary clinics. I ran operations at a vet group for six years. Clinics pay monthly per location. The big players ignore independents because each one is too small to sell to, and we already have the integrations they would need a year to build.",
    },
  ],
};
