import type { AnyNode, Json } from "jevchain";

/** Everything the gallery needs to show and run an example. */
export interface Example {
  /** URL slug and file name. */
  slug: string;
  title: string;
  /** One-line hook. */
  tagline: string;
  /** The composition pattern this example teaches. */
  pattern: string;
  /** Why the pattern matters, in a sentence or two. */
  lesson: string;
  chain: AnyNode;
  /** Sample inputs, first one is the default. */
  inputs: { label: string; value: Json }[];
  /** Source file, relative to packages/examples/src. */
  file: string;
}
