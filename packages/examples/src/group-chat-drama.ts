/**
 * Group Chat Drama Triage
 * Pattern: speculative fan-out + composite scoring in code.
 *
 * Four independent reads of the same chat run in `parallel`. Because they share
 * a state, the client merges them into ONE request automatically (Jev reads the
 * state once and answers every question in parallel). Then plain code weighs
 * the answers into a severity and a plan. Jev judges; your code decides.
 */
import { ask, chain, choice, noul, parallel, score, step, type OutputOf } from "jevchain";
import type { Example } from "./types";

const readTheRoom = parallel("read-the-room", {
  title: "Read the room",
  branches: {
    heat: ask("heat", {
      questions: {
        heat: score("How heated is this conversation?", ["friendly", "a little tense", "people are upset", "full meltdown"]),
      },
    }),
    passive: ask("passive-aggression", {
      questions: { passive: noul("Is anyone in `messages` being passive-aggressive?") },
    }),
    aboutMe: ask("about-me", {
      questions: { aboutMe: noul("Is the tension directed at the person named in `me`?") },
    }),
    topic: ask("topic", {
      questions: {
        topic: choice("What is the tension mostly about?", {
          plans: "Scheduling, cancelled plans, who is coming to what",
          money: "Splitting bills, who owes whom, Venmo requests",
          feelings: "Someone feels left out, ignored, or disrespected",
          nothing: "There is no real tension; it's banter or memes",
        }),
      },
    }),
  },
});

const WEIGHTS = { heat: 0.5, passive: 0.2, aboutMe: 0.3 };

const plan = step("make-a-plan", (r: OutputOf<typeof readTheRoom>) => {
  // Composite score: weights live in code, where you can tune and test them.
  const severity =
    WEIGHTS.heat * (r.heat.heat.score / 3) + WEIGHTS.passive * r.passive.passive.noul + WEIGHTS.aboutMe * r.aboutMe.aboutMe.noul;
  const topic = r.topic.topic.choice;
  const advice =
    severity < 0.25
      ? "All good. Send a meme and carry on."
      : severity < 0.5
        ? topic === "money"
          ? "Pay what you owe. Screenshot the receipt. Say nothing else."
          : "Mute for one hour. Hydrate. Re-read before replying."
        : severity < 0.75
          ? topic === "feelings"
            ? "Take it to DMs. Lead with 'hey, are we good?'"
            : "Call them. Like, with your voice."
          : "Leave the group. Change your name. Move to a new city.";
  return { severity: Math.round(severity * 100) / 100, topic, advice };
}, { title: "Make a plan" });

export const groupChatDrama = chain("group-chat-triage", readTheRoom, plan);

export const example: Example = {
  slug: "group-chat-drama",
  title: "Group Chat Drama Triage",
  tagline: "Four reads of the room, one API call, zero emotional labour.",
  pattern: "Speculative fan-out + composite scoring",
  lesson:
    "Fan out independent questions with parallel; asks against the same state are batched into a single request for free. Combine the answers with weights in code, where they're easy to test and tune.",
  chain: groupChatDrama,
  file: "group-chat-drama.ts",
  inputs: [
    {
      label: "The brunch incident",
      value: {
        me: "Sam",
        messages: [
          { from: "Priya", text: "so are we still doing brunch sunday" },
          { from: "Sam", text: "can't this week sorry!!" },
          { from: "Jordan", text: "classic" },
          { from: "Priya", text: "no worries. we'll just plan around Sam again 🙂" },
          { from: "Jordan", text: "third time this month but who's counting" },
        ],
      },
    },
    {
      label: "Venmo standoff",
      value: {
        me: "Alex",
        messages: [
          { from: "Chris", text: "hey just a reminder the airbnb was $840 split 4 ways" },
          { from: "Chris", text: "3 of you have paid" },
          { from: "Chris", text: "Alex." },
          { from: "Mo", text: "lmaooo" },
        ],
      },
    },
    {
      label: "Wholesome",
      value: {
        me: "Robin",
        messages: [
          { from: "Kai", text: "look at this dog" },
          { from: "Robin", text: "I would die for him" },
          { from: "Lee", text: "he's a 10/10 best boy" },
        ],
      },
    },
  ],
};
