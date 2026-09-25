/**
 * Share links: a whole run (chain reference, input, trace) packed into a URL
 * hash. deflate-raw + base64url, so no server storage and nothing to expire.
 * The hash never reaches the server either, which is a nice property for a
 * trace that might contain someone's group chat.
 */
import type { ChainDocument, Json, Trace } from "jevchain";

export interface SharePayload {
  v: 1;
  chain: { example: string } | { doc: ChainDocument };
  input: Json;
  trace: Trace;
}

export const SHARE_PATH = "/studio/share";

export class ShareDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ShareDecodeError";
  }
}

export async function encodeShare(payload: SharePayload): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  return toBase64Url(await pipe(bytes, new CompressionStream("deflate-raw")));
}

export async function decodeShare(encoded: string): Promise<SharePayload> {
  const clean = encoded.replace(/^#/, "").trim();
  if (!clean) throw new ShareDecodeError("this link has no run in it. the part after # is empty.");
  let bytes: Uint8Array;
  try {
    bytes = fromBase64Url(clean);
  } catch {
    throw new ShareDecodeError("this link got mangled in transit (it isn't valid base64url).");
  }
  let text: string;
  try {
    text = new TextDecoder().decode(await pipe(bytes, new DecompressionStream("deflate-raw")));
  } catch {
    throw new ShareDecodeError("this link is truncated or corrupted. whoever sent it may have copied half of it.");
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ShareDecodeError("this link decompressed into something that isn't JSON.");
  }
  return validatePayload(data);
}

export function shareUrl(origin: string, encoded: string): string {
  return `${origin}${SHARE_PATH}#${encoded}`;
}

function validatePayload(data: unknown): SharePayload {
  if (!data || typeof data !== "object") throw new ShareDecodeError("this link doesn't contain a run.");
  const d = data as Partial<SharePayload>;
  if (d.v !== 1) throw new ShareDecodeError(`this link is from a newer (or older) studio: format v${String(d.v)}.`);
  const chain = d.chain as Record<string, unknown> | undefined;
  if (!chain || (typeof chain.example !== "string" && (typeof chain.doc !== "object" || chain.doc === null))) {
    throw new ShareDecodeError("this link doesn't say which chain it ran.");
  }
  const t = d.trace as Partial<Trace> | undefined;
  if (!t || !Array.isArray(t.spans) || typeof t.status !== "string") throw new ShareDecodeError("this link has no trace in it.");
  return d as SharePayload;
}

async function pipe(bytes: Uint8Array, transform: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(transform);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(s: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/.test(s)) throw new Error("invalid base64url");
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
