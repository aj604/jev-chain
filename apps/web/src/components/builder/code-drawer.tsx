"use client";

/**
 * The document as code, live: TypeScript via `toTypeScript` (idiomatic
 * builder calls, not a JSON blob, read-only) or the raw `jevchain/v1` JSON,
 * which you can edit and apply back onto the canvas (⌘↵, one undo step).
 *
 * The JSON being edited is a `JsonDraft` owned by the caller, so closing the
 * drawer doesn't throw away half an edit.
 */
import { useId, useMemo, useRef, useState } from "react";
import { toTypeScript, type ChainDocument } from "jevchain";
import { Code } from "@/components/ui/code-block";
import { CopyButton } from "@/components/ui/copy-button";
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/cn";
import { formatDocument, readDocumentEdit } from "@/lib/builder/json-edit";
import { Segmented } from "./fields";

/** JSON text being edited, and the document it started from (to notice the canvas moving underneath). */
export interface JsonDraft {
  text: string;
  base: ChainDocument;
}

export function CodeDrawer({
  doc,
  onClose,
  draft,
  setDraft,
  onApply,
}: {
  doc: ChainDocument;
  onClose: () => void;
  draft: JsonDraft | null;
  setDraft: (d: JsonDraft | null) => void;
  /** Put the edited document on the canvas. */
  onApply: (next: ChainDocument) => void;
}) {
  const [lang, setLang] = useState<"ts" | "json">(draft ? "json" : "ts");
  const area = useRef<HTMLTextAreaElement>(null);
  const statusId = useId();
  const ts = useMemo(() => {
    if (lang !== "ts") return "";
    try {
      return toTypeScript(doc);
    } catch (e) {
      return `// couldn't generate code yet: ${e instanceof Error ? e.message : String(e)}`;
    }
  }, [doc, lang]);
  const canvasJson = useMemo(() => (lang === "json" ? formatDocument(doc) : ""), [doc, lang]);
  const text = draft?.text ?? canvasJson;
  const read = useMemo(() => (draft ? readDocumentEdit(draft.text, doc) : null), [draft, doc]);
  const stale = Boolean(draft && draft.base !== doc);
  const canApply = Boolean(read?.ok && read.changed);

  const apply = () => {
    if (!read?.ok || !read.changed) return;
    onApply(read.doc);
    setDraft(null);
  };
  const jumpTo = (offset: number) => {
    const el = area.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(offset, Math.min(offset + 1, el.value.length));
  };

  return (
    <aside
      aria-label="code"
      className="fade-up absolute inset-y-0 right-0 z-20 flex w-[min(34rem,100%)] flex-col border-hard-l bg-paper shadow-[-6px_0_0_0_color-mix(in_oklab,var(--ink)_8%,transparent)]"
    >
      <header className="flex h-10 shrink-0 items-center gap-2 border-hard-b px-3">
        <span aria-hidden className="size-2 animate-pulse bg-accent" />
        <h2 className="font-mono text-[11px] lowercase text-ink">live code</h2>
        <Segmented
          size="xs"
          label="language"
          className="ml-2"
          options={[
            { value: "ts", label: "typescript" },
            { value: "json", label: draft ? "json ·edited" : "json", title: "edit the chain as json" },
          ]}
          value={lang}
          onChange={setLang}
        />
        <div className="ml-auto flex items-center gap-3">
          <CopyButton text={lang === "ts" ? ts : text} />
          <button type="button" onClick={onClose} className="flex items-center gap-1.5 font-mono text-[11px] lowercase text-ink-3 hover:text-ink" aria-label="close code">
            close <Kbd>e</Kbd>
          </button>
        </div>
      </header>
      {lang === "ts" ? (
        <>
          <div className="min-h-0 flex-1 overflow-auto bg-surface">
            <Code code={ts} className="px-4 py-3 text-[12px]" />
          </div>
          <p className="shrink-0 border-soft-t px-3 py-1.5 font-mono text-[10px] text-ink-3">
            type-checks against jevchain. steps come out as TODO stubs; bring your own code. read-only:{" "}
            <button type="button" onClick={() => setLang("json")} className="underline decoration-dotted underline-offset-2 hover:text-ink">
              edit the json
            </button>{" "}
            to change the chain here.
          </p>
        </>
      ) : (
        <>
          {stale && (
            <div role="alert" className="flex shrink-0 items-center gap-2 border-soft-b bg-surface-2 px-3 py-1.5 font-mono text-[10.5px] text-warn">
              <span>! the canvas changed since you started editing. applying replaces it (undo brings it back).</span>
              <button type="button" onClick={() => setDraft(null)} className="ml-auto shrink-0 lowercase text-ink-2 underline decoration-dotted underline-offset-2 hover:text-ink">
                load canvas version
              </button>
            </div>
          )}
          <textarea
            ref={area}
            aria-label="chain document json"
            aria-invalid={read ? !read.ok : undefined}
            aria-describedby={statusId}
            value={text}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            wrap="off"
            onChange={(e) => setDraft({ text: e.target.value, base: draft?.base ?? doc })}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                // ⌘↵ applies here instead of pulling the chain.
                e.preventDefault();
                apply();
              }
            }}
            className="min-h-0 flex-1 resize-none bg-surface px-4 py-3 font-mono text-[12px] leading-relaxed text-ink outline-none focus-visible:shadow-[inset_0_0_0_var(--bw)_var(--accent)]"
          />
          <div className="flex shrink-0 items-center gap-2 border-soft-t px-3 py-1.5">
            <JsonStatus id={statusId} read={read} jumpTo={jumpTo} />
            {draft && (
              <span className="ml-auto flex shrink-0 items-center gap-1">
                <button type="button" onClick={() => setDraft(null)} className="h-6 px-1.5 font-mono text-[10.5px] lowercase text-ink-3 hover:bg-surface-2 hover:text-ink">
                  discard
                </button>
                <button
                  type="button"
                  onClick={apply}
                  disabled={!canApply}
                  className="inline-flex h-6 items-center gap-1.5 border-hard bg-ink px-2 font-mono text-[10.5px] lowercase text-paper disabled:opacity-35"
                >
                  apply to canvas <span className="text-[9.5px] opacity-70">⌘↵</span>
                </button>
              </span>
            )}
          </div>
        </>
      )}
    </aside>
  );
}

function JsonStatus({ id, read, jumpTo }: { id: string; read: ReturnType<typeof readDocumentEdit> | null; jumpTo: (offset: number) => void }) {
  const base = "min-w-0 font-mono text-[10px] break-words";
  if (!read)
    return (
      <p id={id} className={cn(base, "text-ink-3")}>
        what toJSON() gives you. edit it and apply to change the chain; fromJSON() loads it back.
      </p>
    );
  if (!read.ok)
    return (
      <p id={id} role="status" className={cn(base, "text-fail")}>
        ✕ {read.error}
        {read.offset !== undefined && (
          <button type="button" onClick={() => jumpTo(read.offset!)} className="ml-1.5 text-ink-3 underline decoration-dotted underline-offset-2 hover:text-ink">
            go there
          </button>
        )}
        <span className="block text-ink-3">can&apos;t apply until this is fixed.</span>
      </p>
    );
  if (!read.changed)
    return (
      <p id={id} role="status" className={cn(base, "text-ink-3")}>
        same as the canvas. nothing to apply.
      </p>
    );
  const nodes = read.nodes.before === read.nodes.after ? `${read.nodes.after} nodes` : `${read.nodes.before} → ${read.nodes.after} nodes`;
  if (read.issues.length)
    return (
      <p id={id} role="status" className={cn(base, "text-warn")} title={read.issues.join("\n")}>
        ! {nodes} · applies with {read.issues.length} broken link{read.issues.length === 1 ? "" : "s"}: {read.issues[0]}
      </p>
    );
  return (
    <p id={id} role="status" className={cn(base, "text-pass")}>
      ✓ {nodes} · all links hold
    </p>
  );
}
