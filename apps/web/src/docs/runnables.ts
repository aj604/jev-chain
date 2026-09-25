/**
 * Everything a docs page can "run": the five gallery examples plus the small
 * docs chains. One lookup by id, whichever registry it lives in.
 */
import type { AnyNode, Json } from "jevchain";
import { examples, getExample } from "jevchain-examples";
import { docChains, getDocChain } from "./chains";

export interface Runnable {
  id: string;
  source: "example" | "docs";
  title: string;
  tagline: string;
  chain: AnyNode;
  inputs: { label: string; value: Json }[];
  /** Where to read more: the gallery page for examples, the docs page for docs chains. */
  href: string;
}

export function getRunnable(id: string): Runnable | undefined {
  const ex = getExample(id);
  if (ex) {
    return { id, source: "example", title: ex.title, tagline: ex.tagline, chain: ex.chain, inputs: ex.inputs, href: `/examples/${ex.slug}` };
  }
  const dc = getDocChain(id);
  if (dc) return { id, source: "docs", title: dc.title, tagline: dc.tagline, chain: dc.chain, inputs: dc.inputs, href: dc.page };
  return undefined;
}

export const RUNNABLE_IDS = [...examples.map((e) => e.slug), ...docChains.map((c) => c.id)];
