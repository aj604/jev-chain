/**
 * What the code samples on the site lean on.
 *
 * `samples.test.ts` compiles every TypeScript sample the landing page and the
 * docs pages show, exactly as printed. Most are excerpts: they use a chain the
 * page built a paragraph earlier, or a stand-in for your own code (`toBilling`,
 * `db`, `jev`). Declare those here, keyed by the page's route and the constant
 * that holds the sample (the file name, for an inline string), and nothing
 * else: whatever a sample uses that isn't here or in jevchain is a failure.
 *
 * A sample with no import from "jevchain" is an excerpt and gets every export
 * in scope. One that does import from "jevchain" is a whole file, so its
 * imports have to be enough for someone who copies it.
 */
import { toJSON, toTypeScript } from "jevchain";
import { getDocChain } from "./chains";

export interface SampleContext {
  /** Declarations in scope for the sample: what the page takes as given. jevchain's exports are in scope here. */
  given?: string;
  /** The sample picks up where this one (a constant on the same page) left off. */
  continues?: string;
  /** The page shows this TypeScript in a block with no file name (a bare `<Code>`); compile it all the same. */
  bare?: true;
  /** The sample is the inside of an async function (it `return`s). */
  body?: true;
  /** The sample is copied from this file under packages/jevchain/src, and must still appear there verbatim. */
  quotes?: string;
  /** The page generates this sample at build time; produce the same code here. */
  generated?: () => string;
}

// Stand-ins that several pages share.
const JEV = "declare const jev: Jev;";
const DESK = `${JEV}\ndeclare const desk: JevNode<string, string>;\ndeclare const ticket: string;`;
const nodes = (...names: string[]) => names.map((n) => `declare const ${n}: JevNode<string, string>;`).join("\n");

// The landing page's feature cards all talk about its `triage` route.
const TRIAGE = `const team = choice("What is this message about?", ["billing", "bug", "vibes"]);
declare const billing: JevNode<string, string>;
declare const bug: JevNode<string, string>;
declare const triage: JevNode<string, string>;`;

export const SAMPLES: Record<string, SampleContext> = {
  "/ typed answers": { given: TRIAGE },
  "/ exhaustive routing": { given: TRIAGE },
  "/ streaming traces": {
    given: `${TRIAGE}\n${JEV}\ndeclare const msg: string;\ndeclare function draw(event: TraceEvent): void;`,
  },
  "/ parallel + batching": {
    given: `const tone = ask("tone", { questions: { tone: choice("Tone?", ["warm", "cold"]) } });
const topic = ask("topic", { questions: { topic: choice("Topic?", ["billing", "bug"]) } });
const urgency = ask("urgency", { questions: { urgent: noul("Is the user blocked?") } });`,
  },
  "/ serializable chains": { given: TRIAGE },

  "/docs/ask STATE": {
    given: `declare const questions: Questions;\ninterface PullRequest { title: string; body: string }`,
  },
  "/docs/ask TYPED": { continues: "BASIC" },

  "/docs/cascade FALLBACK_LLM": {
    given: `declare const isRefundable: NoulQuestion;
interface Ticket { id: string; text: string }
declare const llm: { complete(req: { prompt: string; signal: AbortSignal }): Promise<string> };
declare function render(ticket: Ticket): string;`,
  },
  "/docs/cascade RESULT_TYPE": { quotes: "nodes.ts" },
  "/docs/cascade RESULT": { continues: "BASICS" },

  "/docs/chain TYPES": { continues: "SEQUENCE" },
  "/docs/chain NESTING": {
    given: `declare const clean: JevNode<string, string>;
declare const read: JevNode<string, { rude: NoulAnswer }>;
declare const decide: JevNode<{ rude: NoulAnswer }, "hide" | "show">;
declare const format: JevNode<"hide" | "show", string>;
declare const supportFlow: JevNode<string, string>;`,
  },
  "/docs/chain DESCRIBE": {
    given: `declare const clean: JevNode<string, string>;\ndeclare const read: JevNode<string, { rude: NoulAnswer }>;`,
  },

  "/docs/errors CATCH_ALL": { given: `${JEV}\ndeclare const state: string;\ndeclare const questions: Questions;` },
  "/docs/errors CONFIG": {
    given: `${JEV}\ndeclare const doc: ChainDocument;\ndeclare const handlers: Record<string, Handler>;\ndeclare const input: Json;`,
  },
  "/docs/errors HANDLE": {
    body: true,
    given: `${DESK}
declare function askUserForANewKey(): void;
declare function retryLater(ms: number): void;
declare function fallBackToAHuman(): void;
declare function log(...args: unknown[]): void;`,
  },

  "/docs/gate BASIC": { given: nodes("pageOnCall") },
  "/docs/gate THRESHOLDS": { given: nodes("carryOn", "keepIt", "toBilling", "eat") },
  "/docs/gate UNSURE": { given: nodes("welcome", "turnAway", "getManager", "reply", "askAHuman") },
  "/docs/gate HALTED": { given: `${JEV}\ndeclare const bouncer: JevNode<string, string>;` },

  "/docs/parallel JOIN": {
    given: `const tone = ask("tone", { questions: { tone: choice("Tone?", ["warm", "cold", "unhinged"]) } });
const spam = ask("spam", { questions: { spam: noul("Is this spam?") } });`,
  },
  "/docs/parallel NO_BATCH": { given: `${JEV}\ndeclare const state: string;\ndeclare const questions: Questions;` },

  "/docs/questions NOUL": { bare: true },

  "/docs/route BASIC": { given: nodes("toBilling", "toOnCall") },
  "/docs/route MISSING": { given: nodes("toBilling", "toOnCall") },
  "/docs/route LOW": { given: nodes("repair", "billing", "paranormal") },
  "/docs/route ALSO": { given: nodes("paranormal") },

  "/docs/running TEST": { given: "declare function cannedAnswersFor<Q extends Questions>(questions: Q): Answers<Q>;" },
  "/docs/running RUN": {
    given: `${DESK}
declare function reply(text: string): void;
declare function log(...args: unknown[]): void;
declare function save(trace: Trace): void;`,
  },
  "/docs/running STREAM": { given: DESK },
  "/docs/running REDUCE": { given: `${DESK}\ndeclare function render(trace: Trace): void;` },
  "/docs/running CANCEL": { given: `${DESK}\ndeclare const stopButton: HTMLButtonElement;` },
  "/docs/running STEP_SIGNAL": { given: "interface Ticket { customerId: string }" },

  "/docs/serialization save.ts": { given: "declare const fridge: AnyNode;" },
  "/docs/serialization LOAD": { given: `${JEV}\ndeclare const doc: ChainDocument;` },
  "/docs/serialization PREVIEW": { given: "declare const doc: ChainDocument;" },
  "/docs/serialization fridgeTs": {
    generated: () => toTypeScript(toJSON(getDocChain("docs-fridge")!.chain, { name: "Fridge verdict" })),
  },
  "/docs/serialization nameTagTs": { generated: () => toTypeScript(toJSON(getDocChain("docs-name-tag")!.chain)) },

  "/docs/step-and-emit STEP": {
    given: `interface Message { userId: string }
interface User { id: string; name: string }
declare const db: { users: { find(id: string): Promise<User> } };`,
  },
  "/docs/step-and-emit CONTEXT": { given: "interface Ticket { customerId: string }" },
  "/docs/step-and-emit TPL_CHECKS": {
    given: `${JEV}\ndeclare const lookup: JevNode<string, unknown>;\ndeclare const user: { name: string };`,
  },

  "/docs/traces explain.ts": { given: "declare const trace: Trace;" },
  "/docs/traces diff.ts": { given: "declare const toaster: Trace;\ndeclare const microwave: Trace;" },
  "/docs/traces draw.ts": { given: "declare const hauntedDesk: AnyNode;\ndeclare const trace: Trace;" },
};
