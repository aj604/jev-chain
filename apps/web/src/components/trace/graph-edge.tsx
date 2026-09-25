"use client";

import { memo } from "react";
import { EdgeLabelRenderer, type Edge as RFEdge, type EdgeProps } from "@xyflow/react";
import type { Edge, EdgeOverlay } from "jevchain";
import { cn } from "@/lib/cn";
import { fmtMetric } from "@/lib/trace/format";
import { edgePath, type Direction, type Point } from "@/lib/trace/layout";

export type FlowEdgeData = {
  edge: Edge;
  overlay: EdgeOverlay;
  overlayB?: EdgeOverlay;
  /** The target is running right now: animate the dash. */
  flowing: boolean;
  markerPrefix: string;
  compact: boolean;
  /** Where layout put this edge's pill (flow coordinates). */
  labelPos?: Point;
  direction: Direction;
  /** Sweep mode: how many of `total` runs took this edge. */
  traffic?: { count: number; total: number };
  onSelect?: (id: string) => void;
};

export type FlowEdge = RFEdge<FlowEdgeData, "trace">;

export type EdgeTone = "idle" | "taken" | "dim" | "b" | "both";

export function edgeTone(overlay: EdgeOverlay, overlayB?: EdgeOverlay): EdgeTone {
  if (overlayB) {
    const a = overlay.state === "taken";
    const b = overlayB.state === "taken";
    if (a && b) return "both";
    if (a) return "taken";
    if (b) return "b";
    return overlay.state === "not-taken" || overlayB.state === "not-taken" ? "dim" : "idle";
  }
  return overlay.state === "taken" ? "taken" : overlay.state === "not-taken" ? "dim" : "idle";
}

const STROKE: Record<EdgeTone, { color: string; width: number; dash?: string }> = {
  idle: { color: "var(--ink-3)", width: 1.2 },
  taken: { color: "var(--accent)", width: 2.5 },
  b: { color: "var(--compare)", width: 2.5 },
  both: { color: "var(--ink)", width: 2.5 },
  dim: { color: "var(--dim)", width: 1.2, dash: "3 4" },
};

function TraceEdgeImpl({ id, sourceX, sourceY, targetX, targetY, data }: EdgeProps<FlowEdge>) {
  if (!data) return null;
  const { edge, overlay, overlayB, flowing, markerPrefix, compact, labelPos, direction, traffic } = data;
  const tone = edgeTone(overlay, overlayB);
  const s = STROKE[tone];
  // A sweep draws busier roads thicker: 1.5px for one input, up to 5px for all of them.
  const width = traffic && traffic.count > 0 ? 1.5 + 3.5 * (traffic.count / Math.max(1, traffic.total)) : s.width;
  const { d, label } = direction === "TB" ? edgePath(sourceX, sourceY, targetX, targetY - 3, labelPos, "TB") : edgePath(sourceX, sourceY, targetX - 3, targetY, labelPos);

  const valueA = fmtMetric(overlay.metric, overlay.value);
  const valueB = overlayB ? fmtMetric(overlayB.metric, overlayB.value) : null;
  const showPill = traffic ? Boolean(edge.label || traffic.count > 0) : !compact || tone !== "idle" ? Boolean(edge.label || valueA || valueB) : Boolean(edge.label);
  const takenAny = tone === "taken" || tone === "b" || tone === "both";

  return (
    <>
      <path
        id={id}
        d={d}
        fill="none"
        className={cn("react-flow__edge-path", flowing && takenAny && "edge-flow")}
        style={{ stroke: s.color, strokeWidth: width, strokeDasharray: flowing && takenAny ? undefined : s.dash }}
        markerEnd={`url(#${markerPrefix}-${tone})`}
      />
      {/* fat invisible hit area so hovering is forgiving */}
      <path d={d} fill="none" stroke="transparent" strokeWidth={14} className="react-flow__edge-interaction" />
      {showPill && (
        <EdgeLabelRenderer>
          <button
            type="button"
            tabIndex={-1}
            onClick={() => edge.decidedBy && data.onSelect?.(edge.decidedBy.spanPath)}
            className={cn(
              "nodrag nopan absolute flex h-[18px] items-center gap-1 px-1.5 font-mono text-[10px] leading-none whitespace-nowrap transition-[background-color,color,border-color,opacity] duration-(--dur) ease-snap",
              tone === "idle" && "border-soft bg-paper text-ink-2",
              tone === "taken" && "border-hard bg-accent text-accent-ink",
              tone === "b" && "border-hard bg-compare text-paper",
              tone === "both" && "border-hard bg-ink text-paper",
              tone === "dim" && "border-dashed border-(length:--bw) border-dim bg-paper text-ink-3",
              edge.decidedBy ? "cursor-pointer" : "cursor-default",
            )}
            style={{ transform: `translate(-50%, -50%) translate(${label.x}px, ${label.y}px)`, pointerEvents: "all" }}
            aria-label={
              traffic
                ? `${edge.label || "edge"}: ${traffic.count} of ${traffic.total} inputs went this way`
                : `${edge.label || "edge"}${takenAny ? " (taken)" : tone === "dim" ? " (not taken)" : ""}${valueA ? ` ${valueA}` : ""}`
            }
          >
            {takenAny && !traffic && <span aria-hidden>✓</span>}
            {edge.label && <span>{edge.label}</span>}
            {traffic ? (
              <span className="tabular-nums opacity-85">
                {edge.label && "· "}
                {traffic.count}/{traffic.total}
              </span>
            ) : overlayB ? (
              (valueA || valueB) && (
                <span className="tabular-nums opacity-85">
                  {edge.label && "· "}a {valueA ?? "–"} · b {valueB ?? "–"}
                </span>
              )
            ) : (
              valueA && (
                <span className="tabular-nums opacity-85">
                  {edge.label && "· "}
                  {valueA}
                </span>
              )
            )}
          </button>
        </EdgeLabelRenderer>
      )}
    </>
  );
}

export const TraceEdge = memo(TraceEdgeImpl);

/** Arrowheads, one per tone. Rendered once per graph; ids are namespaced. */
export function EdgeMarkers({ prefix }: { prefix: string }) {
  return (
    <svg aria-hidden width="0" height="0" className="absolute">
      <defs>
        {(Object.keys(STROKE) as EdgeTone[]).map((tone) => (
          <marker
            key={tone}
            id={`${prefix}-${tone}`}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth={tone === "idle" || tone === "dim" ? 7 : 4.5}
            markerHeight={tone === "idle" || tone === "dim" ? 7 : 4.5}
            markerUnits="strokeWidth"
            orient="auto"
          >
            <path d="M0,0 L10,5 L0,10 z" style={{ fill: STROKE[tone].color }} />
          </marker>
        ))}
      </defs>
    </svg>
  );
}
