import { gate, outcome, recipe } from "@/lib/recipe/build";
import type { CuratedRecipe } from ".";

/**
 * A ladder of ten gates. Each asks whether the plan has a known hazard:
 * "no" goes on to the next gate and "yes" ends at that hazard's paperwork.
 * One gate, the ex, has an unsure path, because nobody can rule out an ex.
 *
 * The studio's tonight example asks the same ten questions in the same
 * order, and tonight.drift.test.ts checks that it still does. Its leaves are
 * the studio's own, so only the ladder has to change in both places.
 */
export const tonight: CuratedRecipe = {
  slug: "tonight",
  recipe: recipe(
    "The Night Out Permit Office",
    "your plan for tonight",
    gate("one-drink", '"Just one drink"?', 'Does the plan include the phrase "just one drink"?', {
      yes: outcome(
        "filed-four-drinks",
        "Refiled as four drinks",
        "Refiled under four drinks. A glass of water has been scheduled for 11:40pm.",
      ),
      no: gate("venues", "More than two venues?", "Does the plan involve more than two venues?", {
        yes: outcome(
          "search-party",
          "Search party pre-booked",
          "A search party has been pre-booked for the gap between the second and third venue.",
        ),
        no: gate("getting-home", "Way home unclear?", "Is it unclear how everyone gets home?", {
          means: {
            yes: "No driver, taxi, train or bed is mentioned for the end of the night",
            no: "Someone is driving, a taxi is booked, or everyone lives upstairs",
          },
          yes: outcome(
            "transport-hold",
            "Transport hold placed",
            "Transport hold placed. Nobody leaves until one (1) sober driver or a booked taxi is on file.",
          ),
          no: gate(
            "early-start",
            "Early start tomorrow?",
            "Does anyone involved have to be at work early tomorrow?",
            {
              yes: outcome(
                "early-exit",
                "Early exit pre-approved",
                "One (1) person will leave at 9pm, citing the morning. They will be right, and it has been noted.",
              ),
              no: gate(
                "thumbs-up",
                "Agreed by thumbs-up only?",
                "Is a thumbs-up reaction the only sign that people agreed to the plan?",
                {
                  yes: outcome(
                    "thumbs-rejected",
                    "Thumbs-up rejected",
                    "A thumbs-up reaction has been rejected as proof of attendance. Please resubmit in words.",
                  ),
                  no: gate(
                    "no-booking",
                    "Counting on a walk-in table?",
                    "Does the plan depend on getting a table somewhere without a booking?",
                    {
                      yes: outcome(
                        "seated-next-door",
                        "Seated next door",
                        "No booking found. Your party has been pre-seated at the place next door, which has a table.",
                      ),
                      no: gate("ex", "Ex sighting possible?", "Is there a chance of running into someone's ex?", {
                        yes: outcome(
                          "exit-line",
                          "Exit line issued",
                          'One (1) exit line has been issued: "I think my phone is ringing." Carry it at all times.',
                        ),
                        no: gate("karaoke", "Ends at karaoke?", "Does the plan end at karaoke?", {
                          yes: outcome(
                            "room-three",
                            "Room 3 reserved for 1am",
                            "Plan certified complete. Room 3 is reserved for 1am. Someone will sing Mr Brightside, as is customary.",
                          ),
                          no: gate("budget", "Budget unspoken?", "Has nobody said the budget out loud?", {
                            yes: outcome(
                              "statement-embargoed",
                              "Bank statement embargoed",
                              "Your bank statement has been embargoed until Sunday. Do not look at it on Saturday.",
                            ),
                            no: gate("dinner", "Skipping dinner?", "Does the plan skip eating a proper meal?", {
                              yes: outcome(
                                "chips-deployed",
                                "Chips deployed",
                                "One (1) portion of chips has been deployed to intercept your party at 10:15pm.",
                              ),
                              no: outcome(
                                "permit-granted",
                                "Permit granted",
                                "Permit granted. This is a plan, not a night out. The office is proud and slightly jealous.",
                              ),
                            }),
                          }),
                        }),
                        unsure: outcome(
                          "kev-on-lookout",
                          "Lookout posted",
                          "Ex sighting risk undetermined. Kev has been posted by the door as a lookout. Kev has not been told why.",
                        ),
                      }),
                    },
                  ),
                },
              ),
            },
          ),
        }),
      }),
    }),
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
