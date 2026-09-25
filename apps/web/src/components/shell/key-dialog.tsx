"use client";

import { useEffect, useId, useState } from "react";
import { ChainLinks } from "@/components/brand/chain-links";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { BYOK_HEADER, BYOK_STORAGE_KEY, maskKey, setByok } from "@/lib/byok";
import { useByok } from "@/lib/use-byok";

type Probe =
  | { state: "idle" }
  | { state: "running" }
  | { state: "ok"; p: number; ms: number; model: string; using: "yours" | "shared" }
  | { state: "error"; status: number; message: string };

const PROBE_BODY = {
  state: "hi jev, it's me, the key tester. just checking you're awake.",
  model: "jev-latest",
  questions: { awake: { type: "noul", instructions: "Is this message a friendly greeting?" } },
};

/** Bring-your-own-key settings. Opened from the nav "key" button. */
export function KeyDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const saved = useByok();
  const [draft, setDraft] = useState("");
  const [reveal, setReveal] = useState(false);
  const [serverKey, setServerKey] = useState<boolean | null>(null);
  const [probe, setProbe] = useState<Probe>({ state: "idle" });
  const inputId = useId();
  const helpId = useId();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch("/api/jev", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { serverKey?: boolean }) => !cancelled && setServerKey(Boolean(j.serverKey)))
      .catch(() => !cancelled && setServerKey(null));
    return () => {
      cancelled = true;
    };
  }, [open]);

  const close = () => {
    setDraft("");
    setReveal(false);
    setProbe({ state: "idle" });
    onClose();
  };

  const save = () => {
    if (!draft.trim()) return;
    setByok(draft);
    setDraft("");
    setProbe({ state: "idle" });
  };

  const forget = () => {
    setByok(null);
    setProbe({ state: "idle" });
  };

  const test = async () => {
    setProbe({ state: "running" });
    const key = draft.trim() || saved;
    const started = performance.now();
    try {
      const res = await fetch("/api/jev", {
        method: "POST",
        headers: { "content-type": "application/json", ...(key ? { [BYOK_HEADER]: key } : {}) },
        body: JSON.stringify(PROBE_BODY),
      });
      const ms = Math.round(performance.now() - started);
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        const message =
          json?.error?.message ?? json?.message ?? json?.detail ?? `request failed with ${res.status}`;
        setProbe({ state: "error", status: res.status, message: String(message) });
        return;
      }
      setProbe({
        state: "ok",
        p: Number(json?.answers?.awake?.noul ?? NaN),
        ms,
        model: String(json?.model ?? "jev"),
        using: key ? "yours" : "shared",
      });
    } catch {
      setProbe({ state: "error", status: 0, message: "network error — couldn't reach /api/jev." });
    }
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title="api key"
      description="bring your own typesafe key, or ride the shared one (rate-limited, be nice)."
      footer={
        <>
          <Button variant="ghost" onClick={test} disabled={probe.state === "running" || (!draft.trim() && !saved && serverKey === false)}>
            {probe.state === "running" ? <ChainLinks variant="loading" count={5} size={10} label="testing" /> : "test connection"}
          </Button>
          <Button variant="solid" onClick={save} disabled={!draft.trim()}>
            save key
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 font-mono text-xs">
          <dt className="text-ink-3">shared key</dt>
          <dd>
            {serverKey === null ? (
              <Badge tone="dim">checking…</Badge>
            ) : serverKey ? (
              <Badge tone="pass" dot>configured · 60 req/min</Badge>
            ) : (
              <Badge tone="warn" dot>none on this server</Badge>
            )}
          </dd>
          <dt className="text-ink-3">your key</dt>
          <dd className="flex items-center gap-2">
            {saved ? (
              <>
                <Badge tone="accent" dot>{maskKey(saved)}</Badge>
                <button type="button" onClick={forget} className="text-ink-3 underline decoration-dotted underline-offset-4 hover:text-fail">
                  forget
                </button>
              </>
            ) : (
              <Badge tone="dim">not set</Badge>
            )}
          </dd>
        </dl>

        <div>
          <label htmlFor={inputId} className="mb-1.5 block font-mono text-[11px] uppercase tracking-[0.12em] text-ink-3">
            {saved ? "replace key" : "paste key"}
          </label>
          <div className="flex border-hard bg-surface focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent">
            <input
              id={inputId}
              type={reveal ? "text" : "password"}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  save();
                }
              }}
              placeholder="paste your typesafe key"
              autoComplete="off"
              spellCheck={false}
              aria-describedby={helpId}
              className="h-10 min-w-0 flex-1 bg-transparent px-3 font-mono text-sm text-ink outline-none placeholder:text-ink-3"
            />
            <button
              type="button"
              onClick={() => setReveal((r) => !r)}
              aria-pressed={reveal}
              className="border-hard-l px-3 font-mono text-xs lowercase text-ink-2 hover:bg-surface-2 hover:text-ink"
            >
              {reveal ? "hide" : "show"}
            </button>
          </div>
        </div>

        <ProbeResult probe={probe} />

        <p id={helpId} className="border-soft bg-surface-2 p-3 text-[13px] leading-relaxed text-ink-2">
          your key stays in this browser (localStorage, <code className="font-mono text-xs">{BYOK_STORAGE_KEY}</code>). it
          only travels to this site&apos;s <code className="font-mono text-xs">/api/jev</code> proxy in an{" "}
          <code className="font-mono text-xs">{BYOK_HEADER}</code> header, which forwards it to typesafe and immediately
          forgets it. nothing is logged or stored server-side. requests on your own key get a much roomier rate limit.
        </p>
      </div>
    </Dialog>
  );
}

function ProbeResult({ probe }: { probe: Probe }) {
  if (probe.state === "idle" || probe.state === "running") return null;
  if (probe.state === "error") {
    return (
      <div role="alert" className="border-(length:--bw) border-fail bg-fail-wash px-3 py-2 font-mono text-xs text-fail">
        {probe.status ? `${probe.status} · ` : ""}
        {probe.message}
      </div>
    );
  }
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-3 gap-y-1 border-(length:--bw) border-pass bg-pass-wash px-3 py-2 font-mono text-xs text-pass">
      <span>connected ({probe.using} key)</span>
      <span className="text-ink-2">
        p(friendly greeting) = {Number.isFinite(probe.p) ? probe.p.toFixed(2) : "?"} · {probe.ms}ms · {probe.model}
      </span>
    </div>
  );
}
