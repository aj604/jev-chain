import { DocExample } from "@/components/docs/doc-example";
import { A, C, Callout, Cell, DocPage, H2, Li, List, P, Shell, Snippet, Step, Steps, TwoUp } from "@/components/docs/doc-ui";
import { Code } from "@/components/ui/code-block";
import { docMetadata } from "@/docs/nav";

export const metadata = docMetadata("");

const FIRST_CHAIN = `import { createJev, route, choice, emit } from "jevchain";

const triage = route("triage", {
  ask: choice("What is this message about?", {
    billing: "money, invoices, refunds",
    bug: "something is broken",
    vibes: "no actionable content, just vibes",
  }),
  branches: {
    billing: emit("→ billing"),
    bug: emit("→ on-call"),
    vibes: emit("reply with a gif"),
  },
});

const jev = createJev(); // reads TYPESAFE_API_KEY
const result = await jev.run(triage, "i was charged twice, please help");

if (result.status === "ok") console.log(result.output); // → billing
console.log(result.trace.spans[0]?.decision?.summary);
// Went to "billing" with 94%, a landslide over "bug" at 5% (confidence 0.81).`;

const WIRE = `POST https://api.typesafe.ai/v1/systemone
{
  "model": "jev-latest",
  "state": "i was charged twice, please help",
  "questions": {
    "team": { "type": "choice", "criteria": { "billing": null, "bug": null, "vibes": null } },
    "urgent": { "type": "noul", "instructions": "Is the user blocked right now?" }
  }
}`;

const ANSWER = `{
  "team":   { "type": "choice", "choice": "billing",
              "probabilities": { "billing": 0.94, "bug": 0.05, "vibes": 0.01 },
              "confidence": 0.81 },
  "urgent": { "type": "noul", "noul": 0.22 }
}`;

export default function DocsIntroduction() {
  return (
    <DocPage slug="">
      <H2 id="what-is-jev">What Jev is</H2>
      <P>
        Jev is TypeSafe&apos;s classification model. It doesn&apos;t write prose. You send it some <strong>state</strong>{" "}
        (text, or JSON) and a set of typed <strong>questions</strong>, and it answers every question at once with a
        calibrated probability distribution, usually in tens to low hundreds of milliseconds.
      </P>
      <TwoUp>
        <Cell label="you send">
          <Code code={WIRE} className="text-[11.5px]" />
        </Cell>
        <Cell label="jev answers">
          <Code code={ANSWER} className="text-[11.5px]" />
        </Cell>
      </TwoUp>
      <List>
        <Li>
          <strong>One endpoint:</strong> <C>POST https://api.typesafe.ai/v1/systemone</C>, bearer-token auth.
        </Li>
        <Li>
          <strong>Three question types:</strong> <C>choice</C> (pick a label), <C>score</C> (rate on an ordered rubric) and{" "}
          <C>noul</C> (yes or no, as p(yes)). See <A href="/docs/questions">Questions</A>.
        </Li>
        <Li>
          <strong>Cheap:</strong> jev-1.13 lists at <strong>$0.042 per million input tokens</strong>. Output tokens are
          free, because the output is a handful of numbers.
        </Li>
      </List>

      <H2 id="what-jevchain-adds">What JevChain adds</H2>
      <P>
        One Jev call answers questions. Real decisions are several of them in a row, with your code in between.
        JevChain is the small, typed layer that composes those calls into a graph and writes down everything that
        happened.
      </P>
      <List>
        <Li>
          <strong>Typed composition.</strong> <C>route</C>, <C>gate</C>, <C>parallel</C>, <C>cascade</C>, <C>step</C>,{" "}
          <C>chain</C>. Choice labels come back as literal unions, a route with a missing branch doesn&apos;t compile,
          and <C>chain(a, b)</C> only compiles when <C>a</C>&apos;s output fits <C>b</C>&apos;s input.
        </Li>
        <Li>
          <strong>Traces.</strong> Every run leaves plain JSON: each call&apos;s state, questions and full distributions,
          every decision with the branches it didn&apos;t take, tokens, cost, latency, retries. Stream it live, diff two
          runs, draw it.
        </Li>
        <Li>
          <strong>Batching.</strong> Asks against the same state issued in the same tick are merged into one HTTP request.
          Jev reads the state once and answers everything, so fanning out is nearly free.
        </Li>
        <Li>
          <strong>No dependencies.</strong> TypeScript and <C>fetch</C>. Retries, timeouts, concurrency limits and
          cancellation are built in.
        </Li>
      </List>

      <H2 id="quickstart">Thirty-second quickstart</H2>
      <Steps>
        <Step n={1} title="install it">
          <Shell cmd="pnpm add jevchain" />
        </Step>
        <Step n={2} title="give it a key">
          <Shell cmd="export TYPESAFE_API_KEY=..." />
          <P className="text-[14px]">
            <C>createJev()</C> reads <C>TYPESAFE_API_KEY</C> by default. In a browser, don&apos;t ship the key; point the
            client at a proxy instead (see <A href="/docs/proxy">Proxy &amp; BYOK</A>).
          </P>
        </Step>
        <Step n={3} title="write a chain">
          <Snippet code={FIRST_CHAIN} file="triage.ts" />
        </Step>
        <Step n={4} title="run it" last>
          <Shell cmd="pnpm pkg set type=module" />
          <Shell cmd="node triage.ts" />
          <P className="text-[14px]">
            The chain awaits at the top level, so it has to run as an ES module, which is what{" "}
            <C>&quot;type&quot;: &quot;module&quot;</C> says. Node 22.18 and later run a <C>.ts</C> file as-is; on older
            Node, <C>npx tsx triage.ts</C> does the same. Given the answer at the top of this page, it prints the two
            lines in the comments.
          </P>
        </Step>
      </Steps>

      <H2 id="mental-model">The mental model</H2>
      <Callout tone="jev" title="chains are graphs of decisions">
        <p>
          <strong>Data flows through unchanged; decisions pick the path.</strong> A route or gate asks Jev about its
          input, then hands that <em>same</em> input to whichever branch won. Only <C>ask</C>, <C>step</C>,{" "}
          <C>parallel</C>, <C>cascade</C> and <C>emit</C> produce new values.
        </p>
      </Callout>
      <P>
        So a chain reads like a flowchart where every diamond is a question with a number attached. Because the
        structure is plain data, the same definition drives the runtime, the trace, the JSON format and the diagrams on
        this site. Here&apos;s a complete one: a support desk for haunted appliances, with a nested safety gate and a
        low-confidence escape hatch.
      </P>
      <DocExample
        id="haunted-desk"
        caption={
          <>
            One <C>route</C> picks the team; its confidence decides whether to trust that pick at all. The paranormal branch
            nests a <C>gate</C> and a second <C>route</C>. Pink-marked nodes are the ones that call Jev.
          </>
        }
      />

      <H2 id="where-next">Where next</H2>
      <List>
        <Li>
          <A href="/docs/questions">Questions</A>: the three types and what their answers look like.
        </Li>
        <Li>
          <A href="/docs/route">route</A> and <A href="/docs/gate">gate</A>: the two decisions you&apos;ll use most.
        </Li>
        <Li>
          <A href="/docs/traces">Traces</A>: what a run leaves behind, and how to read it.
        </Li>
        <Li>
          <A href="/examples">The gallery</A>: five silly chains, each teaching one serious pattern.
        </Li>
      </List>
    </DocPage>
  );
}
