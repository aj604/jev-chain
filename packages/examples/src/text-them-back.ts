/**
 * Should I Text Them Back?
 * Pattern: cascade. Cheap first, escalate only when unsure.
 *
 * Tier 1 reads only the message. If Jev is confident, we're done in one small
 * call. If not, tier 2 re-asks with the full context (history, vibes, receipts).
 * If *that* is still a coin flip, the fallback leaf takes over. Here it's the
 * group chat; in production it's where you'd call an LLM or a human.
 */
import { cascade, chain, choice, step, tier } from "jevchain";
import type { Example } from "./types";

const verdict = choice("Should the recipient reply to this text message?", {
  reply: "Replying is kind, safe and likely to lead somewhere good.",
  "leave-on-read": "Replying would restart something unhealthy, or the message doesn't need a reply.",
});

const decide = cascade("should-i-reply", {
  title: "Should I reply?",
  tiers: [
    tier("gut-check", { title: "Gut check", ask: verdict, minConfidence: 0.7, state: "{{input.message}}" }),
    tier("full-context", { title: "Full context", ask: verdict, minConfidence: 0.5 }),
  ],
  fallback: step(
    "ask-the-group-chat",
    () => "Screenshot it and send it to the group chat. This is above Jev's pay grade.",
    { title: "Ask the group chat" },
  ),
});

export const textThemBack = chain(
  "text-them-back",
  decide,
  step("verdict", (r) =>
    r.resolvedBy === "fallback"
      ? r.output
      : r.answer.choice === "reply"
        ? `Reply. (decided by ${r.tier}) Keep it short, you're busy and mysterious.`
        : `Leave them on read. (decided by ${r.tier}) Put the phone in a drawer.`,
  ),
);

export const example: Example = {
  slug: "text-them-back",
  title: "Should I Text Them Back?",
  tagline: "A three-tier decision system for a one-word question.",
  pattern: "Cascade (cheap → thorough → fallback)",
  lesson:
    "Ask the cheapest question first and only escalate when confidence is low. Each tier can see more context; the fallback can be anything, like an LLM, a human queue or your friends.",
  chain: textThemBack,
  file: "text-them-back.ts",
  inputs: [
    {
      label: "u up?",
      value: {
        message: "u up?",
        context: { theirLastMessage: "5 weeks ago", timesTheyCancelledPlans: 4, howIFeel: "I finally stopped checking my phone" },
      },
    },
    {
      label: "Birthday wishes",
      value: {
        message: "Happy birthday!! Hope you have the best day, we should get lunch soon 🎂",
        context: { relationship: "old coworker", lastSpoke: "a few months ago, on good terms" },
      },
    },
    {
      label: "The ex, again",
      value: {
        message: "hey. saw something that reminded me of you",
        context: { relationship: "ex", howItEnded: "they moved across the country without telling me", monthsSince: 8, howIFeel: "mostly fine?" },
      },
    },
  ],
};
