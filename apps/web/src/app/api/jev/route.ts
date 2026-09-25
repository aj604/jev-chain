import { BYOK_HEADER } from "@/lib/byok";
import { MAX_BODY_BYTES, validateJevRequest } from "@/lib/jev-request";
import { clientKey, createRateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPSTREAM = "https://api.typesafe.ai/v1/systemone";
const UPSTREAM_TIMEOUT_MS = 30_000;

// Module-level so it survives across requests in the same server instance.
const serverKeyLimiter = createRateLimiter({ limit: 60, windowMs: 60_000 });
// BYOK callers spend their own quota; this only stops runaway loops.
const byokLimiter = createRateLimiter({ limit: 600, windowMs: 60_000 });

type ErrorType =
  | "rate_limited"
  | "payload_too_large"
  | "invalid_request"
  | "missing_key"
  | "upstream_unreachable";

function error(status: number, type: ErrorType, message: string, headers?: HeadersInit) {
  return Response.json(
    { error: { type, message } },
    { status, headers: { "cache-control": "no-store", ...headers } },
  );
}

export function GET() {
  return Response.json(
    { ok: true, serverKey: Boolean(process.env.TYPESAFE_API_KEY) },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(req: Request) {
  const byok = req.headers.get(BYOK_HEADER)?.trim() || null;
  if (byok && (byok.length > 512 || /\s/.test(byok))) {
    return error(400, "invalid_request", `the ${BYOK_HEADER} header doesn't look like an API key.`);
  }
  const apiKey = byok ?? process.env.TYPESAFE_API_KEY ?? null;
  if (!apiKey) {
    return error(
      401,
      "missing_key",
      "no API key: this server has no TYPESAFE_API_KEY configured. add your own key via the “key” button and try again.",
    );
  }

  const limiter = byok ? byokLimiter : serverKeyLimiter;
  const rl = limiter.check(clientKey(req.headers));
  const rlHeaders = {
    "x-ratelimit-limit": String(rl.limit),
    "x-ratelimit-remaining": String(rl.remaining),
  };
  if (!rl.allowed) {
    const retryAfter = Math.max(1, Math.ceil(rl.retryAfterMs / 1000));
    return error(
      429,
      "rate_limited",
      byok
        ? `easy there. ${rl.limit} requests a minute is plenty, even on your own key. try again in ${retryAfter}s.`
        : `the shared key needs a breather — ${rl.limit} requests a minute per person. try again in ${retryAfter}s, or bring your own key and skip the line.`,
      { ...rlHeaders, "retry-after": String(retryAfter) },
    );
  }

  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) {
    return error(413, "payload_too_large", `request body is over ${MAX_BODY_BYTES / 1024}KB. jev is quick, not a document store.`);
  }
  const raw = await req.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) {
    return error(413, "payload_too_large", `request body is over ${MAX_BODY_BYTES / 1024}KB. jev is quick, not a document store.`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return error(400, "invalid_request", "body isn't valid JSON.");
  }
  const valid = validateJevRequest(parsed);
  if (!valid.ok) return error(400, "invalid_request", valid.message);

  let upstream: Response;
  try {
    upstream = await fetch(UPSTREAM, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(valid.body),
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch (err) {
    const timedOut = err instanceof DOMException && err.name === "TimeoutError";
    return error(
      timedOut ? 504 : 502,
      "upstream_unreachable",
      timedOut
        ? `typesafe didn't answer within ${UPSTREAM_TIMEOUT_MS / 1000}s.`
        : "couldn't reach typesafe. the chain is intact; the network isn't.",
      rlHeaders,
    );
  }

  const headers = new Headers({
    "content-type": upstream.headers.get("content-type") ?? "application/json",
    "cache-control": "no-store",
    ...rlHeaders,
  });
  const retryAfter = upstream.headers.get("retry-after");
  if (retryAfter) headers.set("retry-after", retryAfter);

  return new Response(await upstream.text(), { status: upstream.status, headers });
}
