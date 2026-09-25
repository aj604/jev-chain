/**
 * The docs' table of contents: sections, pages, and each page's H2s.
 *
 * The sidebar, prev/next links, page headers and the `/` search all read from
 * here. `nav.test.ts` checks every heading listed below exists as an
 * `<H2 id="…">` in its page (and vice versa), so this can't drift.
 */
import type { Metadata } from "next";

export interface DocHeading {
  id: string;
  title: string;
}

export interface DocPageMeta {
  /** Route segment under /docs ("" is the introduction). */
  slug: string;
  title: string;
  /** Short label for the sidebar, when it differs from the title. */
  nav?: string;
  /** Rendered in mono in the sidebar (API names). */
  mono?: boolean;
  /** One-sentence lede under the title; also the meta description. */
  description: string;
  headings: DocHeading[];
}

export interface DocSection {
  title: string;
  pages: DocPageMeta[];
}

export const DOC_SECTIONS: DocSection[] = [
  {
    title: "start here",
    pages: [
      {
        slug: "",
        title: "Introduction",
        description:
          "Jev answers typed questions with calibrated probabilities. JevChain composes those answers into programs you can read, type-check and replay.",
        headings: [
          { id: "what-is-jev", title: "What Jev is" },
          { id: "what-jevchain-adds", title: "What JevChain adds" },
          { id: "quickstart", title: "Thirty-second quickstart" },
          { id: "mental-model", title: "The mental model" },
          { id: "where-next", title: "Where next" },
        ],
      },
      {
        slug: "questions",
        title: "Questions",
        description: "Three question types, typed answers, and one number for “how sure”.",
        headings: [
          { id: "three-types", title: "The three types" },
          { id: "choice", title: "choice" },
          { id: "score", title: "score" },
          { id: "noul", title: "noul" },
          { id: "inferred-types", title: "Inferred answer types" },
          { id: "confidence", title: "Confidence" },
        ],
      },
    ],
  },
  {
    title: "building blocks",
    pages: [
      {
        slug: "ask",
        title: "ask",
        mono: true,
        description: "One Jev call, any number of questions about the same input. Outputs the typed answers.",
        headings: [
          { id: "one-call", title: "One call, many questions" },
          { id: "state", title: "Choosing the state" },
          { id: "typed-output", title: "Typed output" },
          { id: "when", title: "When to reach for it" },
        ],
      },
      {
        slug: "route",
        title: "route",
        mono: true,
        description: "Branch on a choice. Every label needs a branch, and the compiler checks.",
        headings: [
          { id: "basics", title: "Basics" },
          { id: "exhaustive", title: "Exhaustive at compile time" },
          { id: "low-confidence", title: "Low confidence" },
          { id: "also-ask", title: "alsoAsk" },
          { id: "nesting", title: "Nesting" },
        ],
      },
      {
        slug: "gate",
        title: "gate",
        mono: true,
        description: "Continue only when a number clears a bar. Give close calls their own path, or halt.",
        headings: [
          { id: "basics", title: "Basics" },
          { id: "thresholds", title: "Thresholds per question type" },
          { id: "unsure", title: "The unsure band" },
          { id: "halting", title: "Halting" },
        ],
      },
      {
        slug: "parallel",
        title: "parallel",
        mono: true,
        description: "Run branches concurrently, then join. Same-state asks ride in a single request.",
        headings: [
          { id: "basics", title: "Basics" },
          { id: "join", title: "Joining results" },
          { id: "batching", title: "Automatic batching" },
          { id: "failures", title: "When a branch fails" },
        ],
      },
      {
        slug: "cascade",
        title: "cascade",
        mono: true,
        description: "Ask cheaply first. Escalate only when Jev isn't confident, then fall back to anything.",
        headings: [
          { id: "basics", title: "Basics" },
          { id: "tiers", title: "Tiers" },
          { id: "fallback", title: "The fallback" },
          { id: "result", title: "Reading the result" },
        ],
      },
      {
        slug: "step-and-emit",
        title: "step & emit",
        mono: true,
        description: "Your code as a node, and constant or templated leaves.",
        headings: [
          { id: "step", title: "step" },
          { id: "context", title: "StepContext" },
          { id: "retries", title: "Retries and timeouts" },
          { id: "emit", title: "emit" },
          { id: "templates", title: "Templates" },
        ],
      },
      {
        slug: "chain",
        title: "chain",
        mono: true,
        description: "Sequence nodes, each output feeding the next input. Chains are nodes, so they nest.",
        headings: [
          { id: "sequencing", title: "Sequencing" },
          { id: "types", title: "Types across the links" },
          { id: "nesting", title: "Nesting" },
          { id: "limits", title: "Seven links, then nest" },
        ],
      },
    ],
  },
  {
    title: "running & inspecting",
    pages: [
      {
        slug: "running",
        title: "Running",
        description: "Create a client, run a chain, stream its events. Runs don't throw; they report.",
        headings: [
          { id: "create-jev", title: "createJev" },
          { id: "run", title: "run" },
          { id: "statuses", title: "Statuses" },
          { id: "stream", title: "Streaming" },
          { id: "cancellation", title: "Cancellation and deadlines" },
        ],
      },
      {
        slug: "traces",
        title: "Traces",
        description: "Every run leaves plain JSON: every question, every distribution, every branch not taken.",
        headings: [
          { id: "anatomy", title: "Anatomy of a trace" },
          { id: "decisions", title: "Decisions" },
          { id: "explain", title: "explainTrace" },
          { id: "diff", title: "diffTraces" },
          { id: "graph", title: "graphOf and overlayTrace" },
        ],
      },
      {
        slug: "serialization",
        title: "Serialization",
        description: "Chains are data. JSON in, JSON out, and TypeScript back out again.",
        headings: [
          { id: "to-json", title: "toJSON" },
          { id: "from-json", title: "fromJSON and handlers" },
          { id: "format", title: "The jevchain/v1 format" },
          { id: "codegen", title: "toTypeScript" },
        ],
      },
    ],
  },
  {
    title: "reference",
    pages: [
      {
        slug: "errors",
        title: "Errors",
        description: "One base class, stable codes, and a clear next move for each.",
        headings: [
          { id: "base-class", title: "One base class" },
          { id: "table", title: "Every error" },
          { id: "chain-errors", title: "NodeError and ChainConfigError" },
          { id: "handling", title: "Handling them" },
        ],
      },
      {
        slug: "proxy",
        title: "Using the proxy / BYOK",
        nav: "Proxy & BYOK",
        description: "How this site keeps the TypeSafe key on the server, and how to bring your own.",
        headings: [
          { id: "why", title: "Why a proxy" },
          { id: "wiring", title: "Pointing the client at it" },
          { id: "byok", title: "Bring your own key" },
          { id: "rate-limits", title: "Rate limiting" },
        ],
      },
    ],
  },
];

export const DOC_PAGES: (DocPageMeta & { section: string })[] = DOC_SECTIONS.flatMap((s) =>
  s.pages.map((p) => ({ ...p, section: s.title })),
);

export const docHref = (slug: string, hash?: string) => `/docs${slug ? `/${slug}` : ""}${hash ? `#${hash}` : ""}`;

export function getDocPage(slug: string) {
  const i = DOC_PAGES.findIndex((p) => p.slug === slug);
  if (i === -1) throw new Error(`docs: no page "${slug}" in nav.ts`);
  return { page: DOC_PAGES[i]!, prev: DOC_PAGES[i - 1], next: DOC_PAGES[i + 1] };
}

export function docMetadata(slug: string): Metadata {
  const { page } = getDocPage(slug);
  return { title: slug ? `${page.title} · docs` : "docs", description: page.description };
}
