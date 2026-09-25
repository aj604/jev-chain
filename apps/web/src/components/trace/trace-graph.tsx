"use client";

/**
 * TraceGraph: a chain drawn as a flow graph, with a trace painted on top.
 *
 *   <TraceGraph chain={node} trace={trace} selected={id} onSelect={setId} />
 *   <TraceGraph graph={graphOf(node)} compact />            // no trace: just the shape
 *   <TraceGraph chain={node} trace={a} compare={b} />       // A/B paths in two colors
 *
 * Layout is memoized per graph (dagre, left → right); streaming events only
 * change the overlay, so a live run restyles nodes and edges without moving
 * anything. Pass `fitSignal` (any changing number) to re-fit the view.
 */
import "@xyflow/react/dist/base.css";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Background,
  BackgroundVariant,
  Panel as FlowPanel,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type EdgeTypes,
  type NodeTypes,
} from "@xyflow/react";
import { graphOf, overlayTrace, type AnyNode, type FlowGraph, type Trace, type Vertex } from "jevchain";
import { cn } from "@/lib/cn";
import { useTheme } from "@/lib/use-theme";
import { layoutGraph, nodeSize, pickDirection, vertexHints, type Direction } from "@/lib/trace/layout";
import { EdgeMarkers, TraceEdge, type FlowEdge } from "./graph-edge";
import { TraceNode, type FlowNode, type VertexDecoration } from "./graph-node";

export interface TraceGraphProps {
  /** The chain to draw. Or pass a precomputed `graph`. */
  chain?: AnyNode;
  graph?: FlowGraph;
  trace?: Trace;
  /** Compare mode: a second trace of the same chain, drawn in the compare color. */
  compare?: Trace;
  selected?: string | null;
  onSelect?: (id: string | null) => void;
  /** Smaller chrome, no controls, doesn't capture scroll. For docs and cards. */
  compact?: boolean;
  /** Change this number to re-fit the view (e.g. from an `f` hotkey). */
  fitSignal?: number;
  className?: string;
  /** Extra overlay content (top-left), e.g. a status chip. */
  children?: ReactNode;
  /**
   * Flow direction. "auto" (default) lays out left→right, switching to
   * top→bottom when that draws the chain clearly bigger in the space available.
   */
  direction?: Direction | "auto";
  /** Builder extras per vertex id: empty slots, bound/unbound code, issues. */
  decorations?: Record<string, VertexDecoration>;
  /** Right-click on a node (the builder's context menu). */
  onNodeContextMenu?: (id: string, at: { x: number; y: number }) => void;
}

const nodeTypes: NodeTypes = { trace: TraceNode };
const edgeTypes: EdgeTypes = { trace: TraceEdge };

export function TraceGraph(props: TraceGraphProps) {
  return (
    <ReactFlowProvider>
      <TraceGraphInner {...props} />
    </ReactFlowProvider>
  );
}

function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const r = entry!.contentRect;
      setSize((s) => (Math.abs(s.w - r.width) < 1 && Math.abs(s.h - r.height) < 1 ? s : { w: r.width, h: r.height }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

function TraceGraphInner({
  chain,
  graph: graphProp,
  trace,
  compare,
  selected = null,
  onSelect,
  compact = false,
  fitSignal,
  className,
  children,
  direction: directionProp = "auto",
  decorations,
  onNodeContextMenu,
}: TraceGraphProps) {
  const [boxRef, box] = useSize<HTMLDivElement>();
  // Follow the app's theme toggle, not the OS ("system" would ignore it).
  const { resolved: resolvedTheme } = useTheme();
  const rawId = useId();
  const markerPrefix = `m${rawId.replace(/[^a-zA-Z0-9]/g, "")}`;

  const graph = useMemo(() => graphProp ?? (chain ? graphOf(chain) : { vertices: [], edges: [], entry: "" }), [graphProp, chain]);
  const hints = useMemo(() => vertexHints(chain, graph), [chain, graph]);
  const sizeOf = useCallback((v: Vertex) => nodeSize(v, hints[v.id]), [hints]);
  const layoutLR = useMemo(() => layoutGraph(graph, sizeOf, "LR"), [graph, sizeOf]);
  const layoutTB = useMemo(() => (directionProp === "LR" ? null : layoutGraph(graph, sizeOf, "TB")), [graph, sizeOf, directionProp]);
  const direction: Direction = directionProp === "auto" ? pickDirection(layoutLR, layoutTB!, box.w, box.h) : directionProp;
  const layout = direction === "TB" && layoutTB ? layoutTB : layoutLR;

  const overlay = useMemo(() => overlayTrace(graph, trace), [graph, trace]);
  const overlayB = useMemo(() => (compare ? overlayTrace(graph, compare) : undefined), [graph, compare]);

  // Pass a stable `onSelect` (a state setter or useCallback) to keep nodes memoized.
  const select = onSelect;

  const nodes = useMemo<FlowNode[]>(
    () =>
      graph.vertices.map((v) => {
        const size = layout.sizes[v.id]!;
        return {
          id: v.id,
          type: "trace",
          position: layout.positions[v.id]!,
          width: size.width,
          height: size.height,
          draggable: false,
          connectable: false,
          selectable: false,
          focusable: false,
          data: {
            vertex: v,
            hint: hints[v.id] ?? {},
            overlay: overlay.vertices[v.id] ?? { state: "idle" },
            ...(overlayB ? { overlayB: overlayB.vertices[v.id] ?? { state: "idle" } } : {}),
            selected: selected === v.id,
            ...(decorations?.[v.id] ? { decoration: decorations[v.id] } : {}),
            compact,
            direction,
            ...(select ? { onSelect: select } : {}),
          },
        };
      }),
    [graph, layout, hints, overlay, overlayB, selected, compact, select, direction, decorations],
  );

  const edges = useMemo<FlowEdge[]>(
    () =>
      graph.edges.map((e) => {
        const target = overlay.vertices[e.target]?.state;
        const targetB = overlayB?.vertices[e.target]?.state;
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          type: "trace",
          selectable: false,
          focusable: false,
          zIndex: overlay.edges[e.id]?.state === "taken" || overlayB?.edges[e.id]?.state === "taken" ? 2 : 1,
          data: {
            edge: e,
            overlay: overlay.edges[e.id] ?? { state: "idle" },
            ...(overlayB ? { overlayB: overlayB.edges[e.id] ?? { state: "idle" } } : {}),
            flowing: target === "running" || targetB === "running",
            markerPrefix,
            compact,
            direction,
            ...(layout.labels[e.id] ? { labelPos: layout.labels[e.id] } : {}),
            ...(select ? { onSelect: select } : {}),
          },
        };
      }),
    [graph, layout, overlay, overlayB, markerPrefix, compact, select, direction],
  );

  const graphKey = useMemo(() => `${direction}:${graph.vertices.map((v) => v.id).join("|")}`, [graph, direction]);

  return (
    <div ref={boxRef} className={cn("trace-flow relative h-full min-h-0 w-full bg-paper", className)}>
      <EdgeMarkers prefix={markerPrefix} />
      {box.w > 0 && (
      <ReactFlow<FlowNode, FlowEdge>
        key={graphKey}
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        fitView
        fitViewOptions={{ padding: compact ? 0.08 : 0.16, maxZoom: 1.1 }}
        minZoom={0.2}
        maxZoom={2}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        elementsSelectable={false}
        zoomOnScroll={!compact}
        panOnScroll={false}
        preventScrolling={!compact}
        zoomOnDoubleClick={false}
        onPaneClick={() => onSelect?.(null)}
        // React Flow gives nodes `pointer-events: none` unless they have a click handler,
        // so without this the cards' own buttons never see a real pointer.
        {...(onSelect ? { onNodeClick: (_e: React.MouseEvent, node: FlowNode) => onSelect(node.id) } : {})}
        {...(onNodeContextMenu
          ? {
              onNodeContextMenu: (e: React.MouseEvent, node: FlowNode) => {
                e.preventDefault();
                onSelect?.(node.id);
                onNodeContextMenu(node.id, { x: e.clientX, y: e.clientY });
              },
            }
          : {})}
        colorMode={resolvedTheme}
        aria-label="chain graph"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="var(--dim)" />
        <FitOnSignal signal={fitSignal} padding={compact ? 0.08 : 0.16} />
        <FitOnResize w={box.w} h={box.h} padding={compact ? 0.08 : 0.16} />
        {!compact && <GraphControls />}
        {!compact && <Legend compare={Boolean(compare)} />}
      </ReactFlow>
      )}
      {children && <div className="pointer-events-none absolute top-3 left-3 z-10 [&>*]:pointer-events-auto">{children}</div>}
    </div>
  );
}

function FitOnSignal({ signal, padding }: { signal?: number; padding: number }) {
  const rf = useReactFlow();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (signal === undefined) return;
    void rf.fitView({ padding, maxZoom: 1.1, duration: 200 });
  }, [signal, padding, rf]);
  return null;
}

/** Re-fit when the canvas changes size (compare mode, timeline drag, window resize). */
function FitOnResize({ w, h, padding }: { w: number; h: number; padding: number }) {
  const rf = useReactFlow();
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const t = setTimeout(() => void rf.fitView({ padding, maxZoom: 1.1, duration: 150 }), 120);
    return () => clearTimeout(t);
  }, [w, h, padding, rf]);
  return null;
}

function GraphControls() {
  const rf = useReactFlow();
  const btn =
    "grid size-7 place-items-center bg-paper font-mono text-[13px] leading-none text-ink-2 transition-colors duration-(--dur-fast) hover:bg-surface-2 hover:text-ink";
  return (
    <FlowPanel position="bottom-left" className="!m-3 flex border-hard bg-paper">
      <button type="button" className={btn} aria-label="zoom in" onClick={() => void rf.zoomIn({ duration: 150 })}>
        +
      </button>
      <button type="button" className={cn(btn, "border-soft-l")} aria-label="zoom out" onClick={() => void rf.zoomOut({ duration: 150 })}>
        −
      </button>
      <button
        type="button"
        className={cn(btn, "border-soft-l w-auto px-2 text-[11px] lowercase")}
        aria-label="fit view"
        onClick={() => void rf.fitView({ padding: 0.16, maxZoom: 1.1, duration: 200 })}
      >
        fit
      </button>
    </FlowPanel>
  );
}

function Legend({ compare }: { compare: boolean }) {
  const line = (color: string, dashed = false, thick = true) => (
    <svg width="18" height="6" aria-hidden className="shrink-0">
      <line x1="0" y1="3" x2="18" y2="3" stroke={color} strokeWidth={thick ? 2.5 : 1.2} strokeDasharray={dashed ? "3 3" : undefined} />
    </svg>
  );
  return (
    <FlowPanel position="top-right" className="!m-3 hidden items-center gap-3 border-soft bg-paper/90 px-2 py-1 font-mono text-[10px] lowercase text-ink-3 sm:flex">
      {compare ? (
        <>
          <span className="flex items-center gap-1">{line("var(--accent)")}a</span>
          <span className="flex items-center gap-1">{line("var(--compare)")}b</span>
          <span className="flex items-center gap-1">{line("var(--ink)")}both</span>
        </>
      ) : (
        <span className="flex items-center gap-1">{line("var(--accent)")}taken</span>
      )}
      <span className="flex items-center gap-1">{line("var(--dim)", true, false)}not taken</span>
    </FlowPanel>
  );
}
