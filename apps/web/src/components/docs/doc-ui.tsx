import Link from "next/link";
import type { ReactNode } from "react";
import { ChainLinks } from "@/components/brand/chain-links";
import { Code, CodeBlock } from "@/components/ui/code-block";
import { CopyButton } from "@/components/ui/copy-button";
import { Panel, PanelDots } from "@/components/ui/panel";
import { docHref, getDocPage } from "@/docs/nav";
import { cn } from "@/lib/cn";
import { GITHUB_BLOB } from "@/lib/github";

/**
 * The small set of pieces every docs page is built from. Plain server
 * components: no MDX, no client JS, just typed props.
 */

// ── page frame ──────────────────────────────────────────────────────────────

/** Header (section, title, lede) + content + prev/next, all driven by nav.ts. */
export function DocPage({ slug, children }: { slug: string; children: ReactNode }) {
  const { page, prev, next } = getDocPage(slug);
  const file = `apps/web/src/app/docs${slug ? `/${slug}` : ""}/page.tsx`;
  return (
    <article className="min-w-0">
      <header className="border-soft-b pb-8">
        <div className="flex items-center gap-3 font-mono text-[11px] lowercase text-ink-3">
          <ChainLinks count={3} progress={1} size={10} />
          <span>docs / {page.section}</span>
        </div>
        <h1
          className={cn(
            "mt-5 text-[clamp(2.5rem,6vw,3.75rem)] leading-[0.95] tracking-[-0.01em]",
            page.mono ? "font-mono text-[clamp(2.1rem,5vw,3.1rem)] tracking-[-0.03em]" : "font-display italic",
          )}
        >
          {page.title}
          <span className="text-accent">{page.mono ? "()" : "."}</span>
        </h1>
        <p className="mt-5 max-w-2xl text-lg leading-relaxed text-ink-2">{page.description}</p>
      </header>

      {/* The header already ends in a rule; a leading H2 shouldn't draw a second one. */}
      <div
        data-doc-content
        className="doc-content pt-2 [&>h2:first-child]:mt-8 [&>h2:first-child]:border-t-0 [&>h2:first-child]:pt-0"
      >
        {children}
      </div>

      <footer className="mt-16 space-y-6">
        <nav aria-label="previous and next page" className="grid grid-cols-1 gap-(--bw) border-hard bg-line sm:grid-cols-2">
          {prev ? <PrevNext dir="prev" slug={prev.slug} title={prev.nav ?? prev.title} mono={prev.mono} /> : <span className="hidden bg-paper sm:block" />}
          {next ? <PrevNext dir="next" slug={next.slug} title={next.nav ?? next.title} mono={next.mono} /> : <span className="hidden bg-paper sm:block" />}
        </nav>
        <p className="font-mono text-[11px] lowercase text-ink-3">
          found a mistake?{" "}
          <a
            href={`${GITHUB_BLOB}/${file}`}
            target="_blank"
            rel="noreferrer noopener"
            className="text-ink-2 underline decoration-line-soft underline-offset-4 hover:text-ink hover:decoration-accent"
          >
            edit this page on github ↗
          </a>
        </p>
      </footer>
    </article>
  );
}

function PrevNext({ dir, slug, title, mono }: { dir: "prev" | "next"; slug: string; title: string; mono?: boolean }) {
  return (
    <Link
      href={docHref(slug)}
      className={cn(
        "group flex flex-col gap-1.5 bg-paper px-5 py-4 transition-colors duration-(--dur-fast) hover:bg-surface-2",
        dir === "next" && "sm:items-end sm:text-right",
      )}
    >
      <span className="font-mono text-[11px] lowercase text-ink-3">{dir === "prev" ? "← previous" : "next →"}</span>
      <span className={cn("text-[17px] text-ink group-hover:underline group-hover:decoration-accent group-hover:underline-offset-4", mono ? "font-mono text-[15px]" : "font-medium")}>
        {title}
      </span>
    </Link>
  );
}

// ── headings + prose ────────────────────────────────────────────────────────

function Anchor({ id }: { id: string }) {
  return (
    <a
      href={`#${id}`}
      aria-label="link to this section"
      className="ml-2 font-mono text-[0.7em] text-ink-3 no-underline opacity-0 transition-opacity duration-(--dur-fast) group-hover/h:opacity-100 focus-visible:opacity-100 hover:text-accent-strong"
    >
      #
    </a>
  );
}

/** Section heading. `id` must match nav.ts (the test checks). */
export function H2({ id, children, mono }: { id: string; children: ReactNode; mono?: boolean }) {
  return (
    <h2
      id={id}
      className={cn(
        "group/h mt-14 mb-4 scroll-mt-[calc(var(--nav-h)+1.5rem)] flex items-baseline border-soft-t pt-8 text-[1.75rem] leading-tight text-ink",
        mono ? "font-mono text-[1.4rem] tracking-tight" : "font-display italic",
      )}
    >
      {children}
      <Anchor id={id} />
    </h2>
  );
}

export function H3({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h3 id={id} className="group/h mt-9 mb-3 scroll-mt-[calc(var(--nav-h)+1.5rem)] flex items-baseline font-mono text-[15px] text-ink">
      {children}
      <Anchor id={id} />
    </h3>
  );
}

export function P({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("my-4 max-w-[68ch] text-[15.5px] leading-[1.75] text-ink-2 [&_strong]:font-medium [&_strong]:text-ink", className)}>{children}</p>;
}

/** Inline code. */
export function C({ children }: { children: ReactNode }) {
  return <code className="border-soft bg-surface-2 px-1 py-px font-mono text-[0.86em] text-ink">{children}</code>;
}

/** Inline link; external hrefs open in a new tab. */
export function A({ href, children }: { href: string; children: ReactNode }) {
  const external = /^https?:\/\//.test(href);
  const cls = "text-ink underline decoration-accent decoration-[1.5px] underline-offset-[3px] transition-colors hover:bg-accent-wash";
  return external ? (
    <a href={href} target="_blank" rel="noreferrer noopener" className={cls}>
      {children}
    </a>
  ) : (
    <Link href={href} className={cls}>
      {children}
    </Link>
  );
}

/** Bulleted list with the house pink squares. */
export function List({ children, ordered }: { children: ReactNode; ordered?: boolean }) {
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag
      className={cn(
        "my-5 max-w-[68ch] space-y-2.5 text-[15.5px] leading-[1.7] text-ink-2 [&_strong]:font-medium [&_strong]:text-ink",
        ordered && "[counter-reset:li]",
      )}
    >
      {children}
    </Tag>
  );
}

export function Li({ children }: { children: ReactNode }) {
  return (
    <li className="relative pl-5 before:absolute before:top-[0.72em] before:left-0.5 before:size-1.5 before:bg-accent">
      {children}
    </li>
  );
}

// ── callouts ────────────────────────────────────────────────────────────────

const CALLOUT = {
  note: { label: "note", box: "border-hard bg-surface", tag: "bg-ink text-paper" },
  tip: { label: "tip", box: "border-(length:--bw) border-pass bg-pass-wash", tag: "bg-pass text-paper" },
  warn: { label: "careful", box: "border-(length:--bw) border-warn bg-warn-wash", tag: "bg-warn text-accent-ink" },
  jev: { label: "jev says", box: "border-hard bg-accent-wash", tag: "bg-accent text-accent-ink" },
} as const;

export function Callout({
  tone = "note",
  title,
  children,
}: {
  tone?: keyof typeof CALLOUT;
  title?: ReactNode;
  children: ReactNode;
}) {
  const t = CALLOUT[tone];
  return (
    <aside className={cn("my-6 max-w-[72ch] px-4 py-3.5", t.box)}>
      <div className="flex items-center gap-2.5">
        <span className={cn("px-1.5 py-0.5 font-mono text-[10px] leading-none lowercase", t.tag)}>{t.label}</span>
        {title && <span className="font-mono text-[13px] text-ink">{title}</span>}
      </div>
      <div className="mt-2 text-[14.5px] leading-relaxed text-ink-2 [&_p]:my-2 [&_strong]:font-medium [&_strong]:text-ink">{children}</div>
    </aside>
  );
}

// ── code ────────────────────────────────────────────────────────────────────

/** A code block with a filename bar and copy button. */
export function Snippet({ code, file, className }: { code: string; file?: string; className?: string }) {
  return <CodeBlock code={code.trim()} filename={file} className={cn("my-6 min-w-0", className)} />;
}

/** A one-line shell command with a prompt and copy. */
export function Shell({ cmd }: { cmd: string }) {
  return (
    <div className="my-4 flex max-w-full items-center gap-3 overflow-x-auto border-soft bg-surface px-4 py-2.5 font-mono text-[13px]">
      <span aria-hidden className="text-ink-3">$</span>
      <span className="flex-1 whitespace-pre text-ink">{cmd}</span>
      <CopyButton text={cmd} />
    </div>
  );
}

/**
 * What `tsc` says when you get it wrong: the code, the offending line
 * underlined, and the compiler's actual message underneath.
 */
export function CompileError({
  code,
  line,
  error,
  file = "chain.ts",
}: {
  code: string;
  /** 1-based line to underline. */
  line: number;
  /** The diagnostic, verbatim. */
  error: string;
  file?: string;
}) {
  const lines = code.trim().split("\n");
  return (
    <Panel
      className="my-6 min-w-0"
      title={
        <>
          <PanelDots />
          <span className="ml-1 truncate">{file}</span>
        </>
      }
      actions={<span className="font-mono text-[11px] text-fail">✗ tsc</span>}
    >
      <div className="overflow-x-auto px-4 py-4">
        {lines.map((l, i) => (
          <div key={i} className={cn(i + 1 === line && "decoration-fail [&_code]:underline [&_code]:decoration-wavy [&_code]:decoration-fail [&_code]:underline-offset-[5px]")}>
            <Code code={l || " "} className="overflow-visible" />
          </div>
        ))}
      </div>
      <pre className="overflow-x-auto border-hard-t bg-fail-wash px-4 py-3 font-mono text-[12px] leading-relaxed whitespace-pre-wrap text-fail">
        {error.trim()}
      </pre>
    </Panel>
  );
}

// ── tables ──────────────────────────────────────────────────────────────────

export interface ApiRow {
  name: string;
  type?: string;
  default?: string;
  children: ReactNode;
}

/** Options / fields reference table. Stacks into cards on narrow screens. */
export function ApiTable({ rows, caption }: { rows: ApiRow[]; caption?: string }) {
  const hasDefault = rows.some((r) => r.default);
  return (
    <div className="my-6 border-hard">
      {caption && (
        <div className="border-hard-b bg-paper px-4 py-2 font-mono text-[11px] lowercase text-ink-3">{caption}</div>
      )}
      <table className="w-full border-collapse text-left">
        <thead className="hidden md:table-header-group">
          <tr className="border-soft-b font-mono text-[11px] lowercase text-ink-3">
            <th className="px-4 py-2 font-normal">name</th>
            <th className="px-4 py-2 font-normal">type</th>
            {hasDefault && <th className="px-4 py-2 font-normal">default</th>}
            <th className="px-4 py-2 font-normal">what it does</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className="flex flex-col gap-1 border-soft-b px-4 py-3 last:border-b-0 md:table-row md:px-0 md:py-0">
              <td className="align-top font-mono text-[13px] whitespace-nowrap text-ink md:px-4 md:py-3">{r.name}</td>
              <td className="align-top font-mono text-[12px] text-accent-strong md:px-4 md:py-3">{r.type}</td>
              {hasDefault && (
                <td className={cn("align-top font-mono text-[12px] text-ink-3 md:table-cell md:px-4 md:py-3", !r.default && "hidden")}>
                  {r.default && <span className="md:hidden">default </span>}
                  {r.default ?? "—"}
                </td>
              )}
              <td className="align-top text-[14px] leading-relaxed text-ink-2 md:px-4 md:py-3 [&_code]:font-mono [&_code]:text-[12.5px] [&_code]:text-ink">
                {r.children}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── steps ───────────────────────────────────────────────────────────────────

/** Numbered steps on a chain rail. */
export function Steps({ children }: { children: ReactNode }) {
  return <ol className="my-8 space-y-0">{children}</ol>;
}

export function Step({ n, title, children, last }: { n: number; title: ReactNode; children: ReactNode; last?: boolean }) {
  return (
    <li className="relative grid grid-cols-[2rem_minmax(0,1fr)] gap-4">
      <div className="flex flex-col items-center">
        <span className="grid size-7 place-items-center border-hard bg-accent font-mono text-[11px] text-accent-ink">{n}</span>
        {!last && <span aria-hidden className="w-(--bw) flex-1 bg-ink" />}
      </div>
      <div className={cn("min-w-0", !last && "pb-8")}>
        <div className="pt-1 font-mono text-[14px] text-ink">{title}</div>
        <div className="[&>*:first-child]:mt-3">{children}</div>
      </div>
    </li>
  );
}

// ── a two-up for comparisons ────────────────────────────────────────────────

export function TwoUp({ children }: { children: ReactNode }) {
  return <div className="my-6 grid grid-cols-1 gap-(--bw) border-hard bg-line md:grid-cols-2 [&>*]:min-w-0 [&>*]:bg-paper">{children}</div>;
}

export function Cell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="p-4">
      <div className="mb-3 font-mono text-[11px] lowercase text-ink-3">{label}</div>
      <div className="text-[14px] leading-relaxed text-ink-2">{children}</div>
    </div>
  );
}
