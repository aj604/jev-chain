/**
 * Sliding-window-log rate limiter.
 *
 * The core (`slide`) is a pure function over a list of hit timestamps, so it
 * can be tested without clocks or maps. `createRateLimiter` wraps it in an
 * in-memory, per-key store. In-memory means per server instance — good enough
 * to keep one tab from melting the shared key, not a distributed quota.
 */

export interface WindowConfig {
  /** Max hits allowed inside any window of `windowMs`. */
  limit: number;
  windowMs: number;
}

export interface SlideResult {
  allowed: boolean;
  /** Hits left in the current window after this decision. */
  remaining: number;
  /** When denied: ms until the oldest hit leaves the window. 0 when allowed. */
  retryAfterMs: number;
  /** The timestamps to store for next time (pruned, plus `now` if allowed). */
  hits: number[];
}

/** Pure: decide whether a hit at `now` fits, given previous hit timestamps. */
export function slide(
  hits: readonly number[],
  now: number,
  { limit, windowMs }: WindowConfig,
): SlideResult {
  const cutoff = now - windowMs;
  const live = hits.filter((t) => t > cutoff);

  if (live.length >= limit) {
    const oldest = live[live.length - limit];
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: Math.max(0, oldest + windowMs - now),
      hits: live,
    };
  }

  live.push(now);
  return {
    allowed: true,
    remaining: limit - live.length,
    retryAfterMs: 0,
    hits: live,
  };
}

export interface RateLimiter {
  check(key: string): SlideResult & { limit: number };
  /** Drop every key whose window is empty. Returns how many were dropped. */
  prune(): number;
  readonly size: number;
}

export function createRateLimiter(
  config: WindowConfig & {
    /** Hard cap on tracked keys; when exceeded, the store is pruned. */
    maxKeys?: number;
    now?: () => number;
  },
): RateLimiter {
  const { maxKeys = 10_000, now = Date.now } = config;
  const store = new Map<string, number[]>();

  const prune = () => {
    const cutoff = now() - config.windowMs;
    let dropped = 0;
    for (const [key, hits] of store) {
      if (hits.length === 0 || hits[hits.length - 1] <= cutoff) {
        store.delete(key);
        dropped++;
      }
    }
    return dropped;
  };

  return {
    check(key) {
      if (store.size >= maxKeys && !store.has(key)) {
        prune();
        // Still full of live keys: evict the oldest-inserted one.
        if (store.size >= maxKeys) {
          const first = store.keys().next().value;
          if (first !== undefined) store.delete(first);
        }
      }
      const result = slide(store.get(key) ?? [], now(), config);
      store.set(key, result.hits);
      return { ...result, limit: config.limit };
    },
    prune,
    get size() {
      return store.size;
    },
  };
}

/** Best-effort client identity from proxy headers. */
export function clientKey(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || "anonymous";
}
