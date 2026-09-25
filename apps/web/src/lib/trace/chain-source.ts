/**
 * Where the chain on screen came from: a bundled example, or a ChainDocument
 * (imported JSON today, the builder tomorrow). Everything downstream (graph,
 * run, share links, saved runs) works off this one value.
 */
import { ChainConfigError, fromJSON, toJSON, type AnyNode, type ChainDocument, type Handler, type Json } from "jevchain";
import { examples, getExample, type Example } from "jevchain-examples";
import { getRunnable } from "@/docs/runnables";

/**
 * `example` slugs resolve through the gallery *and* the docs chains
 * (`docs-…` ids). `doc` chains may carry live `handlers` (e.g. from
 * `handlersOf(chain)`); without them, steps pass their input through.
 */
export type ChainSource = { kind: "example"; slug: string } | { kind: "doc"; doc: ChainDocument; handlers?: Record<string, Handler> };

export interface ResolvedChain {
  source: ChainSource;
  node: AnyNode;
  title: string;
  /** Pattern tag, for examples. */
  pattern?: string;
  /** Where to read more (gallery page or docs page). */
  href?: string;
  /** "docs" for chains that live in the docs, not the gallery. */
  origin: "example" | "docs" | "custom";
  tagline?: string;
  inputs: { label: string; value: Json }[];
  example?: Example;
}

export type ResolveResult = { ok: true; chain: ResolvedChain } | { ok: false; issues: string[] };

export const DEFAULT_SLUG = examples[0]!.slug;

export function resolveChain(source: ChainSource): ResolveResult {
  if (source.kind === "example") {
    const ex = getExample(source.slug);
    if (ex) {
      return {
        ok: true,
        chain: { source, node: ex.chain, title: ex.title, pattern: ex.pattern, tagline: ex.tagline, inputs: ex.inputs, example: ex, href: `/examples/${ex.slug}`, origin: "example" },
      };
    }
    const r = getRunnable(source.slug);
    if (!r) return { ok: false, issues: [`no example called "${source.slug}"`] };
    return { ok: true, chain: { source, node: r.chain, title: r.title, tagline: r.tagline, inputs: r.inputs, href: r.href, origin: "docs" } };
  }
  try {
    const node = fromJSON(source.doc, { missingHandlers: "passthrough", ...(source.handlers ? { handlers: source.handlers } : {}) }) as AnyNode;
    const examplesIn = Array.isArray(source.doc.examples) ? source.doc.examples : [];
    return {
      ok: true,
      chain: {
        source,
        node,
        title: source.doc.name ?? node.title ?? node.id,
        ...(source.doc.description ? { tagline: source.doc.description } : {}),
        inputs: examplesIn.map((value, i) => ({ label: `example ${i + 1}`, value })),
        origin: "custom",
      },
    };
  } catch (e) {
    return { ok: false, issues: configIssues(e) };
  }
}

/** Parse pasted/uploaded text into a ChainDocument, with human-readable issues on failure. */
export function parseChainDocument(text: string): { ok: true; doc: ChainDocument; chain: ResolvedChain } | { ok: false; issues: string[] } {
  if (!text.trim()) return { ok: false, issues: ["paste a chain document (JSON) first"] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return { ok: false, issues: [`not valid JSON: ${e instanceof Error ? e.message : String(e)}`] };
  }
  const doc = parsed as ChainDocument;
  const r = resolveChain({ kind: "doc", doc });
  if (!r.ok) return r;
  return { ok: true, doc, chain: r.chain };
}

export function configIssues(e: unknown): string[] {
  if (e instanceof ChainConfigError) return [...e.issues];
  if (e instanceof Error) return [e.message];
  return [String(e)];
}

/** The document for whatever's on screen (for export, and for sharing custom chains). */
export function documentOf(chain: ResolvedChain): ChainDocument {
  if (chain.source.kind === "doc") return chain.source.doc;
  return toJSON(chain.node, {
    name: chain.title,
    ...(chain.tagline ? { description: chain.tagline } : {}),
    examples: chain.inputs.map((i) => i.value),
  });
}

/** Stable key for memoizing per chain. */
export function sourceKey(source: ChainSource): string {
  return source.kind === "example" ? `example:${source.slug}` : `doc:${hash(JSON.stringify(source.doc))}`;
}

function hash(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
