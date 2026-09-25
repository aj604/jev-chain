export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * First-party proxy for GoatCounter's count endpoint. A plain `rewrites()`
 * entry would work, but Next's external proxy doesn't forward the visitor's
 * IP, so every hit would look like one visitor from the server's datacenter.
 * Forwarding it (plus the user agent, which drives bot filtering and browser
 * stats) keeps sessions and locations meaningful.
 */
const UPSTREAM = "https://jev-chain.goatcounter.com/count";
const UPSTREAM_TIMEOUT_MS = 5_000;

async function forward(req: Request) {
  const { search } = new URL(req.url);
  const headers = new Headers();
  for (const name of ["user-agent", "accept-language", "x-forwarded-for", "x-real-ip"]) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }

  let upstream: Response;
  try {
    upstream = await fetch(UPSTREAM + search, {
      method: req.method,
      headers,
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    // Analytics is best-effort; never surface a proxy failure to the page.
    return new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  }

  const out = new Headers({ "cache-control": "no-store" });
  const type = upstream.headers.get("content-type");
  if (type) out.set("content-type", type);
  return new Response(await upstream.arrayBuffer(), { status: upstream.status, headers: out });
}

// count.js uses sendBeacon (POST) and falls back to an <img> (GET).
export { forward as GET, forward as POST };
