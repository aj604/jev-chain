"use client";

/**
 * A shared run, read-only: the exact trace from the link, drawn on the chain
 * it ran on. No API call, no key needed; everything is in the URL hash.
 *
 * When the run was asked again before it was shared, its re-asks came along:
 * the story says which decisions held across every ask, and an ask that went
 * elsewhere opens next to the run as b, exactly as in the studio.
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { graphOf } from "jevchain";
import { ChainLinks } from "@/components/brand/chain-links";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { useHotkey } from "@/lib/hotkeys";
import { resolveChain, type ChainSource, type ResolvedChain } from "@/lib/trace/chain-source";
import type { ReaskControl } from "@/components/trace/why-panel";
import { previewJson } from "@/lib/trace/format";
import { stepSelection, visitOrder } from "@/lib/trace/order";
import { answeredReasks, steadinessOf } from "@/lib/trace/reask";
import { traceIssue } from "@/lib/trace/run-error";
import { saveRun } from "@/lib/trace/saved-runs";
import { decodeShare, ShareDecodeError, type SharePayload } from "@/lib/trace/share";
import { Workbench, type Target } from "./workbench";

type Loaded = { status: "loading" } | { status: "error"; message: string } | { status: "ok"; payload: SharePayload; chain: ResolvedChain };

function subscribeHash(fn: () => void) {
  window.addEventListener("hashchange", fn);
  return () => window.removeEventListener("hashchange", fn);
}

export function ShareView() {
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash, () => null);
  const [loaded, setLoaded] = useState<Loaded>({ status: "loading" });

  useEffect(() => {
    if (hash === null) return;
    let cancelled = false;
    decodeShare(hash)
      .then((payload) => {
        const source: ChainSource = "example" in payload.chain ? { kind: "example", slug: payload.chain.example } : { kind: "doc", doc: payload.chain.doc };
        const r = resolveChain(source);
        if (cancelled) return;
        if (!r.ok) setLoaded({ status: "error", message: `the chain in this link doesn't load here: ${r.issues.join("; ")}` });
        else setLoaded({ status: "ok", payload, chain: r.chain });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setLoaded({ status: "error", message: e instanceof ShareDecodeError ? e.message : "this link couldn't be opened." });
      });
    return () => {
      cancelled = true;
    };
  }, [hash]);

  if (loaded.status === "loading") {
    return (
      <div className="grid flex-1 place-items-center py-32">
        <div className="flex flex-col items-center gap-3 font-mono text-[11px] lowercase text-ink-3">
          <ChainLinks variant="loading" count={7} size={16} label="unpacking the run" />
          unpacking the run…
        </div>
      </div>
    );
  }
  if (loaded.status === "error") {
    return (
      <div className="mx-auto grid max-w-lg flex-1 place-items-center px-4 py-24">
        <div className="space-y-4 text-center">
          <ChainLinks count={7} progress={0} size={18} className="mx-auto text-ink-3" />
          <h1 className="font-display text-3xl italic">this link is missing a few links.</h1>
          <p className="text-[14px] leading-relaxed text-ink-2">{loaded.message}</p>
          <ButtonLink href="/studio" variant="accent">
            open the studio
          </ButtonLink>
        </div>
      </div>
    );
  }
  return <SharedRun payload={loaded.payload} chain={loaded.chain} />;
}

function SharedRun({ payload, chain }: { payload: SharePayload; chain: ResolvedChain }) {
  const graph = useMemo(() => graphOf(chain.node), [chain]);
  const [selected, setSelected] = useState<string | null>(null);
  const [target, setTarget] = useState<Target>("a");
  const [fitSignal, setFitSignal] = useState(0);
  const [saved, setSaved] = useState(false);
  const order = useMemo(() => visitOrder(graph, payload.trace), [graph, payload.trace]);
  const issue = useMemo(() => traceIssue(payload.trace), [payload.trace]);

  // The run's "ask again", if it came in the link: read, never re-sent.
  const kept = payload.reasks;
  const reaskTraces = useMemo(() => kept?.asks.map((a) => a.trace) ?? [], [kept]);
  const steadiness = useMemo(() => (kept ? steadinessOf(chain.node, payload.trace, reaskTraces) : undefined), [kept, chain, payload.trace, reaskTraces]);
  // An ask that went elsewhere, opened next to the run as b.
  const [opened, setOpened] = useState<number | null>(null);
  const openedTrace = opened === null ? undefined : reaskTraces[opened];
  const compare = useMemo(() => (openedTrace ? { trace: openedTrace, issue: traceIssue(openedTrace) } : undefined), [openedTrace]);
  const reask: ReaskControl | undefined =
    kept && steadiness
      ? {
          blocker: "a shared run is read-only. run it yourself to ask jev again.",
          running: false,
          done: kept.asks.filter((a) => a.trace || a.issue).length,
          answered: answeredReasks(reaskTraces).length,
          total: kept.total,
          steadiness,
          ...(kept.stoppedBy ? { stoppedBy: kept.stoppedBy } : {}),
          start: () => {},
          open: (index) => {
            if (!reaskTraces[index]) return;
            setOpened(index);
            setTarget("diff");
            setSelected(null);
          },
        }
      : undefined;
  const closeAsk = useCallback(() => {
    setOpened(null);
    setTarget("a");
  }, []);

  useHotkey("]", () => setSelected((s) => stepSelection(order, s, 1)), { description: "next visited node", group: "studio" });
  useHotkey("[", () => setSelected((s) => stepSelection(order, s, -1)), { description: "previous visited node", group: "studio" });
  useHotkey("f", () => setFitSignal((n) => n + 1), { description: "fit graph to view", group: "studio" });
  useHotkey("escape", () => setSelected(null), { description: "deselect", group: "studio", preventDefault: false });

  const keep = useCallback(() => {
    saveRun({ source: chain.source, chainTitle: chain.title, input: payload.input, trace: payload.trace, ...(payload.reasks ? { reasks: payload.reasks } : {}) });
    setSaved(true);
  }, [chain, payload]);

  const rerunHref =
    chain.source.kind === "example"
      ? `/studio?example=${encodeURIComponent(chain.source.slug)}&input=${encodeURIComponent(typeof payload.input === "string" ? payload.input : JSON.stringify(payload.input))}`
      : null;

  const header = (
    <div className="flex min-h-13 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
      <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <Badge tone="ink">shared run</Badge>
          <h1 className="truncate text-[15px] leading-6 font-medium text-ink">{chain.title}</h1>
          <Badge tone="dim" className="hidden sm:inline-flex">
            read-only
          </Badge>
        </div>
        <p className="truncate font-mono text-[11px] text-ink-3" title={previewJson(payload.input, 400)}>
          input · {previewJson(payload.input, 120)}
        </p>
      </div>
      <div className="flex items-center gap-1">
        {opened !== null && (
          <Button variant="ghost" size="sm" onClick={closeAsk}>
            close ask {opened + 2} ✕
          </Button>
        )}
        <span className="px-2">
          <CopyButton text={typeof window === "undefined" ? "" : window.location.href} label="copy link" />
        </span>
        <Button variant="ghost" size="sm" onClick={keep} disabled={saved}>
          {saved ? "saved ✓" : "save to my runs"}
        </Button>
        {rerunHref && (
          <ButtonLink href={rerunHref} variant="outline" size="sm">
            run it yourself →
          </ButtonLink>
        )}
      </div>
    </div>
  );

  return (
    <Workbench
      chain={chain}
      graph={graph}
      trace={payload.trace}
      issue={issue}
      target={target}
      onTarget={setTarget}
      selected={selected}
      onSelect={setSelected}
      fitSignal={fitSignal}
      header={header}
      {...(compare ? { compare } : {})}
      {...(reask ? { reask } : {})}
    />
  );
}
