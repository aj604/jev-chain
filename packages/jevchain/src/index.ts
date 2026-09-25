/**
 * jevchain: chains of decisions for Jev.
 *
 * Jev doesn't write prose; it answers typed questions with calibrated
 * probabilities. JevChain composes those answers into graphs (route, gate,
 * parallel, cascade, step) and records every decision in a trace.
 */
export {
  choice,
  score,
  noul,
  confidenceOf,
  type Json,
  type Entry,
  type Question,
  type Questions,
  type ChoiceQuestion,
  type ScoreQuestion,
  type NoulQuestion,
  type Answer,
  type Answers,
  type AnswerOf,
  type ChoiceAnswer,
  type ScoreAnswer,
  type NoulAnswer,
  type LabelsOf,
} from "./questions";

export {
  ask,
  route,
  gate,
  parallel,
  cascade,
  tier,
  step,
  emit,
  chain,
  describe,
  childrenOf,
  walk,
  findNode,
  childPath,
  ROOT_PATH,
  type JevNode,
  type AnyNode,
  type AnyJevNode,
  type NodeKind,
  type InputOf,
  type OutputOf,
  type AskNode,
  type RouteNode,
  type GateNode,
  type ParallelNode,
  type CascadeNode,
  type CascadeResult,
  type Tier,
  type StepNode,
  type EmitNode,
  type ChainNode,
  type StepContext,
  type StateSpec,
  type Threshold,
  type Child,
} from "./nodes";

export {
  createJevClient,
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  DEFAULT_USD_PER_MTOK,
  type JevClient,
  type JevClientOptions,
  type AskOptions,
  type AskResult,
  type RetryPolicy,
  type BatchOptions,
  type Usage,
} from "./client";

export { run, stream, createJev, toJsonSafe, type Jev, type RunOptions, type RunResult, type TraceStream } from "./runtime";

export {
  reduceTrace,
  traceFromEvents,
  visitedPaths,
  spanAt,
  decisions,
  diffTraces,
  TRACE_VERSION,
  type Trace,
  type TraceEvent,
  type Span,
  type SpanStatus,
  type RunStatus,
  type JevCall,
  type Decision,
  type EdgeScore,
  type Metric,
  type RetryRecord,
  type SpanLog,
  type TraceUsage,
  type PathDiff,
} from "./trace";

export { explainDecision, explainTrace, marginWord } from "./explain";
export { toJSON, fromJSON, handlersOf, CHAIN_FORMAT, type ChainDocument, type FromJsonOptions, type Handler, type Ref } from "./serialize";
export { toTypeScript, type CodegenOptions } from "./codegen";
export { chainIssues, DECISION_KEY } from "./validate";
export { renderTemplate, type OnMissing } from "./template";

export {
  JevChainError,
  JevAPIError,
  JevAuthError,
  JevValidationError,
  JevRateLimitError,
  JevServerError,
  JevTimeoutError,
  JevConnectionError,
  JevAbortError,
  JevResponseError,
  ChainConfigError,
  NodeError,
  CancelledError,
  serializeError,
  type SerializedError,
} from "./errors";
export {
  graphOf,
  overlayTrace,
  type FlowGraph,
  type Vertex,
  type VertexKind,
  type Edge,
  type GraphOverlay,
  type VertexOverlay,
  type EdgeOverlay,
  type VertexState,
  type EdgeState,
} from "./graph";
