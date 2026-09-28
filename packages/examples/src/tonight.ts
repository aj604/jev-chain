/**
 * Will Your Plan For Tonight Jev?
 * Pattern: deep gate ladder, ten yes/no gates nested one inside the next.
 *
 * Each gate asks whether something is wrong with the plan. "No" passes to the
 * next gate and "yes" ends the night at that gate's verdict. Only the gates on
 * the path taken are ever asked, so a doomed plan costs one request and a good
 * one costs ten.
 *
 * Will It Jev's `tonight` recipe (apps/will-it-jev/src/recipes/tonight.ts)
 * asks these same ten questions in the same order, and a test there checks
 * the two ladders still match, so change the questions together. The leaves
 * differ on purpose: here the plan is graded, there it is filed.
 */
import { emit, gate, noul } from "jevchain";
import type { Example } from "./types";

type Tier = "jevs" | "kinda" | "nope";

/** A leaf of the ladder: the verdict, titled with its line. */
const verdict = (id: string, tier: Tier, line: string) => emit({ tier, line }, { id, title: line });

const ONE_DRINK = 'Does the plan include the phrase "just one drink"?';
const VENUES = "Does the plan involve more than two venues?";
const GETTING_HOME = "Is it unclear how everyone gets home?";
const EARLY_START = "Does anyone involved have to be at work early tomorrow?";
const THUMBS_UP = "Is a thumbs-up reaction the only sign that people agreed to the plan?";
const NO_BOOKING = "Does the plan depend on getting a table somewhere without a booking?";
const EX = "Is there a chance of running into someone's ex?";
const KARAOKE = "Does the plan end at karaoke?";
const BUDGET = "Has nobody said the budget out loud?";
const DINNER = "Does the plan skip eating a proper meal?";

export const tonight = gate("one-drink", {
  title: ONE_DRINK,
  ask: noul(ONE_DRINK),
  pass: { max: 0.5 },
  then: gate("venues", {
    title: VENUES,
    ask: noul(VENUES),
    pass: { max: 0.5 },
    then: gate("getting-home", {
      title: GETTING_HOME,
      ask: noul(GETTING_HOME),
      pass: { max: 0.5 },
      then: gate("early-start", {
        title: EARLY_START,
        ask: noul(EARLY_START),
        pass: { max: 0.5 },
        then: gate("thumbs-up", {
          title: THUMBS_UP,
          ask: noul(THUMBS_UP),
          pass: { max: 0.5 },
          then: gate("no-booking", {
            title: NO_BOOKING,
            ask: noul(NO_BOOKING),
            pass: { max: 0.5 },
            then: gate("ex", {
              title: EX,
              ask: noul(EX),
              pass: { max: 0.5 },
              then: gate("karaoke", {
                title: KARAOKE,
                ask: noul(KARAOKE),
                pass: { max: 0.5 },
                then: gate("budget", {
                  title: BUDGET,
                  ask: noul(BUDGET),
                  pass: { max: 0.5 },
                  then: gate("dinner", {
                    title: DINNER,
                    ask: noul(DINNER),
                    pass: { max: 0.5 },
                    then: verdict("dinner-then", "jevs", "It jevs. This is a plan, not a night out."),
                    otherwise: verdict("dinner-otherwise", "nope", "It does not jev. Eat something."),
                  }),
                  otherwise: verdict("budget-otherwise", "kinda", "It sort of jevs. Check your account on Sunday, not Saturday."),
                }),
                otherwise: verdict("karaoke-otherwise", "jevs", "It jevs. Karaoke is where plans go to be complete."),
              }),
              otherwise: verdict("ex-otherwise", "kinda", "It sort of jevs. Have an exit line ready."),
            }),
            otherwise: verdict("no-booking-otherwise", "kinda", "It sort of jevs. You will eat at the place next door."),
          }),
          otherwise: verdict("thumbs-up-otherwise", "nope", "It does not jev. A thumbs-up is not agreement."),
        }),
        otherwise: verdict("early-start-otherwise", "kinda", "It sort of jevs. Someone will leave at nine and be right."),
      }),
      otherwise: verdict("getting-home-otherwise", "nope", "It does not jev. Decide who is driving now."),
    }),
    otherwise: verdict("venues-otherwise", "kinda", "It sort of jevs. You will lose someone between the second and third venue."),
  }),
  otherwise: verdict("one-drink-otherwise", "nope", "It does not jev. It is never one drink."),
});

export const example: Example = {
  slug: "tonight",
  title: "Will Your Plan For Tonight Jev?",
  tagline: "Ten questions stand between you and a reasonable evening.",
  pattern: "Deep gate ladder",
  lesson:
    "Gates compose like logic gates. Ten yes/no questions, nested, make a decision no single question could, and each is only asked if the gate before it let the night continue.",
  chain: tonight,
  file: "tonight.ts",
  inputs: [
    {
      label: "Booked",
      value:
        "Dinner at 7 at Luca, booked for six. Then the 9:15 film. Sam is driving everyone home. Everyone in the chat said yes. Forty each, max.",
    },
    { label: "Just one drink", value: "Just one drink at the Crown after work, then we'll see." },
    {
      label: "Crawl",
      value:
        "Four bars on Dean Street, then karaoke. We'll figure out getting home later. Kev and Jo gave it a thumbs up.",
    },
  ],
};
