import { DocExample } from "@/components/docs/doc-example";
import { A, ApiTable, C, Callout, Cell, DocPage, H2, H3, Li, List, P, Snippet, TwoUp } from "@/components/docs/doc-ui";
import { Code } from "@/components/ui/code-block";
import { claims } from "@/docs/claims";
import { docMetadata } from "@/docs/nav";

export const metadata = docMetadata("step-and-emit");

const STEP = `import { step } from "jevchain";

// Types come from your function: StepNode<Message, User>.
const lookup = step("lookup-user", async (msg: Message) => db.users.find(msg.userId));

// Sync is fine too. Whatever you return is the node's output.
const shout = step("shout", (s: string) => s.toUpperCase());`;

const CONTEXT = `const enrich = step("enrich", async (ticket: Ticket, ctx) => {
  const triage = ctx.results["triage"];          // output of the node with id "triage"
  ctx.log("looking up customer", { id: ticket.customerId });

  // Pass the signal on, so aborts and deadlines reach your I/O.
  const res = await fetch(\`/customers/\${ticket.customerId}\`, { signal: ctx.signal });
  return { ...ticket, customer: await res.json(), triage };
});`;

const RETRIES = `const fetchWeather = step("fetch-weather", async (city: string, ctx) => {
  const res = await fetch(\`https://wttr.in/\${city}?format=j1\`, { signal: ctx.signal });
  if (!res.ok) throw new Error(\`weather service said \${res.status}\`);
  return res.json();
}, { timeoutMs: 3_000, retries: 2 });`;

const EMIT = `emit("page on-call")                         // EmitNode<string>
emit({ team: "billing", priority: 2 })       // EmitNode<{ readonly team: "billing"; readonly priority: 2 }>
emit("Booked for {{input.name}}.", { id: "book" })   // give leaves ids: they show up in traces`;

// One key per line: this sits in a narrow column.
const TPL_INPUT = JSON.stringify(claims.templateInput, null, 2)
  .replace(/\[\s+([^\]]*?)\s+\]/g, (_, xs: string) => `[${xs.replace(/\s+/g, " ")}]`)
  .replace(/\{\s+("plan": "pro")\s+\}/, "{ $1 }");

// Checked against the real runtime in claims.test.ts. A raw (non-string) value is marked as such.
const quote = (s: string) => (s.includes('"') ? `'${s}'` : `"${s}"`);
const TPL_OUT = claims.templates
  .map(({ template, output }) => {
    const shown = typeof output === "string" ? quote(output) : `${JSON.stringify(output)}   (raw value)`;
    return `${quote(template).padEnd(22)} → ${shown}`;
  })
  .join("\n");

const TPL_CHECKS = `const greet = emit("Hi {{inptu.name}}", { id: "greet" });
await jev.run(chain("welcome", greet, lookup), user);
// throws ChainConfigError, nothing sent:
//   ${claims.templateTypo}

emit("{{results.lookup}}", { id: "greet" }) // same chain, lookup hasn't run yet:
//   ${claims.templateTooEarly}`;

export default function StepAndEmitPage() {
  return (
    <DocPage slug="step-and-emit">
      <H2 id="step">step</H2>
      <P>
        <C>step(id, fn, options?)</C> is your code as a node: transform the input, call a tool, hit a database, ask an
        LLM. It gets the node&apos;s input and returns its output (sync or async), and both types are read straight off
        your function&apos;s signature. That&apos;s what lets <A href="/docs/chain">chain</A> check the whole pipeline.
      </P>
      <Snippet code={STEP} file="steps.ts" />
      <P>
        Steps don&apos;t call Jev, so they cost nothing but your own time. They appear in the trace like any other
        span, with their input, output, logs and retries.
      </P>

      <H2 id="context">StepContext</H2>
      <P>
        The second argument to every <C>step</C> function (and to <C>parallel</C> joins) is a context with everything
        the run knows:
      </P>
      <ApiTable
        caption="StepContext"
        rows={[
          { name: "runInput", type: "unknown", children: "The input the whole run started with, however deep you are." },
          {
            name: "results",
            type: "Record<string, unknown>",
            children: "Outputs of every node that has finished so far, keyed by node id. Reused ids overwrite each other.",
          },
          {
            name: "answers",
            type: "Record<string, Record<string, Answer>>",
            children: (
              <>
                Every answer Jev has returned so far, by node id then question key: an ask&apos;s questions, a route or
                gate&apos;s <code>decision</code> plus its <code>alsoAsk</code>, a cascade&apos;s rungs keyed by tier id. Filed
                the moment the call returns, so a branch can read the answer that routed it.
              </>
            ),
          },
          { name: "signal", type: "AbortSignal", children: "Aborted when the run is cancelled, times out, or this attempt times out. Pass it to fetch." },
          { name: "jev", type: "JevClient", children: <>The client running this chain, for ad-hoc <code>jev.ask(state, questions)</code> calls. They&apos;re cancelled along with the step.</> },
          { name: "log", type: "(message, data?) => void", children: "Attach a note, with optional JSON data, to this node's span in the trace." },
        ]}
      />
      <Snippet code={CONTEXT} file="enrich.ts" />

      <H2 id="retries">Retries and timeouts</H2>
      <P>
        Steps talk to the outside world, and the outside world flakes. Two options handle it:
      </P>
      <ApiTable
        caption="step(id, fn, options)"
        rows={[
          {
            name: "timeoutMs",
            type: "number",
            default: "none",
            children: (
              <>
                Limit for <em>one attempt</em>. On timeout the attempt&apos;s signal aborts and a{" "}
                <code>JevTimeoutError</code> is thrown (and retried, if you allow it).
              </>
            ),
          },
          {
            name: "retries",
            type: "number",
            default: "0",
            children: (
              <>
                Extra attempts after the first when <code>fn</code> throws. Backoff is{" "}
                <code>min(2000, 100 × 2^(attempt−1))</code> ms: 100, 200, 400… Never retried once the run is aborted.
              </>
            ),
          },
          {
            name: "ref",
            type: "string",
            default: "the id",
            children: (
              <>
                The name used to re-attach <code>fn</code> when loading from JSON. See{" "}
                <A href="/docs/serialization#from-json">fromJSON</A>.
              </>
            ),
          },
          { name: "title / description", type: "string", children: "For UIs and the graph." },
        ]}
      />
      <Snippet code={RETRIES} file="weather.ts" />
      <P>
        Every retry is recorded on the span (attempt, delay and the error), so &ldquo;why was this slow&rdquo; has an
        answer. The <A href="/docs/errors">Errors</A> page has a step that fails on purpose.
      </P>

      <H2 id="emit">emit</H2>
      <P>
        <C>emit(value, options?)</C> outputs a fixed JSON value. It&apos;s how most routes end: each branch emits a
        verdict, a team name or a canned reply. Strings are templates over the node&apos;s input.
      </P>
      <Snippet code={EMIT} file="leaves.ts" />
      <Callout tone="tip" title="name your leaves">
        <p>
          Emit ids default to <C>&quot;emit&quot;</C>. That&apos;s fine because paths, not ids, identify spans, but{" "}
          <C>{"{ id: \"book-exorcist\" }"}</C> reads much better in a trace and in <C>ctx.results</C>.
        </p>
      </Callout>

      <H2 id="templates">Templates</H2>
      <P>
        <C>emit</C> strings and every <C>state</C> option (on <C>ask</C>, <C>route</C>, <C>gate</C> and cascade tiers)
        take the same tiny template language: <C>{"{{path}}"}</C> holes. Paths are resolved against four roots:
      </P>
      <List>
        <Li>
          <C>{"{{input…}}"}</C>: the node&apos;s own input. <C>{"{{input.user.name}}"}</C>, <C>{"{{input.items.0}}"}</C>.
        </Li>
        <Li>
          <C>{"{{run…}}"}</C>: the input the whole run started with.
        </Li>
        <Li>
          <C>{"{{results.<nodeId>…}}"}</C>: the output of an earlier node.
        </Li>
        <Li>
          <C>{"{{answers.<nodeId>.<key>…}}"}</C>: an answer Jev has already given, e.g.{" "}
          <C>{"{{answers.front-desk.angry.noul}}"}</C> for a route&apos;s <A href="/docs/route#also-ask">alsoAsk</A>.
        </Li>
      </List>
      <TwoUp>
        <Cell label="given this input">
          <Code code={TPL_INPUT} className="text-[11.5px]" />
        </Cell>
        <Cell label="templates render as">
          <Code code={TPL_OUT} className="text-[11.5px]" />
        </Cell>
      </TwoUp>
      <List>
        <Li>
          A template that is <strong>exactly one hole</strong> returns the raw value, so objects and arrays survive as
          structured state.
        </Li>
        <Li>
          Holes inside text stringify objects as JSON. A value that&apos;s missing at runtime renders as an empty string
          and leaves a note in the span&apos;s <C>logs</C>: <em>{claims.templateEmptyLog}</em>.
        </Li>
        <Li>
          No expressions, no function calls, no <C>eval</C>. Just paths. Need logic? That&apos;s what <C>step</C> is for,
          and <C>state</C> also takes a function: <C>{"state: (t) => t.subject"}</C>.
        </Li>
      </List>
      <H3 id="template-checks">Checked before the run</H3>
      <P>
        Some holes can only ever come up empty: a root that doesn&apos;t exist, <C>results</C> of a node that
        hasn&apos;t finished by then (a later step, the node itself, an ancestor still running), <C>answers</C> of a
        node that hasn&apos;t asked yet, or a question key it never asks. <C>run</C>, <C>stream</C> and{" "}
        <C>fromJSON</C> reject those with a <C>ChainConfigError</C> before any call is made, naming the path, the hole
        and a guess at what you meant:
      </P>
      <Snippet code={TPL_CHECKS} file="welcome.ts" />
      <DocExample
        id="docs-name-tag"
        caption={
          <>
            A <C>step</C> splits a bio into a name, a <C>route</C> asks about the bio only (via <C>state</C>), templated{" "}
            <C>emit</C>s print the tag, and a last step logs to the trace with <C>ctx.log</C>.
          </>
        }
      />
    </DocPage>
  );
}
