"use client";

/**
 * Build mode's moving parts, as one hook the Studio plugs into its Workbench:
 * structural actions on the selection (add after, change kind, duplicate,
 * cut / copy / paste, delete), the canvas toolbar and right-click menu, the
 * property editor, the issues strip (with data-flow warnings and their
 * fixes), the live-code drawer, and their hotkeys.
 *
 * Everything edits through `builder.commit`, so it's all undoable.
 */
import { useCallback, useMemo, useState, useSyncExternalStore, type ReactNode } from "react";
import type { ChainDocument, FlowGraph, Json } from "jevchain";
import { KindTag } from "@/components/trace/kinds";
import type { VertexDecoration } from "@/components/trace/graph-node";
import type { TraceGraphProps } from "@/components/trace/trace-graph";
import { Kbd } from "@/components/ui/kbd";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/cn";
import { useHotkey } from "@/lib/hotkeys";
import {
  allIds,
  canDuplicate,
  canMove,
  childEdges,
  duplicateAt,
  getAt,
  insertAfterPath,
  insertBeforePath,
  isPlaceholder,
  moveStep,
  removeAt,
  replaceKind,
  subtreeSize,
  template,
  updateAt,
  withRoot,
  type BuilderKind,
  type NodeJson,
} from "@/lib/builder/doc-ops";
import { clipboard, pasteAt, type Clip, type PasteMode } from "@/lib/builder/clipboard";
import { flowWarnings, inputAt, type FlowFix, type FlowWarning } from "@/lib/builder/data-flow";
import { issueTarget } from "@/lib/builder/question-ops";
import { editTarget, selectionAfterRemove, vertexFor } from "@/lib/builder/selection";
import { CodeDrawer, type JsonDraft } from "./code-drawer";
import { ConfirmDialog, type ConfirmRequest } from "./confirm-dialog";
import { IssuesPanel } from "./issues-panel";
import { ContextMenu, KindGrid, KindMenu } from "./kind-menu";
import { DocumentEditor, PropertyEditor, type Update } from "./property-editor";
import type { Builder } from "./use-builder";

const GROUP = "builder";

type Menu = "add" | "before" | "kind";

const NOT_TEXT = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "color", "file"]);

function isTyping(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  if (t.isContentEditable) return true;
  if (t.tagName === "INPUT") return !NOT_TEXT.has((t as HTMLInputElement).type);
  return t.tagName === "TEXTAREA" || t.tagName === "SELECT";
}

/** ⌘c / ⌘x / ⌘v belong to the browser while typing or while page text is selected. */
function nativeClipboard(e: KeyboardEvent): boolean {
  if (isTyping(e)) return true;
  const sel = typeof window === "undefined" ? null : window.getSelection();
  return Boolean(sel && !sel.isCollapsed && sel.toString().trim());
}

const clipName = (clip: Clip) => clip.node.title || clip.node.id;

function count(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function useBuildMode({
  builder,
  graph,
  selected,
  setSelected,
  active,
  issues,
  sample,
}: {
  builder: Builder;
  graph: FlowGraph;
  selected: string | null;
  setSelected: (id: string | null) => void;
  /** Hotkeys only register in build mode. */
  active: boolean;
  issues: string[];
  /** The current run input, for "keep as a sample" (undefined when there isn't a valid one). */
  sample: unknown;
}) {
  const { doc, commit, handlers } = builder;
  const root = doc.root as unknown as NodeJson;
  const target = useMemo(() => editTarget(graph, root, selected), [graph, root, selected]);
  const [menu, setMenu] = useState<Menu | null>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number } | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [codeOpen, setCodeOpen] = useState(false);
  // JSON typed into the code drawer, kept while it's closed; tagged with the draft it belongs to so opening another chain drops it.
  const [jsonEdit, setJsonEdit] = useState<(JsonDraft & { session?: string }) | null>(null);
  const jsonDraft = jsonEdit && jsonEdit.session === builder.draftId ? jsonEdit : null;
  const setJsonDraft = useCallback((d: JsonDraft | null) => setJsonEdit(d && { ...d, session: builder.draftId }), [builder.draftId]);

  const commitRoot = useCallback((next: NodeJson, key?: string) => commit(withRoot(doc, next), key), [commit, doc]);
  const selectPath = useCallback((path: string, tier?: string) => setSelected(vertexFor(root, path, tier)), [root, setSelected]);

  // ── structural actions ────────────────────────────────────────────────────
  const addAfter = useCallback(
    (kind: BuilderKind) => {
      const path = target?.path ?? "$";
      const taken = allIds(root);
      const r = insertAfterPath(root, path, template(kind, taken), taken);
      commitRoot(r.root);
      setSelected(vertexFor(r.root, r.path));
      setMenu(null);
      setCtx(null);
    },
    [target, root, commitRoot, setSelected],
  );

  const addBefore = useCallback(
    (kind: BuilderKind) => {
      const path = target?.path ?? "$";
      const taken = allIds(root);
      const r = insertBeforePath(root, path, template(kind, taken), taken);
      commitRoot(r.root);
      setSelected(vertexFor(r.root, r.path));
      setMenu(null);
      setCtx(null);
    },
    [target, root, commitRoot, setSelected],
  );

  const move = useCallback(
    (delta: number) => {
      if (!target) return;
      const r = moveStep(root, target.path, delta);
      if (!r) return;
      commitRoot(r.root);
      setSelected(vertexFor(r.root, r.path, target.tier));
    },
    [target, root, commitRoot, setSelected],
  );

  const changeKind = useCallback(
    (kind: BuilderKind) => {
      if (!target) return;
      const go = () => {
        const next = replaceKind(root, target.path, kind);
        commitRoot(next);
        setSelected(vertexFor(next, target.path));
      };
      setMenu(null);
      setCtx(null);
      const size = subtreeSize(target.node);
      if (size > 1)
        setConfirm({
          title: `turn this ${target.node.kind} into a ${kind}?`,
          body: (
            <>
              <span className="font-mono text-ink">{target.node.title || target.node.id}</span> and the {count(size - 1, "node")} under it get replaced by a fresh {kind}. undo brings them back.
            </>
          ),
          confirmLabel: `replace ${count(size, "node")}`,
          onConfirm: go,
        });
      else go();
    },
    [target, root, commitRoot, setSelected],
  );

  const remove = useCallback(() => {
    if (!target) return;
    const go = () => {
      const next = removeAt(root, target.path);
      commitRoot(next);
      setSelected(selectionAfterRemove(next, target.path));
    };
    const size = subtreeSize(target.node);
    if (size > 1)
      setConfirm({
        title: `delete ${target.node.kind} “${target.node.title || target.node.id}”?`,
        body: <>that&apos;s {count(size, "node")}, everything downstream of this one on its branch. undo (⌘z) brings it back.</>,
        confirmLabel: `delete ${count(size, "node")}`,
        onConfirm: go,
      });
    else go();
  }, [target, root, commitRoot, setSelected]);

  const duplicate = useCallback(() => {
    if (!target || !canDuplicate(root, target.path)) return;
    const r = duplicateAt(root, target.path);
    if (!r) return;
    commitRoot(r.root);
    setSelected(vertexFor(r.root, r.path));
  }, [target, root, commitRoot, setSelected]);

  // ── clipboard ──────────────────────────────────────────────────────────────
  const clip = useSyncExternalStore(clipboard.subscribe, clipboard.get, () => null);

  const copy = useCallback(() => {
    if (!target) return false;
    clipboard.set(target.node, "copy");
    return true;
  }, [target]);

  const cut = useCallback(() => {
    if (!target) return false;
    clipboard.set(target.node, "cut");
    const next = removeAt(root, target.path);
    commitRoot(next);
    setSelected(selectionAfterRemove(next, target.path));
    return true;
  }, [target, root, commitRoot, setSelected]);

  /** Paste the clipboard after / before the selection, or in its place. A placeholder is always filled in place. */
  const paste = useCallback(
    (mode: PasteMode) => {
      const held = clipboard.get();
      if (!held || (mode === "replace" && !target)) return false;
      const how: PasteMode = target && isPlaceholder(target.node) ? "replace" : mode;
      const go = () => {
        const r = pasteAt(root, target?.path ?? null, held.node, how);
        commitRoot(r.root);
        setSelected(vertexFor(r.root, r.path));
      };
      setMenu(null);
      setCtx(null);
      const size = how === "replace" && target ? subtreeSize(target.node) : 0;
      if (size > 1)
        setConfirm({
          title: `paste over this ${target!.node.kind}?`,
          body: (
            <>
              <span className="font-mono text-ink">{target!.node.title || target!.node.id}</span> and the {count(size - 1, "node")} under it get replaced by{" "}
              <span className="font-mono text-ink">{clipName(held)}</span>. undo brings them back.
            </>
          ),
          confirmLabel: `replace ${count(size, "node")}`,
          onConfirm: go,
        });
      else go();
      return true;
    },
    [target, root, commitRoot, setSelected],
  );

  const confirmRemove = useCallback((what: string, child: NodeJson | undefined, go: () => void) => {
    const size = child ? subtreeSize(child) : 0;
    if (size <= 1 || (child && isPlaceholder(child))) return go();
    setConfirm({ title: `remove ${what}?`, body: <>it holds {count(size, "node")}. undo brings them back.</>, confirmLabel: `remove ${count(size, "node")}`, onConfirm: go });
  }, []);

  const update: Update = useCallback(
    (fn, key) => {
      if (!target) return;
      commitRoot(updateAt(root, target.path, fn), key);
    },
    [target, root, commitRoot],
  );

  // ── data flow ────────────────────────────────────────────────────────────
  const warnings = useMemo(() => flowWarnings(root), [root]);
  const applyFix = useCallback((w: FlowWarning, fix: FlowFix) => commitRoot(updateAt(root, w.path, fix.node)), [root, commitRoot]);

  const dupOk = Boolean(target && canDuplicate(root, target.path));
  const upOk = Boolean(target && canMove(root, target.path, -1));
  const downOk = Boolean(target && canMove(root, target.path, 1));

  // ── hotkeys ──────────────────────────────────────────────────────────────
  const on = { group: GROUP, enabled: active };
  useHotkey("n", () => setMenu("add"), { ...on, description: "add a node after the selection" });
  useHotkey("shift+n", () => setMenu("before"), { ...on, description: "add a node before the selection" });
  useHotkey(
    "alt+up",
    (e) => {
      if (isTyping(e)) return;
      e.preventDefault();
      move(-1);
    },
    { ...on, preventDefault: false, description: "move the selected step earlier in its chain" },
  );
  useHotkey(
    "alt+down",
    (e) => {
      if (isTyping(e)) return;
      e.preventDefault();
      move(1);
    },
    { ...on, preventDefault: false, description: "move the selected step later in its chain" },
  );
  useHotkey("k", () => target && setMenu("kind"), { ...on, description: "change the selected node's kind" });
  useHotkey("d", duplicate, { ...on, description: "duplicate the selected node (chains, parallels)" });
  useHotkey("backspace", remove, { ...on, description: "delete the selected node" });
  useHotkey("delete", remove, { ...on });
  const onClip = (run: () => boolean) => (e: KeyboardEvent) => {
    if (nativeClipboard(e)) return;
    if (run()) e.preventDefault();
  };
  const clipOn = { ...on, preventDefault: false };
  useHotkey("mod+x", onClip(cut), { ...clipOn, description: "cut the selected node and everything under it" });
  useHotkey("mod+c", onClip(copy), { ...clipOn, description: "copy the selected node and everything under it" });
  useHotkey("mod+v", onClip(() => paste("after")), { ...clipOn, description: "paste after the selection (fills a placeholder)" });
  useHotkey("shift+mod+v", onClip(() => paste("before")), { ...clipOn, description: "paste before the selection" });
  useHotkey("alt+mod+v", onClip(() => paste("replace")), { ...clipOn, description: "paste in place of the selection" });
  useHotkey("e", () => setCodeOpen((o) => !o), { ...on, description: "show / hide the live code" });
  useHotkey(
    "mod+z",
    (e) => {
      if (isTyping(e)) return;
      e.preventDefault();
      builder.undo();
    },
    { ...on, preventDefault: false, description: "undo" },
  );
  useHotkey(
    "shift+mod+z",
    (e) => {
      if (isTyping(e)) return;
      e.preventDefault();
      builder.redo();
    },
    { ...on, preventDefault: false, description: "redo" },
  );
  useHotkey("mod+s", () => builder.saveNow(), { ...on, allowInInputs: true, description: "save the draft now" });

  // ── decorations ──────────────────────────────────────────────────────────
  const decorations = useMemo(() => {
    const out: Record<string, VertexDecoration> = {};
    const bad = new Set(issues.map((i) => issueTarget(i)).filter(Boolean).map((t) => (t!.tier ? `${t!.path}/${t!.tier}` : t!.path)));
    const checks = new Set(warnings.map((w) => (w.tier ? `${w.path}/${w.tier}` : w.path)));
    for (const v of graph.vertices) {
      if (v.kind === "halt" || v.kind === "join") continue;
      const node = getAtSafe(root, v.spanPath);
      if (!node) continue;
      const d: VertexDecoration = {};
      if (isPlaceholder(node)) d.placeholder = true;
      if (node.kind === "step" && v.kind === "step") {
        const ref = (node.run as { $ref?: string } | undefined)?.$ref ?? node.id;
        const bound = typeof handlers[ref] === "function";
        d.note = bound ? "code · bound" : "not bound";
        d.noteTone = bound ? "pass" : "warn";
      }
      if (bad.has(v.id)) d.issue = true;
      else if (!d.note && checks.has(v.id)) {
        d.note = "check input";
        d.noteTone = "warn";
      }
      if (Object.keys(d).length) out[v.id] = d;
    }
    // chain-level issues land on their first step
    for (const b of bad) {
      if (graph.vertices.some((v) => v.id === b)) continue;
      const v = vertexFor(root, b);
      if (v) out[v] = { ...out[v], issue: true };
    }
    return out;
  }, [graph, root, handlers, issues, warnings]);

  const graphProps: Pick<TraceGraphProps, "decorations" | "onNodeContextMenu" | "children"> = {
    decorations,
    onNodeContextMenu: (_id, at) => setCtx(at),
    children: (
      <Toolbar
        target={target}
        menu={menu}
        setMenu={setMenu}
        addAfter={addAfter}
        addBefore={addBefore}
        changeKind={changeKind}
        duplicate={duplicate}
        dupOk={dupOk}
        remove={remove}
        builder={builder}
      />
    ),
  };

  // ── panels ───────────────────────────────────────────────────────────────
  const ids = useMemo(() => {
    const m = new Map<string, number>();
    const go = (n: NodeJson) => {
      m.set(n.id, (m.get(n.id) ?? 0) + 1);
      for (const c of childEdges(n)) go(c.node);
    };
    go(root);
    return m;
  }, [root]);

  const aside: ReactNode = target ? (
    <>
      <PropertyEditor
        node={target.node}
        path={target.path}
        {...(target.tier ? { tier: target.tier } : {})}
        ids={ids}
        handlers={handlers}
        update={update}
        taken={() => allIds(root)}
        onSelect={selectPath}
        confirmRemove={confirmRemove}
        flow={{ input: inputAt(root, target.path), warnings: warnings.filter((w) => w.path === target.path), onFix: applyFix }}
        actions={
          isPlaceholder(target.node) ? (
            <div className="space-y-2 pt-1">
              <p className="font-mono text-[10px] tracking-[0.12em] text-ink-3 uppercase">what goes here?</p>
              {clip && (
                <ActionChip onClick={() => paste("replace")} keys="⌘v" label={`paste ${clipName(clip)} here`}>
                  <span className="truncate">
                    paste <KindTag kind={clip.node.kind} /> {clipName(clip)} here
                  </span>
                </ActionChip>
              )}
              <KindGrid onPick={changeKind} />
            </div>
          ) : (
            <div className="flex flex-wrap gap-1 pt-0.5">
              <ActionChip onClick={() => setMenu("before")} keys="⇧n">
                + add before
              </ActionChip>
              <ActionChip onClick={() => setMenu("add")} keys="n">
                + add after
              </ActionChip>
              <ActionChip onClick={() => setMenu("kind")} keys="k">
                change kind
              </ActionChip>
              {dupOk && (
                <ActionChip onClick={duplicate} keys="d">
                  duplicate
                </ActionChip>
              )}
              <ActionChip onClick={cut} keys="⌘x" label="cut this node and everything under it">
                cut
              </ActionChip>
              <ActionChip onClick={copy} keys="⌘c" label="copy this node and everything under it">
                copy
              </ActionChip>
              {(upOk || downOk) && (
                <>
                  <ActionChip onClick={() => move(-1)} keys="⌥↑" disabled={!upOk} label="move earlier in the chain">
                    ↑ earlier
                  </ActionChip>
                  <ActionChip onClick={() => move(1)} keys="⌥↓" disabled={!downOk} label="move later in the chain">
                    ↓ later
                  </ActionChip>
                </>
              )}
              <ActionChip onClick={remove} keys="⌫" danger>
                delete
              </ActionChip>
              {clip && <ClipboardStrip clip={clip} paste={paste} />}
            </div>
          )
        }
      />
    </>
  ) : (
    <DocumentEditor
      name={doc.name ?? ""}
      description={doc.description ?? ""}
      examples={doc.examples ?? []}
      onName={(v) => commit({ ...doc, name: v }, "doc:name")}
      onDescription={(v) => {
        const next = { ...doc, description: v || undefined };
        if (!v) delete (next as { description?: string }).description;
        commit(next, "doc:description");
      }}
      onRemoveExample={(i) => commit({ ...doc, examples: (doc.examples ?? []).filter((_, j) => j !== i) })}
    >
      {clip && (
        <div className="flex flex-wrap gap-1 px-4 pt-3">
          <ClipboardStrip clip={clip} paste={paste} atEnds />
        </div>
      )}
      <HotkeyCheatsheet />
    </DocumentEditor>
  );

  const examples = doc.examples ?? [];
  const canSaveSample = sample !== undefined && !examples.some((e) => JSON.stringify(e) === JSON.stringify(sample));
  const saveSample = useCallback(() => {
    if (canSaveSample) commit({ ...doc, examples: [...(doc.examples ?? []), sample as Json] });
  }, [canSaveSample, doc, commit, sample]);

  const footer = <IssuesPanel issues={issues} warnings={warnings} onPick={(path, tier) => selectPath(path, tier)} onFix={applyFix} />;
  const applyJson = useCallback(
    (next: ChainDocument) => {
      commit(next);
      // keep the selection if it still points at something, else fall back to the document
      if (selected && !editTarget(graph, next.root as unknown as NodeJson, selected)) setSelected(null);
    },
    [commit, selected, graph, setSelected],
  );
  const overlay = codeOpen ? <CodeDrawer doc={doc} onClose={() => setCodeOpen(false)} draft={jsonDraft} setDraft={setJsonDraft} onApply={applyJson} /> : null;

  const portals = (
    <>
      <ConfirmDialog request={confirm} onClose={() => setConfirm(null)} />
      {ctx && target && (
        <ContextMenu
          at={ctx}
          title={
            <span className="flex items-center gap-1.5">
              <KindTag kind={target.node.kind} /> <span className="truncate">{target.node.title || target.node.id}</span>
            </span>
          }
          kind={target.node.kind}
          onAdd={addAfter}
          onAddBefore={addBefore}
          onChangeKind={changeKind}
          onClose={() => setCtx(null)}
          actions={[
            ...((upOk || downOk) && !isPlaceholder(target.node)
              ? [
                  { label: "move earlier", hint: "⌥↑", onSelect: () => move(-1), disabled: !upOk },
                  { label: "move later", hint: "⌥↓", onSelect: () => move(1), disabled: !downOk },
                ]
              : []),
            { label: "duplicate", hint: "d", onSelect: duplicate, disabled: !dupOk },
            { label: "cut", hint: "⌘x", onSelect: cut },
            { label: "copy", hint: "⌘c", onSelect: copy },
            ...(clip
              ? isPlaceholder(target.node)
                ? [{ label: `paste ${clipName(clip)} here`, hint: "⌘v", onSelect: () => paste("replace") }]
                : [
                    { label: "paste after", hint: "⌘v", onSelect: () => paste("after") },
                    { label: "paste before", hint: "⇧⌘v", onSelect: () => paste("before") },
                    { label: "paste in place", hint: "⌥⌘v", onSelect: () => paste("replace") },
                  ]
              : []),
            { label: "delete", hint: "⌫", onSelect: remove, danger: true },
          ]}
        />
      )}
    </>
  );

  return { aside, footer, overlay, graphProps, portals, codeOpen, setCodeOpen, saveSample, canSaveSample, selectPath };
}

function getAtSafe(root: NodeJson, path: string) {
  try {
    return getAt(root, path);
  } catch {
    return undefined;
  }
}

function ActionChip({
  onClick,
  keys,
  danger,
  disabled,
  label,
  children,
}: {
  onClick: () => void;
  keys: string;
  danger?: boolean;
  disabled?: boolean;
  label?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={cn(
        "inline-flex h-6 items-center gap-1.5 border-soft px-1.5 font-mono text-[10.5px] lowercase transition-colors duration-(--dur-fast) disabled:pointer-events-none disabled:opacity-35",
        danger ? "text-ink-2 hover:border-fail hover:bg-fail-wash hover:text-fail" : "text-ink-2 hover:border-(--line) hover:bg-surface-2 hover:text-ink",
      )}
    >
      {children}
      <span className="text-[9.5px] text-ink-3">{keys}</span>
    </button>
  );
}

/** What's on the clipboard, and where it can go relative to the selection (or the whole chain, when nothing is selected). */
function ClipboardStrip({ clip, paste, atEnds }: { clip: Clip; paste: (mode: PasteMode) => boolean; atEnds?: boolean }) {
  const size = subtreeSize(clip.node);
  return (
    <div className="flex w-full flex-wrap items-center gap-1 border-soft-t pt-1.5" aria-label="clipboard">
      <span className="flex min-w-0 items-center gap-1.5 font-mono text-[10.5px] text-ink-3">
        {clip.via === "cut" ? "cut" : "copied"} <KindTag kind={clip.node.kind} />
        <span className="truncate text-ink-2">{clipName(clip)}</span>
        {size > 1 && <span>· {count(size, "node")}</span>}
      </span>
      <span className="ml-auto flex flex-wrap gap-1">
        <ActionChip onClick={() => paste("before")} keys="⇧⌘v" label={atEnds ? "paste at the start" : "paste before this node"}>
          {atEnds ? "paste at start" : "paste before"}
        </ActionChip>
        <ActionChip onClick={() => paste("after")} keys="⌘v" label={atEnds ? "paste at the end" : "paste after this node"}>
          {atEnds ? "paste at end" : "paste after"}
        </ActionChip>
        {!atEnds && (
          <ActionChip onClick={() => paste("replace")} keys="⌥⌘v" label="paste in place of this node">
            in place
          </ActionChip>
        )}
      </span>
    </div>
  );
}

function Toolbar({
  target,
  menu,
  setMenu,
  addAfter,
  addBefore,
  changeKind,
  duplicate,
  dupOk,
  remove,
  builder,
}: {
  target: ReturnType<typeof editTarget>;
  menu: Menu | null;
  setMenu: (m: Menu | null) => void;
  addAfter: (k: BuilderKind) => void;
  addBefore: (k: BuilderKind) => void;
  changeKind: (k: BuilderKind) => void;
  duplicate: () => void;
  dupOk: boolean;
  remove: () => void;
  builder: Builder;
}) {
  const btn =
    "inline-flex h-7 items-center gap-1.5 px-2 font-mono text-[11px] lowercase text-ink-2 transition-colors duration-(--dur-fast) hover:bg-surface-2 hover:text-ink disabled:pointer-events-none disabled:opacity-35";
  return (
    <div className="flex items-stretch border-hard bg-paper shadow-[3px_3px_0_0_var(--ink)]" role="toolbar" aria-label="edit the chain">
      <div className="relative">
        <Tooltip label={target ? "add a node after this one · n (before · ⇧n)" : "add a node at the end · n (start · ⇧n)"}>
          <button
            type="button"
            className={cn(btn, "text-ink", (menu === "add" || menu === "before") && "bg-accent text-accent-ink hover:bg-accent")}
            onClick={() => setMenu(menu === "add" || menu === "before" ? null : "add")}
            aria-haspopup="menu"
            aria-expanded={menu === "add" || menu === "before"}
          >
            <span aria-hidden className="text-[13px] leading-none">+</span> add
          </button>
        </Tooltip>
        {menu === "add" && <KindMenu title={target ? "add after this" : "add at the end"} onPick={addAfter} onClose={() => setMenu(null)} />}
        {menu === "before" && <KindMenu title={target ? "add before this" : "add at the start"} onPick={addBefore} onClose={() => setMenu(null)} />}
      </div>
      <div className="relative border-soft-l">
        <Tooltip label="change kind · k">
          <button type="button" disabled={!target} className={cn(btn, menu === "kind" && "bg-accent text-accent-ink hover:bg-accent")} onClick={() => setMenu(menu === "kind" ? null : "kind")} aria-haspopup="menu" aria-expanded={menu === "kind"}>
            kind ▾
          </button>
        </Tooltip>
        {menu === "kind" && target && <KindMenu title="change kind to" current={target.node.kind} onPick={changeKind} onClose={() => setMenu(null)} />}
      </div>
      <Tooltip label="duplicate · d">
        <button type="button" disabled={!dupOk} className={cn(btn, "border-soft-l")} onClick={duplicate}>
          dup
        </button>
      </Tooltip>
      <Tooltip label="delete · ⌫">
        <button type="button" disabled={!target} className={cn(btn, "border-soft-l hover:bg-fail-wash hover:text-fail")} onClick={remove}>
          delete
        </button>
      </Tooltip>
      <Tooltip label="undo · ⌘z">
        <button type="button" disabled={!builder.canUndo} className={cn(btn, "border-hard-l")} onClick={builder.undo} aria-label="undo">
          ↶
        </button>
      </Tooltip>
      <Tooltip label="redo · ⇧⌘z">
        <button type="button" disabled={!builder.canRedo} className={cn(btn, "border-soft-l")} onClick={builder.redo} aria-label="redo">
          ↷
        </button>
      </Tooltip>
    </div>
  );
}

function HotkeyCheatsheet() {
  const rows: [string, string][] = [
    ["n / ⇧n", "add a node after / before"],
    ["k", "change kind"],
    ["d", "duplicate"],
    ["⌥↑ / ⌥↓", "move a step earlier / later"],
    ["⌘x / ⌘c", "cut / copy a node and its subtree"],
    ["⌘v", "paste after (or into a placeholder)"],
    ["⇧⌘v / ⌥⌘v", "paste before / in place"],
    ["⌫", "delete"],
    ["⌘z / ⇧⌘z", "undo / redo"],
    ["e", "live code"],
    ["⌘↵", "pull the chain"],
    ["b", "back to run mode"],
  ];
  return (
    <section className="px-4 py-3">
      <h3 className="mb-2 font-mono text-[10px] tracking-[0.12em] text-ink-3 uppercase">keys</h3>
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1.5">
        {rows.map(([k, d]) => (
          <div key={k} className="contents">
            <dt>
              <Kbd>{k}</Kbd>
            </dt>
            <dd className="font-mono text-[11px] text-ink-2">{d}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export type BuildMode = ReturnType<typeof useBuildMode>;
