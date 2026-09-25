import { DocExample } from "@/components/docs/doc-example";
import { A, ApiTable, C, Callout, DocPage, H2, H3, Li, List, P, Snippet } from "@/components/docs/doc-ui";
import { Code } from "@/components/ui/code-block";
import { docMetadata } from "@/docs/nav";

export const metadata = docMetadata("ask");

const BASIC = `import { ask, choice, noul, score } from "jevchain";

const read = ask("read-the-pr", {
  title: "Read the PR",
  questions: {
    clarity: score("How clearly does the description explain the change?", [
      "no description", "vague", "clear", "exemplary",
    ]),
    tests: noul("Does the PR add or update tests?"),
    scope: choice("What kind of change is this?", ["typo", "feature", "refactor", "migration"]),
  },
});`;

const OUTPUT = `{
  "clarity": { "type": "score", "score": 1.9, "probabilities": { "0": 0.02, "1": 0.2, "2": 0.64, "3": 0.14 },
               "legend": { "0": "no description", ... }, "confidence": 0.31 },
  "tests":   { "type": "noul", "noul": 0.93 },
  "scope":   { "type": "choice", "choice": "feature",
               "probabilities": { "typo": 0.01, "feature": 0.88, "refactor": 0.08, "migration": 0.03 },
               "confidence": 0.62 }
}`;

const STATE = `// 1. omitted: the node's input, as-is (strings stay strings, objects go as JSON)
ask("a", { questions });

// 2. a template: one hole keeps the raw value, so objects stay structured
ask("b", { questions, state: "{{input.messages}}" });

// 2b. text with holes: values are stringified into the text
ask("c", { questions, state: "From {{input.user}}: {{input.text}}" });

// 3. a function: full control (serialized as a $ref)
ask("d", { questions, state: (pr: PullRequest) => ({ title: pr.title, body: pr.body }) });`;

const TYPED = `import { chain, step, type OutputOf } from "jevchain";

type Read = OutputOf<typeof read>;

const verdict = step("verdict", (a: Read) =>
  a.scope.choice === "migration" && a.tests.noul < 0.5
    ? "no tests on a migration. bold."
    : \`clarity \${a.clarity.score.toFixed(1)} / 3\`,
);

export const review = chain("review", read, verdict);`;

export default function AskPage() {
  return (
    <DocPage slug="ask">
      <H2 id="one-call">One call, many questions</H2>
      <P>
        <C>ask</C> sends its questions about the node&apos;s input to Jev in one request and outputs the answers,
        keyed like the questions. Jev reads the state once and answers every question in parallel, so five questions
        cost roughly what one does. Ask for everything you need up front.
      </P>
      <Snippet code={BASIC} file="read.ts" />
      <P>The output is a plain object of answers, one per key:</P>
      <Code code={OUTPUT} className="my-4 overflow-x-auto border-soft bg-surface px-4 py-3" />
      <ApiTable
        caption="ask(id, config)"
        rows={[
          { name: "id", type: "string", children: <>Names the node in traces and graphs. Needn&apos;t be unique.</> },
          {
            name: "questions",
            type: "Questions",
            children: (
              <>
                Named questions from <code>choice</code>, <code>score</code> and <code>noul</code>. At least one.
              </>
            ),
          },
          {
            name: "state",
            type: "string | (input) => Entry",
            default: "the input",
            children: <>What Jev reads. See below.</>,
          },
          {
            name: "model",
            type: "string",
            default: "client's model",
            children: (
              <>
                Pin this node to a model, e.g. <code>&quot;jev-1.13.0&quot;</code>.
              </>
            ),
          },
          { name: "title / description", type: "string", children: <>Labels for UIs and traces.</> },
        ]}
      />

      <H2 id="state">Choosing the state</H2>
      <P>
        By default Jev sees the node&apos;s input. Often you want it to see less (just the message, not the metadata),
        or something reshaped. <C>state</C> takes one of three forms:
      </P>
      <Snippet code={STATE} file="state.ts" />
      <List>
        <Li>
          Templates are paths only: <C>{"{{input.user.name}}"}</C>, <C>{"{{input.items.0}}"}</C>. No expressions, no{" "}
          <C>eval</C>. Besides <C>input</C> you can reach <C>run</C> (the run&apos;s original input) and{" "}
          <C>results</C> (finished nodes&apos; outputs, by id).
        </Li>
        <Li>
          Whatever you end up with is coerced into something Jev accepts: <C>null</C> and <C>undefined</C> become{" "}
          <C>null</C>, numbers and booleans become strings, objects are made JSON-safe.
        </Li>
      </List>
      <Callout tone="tip" title="state is also the batching key">
        <p>
          Asks with the same state and model, issued in the same tick, are merged into one request (see{" "}
          <A href="/docs/parallel#batching">parallel</A>). Keys are sorted before comparing, so{" "}
          <C>{"{ a, b }"}</C> and <C>{"{ b, a }"}</C> batch together.
        </p>
      </Callout>

      <H2 id="typed-output">Typed output</H2>
      <P>
        The output type is <C>Answers&lt;Q&gt;</C>: each key maps to the answer type of its question, and choice labels
        stay literal unions. Pull it out with <C>OutputOf</C> and the next step is checked end to end.
      </P>
      <Snippet code={TYPED} file="review.ts" />
      <P>
        Rename a label in the <C>choice</C> and the comparison in <C>verdict</C> stops compiling. That&apos;s the idea.
      </P>
      <DocExample
        id="pr-horoscope"
        caption={
          <>
            Five questions about one PR in a single <C>ask</C>, then a <C>step</C> that weighs them into a risk number.{" "}
            <C>a.scope.choice</C> indexes a lookup table by label, and the compiler knows every label exists.
          </>
        }
      />

      <H2 id="when">When to reach for it</H2>
      <P>
        <C>ask</C> is for when you want the <em>numbers</em>, not a branch. Rule of thumb:
      </P>
      <List>
        <Li>
          <strong>You&apos;ll combine several answers in code</strong> (weights, lookup tables, a formula): use{" "}
          <C>ask</C> and a <A href="/docs/step-and-emit">step</A>.
        </Li>
        <Li>
          <strong>One choice picks what happens next:</strong> use <A href="/docs/route">route</A>. It asks and branches
          in one node, and the trace records the decision.
        </Li>
        <Li>
          <strong>One number has to clear a bar:</strong> use <A href="/docs/gate">gate</A>.
        </Li>
        <Li>
          <strong>Independent reads that each deserve their own node</strong> (or their own state): several asks under
          a <A href="/docs/parallel">parallel</A>. Same state still means one request.
        </Li>
      </List>
      <H3 id="ask-vs-also-ask">ask vs. alsoAsk</H3>
      <P>
        Routes and gates take <C>alsoAsk</C>: extra questions that ride in the same call and are recorded in the trace
        but don&apos;t affect the branch. Use it for &ldquo;I&apos;ll want to know this later&rdquo; signals like
        sentiment. When you need to <em>use</em> the answers downstream, use an <C>ask</C>.
      </P>
      <DocExample
        id="group-chat-drama"
        caption={
          <>
            Four single-question asks under a <C>parallel</C>, all over the same chat. Same state, same tick: the client
            sends one request.
          </>
        }
      />
    </DocPage>
  );
}
