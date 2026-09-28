"use client";

import type { Jev } from "jevchain";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { COPY } from "@/lib/copy";
import { browserJev } from "@/lib/jev";
import { recipeShape } from "@/lib/recipe/tree";
import { CAPS, type Recipe } from "@/lib/recipe/types";
import { validateRecipe } from "@/lib/recipe/validate";
import { runRecipe } from "@/lib/run";
import { curatedSlugFor } from "@/lib/share";
import { CURATED, type CuratedRecipe } from "@/recipes";
import { RunView, type LiveRun } from "./run-view";
import { prefersReducedMotion } from "./use-reveal";

/** Shorter input is "nothing here to jev". The decomposer's `MIN_THING`, which the page doesn't import. */
const MIN_INPUT = 2;

/** Each curated recipe with its shape line, in library order. */
const EXAMPLES = CURATED.map((curated) => {
  const shape = recipeShape(curated.recipe);
  return { curated, shape: COPY.shape(shape.decisions, shape.maxDepth) };
});

/** What `GET /api/decompose` says. Until it answers, free text is assumed on and nothing is paused. */
interface DecomposeStatus {
  enabled: boolean;
  paused: boolean;
}

/**
 * The jevver: the input box, the live run and the curated examples.
 *
 * A picked example runs its own recipe on the box's text. Free text goes to
 * `/api/decompose` first. Every submission aborts the one before it, whether
 * it is still decomposing or already running, and replaces its run.
 */
export function Jevver() {
  const [status, setStatus] = useState<DecomposeStatus>({ enabled: true, paused: false });
  const [picked, setPicked] = useState<CuratedRecipe | null>(null);
  const [text, setText] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [decomposing, setDecomposing] = useState(false);
  const [run, setRun] = useState<LiveRun | null>(null);

  const attempt = useRef<AbortController | null>(null);
  const runIds = useRef(0);
  const jev = useRef<Jev | null>(null);
  const form = useRef<HTMLFormElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  const inputId = useId();
  const aboutId = useId();
  const noteId = useId();
  const examplesId = useId();

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

  const freeTextOff = !picked && !status.enabled;

  /** Aborts the attempt in flight, clears its run and messages, and starts a new one. */
  function begin(): AbortController {
    attempt.current?.abort();
    const controller = new AbortController();
    attempt.current = controller;
    setNote(null);
    setDecomposing(false);
    setRun(null);
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
        onTrace: (trace) => update({ trace }),
      });
      update({ trace: out.result.trace, outcome: { verdict: out.verdict, failure: out.failure } });
    } catch {
      // Only a recipe that doesn't compile throws. It reads as no answer.
      update({ outcome: { verdict: null, failure: "no-answer" } });
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
    toForm();
    box.current?.focus({ preventScroll: true });
  };

  const pick = (curated: CuratedRecipe) => {
    setPicked(curated);
    setText(curated.samples[0]!.input);
    setNote(null);
    toForm();
  };

  const primary =
    "rounded-md bg-ink px-4 py-2 font-medium text-paper hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40";
  const secondary = "rounded-md border border-rule px-3 py-1.5 text-sm text-ink hover:border-ink-3";

  const message = status.paused ? COPY.paused : decomposing ? COPY.decomposing : note;

  return (
    <div className="flex min-w-0 flex-col gap-10">
      <form ref={form} onSubmit={submit} noValidate className="flex min-w-0 scroll-mt-6 flex-col gap-3">
        <label htmlFor={inputId} className="wrap-break-word font-medium text-ink">
          {picked ? picked.recipe.title : COPY.prompt}
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
          rows={5}
          disabled={freeTextOff}
          aria-describedby={picked ? noteId : `${aboutId} ${noteId}`}
          className="w-full min-w-0 resize-y rounded-md border border-rule bg-transparent p-3 text-ink placeholder:text-ink-3 disabled:cursor-not-allowed disabled:opacity-60"
        />
        {picked && (
          <div className="flex flex-wrap gap-2">
            {picked.samples.map((sample) => (
              <button
                key={sample.label}
                type="button"
                className={`${secondary} aria-pressed:border-ink`}
                aria-pressed={text === sample.input}
                onClick={() => {
                  setText(sample.input);
                  setNote(null);
                }}
              >
                {sample.label}
              </button>
            ))}
            <button
              type="button"
              className={secondary}
              onClick={() => {
                setPicked(null);
                setNote(null);
              }}
            >
              {COPY.writeYourOwn}
            </button>
          </div>
        )}
        {!picked && (
          <p id={aboutId} className="text-sm text-ink-2">
            {status.enabled ? COPY.disclosure : COPY.decomposerOff}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <button type="submit" className={primary} disabled={status.paused || freeTextOff}>
            {COPY.submit}
          </button>
          <p id={noteId} role="status" className="min-w-0 text-sm text-ink-2">
            {message}
          </p>
        </div>
      </form>

      <RunView run={run} onRetry={retry} onAgain={again} />

      <section aria-labelledby={examplesId} className="flex min-w-0 flex-col gap-3">
        <h2 id={examplesId} className="font-medium text-ink">
          {COPY.examplesHeading}
        </h2>
        <ul className="flex flex-col border-t border-rule">
          {EXAMPLES.map(({ curated, shape }) => (
            <li key={curated.slug} className="border-b border-rule">
              <button
                type="button"
                aria-pressed={picked?.slug === curated.slug}
                onClick={() => pick(curated)}
                className="flex w-full min-w-0 flex-col items-start gap-1 py-3 text-left hover:bg-rule/40 aria-pressed:bg-rule/40"
              >
                <span className="wrap-break-word text-ink">{curated.recipe.title}</span>
                <span className="text-sm tabular-nums text-ink-3">{shape}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
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
