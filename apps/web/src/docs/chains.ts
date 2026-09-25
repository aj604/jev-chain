/**
 * Small, single-idea chains used by the docs, built with the real framework.
 *
 * Each concept page pairs with one of these (or a gallery example) via
 * <DocExample id="…" />. The code between `#region` markers is what the docs
 * show, read from this very file at build time, so the snippet on the page is
 * always the code that typechecks here.
 *
 * The registry at the bottom mirrors the gallery's `Example` shape
 * (`{ id, title, tagline, chain, inputs }`), so the studio can load these too:
 * `/studio?example=<id>`.
 */
import {
  ask,
  chain,
  choice,
  emit,
  gate,
  noul,
  parallel,
  route,
  score,
  step,
  type AnyNode,
  type Json,
  type OutputOf,
} from "jevchain";

// #region plant-check
const plantCheck = ask("plant-check", {
  title: "Plant wellness check",
  questions: {
    // choice: pick one label. The labels become a literal union type.
    mood: choice("How is this houseplant doing?", {
      thriving: "new leaves, upright, smug",
      thirsty: "drooping, crispy edges, dry soil",
      dramatic: "fine, but making a scene about it",
    }),
    // score: an ordered rubric, lowest first. You get a probability-weighted level.
    drama: score("How dramatic is this plant being?", [
      "stoic",
      "sighing",
      "wilting theatrically",
      "writing its will",
    ]),
    // noul: yes or no. You get p(yes).
    overwatered: noul("Has this plant been overwatered?"),
  },
});
// #endregion plant-check

// #region fridge
const fridge = route("fridge-verdict", {
  title: "What do we do with this leftover?",
  ask: choice("What should happen to this leftover?", {
    eat: "still good, and honestly it'll be better today",
    freeze: "fine now, but won't survive the week",
    bin: "past saving: fuzzy, sour, or of unknown origin",
  }),
  // Jev's confidence is a second axis: under 0.45, don't guess.
  lowConfidence: { below: 0.45, then: emit("Smell it. Report back.", { id: "smell-test" }) },
  branches: {
    eat: emit("Eat the {{input.item}}. Tonight. No notes.", { id: "eat" }),
    freeze: emit("Freeze the {{input.item}}. Future you says thanks.", { id: "freeze" }),
    bin: emit("Bin the {{input.item}}. Do not open the lid first.", { id: "bin" }),
  },
});
// #endregion fridge

// #region bouncer
const bouncer = gate("dress-code", {
  title: "Rooftop bar dress code",
  ask: noul("Is this outfit appropriate for a fancy rooftop bar?", {
    true: "smart, deliberate, dressed for the occasion",
    false: "gym clothes, pyjamas, or a costume",
  }),
  pass: { min: 0.6 },
  then: emit("Welcome in. The view is on the left.", { id: "welcome" }),
  // Close calls get a human, not a coin flip.
  unsure: { margin: 0.1, then: emit("Wait here. The manager is coming.", { id: "get-manager" }) },
  // No `otherwise`: a failed gate halts the run. Nothing after it executes.
});
// #endregion bouncer

// #region tribunal
const tribunal = parallel("sandwich-tribunal", {
  title: "The Sandwich Tribunal",
  branches: {
    taxonomy: ask("taxonomy", {
      questions: {
        is: choice("Structurally, what is this food?", {
          sandwich: "filling between two separate pieces of bread",
          taco: "filling in a single folded carrier",
          "soup-with-extra-steps": "mostly liquid, bread is a formality",
        }),
      },
    }),
    crime: ask("crime", { questions: { crime: noul("Would a reasonable chef call this a crime?") } }),
    structure: ask("structure", {
      questions: {
        holds: score("Will it survive being eaten with one hand?", ["collapses", "wobbles", "holds", "load-bearing"]),
      },
    }),
  },
  // Same state for all three asks → the client sends ONE request.
  join: (r) => ({
    ruling: r.taxonomy.is.choice,
    guilty: r.crime.crime.noul > 0.5,
    oneHanded: r.structure.holds.score >= 2,
  }),
});
// #endregion tribunal

// #region name-tag
// step: your code. Input and output types flow from the function signature.
const normalize = step("normalize", (raw: string) => ({
  name: raw.trim().split(/\s+/)[0] ?? "friend",
  bio: raw.trim(),
}));

const greet = route("greeting", {
  ask: choice("What energy does this person bring?", ["chaotic", "calm"]),
  state: "{{input.bio}}", // ask about the bio only, not the whole object
  branches: {
    // emit: a constant, or a template over the node's input.
    chaotic: emit("HELLO MY NAME IS {{input.name}} 🎉"),
    calm: emit("hello, my name is {{input.name}}."),
  },
});

const print = step("print", (tag: string, ctx) => {
  ctx.log("printed a name tag", { chars: tag.length });
  return { tag, original: ctx.runInput as string };
});

const nameTag = chain("name-tag-printer", normalize, greet, print);
// #endregion name-tag

// #region excuses
const rateExcuse = ask("rate-excuse", {
  questions: {
    plausible: score("How plausible is this excuse for missing standup?", [
      "my dog ate my laptop",
      "suspicious",
      "plausible",
      "airtight",
    ]),
    blamesSomeone: noul("Does the excuse blame a coworker?"),
  },
});

// OutputOf pulls a node's output type out, so the next step is fully typed.
type Rating = OutputOf<typeof rateExcuse>;

const verdict = step("verdict", (r: Rating) =>
  r.blamesSomeone.noul > 0.5
    ? "Excuse rejected. We don't throw Dave under the bus."
    : r.plausible.score >= 2
      ? "Excused. See you tomorrow."
      : "Noted. Your camera will be on next time.",
);

// A chain is a node, so chains nest inside chains.
const evaluate = chain("evaluate", rateExcuse, verdict);
const excuses = chain(
  "excuse-evaluator",
  step("clean", (s: string) => s.trim()),
  evaluate,
);
// #endregion excuses

// #region oracle
const consult = step(
  "consult-oracle",
  (question: string, ctx) => {
    // Flaky on purpose: fails about half the time. `retries` absorbs it,
    // and every retry is recorded in the trace.
    if (Math.random() < 0.5) throw new Error("the oracle is napping");
    ctx.log("the oracle stirs");
    return `You asked "${question}". The oracle says: it is certain, eventually.`;
  },
  { retries: 3, timeoutMs: 2_000 },
);

const oracle = chain(
  "flaky-oracle",
  consult,
  gate("good-news", {
    ask: noul("Is this prophecy good news?"),
    pass: { min: 0.5 },
    then: emit("🎉 {{input}}"),
    otherwise: emit("🌧 {{input}}"),
  }),
);
// #endregion oracle

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export interface DocChain {
  /** Stable id, also the studio deep-link key: `/studio?example=<id>`. Always prefixed `docs-`. */
  id: string;
  title: string;
  tagline: string;
  /** The docs page it illustrates, e.g. "/docs/route". */
  page: string;
  /** `#region` name in this file (for showing its source). */
  region: string;
  chain: AnyNode;
  /** Sample inputs; the first is the default. Same shape as gallery examples. */
  inputs: { label: string; value: Json }[];
}

export const docChains: DocChain[] = [
  {
    id: "docs-plant-check",
    title: "Plant wellness check",
    tagline: "All three question types, one call, zero watering advice.",
    page: "/docs/questions",
    region: "plant-check",
    chain: plantCheck,
    inputs: [
      { label: "Fiddle leaf fig", value: "Dropped three leaves overnight. Soil is soggy. Pot has no drainage hole." },
      { label: "Pothos", value: "New leaf every week, vines to the floor, absolutely unbothered." },
      { label: "Peace lily", value: "Collapsed completely at 4pm. Watered it. Fully upright again by 6pm." },
    ],
  },
  {
    id: "docs-fridge",
    title: "Fridge verdict",
    tagline: "Eat, freeze or bin, with a smell test when Jev isn't sure.",
    page: "/docs/route",
    region: "fridge",
    chain: fridge,
    inputs: [
      { label: "Day-old curry", value: { item: "curry", age: "1 day", notes: "covered, smells amazing" } },
      { label: "Mystery tub", value: { item: "mystery tub", age: "unknown", notes: "the lid is bulging slightly" } },
      { label: "Half a lasagna", value: { item: "lasagna", age: "3 days", notes: "fine, but I'm away all next week" } },
    ],
  },
  {
    id: "docs-bouncer",
    title: "Rooftop bouncer",
    tagline: "A gate with an unsure band, and no `otherwise`: fail it and the run halts.",
    page: "/docs/gate",
    region: "bouncer",
    chain: bouncer,
    inputs: [
      { label: "Linen suit", value: "Navy linen suit, white shirt, loafers, no socks." },
      { label: "Gym fit", value: "Running shorts, a sweat-soaked marathon shirt, one AirPod." },
      { label: "Smart-ish", value: "Dark jeans, a nice blazer, and very clean sneakers." },
    ],
  },
  {
    id: "docs-sandwich-tribunal",
    title: "The Sandwich Tribunal",
    tagline: "Three rulings in parallel, batched into one request, joined in code.",
    page: "/docs/parallel",
    region: "tribunal",
    chain: tribunal,
    inputs: [
      { label: "Hot dog", value: "A grilled sausage in a single hinged bun with mustard and onions." },
      { label: "Soup in a bread bowl", value: "Clam chowder served inside a hollowed-out sourdough loaf." },
      { label: "Club sandwich", value: "Three slices of toast, turkey, bacon, lettuce, tomato, held with toothpicks." },
    ],
  },
  {
    id: "docs-name-tag",
    title: "Name tag printer",
    tagline: "Steps shape the data, emit templates the leaves, ctx.log leaves notes.",
    page: "/docs/step-and-emit",
    region: "name-tag",
    chain: nameTag,
    inputs: [
      { label: "Chaotic", value: "Mo — brought a karaoke machine to the offsite, unprompted" },
      { label: "Calm", value: "Harriet. Enjoys long walks and well-labelled spreadsheets." },
    ],
  },
  {
    id: "docs-excuse-evaluator",
    title: "Excuse evaluator",
    tagline: "Chains in chains, with OutputOf carrying the types across.",
    page: "/docs/chain",
    region: "excuses",
    chain: excuses,
    inputs: [
      { label: "Dentist", value: "Sorry, I had a dentist appointment I forgot to put in the calendar." },
      { label: "Blame Dave", value: "Dave told me standup was cancelled. Dave is a liar." },
      { label: "The dog", value: "My dog ate my laptop. Both are recovering." },
    ],
  },
  {
    id: "docs-flaky-oracle",
    title: "The flaky oracle",
    tagline: "A step that fails half the time, retried until it doesn't.",
    page: "/docs/errors",
    region: "oracle",
    chain: oracle,
    inputs: [
      { label: "Will it ship?", value: "Will the release ship on Friday?" },
      { label: "Lunch", value: "Will there be leftover pizza in the kitchen?" },
    ],
  },
];

export function getDocChain(id: string): DocChain | undefined {
  return docChains.find((c) => c.id === id);
}

/** The file the regions above live in, repo-relative (for source reads and GitHub links). */
export const DOC_CHAINS_FILE = "apps/web/src/docs/chains.ts";
