import { gate, outcome, rate, recipe, route, scale, yesNo } from "@/lib/recipe/build";
import type { CuratedRecipe } from ".";

/**
 * Excuses are sorted by what they blame. Grandmothers get their own desk,
 * transport alibis are scored, and wild animals are handled with care.
 */
export const excuse: CuratedRecipe = {
  slug: "excuse",
  recipe: recipe(
    "The Lateness Excuse Verification Bureau",
    "your excuse for being late",
    route(
      "blame",
      "What is being blamed?",
      "What does this excuse for being late blame?",
      {
        grandmother: "A grandmother, living or otherwise, and whatever she needed at that exact moment.",
        transport: "A train, a bus, traffic, a flat tyre, a closed road or a missed stop.",
        animal: "An animal that did something at the worst possible time.",
        cosmic: "Mercury, the universe, fate, bad energy, or a sign that could not be ignored.",
      },
      {
        grandmother: route(
          "grandmother-status",
          "Grandmother status",
          "What is the grandmother's current status, according to the excuse?",
          {
            living: "Alive, well, and doing something specific that required help.",
            late: "Has died, recently or otherwise.",
            unconfirmed: "It is not clear that this grandmother exists.",
          },
          {
            living: outcome(
              "card-to-grandmother",
              "Card sent to grandmother",
              "A thank-you card has been sent to the grandmother for her service. Excuse accepted in full.",
            ),
            late: gate(
              "used-before",
              "Grandmother reused?",
              "Does the excuse suggest this grandmother has been used as an excuse before?",
              {
                means: {
                  yes: "Implies an earlier death, funeral or emergency for the same grandmother",
                  no: "A first and only mention of her passing",
                },
                yes: outcome(
                  "resurrection-logged",
                  "Resurrection logged",
                  "Resurrection logged. This is her third funeral this year. Records has sent flowers and a query.",
                ),
                no: outcome(
                  "condolences-issued",
                  "Condolences issued",
                  "Condolences issued. Your afternoon has been cleared and nobody will ask a follow-up question.",
                ),
              },
            ),
            unconfirmed: outcome(
              "certificate-requested",
              "Birth certificate requested",
              "A birth certificate has been requested for one (1) grandmother. Please allow six to eight weeks.",
            ),
          },
        ),
        transport: rate(
          "transit-alibi",
          "Transit alibi check",
          [
            scale(
              "alibi-detail",
              "How specific is the excuse about what went wrong?",
              2,
              ["Vague", "Names the mode of transport", "Names a line, road or station", "Gives times and minutes"],
              "high",
            ),
            yesNo("alibi-checkable", "Could someone check the excuse against a timetable or a traffic report?", 2, true),
            yesNo("alibi-sorry", "Does the excuse include an apology?", 1, true),
          ],
          [
            [
              0.7,
              outcome(
                "timetable-checked",
                "Timetable cross-checked",
                "Verified against the timetable. The 8:14 was indeed cursed. No further action.",
              ),
            ],
            [
              0.4,
              outcome(
                "traffic-subpoenaed",
                "Traffic subpoenaed",
                "Traffic has been subpoenaed. It denies everything but has no alibi for 8:40 to 9:15.",
              ),
            ],
            [
              0,
              outcome(
                "bus-summoned",
                "Bus summoned to testify",
                "The bus has been summoned to testify. It is running late.",
              ),
            ],
          ],
        ),
        animal: gate(
          "wild-animal",
          "Wild animal?",
          "Is the animal a wild one, such as a goose, a fox or a deer, rather than a pet?",
          {
            means: {
              yes: "A wild animal with no owner and no accountability",
              no: "A pet, who lives with someone and should have known better",
            },
            yes: outcome(
              "goose-watchlisted",
              "Added to the watchlist",
              "The animal has been added to the watchlist. Officers are advised not to approach it, especially if it is a goose.",
            ),
            no: outcome(
              "pet-cautioned",
              "Pet formally cautioned",
              "The pet has been formally cautioned. A note has been placed on its file, next to the sock incident.",
            ),
          },
        ),
        cosmic: outcome(
          "astrologer-consulted",
          "Astrologer consulted",
          "Forwarded to the office astrologer, who confirms Mercury was involved and is also running late.",
        ),
      },
      outcome(
        "brenda-summoned",
        "Summoned: Brenda",
        "Cause of lateness unclear. Brenda in Timekeeping has been summoned. Brenda has been late since 2009 and is sympathetic.",
      ),
    ),
  ),
  samples: [
    { label: "Groceries", input: "Sorry, my grandma needed help getting her groceries up the stairs." },
    {
      label: "Again",
      input: "So sorry, my grandmother passed away. Again. I mean, I have to go to the funeral. Another one.",
    },
    {
      label: "The goose",
      input: "A goose stood in the middle of the bike path and would not let anyone past. I waited twelve minutes.",
    },
  ],
};
