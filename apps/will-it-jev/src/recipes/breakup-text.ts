import { gate, outcome, recipe, route } from "@/lib/recipe/build";
import type { CuratedRecipe } from ".";

/** A department per kind of breakup, and a second desk for dividing the assets. */
export const breakup: CuratedRecipe = {
  slug: "breakup-text",
  recipe: recipe(
    "The Breakup Text Dispatch Desk",
    "your breakup text",
    route(
      "breakup-desk",
      "Which department?",
      "Which department should process this breakup text?",
      {
        "clean-break": "Says it is over, clearly and kindly, once. Does not negotiate or leave a door open.",
        "door-ajar": "Ends things but leaves a door open: staying friends, needing space, maybe someday.",
        "asset-division": "Mostly concerned with who keeps what: furniture, a pet, a shared account, the friends.",
        "legal-notice": "Reads as if drafted by a lawyer, or mentions a lawyer, a court or a formal notice.",
      },
      {
        "clean-break": outcome(
          "courier-dispatched",
          "Courier dispatched",
          "Delivered. A courier has been dispatched to collect one (1) toothbrush and a hoodie of disputed ownership.",
        ),
        "door-ajar": gate(
          "still-friends",
          "Friendship offered?",
          'Does the text offer to "still be friends", or something close to it?',
          {
            means: {
              yes: "Friendship is offered outright, as a consolation prize",
              no: "The door is left open some other way: space, timing, maybe someday",
            },
            yes: outcome(
              "friendship-filed",
              "Friendship application filed",
              "Friendship application received. Current processing time: eleven to fourteen years.",
            ),
            no: outcome(
              "door-wedged",
              "Door wedged open",
              "A door has been left ajar. Facilities will check on it at 2am, nightly, for six weeks.",
            ),
          },
        ),
        "asset-division": route(
          "contested-asset",
          "Contested asset",
          "What is the main thing being divided in this breakup text?",
          {
            furniture: "A couch, a bed, a lamp, or another piece of furniture.",
            pet: "An animal who did not agree to any of this.",
            subscription: "A streaming account, a phone plan, a gym membership or a shared password.",
            friends: "The friend group, a group chat, or a standing Thursday dinner.",
          },
          {
            furniture: outcome(
              "couch-escrow",
              "Couch placed in escrow",
              "The couch has been placed in escrow. Neither party may sit on it until a ruling is issued.",
            ),
            pet: outcome(
              "custody-hearing",
              "Custody hearing scheduled",
              "Custody hearing scheduled for Tuesday, 9am. The animal will be represented by independent counsel.",
            ),
            subscription: outcome(
              "access-revoked",
              "Streaming access revoked",
              "Access revoked, effective Sunday at 11:59pm. They may finish the current season.",
            ),
            friends: outcome(
              "friends-partitioned",
              "Friend group partitioned",
              "The friend group has been partitioned. Priya was not consulted and now appears in both halves.",
            ),
          },
        ),
        "legal-notice": outcome(
          "counsel-copied",
          "Forwarded to counsel",
          "Forwarded to counsel. Counsel would like to know why they have been copied on a text message.",
        ),
      },
      outcome(
        "linda-reads-it",
        "Referred to Linda",
        "Unclear whether this is a breakup. Referred to Linda in Relationships, who is reading it aloud to the office.",
      ),
    ),
  ),
  samples: [
    {
      label: "Clean break",
      input:
        "Hey. I've thought about this a lot and I don't want to keep seeing each other. I'm sorry. I wish you well.",
    },
    {
      label: "Still friends",
      input:
        "I think we should break up but honestly I really hope we can still be friends, you mean so much to me and I don't want to lose you completely.",
    },
    {
      label: "The couch",
      input:
        "We're done. For the record, the couch is mine, I paid for it, and I'm collecting it Saturday. Your lamp is by the door.",
    },
  ],
};
