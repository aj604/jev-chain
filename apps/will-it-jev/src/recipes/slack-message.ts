import { gate, outcome, recipe, route } from "@/lib/recipe/build";
import type { CuratedRecipe } from ".";

/** Messages are sorted by what they are actually doing, not what they say they are doing. */
export const slack: CuratedRecipe = {
  slug: "slack-message",
  recipe: recipe(
    "The Internal Communications Sorting Office",
    "your Slack message",
    route(
      "sorting",
      "What is it actually doing?",
      "What is this Slack message actually doing?",
      {
        request: "Asks someone to do something, with enough detail that they could do it.",
        "bare-hey": "Only a greeting. The actual question is being held back for later.",
        "polite-complaint": 'A complaint in a polite hat: "per my last message", "just circling back", "as discussed".',
        "no-rush": "Insists there is no rush, in a way that makes the rush clear.",
        "whole-channel": "Notifies an entire channel about something that concerns one or two people.",
      },
      {
        request: gate(
          "deadline",
          "Deadline stated?",
          "Does the message give a specific day or time the request is needed by?",
          {
            means: {
              yes: "Names a day, a date or a time",
              no: "Leaves the timing to fate",
            },
            yes: outcome(
              "calendar-rearranged",
              "Calendar rearranged",
              "Task assigned. The recipient's calendar has been quietly rearranged around it.",
            ),
            no: outcome(
              "filed-someday",
              "Filed under someday",
              "Filed under someday. A reminder has been set for a date that does not exist.",
            ),
          },
        ),
        "bare-hey": outcome(
          "question-awaited",
          "Question awaited",
          "The recipient is watching the typing indicator. Estimated arrival of the actual question: 40 minutes.",
        ),
        "polite-complaint": gate(
          "per-my-last",
          '"Per my last message"?',
          'Does the message say "per my last message", "as previously mentioned", or something very close?',
          {
            yes: outcome(
              "complaint-lodged",
              "Complaint lodged in triplicate",
              "Converted to a formal complaint and lodged with HR in triplicate. Your last message is attached.",
            ),
            no: outcome(
              "area-ventilated",
              "Area ventilated",
              "Passive aggression detected at 0.3 millisieverts. The area has been ventilated.",
            ),
          },
        ),
        "no-rush": outcome(
          "priority-raised",
          "Priority raised to P0",
          "A rush has been detected beneath the no rush. Priority raised to P0 and the recipient's lunch cancelled.",
        ),
        "whole-channel": outcome(
          "channel-evacuated",
          "Channel evacuated",
          "Four hundred (400) people have been notified. Two have left the channel. One has left the company.",
        ),
      },
      outcome(
        "gary-closed-it",
        "Forwarded to Gary",
        "Intent unclear. Forwarded to Gary in IT, who has reacted with a thumbs-up and closed the ticket.",
      ),
    ),
  ),
  samples: [
    { label: "No rush", input: "Hey, any update on the Q3 numbers? No rush at all, whenever you get a sec." },
    { label: "Just hey", input: "hey" },
    {
      label: "Per my last",
      input:
        "Just circling back on this, per my last message. Can you confirm the file is in the shared folder, as discussed three times?",
    },
  ],
};
