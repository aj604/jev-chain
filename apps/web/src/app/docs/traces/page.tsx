import { diffTraces, explainTrace, graphOf, overlayTrace, TRACE_VERSION, type Trace } from "jevchain";
import { getExample } from "jevchain-examples";
import { ChainMap, ChainMapLegend } from "@/components/chain-map/chain-map";
import { AnnotatedCode } from "@/components/docs/annotated-code";
import { DocExample } from "@/components/docs/doc-example";
import { A, ApiTable, C, Callout, DocPage, H2, Li, List, P, Snippet } from "@/components/docs/doc-ui";
import { Code } from "@/components/ui/code-block";
import { docTraces, FIXTURE_INPUTS } from "@/docs/fixtures";
import { docMetadata } from "@/docs/nav";
import { compactJson } from "@/lib/compact-json";

export const metadata = docMetadata("traces");

const hauntedDesk = getExample("haunted-desk")!.chain;

const clip = (s: string, n = 34) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** The top level of a trace, with the spans folded away. */
function traceHeader(t: Trace) {
  const { spans, ...rest } = t;
  return compactJson({ ...rest, spans: `[ …${spans.length} spans ]` });
}

/** The root route span, with the long strings trimmed so the shape shows. */
function spanExcerpt(t: Trace) {
  const s = t.spans[0]!;
  const call = s.calls[0]!;
  const questions = Object.fromEntries(
    Object.entries(call.questions).map(([k, q]) => [
      k,
      q.type === "choice"
        ? { type: q.type, instructions: clip(String(q.instructions)), criteria: Object.fromEntries(Object.keys(q.criteria).map((l) => [l, "…"])) }
        : { type: q.type, instructions: clip(String(q.instructions)) },
    ]),
  );
  return compactJson({
    path: s.path,
    nodeId: s.nodeId,
    kind: s.kind,
    status: s.status,
    start: s.start,
    end: s.end,
    input: clip(String(s.input)),
    calls: [{ ...call, state: clip(String(call.state)), questions }],
    decision: s.decision,
    output: clip(String(s.output)),
  });
}

export default async function TracesPage() {
  const { toaster, microwave } = await docTraces();
  const graph = graphOf(hauntedDesk);
  const diff = diffTraces(toaster, microwave);

  return (
    <DocPage slug="traces">
      <P>
        Everything on this page was produced by the real runtime: the <A href="/examples/haunted-desk">haunted desk</A>{" "}
        chain, run twice against a scripted Jev client at build time. The probabilities are hand-picked; the spans,
        decisions, summaries and diffs are exactly what <C>jev.run</C> returns.
      </P>

      <H2 id="anatomy">Anatomy of a trace</H2>
      <P>
        A trace is plain, versioned JSON. Save it, ship it to your logs, render it, diff it. Here&apos;s the top of the
        toaster run: <C>{FIXTURE_INPUTS.toaster}</C>
      </P>
      <AnnotatedCode
        file="trace.json"
        code={traceHeader(toaster)}
        notes={[
          {
            match: '"version"',
            note: (
              <>
                <code>TRACE_VERSION</code>, currently <code>{TRACE_VERSION}</code>. Bumped if the shape ever changes, so stored
                traces stay readable.
              </>
            ),
          },
          {
            match: '"startedAt"',
            note: (
              <>
                The only wall-clock time in the trace. Every other time (span <code>start</code>/<code>end</code>, call{" "}
                <code>start</code>/<code>end</code>, log <code>at</code>) is <strong>milliseconds since this moment</strong>,
                so traces are easy to lay on a timeline.
              </>
            ),
          },
          {
            match: '"usage"',
            note: (
              <>
                Totals for the run. <code>calls</code> counts every Jev call a node made; <code>requests</code> counts HTTP
                requests. They differ when <A href="/docs/parallel#batching">batching</A> merged several calls into one
                request.
              </>
            ),
          },
          {
            match: '"spans"',
            note: (
              <>
                One span per node visited, in start order. Nodes that never ran have no span. That absence is how you
                know a branch wasn&apos;t taken.
              </>
            ),
          },
        ]}
      />
      <ApiTable
        caption="Trace"
        rows={[
          { name: "runId, chainId", type: "string", children: <>The run&apos;s id (pass <code>runId</code> to set it) and the root node&apos;s id.</> },
          { name: "status", type: "RunStatus", children: <><code>&quot;running&quot;</code> while streaming, then <code>ok</code>, <code>halted</code>, <code>error</code> or <code>aborted</code>.</> },
          { name: "input, output", type: "Json", children: <>JSON-safe copies. Strings over <code>maxTraceString</code> (default 4000) are truncated; <code>output</code> is only set when status is <code>ok</code>.</> },
          { name: "durationMs", type: "number", children: "Wall time of the whole run." },
          { name: "usage", type: "TraceUsage", children: <><code>calls</code>, <code>requests</code>, <code>inputTokens</code>, <code>outputTokens</code>, <code>costUsd</code>.</> },
          { name: "models", type: "string[]", children: <>Versioned models that actually answered, e.g. <code>jev-1.13.0</code>.</> },
          { name: "error", type: "SerializedError?", children: <>Set when status is <code>error</code> or <code>aborted</code>. See <A href="/docs/errors">Errors</A>.</> },
          { name: "halted", type: "{ path, nodeId, summary }?", children: <>Set when a gate with no <code>otherwise</code> stopped the run.</> },
        ]}
      />
      <ApiTable
        caption="Span"
        rows={[
          { name: "path", type: "string", children: <>Unique within the run: the edges from the root, e.g. <code>$/paranormal/0/then</code>. Ids are for humans and may repeat; paths never do.</> },
          { name: "parentPath, edge", type: "string | null", children: "Where it hangs in the tree, and the edge (a route label, then/otherwise, a step index…) that led here." },
          { name: "nodeId, kind, title", type: "string", children: "What ran." },
          { name: "status", type: "SpanStatus", children: <><code>running</code>, <code>ok</code>, <code>halted</code> or <code>error</code>.</> },
          { name: "start, end", type: "number", children: "Ms offsets from startedAt." },
          { name: "input, output", type: "Json", children: "What went in and what came out." },
          { name: "calls", type: "JevCall[]", children: "Every Jev call this node made: state, questions, answers, tokens, cost, latency, attempts, request id, batch info, and the tier for cascades." },
          { name: "decision", type: "Decision?", children: "For route, gate and cascade spans. See below." },
          { name: "retries, logs, error", type: "…", children: <>Retries of Jev calls and step code, notes from <code>ctx.log</code>, and what went wrong.</> },
        ]}
      />
      <DocExample
        id="haunted-desk"
        code={false}
        caption={
          <>
            The chain these traces came from. Run it in the studio and you&apos;ll get the same shape, only with real
            probabilities.
          </>
        }
      />

      <H2 id="decisions">Decisions</H2>
      <P>
        Route, gate and cascade spans carry a <C>decision</C>: the edge taken, <strong>every</strong> candidate edge with
        the number that decided it, the bar it was measured against, and one sentence explaining why. Here&apos;s the
        root span of the toaster run, trimmed a little:
      </P>
      <AnnotatedCode
        file="trace.spans[0]"
        code={spanExcerpt(toaster)}
        notes={[
          { match: '"path"', note: <>The root is always <code>$</code>. Children append their edge: this route&apos;s paranormal branch runs at <code>$/paranormal</code>.</> },
          {
            match: '"questions"',
            note: (
              <>
                The route&apos;s own question goes out under the reserved key <code>decision</code>. Its{" "}
                <code>alsoAsk</code> questions (<code>sarcastic</code>, <code>angry</code>) rode along in the same call, for
                free.
              </>
            ),
          },
          { match: '"answers"', note: "Full distributions, not just the winner. This is what makes a trace worth keeping." },
          { match: '"costUsd"', note: <>Input tokens × the client&apos;s price ($0.042 per million by default). When a request is batched, usage is split evenly across the calls that shared it.</> },
          {
            match: '"edges"',
            note: (
              <>
                Every way out of this node, taken or not, with its deciding number. <code>lowConfidence</code> scores the
                confidence (0.89), which cleared the 0.4 bar, so Jev&apos;s pick stood.
              </>
            ),
          },
          { match: '"summary"', note: <>Templated from the numbers by <code>explainDecision</code>. No LLM was harmed in the making of this sentence.</> },
        ]}
      />
      <ApiTable
        caption="Decision"
        rows={[
          { name: "kind", type: '"route" | "gate" | "cascade"', children: "Which kind of node decided." },
          { name: "taken", type: "string", children: <>The edge taken: a label, <code>then</code>/<code>otherwise</code>/<code>unsure</code>/<code>halt</code>, <code>lowConfidence</code>, a tier id or <code>fallback</code>.</> },
          { name: "edges", type: "EdgeScore[]", children: <><code>{"{ edge, value, taken }"}</code> for every candidate. Cascade tiers that never ran have <code>value: null</code>.</> },
          { name: "metric, value", type: "Metric, number", children: <>What was measured (<code>probability</code>, <code>noul</code>, <code>score</code> or <code>confidence</code>) and its value for the taken edge.</> },
          { name: "threshold", type: "{ min?, max?, label? }", children: "The bar, for gates and cascades." },
          { name: "confidence", type: "number?", children: <>Jev&apos;s confidence in the answer. Noul gates only record it when their <code>unsure</code> has a <code>minConfidence</code>.</> },
          { name: "fallback", type: "boolean?", children: <>True when a route&apos;s <code>lowConfidence</code> path overrode the obvious answer.</> },
          { name: "lowConfidence", type: "{ below }?", children: <>Routes: the <code>lowConfidence.below</code> bar, recorded whether or not it fired.</> },
          { name: "unsure", type: "{ margin?, minConfidence? }?", children: <>Gates: the <code>unsure</code> triggers, recorded whether or not they fired. The margin is measured from the bar&apos;s nearest edge.</> },
          { name: "tierBars", type: "Record<string, number>?", children: <>Cascades: each tier&apos;s <code>minConfidence</code>, by tier id.</> },
          { name: "summary", type: "string", children: "One plain-English sentence." },
        ]}
      />

      <H2 id="explain">explainTrace</H2>
      <P>
        <C>explainTrace(trace)</C> returns a short story of the run: one line per decision, plus how it ended (halted,
        failed or aborted). Good for logs, Slack alerts and the bottom of a support ticket.
      </P>
      <Snippet code={`import { explainTrace } from "jevchain";\n\nexplainTrace(trace).forEach((line) => console.log(line));`} file="explain.ts" />
      <div className="my-6 border-hard bg-ink p-4 text-paper">
        <div className="mb-2 font-mono text-[11px] lowercase opacity-60">stdout · the toaster run</div>
        <ol className="space-y-1.5 font-mono text-[12.5px] leading-relaxed">
          {explainTrace(toaster).map((line) => (
            <li key={line} className="flex gap-2">
              <span aria-hidden className="text-accent">›</span>
              <span>{line}</span>
            </li>
          ))}
        </ol>
      </div>
      <P>
        The wording scales with the margin: a lead of 0.6 or more is &ldquo;a landslide&rdquo;, then &ldquo;a comfortable
        win&rdquo;, &ldquo;a clear lead&rdquo;, &ldquo;a narrow lead&rdquo;, and under 0.05 &ldquo;a photo finish&rdquo;
        (<C>marginWord</C>). Gates say how far a value cleared or missed its bar.
      </P>

      <H2 id="diff">diffTraces</H2>
      <P>
        Same chain, two inputs, different endings. <C>diffTraces(a, b)</C> compares the paths they visited and names the
        first decision where they split. The microwave run (<C>{FIXTURE_INPUTS.microwave}</C>) got through the front desk
        the same way, then failed the safety gate:
      </P>
      <Snippet code={`import { diffTraces } from "jevchain";\n\nconst diff = diffTraces(toaster, microwave);`} file="diff.ts" />
      <div className="my-6 border-hard bg-surface">
        <div className="border-hard-b bg-paper px-4 py-2 font-mono text-[11px] lowercase text-ink-3">result</div>
        <Code code={compactJson(diff, 64)} className="px-4 py-4" />
      </div>
      <P>
        Use it to explain a regression (&ldquo;why did yesterday&apos;s ticket go to billing?&rdquo;), or in tests: pin a
        golden trace and assert that <C>divergedAt</C> is undefined.
      </P>

      <H2 id="graph">graphOf and overlayTrace</H2>
      <P>
        A chain is a tree, but it runs like a graph: routes fan out, parallels fork and join, cascades climb a ladder.{" "}
        <C>graphOf(chain)</C> compiles it into vertices and edges, adding the synthetic ones you&apos;d want to draw:{" "}
        <C>tier</C> vertices for each cascade rung, a <C>join</C> after every parallel, and a <C>halt</C> for gates with
        no <C>otherwise</C>. Every edge that a decision picks carries <C>decidedBy</C>, pointing at the span and edge key
        that chose it.
      </P>
      <P>
        <C>overlayTrace(graph, trace)</C> paints a run onto it: each vertex gets a state (<C>idle</C>, <C>running</C>,{" "}
        <C>ok</C>, <C>error</C>, <C>halted</C>, <C>skipped</C>) and each edge is <C>taken</C> or <C>not-taken</C> with its
        deciding number. It accepts partial traces, which is how the studio animates a run as events stream in. The two
        runs from above, drawn by this site&apos;s own map component:
      </P>
      <Snippet
        code={`import { graphOf, overlayTrace } from "jevchain";

const graph = graphOf(hauntedDesk);           // { vertices, edges, entry }
const overlay = overlayTrace(graph, trace);    // { vertices: {id → state}, edges: {id → state, value} }`}
        file="draw.ts"
      />
      {[
        { label: "toaster · possessed firmware", trace: toaster },
        { label: "microwave · evacuate", trace: microwave },
      ].map(({ label, trace }) => (
        <figure key={label} className="my-6 border-hard">
          <figcaption className="flex items-center justify-between border-hard-b bg-paper px-4 py-2 font-mono text-[11px] lowercase text-ink-3">
            <span>{label}</span>
            <span className="tabular-nums">
              {trace.usage.calls} calls · {Math.round(trace.durationMs ?? 0)}ms
            </span>
          </figcaption>
          <div className="bg-grid overflow-x-auto bg-paper px-4 py-6">
            <div className="mx-auto flex min-w-[36rem] justify-center">
              <ChainMap chain={hauntedDesk} detail="full" overlay={overlayTrace(graph, trace)} label={`haunted desk, ${label}`} />
            </div>
          </div>
        </figure>
      ))}
      <ChainMapLegend />
      <Callout tone="tip" title="drawing your own">
        <List>
          <Li>
            Vertex ids equal span paths for real nodes, so a click on a vertex maps straight to its span.
          </Li>
          <Li>
            <C>graph.entry</C> is where execution starts; lay out left to right from there (this site uses dagre).
          </Li>
        </List>
      </Callout>
    </DocPage>
  );
}
