"use client";

/**
 * Builder drafts, autosaved to localStorage. Every access is wrapped: private
 * windows, full quotas and blocked storage just mean drafts don't persist.
 *
 * Handlers (step code) can't be stored, so a draft forked from an example
 * remembers the example's slug and re-binds its handlers on open.
 */
import { useSyncExternalStore } from "react";
import { CHAIN_FORMAT, type ChainDocument } from "jevchain";

export interface Draft {
  id: string;
  name: string;
  doc: ChainDocument;
  /** The example this was forked from, to re-bind step handlers. */
  forkedFrom?: string;
  updatedAt: number;
}

export const DRAFTS_KEY = "jevchain.builder.drafts";
const CHANGE_EVENT = "jevchain:drafts";
export const MAX_DRAFTS = 30;

export type DraftStore = Pick<Storage, "getItem" | "setItem">;

function browserStore(): DraftStore | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function isDraft(x: unknown): x is Draft {
  if (!x || typeof x !== "object") return false;
  const d = x as Draft;
  return typeof d.id === "string" && typeof d.name === "string" && typeof d.updatedAt === "number" && d.doc?.format === CHAIN_FORMAT && !!d.doc.root;
}

let cache: { raw: string | null; drafts: Draft[] } = { raw: null, drafts: [] };
const EMPTY: Draft[] = [];

export function listDrafts(store: DraftStore | null = browserStore()): Draft[] {
  if (!store) return EMPTY;
  let raw: string | null;
  try {
    raw = store.getItem(DRAFTS_KEY);
  } catch {
    return EMPTY;
  }
  if (raw === cache.raw) return cache.drafts;
  let drafts: Draft[] = [];
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    drafts = Array.isArray(parsed) ? parsed.filter(isDraft).sort((a, b) => b.updatedAt - a.updatedAt) : [];
  } catch {
    drafts = [];
  }
  cache = { raw, drafts };
  return drafts;
}

function write(drafts: Draft[], store: DraftStore | null): boolean {
  if (!store) return false;
  try {
    store.setItem(DRAFTS_KEY, JSON.stringify(drafts.slice(0, MAX_DRAFTS)));
  } catch {
    return false;
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(CHANGE_EVENT));
  return true;
}

/** Insert or update a draft (newest first). False if storage refused. */
export function saveDraft(draft: Draft, store: DraftStore | null = browserStore()): boolean {
  return write([draft, ...listDrafts(store).filter((d) => d.id !== draft.id)], store);
}

export function renameDraft(id: string, name: string, store: DraftStore | null = browserStore()): boolean {
  const drafts = listDrafts(store);
  if (!drafts.some((d) => d.id === id)) return false;
  return write(
    drafts.map((d) => (d.id === id ? { ...d, name, doc: { ...d.doc, name } } : d)),
    store,
  );
}

export function deleteDraft(id: string, store: DraftStore | null = browserStore()): boolean {
  return write(
    listDrafts(store).filter((d) => d.id !== id),
    store,
  );
}

export function newDraftId(): string {
  return `draft_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function subscribe(onChange: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === DRAFTS_KEY) onChange();
  };
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onStorage);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onStorage);
  };
}

export function useDrafts(): Draft[] {
  return useSyncExternalStore(subscribe, () => listDrafts(), () => EMPTY);
}
