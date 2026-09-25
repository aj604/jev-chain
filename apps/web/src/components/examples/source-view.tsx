import { tokenize, TOKEN_COLORS, type TokenKind } from "@/components/ui/code-block";
import { cn } from "@/lib/cn";

/**
 * A whole source file with line numbers and linkable lines (`#L12`).
 * Tokenizes the file once, then splits tokens at newlines so multi-line
 * comments keep their colour on every line.
 */
export function SourceView({ code, highlight = [], className }: { code: string; highlight?: number[]; className?: string }) {
  const lines: Array<Array<{ kind: TokenKind; text: string }>> = [[]];
  for (const t of tokenize(code.replace(/\n$/, ""))) {
    const parts = t.text.split("\n");
    parts.forEach((text, i) => {
      if (i > 0) lines.push([]);
      if (text) lines[lines.length - 1]!.push({ kind: t.kind, text });
    });
  }
  const marked = new Set(highlight);
  const gutter = String(lines.length).length;

  return (
    <div className={cn("overflow-x-auto py-3 font-mono text-[12.5px] leading-[1.7]", className)}>
      <pre className="min-w-max">
        <code>
          {lines.map((tokens, i) => {
            const n = i + 1;
            return (
              <div
                key={n}
                id={`L${n}`}
                className={cn(
                  "group/line grid scroll-mt-[calc(var(--nav-h)+5rem)] grid-cols-[auto_1fr] pr-6 target:bg-accent-wash",
                  marked.has(n) && "bg-surface-2",
                )}
              >
                <a
                  href={`#L${n}`}
                  aria-label={`line ${n}`}
                  className="border-soft-r pr-3 pl-4 text-right text-ink-3 tabular-nums select-none hover:text-ink group-target/line:border-r-accent group-target/line:text-accent-strong"
                  style={{ width: `calc(${gutter}ch + 1.75rem + var(--bw))` }}
                >
                  {n}
                </a>
                <span className="pl-4 whitespace-pre">
                  {tokens.length === 0
                    ? " "
                    : tokens.map((t, j) =>
                        t.kind === "plain" ? t.text : <span key={j} className={TOKEN_COLORS[t.kind]}>{t.text}</span>,
                      )}
                </span>
              </div>
            );
          })}
        </code>
      </pre>
    </div>
  );
}

/** 1-based line of the first occurrence of `needle` in `code`, or undefined. */
export function lineOf(code: string, needle: string): number | undefined {
  const i = code.indexOf(needle);
  return i === -1 ? undefined : code.slice(0, i).split("\n").length;
}
