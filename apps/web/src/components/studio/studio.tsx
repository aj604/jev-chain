"use client";

/**
 * The Studio: pick a chain, feed it input, pull it, and watch Jev decide.
 * Or flip to build mode (`b`) and make one.
 *
 * State lives here; the working area (graph, inspector, timeline) is the
 * shared <Workbench>. The chain on screen is always a `ChainSource`
 * (`{ kind: "example", slug } | { kind: "doc", doc, handlers? }`).
 *
 * Build mode edits one working document (`useBuilder`: undo stack +
 * autosaved draft) and draws it on the same canvas. Running from the builder
 * hands that document to the run pipeline as a doc source, flips back to run
 * mode, and the trace paints over the graph you just built.
 *
 * Rehearse (`r`, or `?rehearse=1`) swaps Jev for a local client that makes
 * its answers up (see `lib/trace/rehearsal`): no key, no network, every road
 * still walkable. Those traces are badged as rehearsals wherever they show.
 *
 * What if (from any road not taken in the inspector) re-runs run a's input
 * as run b with that one decision forced the other way (see
 * `lib/trace/what-if`), and opens the a-vs-b diff. Forking run b instead
 * stacks another what-if on top of b's (the chain of forks can be undone one
 * at a time), which is how you reach decisions that only exist on a road
 * run a never took.
 *
 * Sweep (`w`) runs every sample, your input and any extra lines through the
 * chain one after another (see `lib/trace/sweep`): the graph shows how many
 * inputs went down each road, the panel how each decision split them and
 * which roads none of them reach. Click an input to open its run.
 *
 * Ask again (`a`, or from the story) sends run a's input to Jev a few more
 * times (see `lib/trace/reask`): every decision says whether all the asks
 * took the same road, and an ask that went elsewhere opens as run b.
 *
 * Ask both again (compare mode, from the a-vs-b panel) does that for input a
 * and then input b (see `lib/trace/split`): the diff then says, per decision,
 * whether the two inputs stayed apart on every ask or one of them goes both
 * ways by itself, so a split on one pull isn't read as the edit's doing.
 *
 * Re-asks are real requests, so once they finish they're kept with the run
 * they asked about: in recent runs (reopening it shows the same verdicts) and
 * in its share link.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { graphOf, handlersOf, type AnyNode, type ChainDocument, type FlowGraph, type Json, type Trace } from "jevchain";
import { examples } from "jevchain-examples";
import { ChainLinks } from "@/components/brand/chain-links";
import { useBuildMode } from "@/components/builder/build-mode";
import { DraftsList } from "@/components/builder/drafts-list";
import { useBuilder, type OpenOptions } from "@/components/builder/use-builder";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { KbdCombo } from "@/components/ui/kbd";
import { Tooltip } from "@/components/ui/tooltip";
import { useChainRun, useRunClock } from "@/components/trace/use-chain-run";
import type { ReaskControl } from "@/components/trace/why-panel";
import { cn } from "@/lib/cn";
import { useHotkey } from "@/lib/hotkeys";
import { newDocument } from "@/lib/builder/doc-ops";
import { deleteDraft, renameDraft, type Draft } from "@/lib/builder/drafts";
import { DEFAULT_SLUG, documentOf, resolveChain, type ChainSource, type ResolvedChain } from "@/lib/trace/chain-source";
import { parseInput, toEditor } from "@/lib/trace/input";
import { isRehearsal } from "@/lib/trace/rehearsal";
import { visitOrder, stepSelection } from "@/lib/trace/order";
import { answeredReasks, keepReasks, readKeptReasks, reaskBlocker, REASKS, steadinessOf } from "@/lib/trace/reask";
import { keepReasksWith, saveRun, type SavedRun } from "@/lib/trace/saved-runs";
import { sameInput, splitsOf } from "@/lib/trace/split";
import { finishedTraces, MAX_SWEEP, parseSweepLines, sweepInputs, trafficOf, type SweepRow } from "@/lib/trace/sweep";
import type { Fork } from "@/lib/trace/what-if";
import { ChainPicker } from "./chain-picker";
import type { CompareAskControl } from "./compare-summary";
import { ExportMenu } from "./export-menu";
import { ImportDialog } from "./import-dialog";
import { InputEditor, type InputValue } from "./input-editor";
import { IssueActions } from "./issue-actions";
import { SavedRunsList } from "./saved-runs-list";
import { SweepPanel, SweepSummary } from "./sweep-panel";
import { sharePayload, useShare } from "./use-share";
import { useReask, type ReaskState } from "./use-reask";
import { useSweep } from "./use-sweep";
import { Workbench, type Target } from "./workbench";

export type StudioMode = "run" | "build";

/** A finished "ask again" stays with the saved run it asked about (when that run is saved). */
function keepWithSavedRun(base: Trace, end: ReaskState | undefined) {
  const kept = end && keepReasks(end.rows, end.stoppedBy);
  if (kept) keepReasksWith(base.runId, kept);
}

/** A what-if run: `base` re-run on `input` with `fork` forced. */
interface WhatIfRequest {
  base: Trace;
  input: Json;
  fork: Fork;
}

export interface StudioProps {
  /** `?example=` deep link. */
  initialSlug?: string;
  /** `?input=` deep link (text, or JSON if it parses as an object/array). */
  initialInput?: string;
  /** Start from a document instead of an example (it's also opened in the builder). */
  initialSource?: ChainSource;
  /** `?mode=build` deep link. */
  initialMode?: StudioMode;
  /** `?rehearse=1` deep link: start with rehearsal on. */
  initialRehearse?: boolean;
}

function initialSourceFrom(props: StudioProps): ChainSource {
  if (props.initialSource) return props.initialSource;
  // Gallery slugs and docs ids (`docs-…`) both resolve.
  if (props.initialSlug && resolveChain({ kind: "example", slug: props.initialSlug }).ok) return { kind: "example", slug: props.initialSlug };
  return { kind: "example", slug: DEFAULT_SLUG };
}

/** What the builder opens with: the doc we were handed, a fork of the example in build mode, or nothing yet. */
function initialBuilderFrom(props: StudioProps, source: ChainSource): OpenOptions | undefined {
  if (source.kind === "doc") return { doc: source.doc, ...(source.handlers ? { handlers: source.handlers } : {}), persist: true };
  if (props.initialMode !== "build") return undefined;
  return forkOptions(source.slug);
}

/** Fork an example (or docs chain) into the builder, keeping its code bound. */
function forkOptions(slug: string): OpenOptions | undefined {
  const r = resolveChain({ kind: "example", slug });
  if (!r.ok) return undefined;
  const doc = documentOf(r.chain);
  return { doc: { ...doc, name: `${r.chain.title} (fork)` }, handlers: handlersOf(r.chain.node), forkedFrom: slug };
}

function editorFromDeepLink(raw: string): InputValue {
  try {
    const v = JSON.parse(raw) as Json;
    if (v && typeof v === "object") return toEditor(v);
  } catch {
    // plain text
  }
  return { text: raw, mode: "text" };
}

function sampleEditor(chain: ResolvedChain | undefined, i: number): InputValue {
  const s = chain?.inputs[i] ?? chain?.inputs[0];
  return s ? toEditor(s.value) : { text: "", mode: "text" };
}

const EMPTY_GRAPH: FlowGraph = { vertices: [], edges: [], entry: "" };

export function Studio(props: StudioProps) {
  const [source, setSource] = useState<ChainSource>(() => initialSourceFrom(props));
  const [customDoc, setCustomDoc] = useState<ChainDocument | null>(() => (props.initialSource?.kind === "doc" ? props.initialSource.doc : null));
  const resolved = useMemo(() => resolveChain(source), [source]);
  const chain = resolved.ok ? resolved.chain : undefined;
  const graph = useMemo(() => (chain ? graphOf(chain.node) : EMPTY_GRAPH), [chain]);

  // ── build mode ─────────────────────────────────────────────────────────────
  const [mode, setMode] = useState<StudioMode>(() => (props.initialMode === "build" ? "build" : "run"));
  const building = mode === "build";
  const builder = useBuilder(initialBuilderFrom(props, initialSourceFrom(props)));
  const buildRoot = builder.doc.root as unknown as AnyNode;
  // Drawn from the raw document, so the canvas survives invalid states mid-edit.
  const buildGraph = useMemo(() => {
    try {
      return graphOf(buildRoot);
    } catch {
      return EMPTY_GRAPH;
    }
  }, [buildRoot]);
  const buildSource = useMemo<ChainSource>(() => ({ kind: "doc", doc: builder.doc, handlers: builder.handlers }), [builder.doc, builder.handlers]);
  const buildResolved = useMemo(() => resolveChain(buildSource), [buildSource]);
  const buildIssues = useMemo(() => (buildResolved.ok ? [] : buildResolved.issues), [buildResolved]);
  const buildView = useMemo<ResolvedChain>(
    () =>
      buildResolved.ok
        ? buildResolved.chain
        : {
            source: buildSource,
            node: buildRoot,
            title: builder.doc.name || "untitled chain",
            inputs: (builder.doc.examples ?? []).map((value, i) => ({ label: `example ${i + 1}`, value })),
            origin: "custom",
          },
    [buildResolved, buildSource, buildRoot, builder.doc],
  );
  // The document the last run used; build mode only shows a trace that matches what's on the canvas.
  const [lastRunDoc, setLastRunDoc] = useState<ChainDocument | null>(null);

  const [inputA, setInputA] = useState<InputValue>(() => (props.initialInput ? editorFromDeepLink(props.initialInput) : sampleEditor(chain, 0)));
  const [inputB, setInputB] = useState<InputValue>(() => sampleEditor(chain, 1));
  const [comparing, setComparing] = useState(false);
  const [sweeping, setSweeping] = useState(false);
  const [sweepExtra, setSweepExtra] = useState("");
  const [rehearsing, setRehearsing] = useState(Boolean(props.initialRehearse));
  const [selected, setSelected] = useState<string | null>(null);
  const [target, setTarget] = useState<Target>("a");
  const [fitSignal, setFitSignal] = useState(0);
  const [activeSavedId, setActiveSavedId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  // The what-if behind run b (so a failed one retries as that what-if, not as a plain pull),
  // and the runs b was forked from, newest last (so a fork of a fork can be undone).
  const [lastWhatIf, setLastWhatIf] = useState<WhatIfRequest | null>(null);
  const [forkedFrom, setForkedFrom] = useState<{ trace: Trace; input: Json }[]>([]);
  const forgetWhatIfs = useCallback(() => {
    setLastWhatIf(null);
    setForkedFrom([]);
  }, []);

  // Save finished runs against the chain they ran on.
  const sourceRef = useRef(source);
  const chainTitleRef = useRef(chain?.title ?? "");
  useEffect(() => {
    sourceRef.current = source;
    chainTitleRef.current = chain?.title ?? "";
  });
  const onFinishA = useCallback((trace: Trace, input: Json) => {
    if (trace.status === "aborted") return;
    const saved = saveRun({ source: sourceRef.current, chainTitle: chainTitleRef.current, input, trace });
    setActiveSavedId(saved.id);
  }, []);
  const onFinishB = useCallback((trace: Trace, input: Json) => {
    if (trace.status === "aborted") return;
    saveRun({ source: sourceRef.current, chainTitle: chainTitleRef.current, input, trace });
  }, []);
  const runA = useChainRun({ onFinish: onFinishA });
  const runB = useChainRun({ onFinish: onFinishB });
  const sweep = useSweep();
  const reask = useReask();
  // Compare mode's "ask both again": run b's input, re-sent (run a's re-asks are `reask`'s).
  const reaskB = useReask();
  // Bumped by stop: an "ask both" that was stopped during a's asks doesn't go on to spend b's.
  const askBothSeq = useRef(0);
  const running =
    runA.phase === "running" || runB.phase === "running" || sweep.phase === "running" || reask.phase === "running" || reaskB.phase === "running";
  const nowA = useRunClock(runA.phase === "running", runA.startedAtPerf, runA.trace?.durationMs);
  const nowB = useRunClock(runB.phase === "running", runB.startedAtPerf, runB.trace?.durationMs);

  const parsedA = parseInput(inputA.text, inputA.mode);
  const parsedB = parseInput(inputB.text, inputB.mode);
  const runnable = building ? (buildResolved.ok ? buildResolved.chain : undefined) : chain;
  // Sweep mode (run mode only): the samples, the editor's input if it parses, and the extra lines.
  const sweepMode = sweeping && !building;
  const parsedExtra = parseSweepLines(sweepExtra);
  const queued = sweepInputs(chain?.inputs ?? [], parsedA.ok ? parsedA.value : undefined, parsedExtra.ok ? parsedExtra.values : []);
  const canRun = sweepMode
    ? Boolean(chain) && parsedExtra.ok && queued.inputs.length > 0
    : Boolean(runnable) && parsedA.ok && (!comparing || parsedB.ok);
  const runBlocker = !runnable
    ? building
      ? `fix ${buildIssues.length} broken link${buildIssues.length === 1 ? "" : "s"} first`
      : "this chain doesn't load"
    : sweepMode
      ? !parsedExtra.ok
        ? parsedExtra.error
        : queued.inputs.length === 0
          ? "nothing to sweep"
          : null
      : !parsedA.ok || (comparing && !parsedB.ok)
        ? "the input isn't valid json"
        : null;

  // Keep the URL shareable: /studio?example=<slug>, plus &mode=build.
  useEffect(() => {
    const params = new URLSearchParams();
    const slug = building ? builder.forkedFrom : source.kind === "example" ? source.slug : undefined;
    if (slug) params.set("example", slug);
    if (building) params.set("mode", "build");
    if (rehearsing) params.set("rehearse", "1");
    const url = `/studio${params.size ? `?${params}` : ""}`;
    if (window.location.pathname + window.location.search !== url) window.history.replaceState(window.history.state, "", url);
  }, [source, building, builder.forkedFrom, rehearsing]);

  const pull = useCallback((rehearse: boolean) => {
    if (!runnable || !parsedA.ok || (comparing && !parsedB.ok)) return;
    setSelected(null);
    setActiveSavedId(null);
    forgetWhatIfs();
    reask.reset();
    reaskB.reset();
    if (building) {
      // Run what's on the canvas, then watch it in run mode.
      setSource(buildSource);
      setCustomDoc(builder.doc);
      setMode("run");
    }
    setLastRunDoc(building ? builder.doc : source.kind === "doc" ? source.doc : null);
    void runA.start(runnable.node, parsedA.value, { rehearse });
    if (comparing && parsedB.ok) void runB.start(runnable.node, parsedB.value, { rehearse });
    else runB.reset();
  }, [runnable, parsedA, parsedB, comparing, runA, runB, reask, reaskB, building, buildSource, builder.doc, source, forgetWhatIfs]);

  /** Sweep every queued input through the chain on screen. */
  const startSweep = useCallback(
    (rehearse: boolean) => {
      if (!chain || queued.inputs.length === 0) return;
      setSelected(null);
      void sweep.start(chain.node, queued.inputs, { rehearse });
    },
    [chain, queued, sweep],
  );

  const run = useCallback(() => (sweepMode ? startSweep(rehearsing) : pull(rehearsing)), [sweepMode, startSweep, pull, rehearsing]);

  /** From a missing-key dead end: turn rehearsal on and pull again. */
  const rehearseNow = useCallback(() => {
    setRehearsing(true);
    if (sweepMode) startSweep(true);
    else pull(true);
  }, [pull, sweepMode, startSweep]);

  /** Run `request` as run b and open the a-vs-b diff. */
  const startWhatIf = useCallback(
    (request: WhatIfRequest, rehearse: boolean) => {
      if (!chain) return;
      setLastWhatIf(request);
      setComparing(true);
      setInputB(toEditor(request.input));
      setTarget("diff");
      setSelected(null);
      void runB.start(chain.node, request.input, { rehearse: rehearse || isRehearsal(request.base), whatIf: { trace: request.base, fork: request.fork } });
    },
    [chain, runB],
  );

  /**
   * "What if it went the other way?": run the input again as run b, with one
   * decision forced. Forking run a starts a fresh what-if; forking run b stacks
   * one more on top of b's, and remembers b so it can be undone.
   */
  const whatIf = useCallback(
    (path: string, edge: string, from: "a" | "b" = "a") => {
      const run = from === "b" ? runB : runA;
      const base = run.trace;
      if (!base || base.status === "running" || run.input === undefined) return;
      const input = run.input;
      setForkedFrom((h) => (from === "b" ? [...h, { trace: base, input }] : []));
      startWhatIf({ base, input, fork: { path, edge } }, rehearsing);
    },
    [runA, runB, rehearsing, startWhatIf],
  );

  /** Put back the b the current what-if was forked from. */
  const undoWhatIf = useCallback(() => {
    const prev = forkedFrom.at(-1);
    if (!prev) return;
    setForkedFrom((h) => h.slice(0, -1));
    setLastWhatIf(null);
    setSelected(null);
    setInputB(toEditor(prev.input));
    runB.show(prev.trace, prev.input);
  }, [forkedFrom, runB]);

  /** Run b's issue buttons: a failed what-if retries (or rehearses) the same fork. */
  const retryB = useCallback(() => (lastWhatIf ? startWhatIf(lastWhatIf, rehearsing) : run()), [lastWhatIf, startWhatIf, rehearsing, run]);
  const rehearseB = useCallback(() => {
    if (!lastWhatIf) return rehearseNow();
    setRehearsing(true);
    startWhatIf(lastWhatIf, true);
  }, [lastWhatIf, startWhatIf, rehearseNow]);

  const stop = useCallback(() => {
    runA.stop();
    runB.stop();
    sweep.stop();
    reask.stop();
    reaskB.stop();
    askBothSeq.current++;
  }, [runA, runB, sweep, reask, reaskB]);

  const switchTo = useCallback(
    (next: ChainSource) => {
      runA.reset();
      runB.reset();
      sweep.reset();
      reask.reset();
      reaskB.reset();
      forgetWhatIfs();
      setSource(next);
      const r = resolveChain(next);
      const c = r.ok ? r.chain : undefined;
      setInputA(sampleEditor(c, 0));
      setInputB(sampleEditor(c, 1));
      setSelected(null);
      setActiveSavedId(null);
      setTarget("a");
    },
    [runA, runB, sweep, reask, reaskB, forgetWhatIfs],
  );

  const pickExample = useCallback((slug: string) => switchTo({ kind: "example", slug }), [switchTo]);

  /** Put a document in the builder and switch to build mode. */
  const openInBuilder = useCallback(
    (options: OpenOptions) => {
      builder.open(options);
      runA.reset();
      runB.reset();
      reask.reset();
      reaskB.reset();
      forgetWhatIfs();
      setLastRunDoc(null);
      setSelected(null);
      setActiveSavedId(null);
      setTarget("a");
      const first = options.doc.examples?.[0];
      if (first !== undefined) setInputA(toEditor(first));
      setMode("build");
    },
    [builder, runA, runB, reask, reaskB, forgetWhatIfs],
  );

  const loadDoc = useCallback(
    (doc: ChainDocument) => {
      setCustomDoc(doc);
      setSource({ kind: "doc", doc });
      openInBuilder({ doc, persist: true });
    },
    [openInBuilder],
  );

  const newChain = useCallback(() => openInBuilder({ doc: newDocument() }), [openInBuilder]);

  const forkExample = useCallback(
    (slug: string) => {
      const o = forkOptions(slug);
      if (o) openInBuilder(o);
    },
    [openInBuilder],
  );

  const openDraft = useCallback(
    (d: Draft) => {
      const r = d.forkedFrom ? resolveChain({ kind: "example", slug: d.forkedFrom }) : undefined;
      openInBuilder({ doc: d.doc, draftId: d.id, ...(d.forkedFrom ? { forkedFrom: d.forkedFrom } : {}), ...(r?.ok ? { handlers: handlersOf(r.chain.node) } : {}) });
    },
    [openInBuilder],
  );

  /** Run → build: resume the working doc if it's what's on screen, else fork what's on screen. */
  const enterBuild = useCallback(() => {
    if (source.kind === "doc") {
      if (!(builder.active && source.doc === builder.doc)) return openInBuilder({ doc: source.doc, ...(source.handlers ? { handlers: source.handlers } : {}) });
    } else if (!(builder.active && builder.forkedFrom === source.slug)) {
      const o = forkOptions(source.slug);
      if (o) return openInBuilder(o);
    }
    setMode("build");
  }, [source, builder, openInBuilder]);

  /** Build → run: pull the chain if it changed since the last pull (that also flips the mode). */
  const enterRun = useCallback(() => {
    if (!buildResolved.ok) return;
    if (lastRunDoc !== builder.doc && canRun && !running) return run();
    setSource(buildSource);
    setCustomDoc(builder.doc);
    setMode("run");
  }, [buildResolved.ok, lastRunDoc, builder.doc, canRun, running, run, buildSource]);

  const toggleMode = useCallback(() => (building ? enterRun() : enterBuild()), [building, enterRun, enterBuild]);

  const openSaved = useCallback(
    (saved: SavedRun) => {
      if (!resolveChain(saved.source).ok) return;
      runB.reset();
      reask.reset();
      forgetWhatIfs();
      setSource(saved.source);
      if (saved.source.kind === "doc") setCustomDoc(saved.source.doc);
      setInputA(toEditor(saved.input));
      setComparing(false);
      setSweeping(false);
      setTarget("a");
      setSelected(null);
      runA.show(saved.trace, saved.input);
      const kept = readKeptReasks(saved.reasks, saved.trace);
      if (kept) reask.show(saved.trace, kept);
      setActiveSavedId(saved.id);
    },
    [runA, runB, reask, forgetWhatIfs],
  );

  const resetB = runB.reset;
  const toggleCompare = useCallback(() => {
    if (comparing) {
      resetB();
      forgetWhatIfs();
      setTarget("a");
    }
    setSweeping(false);
    setComparing(!comparing);
  }, [comparing, resetB, forgetWhatIfs]);

  /** Sweep mode on/off. Results stay until the chain changes, so you can step into a run and back. */
  const toggleSweep = useCallback(() => {
    if (!sweeping && comparing) {
      resetB();
      forgetWhatIfs();
      setComparing(false);
      setTarget("a");
    }
    setSelected(null);
    setSweeping(!sweeping);
  }, [sweeping, comparing, resetB, forgetWhatIfs]);

  /** A sweep row → a normal run a, ready for "why did it go here?" and what-ifs. */
  /** Open one sweep input's run as run a, optionally with a node (e.g. the decision it nearly flipped) selected. */
  const openSweepRow = useCallback(
    (row: SweepRow, select?: string) => {
      if (!row.trace) return;
      forgetWhatIfs();
      reask.reset();
      setInputA(toEditor(row.value));
      setSweeping(false);
      setTarget("a");
      setSelected(select ?? null);
      setActiveSavedId(null);
      runA.show(row.trace, row.value);
    },
    [runA, reask, forgetWhatIfs],
  );
  const sweepTraces = useMemo(() => finishedTraces(sweep.rows), [sweep.rows]);
  const traffic = useMemo(() => trafficOf(graph, sweepTraces), [graph, sweepTraces]);

  // ── ask again: run a's input, re-sent to jev ───────────────────────────────
  const reaskOn = reask.phase !== "idle" && reask.base !== undefined && reask.base === runA.trace;
  // Only re-asks Jev actually answered count; a verdict needs at least one of them.
  const reaskTraces = useMemo(() => reask.rows.map((r) => r.trace), [reask.rows]);
  const answered = reaskOn ? answeredReasks(reaskTraces).length : 0;
  const steadiness = useMemo(
    () => (reaskOn && chain && reask.base && answered > 0 ? steadinessOf(chain.node, reask.base, reaskTraces) : undefined),
    [reaskOn, chain, reask.base, reaskTraces, answered],
  );
  const reaskDone = reaskOn ? reask.rows.filter((r) => r.trace || r.issue).length : 0;
  const startReask = useCallback(() => {
    const base = runA.trace;
    if (!chain || !base || runA.input === undefined || running || reaskBlocker(base)) return;
    void reask.start(chain.node, base, runA.input).then((end) => keepWithSavedRun(base, end));
  }, [chain, runA.trace, runA.input, running, reask]);
  /** An ask that went elsewhere → run b, with the a-vs-b diff open on where they parted. */
  const openReask = useCallback(
    (index: number) => {
      const row = reask.rows[index];
      if (!row?.trace) return;
      forgetWhatIfs();
      setSweeping(false);
      setComparing(true);
      setInputB(toEditor(row.value));
      setTarget("diff");
      setSelected(null);
      runB.show(row.trace, row.value);
    },
    [reask.rows, runB, forgetWhatIfs],
  );
  const reaskControl: ReaskControl = {
    blocker: running && !reaskOn ? "wait for the run to finish" : reaskBlocker(runA.trace),
    running: reaskOn && reask.phase === "running",
    done: reaskDone,
    answered,
    total: REASKS,
    ...(steadiness ? { steadiness } : {}),
    ...(reaskOn && reask.stoppedBy ? { stoppedBy: reask.stoppedBy } : {}),
    start: startReask,
    open: openReask,
  };

  // ── ask both again: compare mode, a's input and b's input re-sent ──────────
  const reaskBOn = reaskB.phase !== "idle" && reaskB.base !== undefined && reaskB.base === runB.trace;
  const reaskBTraces = useMemo(() => reaskB.rows.map((r) => r.trace), [reaskB.rows]);
  const askingBoth = (reaskOn && reask.phase === "running") || (reaskBOn && reaskB.phase === "running");
  const bothBlocker = ((): string | null => {
    const a = runA.trace;
    const b = runB.trace;
    if (!a || !b || a.status === "running" || b.status === "running") return "run both first";
    if (running && !askingBoth) return "wait for the runs to finish";
    if (sameInput(a.input, b.input)) return "a and b are the same input, so any split between them is jev answering differently. “ask again” on run a asks it more.";
    const ba = reaskBlocker(a);
    if (ba) return `run a: ${ba}`;
    const bb = reaskBlocker(b);
    return bb ? `run b: ${bb}` : null;
  })();
  // Splits only mean something for two real runs of two different inputs.
  const splits = useMemo(
    () =>
      comparing && !building && runA.trace && runB.trace && (reaskOn || reaskBOn) && !reaskBlocker(runA.trace) && !reaskBlocker(runB.trace) && !sameInput(runA.trace.input, runB.trace.input)
        ? splitsOf(runA.trace, reaskOn ? reaskTraces : [], runB.trace, reaskBOn ? reaskBTraces : [])
        : undefined,
    [comparing, building, runA.trace, runB.trace, reaskOn, reaskBOn, reaskTraces, reaskBTraces],
  );
  const startAskBoth = useCallback(async () => {
    const a = runA.trace;
    const b = runB.trace;
    if (!chain || !a || !b || runA.input === undefined || runB.input === undefined || running || bothBlocker) return;
    const mine = ++askBothSeq.current;
    // a asked already (say with `a`, before b ran)? Its asks count; don't spend them twice.
    if (!(reaskOn && reask.phase === "done" && !reask.stoppedBy)) {
      const first = await reask.start(chain.node, a, runA.input);
      keepWithSavedRun(a, first);
      // Stopped by hand, or by something b's asks would hit too (no key, a 429…): don't spend b's.
      if (askBothSeq.current !== mine || !first || first.stoppedBy || first.rows.some((r) => !r.trace || r.trace.status === "aborted")) return;
    }
    keepWithSavedRun(b, await reaskB.start(chain.node, b, runB.input));
  }, [chain, runA.trace, runA.input, runB.trace, runB.input, running, bothBlocker, reaskOn, reask, reaskB]);
  const compareAsk: CompareAskControl = {
    blocker: bothBlocker,
    running: askingBoth,
    done: { a: reaskDone, b: reaskBOn ? reaskB.rows.filter((r) => r.trace || r.issue).length : 0 },
    total: REASKS,
    ...(splits ? { splits } : {}),
    ...(reaskBOn && reaskB.stoppedBy ? { stoppedBy: reaskB.stoppedBy } : reaskOn && reask.stoppedBy ? { stoppedBy: reask.stoppedBy } : {}),
    start: () => void startAskBoth(),
  };

  // What's on screen right now, for share / step-through.
  const view = building ? buildView : chain;
  const viewGraph = building ? buildGraph : graph;
  const focus = comparing && target === "b" ? runB : runA;
  const order = useMemo(() => visitOrder(viewGraph, focus.trace), [viewGraph, focus.trace]);
  const { state: shareState, share } = useShare();
  const canShare = Boolean(!sweepMode && focus.trace && focus.trace.status !== "running" && focus.input !== undefined);
  const doShare = useCallback(() => {
    if (sweepMode || !focus.trace || focus.input === undefined || focus.trace.status === "running") return;
    // Its finished re-asks go along (run a's from "ask again", run b's from "ask both again").
    const asked = [reask, reaskB].find((r) => r.phase === "done" && r.base === focus.trace);
    const kept = asked && keepReasks(asked.rows, asked.stoppedBy);
    void share(sharePayload(source, focus.input, focus.trace, kept));
  }, [sweepMode, focus.trace, focus.input, source, share, reask, reaskB]);

  const sampleValue = parsedA.ok && inputA.text.trim() ? parsedA.value : undefined;
  const build = useBuildMode({
    builder,
    graph: buildGraph,
    selected,
    setSelected,
    active: building,
    issues: buildIssues,
    sample: sampleValue,
  });

  // ── keyboard ─────────────────────────────────────────────────────────────
  useHotkey("mod+enter", () => (running ? undefined : run()), { description: "run the chain", group: "studio" });
  useHotkey(
    "escape",
    () => {
      if (running) stop();
      else setSelected(null);
    },
    { description: "stop the run / deselect", group: "studio", preventDefault: false },
  );
  useHotkey("b", toggleMode, { description: "switch between run and build mode", group: "studio" });
  useHotkey("r", () => setRehearsing((r) => !r), { description: "toggle rehearsal (made-up answers, no key)", group: "studio", enabled: !running });
  useHotkey("c", toggleCompare, { description: "toggle compare mode", group: "studio", enabled: !building });
  useHotkey("w", toggleSweep, { description: "toggle sweep: run every sample and see where each goes", group: "studio", enabled: !building && !running });
  useHotkey("a", startReask, { description: `ask again: send run a's input to jev ${REASKS} more times`, group: "studio", enabled: !building && !sweepMode && !running });
  useHotkey("s", doShare, { description: "copy a share link to this run", group: "studio", enabled: !building });
  useHotkey("]", () => setSelected((s) => stepSelection(order, s, 1)), { description: "next visited node", group: "studio", enabled: !building });
  useHotkey("[", () => setSelected((s) => stepSelection(order, s, -1)), { description: "previous visited node", group: "studio", enabled: !building });
  useHotkey("f", () => setFitSignal((n) => n + 1), { description: "fit graph to view", group: "studio" });

  if (!view) {
    return (
      <div className="mx-auto grid max-w-lg flex-1 place-items-center px-4 py-24 text-center">
        <div className="space-y-4">
          <ChainLinks count={7} progress={0} size={18} className="mx-auto text-ink-3" />
          <h1 className="font-display text-3xl italic">this chain snapped.</h1>
          <ul className="space-y-1 font-mono text-[11px] text-fail">{!resolved.ok && resolved.issues.map((i) => <li key={i}>{i}</li>)}</ul>
          <div className="flex justify-center gap-2">
            <Button variant="outline" onClick={() => switchTo({ kind: "example", slug: DEFAULT_SLUG })}>
              back to the examples
            </Button>
            {source.kind === "doc" && (
              <Button variant="accent" onClick={enterBuild}>
                fix it in the builder
              </Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const modeSwitch = (
    <div role="radiogroup" aria-label="studio mode" className="flex border-hard bg-paper">
      {(["run", "build"] as const).map((m) => {
        const blocked = m === "run" && building && !buildResolved.ok;
        return (
          <Tooltip key={m} label={blocked ? `fix ${buildIssues.length} issue${buildIssues.length === 1 ? "" : "s"} first` : m === "build" ? "edit this chain · b" : "pull it · b"}>
            <button
              type="button"
              role="radio"
              aria-checked={mode === m}
              aria-disabled={blocked || undefined}
              onClick={() => (m === mode || blocked ? undefined : toggleMode())}
              className={cn(
                "flex h-7 items-center gap-1.5 px-2.5 font-mono text-[11px] lowercase transition-colors duration-(--dur-fast)",
                m === "build" && "border-soft-l",
                mode === m ? (m === "build" ? "bg-accent text-accent-ink" : "bg-ink text-paper") : "text-ink-2 hover:bg-surface-2 hover:text-ink",
                blocked && "cursor-not-allowed opacity-45",
              )}
            >
              <span aria-hidden className="text-[10px]">
                {m === "run" ? "▶" : "✎"}
              </span>
              {m}
            </button>
          </Tooltip>
        );
      })}
    </div>
  );

  const rehearseToggle = (
    <Tooltip label={rehearsing ? "rehearsing: made-up answers, no key · r" : "rehearse: run with made-up answers, no key · r"}>
      <Button variant={rehearsing ? "solid" : "ghost"} size="sm" onClick={() => setRehearsing(!rehearsing)} aria-pressed={rehearsing} disabled={running}>
        rehearse
      </Button>
    </Tooltip>
  );

  const saveNote =
    builder.saveState.state === "saved"
      ? `draft saved ✓${builder.forkedFrom ? ` · fork of ${builder.forkedFrom}` : ""}`
      : builder.saveState.state === "failed"
        ? "couldn't save a draft (storage is blocked)"
        : builder.forkedFrom
          ? `fork of ${builder.forkedFrom} · saves as you edit`
          : "saves as you edit";

  const header = building ? (
    <div className="flex min-h-13 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
      <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="truncate text-[15px] leading-6 font-medium text-ink">{builder.doc.name || "untitled chain"}</h1>
          <Badge tone="accent">building</Badge>
        </div>
        <p className={cn("truncate font-mono text-[11px]", builder.saveState.state === "failed" ? "text-warn" : "text-ink-3")} aria-live="polite">
          {saveNote}
        </p>
      </div>
      <div className="flex items-center gap-1.5">
        {modeSwitch}
        {rehearseToggle}
        <Tooltip label="live code · e">
          <Button variant={build.codeOpen ? "solid" : "ghost"} size="sm" onClick={() => build.setCodeOpen(!build.codeOpen)} aria-pressed={build.codeOpen}>
            {"</>"} code
          </Button>
        </Tooltip>
        <ExportMenu doc={() => builder.doc} filename={slugify(builder.doc.name) || "chain"} variant="outline" />
        <Tooltip label="fit graph · f">
          <Button variant="ghost" size="sm" onClick={() => setFitSignal((n) => n + 1)} aria-label="fit graph to view">
            fit
          </Button>
        </Tooltip>
      </div>
    </div>
  ) : (
    <div className="flex min-h-13 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
      <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <h1 className="truncate text-[15px] leading-6 font-medium text-ink">{view.title}</h1>
          {source.kind === "doc" && <Badge tone="dim">custom</Badge>}
        </div>
        {view.tagline && <p className="truncate font-mono text-[11px] text-ink-3">{view.tagline}</p>}
      </div>
      <div className="flex items-center gap-1">
        {modeSwitch}
        {rehearseToggle}
        <Tooltip label="compare two inputs · c">
          <Button variant={comparing ? "solid" : "ghost"} size="sm" onClick={toggleCompare} aria-pressed={comparing}>
            <span aria-hidden className="flex gap-0.5">
              <span className="size-1.5 bg-accent" />
              <span className="size-1.5 bg-compare" />
            </span>
            compare
          </Button>
        </Tooltip>
        <Tooltip label="run every sample and see where each goes · w">
          <Button variant={sweeping ? "solid" : "ghost"} size="sm" onClick={toggleSweep} aria-pressed={sweeping} disabled={running}>
            <span aria-hidden className="font-mono text-[10px]">⋔</span>
            sweep
          </Button>
        </Tooltip>
        <Tooltip label={sweepMode ? "open one input's run to share it" : canShare ? "copy share link · s" : "run it first"}>
          <Button variant="ghost" size="sm" onClick={doShare} disabled={!canShare || shareState === "working"}>
            <span aria-live="polite">
              {shareState === "copied" ? "link copied ✓" : shareState === "error" ? "couldn't copy" : shareState === "working" ? "packing…" : "share"}
            </span>
          </Button>
        </Tooltip>
        <ExportMenu doc={() => documentOf(view)} filename={source.kind === "example" ? source.slug : "custom-chain"} />
        <Tooltip label="fit graph · f">
          <Button variant="ghost" size="sm" onClick={() => setFitSignal((n) => n + 1)} aria-label="fit graph to view">
            fit
          </Button>
        </Tooltip>
      </div>
    </div>
  );

  const railSection = (title: string, children: React.ReactNode, extra?: React.ReactNode) => (
    <section className="border-soft-b">
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <h2 className="font-mono text-[10px] tracking-[0.12em] text-ink-3 uppercase">{title}</h2>
        {extra}
      </div>
      {children}
    </section>
  );

  const runControls = (
    <div className="sticky bottom-0 z-10 -mx-3 bg-paper px-3 pt-1 pb-3 lg:pb-0">
      {running ? (
        <Button variant="outline" size="lg" className="w-full" onClick={stop}>
          <span aria-hidden className="size-2.5 bg-fail" />
          stop
          <KbdCombo combo="escape" className="ml-auto" />
        </Button>
      ) : (
        <Button variant="accent" size="lg" className="w-full" onClick={run} disabled={!canRun}>
          <svg aria-hidden viewBox="0 0 10 10" className="size-2.5">
            <path d="M1 0.5 L9.5 5 L1 9.5 z" fill="currentColor" />
          </svg>
          {sweepMode
            ? `${rehearsing ? "rehearse" : "sweep"} ${queued.inputs.length} input${queued.inputs.length === 1 ? "" : "s"}`
            : rehearsing
              ? comparing
                ? "rehearse both"
                : "rehearse the chain"
              : comparing
                ? "pull both"
                : "pull the chain"}
          <KbdCombo combo="mod+enter" className="ml-auto" />
        </Button>
      )}
      {!running && runBlocker && (
        <p role="status" className="mt-1.5 font-mono text-[10.5px] text-fail">
          ✕ {runBlocker}
        </p>
      )}
    </div>
  );

  const inputSection = railSection(
    comparing || sweepMode ? "inputs" : "input",
    <div className="space-y-4 px-3 pb-3">
      <InputEditor
        label={comparing ? "input a" : sweepMode ? "your input" : "input"}
        hideLabel={!comparing && !sweepMode}
        tone={comparing ? "a" : undefined}
        value={inputA}
        onChange={setInputA}
        samples={view.inputs}
        disabled={running}
        rows={comparing ? 4 : 6}
      />
      {comparing && <InputEditor label="input b" tone="b" value={inputB} onChange={setInputB} samples={view.inputs} disabled={running} rows={4} />}
      {sweepMode && (
        <label className="block">
          <span className="mb-1 flex items-baseline justify-between font-mono text-[10px] lowercase text-ink-3">
            <span>more inputs · one per line</span>
            <span className="tabular-nums">
              {queued.inputs.length} to sweep{queued.dropped > 0 ? ` · ${queued.dropped} over the cap` : ""}
            </span>
          </span>
          <textarea
            value={sweepExtra}
            onChange={(e) => setSweepExtra(e.target.value)}
            disabled={running}
            rows={4}
            spellCheck={false}
            placeholder={'text, or one json value per line\n{"message": "..."}'}
            aria-invalid={!parsedExtra.ok || undefined}
            className={cn(
              "block w-full resize-y border-hard bg-paper px-2 py-1.5 font-mono text-[12px] leading-relaxed text-ink placeholder:text-ink-3 focus:outline-2 focus:outline-offset-2 focus:outline-ink disabled:opacity-60",
              !parsedExtra.ok && "border-fail",
            )}
          />
          <span className="mt-1 block font-mono text-[10px] leading-relaxed text-ink-3">every sample and your input are swept too, one at a time, up to {MAX_SWEEP}.</span>
        </label>
      )}
      {runControls}
    </div>,
    building && build.canSaveSample ? (
      <button type="button" onClick={build.saveSample} className="font-mono text-[10px] lowercase text-ink-3 underline decoration-dotted underline-offset-4 hover:text-ink">
        + keep as a sample
      </button>
    ) : undefined,
  );

  const rail = building ? (
    <div className="flex flex-col">
      {railSection(
        "start from",
        <div className="space-y-1.5 px-3 pb-3">
          <button type="button" onClick={newChain} className={railButton}>
            <span aria-hidden className="w-3 text-center">+</span> a blank chain
          </button>
          <details className="group/fork">
            <summary className={cn(railButton, "cursor-pointer list-none [&::-webkit-details-marker]:hidden")}>
              <span aria-hidden className="w-3 text-center">⑂</span> fork an example
              <span aria-hidden className="ml-auto text-[9px] transition-transform duration-(--dur-fast) group-open/fork:rotate-180">
                ▾
              </span>
            </summary>
            <ul className="mt-1 border-soft">
              {examples.map((ex) => (
                <li key={ex.slug} className="border-soft-b last:border-b-0">
                  <button type="button" onClick={() => forkExample(ex.slug)} className="group/fx block w-full px-2 py-1.5 text-left hover:bg-surface-2">
                    <span className="block truncate text-[12px] leading-5 text-ink-2 group-hover/fx:text-ink">{ex.title}</span>
                    <span className="block truncate font-mono text-[10px] text-ink-3">{ex.pattern}</span>
                  </button>
                </li>
              ))}
            </ul>
          </details>
          <button type="button" onClick={() => setImportOpen(true)} className={railButton}>
            <span aria-hidden className="w-3 text-center">{"{"}</span> import json
          </button>
        </div>,
      )}
      {inputSection}
      {railSection(
        "drafts",
        <DraftsList
          activeId={builder.draftId}
          onOpen={openDraft}
          onRename={(d, name) => {
            if (d.id === builder.draftId) builder.commit({ ...builder.doc, name }, "doc:name");
            else renameDraft(d.id, name);
          }}
          onDelete={(d) => deleteDraft(d.id)}
        />,
      )}
    </div>
  ) : (
    <div className="flex flex-col">
      {railSection(
        "chains",
        <ChainPicker
          source={source}
          customTitle={customDoc ? (customDoc.name ?? "custom chain") : undefined}
          customNote={customDoc && customDoc === builder.doc ? "custom · from the builder" : undefined}
          docsChain={view.origin === "docs" ? { title: view.title, href: view.href } : undefined}
          onPick={pickExample}
          onPickCustom={customDoc ? () => switchTo({ kind: "doc", doc: customDoc, ...(customDoc === builder.doc ? { handlers: builder.handlers } : {}) }) : undefined}
          onImport={() => setImportOpen(true)}
          onNew={newChain}
        />,
      )}
      {inputSection}
      {railSection("recent runs", <SavedRunsList activeId={activeSavedId} onOpen={openSaved} />)}
      <div className="px-3 py-3">
        <ButtonLink href="/examples" variant="ghost" size="sm" className="w-full justify-start px-0 text-ink-3">
          how these examples work →
        </ButtonLink>
      </div>
    </div>
  );

  // Build mode shows a trace only if it came from exactly this document.
  const showTrace = !building || lastRunDoc === builder.doc;

  return (
    <>
      {examples.slice(0, 9).map((ex, i) => (
        <PickHotkey key={ex.slug} index={i} title={ex.title} enabled={!building} onPick={() => !running && pickExample(ex.slug)} />
      ))}
      <Workbench
        chain={view}
        graph={viewGraph}
        trace={showTrace ? runA.trace : undefined}
        issue={showTrace ? runA.issue : null}
        now={nowA}
        {...(comparing && !building ? { compare: { trace: runB.trace, issue: runB.issue, now: nowB } } : {})}
        {...(sweepMode
          ? {
              sweep: {
                traffic,
                summary: <SweepSummary rows={sweep.rows} running={sweep.phase === "running"} rehearsed={sweep.rehearsed} />,
                aside: (
                  <SweepPanel
                    graph={graph}
                    {...(chain ? { root: chain.node } : {})}
                    rows={sweep.rows}
                    running={sweep.phase === "running"}
                    rehearsed={sweep.rehearsed}
                    {...(sweep.stoppedBy ? { stoppedBy: sweep.stoppedBy } : {})}
                    queued={queued.inputs}
                    selected={selected}
                    onSelect={setSelected}
                    onOpen={openSweepRow}
                    issueAction={<IssueActions issue={sweep.stoppedBy ?? null} onRetry={run} onRehearse={rehearseNow} />}
                  />
                ),
              },
            }
          : {})}
        target={target}
        onTarget={setTarget}
        selected={selected}
        onSelect={setSelected}
        fitSignal={fitSignal}
        header={header}
        rail={rail}
        issueAction={<IssueActions issue={runA.issue} onRetry={run} onRehearse={rehearseNow} />}
        issueActionB={<IssueActions issue={runB.issue} onRetry={retryB} onRehearse={rehearseB} />}
        {...(building ? {} : { onWhatIf: whatIf, reask: reaskControl, ...(comparing ? { compareAsk } : {}), ...(forkedFrom.length > 0 && runB.phase !== "running" ? { onUndoWhatIf: undoWhatIf } : {}) })}
        {...(building ? { aside: build.aside, footer: build.footer, canvasOverlay: build.overlay, graphNode: buildRoot, graphProps: build.graphProps } : {})}
      />
      {building && build.portals}
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} onLoad={loadDoc} starter={() => (building ? builder.doc : documentOf(view))} />
      <span className="sr-only" aria-live="polite">
        {sweep.phase === "running" ? "sweep started" : runA.phase === "running" ? "run started" : runA.trace ? `run ${runA.trace.status}` : ""}
      </span>
    </>
  );
}

const railButton =
  "flex h-7 w-full items-center gap-2 border-(length:--bw) border-dashed border-ink-3 px-2 font-mono text-[11px] lowercase text-ink-2 transition-colors duration-(--dur-fast) hover:border-ink hover:bg-surface-2 hover:text-ink";

function slugify(s: string | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function PickHotkey({ index, title, onPick, enabled }: { index: number; title: string; onPick: () => void; enabled: boolean }) {
  useHotkey(String(index + 1), onPick, { description: `open “${title.toLowerCase()}”`, group: "studio", enabled });
  return null;
}
