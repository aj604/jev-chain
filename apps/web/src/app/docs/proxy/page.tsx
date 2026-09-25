import { DocExample } from "@/components/docs/doc-example";
import { A, ApiTable, C, Callout, DocPage, H2, Li, List, P, Snippet } from "@/components/docs/doc-ui";
import { docMetadata } from "@/docs/nav";

export const metadata = docMetadata("proxy");

const BROWSER = `import { createJev } from "jevchain";
import { jevHeaders } from "@/lib/byok";

export const jev = createJev({
  apiKey: null,          // no key in the browser, ever
  baseURL: "/api/jev",   // our route handler
  path: "",              // baseURL is already the whole endpoint
  // Add the BYOK header (if any) per request, so changing keys needs no new client.
  fetch: (url, init) => fetch(url, { ...init, headers: jevHeaders(init?.headers) }),
});`;

const OWN_PROXY = `// app/api/jev/route.ts: the smallest proxy that works
export async function POST(req: Request) {
  const upstream = await fetch("https://api.typesafe.ai/v1/systemone", {
    method: "POST",
    headers: {
      authorization: \`Bearer \${process.env.TYPESAFE_API_KEY}\`,
      "content-type": "application/json",
    },
    body: await req.text(),
    signal: AbortSignal.timeout(30_000),
  });

  // Pass status, body and retry-after through untouched, so the client's
  // error classes and retry logic behave exactly as if it talked to TypeSafe.
  const headers = new Headers({ "content-type": upstream.headers.get("content-type") ?? "application/json" });
  const retryAfter = upstream.headers.get("retry-after");
  if (retryAfter) headers.set("retry-after", retryAfter);
  return new Response(await upstream.text(), { status: upstream.status, headers });
}`;

const ERROR_SHAPE = `HTTP/1.1 429 Too Many Requests
retry-after: 12
x-ratelimit-limit: 60
x-ratelimit-remaining: 0

{ "error": { "type": "rate_limited",
             "message": "the shared key needs a breather — 60 requests a minute per person. ..." } }`;

export default function ProxyPage() {
  return (
    <DocPage slug="proxy">
      <H2 id="why">Why a proxy</H2>
      <P>
        A TypeSafe key in client-side JavaScript is a key on the internet. So the studio and every &ldquo;run it&rdquo;
        button on this site never talk to TypeSafe directly: the browser runs the chain (the runtime, the trace, the
        decisions are all local), and only the HTTP calls to Jev go through one small route handler on this server,{" "}
        <C>/api/jev</C>, which adds the key and forwards them.
      </P>
      <List>
        <Li>
          <strong>The key stays server-side.</strong> <C>TYPESAFE_API_KEY</C> is read from the server&apos;s environment
          and sent upstream as a bearer token. It never reaches the browser.
        </Li>
        <Li>
          <strong>Bodies are shape-checked first.</strong> JSON only, 64 KB max, a <C>model</C>, a <C>state</C>, and 1 to
          64 named questions that each have a <C>type</C>. Garbage is rejected before it costs anyone a request.
        </Li>
        <Li>
          <strong>Everything else passes through.</strong> TypeSafe&apos;s status, body and <C>retry-after</C> come back
          untouched, so the client&apos;s <A href="/docs/errors">error classes</A> and retries work exactly as they would
          against the real API. Upstream gets 30 seconds before the proxy answers 504.
        </Li>
      </List>
      <DocExample
        id="haunted-desk"
        caption={
          <>
            Every &ldquo;run in studio&rdquo; button in these docs ends up here: the chain runs in your browser, and each
            pink node is one trip through <C>/api/jev</C>.
          </>
        }
      />

      <H2 id="wiring">Pointing the client at it</H2>
      <P>
        The client builds its endpoint as <C>baseURL + path</C>. Point <C>baseURL</C> at the proxy, empty the path, and
        pass <C>apiKey: null</C> so no <C>authorization</C> header is sent. A browser client for this site&apos;s proxy looks like this:
      </P>
      <Snippet code={BROWSER} file="jev-client.ts" />
      <P>
        Batching, concurrency limits, timeouts and retries all still happen in the browser, before the proxy sees
        anything. A four-way <C>parallel</C> over the same state is still one request.
      </P>
      <P>Building your own? The core is a dozen lines:</P>
      <Snippet code={OWN_PROXY} file="app/api/jev/route.ts" />
      <Callout tone="warn" title="before you ship that">
        <p>
          A bare proxy is an open, free Jev endpoint for anyone who finds it. Add what this site&apos;s version adds:
          body validation, a size cap, rate limiting, and ideally your own auth.
        </p>
      </Callout>

      <H2 id="byok">Bring your own key</H2>
      <P>
        Hit the <strong>key</strong> button in the top bar to use your own TypeSafe key instead of the shared one. Where
        it goes:
      </P>
      <List>
        <Li>
          It&apos;s saved in <strong>this browser&apos;s localStorage</strong> (<C>jevchain.byok</C>) and nowhere else.
        </Li>
        <Li>
          It&apos;s sent only to this site&apos;s own <C>/api/jev</C>, as the <C>x-typesafe-key</C> header, which forwards it
          to TypeSafe as the bearer token for that one request. The server doesn&apos;t log or store it.
        </Li>
        <Li>
          A header that isn&apos;t plausibly a key (whitespace, or over 512 characters) is rejected with a 400. Remove the
          key and you&apos;re back on the shared one.
        </Li>
      </List>
      <P>
        With no BYOK header and no <C>TYPESAFE_API_KEY</C> on the server, the proxy answers 401 <C>missing_key</C>, which
        the client surfaces as a <C>JevAuthError</C>. <C>GET /api/jev</C> is a tiny health check that says whether a
        shared key is configured:
      </P>
      <Snippet code={`GET /api/jev\n→ { "ok": true, "serverKey": true }`} file="health" />

      <H2 id="rate-limits">Rate limiting</H2>
      <ApiTable
        rows={[
          { name: "shared key", type: "60 / minute", children: "Per client (first x-forwarded-for address, else x-real-ip). Keeps one tab from melting the demo key." },
          { name: "your key", type: "600 / minute", children: "You're spending your own quota; this only stops runaway loops." },
        ]}
      />
      <P>
        The limiter is a sliding-window log: it keeps each client&apos;s request timestamps for the last 60 seconds and
        admits a request only while that window holds fewer than the limit. It&apos;s in memory, per server instance, so it&apos;s a guard
        rail, not a distributed quota. Every response past the limiter carries <C>x-ratelimit-limit</C> and <C>x-ratelimit-remaining</C>;
        a refusal is a 429 with <C>retry-after</C>:
      </P>
      <Snippet code={ERROR_SHAPE} file="response" />
      <P>
        Because it&apos;s a real 429 with <C>retry-after</C>, the client treats it like TypeSafe&apos;s own: it waits and
        retries (up to <C>maxRetryAfterMs</C>), and records each retry in the trace. All of the proxy&apos;s own errors
        share the <C>{`{ error: { type, message } }`}</C> shape, with <C>type</C> one of <C>rate_limited</C>,{" "}
        <C>payload_too_large</C>, <C>invalid_request</C>, <C>missing_key</C> or <C>upstream_unreachable</C>.
      </P>
    </DocPage>
  );
}
