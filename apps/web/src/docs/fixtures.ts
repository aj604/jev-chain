/**
 * Real traces for the docs, produced by the real runtime against a scripted
 * Jev client (no network, no key). The chain, the runtime, the decisions and
 * their summaries are all genuine; only the probabilities are hand-picked.
 *
 * Runs once per build and is memoized, so every page shares the same traces.
 */
import { createJev, type Answer, type AskResult, type Entry, type JevClient, type Questions, type Trace } from "jevchain";
import { getExample } from "jevchain-examples";

const hauntedDesk = getExample("haunted-desk")!.chain;

type Script = Record<string, number | Record<string, number>>;

/**
 * Answers keyed by question *instructions* (substring match). A number is a
 * noul's p(yes) or a score's level distribution peak; an object is a
 * distribution over labels / levels.
 */
function answerFor(question: Questions[string], script: Script): Answer {
  const text = typeof question.instructions === "string" ? question.instructions : "";
  const hit = Object.entries(script).find(([k]) => text.includes(k))?.[1];
  switch (question.type) {
    case "noul":
      return { type: "noul", noul: typeof hit === "number" ? hit : 0.5 };
    case "choice": {
      const labels = Object.keys(question.criteria);
      const probs = typeof hit === "object" ? hit : Object.fromEntries(labels.map((l) => [l, 1 / labels.length]));
      return choiceAnswer(probs);
    }
    case "score": {
      const n = question.criteria.length;
      const probs = typeof hit === "object" ? hit : Object.fromEntries(Array.from({ length: n }, (_, i) => [String(i), 1 / n]));
      const score = Object.entries(probs).reduce((s, [k, p]) => s + Number(k) * p, 0);
      return {
        type: "score",
        score: round(score),
        probabilities: probs,
        legend: Object.fromEntries(question.criteria.map((c, i) => [String(i), c])),
        confidence: confidence(Object.values(probs)),
      };
    }
  }
}

function choiceAnswer(probs: Record<string, number>): Answer {
  const [choice] = Object.entries(probs).sort((a, b) => b[1] - a[1])[0]!;
  return { type: "choice", choice, probabilities: probs, confidence: confidence(Object.values(probs)) };
}

/** 1 − normalized entropy: 0 for uniform, 1 for all-in. */
function confidence(ps: number[]): number {
  const h = -ps.reduce((s, p) => (p > 0 ? s + p * Math.log(p) : s), 0);
  return round(1 - h / Math.log(ps.length));
}

const round = (v: number) => Math.round(v * 1000) / 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A JevClient that answers from a script, with believable latency and usage. */
export function scriptedClient(script: Script, latencies: number[] = [38, 41, 29, 33]): JevClient {
  let n = 0;
  return {
    model: "jev-latest",
    usdPerMillionTokens: 0.042,
    async ask<const Q extends Questions>(state: Entry, questions: Q): Promise<AskResult<Q>> {
      const i = n++;
      const latencyMs = latencies[i % latencies.length]!;
      await sleep(latencyMs);
      const answers = Object.fromEntries(Object.entries(questions).map(([k, q]) => [k, answerFor(q, script)]));
      const inputTokens = Math.round(JSON.stringify(state).length / 4 + JSON.stringify(questions).length / 4);
      return {
        answers: answers as AskResult<Q>["answers"],
        model: "jev-1.13.0",
        usage: { inputTokens, outputTokens: Object.keys(questions).length },
        costUsd: (inputTokens / 1_000_000) * 0.042,
        latencyMs,
        attempts: 1,
        requestId: `req_${(0x5e1f00 + i * 7919).toString(16)}`,
      };
    },
  };
}

const TOASTER = "My toaster whispers my name at 3am and the bread comes out cold.";
const MICROWAVE = "The microwave opened by itself, said 'soon', and now there is smoke coming out of it.";

const DESK: Script = {
  "Which team": { repair: 0.02, billing: 0.004, paranormal: 0.976 },
  "joking or being sarcastic": 0.08,
  "customer angry": 0.11,
  "What is most likely going on": { poltergeist: 0.18, "possessed-firmware": 0.74, "just-a-draft": 0.08 },
};

export interface DocTraces {
  toaster: Trace;
  microwave: Trace;
}

let cached: Promise<DocTraces> | undefined;

/** Two haunted-desk runs that share a path and then diverge at the safety gate. */
export function docTraces(): Promise<DocTraces> {
  cached ??= (async () => {
    const a = await createJev(scriptedClient({ ...DESK, "physical danger": 0.04 })).run(hauntedDesk, TOASTER, {
      runId: "run_7f3a9c21e04b5d18",
    });
    const b = await createJev(scriptedClient({ ...DESK, "physical danger": 0.83 })).run(hauntedDesk, MICROWAVE, {
      runId: "run_c01dfee7b0a7d00d",
    });
    return { toaster: a.trace, microwave: b.trace };
  })();
  return cached;
}

export const FIXTURE_INPUTS = { toaster: TOASTER, microwave: MICROWAVE };
