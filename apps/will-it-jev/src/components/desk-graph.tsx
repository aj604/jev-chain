"use client";

import type { Trace } from "jevchain";
import dynamic from "next/dynamic";
import { useMemo } from "react";
import { compileRecipe } from "@/lib/recipe/compile";
import type { Recipe } from "@/lib/recipe/types";

// React Flow is the heavy part, and it needs the browser to measure.
const TraceGraph = dynamic(() => import("jevchain-trace-ui/components/trace-graph").then((m) => m.TraceGraph), {
  ssr: false,
  loading: () => null,
});

/**
 * The desk drawn as the studio draws a chain: every gate, route and outcome,
 * with the path the run took lit and the roads not taken dimmed. With no
 * trace it is the bare map of the desk.
 */
export function DeskGraph({
  recipe,
  trace,
  selected,
  onSelect,
  className,
}: {
  recipe: Recipe;
  trace?: Trace;
  selected?: string | null;
  onSelect?: (id: string | null) => void;
  className?: string;
}) {
  const chain = useMemo(() => compileRecipe(recipe), [recipe]);
  return (
    <TraceGraph
      chain={chain}
      trace={trace}
      selected={selected}
      onSelect={onSelect}
      compact
      className={className}
    />
  );
}

/**
 * The trace as it looked after its first `shown` spans, so a run that
 * finishes in half a second can still be watched gate by gate. It stays
 * "running" until every span is out.
 */
export function pacedTrace(trace: Trace | undefined, shown: number): Trace | undefined {
  if (!trace || !Array.isArray(trace.spans) || shown >= trace.spans.length) return trace;
  return { ...trace, spans: trace.spans.slice(0, shown), status: "running", output: undefined };
}
