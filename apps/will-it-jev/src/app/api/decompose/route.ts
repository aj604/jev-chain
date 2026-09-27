import { COPY } from "@/lib/copy";
import {
  decompose,
  FIRST_ATTEMPT_MS,
  llmConfigFromEnv,
  MAX_THING,
  MIN_THING,
  TOTAL_MS,
} from "@/lib/decompose/decompose";
import { MAX_BODY_BYTES } from "@/lib/jev-request";
import { isPaused } from "@/lib/paused";
import { clientKey, createRateLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Module-level so it survives across requests in the same server instance.
// In memory and per instance: a speed bump, not a budget. Provider spend caps
// and PAUSED are the budget. Requests with no forwarding header all get
// `clientKey`'s one fallback key, so they share a single bucket of 20.
const limiter = createRateLimiter({ limit: 20, windowMs: 60_000 });

// Free text is never logged or stored. Nothing in this file logs: not the
// body, not the thing, not the model's reply, and not decompose's failure
// message, which can quote the reply.

function error(status: number, message: string, headers?: HeadersInit) {
  return Response.json({ error: message }, { status, headers: { "cache-control": "no-store", ...headers } });
}

/** Whether free text can be decomposed right now. The page greys it out when not. */
export function GET() {
  return Response.json(
    { ok: true, enabled: llmConfigFromEnv() !== null, paused: isPaused() },
    { headers: { "cache-control": "no-store" } },
  );
}

/** `{ thing }` in, `{ recipe }` out, or `{ error }` with one of the copy lines. */
export async function POST(req: Request) {
  if (isPaused()) return error(503, COPY.paused);

  const config = llmConfigFromEnv();
  if (!config) return error(503, COPY.decomposerOff);

  // Charged before the body is read, so a flood of bad bodies is limited too.
  const rl = limiter.check(clientKey(req.headers));
  const rlHeaders = {
    "x-ratelimit-limit": String(rl.limit),
    "x-ratelimit-remaining": String(rl.remaining),
  };
  if (!rl.allowed) {
    const retryAfter = Math.max(1, Math.ceil(rl.retryAfterMs / 1000));
    return error(429, COPY.rateLimited, { ...rlHeaders, "retry-after": String(retryAfter) });
  }

  // The proxy's cap. A body this big can't hold a thing under MAX_THING
  // unless it is padding, so it reads as too long.
  const declared = Number(req.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return error(400, COPY.tooLong, rlHeaders);
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return error(400, COPY.tooShort, rlHeaders);
  }
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) return error(400, COPY.tooLong, rlHeaders);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return error(400, COPY.tooShort, rlHeaders);
  }
  const value = typeof parsed === "object" && parsed !== null ? (parsed as { thing?: unknown }).thing : undefined;
  if (typeof value !== "string") return error(400, COPY.tooShort, rlHeaders);

  const thing = value.trim();
  if (thing.length < MIN_THING) return error(400, COPY.tooShort, rlHeaders);
  if (thing.length > MAX_THING) return error(400, COPY.tooLong, rlHeaders);

  // The caller's signal, so a disconnect stops the model call.
  const result = await decompose(thing, {
    ...config,
    signal: req.signal,
    firstAttemptMs: FIRST_ATTEMPT_MS,
    totalMs: TOTAL_MS,
  });
  // `result.message` is not used: it can quote the model's reply.
  if (!result.ok) return error(502, COPY.wontJev, rlHeaders);

  return Response.json(
    { recipe: result.recipe },
    { headers: { "cache-control": "no-store", ...rlHeaders } },
  );
}
