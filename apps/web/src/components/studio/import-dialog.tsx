"use client";

import { useId, useState } from "react";
import type { ChainDocument } from "jevchain";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { cn } from "@/lib/cn";
import { parseChainDocument } from "@/lib/trace/chain-source";

export function ImportDialog({
  open,
  onClose,
  onLoad,
  starter,
}: {
  open: boolean;
  onClose: () => void;
  onLoad: (doc: ChainDocument) => void;
  /** The current chain as a document, to start editing from. */
  starter?: () => ChainDocument;
}) {
  const [text, setText] = useState("");
  const [issues, setIssues] = useState<string[] | null>(null);
  const fileId = useId();
  const areaId = useId();

  const load = (raw = text) => {
    const r = parseChainDocument(raw);
    if (!r.ok) {
      setIssues(r.issues);
      return;
    }
    setIssues(null);
    onLoad(r.doc);
    onClose();
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="import a chain"
      description={
        <>
          paste a <span className="font-mono text-[12px]">jevchain/v1</span> document (what <span className="font-mono text-[12px]">toJSON()</span>{" "}
          gives you). steps without handlers pass their input through.
        </>
      }
      className="w-[min(44rem,calc(100vw-2rem))]"
      footer={
        <>
          {starter && (
            <Button
              variant="ghost"
              size="sm"
              className="mr-auto"
              onClick={() => {
                setText(JSON.stringify(starter(), null, 2));
                setIssues(null);
              }}
            >
              start from current chain
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={onClose}>
            cancel
          </Button>
          <Button variant="accent" size="sm" onClick={() => load()}>
            load chain
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <label htmlFor={areaId} className="sr-only">
          chain document json
        </label>
        <textarea
          id={areaId}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setIssues(null);
          }}
          rows={14}
          spellCheck={false}
          placeholder={'{\n  "format": "jevchain/v1",\n  "root": { "kind": "route", … },\n  "refs": []\n}'}
          className={cn(
            "block w-full resize-y border-(length:--bw) bg-surface px-3 py-2 font-mono text-[12px] leading-[1.55] text-ink outline-none placeholder:text-ink-3",
            "focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-accent",
            issues ? "border-fail" : "border-line",
          )}
        />
        <div className="flex items-center gap-2 font-mono text-[11px] lowercase text-ink-3">
          <label htmlFor={fileId} className="cursor-pointer underline decoration-dotted underline-offset-4 hover:text-ink">
            or pick a .json file
          </label>
          <input
            id={fileId}
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              const t = await f.text();
              setText(t);
              load(t);
              e.target.value = "";
            }}
          />
        </div>
        {issues && (
          <div role="alert" className="border-(length:--bw) border-fail bg-fail-wash px-3 py-2">
            <p className="font-mono text-xs lowercase text-fail">
              {issues.length === 1 ? "one link is broken" : `${issues.length} links are broken`}
            </p>
            <ul className="mt-1.5 space-y-1">
              {issues.map((i) => (
                <li key={i} className="font-mono text-[11px] leading-relaxed break-words text-ink">
                  <span className="text-fail">✕</span> {i}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Dialog>
  );
}
