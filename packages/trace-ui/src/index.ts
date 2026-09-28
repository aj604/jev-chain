/**
 * jevchain-trace-ui: a chain run, drawn.
 *
 *   import { TraceGraph, WhyPanel, traceIssue } from "jevchain-trace-ui";
 *
 * Styles: import "jevchain-trace-ui/trace.css" from the app's Tailwind entry
 * and point `@source` at this package (see the header of trace.css for the
 * wiring and the CSS variables the app must define).
 *
 * Entry points:
 *   "jevchain-trace-ui"               components + every helper
 *   "jevchain-trace-ui/helpers"       the pure helpers only (no React)
 *   "jevchain-trace-ui/components/x"  one component module, for lazy loading
 *                                     (e.g. next/dynamic on ".../trace-graph")
 */
export { TraceGraph, type TraceGraphProps } from "./components/trace-graph";
export { TraceNode, type FlowNode, type FlowNodeData, type VertexDecoration } from "./components/graph-node";
export { TraceEdge, EdgeMarkers, edgeTone, type FlowEdge, type FlowEdgeData, type EdgeTone } from "./components/graph-edge";
export { WhyPanel, IssueBox, SteadyLine, type WhyPanelProps, type ReaskControl } from "./components/why-panel";
export { Inspector, type InspectorProps, type WhatIfControl } from "./components/inspector";
export { Distribution, type DistributionMarks } from "./components/distribution";
export { RunSummary } from "./components/run-summary";
export { Timeline, type TimelineProps } from "./components/timeline";
export { ForkList } from "./components/fork-list";
export { JsonView } from "./components/json-view";
export { KIND_GLYPH, KindTag, StateMark, STATE_LABEL, type AnyState } from "./components/kinds";

export * from "./lib";
