import type { ReactNode } from "react";
import { Code } from "@/components/ui/code-block";
import { CopyButton } from "@/components/ui/copy-button";
import { PanelDots } from "@/components/ui/panel";

/**
 * A code block with numbered callouts: each note finds the first line (after
 * the previous note's line) containing `match`, pins a marker to it, and is
 * explained in the legend underneath. Server-only; no client JS.
 */
export interface Annotation {
  /** Substring of the line to mark. Searched after the previous annotation's line. */
  match: string;
  note: ReactNode;
}

function Marker({ n }: { n: number }) {
  return (
    <span className="inline-grid size-[18px] shrink-0 place-items-center border-hard bg-accent font-mono text-[10px] leading-none text-accent-ink">
      {n}
    </span>
  );
}

export function AnnotatedCode({
  code,
  notes,
  file,
}: {
  code: string;
  notes: Annotation[];
  file?: string;
}) {
  const lines = code.trim().split("\n");
  const marks = new Map<number, number>();
  let from = 0;
  notes.forEach((a, i) => {
    const at = lines.findIndex((l, j) => j >= from && l.includes(a.match));
    if (at === -1) throw new Error(`AnnotatedCode: no line containing ${JSON.stringify(a.match)} after line ${from + 1}`);
    marks.set(at, i + 1);
    from = at + 1;
  });

  return (
    <figure className="my-6 min-w-0 border-hard bg-surface">
      <header className="flex h-8 items-center justify-between gap-3 border-hard-b bg-paper px-3 font-mono text-[11px] lowercase text-ink-2">
        <span className="flex min-w-0 items-center gap-2 truncate">
          <PanelDots />
          {file && <span className="ml-1 truncate">{file}</span>}
        </span>
        <CopyButton text={code.trim()} />
      </header>
      <div className="overflow-x-auto py-4">
        <div className="w-max min-w-full">
          {lines.map((line, i) => {
            const n = marks.get(i);
            return (
              <div
                key={i}
                className={n ? "flex items-center gap-3 bg-accent-wash pr-4 pl-4 shadow-[inset_2px_0_0_0_var(--accent)]" : "flex items-center gap-3 px-4"}
              >
                <Code code={line || " "} className="overflow-visible" />
                {n !== undefined && <Marker n={n} />}
              </div>
            );
          })}
        </div>
      </div>
      <figcaption className="border-hard-t">
        <ol className="divide-y divide-line-soft">
          {notes.map((a, i) => (
            <li key={i} className="grid grid-cols-[18px_1fr] gap-3 px-4 py-3 text-[14px] leading-relaxed text-ink-2 [&_code]:font-mono [&_code]:text-[12.5px] [&_code]:text-ink [&_strong]:font-medium [&_strong]:text-ink">
              <span className="pt-0.5">
                <Marker n={i + 1} />
              </span>
              <div>{a.note}</div>
            </li>
          ))}
        </ol>
      </figcaption>
    </figure>
  );
}
