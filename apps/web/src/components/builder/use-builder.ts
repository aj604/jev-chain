"use client";

/**
 * useBuilder: the working document, its undo stack, its step handlers, and
 * its autosaved draft.
 *
 *   const b = useBuilder();
 *   b.open({ doc, handlers, forkedFrom: "triage" });
 *   b.commit(withRoot(b.doc, nextRoot), "title@$/0");   // keyed commits coalesce
 *   b.undo(); b.redo(); b.saveNow();
 *
 * A draft is written once the document differs from what was opened (or on
 * an explicit save), so peeking at an example in build mode doesn't litter
 * the drafts list.
 */
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { ChainDocument, Handler } from "jevchain";
import { newDocument } from "@/lib/builder/doc-ops";
import { newDraftId, saveDraft } from "@/lib/builder/drafts";
import { historyReducer, initHistory, type History, type HistoryAction } from "@/lib/builder/history";

export interface OpenOptions {
  doc: ChainDocument;
  handlers?: Record<string, Handler>;
  forkedFrom?: string;
  /** Reopen an existing draft instead of starting a new one. */
  draftId?: string;
  /** Save a draft right away (imports), instead of on first edit. */
  persist?: boolean;
}

interface Session {
  draftId: string;
  handlers: Record<string, Handler>;
  forkedFrom?: string;
  /** The document as opened; autosave starts once we've moved off it. */
  baseline: ChainDocument;
  persisted: boolean;
}

type State = { history: History<ChainDocument>; session: Session | null };

type Action = HistoryAction<ChainDocument> | { type: "open"; options: OpenOptions; draftId: string } | { type: "persisted" };

function reducer(state: State, action: Action): State {
  if (action.type === "open") {
    const { doc, handlers = {}, forkedFrom, persist = false } = action.options;
    return {
      history: initHistory(doc),
      session: { draftId: action.draftId, handlers, ...(forkedFrom ? { forkedFrom } : {}), baseline: doc, persisted: persist || Boolean(action.options.draftId) },
    };
  }
  if (action.type === "persisted") return state.session && !state.session.persisted ? { ...state, session: { ...state.session, persisted: true } } : state;
  return { ...state, history: historyReducer(state.history, action) };
}

export type SaveState = "idle" | "saving" | "saved" | "failed";

export function useBuilder(initial?: OpenOptions) {
  const [state, dispatch] = useReducer(reducer, undefined, (): State => {
    if (!initial) return { history: initHistory(newDocument()), session: null };
    return reducer({ history: initHistory(initial.doc), session: null }, { type: "open", options: initial, draftId: initial.draftId ?? newDraftId() });
  });
  const [saveState, setSaveState] = useState<{ state: SaveState; at: number | null }>({ state: "idle", at: null });
  const { history, session } = state;
  const doc = history.present;

  const open = useCallback((options: OpenOptions) => {
    dispatch({ type: "open", options, draftId: options.draftId ?? newDraftId() });
    setSaveState({ state: "idle", at: null });
  }, []);

  const commit = useCallback((next: ChainDocument, key?: string) => dispatch({ type: "commit", value: next, ...(key ? { key } : {}) }), []);
  const undo = useCallback(() => dispatch({ type: "undo" }), []);
  const redo = useCallback(() => dispatch({ type: "redo" }), []);

  const write = useCallback((d: ChainDocument, s: Session) => {
    const ok = saveDraft({ id: s.draftId, name: d.name?.trim() || "untitled chain", doc: d, ...(s.forkedFrom ? { forkedFrom: s.forkedFrom } : {}), updatedAt: Date.now() });
    setSaveState({ state: ok ? "saved" : "failed", at: Date.now() });
    if (ok) dispatch({ type: "persisted" });
    return ok;
  }, []);

  // Autosave, debounced, once there's something worth keeping.
  const dirty = Boolean(session) && (session!.persisted || doc !== session!.baseline);
  const latest = useRef({ doc, session });
  useEffect(() => {
    latest.current = { doc, session };
  });
  useEffect(() => {
    if (!session || !dirty) return;
    const t = setTimeout(() => write(doc, session), 450);
    return () => clearTimeout(t);
  }, [doc, session, dirty, write]);

  const saveNow = useCallback(() => {
    const { doc: d, session: s } = latest.current;
    return s ? write(d, s) : false;
  }, [write]);

  return {
    /** Whether a document is open (vs. the placeholder before first use). */
    active: session !== null,
    doc,
    handlers: session?.handlers ?? EMPTY_HANDLERS,
    forkedFrom: session?.forkedFrom,
    draftId: session?.draftId,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    saveState,
    open,
    commit,
    undo,
    redo,
    saveNow,
  };
}

export type Builder = ReturnType<typeof useBuilder>;

const EMPTY_HANDLERS: Record<string, Handler> = {};
