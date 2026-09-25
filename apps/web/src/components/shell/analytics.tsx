"use client";

import { usePathname } from "next/navigation";
import Script from "next/script";
import { useCallback, useEffect, useRef } from "react";

declare global {
  interface Window {
    goatcounter?: { count?: (vars: { path: string }) => void };
  }
}

/**
 * GoatCounter pageviews, served first-party: `/who.js` is rewritten to
 * gc.zgo.at/count.js (next.config.ts) and hits go to `/who` (a route
 * handler). `no_onload` hands counting to us so client-side navigations are
 * counted too. Only the pathname is sent: studio query strings and share
 * hashes carry whole chains, which don't belong in analytics.
 */
export function Analytics() {
  const pathname = usePathname();
  const counted = useRef<string | null>(null);

  const count = useCallback(() => {
    const path = window.location.pathname;
    if (counted.current === path || !window.goatcounter?.count) return;
    counted.current = path;
    window.goatcounter.count({ path });
  }, []);

  useEffect(count, [pathname, count]);

  return (
    <Script
      src="/who.js"
      data-goatcounter="/who"
      data-goatcounter-settings='{"no_onload":true}'
      strategy="afterInteractive"
      onReady={count}
    />
  );
}
