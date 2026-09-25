import type { ReactNode } from "react";
import { DocExample } from "@/components/docs/doc-example";
import { A, C, Callout, DocPage, H2, P, Snippet } from "@/components/docs/doc-ui";
import { claims } from "@/docs/claims";
import { docMetadata } from "@/docs/nav";

export const metadata = docMetadata("errors");

const CATCH_ALL = `import { JevChainError } from "jevchain";

try {
  await jev.ask(state, questions);   // the raw client does throw
} catch (e) {
  if (e instanceof JevChainError) console.log(e.code, e.message);
}`;

const HANDLE = `import { JevRateLimitError, NodeError } from "jevchain";

const result = await jev.run(desk, ticket);

if (result.status === "error" || result.status === "aborted") {
  const { error } = result;

  switch (error.code) {                 // NodeError copies its cause's code
    case "auth_error":
      return askUserForANewKey();
    case "rate_limited": {
      const cause = error.cause;
      const wait = cause instanceof JevRateLimitError ? cause.retryAfterMs : undefined;
      return retryLater(wait ?? 10_000);
    }
    case "timeout":
    case "overloaded":
      return fallBackToAHuman();
    default:
      if (error instanceof NodeError) log(\`\${error.nodeId} broke\`, error.cause);
      throw error;
  }
}`;

/** A serialized error on two lines: the fields, then the message. */
const twoLines = ({ message, ...rest }: { message: string }) =>
  `${JSON.stringify(rest, null, 1).replace(/\n\s*/g, " ").slice(0, -2)},\n  "message": ${JSON.stringify(message)} }`;

const TRACE_ERR = `// trace.error: the NodeError, flattened
${twoLines(claims.errorTrace.run)}

// the failing span's error: the original cause
${twoLines(claims.errorTrace.span)}`;

const CONFIG = `try {
  await jev.run(fromJSON(doc, { handlers }), input);
} catch (e) {
  if (e instanceof ChainConfigError) console.error(e.issues);
  // [ '${claims.errorConfig[0]}' ]
}`;

interface ErrorRow {
  name: string;
  type: string;
  default: string;
  children: ReactNode;
}

/** class · code · retried · what to do. Stacks on narrow screens. */
function ErrorTable({ rows }: { rows: ErrorRow[] }) {
  return (
    <div className="my-6 border-hard">
      <div className="border-hard-b bg-paper px-4 py-2 font-mono text-[11px] lowercase text-ink-3">
        retried = the client retries it on its own before giving up
      </div>
      <table className="w-full border-collapse text-left">
        <thead className="hidden md:table-header-group">
          <tr className="border-soft-b font-mono text-[11px] lowercase text-ink-3">
            <th className="px-4 py-2 font-normal">class</th>
            <th className="px-4 py-2 font-normal">code</th>
            <th className="px-4 py-2 font-normal">retried</th>
            <th className="px-4 py-2 font-normal">what it means / what to do</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className="flex flex-col gap-1 border-soft-b px-4 py-3 last:border-b-0 md:table-row md:px-0 md:py-0">
              <td className="align-top font-mono text-[13px] whitespace-nowrap text-ink md:px-4 md:py-3">{r.name}</td>
              <td className="align-top font-mono text-[12px] text-accent-strong md:px-4 md:py-3">{r.type}</td>
              <td className="align-top font-mono text-[12px] text-ink-3 md:px-4 md:py-3">
                <span className="md:hidden">retried: </span>
                {r.default}
              </td>
              <td className="align-top text-[14px] leading-relaxed text-ink-2 md:px-4 md:py-3 [&_code]:font-mono [&_code]:text-[12.5px] [&_code]:text-ink">
                {r.children}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function ErrorsPage() {
  return (
    <DocPage slug="errors">
      <H2 id="base-class">One base class</H2>
      <P>
        Everything JevChain throws or reports extends <C>JevChainError</C>, so one <C>instanceof</C> catches the lot.
        Each carries a stable string <C>code</C> that&apos;s safe to <C>switch</C> on, log and serialize. The subclass
        tells you what to do next.
      </P>
      <Snippet code={CATCH_ALL} file="catch.ts" />
      <P>
        Remember that <C>jev.run</C> doesn&apos;t throw for runtime failures: it hands the error back on the result (see{" "}
        <A href="/docs/running#statuses">Statuses</A>). The low-level <C>jev.ask</C> does throw.
      </P>

      <H2 id="table">Every error</H2>
      <ErrorTable
        rows={[
          { name: "JevAuthError", type: "auth_error", default: "no", children: <>401/403. The key is missing, wrong or not allowed. Fix the key; retrying won&apos;t.</> },
          { name: "JevValidationError", type: "validation_error", default: "no", children: <>400/422. TypeSafe couldn&apos;t process the request, usually a malformed question. The message carries their detail.</> },
          { name: "JevRateLimitError", type: "rate_limited", default: "yes", children: <>429. <code>retryAfterMs</code> is set when the server said how long; the client waits that long (up to <code>maxRetryAfterMs</code>).</> },
          { name: "JevServerError", type: "server_error · overloaded", default: "yes*", children: <>5xx, or 529 (<code>overloaded</code>). *Retried for 500, 502, 503, 504 and 529. Back off; it&apos;s them, not you.</> },
          { name: "JevAPIError", type: "api_error", default: "408, 409", children: <>Any other non-2xx. The base class of the four above; all of them have <code>status</code> and <code>body</code>.</> },
          { name: "JevTimeoutError", type: "timeout", default: "per attempt", children: <>An attempt took longer than <code>timeoutMs</code>, a step exceeded its own <code>timeoutMs</code>, or the run hit its deadline. Only per-attempt API timeouts are retried by the client (steps use their own <code>retries</code>). Has <code>timeoutMs</code>.</> },
          { name: "JevConnectionError", type: "connection_error", default: "yes", children: <>The network failed before any response. The original error is its <code>cause</code>.</> },
          { name: "JevAbortError", type: "aborted", default: "no", children: <>Your <code>AbortSignal</code> fired. The run&apos;s status is <code>aborted</code>. Nothing to fix.</> },
          { name: "JevResponseError", type: "bad_response", default: "no", children: <>A 200 whose body wasn&apos;t right: no <code>answers</code>, a missing answer, or an answer of the wrong type. Has <code>body</code>.</> },
          { name: "ChainConfigError", type: "chain_config", default: "—", children: <>The chain itself is invalid. Has <code>issues: string[]</code>. Thrown, not returned.</> },
          { name: "NodeError", type: "cause's code", default: "—", children: <>Wraps whatever failed inside a node. Has <code>nodeId</code>, <code>path</code> and <code>cause</code>; its code is the cause&apos;s code, or <code>node_error</code> for plain exceptions from your code.</> },
          { name: "CancelledError", type: "cancelled", default: "no", children: <>Work stopped because something else failed first, like a <A href="/docs/parallel#failures">parallel</A> sibling. Collateral, not the culprit: its <code>cause</code>, and the run&apos;s <code>error</code>, is the real failure.</> },
        ]}
      />
      <P>
        A few more codes appear on bare <C>JevChainError</C>s: <C>no_questions</C> (an ask with nothing to ask),{" "}
        <C>no_fetch</C> (no global <C>fetch</C>; pass one), <C>no_branch</C> (a route answered a label it has no branch for,
        only possible with unchecked JSON) and <C>unknown</C>.
      </P>
      <DocExample
        id="docs-flaky-oracle"
        caption={
          <>
            A step that throws about half the time, with <C>retries: 3</C>. Run it a few times in the studio: most runs
            succeed after a retry or two, each one recorded in the span&apos;s <C>retries</C>. Now and then all four
            attempts fail, and the run ends <C>error</C> with a <C>node_error</C> from <C>consult-oracle</C>.
          </>
        }
      />

      <H2 id="chain-errors">NodeError and ChainConfigError</H2>
      <P>
        These two are about <em>your</em> chain rather than the API. <C>NodeError</C> points at the culprit: when anything
        fails while a node runs, it&apos;s wrapped once, at the innermost node, so <C>nodeId</C> names where it actually
        broke rather than the chain around it. Because it copies its cause&apos;s <C>code</C>, a switch on{" "}
        <C>error.code</C> sees <C>rate_limited</C>, not a generic wrapper.
      </P>
      <P>
        In a trace, the failure is recorded twice: <C>trace.error</C> is the <C>NodeError</C> and the failing span&apos;s{" "}
        <C>error</C> is the original cause, both flattened by <C>serializeError</C> into{" "}
        <C>{`{ name, code, message, status?, nodeId?, path? }`}</C>. <C>path</C> is the span where the failure started,
        so you can find it in the trace even when ids repeat:
      </P>
      <Snippet code={TRACE_ERR} file="trace.json" />
      <P>
        <C>ChainConfigError</C> is thrown by <C>run</C>/<C>stream</C> before anything executes, and by <C>fromJSON</C>,
        when the structure is wrong in ways the type system couldn&apos;t see (usually because the chain came from JSON).
        It lists every problem at once:
      </P>
      <Snippet code={CONFIG} file="load.ts" />

      <H2 id="handling">Handling them</H2>
      <P>
        Switch on the code for the cases you can do something about, and let the rest surface. The trace is on the
        result either way, so log it before you decide.
      </P>
      <Snippet code={HANDLE} file="handle.ts" />
      <Callout tone="jev" title="p(you need a try/catch around run) ≈ 0.04">
        <p>
          Only <C>ChainConfigError</C> escapes <C>run</C>, and that&apos;s a bug to fix, not a condition to handle. Your
          step code can throw whatever it likes; it arrives as a <C>NodeError</C> on the result.
        </p>
      </Callout>
    </DocPage>
  );
}
