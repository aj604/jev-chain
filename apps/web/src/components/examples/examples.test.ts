/**
 * The examples gallery, run and checked against jevchain.
 *
 * Part one runs every example on every sample input the gallery offers, so a
 * sample that crashes the chain fails here instead of in the studio.
 *
 * Part two proves what the gallery teaches. Each example's lesson and each
 * of its "what to notice" notes has a proof below that exercises the real
 * example chain. A note or lesson with no proof fails, and so does a proof
 * whose note is gone.
 *
 * Proofs also say which phrases they vouch for (`says`). Each phrase must be
 * in the note, and every number the note states (digits, or one to ten
 * spelled out) must sit inside a vouched phrase. So a note can't grow a
 * number, like "2.1 to 2.9" or "batch size 4", that no proof checked.
 *
 * Jev is faked at the HTTP layer only: the real `createJevClient` talks to a
 * `fetch` that answers from an oracle. Batching, request counts and the
 * state each request carries are all genuine.
 */
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  chain,
  choice,
  createJev,
  createJevClient,
  emit,
  gate,
  noul,
  route,
  step,
  type Answer,
  type Json,
  type OutputOf,
  type Question,
  type Questions,
  type RunResult,
} from "jevchain";
import { examples, getExample, groupChatDrama, prHoroscope } from "jevchain-examples";
import { describe, expect, expectTypeOf, it } from "vitest";
import { EXAMPLE_NOTES } from "./example-notes";

// ---------------------------------------------------------------------------
// A fake Jev, behind the real client
// ---------------------------------------------------------------------------

/** Pick an answer for one question (`request` counts from 0); return only the fields you care about. */
type Oracle = (q: Question, request: number) => Partial<Answer> | undefined;

const instructions = (q: Question) => (typeof q.instructions === "string" ? q.instructions : "");

/** An oracle that answers by question text: the first key found in the instructions wins. */
const by =
  (script: Record<string, Partial<Answer>>): Oracle =>
  (q) =>
    Object.entries(script).find(([k]) => instructions(q).includes(k))?.[1];

function answer(q: Question, o: Partial<Answer> = {}): Answer {
  if (q.type === "noul") return { type: "noul", noul: 0.1, ...o } as Answer;
  if (q.type === "score") return { type: "score", score: 0, probabilities: {}, legend: {}, confidence: 0.9, ...o } as Answer;
  const labels = Array.isArray(q.criteria) ? (q.criteria as string[]) : Object.keys(q.criteria);
  return { type: "choice", choice: labels[0]!, probabilities: {}, confidence: 0.9, ...o } as Answer;
}

interface WireRequest {
  state: Json;
  questions: Questions;
}

type Run = RunResult<unknown> & {
  /** Every HTTP request that reached "Jev", in order. */
  requests: WireRequest[];
  /** Ids of every node that ran. */
  ran: string[];
};

/** Run a gallery example through the real client and runtime, with `oracle` playing Jev. */
async function runExample(slug: string, oracle: Oracle = () => undefined, input?: Json): Promise<Run> {
  const ex = getExample(slug)!;
  const requests: WireRequest[] = [];
  const fetch = async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init!.body)) as WireRequest;
    const n = requests.push(body) - 1;
    const answers = Object.fromEntries(Object.entries(body.questions).map(([k, q]) => [k, answer(q, oracle(q, n))]));
    return new Response(JSON.stringify({ model: "jev-1.13.0", answers, usage: { input_tokens: 100, output_tokens: 1 } }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const client = createJevClient({ apiKey: "test", fetch: fetch as typeof globalThis.fetch, retry: { maxRetries: 0 } });
  const r = await createJev(client).run(ex.chain, input ?? ex.inputs[0]!.value);
  return { ...r, requests, ran: r.trace.spans.map((s) => s.nodeId) };
}

/** The sample input with this label. */
const input = (slug: string, label: string): Json => getExample(slug)!.inputs.find((i) => i.label === label)!.value;

// ---------------------------------------------------------------------------
// What each proof vouches for
// ---------------------------------------------------------------------------

interface Proof {
  /** Phrases of the note (or lesson) this proof checks. Each must appear in it, verbatim. */
  says: string[];
  run: () => Promise<void> | void;
}

const LESSON = "the lesson";

/** A note's title and body as the page prints them, tags stripped. */
function noteText(title: string, body: Parameters<typeof createElement>[2]): string {
  const html = renderToStaticMarkup(createElement(Fragment, null, body));
  const text = html
    .replace(/<[^>]+>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
  return `${title}. ${text}`.replace(/\s+/g, " ");
}

const NUMBER_WORDS = "one|two|three|four|five|six|seven|eight|nine|ten";
const NUMBERS = new RegExp(`\\d+(?:\\.\\d+)?|\\b(?:${NUMBER_WORDS})\\b`, "gi");

/** Numbers in `text` that no vouched phrase covers. */
function unvouched(text: string, says: string[]): string[] {
  const covered = new Array<boolean>(text.length).fill(false);
  for (const phrase of says) {
    for (let at = text.indexOf(phrase); at !== -1; at = text.indexOf(phrase, at + 1)) covered.fill(true, at, at + phrase.length);
  }
  return [...text.matchAll(NUMBERS)].filter((m) => !covered[m.index!]).map((m) => m[0]);
}

// ---------------------------------------------------------------------------
// Part one: every example runs on every sample input
// ---------------------------------------------------------------------------

describe("every gallery example runs on its sample inputs", () => {
  for (const ex of examples) {
    for (const { label, value } of ex.inputs) {
      it(`${ex.slug}: "${label}"`, async () => {
        const r = await runExample(ex.slug, () => undefined, value);
        expect(r.status, r.error?.message).toBe("ok");
        expect(r.output).toBeTruthy();
        expect(r.requests.length).toBeGreaterThan(0);
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Part two: what the gallery teaches, proved
// ---------------------------------------------------------------------------

const PARANORMAL = { choice: "paranormal", confidence: 0.9 } as const;

const proofs: Record<string, Record<string, Proof>> = {
  "haunted-desk": {
    [LESSON]: {
      says: [],
      run: async () => {
        // A choice picks the handler…
        for (const [team, leaf] of [
          ["repair", "book-technician"],
          ["billing", "forward-billing"],
        ] as const) {
          expect((await runExample("haunted-desk", by({ "Which team": { choice: team } }))).ran).toContain(leaf);
        }
        // …its confidence sends shaky calls to a human…
        expect((await runExample("haunted-desk", by({ "Which team": { choice: "billing", confidence: 0.2 } }))).ran).toContain("ask-dave");
        // …and a branch can hold more triage: a gate, then a second route, each asking Jev again.
        const r = await runExample("haunted-desk", by({ "Which team": PARANORMAL, "physical danger": { noul: 0.1 } }));
        expect(r.ran).toEqual(expect.arrayContaining(["front-desk", "paranormal-unit", "anyone-in-danger", "classify-entity"]));
        expect(r.requests).toHaveLength(3);
      },
    },
    "One question, two axes": {
      says: ["One question, two axes", "Below 0.4", "this one declines"],
      run: async () => {
        // Paranormal is the likeliest team either way; only the confidence moves.
        const shaky = await runExample("haunted-desk", by({ "Which team": { ...PARANORMAL, confidence: 0.39 } }));
        expect(shaky.ran).toContain("ask-dave");
        expect(shaky.ran).not.toContain("paranormal-unit");
        expect(shaky.trace.spans[0]!.decision!.fallback).toBe(true);
        const atBar = await runExample("haunted-desk", by({ "Which team": { ...PARANORMAL, confidence: 0.4 }, "physical danger": { noul: 0.1 } }));
        expect(atBar.ran).toContain("paranormal-unit");
        expect(atBar.ran).not.toContain("ask-dave");
      },
    },
    "alsoAsk rides along for free": {
      says: [],
      run: async () => {
        const calm = await runExample("haunted-desk", by({ "Which team": { choice: "billing" } }));
        expect(calm.requests).toHaveLength(1);
        expect(Object.keys(calm.requests[0]!.questions).sort()).toEqual(["angry", "decision", "sarcastic"]);
        // The answers land in the trace…
        const call = calm.trace.spans[0]!.calls[0]!;
        expect(call.answers.sarcastic).toMatchObject({ type: "noul" });
        expect(call.answers.angry).toMatchObject({ type: "noul" });
        // …but don't pick the branch.
        const furious = await runExample("haunted-desk", by({ "Which team": { choice: "billing" }, sarcastic: { noul: 0.99 }, angry: { noul: 0.99 } }));
        expect(furious.ran).toEqual(calm.ran);
        expect(furious.trace.spans[0]!.decision!.question).toBe("decision");
      },
    },
    "Safety is a ceiling, not a floor": {
      says: ["pass: { max: 0.5 }"],
      run: async () => {
        const at = async (p: number) => (await runExample("haunted-desk", by({ "Which team": PARANORMAL, "physical danger": { noul: p } }))).ran;
        expect(await at(0.05)).toContain("classify-entity");
        expect(await at(0.5)).toContain("classify-entity");
        expect(await at(0.51)).toContain("evacuate");
        expect(await at(0.51)).not.toContain("classify-entity");
      },
    },
    "Branches are just nodes": {
      says: [],
      run: async () => {
        const r = await runExample("haunted-desk", by({ "Which team": PARANORMAL, "physical danger": { noul: 0.1 } }));
        const kind = (id: string) => r.trace.spans.find((s) => s.nodeId === id)!.kind;
        expect([kind("paranormal-unit"), kind("anyone-in-danger"), kind("classify-entity")]).toEqual(["chain", "gate", "route"]);
        // Exhaustiveness at depth: the same chain → gate → route, with a fourth entity and no branch for it.
        chain(
          "paranormal-unit",
          gate("anyone-in-danger", {
            ask: noul("Is anyone in physical danger right now?"),
            pass: { max: 0.5 },
            then: route("classify-entity", {
              ask: choice("What is most likely going on with this appliance?", ["poltergeist", "possessed-firmware", "just-a-draft", "banshee"]),
              // @ts-expect-error no branch for "banshee"
              branches: { poltergeist: emit("a"), "possessed-firmware": emit("b"), "just-a-draft": emit("c") },
            }),
            otherwise: emit("evacuate"),
          }),
        );
      },
    },
  },

  "group-chat-drama": {
    [LESSON]: {
      says: ["a single request"],
      run: async () => {
        const r = await runExample("group-chat-drama");
        expect(r.requests).toHaveLength(1);
        expect(Object.keys(r.requests[0]!.questions)).toHaveLength(4);
      },
    },
    "Four asks, one request": {
      says: ["Four asks, one request", "All four branches ask about the same state", "answers all four", "batch: { size: 4 }"],
      run: async () => {
        const chat = input("group-chat-drama", "The brunch incident");
        const r = await runExample("group-chat-drama", () => undefined, chat);
        expect(r.requests).toHaveLength(1);
        expect(r.requests[0]!.state).toEqual(chat); // the chat goes over the wire once
        const calls = r.trace.spans.flatMap((s) => s.calls);
        expect(calls).toHaveLength(4);
        const batches = new Set(calls.map((c) => c.batch?.id));
        expect(batches.size).toBe(1);
        for (const c of calls) expect(c.batch).toMatchObject({ size: 4 });
      },
    },
    "Every question type in one fan-out": {
      says: ["in one fan-out", "two nouls"],
      run: async () => {
        const r = await runExample("group-chat-drama");
        expect(r.trace.spans.filter((s) => s.kind === "parallel").map((s) => s.nodeId)).toEqual(["read-the-room"]);
        const types = Object.values(r.requests[0]!.questions).map((q) => q.type).sort();
        expect(types).toEqual(["choice", "noul", "noul", "score"]);
      },
    },
    "The weights live in code": {
      says: [],
      run: async () => {
        const at = async (heat: number, passive: number, aboutMe: number, topic: string) =>
          (
            await runExample(
              "group-chat-drama",
              by({
                heated: { score: heat },
                "passive-aggressive": { noul: passive },
                "directed at": { noul: aboutMe },
                "mostly about": { choice: topic },
              }),
            )
          ).output as { severity: number; advice: string };
        // 0.5·(2/3) + 0.2·0.5 + 0.3·1 = 0.733…: the sum the code says, nothing from a prompt.
        expect(await at(2, 0.5, 1, "feelings")).toEqual({
          severity: 0.73,
          topic: "feelings",
          advice: "Take it to DMs. Lead with 'hey, are we good?'",
        });
        expect(await at(0, 0, 0, "nothing")).toMatchObject({ severity: 0, advice: "All good. Send a meme and carry on." });
      },
    },
    "Typed all the way down": {
      says: [],
      run: async () => {
        expectTypeOf<OutputOf<typeof groupChatDrama>["topic"]>().toEqualTypeOf<"plans" | "money" | "feelings" | "nothing">();
        const r = await runExample("group-chat-drama", by({ "mostly about": { choice: "money" } }));
        expect(r.output).toMatchObject({ topic: "money" });
      },
    },
  },

  "text-them-back": {
    [LESSON]: {
      says: [],
      run: async () => {
        const confident = await runExample("text-them-back", () => ({ confidence: 0.95 }));
        expect(confident.requests).toHaveLength(1);
        const unsure = await runExample("text-them-back", (_q, n) => ({ confidence: n === 0 ? 0.3 : 0.95 }));
        expect(unsure.requests).toHaveLength(2);
        // Each tier sees more: the second request carries strictly more state than the first.
        expect(JSON.stringify(unsure.requests[1]!.state).length).toBeGreaterThan(JSON.stringify(unsure.requests[0]!.state).length);
      },
    },
    "Same question, more context": {
      says: [],
      run: async () => {
        const text = input("text-them-back", "u up?") as { message: string };
        const r = await runExample("text-them-back", (_q, n) => ({ confidence: n === 0 ? 0.3 : 0.95 }), text);
        const [gut, full] = r.requests;
        expect(gut!.questions).toEqual(full!.questions);
        expect(gut!.state).toBe(text.message);
        expect(full!.state).toEqual(text);
      },
    },
    "Escalation runs on confidence": {
      says: ["0.7 sure", "gets away with 0.5", "one call"],
      run: async () => {
        const at = (gut: number, full = 0) => runExample("text-them-back", (_q, n) => ({ confidence: n === 0 ? gut : full }));
        const sure = await at(0.7);
        expect(sure.requests).toHaveLength(1); // a sure gut check answers in one call…
        expect(sure.output).toContain("decided by gut-check");
        expect(sure.ran).not.toContain("full-context"); // …and the second tier never runs
        expect((await at(0.69, 0.5)).output).toContain("decided by full-context");
        expect((await at(0.69, 0.49)).ran).toContain("ask-the-group-chat");
      },
    },
    "The fallback can be anything": {
      says: [],
      run: async () => {
        const r = await runExample("text-them-back", () => ({ confidence: 0.1 }));
        expect(r.trace.spans.find((s) => s.nodeId === "ask-the-group-chat")!.kind).toBe("step");
        expect(r.requests).toHaveLength(2); // both tiers asked; the fallback itself never calls Jev
        expect(r.output).toBe("Screenshot it and send it to the group chat. This is above Jev's pay grade.");
      },
    },
    "A result you can narrow": {
      says: [],
      run: async () => {
        // The narrowing itself is proved by `pnpm --filter jevchain-examples typecheck`:
        // text-them-back.ts reads r.output, r.tier and r.answer.choice on either side of the check.
        expect((await runExample("text-them-back", () => ({ confidence: 0.1 }))).output).toMatch(/^Screenshot it/);
        expect((await runExample("text-them-back", () => ({ choice: "reply", confidence: 0.9 }))).output).toBe(
          "Reply. (decided by gut-check) Keep it short, you're busy and mysterious.",
        );
      },
    },
  },

  "meeting-email": {
    [LESSON]: {
      says: [],
      run: async () => {
        const at = async (score: number) => (await runExample("meeting-email", (q) => (q.type === "score" ? { score } : undefined))).ran;
        expect(await at(3.5)).toContain("keep");
        expect(await at(1)).toContain("decline");
        expect(await at(2.5)).toContain("counter-offer");
      },
    },
    "Gating on a score": {
      says: ["Five rubric levels", "from 0 to 4", "passes at 2.5"],
      run: async () => {
        const r = await runExample("meeting-email", (q) => (q.type === "score" ? { score: 3.2 } : undefined));
        const rubric = Object.values(r.requests[0]!.questions).find((q) => q.type === "score")!;
        expect(rubric.criteria).toHaveLength(5); // levels 0–4
        const levels = rubric.criteria as string[];
        expect(levels[2]).toMatch(/doc with comments/);
        expect(levels[3]).toMatch(/short call/);
        expect(r.trace.spans[0]!.decision!.threshold).toEqual({ min: 2.5 });
        expect(r.ran).toContain("keep"); // 3.2 is between levels and still clears the bar
      },
    },
    "Close calls get their own path": {
      says: ["within 0.4 of the bar", "strictly between 2.1 and 2.9", "Exactly 0.4 away is outside"],
      run: async () => {
        const at = async (score: number) => (await runExample("meeting-email", (q) => (q.type === "score" ? { score } : undefined))).ran;
        expect(await at(2.11)).toContain("counter-offer");
        expect(await at(2.89)).toContain("counter-offer");
        // Exactly 0.4 away is outside the band.
        expect(await at(2.1)).toContain("decline");
        expect(await at(2.9)).toContain("keep");
      },
    },
    "Evidence without influence": {
      says: [],
      run: async () => {
        const at = async (agenda: number) =>
          runExample("meeting-email", (q) => (q.type === "score" ? { score: 2.3 } : { noul: agenda }));
        const [none, clear] = [await at(0), await at(1)];
        expect(none.requests).toHaveLength(1);
        expect(clear.ran).toEqual(none.ran);
        expect(clear.trace.spans[0]!.decision!.question).toBe("decision");
        expect(clear.trace.spans[0]!.calls[0]!.answers.agenda).toMatchObject({ noul: 1 });
      },
    },
    "A chain can be one node": {
      says: ["one node", "a single gate"],
      run: async () => {
        const r = await runExample("meeting-email");
        expect(r.status).toBe("ok");
        expect(r.trace.spans[0]).toMatchObject({ nodeId: "needs-a-meeting", kind: "gate", parentPath: null });
      },
    },
  },

  "pr-horoscope": {
    [LESSON]: {
      says: ["about one input", "a single call", "one call per question"],
      run: async () => {
        const r = await runExample("pr-horoscope");
        expect(r.requests).toHaveLength(1);
        expect(Object.keys(r.requests[0]!.questions)).toHaveLength(5);
      },
    },
    "Five questions, one call": {
      says: ["Five questions, one call", "three nouls", "one request", "read and billed once"],
      run: async () => {
        const pr = input("pr-horoscope", "Friday migration");
        const r = await runExample("pr-horoscope", () => undefined, pr);
        expect(r.requests).toHaveLength(1);
        expect(r.requests[0]!.state).toEqual(pr);
        const types = Object.values(r.requests[0]!.questions).map((q) => q.type).sort();
        expect(types).toEqual(["choice", "noul", "noul", "noul", "score"]);
      },
    },
    "A typed lookup table": {
      says: [],
      run: () => {
        type Scope = OutputOf<typeof prHoroscope>["scope"];
        expectTypeOf<Scope>().toEqualTypeOf<"typo" | "feature" | "refactor" | "migration">();
        // A table that's missing a label (as if one were renamed) no longer indexes by the choice.
        const partial = { typo: 0.05, feature: 0.4, refactor: 0.5 } as const;
        const scope = "migration" as Scope;
        // @ts-expect-error "migration" isn't a key of the table
        void partial[scope];
      },
    },
    "Normalize before you weigh": {
      says: ["0–3 score", "divided by 3", "0–1 nouls"],
      run: async () => {
        const at = async (clarity: number) =>
          (
            await runExample(
              "pr-horoscope",
              by({
                "clearly does the description": { score: clarity },
                "add or update tests": { noul: 1 },
                rushed: { noul: 0 },
                Friday: { noul: 0 },
                "What kind": { choice: "typo" },
              }),
            )
          ).output as { risk: number };
        const r = await runExample("pr-horoscope");
        const clarity = Object.values(r.requests[0]!.questions).find((q) => q.type === "score")!;
        expect(clarity.criteria).toHaveLength(4); // 0–3
        // Top clarity adds nothing; bottom clarity adds its full 0.2 weight, same as a noul at 1 would.
        expect((await at(3)).risk).toBe(0.02); // 0.35 · 0.05
        expect((await at(0)).risk).toBe(0.22); // 0.35 · 0.05 + 0.2
      },
    },
    "Types flow across the chain": {
      says: ["only compiles because the two fit"],
      run: () => {
        expectTypeOf<OutputOf<typeof prHoroscope>>().toEqualTypeOf<{
          risk: number;
          scope: "typo" | "feature" | "refactor" | "migration";
          sign: string;
        }>();
        // A next link that wants something else doesn't fit, so it doesn't compile.
        // @ts-expect-error risk is a number, not a string
        chain("pr-horoscope-plus", prHoroscope, step((h: { risk: string }) => h.risk));
      },
    },
  },
};

describe("every lesson and note in the gallery is proved", () => {
  for (const ex of examples) {
    const notes = [{ title: LESSON, text: `${ex.lesson}` }, ...(EXAMPLE_NOTES[ex.slug] ?? []).map((n) => ({ title: n.title, text: noteText(n.title, n.body) }))];
    for (const { title, text } of notes) {
      it(`${ex.slug}: ${title}`, async () => {
        const proof = proofs[ex.slug]?.[title];
        expect(proof, `no proof for ${ex.slug} "${title}" in examples.test.ts`).toBeDefined();
        for (const phrase of proof!.says) expect(text, `vouched phrase not in the note`).toContain(phrase);
        expect(unvouched(text, proof!.says), `numbers in ${ex.slug} "${title}" that its proof doesn't vouch for`).toEqual([]);
        await proof!.run();
      });
    }
  }

  it("has no proofs for notes that are gone", () => {
    const present = new Set(examples.flatMap((ex) => [LESSON, ...(EXAMPLE_NOTES[ex.slug] ?? []).map((n) => n.title)].map((t) => `${ex.slug}: ${t}`)));
    const proved = Object.entries(proofs).flatMap(([slug, ps]) => Object.keys(ps).map((t) => `${slug}: ${t}`));
    expect(proved.filter((k) => !present.has(k))).toEqual([]);
  });
});
