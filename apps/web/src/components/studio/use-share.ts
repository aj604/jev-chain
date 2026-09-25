"use client";

import { useCallback, useEffect, useState } from "react";
import type { Json, Trace } from "jevchain";
import type { ChainSource } from "@/lib/trace/chain-source";
import { encodeShare, shareUrl, type SharePayload } from "@/lib/trace/share";

export type ShareState = "idle" | "working" | "copied" | "error";

export function sharePayload(source: ChainSource, input: Json, trace: Trace): SharePayload {
  return { v: 1, chain: source.kind === "example" ? { example: source.slug } : { doc: source.doc }, input, trace };
}

/** Encode a run into a link and copy it. `state` drives the button's feedback. */
export function useShare() {
  const [state, setState] = useState<ShareState>("idle");
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (state !== "copied" && state !== "error") return;
    const t = setTimeout(() => setState("idle"), 1800);
    return () => clearTimeout(t);
  }, [state]);

  const share = useCallback(async (payload: SharePayload) => {
    setState("working");
    try {
      const link = shareUrl(window.location.origin, await encodeShare(payload));
      setUrl(link);
      try {
        await navigator.clipboard.writeText(link);
        setState("copied");
      } catch {
        // Clipboard blocked: the link is still shown for manual copying.
        setState("error");
      }
      return link;
    } catch {
      setState("error");
      return null;
    }
  }, []);

  return { state, url, share };
}
