import { gate, rate, recipe, scale, verdict, yesNo } from "@/lib/recipe/build";
import type { CuratedRecipe } from ".";

/** A ladder of eight gates. Each ends at its verdict or goes on to the next. */
export const startup: CuratedRecipe = {
  slug: "startup",
  recipe: recipe(
    "Will your startup idea jev?",
    "your startup idea",
    gate(
      "uber-for",
      'Is the idea described as "Uber for" something?',
      "no",
      gate(
        "who-pays",
        "Is it clear who pays for this?",
        "yes",
        gate(
          "why-now",
          "Is there a reason this could work now and could not have worked five years ago?",
          "yes",
          gate(
            "blockchain",
            "Does the idea require a blockchain?",
            "no",
            gate(
              "regulated",
              "Does it operate in a heavily regulated industry, such as health, finance, or aviation?",
              "no",
              gate(
                "two-sided",
                "Does it need two groups of users to show up at the same time before it works?",
                "no",
                gate(
                  "moat",
                  "Is there anything stopping a large company from copying it within a quarter?",
                  "yes",
                  gate(
                    "done-before",
                    "Does the founder describe having done something like this before?",
                    "yes",
                    verdict("jevs", "It jevs. Raise a small amount of money and tell no one."),
                    rate(
                      "first-timer",
                      [
                        scale(
                          "focus",
                          "How narrow is the first version?",
                          2,
                          ["Everything for everyone", "A few things", "One thing for one group"],
                          "high",
                        ),
                        yesNo("customers", "Does the pitch mention talking to real customers?", 3, true),
                      ],
                      {
                        jevs: "It jevs. You will learn the rest.",
                        kinda: "It sort of jevs. Talk to ten customers first.",
                        nope: "It does not jev. Keep your job for now.",
                      },
                    ),
                  ),
                  verdict("kinda", "It sort of jevs. Until someone larger notices."),
                ),
                verdict("kinda", "It sort of jevs. You now have two startups to build."),
              ),
              verdict("kinda", "It sort of jevs. Budget for lawyers."),
            ),
            verdict("nope", "It does not jev. It is a database with extra steps."),
          ),
          verdict("nope", "It does not jev. It did not work five years ago either."),
        ),
        verdict("nope", "It does not jev. Someone has to pay."),
      ),
      verdict("nope", "It does not jev. Uber is already Uber for things."),
    ),
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
        "Scheduling software for independent veterinary clinics. I ran operations at a vet group for six years. Clinics pay monthly per location. Cheap cloud hosting and clinics finally moving off paper make it possible now. I've interviewed 40 clinic managers.",
    },
  ],
};
