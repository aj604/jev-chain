"use client";

/**
 * The document as code, live: TypeScript via `toTypeScript` (idiomatic
 * builder calls, not a JSON blob) or the raw `jevchain/v1` JSON.
 */
import { useMemo, useState } from "react";
import { toTypeScript, type ChainDocument } from "jevchain";
import { Code } from "@/components/ui/code-block";
import { CopyButton } from "@/components/ui/copy-button";
import { Kbd } from "@/components/ui/kbd";
import { Segmented } from "./fields";

export function CodeDrawer({ doc, onClose }: { doc: ChainDocument; onClose: () => void }) {
  const [lang, setLang] = useState<"ts" | "json">("ts");
  const code = useMemo(() => {
    if (lang === "json") return JSON.stringify(doc, null, 2);
    try {
      return toTypeScript(doc);
    } catch (e) {
      return `// couldn't generate code yet: ${e instanceof Error ? e.message : String(e)}`;
    }
  }, [doc, lang]);
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
            { value: "json", label: "json" },
          ]}
          value={lang}
          onChange={setLang}
        />
        <div className="ml-auto flex items-center gap-3">
          <CopyButton text={code} />
          <button type="button" onClick={onClose} className="flex items-center gap-1.5 font-mono text-[11px] lowercase text-ink-3 hover:text-ink" aria-label="close code">
            close <Kbd>e</Kbd>
          </button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto bg-surface">
        <Code code={code} className="px-4 py-3 text-[12px]" />
      </div>
      <p className="shrink-0 border-soft-t px-3 py-1.5 font-mono text-[10px] text-ink-3">
        {lang === "ts" ? "type-checks against jevchain. steps come out as TODO stubs; bring your own code." : "what toJSON() gives you. fromJSON() loads it back."}
      </p>
    </aside>
  );
}
