/**
 * Could This Meeting Be An Email?
 * Pattern: threshold gate on a score, with an "unsure" band.
 *
 * A score question rates the invite on a 0–4 rubric. The gate passes at 2.5,
 * and anything within 0.4 of the bar takes a third, more nuanced path instead
 * of flipping a coin at the boundary.
 */
import { emit, gate, noul, score } from "jevchain";
import type { Example } from "./types";

export const meetingEmail = gate("needs-a-meeting", {
  title: "Does this need a meeting?",
  ask: score("How much does this meeting need people talking live, in real time?", [
    "Could be a Slack message",
    "Could be an email",
    "Could be a doc with comments",
    "A short call would help",
    "Must be live: a real decision, a conflict, or brainstorming",
  ]),
  alsoAsk: { agenda: noul("Does the invite include a clear agenda or goal?") },
  pass: { min: 2.5 },
  then: emit("Keep it. Maybe make it 25 minutes. You deserve 5 minutes of silence.", { id: "keep" }),
  otherwise: emit("Decline with a doc link and a smile. Reclaim your afternoon.", { id: "decline" }),
  unsure: { margin: 0.4, then: emit("Counter-offer: 15 minutes, agenda first, cameras optional.", { id: "counter-offer" }) },
});

export const example: Example = {
  slug: "meeting-email",
  title: "Could This Meeting Be An Email?",
  tagline: "Finally, a calibrated answer to the oldest question in corporate life.",
  pattern: "Threshold gate + unsure band",
  lesson:
    "Gate on a score or probability, and give borderline cases their own path. A decision near the bar is a different decision, not a coin flip.",
  chain: meetingEmail,
  file: "meeting-email.ts",
  inputs: [
    {
      label: "Weekly sync",
      value: { title: "Weekly sync", description: "Going around the room with status updates.", attendees: 14, minutes: 60 },
    },
    {
      label: "Incident retro",
      value: {
        title: "Checkout outage retro",
        description: "Agenda: timeline (10m), root cause debate (20m), decide on the fix and owner (15m). Payments + infra must attend.",
        attendees: 6,
        minutes: 45,
      },
    },
    {
      label: "Quick question",
      value: { title: "Quick question", description: "", attendees: 2, minutes: 30 },
    },
  ],
};
