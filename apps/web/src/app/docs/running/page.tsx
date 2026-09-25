import { DocExample } from "@/components/docs/doc-example";
import { A, ApiTable, C, Callout, DocPage, H2, Li, List, P, Snippet } from "@/components/docs/doc-ui";
import { docMetadata } from "@/docs/nav";

export const metadata = docMetadata("running");

const CREATE = `import { createJev } from "jevchain";

const jev = createJev({
  model: "jev-1.13.0",          // pin a version instead of jev-latest
  timeoutMs: 5_000,             // per attempt
  retry: { maxRetries: 3 },     // merged over the defaults
  maxConcurrency: 16,
  batch: { windowMs: 5 },       // wait 5ms for siblings before sending
});`;

const RUN = `const result = await jev.run(desk, "My toaster whispers my name at 3am.");

switch (result.status) {
  case "ok":
    reply(result.output);          // typed as the chain's output
    break;
  case "halted":
    log(result.trace.halted?.summary);
    break;
  case "error":
  case "aborted":
    alert(result.error.code);      // a JevChainError, never undefined here
    break;
}

save(result.trace);                 // always there, whatever happened`;

const STREAM = `const s = jev.stream(desk, ticket);

for await (const event of s) {
  if (event.type === "decision") console.log(event.path, event.decision.summary);
}

const { status, trace } = await s.result;`;

const REDUCE = `import { reduceTrace, type Trace } from "jevchain";

let trace: Trace | undefined;
for await (const event of jev.stream(desk, ticket)) {
  trace = reduceTrace(trace, event);   // pure: returns a new object, safe for React state
  render(trace);                       // partial traces are valid traces (status "running")
}`;

const CANCEL = `const controller = new AbortController();
stopButton.onclick = () => controller.abort();

const result = await jev.run(desk, ticket, {
  signal: controller.signal,  // abort → status "aborted"
  timeoutMs: 2_000,           // deadline for the whole run → status "error", code "timeout"
});`;

const STEP_SIGNAL = `step("lookup", async (ticket: Ticket, ctx) => {
  const res = await fetch(\`/api/customers/\${ticket.customerId}\`, { signal: ctx.signal });
  return res.json();
});`;

const TEST = `import { createJev, type JevClient } from "jevchain";

const fake: JevClient = {
  model: "jev-latest",
  usdPerMillionTokens: 0.042,
  async ask(state, questions) {
    return { answers: cannedAnswersFor(questions), model: "jev-1.13.0",
             usage: { inputTokens: 0, outputTokens: 0 }, costUsd: 0, latencyMs: 1, attempts: 1 };
  },
};

const jev = createJev(fake); // run() and stream() work as usual, no network`;

export default function RunningPage() {
  return (
    <DocPage slug="running">
      <H2 id="create-jev">createJev</H2>
      <P>
        <C>createJev(options)</C> makes a client with <C>run</C> and <C>stream</C> attached. Make one per process and
        share it: the concurrency limit and the batching queue live on the client.
      </P>
      <Snippet code={CREATE} file="jev.ts" />
      <ApiTable
        caption="createJev options (all optional)"
        rows={[
          { name: "apiKey", type: "string | null", default: "env", children: <>Defaults to <code>process.env.TYPESAFE_API_KEY</code> (or <code>JEV_API_KEY</code>) where there is a <code>process</code>. Pass <code>null</code> when a proxy adds the key for you.</> },
          { name: "baseURL", type: "string", default: "api.typesafe.ai", children: <>API root. In the browser, point it at your own <A href="/docs/proxy">proxy</A>.</> },
          { name: "path", type: "string", default: '"/v1/systemone"', children: <>Appended to <code>baseURL</code>. Set <code>&quot;&quot;</code> when <code>baseURL</code> is the full endpoint.</> },
          { name: "model", type: "string", default: '"jev-latest"', children: <>Default model for every call. Nodes can override it with their own <code>model</code>.</> },
          { name: "timeoutMs", type: "number", default: "10_000", children: "Per attempt, including reading the body. A timed-out attempt is retried." },
          { name: "retry", type: "Partial<RetryPolicy>", default: "see below", children: <><code>maxRetries</code> 2, <code>initialDelayMs</code> 250 (doubling), <code>maxDelayMs</code> 4000, <code>jitter</code> 0.25, <code>maxRetryAfterMs</code> 30000.</> },
          { name: "maxConcurrency", type: "number", default: "8", children: "HTTP requests in flight at once, across every run on this client." },
          { name: "batch", type: "boolean | BatchOptions", default: "true", children: <>Merge same-state asks into one request. <code>windowMs</code> (default 0: same tick) and <code>maxQuestions</code> (default 64). <code>false</code> turns it off.</> },
          { name: "usdPerMillionTokens", type: "number", default: "0.042", children: "Price used for costUsd in traces (jev-1.13 list price, input tokens; output is free)." },
          { name: "headers", type: "Record<string, string>", children: "Extra headers on every request." },
          { name: "fetch", type: "typeof fetch", default: "global fetch", children: "Bring your own: for tests, instrumentation, or adding headers per request." },
        ]}
      />
      <P>
        Retries cover timeouts, connection failures and HTTP <C>408</C>, <C>409</C>, <C>429</C>, <C>500</C>, <C>502</C>,{" "}
        <C>503</C>, <C>504</C> and <C>529</C>. On a 429 the client honours <C>retry-after</C> (or <C>retry-after-ms</C>) up to{" "}
        <C>maxRetryAfterMs</C>; otherwise it backs off exponentially with jitter. Every retry lands in the trace.
      </P>
      <Callout tone="tip" title="createJev also takes a client">
        <p>
          Anything with an <C>ask(state, questions)</C> method will do, which makes tests easy. The traces on the{" "}
          <A href="/docs/traces">Traces</A> page were made exactly this way.
        </p>
      </Callout>
      <Snippet code={TEST} file="desk.test.ts" />

      <H2 id="run">run</H2>
      <P>
        <C>jev.run(chain, input, options?)</C> runs to completion and resolves with the output and the trace. The input is
        type-checked against the chain&apos;s input type.
      </P>
      <ApiTable
        caption="run options"
        rows={[
          { name: "signal", type: "AbortSignal", children: <>Cancel the run. See <A href="#cancellation">cancellation</A>.</> },
          { name: "timeoutMs", type: "number", children: "A deadline for the whole run (separate from the per-attempt timeout)." },
          { name: "runId", type: "string", default: "random", children: <>Set your own id, e.g. a request id, so traces join up with your logs.</> },
          { name: "onEvent", type: "(event) => void", children: <>Every trace event as it happens. <C>stream</C> is built on this.</> },
          { name: "maxTraceString", type: "number", default: "4000", children: "Longest string kept in trace inputs and outputs before truncating." },
        ]}
      />

      <H2 id="statuses">Statuses</H2>
      <P>
        <C>run</C> <strong>doesn&apos;t throw</strong> for things that go wrong at runtime. Network down, key revoked, your
        step exploded: you get a result with a status and the trace up to that point. <C>RunResult</C> is a discriminated
        union, so TypeScript knows <C>output</C> only exists when <C>status</C> is <C>&quot;ok&quot;</C>.
      </P>
      <Snippet code={RUN} file="handle.ts" />
      <ApiTable
        rows={[
          { name: '"ok"', type: "{ output, trace }", children: "It finished. output is typed." },
          { name: '"halted"', type: "{ trace }", children: <>A gate without <code>otherwise</code> said no. Not a failure; <code>trace.halted</code> says where and why.</> },
          { name: '"error"', type: "{ trace, error }", children: <>Something failed. <code>error</code> is a <A href="/docs/errors">JevChainError</A>, usually a <code>NodeError</code> naming the node.</> },
          { name: '"aborted"', type: "{ trace, error }", children: <>Your <code>AbortSignal</code> fired. <code>error.code</code> is <code>&quot;aborted&quot;</code>.</> },
        ]}
      />
      <Callout tone="warn" title="the one thing it does throw">
        <p>
          An <strong>invalid chain</strong> throws <C>ChainConfigError</C> before anything runs: a route with a branch
          for a label that doesn&apos;t exist, a gate with no bar, a step without a function. That&apos;s a bug in your
          code, not a bad day at the API, so it fails loudly.
        </p>
      </Callout>

      <H2 id="stream">Streaming</H2>
      <P>
        <C>jev.stream(chain, input, options?)</C> starts the same run and hands you its events as an async iterable.{" "}
        <C>s.result</C> resolves to the same <C>RunResult</C> <C>run</C> would have returned. Break out of the loop and
        the run is <A href="#cancellation">aborted</A>; a stream nobody iterates just runs to the end.
      </P>
      <Snippet code={STREAM} file="stream.ts" />
      <ApiTable
        caption="TraceEvent types, in the order you'll see them"
        rows={[
          { name: "run:start", type: "runId, chainId, startedAt, input", children: "Exactly once, first." },
          { name: "span:start", type: "at, span", children: "A node started. The span has its path, parent, edge, id, kind and input." },
          { name: "jev:call", type: "path, call", children: "A Jev call came back, with its full answers, tokens, cost and latency." },
          { name: "retry", type: "path, retry", children: "A Jev call or a step attempt failed and will be retried." },
          { name: "log", type: "path, log", children: <>Your step called <code>ctx.log</code>.</> },
          { name: "decision", type: "path, decision", children: "A route, gate or cascade chose an edge." },
          { name: "span:end", type: "at, path, status, output?, error?", children: "A node finished." },
          { name: "run:end", type: "trace", children: "Exactly once, last, carrying the final trace." },
        ]}
      />
      <P>
        To keep a live view, fold events with <C>reduceTrace</C>. The runtime builds its own trace with this same function,
        so what you render mid-run and the trace you store at the end can&apos;t disagree. <C>traceFromEvents(events)</C>{" "}
        does the whole fold at once, handy for replaying a recorded event log.
      </P>
      <Snippet code={REDUCE} file="live.ts" />
      <DocExample
        id="haunted-desk"
        caption={
          <>
            Run it in the studio and watch the events arrive: <C>span:start</C> on the front desk, a <C>jev:call</C>, a{" "}
            <C>decision</C>, and on down the branch it picked.
          </>
        }
      />

      <H2 id="cancellation">Cancellation and deadlines</H2>
      <P>Two ways to stop a run early, and they report differently:</P>
      <Snippet code={CANCEL} file="cancel.ts" />
      <List>
        <Li>
          <strong>Your signal</strong> aborts in-flight requests, sleeps between retries and queued batches, and the run
          ends with status <C>&quot;aborted&quot;</C>.
        </Li>
        <Li>
          <strong>The run deadline</strong> (<C>timeoutMs</C> on <C>run</C>) cancels the same way, but the reason is a{" "}
          <C>JevTimeoutError</C>, so the status is <C>&quot;error&quot;</C> with <C>error.code === &quot;timeout&quot;</C>.
          You asked for an answer by a time; not getting one is a failure.
        </Li>
        <Li>
          Either way, spans still running are closed with status <C>error</C> and that same reason as their error
          (code <C>aborted</C> or <C>timeout</C>), and the partial trace comes back as usual.
        </Li>
        <Li>
          Stopping means stopping: calls still queued for a concurrency slot are never sent, a retry backoff wakes up
          and quits, and nothing new starts.
        </Li>
        <Li>
          Leaving a <A href="#stream">stream</A>&apos;s <C>for await</C> loop early (<C>break</C>, <C>return</C>, a
          throw) aborts the run the same way. <C>s.result</C> resolves with status <C>&quot;aborted&quot;</C>.
        </Li>
      </List>
      <P>
        A failure inside a <C>parallel</C> cancels its sibling branches too; they close with a <C>cancelled</C> error
        whose cause is the real failure (see <A href="/docs/parallel#failures">parallel</A>). Your own code gets the
        signal as <C>ctx.signal</C>; pass it along to anything that can be cancelled. Calls a step makes through{" "}
        <C>ctx.jev</C> are cancelled with it already:
      </P>
      <Snippet code={STEP_SIGNAL} file="lookup.ts" />
    </DocPage>
  );
}
