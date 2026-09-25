import { DocExample } from "@/components/docs/doc-example";
import { A, ApiTable, C, Callout, DocPage, H2, H3, Li, List, P, Snippet } from "@/components/docs/doc-ui";
import { docMetadata } from "@/docs/nav";

export const metadata = docMetadata("parallel");

const BASICS = `import { parallel, ask, choice, noul } from "jevchain";

const vibes = parallel("vibes", {
  branches: {
    tone: ask("tone", { questions: { tone: choice("Tone?", ["warm", "cold", "unhinged"]) } }),
    spam: ask("spam", { questions: { spam: noul("Is this spam?") } }),
  },
});

// OutputOf<typeof vibes>:
// {
//   tone: { tone: ChoiceAnswer<"warm" | "cold" | "unhinged"> };
//   spam: { spam: NoulAnswer };
// }`;

const JOIN = `const vibes = parallel("vibes", {
  branches: { tone, spam },
  // results is typed from the branches. May be async; gets the input and a StepContext.
  join: async (results, input, ctx) => {
    ctx.log("joined", { spam: results.spam.spam.noul });
    return results.spam.spam.noul > 0.8 ? "block" : results.tone.tone.choice;
  },
});
// OutputOf<typeof vibes>: "block" | "warm" | "cold" | "unhinged"`;

const BATCH_TRACE = `// trace.spans[…].calls[0], for each of the three tribunal asks
"batch": { "id": "batch_1", "size": 3, "questions": 3 }

// trace.usage
{ "calls": 3, "requests": 1, "inputTokens": 212, "outputTokens": 3, "costUsd": 0.0000089 }`;

const NO_BATCH = `// Off for a whole client…
const jev = createJev({ batch: false });

// …tuned…
const jev = createJev({ batch: { windowMs: 5, maxQuestions: 32 } });

// …or off for one direct call.
await jev.ask(state, questions, { batch: false });`;

export default function ParallelPage() {
  return (
    <DocPage slug="parallel">
      <H2 id="basics">Basics</H2>
      <P>
        <C>parallel(id, {"{ branches, join? }"})</C> hands the same input to every branch at once and waits for all of
        them. Branches are any nodes: asks, routes, whole chains. Without a <C>join</C>, the output is an object keyed
        exactly like <C>branches</C>, each value typed as that branch&apos;s output.
      </P>
      <Snippet code={BASICS} file="vibes.ts" />
      <P>
        Every branch has to accept the parallel&apos;s input, so its input type is the intersection of what the branches
        want. Pass a string to a parallel whose branches expect <C>{"{ messages }"}</C> and the compiler says so.
      </P>

      <H2 id="join">Joining results</H2>
      <P>
        Give it a <C>join</C> to turn the pile of answers into one value. It runs after every branch finishes, receives
        the typed results, the original input and a <A href="/docs/step-and-emit#context">StepContext</A>, and its
        (awaited) return value becomes the parallel&apos;s output.
      </P>
      <Snippet code={JOIN} file="vibes.ts" />
      <ApiTable
        caption="parallel(id, config)"
        rows={[
          { name: "branches", type: "Record<string, Node>", children: "Run concurrently, all with the parallel's input." },
          {
            name: "join",
            type: "(results, input, ctx) => R | Promise<R>",
            default: "none",
            children: (
              <>
                Combine the results. Omit it and the output is <code>{"{ [branch]: output }"}</code>. Serialized as a{" "}
                <code>$ref</code>.
              </>
            ),
          },
          { name: "title / description", type: "string", children: "For UIs and the graph." },
        ]}
      />
      <Callout tone="tip" title="Jev judges, your code decides">
        <p>
          Weights, thresholds and tie-breaks belong in <C>join</C> (or a <C>step</C> after it), where they&apos;re plain
          functions you can unit test. Asking Jev to also do the arithmetic is how you get a chatbot.
        </p>
      </Callout>
      <DocExample
        id="docs-sandwich-tribunal"
        caption={
          <>
            Three rulings on one food, joined into a verdict. All three asks read the same input, so they ride in a
            single HTTP request. Try the hot dog.
          </>
        }
      />

      <H2 id="batching">Automatic batching</H2>
      <P>
        Jev ingests the state once and answers every question about it in parallel, so three questions in one request
        is strictly cheaper and faster than three requests. The client exploits that for you: asks with the{" "}
        <strong>same model</strong> and the <strong>same state</strong> that are issued in the <strong>same tick</strong>{" "}
        are merged into one request. States are compared with a key-order-stable stringify, so{" "}
        <C>{"{ a, b }"}</C> and <C>{"{ b, a }"}</C> batch together.
      </P>
      <P>
        Branches of a <C>parallel</C> all start synchronously, so any branch whose first move is a Jev call joins the
        batch. You don&apos;t configure anything; it&apos;s on by default.
      </P>
      <H3 id="batching-in-the-trace">In the trace</H3>
      <P>
        Each merged call carries a <C>batch</C> record. <C>usage.requests</C> counts a merged request once, and the
        request&apos;s tokens are split evenly across the calls that shared it, so per-node cost still adds up.
      </P>
      <Snippet code={BATCH_TRACE} file="trace.json" />
      <H3 id="batching-options">Tuning it</H3>
      <ApiTable
        caption="createJev({ batch })"
        rows={[
          { name: "batch", type: "boolean | BatchOptions", default: "true", children: <>Pass <code>false</code> to send every ask on its own.</> },
          {
            name: "windowMs",
            type: "number",
            default: "0",
            children: "How long to wait for siblings before sending. 0 means the same microtask tick.",
          },
          {
            name: "maxQuestions",
            type: "number",
            default: "64",
            children: "Most questions merged into one request; bigger batches are split into chunks.",
          },
        ]}
      />
      <Snippet code={NO_BATCH} file="client.ts" />
      <DocExample
        id="group-chat-drama"
        caption={
          <>
            Four reads of the same group chat (heat, passive aggression, is it about me, topic) in one request, then a
            weighted severity score computed in plain code.
          </>
        }
      />

      <H2 id="failures">When a branch fails</H2>
      <P>
        Siblings share an <C>AbortController</C>. The first branch to fail aborts the rest, and the whole parallel fails
        with that first error. The rest are cancelled, not left running in the background.
      </P>
      <List>
        <Li>
          The run ends with <C>status: &quot;error&quot;</C>, and <C>error</C> is a <C>NodeError</C> pointing at the
          innermost failing node (see <A href="/docs/errors">Errors</A>).
        </Li>
        <Li>
          Spans that were still running are closed in the trace with a <C>cancelled</C> error, so you can see what got
          cut off.
        </Li>
        <Li>
          A branch that <em>halts</em> (a <C>gate</C> with no <C>otherwise</C>) halts the whole run too. If you&apos;d
          rather it didn&apos;t, give that gate an <C>otherwise</C>.
        </Li>
      </List>
      <Callout tone="warn" title="parallel is all-or-nothing">
        <p>
          Want best effort instead? Put the flaky work in a <C>step</C> that catches its own errors and returns a
          fallback value. The parallel only sees a failure if something throws.
        </p>
      </Callout>
    </DocPage>
  );
}
