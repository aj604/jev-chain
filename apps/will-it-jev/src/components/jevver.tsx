"use client";

import { graphOf, type Jev } from "jevchain";
import { Inspector } from "jevchain-trace-ui/components/inspector";
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { COPY } from "@/lib/copy";
import { browserJev } from "@/lib/jev";
import { compileRecipe } from "@/lib/recipe/compile";
import { recipeShape } from "@/lib/recipe/tree";
import { CAPS, type Recipe } from "@/lib/recipe/types";
import { validateRecipe } from "@/lib/recipe/validate";
import { runRecipe } from "@/lib/run";
import { curatedSlugFor } from "@/lib/share";
import { CURATED, type CuratedRecipe } from "@/recipes";
import { DeskGraph, pacedTrace } from "./desk-graph";
import { RunView, type LiveRun } from "./run-view";
import { prefersReducedMotion, useReveal } from "./use-reveal";

/** Shorter input is "nothing here to jev". The decomposer's `MIN_THING`, which the page doesn't import. */
const MIN_INPUT = 2;

/** What `GET /api/decompose` says. Until it answers, free text is assumed on and nothing is paused. */
interface DecomposeStatus {
  enabled: boolean;
  paused: boolean;
}

const chip =
  "border-soft bg-surface px-3 py-1.5 text-left text-[14px] text-ink-2 transition-colors duration-(--dur-fast) hover:border-ink-3 hover:text-ink aria-pressed:border-hard aria-pressed:bg-ink aria-pressed:text-paper aria-checked:border-hard aria-checked:bg-ink aria-checked:text-paper";

/**
 * The jevver: pick a desk (a curated recipe) or open a new one for free text,
 * see the desk drawn as a graph, paste something and watch it go through.
 *
 * A picked desk runs its own recipe on the box's text. Free text goes to
 * `/api/decompose` first, and its desk is drawn once it comes back. Every
 * submission aborts the one before it, whether it is still decomposing or
 * already running, and replaces its run.
 */
export function Jevver() {
  const [status, setStatus] = useState<DecomposeStatus>({ enabled: true, paused: false });
  const [picked, setPicked] = useState<CuratedRecipe | null>(CURATED[0]!);
  const [text, setText] = useState(CURATED[0]!.samples[0]!.input);
  const [note, setNote] = useState<string | null>(null);
  const [decomposing, setDecomposing] = useState(false);
  const [run, setRun] = useState<LiveRun | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const attempt = useRef<AbortController | null>(null);
  const runIds = useRef(0);
  const jev = useRef<Jev | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  const inputId = useId();
  const aboutId = useId();
  const noteId = useId();
  const desksId = useId();

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/decompose", { signal: controller.signal, cache: "no-store" })
      .then((res) => res.json())
      .then((body: unknown) => {
        const s = readStatus(body);
        if (s) setStatus(s);
      })
      .catch(() => {});
    return () => controller.abort();
  }, []);

  // Leaving the page stops whatever is in flight.
  useEffect(() => {
    const current = attempt;
    return () => current.current?.abort();
  }, []);

  // Spans come out one step at a time, so a fast run can still be followed on the graph.
  const spans = run?.trace?.spans.length ?? 0;
  const shown = useReveal(spans);
  const trace = pacedTrace(run?.trace, shown);
  const settled = run?.outcome && shown >= spans ? run.outcome : null;

  const freeTextOff = !picked && !status.enabled;
  // The desk on screen: the run's (which may be a new desk), else the picked one.
  const desk: Recipe | null = run?.recipe ?? picked?.recipe ?? null;
  const chain = useMemo(() => (desk ? compileRecipe(desk) : null), [desk]);
  const graph = useMemo(() => (chain ? graphOf(chain) : null), [chain]);

  /** Aborts the attempt in flight, clears its run and messages, and starts a new one. */
  function begin(): AbortController {
    attempt.current?.abort();
    const controller = new AbortController();
    attempt.current = controller;
    setNote(null);
    setDecomposing(false);
    setRun(null);
    setSelected(null);
    return controller;
  }

  async function start(recipe: Recipe, input: string, slug: string | null, controller: AbortController) {
    const id = ++runIds.current;
    const update = (patch: Partial<LiveRun>) => {
      if (!controller.signal.aborted) setRun((r) => (r?.id === id ? { ...r, ...patch } : r));
    };
    setRun({ id, recipe, input, slug, trace: undefined, outcome: null });
    jev.current ??= browserJev();
    try {
      const out = await runRecipe(jev.current, recipe, input, {
        signal: controller.signal,
        onTrace: (t) => update({ trace: t }),
      });
      update({ trace: out.run.trace, outcome: { result: out.result, failure: out.failure } });
    } catch {
      // Only a recipe that doesn't compile throws. It reads as no answer.
      update({ outcome: { result: null, failure: "no-answer" } });
    }
  }

  async function decomposeThenRun(thing: string, controller: AbortController) {
    setDecomposing(true);
    const reply = await requestRecipe(thing, controller.signal);
    if (controller.signal.aborted) return;
    setDecomposing(false);
    if ("error" in reply) {
      setNote(reply.error);
      return;
    }
    await start(reply.recipe, thing, curatedSlugFor(reply.recipe), controller);
  }

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (status.paused || freeTextOff) return;
    const input = text.trim();
    if (input.length < MIN_INPUT) {
      setNote(COPY.tooShort);
      return;
    }
    if (input.length > CAPS.input) {
      setNote(COPY.tooLong);
      return;
    }
    const controller = begin();
    if (picked) void start(picked.recipe, input, picked.slug, controller);
    else void decomposeThenRun(input, controller);
  };

  const retry = () => {
    if (!run) return;
    void start(run.recipe, run.input, run.slug, begin());
  };

  const toForm = () => {
    form.current?.scrollIntoView({ behavior: prefersReducedMotion() ? "auto" : "smooth", block: "start" });
  };

  const again = () => {
    attempt.current?.abort();
    setRun(null);
    setSelected(null);
    toForm();
    box.current?.focus({ preventScroll: true });
  };

  const pick = (curated: CuratedRecipe | null) => {
    attempt.current?.abort();
    setRun(null);
    setSelected(null);
    setPicked(curated);
    setText(curated ? curated.samples[0]!.input : "");
    setNote(null);
  };

  const message = status.paused ? COPY.paused : decomposing ? COPY.decomposing : note;
  const shape = desk ? recipeShape(desk) : null;

  return (
    <div className="flex min-w-0 flex-col gap-10">
      <section aria-labelledby={desksId} className="flex min-w-0 flex-col gap-3">
        <h2 id={desksId} className="font-mono text-[12px] text-ink-3">
          {COPY.desksHeading}
        </h2>
        <ul className="flex flex-wrap gap-2">
          {CURATED.map((curated) => (
            <li key={curated.slug}>
              <button
                type="button"
                className={chip}
                aria-pressed={picked?.slug === curated.slug}
                onClick={() => pick(curated)}
              >
                {curated.recipe.title}
              </button>
            </li>
          ))}
          <li>
            <button
              type="button"
              className={`${chip} border-dashed`}
              aria-pressed={picked === null}
              onClick={() => pick(null)}
            >
              {COPY.newDesk}
            </button>
          </li>
        </ul>
      </section>

      <form
        ref={form}
        onSubmit={submit}
        noValidate
        className="flex min-w-0 scroll-mt-6 flex-col border-hard bg-surface"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-soft-b px-4 py-3 sm:px-5">
          <p className="min-w-0 wrap-break-word font-display text-2xl italic sm:text-3xl">
            {desk?.title ?? COPY.newDeskTitle}
          </p>
          {shape && (
            <p className="font-mono text-[12px] tabular-nums text-ink-3">
              {COPY.shape(shape.decisions, shape.maxDepth)}
            </p>
          )}
        </div>

        <div className="relative h-80 border-soft-b bg-paper sm:h-96">
          {desk ? (
            <DeskGraph
              recipe={desk}
              trace={trace}
              selected={selected}
              onSelect={setSelected}
              className="h-full"
            />
          ) : (
            <div className="bg-grid flex h-full items-center justify-center px-6">
              <p className="max-w-[40ch] text-center text-ink-2">{COPY.noDeskYet}</p>
            </div>
          )}
          {desk && !selected && (
            <p className="pointer-events-none absolute right-3 bottom-2 font-mono text-[11px] text-ink-3">
              {COPY.graphHint}
            </p>
          )}
        </div>

        {graph && chain && selected && (
          <Inspector
            graph={graph}
            trace={trace}
            selected={selected}
            onSelect={setSelected}
            root={chain}
            className="max-h-96 overflow-y-auto border-soft-b"
          />
        )}

        <div className="flex min-w-0 flex-col gap-3 px-4 py-4 sm:px-5">
          {picked ? (
            <div role="radiogroup" aria-label={COPY.samplesLabel} className="flex flex-wrap gap-1.5">
              {picked.samples.map((sample) => (
                <button
                  key={sample.label}
                  type="button"
                  role="radio"
                  className={`${chip} py-1 font-mono text-[12px]`}
                  aria-checked={text === sample.input}
                  onClick={() => {
                    setText(sample.input);
                    setNote(null);
                  }}
                >
                  {sample.label}
                </button>
              ))}
            </div>
          ) : (
            <p id={aboutId} className="text-sm text-ink-2">
              {status.enabled ? `${COPY.newDeskNote} ${COPY.disclosure}` : COPY.decomposerOff}
            </p>
          )}
          <label htmlFor={inputId} className="sr-only">
            {COPY.prompt}
          </label>
          <textarea
            ref={box}
            id={inputId}
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setNote(null);
            }}
            placeholder={COPY.placeholder}
            maxLength={CAPS.input}
            rows={3}
            disabled={freeTextOff}
            aria-describedby={picked ? noteId : `${aboutId} ${noteId}`}
            className="w-full min-w-0 resize-y border-soft bg-paper p-3 text-[15px] leading-relaxed text-ink placeholder:text-ink-3 focus-visible:border-ink disabled:cursor-not-allowed disabled:opacity-60"
          />
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <button
              type="submit"
              disabled={status.paused || freeTextOff}
              className="border-hard bg-accent px-5 py-2 font-semibold text-accent-ink transition-colors duration-(--dur-fast) hover:bg-accent-2 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {COPY.submit}
            </button>
            <p id={noteId} role="status" className="min-w-0 text-sm text-ink-2">
              {message}
            </p>
          </div>
        </div>
      </form>

      <RunView
        run={run}
        trace={trace}
        settled={settled}
        onRetry={retry}
        onAgain={again}
        onSelect={setSelected}
      />
    </div>
  );
}

/** `{ enabled, paused }` from the status reply, or null for anything else. */
function readStatus(body: unknown): DecomposeStatus | null {
  if (typeof body !== "object" || body === null) return null;
  const { enabled, paused } = body as Record<string, unknown>;
  if (typeof enabled !== "boolean" || typeof paused !== "boolean") return null;
  return { enabled, paused };
}

/**
 * Free text to a recipe through `/api/decompose`. Its `{ error }` line comes
 * back as is. A network failure, an unreadable reply or a recipe that fails
 * validation is `COPY.wontJev`. An abort comes back as an error too; the
 * caller checks its signal.
 */
async function requestRecipe(thing: string, signal: AbortSignal): Promise<{ recipe: Recipe } | { error: string }> {
  try {
    const res = await fetch("/api/decompose", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ thing }),
      signal,
      cache: "no-store",
    });
    const body: unknown = await res.json();
    if (typeof body === "object" && body !== null) {
      const { recipe, error } = body as Record<string, unknown>;
      if (typeof error === "string" && error) return { error };
      const check = validateRecipe(recipe);
      if (check.ok) return { recipe: check.recipe };
    }
  } catch {
    // Falls through to the plain line.
  }
  return { error: COPY.wontJev };
}
