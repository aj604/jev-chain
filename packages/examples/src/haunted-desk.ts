/**
 * The Haunted Appliance Support Desk
 * Pattern: intent routing, with a nested decision and a low-confidence escape hatch.
 *
 * One choice picks the team. Jev's confidence says whether to trust it; if it's
 * shaky we hand off to a human instead of guessing. The paranormal branch nests a
 * safety gate and a second route, so a chain is just nodes all the way down.
 */
import { chain, choice, emit, gate, noul, route } from "jevchain";
import type { Example } from "./types";

const paranormal = chain(
  "paranormal-unit",
  gate("anyone-in-danger", {
    title: "Anyone in danger?",
    ask: noul("Is anyone in physical danger right now?", {
      true: "fire, smoke, injury, someone trapped, or threats of harm",
      false: "spooky or annoying, but nobody is getting hurt",
    }),
    pass: { max: 0.5 },
    then: route("classify-entity", {
      title: "What are we dealing with?",
      ask: choice("What is most likely going on with this appliance?", {
        poltergeist: "Objects move, doors open or close, or things get thrown with no one touching them.",
        "possessed-firmware": "The device's screen, voice or app behaves with apparent intent: messages, speech, settings changing themselves.",
        "just-a-draft": "There is a plausible ordinary cause: wind, a loose part, a neighbour, a smart-home routine.",
      }),
      branches: {
        poltergeist: emit("Booked: one (1) exorcist. Please remove fragile items from the countertop.", { id: "book-exorcist" }),
        "possessed-firmware": emit("Try turning it off and on again. If it asks you not to, call us back.", { id: "power-cycle" }),
        "just-a-draft": emit("Closed a window for you, spiritually. Ticket resolved.", { id: "close-window" }),
      },
    }),
    otherwise: emit("🚨 Leave the house now. Sending the fire department AND a priest.", { id: "evacuate" }),
  }),
);

export const hauntedDesk = route("front-desk", {
  title: "Front desk",
  description: "Routes appliance support tickets to the right team, including the one nobody talks about.",
  ask: choice("Which team should handle this appliance support ticket?", {
    repair: "An ordinary mechanical or electrical fault: won't start, leaks, overheats, makes a noise with a normal explanation.",
    billing: "Payments, refunds, invoices, warranties or subscriptions.",
    paranormal: "Behaviour no appliance can do: speaking, moving by itself, knowing things, cold spots, apparitions.",
  }),
  alsoAsk: {
    sarcastic: noul("Is the customer joking or being sarcastic?"),
    angry: noul("Is the customer angry?"),
  },
  lowConfidence: { below: 0.4, then: emit("Unclear. A human will read this. Probably Dave.", { id: "ask-dave" }) },
  branches: {
    repair: emit("Technician booked. Arrival window: 8am to the heat death of the universe.", { id: "book-technician" }),
    billing: emit("Forwarded to billing. They live for this.", { id: "forward-billing" }),
    paranormal,
  },
});

export const example: Example = {
  slug: "haunted-desk",
  title: "Haunted Appliance Support Desk",
  tagline: "Tier 1 support for toasters with unfinished business.",
  pattern: "Intent routing + confidence fallback",
  lesson:
    "Use a choice to pick a handler, and use its confidence as a second axis: when Jev isn't sure, route to a human instead of guessing. Nest gates and routes inside branches for multi-step triage.",
  chain: hauntedDesk,
  file: "haunted-desk.ts",
  inputs: [
    { label: "Whispering toaster", value: "My toaster whispers my name at 3am and the bread comes out cold." },
    { label: "Double charge", value: "I was charged twice for my fridge's extended warranty. Please refund one." },
    { label: "Leaky dishwasher", value: "The dishwasher leaks from the bottom left corner, but only when it drains." },
    { label: "Microwave prophecy", value: "The microwave opened by itself, said 'soon', and now there is smoke coming out of it." },
    { label: "Smart fridge", value: "My smart fridge keeps changing its screen to say 'I see you' and ordering 40 lemons." },
  ],
};
