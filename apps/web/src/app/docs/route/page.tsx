import { DocExample } from "@/components/docs/doc-example";
import { A, ApiTable, C, Callout, CompileError, DocPage, H2, Li, List, P, Snippet } from "@/components/docs/doc-ui";
import { Code } from "@/components/ui/code-block";
import { docMetadata } from "@/docs/nav";

export const metadata = docMetadata("route");

const BASIC = `import { route, choice, emit } from "jevchain";

const triage = route("triage", {
  ask: choice("What is this message about?", {
    billing: "money, invoices, refunds",
    bug: "something is broken",
    vibes: "no actionable content, just vibes",
  }),
  branches: {
    billing: toBilling,
    bug: toOnCall,
    vibes: emit("reply with a gif"),
  },
});
// JevNode<string, OutputOf<typeof toBilling> | OutputOf<typeof toOnCall> | string>`;

const MISSING = `const triage = route("triage", {
  ask: choice("What is this?", ["billing", "bug", "vibes"]),
  branches: {
    billing: toBilling, bug: toOnCall,
  },
});`;

const MISSING_ERR = `error TS2322: Type '{ billing: …; bug: …; }' is not assignable to type 'NoExtraKeys<RouteBranches<"billing" | "bug" | "vibes">, …>'.
  Property 'vibes' is missing in type '{ billing: …; bug: …; }' but required in type 'RouteBranches<"billing" | "bug" | "vibes">'.`;

const RUNTIME_ISSUES = `$ (route "triage"): no branch for "vibes"
$ (route "triage"): branches "refunds" aren't options of the question`;

const LOW = `route("front-desk", {
  ask: choice("Which team should handle this ticket?", ["repair", "billing", "paranormal"]),
  lowConfidence: { below: 0.4, then: emit("A human will read this. Probably Dave.") },
  branches: { repair, billing, paranormal },
});`;

const DECISION = `{
  "kind": "route",
  "question": "decision",
  "taken": "paranormal",
  "edges": [
    { "edge": "repair",        "value": 0.02,  "taken": false },
    { "edge": "billing",       "value": 0.004, "taken": false },
    { "edge": "paranormal",    "value": 0.976, "taken": true  },
    { "edge": "lowConfidence", "value": 0.887, "taken": false }
  ],
  "metric": "probability",
  "value": 0.976,
  "confidence": 0.887,
  "summary": "Went to \\"paranormal\\" with 98%, a landslide over \\"repair\\" at 2% (confidence 0.89)."
}`;

const ALSO = `route("front-desk", {
  ask: choice("Which team should handle this ticket?", ["repair", "billing", "paranormal"]),
  alsoAsk: {
    sarcastic: noul("Is the customer joking or being sarcastic?"),
    angry: noul("Is the customer angry?"),
  },
  branches: { repair, billing, paranormal },
});`;

export default function RoutePage() {
  return (
    <DocPage slug="route">
      <H2 id="basics">Basics</H2>
      <P>
        <C>route</C> asks one <C>choice</C> question about its input, then runs the branch for whichever label won. The
        branch gets the route&apos;s <em>input</em>, not the answer: routes decide where data goes, they don&apos;t
        change it. The route&apos;s output is whatever the chosen branch outputs, so its type is the union of the
        branch outputs.
      </P>
      <Snippet code={BASIC} file="triage.ts" />
      <ApiTable
        caption="route(id, config)"
        rows={[
          {
            name: "ask",
            type: "ChoiceQuestion<L>",
            children: <>The deciding question. Must be a choice.</>,
          },
          {
            name: "branches",
            type: "{ [K in L]: JevNode }",
            children: <>One node per label. No more, no fewer.</>,
          },
          {
            name: "lowConfidence",
            type: "{ below, then }",
            children: (
              <>
                Take <code>then</code> instead when the answer&apos;s confidence is under <code>below</code> (0–1).
              </>
            ),
          },
          {
            name: "alsoAsk",
            type: "Questions",
            children: <>Extra questions in the same call, recorded in the trace.</>,
          },
          { name: "state", type: "string | (input) => Entry", default: "the input", children: <>What Jev reads. Same as <A href="/docs/ask#state">ask</A>.</> },
          { name: "model", type: "string", default: "client's model", children: <>Pin this node to a model.</> },
        ]}
      />
      <DocExample
        id="docs-fridge"
        caption={
          <>
            Three leaves that template the input with <C>{"{{input.item}}"}</C>, plus a smell test for when Jev
            isn&apos;t sure. The mystery tub usually takes that path.
          </>
        }
      />

      <H2 id="exhaustive">Exhaustive at compile time</H2>
      <P>
        The labels of the choice become a type, and <C>branches</C> must have exactly those keys. Add a fourth label
        and forget its branch, and <C>tsc</C> tells you before production does:
      </P>
      <CompileError code={MISSING} line={3} error={MISSING_ERR} file="triage.ts" />
      <P>
        Extra keys are errors too: a branch for a label the question doesn&apos;t offer can never be taken, so
        it&apos;s rejected rather than silently dead.
      </P>
      <Callout tone="note" title="chains from JSON get the same checks">
        <p>
          A chain loaded with <A href="/docs/serialization#from-json">fromJSON</A> never met the type checker, so{" "}
          <C>chainIssues</C> runs the same checks at runtime. <C>run</C> and <C>fromJSON</C> both throw a{" "}
          <C>ChainConfigError</C> listing every problem before any call is made:
        </p>
        <Code code={RUNTIME_ISSUES} className="mt-2 text-[12px] whitespace-pre-wrap" />
      </Callout>

      <H2 id="low-confidence">Low confidence</H2>
      <P>
        A choice always has a winner, even when the distribution is nearly flat. <C>lowConfidence</C> uses the
        answer&apos;s <C>confidence</C> as a second axis: if it&apos;s under <C>below</C>, the route takes{" "}
        <C>lowConfidence.then</C> instead of guessing.
      </P>
      <Snippet code={LOW} file="front-desk.ts" />
      <P>
        Either way the trace records what happened. Every label appears as an edge with its probability, taken or
        not, alongside a templated, human-readable <C>summary</C>:
      </P>
      <Code code={DECISION} className="my-4 overflow-x-auto border-soft bg-surface px-4 py-3" />
      <P>When the fallback wins, the decision is flagged and the summary says what it would have picked:</P>
      <List>
        <Li>
          <em>
            Jev leaned &ldquo;repair&rdquo; but only at 0.31 confidence, under the 0.40 bar, so it took the
            low-confidence path instead of guessing.
          </em>
        </Li>
      </List>
      <P>
        In the graph, this edge is labelled <C>unsure</C>. In the decision, its key is <C>lowConfidence</C> and its{" "}
        <C>value</C> is the confidence.
      </P>

      <H2 id="also-ask">alsoAsk</H2>
      <P>
        Sometimes you&apos;re already paying for a call and want to know something else about the same input for later:
        sentiment, language, whether the customer is joking. <C>alsoAsk</C> adds questions to the route&apos;s request.
        Their answers land in the call recorded in the trace, but they don&apos;t influence the branch and aren&apos;t
        part of the output.
      </P>
      <Snippet code={ALSO} file="front-desk.ts" />
      <Callout tone="warn" title="“decision” is reserved">
        <p>
          The deciding question is sent under the key <C>decision</C>, so an <C>alsoAsk</C> key with that name is a{" "}
          <C>ChainConfigError</C>.
        </p>
      </Callout>

      <H2 id="nesting">Nesting</H2>
      <P>
        A branch is any node: an <C>emit</C>, a <C>step</C>, a <C>gate</C>, another <C>route</C>, a whole{" "}
        <A href="/docs/chain">chain</A>. That&apos;s how multi-step triage is built. Pick the department, then let the
        department decide. Each nested node records its own span and decision, at a path like{" "}
        <C>$/paranormal/0/then</C>.
      </P>
      <DocExample
        id="haunted-desk"
        caption={
          <>
            The <C>paranormal</C> branch is a chain holding a safety <C>gate</C>, whose <C>then</C> is a second{" "}
            <C>route</C>. Three decisions deep, and never more than three calls on any one path.
          </>
        }
      />
    </DocPage>
  );
}
