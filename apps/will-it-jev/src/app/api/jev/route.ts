import { COPY } from "@/lib/copy";
import { MAX_BODY_BYTES, validateJevRequest } from "@/lib/jev-request";
import { isPaused } from "@/lib/paused";
import { clientKey, createRateLimiter } from "@/lib/rate-limit";
import { validateRecipeRequest } from "@/lib/recipe-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPSTREAM = "https://api.typesafe.ai/v1/systemone";
const UPSTREAM_TIMEOUT_MS = 30_000;

// Module-level so they survive across requests in the same server instance.
// In memory and per instance: a speed bump, not a budget. Provider spend caps
// and PAUSED are the budget.
const perIpLimiter = createRateLimiter({ limit: 60, windowMs: 60_000 });
// Requests with no forwarding header can't be told apart, so they share one
// small bucket instead of getting a free pass.
const sharedLimiter = createRateLimiter({ limit: 10, windowMs: 60_000 });
/** What `clientKey` returns when there is no forwarding header. */
const NO_FORWARDING_HEADER = "anonymous";

type ErrorType =
  | "paused"
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

/**
 * The studio's proxy with the server key only. Callers can't bring a key, and
 * only a request a compiled recipe could make is forwarded.
 */
export async function POST(req: Request) {
  if (isPaused()) return error(503, "paused", COPY.paused);

  const apiKey = process.env.TYPESAFE_API_KEY || null;
  if (!apiKey) return error(401, "missing_key", COPY.noKey);

  const key = clientKey(req.headers);
  const limiter = key === NO_FORWARDING_HEADER ? sharedLimiter : perIpLimiter;
  const rl = limiter.check(key);
  const rlHeaders = {
    "x-ratelimit-limit": String(rl.limit),
    "x-ratelimit-remaining": String(rl.remaining),
  };
  if (!rl.allowed) {
    const retryAfter = Math.max(1, Math.ceil(rl.retryAfterMs / 1000));
    return error(429, "rate_limited", COPY.rateLimited, { ...rlHeaders, "retry-after": String(retryAfter) });
  }

  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return error(413, "payload_too_large", COPY.tooLarge);
  const raw = await req.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) return error(413, "payload_too_large", COPY.tooLarge);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return error(400, "invalid_request", COPY.notJson);
  }
  const valid = validateJevRequest(parsed);
  if (!valid.ok) return error(400, "invalid_request", COPY.notRecipe);
  if (!validateRecipeRequest(valid.body).ok) return error(400, "invalid_request", COPY.notRecipe);

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
    return error(timedOut ? 504 : 502, "upstream_unreachable", COPY.jevCrashed, rlHeaders);
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
