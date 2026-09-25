import type { ReactNode } from "react";
import { C } from "@/components/docs/doc-ui";

/**
 * "What to notice" for each gallery example. `at` is a snippet of the source
 * that the note is about; the page turns it into a line link (and a build
 * error if the snippet ever disappears from the file).
 */
export interface Note {
  title: string;
  body: ReactNode;
  at: string;
  /** Docs page that explains the idea. */
  docs?: string;
}

export const EXAMPLE_NOTES: Record<string, Note[]> = {
  "haunted-desk": [
    {
      title: "One question, two axes",
      body: (
        <>
          The route asks a single choice, then uses Jev&apos;s <em>confidence</em> as a second signal. Below 0.4, the ticket
          goes to Dave instead of the likeliest team. Guessing is a choice too; this one declines.
        </>
      ),
      at: "lowConfidence:",
      docs: "/docs/route#low-confidence",
    },
    {
      title: "alsoAsk rides along for free",
      body: (
        <>
          <C>sarcastic</C> and <C>angry</C> go out in the same request as the routing question. They don&apos;t pick a
          branch, but their answers land in the trace, ready for analytics or a follow-up.
        </>
      ),
      at: "alsoAsk:",
      docs: "/docs/route#also-ask",
    },
    {
      title: "Safety is a ceiling, not a floor",
      body: (
        <>
          The danger gate passes with <C>{"pass: { max: 0.5 }"}</C>: continue only while p(danger) stays <em>low</em>.
          Anything above it evacuates. Gates measure in both directions.
        </>
      ),
      at: "pass: { max: 0.5 }",
      docs: "/docs/gate#thresholds",
    },
    {
      title: "Branches are just nodes",
      body: (
        <>
          <C>paranormal</C> is a whole chain holding a gate holding a route. Exhaustiveness is checked at every level: add a
          fourth entity and forget its branch, and it won&apos;t compile.
        </>
      ),
      at: "const paranormal = chain(",
      docs: "/docs/route#nesting",
    },
  ],
  "group-chat-drama": [
    {
      title: "Four asks, one request",
      body: (
        <>
          All four branches ask about the same state (the chat), so the client merges them into a single HTTP request. Jev
          reads the chat once and answers all four. The trace marks each call with <C>{"batch: { size: 4 }"}</C>.
        </>
      ),
      at: "const readTheRoom = parallel(",
      docs: "/docs/parallel#batching",
    },
    {
      title: "Every question type in one fan-out",
      body: (
        <>
          A <C>score</C> for heat, two <C>noul</C>s for passive aggression and aim, and a <C>choice</C> for the topic. Each
          answer comes back typed to match its question.
        </>
      ),
      at: "heat: score(",
      docs: "/docs/questions",
    },
    {
      title: "The weights live in code",
      body: (
        <>
          Jev judges; your code decides. Severity is a plain weighted sum you can tune and unit-test without touching a
          single prompt.
        </>
      ),
      at: "const WEIGHTS",
    },
    {
      title: "Typed all the way down",
      body: (
        <>
          <C>r.topic.topic.choice</C> is <C>&quot;plans&quot; | &quot;money&quot; | &quot;feelings&quot; | &quot;nothing&quot;</C>, so a
          typo in <C>topic === &quot;money&quot;</C> fails the build instead of the friendship.
        </>
      ),
      at: "const topic = r.topic.topic.choice",
      docs: "/docs/questions#inferred-types",
    },
  ],
  "text-them-back": [
    {
      title: "Same question, more context",
      body: (
        <>
          Both tiers ask the identical <C>verdict</C> choice. The gut check sees only <C>{"{{input.message}}"}</C>; the
          second tier sees the whole input: history, vibes, receipts.
        </>
      ),
      at: 'state: "{{input.message}}"',
      docs: "/docs/cascade#tiers",
    },
    {
      title: "Escalation runs on confidence",
      body: (
        <>
          The gut check has to be 0.7 sure to answer. Full context gets away with 0.5. Most messages never pay for the
          second call.
        </>
      ),
      at: 'tier("gut-check"',
      docs: "/docs/cascade#basics",
    },
    {
      title: "The fallback can be anything",
      body: (
        <>
          Here it&apos;s a <C>step</C> that suggests asking the group chat. In production, that&apos;s where an LLM call or a
          human review queue goes, and only the hard cases reach it.
        </>
      ),
      at: "fallback: step(",
      docs: "/docs/cascade#fallback",
    },
    {
      title: "A result you can narrow",
      body: (
        <>
          <C>r.resolvedBy === &quot;fallback&quot;</C> narrows to the fallback&apos;s output; otherwise you get <C>r.tier</C> and a
          typed <C>r.answer.choice</C>.
        </>
      ),
      at: 'r.resolvedBy === "fallback"',
      docs: "/docs/cascade#result",
    },
  ],
  "meeting-email": [
    {
      title: "Gating on a score",
      body: (
        <>
          Five rubric levels produce a probability-weighted score from 0 to 4, which can land between levels. The gate passes
          at 2.5: somewhere between &ldquo;doc with comments&rdquo; and &ldquo;short call&rdquo;.
        </>
      ),
      at: "pass: { min: 2.5 }",
      docs: "/docs/gate#thresholds",
    },
    {
      title: "Close calls get their own path",
      body: (
        <>
          Anything within 0.4 of the bar (2.1 to 2.9) takes the counter-offer instead of flipping a coin at the boundary. A
          decision near the bar is a different decision.
        </>
      ),
      at: "unsure: {",
      docs: "/docs/gate#unsure",
    },
    {
      title: "Evidence without influence",
      body: (
        <>
          <C>agenda</C> is asked alongside the deciding question and recorded in the trace, but it never moves the needle.
          That makes it great for explaining a decision later.
        </>
      ),
      at: "alsoAsk:",
    },
    {
      title: "A chain can be one node",
      body: <>The whole example is a single gate. No wrapper needed: every node is a runnable chain.</>,
      at: "export const meetingEmail = gate(",
    },
  ],
  "pr-horoscope": [
    {
      title: "Five questions, one call",
      body: (
        <>
          A single <C>ask</C> carries a score, three nouls and a choice about the same PR. That&apos;s one request, and the
          PR text is read and billed once.
        </>
      ),
      at: "const read = ask(",
      docs: "/docs/ask#one-call",
    },
    {
      title: "A typed lookup table",
      body: (
        <>
          <C>SCOPE_RISK[a.scope.choice]</C> typechecks because the choice is a literal union. Rename a label and the table
          lights up red.
        </>
      ),
      at: "const SCOPE_RISK",
      docs: "/docs/questions#inferred-types",
    },
    {
      title: "Normalize before you weigh",
      body: (
        <>
          <C>clarity</C> is a 0–3 score, so it&apos;s divided by 3 before it meets the 0–1 nouls. Composite scores only work
          when the parts share a scale.
        </>
      ),
      at: "a.clarity.score / 3",
    },
    {
      title: "Types flow across the chain",
      body: (
        <>
          The step takes <C>OutputOf&lt;typeof read&gt;</C>, so every answer it touches is typed, and <C>chain(read, horoscope)</C>{" "}
          only compiles because the two fit.
        </>
      ),
      at: "export const prHoroscope = chain(",
      docs: "/docs/chain#types",
    },
  ],
};
