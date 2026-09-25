import type { Json } from "jevchain";

/**
 * Deep link into the studio: `/studio?example=<id>&input=<text or JSON>`.
 * Strings go as-is; anything else is JSON-encoded. `id` is a gallery slug or a
 * docs chain id (`docs-…`).
 */
export function studioHref(id: string, input?: Json): string {
  const params = new URLSearchParams({ example: id });
  if (input !== undefined) params.set("input", typeof input === "string" ? input : JSON.stringify(input));
  return `/studio?${params.toString()}`;
}

/** One-line preview of an input value for lists. */
export function previewInput(value: Json, max = 96): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
