import { useId } from "react";
import type { AnyNode, GraphOverlay, VertexKind } from "jevchain";
import { graphOf } from "jevchain";
import { CALLS_JEV, layoutGraph, type ChainLayout, type MapDetail, type MapEdge, type MapNode } from "@/lib/chain-layout";
import { cn } from "@/lib/cn";

/**
 * A static drawing of a chain: the flow graph from `graphOf`, laid out LR by
 * dagre, rendered as plain SVG. No interactivity, no client JS; it's a map,
 * not the studio.
 *
 *   <ChainMap chain={example.chain} />                     card thumbnail
 *   <ChainMap chain={chain} detail="full" />               labelled, bigger
 *   <ChainMap chain={chain} detail="full" overlay={o} />   a trace painted on
 *
 * Nodes that spend a Jev call (ask/route/gate/tier) carry the pink marker.
 */
export function ChainMap({
  chain,
  layout: given,
  detail = "compact",
  overlay,
  label,
  maxScale = detail === "compact" ? 1.35 : 1.15,
  minScale = detail === "full" ? 0.8 : 0,
  className,
}: {
  /** Smallest downscale before the map stops shrinking (and its parent should scroll). 0 = always fit. */
  minScale?: number;
  chain?: AnyNode;
  /**
   * Largest upscale over the layout's natural size. The SVG otherwise fills its
   * box (width 100%, height clamped by the parent), so tiny chains don't balloon.
   */
  maxScale?: number;
  /** Pre-computed layout (skip `chain`). */
  layout?: ChainLayout;
  detail?: MapDetail;
  /** Paint a trace: taken edges go accent, skipped nodes fade. Needs `chain`. */
  overlay?: GraphOverlay;
  /** Accessible description. Defaults to a count of nodes. */
  label?: string;
  className?: string;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const layout = given ?? (chain ? layoutGraph(graphOf(chain), detail) : undefined);
  if (!layout) return null;
  const pad = detail === "compact" ? 4 : 8;
  const vbW = layout.width + pad * 2;
  const vbH = layout.height + pad * 2;
  const vb = `${-pad} ${-pad} ${vbW} ${vbH}`;
  const full = detail === "full";

  const vState = (id: string) => overlay?.vertices[id]?.state;
  const eState = (id: string) => overlay?.edges[id]?.state;

  // Draw not-taken edges first so taken ones sit on top.
  const edges = [...layout.edges].sort((a, b) => rankEdge(eState(a.id)) - rankEdge(eState(b.id)));

  return (
    <svg
      viewBox={vb}
      role="img"
      aria-label={label ?? `flow graph: ${layout.nodes.length} nodes, ${layout.edges.length} edges`}
      preserveAspectRatio="xMidYMid meet"
      className={cn("block h-auto max-h-full w-full overflow-visible", className)}
      style={{
        aspectRatio: `${vbW} / ${vbH}`,
        maxWidth: vbW * maxScale,
        maxHeight: vbH * maxScale,
        // Labelled maps stay legible: past `minScale` they scroll (in an overflow-x-auto parent) instead of shrinking.
        ...(minScale > 0 ? { minWidth: Math.round(vbW * minScale) } : {}),
      }}
    >
      <defs>
        {(["idle", "taken", "not-taken"] as const).map((s) => (
          <marker
            key={s}
            id={`${uid}-arrow-${s}`}
            viewBox="0 0 6 6"
            refX="5.5"
            refY="3"
            markerWidth={full ? 6 : 5}
            markerHeight={full ? 6 : 5}
            orient="auto-start-reverse"
          >
            <path d="M0 0.5 L5.5 3 L0 5.5" fill="none" stroke={edgeColor(s)} strokeWidth="1.1" />
          </marker>
        ))}
      </defs>

      <g fill="none">
        {edges.map((e) => (
          <EdgePath key={e.id} edge={e} state={eState(e.id) ?? "idle"} full={full} uid={uid} />
        ))}
      </g>

      <g>
        {layout.nodes.map((n) => (
          <NodeBox key={n.id} node={n} full={full} state={vState(n.id)} />
        ))}
      </g>

      {full && (
        <g>
          {layout.edges
            .filter((e) => e.labelAt)
            .map((e) => {
              const s = eState(e.id) ?? "idle";
              const w = e.label.length * 6 + 8;
              return (
                <g key={`${e.id}-label`} transform={`translate(${e.labelAt!.x} ${e.labelAt!.y})`}>
                  <rect x={-w / 2} y={-7.5} width={w} height={15} fill="var(--paper)" />
                  <text
                    textAnchor="middle"
                    dominantBaseline="central"
                    className="font-mono"
                    fontSize={10}
                    fill={s === "taken" ? "var(--accent-strong)" : "var(--ink-3)"}
                  >
                    {e.label}
                  </text>
                </g>
              );
            })}
        </g>
      )}
    </svg>
  );
}

const rankEdge = (s: string | undefined) => (s === "taken" ? 2 : s === "not-taken" ? 0 : 1);

function edgeColor(state: string) {
  return state === "taken" ? "var(--accent)" : state === "not-taken" ? "var(--dim)" : "var(--ink-3)";
}

function EdgePath({ edge, state, full, uid }: { edge: MapEdge; state: string; full: boolean; uid: string }) {
  if (edge.points.length < 2) return null;
  const d = edge.points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
  return (
    <path
      d={d}
      stroke={edgeColor(state)}
      strokeWidth={state === "taken" ? (full ? 2 : 1.6) : 1}
      strokeDasharray={state === "not-taken" || edge.kind === "halt" ? "3 3" : edge.kind === "escalate" ? "1 2.5" : undefined}
      strokeLinejoin="round"
      vectorEffect="non-scaling-stroke"
      markerEnd={`url(#${uid}-arrow-${state})`}
    />
  );
}

const KIND_FILL: Partial<Record<VertexKind, string>> = {
  step: "var(--surface-2)",
  parallel: "var(--ink)",
  join: "var(--ink)",
};

function NodeBox({ node: n, full, state }: { node: MapNode; full: boolean; state?: string }) {
  const x = n.x - n.w / 2;
  const y = n.y - n.h / 2;
  const skipped = state === "skipped";
  const ran = state === "ok" || state === "halted" || state === "error" || state === "running";
  const inverted = n.kind === "parallel" || n.kind === "join";
  const isHalt = n.kind === "halt";
  const leaf = n.kind === "emit";
  const stroke = isHalt ? "var(--fail)" : leaf && !ran ? "var(--ink-3)" : "var(--ink)";
  const fill = isHalt ? "var(--fail-wash)" : (KIND_FILL[n.kind] ?? "var(--paper)");
  const text = inverted ? "var(--paper)" : isHalt ? "var(--fail)" : "var(--ink)";
  const font = full ? 11 : 9;
  const tagSize = font - 2;
  const tagW = full && !inverted && !isHalt ? n.kind.length * tagSize * 0.6 + 10 : 0;
  const callsJev = CALLS_JEV.has(n.kind);

  return (
    <g opacity={skipped ? 0.35 : 1}>
      <title>{`${n.kind} · ${n.nodeId}`}</title>
      {/* the house hard shadow, only on nodes a trace actually visited */}
      {ran && <rect x={x + 2} y={y + 2} width={n.w} height={n.h} fill="var(--ink)" />}
      <rect
        x={x}
        y={y}
        width={n.w}
        height={n.h}
        fill={ran && callsJev ? "var(--accent-wash)" : fill}
        stroke={stroke}
        strokeWidth={1.2}
        strokeDasharray={leaf || isHalt ? "3 2" : undefined}
        vectorEffect="non-scaling-stroke"
      />
      {callsJev && (
        <rect
          x={x}
          y={y}
          width={full ? 4 : 3}
          height={n.h}
          fill="var(--accent)"
        />
      )}
      {full && tagW > 0 && (
        <text
          x={x + (callsJev ? 10 : 8)}
          y={n.y}
          dominantBaseline="central"
          className="font-mono"
          fontSize={tagSize}
          fill="var(--ink-3)"
        >
          {n.kind}
        </text>
      )}
      <text
        x={full && tagW > 0 ? x + tagW + (callsJev ? 4 : 2) : n.x + (callsJev && !full ? 1.5 : 0)}
        y={n.y}
        textAnchor={full && tagW > 0 ? "start" : "middle"}
        dominantBaseline="central"
        className="font-mono"
        fontSize={font}
        fill={text}
      >
        {n.label}
      </text>
    </g>
  );
}

/** Legend for the map's visual language. */
export function ChainMapLegend({ className }: { className?: string }) {
  const items: Array<{ swatch: React.ReactNode; label: string }> = [
    {
      swatch: (
        <span className="relative inline-block h-3 w-5 border-hard bg-paper">
          <span className="absolute inset-y-0 left-0 w-[3px] bg-accent" />
        </span>
      ),
      label: "calls jev",
    },
    { swatch: <span className="inline-block h-3 w-5 border-hard bg-surface-2" />, label: "your code" },
    { swatch: <span className="inline-block h-3 w-5 border-(length:--bw) border-dashed border-ink-3" />, label: "leaf / emit" },
    { swatch: <span className="inline-block h-3 w-5 border-hard bg-ink" />, label: "fork / join" },
  ];
  return (
    <ul className={cn("flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono text-[11px] lowercase text-ink-3", className)}>
      {items.map((i) => (
        <li key={i.label} className="flex items-center gap-1.5">
          {i.swatch}
          {i.label}
        </li>
      ))}
    </ul>
  );
}
