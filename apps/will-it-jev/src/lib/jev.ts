import { createJev, type Jev, type RetryPolicy } from "jevchain";

/**
 * How the browser client retries. One quick retry covers a dropped
 * connection or a one-off 502, since a run makes several requests in a row
 * and any failure ends it.
 *
 * `maxRetryAfterMs: 0` means a `retry-after` is never waited out. The
 * proxy's rate limiter sends one of up to a minute, and jevchain's default
 * would sleep through anything up to 30 seconds. Instead a 429 or a 503
 * pause gets the same short backoff as anything else, fails again, and ends
 * the run in well under two seconds.
 */
export const BROWSER_RETRY: RetryPolicy = {
  maxRetries: 1,
  initialDelayMs: 500,
  maxDelayMs: 500,
  jitter: 0.25,
  maxRetryAfterMs: 0,
};

/**
 * Per attempt. The proxy waits up to 30 seconds for the provider, so the
 * client waits a little longer rather than giving up on a request that is
 * still being answered. The run's own 60-second deadline caps the total.
 */
export const BROWSER_TIMEOUT_MS = 35_000;

/** A Jev client for the browser. It talks to the same-origin proxy, which adds the key. */
export function browserJev(): Jev {
  return createJev({
    apiKey: null,
    baseURL: "/api/jev",
    path: "",
    timeoutMs: BROWSER_TIMEOUT_MS,
    retry: BROWSER_RETRY,
  });
}
