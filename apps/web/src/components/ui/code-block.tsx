import { cn } from "@/lib/cn";
import { CopyButton } from "./copy-button";
import { Panel, PanelDots } from "./panel";

/**
 * Server-rendered code block with a tiny, dependency-free TS highlighter.
 * Good enough for marketing snippets and docs; not a language server.
 */

export type TokenKind = "kw" | "str" | "com" | "num" | "fn" | "prop" | "type" | "punct" | "plain";

const KEYWORDS = new Set([
  "import", "from", "export", "const", "let", "var", "function", "return", "await", "async", "if", "else",
  "for", "of", "in", "new", "type", "interface", "extends", "as", "true", "false", "null", "undefined", "typeof",
]);

const TOKEN_RE =
  /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`)|(\b\d+(?:\.\d+)?\b)|([A-Za-z_$][\w$]*)|(\s+)|([^\sA-Za-z_$\d"'`/]+|\/)/g;

export function tokenize(code: string): Array<{ kind: TokenKind; text: string }> {
  const out: Array<{ kind: TokenKind; text: string }> = [];
  for (const m of code.matchAll(TOKEN_RE)) {
    const [text, com, str, num, ident] = m;
    let kind: TokenKind = "plain";
    if (com) kind = "com";
    else if (str) kind = "str";
    else if (num) kind = "num";
    else if (ident) {
      const rest = code.slice((m.index ?? 0) + text.length);
      if (KEYWORDS.has(ident)) kind = "kw";
      else if (/^\s*\(/.test(rest)) kind = "fn";
      else if (/^\s*:(?!:)/.test(rest)) kind = "prop";
      else if (/^[A-Z]/.test(ident)) kind = "type";
    } else if (m[6]) kind = "punct";
    out.push({ kind, text });
  }
  return out;
}

export const TOKEN_COLORS: Record<TokenKind, string> = {
  kw: "text-accent-strong",
  str: "text-pass",
  com: "text-ink-3 italic",
  num: "text-accent-strong",
  fn: "text-ink font-medium",
  prop: "text-ink-2",
  type: "text-ink",
  punct: "text-ink-3",
  plain: "text-ink",
};

export function Code({ code, className }: { code: string; className?: string }) {
  return (
    <pre className={cn("overflow-x-auto font-mono text-[12.5px] leading-[1.7]", className)}>
      <code>
        {tokenize(code).map((t, i) =>
          t.kind === "plain" ? t.text : <span key={i} className={TOKEN_COLORS[t.kind]}>{t.text}</span>,
        )}
      </code>
    </pre>
  );
}

export function CodeBlock({
  code,
  filename,
  className,
}: {
  code: string;
  filename?: string;
  className?: string;
}) {
  return (
    <Panel
      className={className}
      title={
        <>
          <PanelDots />
          {filename && <span className="ml-1 truncate">{filename}</span>}
        </>
      }
      actions={<CopyButton text={code} />}
    >
      <Code code={code} className="px-4 py-4" />
    </Panel>
  );
}
