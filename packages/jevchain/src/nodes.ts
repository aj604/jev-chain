/**
 * Nodes: the building blocks of a chain.
 *
 * A node is a plain object: the same shape you'd write in JSON, plus inline
 * functions where you supplied code (`step`, `state`, `join`). That's what lets
 * one definition drive the runtime, the serializer, the code generator and the
 * web app's graph without any translation layer.
 *
 * Every node carries phantom input/output types, so composition is checked
 * end-to-end at compile time: `chain(a, b)` only compiles when `a`'s output
 * fits `b`'s input.
 */
import type {
  AnswerOf,
  Answers,
  ChoiceQuestion,
  Entry,
  Json,
  NoulQuestion,
  Question,
  Questions,
  ScoreQuestion,
} from "./questions";
import type { JevClient } from "./client";

declare const io: unique symbol;

export type NodeKind = "ask" | "route" | "gate" | "parallel" | "cascade" | "step" | "emit" | "chain";

/** Anything in a chain. `I` is what it accepts, `O` what it produces. */
export interface JevNode<I = any, O = any> {
  readonly kind: NodeKind;
  readonly id: string;
  /** Human title for UIs. Defaults to the id. */
  readonly title?: string;
  readonly description?: string;
  /** Phantom: never set at runtime. Carries I (contravariant) and O (covariant). */
  readonly [io]?: { in: (input: I) => void; out: O };
}

export type AnyNode = JevNode<any, any>;
export type InputOf<N> = N extends JevNode<infer I, any> ? I : never;
export type OutputOf<N> = N extends JevNode<any, infer O> ? O : never;

/**
 * The input a set of branches can all accept: the intersection of their inputs.
 * (Wrapping each input in a function first stops `unknown | string` collapsing
 * to `unknown` before we get to intersect.)
 */
type InputSink<B> = B extends JevNode<infer I, any> ? (input: I) => void : never;
type SharedInput<B> = [B] extends [never] ? unknown : [InputSink<B>] extends [(input: infer X) => void] ? X : unknown;

/**
 * Where Jev's `state` comes from.
 * - omitted: the node's input, as-is
 * - a template string: `"{{input.message}}"`, or text with holes: `"From {{input.user}}: {{input.text}}"`
 * - a function: full control (serialized by reference)
 */
export type StateSpec<I> = string | ((input: I) => Entry);

/** Handed to your code in `step`, `state`, and `join` functions. */
export interface StepContext {
  /** The input the whole run started with. */
  readonly runInput: unknown;
  /** Outputs of every node that has finished so far, by node id. */
  readonly results: Readonly<Record<string, unknown>>;
  /** Cancelled when the run is aborted or times out. */
  readonly signal: AbortSignal;
  /** The Jev client running this chain, for ad-hoc calls. */
  readonly jev: JevClient;
  /** Attach a note to this node's span in the trace. */
  log(message: string, data?: Json): void;
}

// ---------------------------------------------------------------------------
// Node shapes
// ---------------------------------------------------------------------------

interface JevCallConfig<I> {
  /** Where the state comes from. Defaults to the node's input. */
  readonly state?: StateSpec<I>;
  /** Override the client's model for this node, e.g. to pin `jev-1.13.0`. */
  readonly model?: string;
}

export interface AskNode<I = any, Q extends Questions = Questions> extends JevNode<I, Answers<Q>>, JevCallConfig<I> {
  readonly kind: "ask";
  readonly questions: Q;
}

export interface RouteNode<I = any, O = any> extends JevNode<I, O>, JevCallConfig<I> {
  readonly kind: "route";
  readonly ask: ChoiceQuestion<string>;
  /** Extra questions asked in the same call and recorded in the trace (speculative fan-out). */
  readonly alsoAsk?: Questions;
  readonly branches: Readonly<Record<string, AnyNode>>;
  /** Taken instead of the chosen branch when Jev isn't sure enough. */
  readonly lowConfidence?: { readonly below: number; readonly then: AnyNode };
}

export interface Threshold {
  /** For a choice: the label whose probability is measured. */
  readonly label?: string;
  /** Pass when the value is at least this. */
  readonly min?: number;
  /** Pass when the value is at most this. */
  readonly max?: number;
}

export interface GateNode<I = any, O = any> extends JevNode<I, O>, JevCallConfig<I> {
  readonly kind: "gate";
  readonly ask: Question;
  readonly alsoAsk?: Questions;
  readonly pass: Threshold;
  readonly then: AnyNode;
  /** Taken when the bar isn't cleared. Omit it and the run halts instead. */
  readonly otherwise?: AnyNode;
  /** A third path for "too close to call". */
  readonly unsure?: {
    /** Unsure when the value is within this distance of the bar. */
    readonly margin?: number;
    /** Unsure when Jev's confidence is below this (choice/score) or the noul is this close to 0.5. */
    readonly minConfidence?: number;
    readonly then: AnyNode;
  };
}

export interface ParallelNode<I = any, O = any> extends JevNode<I, O> {
  readonly kind: "parallel";
  readonly branches: Readonly<Record<string, AnyNode>>;
  /** Combine branch outputs. Omit to get an object of results keyed like `branches`. */
  readonly join?: (results: any, input: I, ctx: StepContext) => O | Promise<O>;
}

export interface Tier<Q extends Question = Question> extends JevCallConfig<any> {
  readonly id: string;
  readonly title?: string;
  readonly ask: Q;
  /** Accept this tier's answer when confidence is at least this. */
  readonly minConfidence: number;
}

export interface CascadeNode<I = any, O = any> extends JevNode<I, O> {
  readonly kind: "cascade";
  readonly tiers: readonly Tier[];
  /** The last resort when no tier is confident enough: an LLM, a human, a shrug. */
  readonly fallback: AnyNode;
}

export interface StepNode<I = any, O = any> extends JevNode<I, O> {
  readonly kind: "step";
  readonly run: (input: I, ctx: StepContext) => O | Promise<O>;
  /** Timeout for one attempt of `run`. */
  readonly timeoutMs?: number;
  /** Retries after the first attempt when `run` throws. */
  readonly retries?: number;
  /** Name used to re-attach `run` when loading from JSON. Defaults to the id. */
  readonly ref?: string;
}

export interface EmitNode<O = any> extends JevNode<unknown, O> {
  readonly kind: "emit";
  /** Returned as the output. Strings are templates: `"hi {{input.name}}"`. */
  readonly value: Json;
}

export interface ChainNode<I = any, O = any> extends JevNode<I, O> {
  readonly kind: "chain";
  readonly steps: readonly AnyNode[];
}

export type AnyJevNode = AskNode | RouteNode | GateNode | ParallelNode | CascadeNode | StepNode | EmitNode | ChainNode;

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

interface Meta {
  title?: string;
  description?: string;
}

/**
 * Ask Jev one or more questions about the input. Outputs the typed answers.
 *
 * ```ts
 * const read = ask("read-the-room", {
 *   questions: { mood: choice("Mood?", ["cursed", "blessed"]), drama: noul("Is there drama?") },
 * });
 * // JevNode<unknown, { mood: ChoiceAnswer<"cursed" | "blessed">; drama: NoulAnswer }>
 * ```
 */
export function ask<const Q extends Questions, I = unknown>(
  id: string,
  config: { questions: Q; state?: StateSpec<I>; model?: string } & Meta,
): AskNode<I, Q> {
  return { kind: "ask", id, ...config };
}

type RouteBranches<L extends string> = { readonly [K in L]: AnyNode };
type NoExtraKeys<B, L extends string> = B & { readonly [K in Exclude<keyof B, L>]: never };

/**
 * Ask a choice question, then run the branch for whichever label wins.
 * Every label must have a branch, and extra branches are errors, both checked at compile time.
 *
 * ```ts
 * route("triage", {
 *   ask: choice("What is this?", ["billing", "bug", "vibes"]),
 *   branches: { billing: toBilling, bug: toOnCall, vibes: sendGif },
 * })
 * ```
 */
export function route<
  L extends string,
  const B extends RouteBranches<L>,
  LC extends AnyNode = never,
  I = SharedInput<B[keyof B] | LC>,
>(
  id: string,
  config: {
    ask: ChoiceQuestion<L>;
    branches: NoExtraKeys<B, L>;
    alsoAsk?: Questions;
    lowConfidence?: { below: number; then: LC };
    state?: StateSpec<I>;
    model?: string;
  } & Meta,
): RouteNode<I, OutputOf<B[keyof B]> | OutputOf<LC>> {
  return { kind: "route", id, ...(config as Omit<typeof config, "branches">), branches: config.branches as Record<string, AnyNode> };
}

/** How a gate measures its question. */
export type PassFor<Q> = Q extends ChoiceQuestion<infer L> ? Threshold & { label: L } : Omit<Threshold, "label">;

/**
 * Continue only if Jev's answer clears a bar.
 * - noul: the probability of "yes"
 * - score: the probability-weighted score (0 = first level)
 * - choice: the probability of `pass.label`
 *
 * ```ts
 * gate("worth-it", {
 *   ask: noul("Is this worth texting back?"),
 *   pass: { min: 0.7 },
 *   then: draftReply,
 *   otherwise: emit("leave them on read"),
 *   unsure: { margin: 0.1, then: askABestie },
 * })
 * ```
 */
export function gate<
  const Q extends Question,
  T extends AnyNode,
  E extends AnyNode = never,
  U extends AnyNode = never,
  I = SharedInput<T | E | U>,
>(
  id: string,
  config: {
    ask: Q;
    pass: PassFor<Q>;
    then: T;
    otherwise?: E;
    unsure?: { margin?: number; minConfidence?: number; then: U };
    alsoAsk?: Questions;
    state?: StateSpec<I>;
    model?: string;
  } & Meta,
): GateNode<I, OutputOf<T> | OutputOf<E> | OutputOf<U>> {
  return { kind: "gate", id, ...config } as GateNode<I, OutputOf<T> | OutputOf<E> | OutputOf<U>>;
}

type Results<B> = { -readonly [K in keyof B]: OutputOf<B[K]> };

/**
 * Run branches concurrently, then join. Asks against the same state get
 * batched into one request automatically.
 */
export function parallel<const B extends Readonly<Record<string, AnyNode>>, R = Results<B>, I = SharedInput<B[keyof B]>>(
  id: string,
  config: { branches: B; join?: (results: Results<B>, input: I, ctx: StepContext) => R | Promise<R> } & Meta,
): ParallelNode<I, Awaited<R>> {
  return { kind: "parallel", id, ...config } as ParallelNode<I, Awaited<R>>;
}

/** One rung of a cascade. */
export function tier<const Q extends Question>(
  id: string,
  config: { ask: Q; minConfidence: number; state?: StateSpec<any>; model?: string; title?: string },
): Tier<Q> {
  return { id, ...config };
}

type TierAnswers<T extends readonly Tier[]> = { [K in keyof T]: T[K] extends Tier<infer Q> ? { tier: T[K]["id"]; answer: AnswerOf<Q> } : never }[number];

/** What a cascade resolves to: which rung answered, and its answer. */
export type CascadeResult<T extends readonly Tier[], F> =
  | { readonly resolvedBy: "tier"; readonly tier: string; readonly answer: TierAnswers<T>["answer"] }
  | { readonly resolvedBy: "fallback"; readonly output: F };

/**
 * Try cheap decisions first; escalate only when confidence is too low.
 * The fallback can be anything: an LLM call, a human queue, a coin.
 */
export function cascade<const T extends readonly Tier[], F extends AnyNode, I = SharedInput<F>>(
  id: string,
  config: { tiers: T; fallback: F } & Meta,
): CascadeNode<I, CascadeResult<T, OutputOf<F>>> {
  if (config.tiers.length === 0) throw new TypeError(`cascade("${id}"): needs at least one tier`);
  return { kind: "cascade", id, ...config };
}

/**
 * Your code as a node: transform the input, call a tool, hit an API, ask an LLM.
 *
 * ```ts
 * const lookup = step("lookup-user", async (msg: Message) => db.users.find(msg.userId))
 * ```
 */
export function step<I, O>(
  id: string,
  run: (input: I, ctx: StepContext) => O | Promise<O>,
  options: { timeoutMs?: number; retries?: number; ref?: string } & Meta = {},
): StepNode<I, Awaited<O>> {
  return { kind: "step", id, run: run as StepNode<I, Awaited<O>>["run"], ...options };
}

/**
 * Output a fixed value. Strings are templates over the node's input: `emit("ticket for {{input.user}}")`.
 * Great for leaves of a route.
 */
export function emit<const V extends Json>(value: V, options: { id?: string } & Meta = {}): EmitNode<V extends string ? string : V> {
  const { id, ...meta } = options;
  return { kind: "emit", id: id ?? "emit", value, ...meta } as EmitNode<V extends string ? string : V>;
}

/**
 * Run nodes in sequence, feeding each output into the next input.
 * A chain is a node, so chains nest.
 */
export function chain<A, B>(id: string, n1: JevNode<A, B>): ChainNode<A, B>;
export function chain<A, B, C>(id: string, n1: JevNode<A, B>, n2: JevNode<B, C>): ChainNode<A, C>;
export function chain<A, B, C, D>(id: string, n1: JevNode<A, B>, n2: JevNode<B, C>, n3: JevNode<C, D>): ChainNode<A, D>;
export function chain<A, B, C, D, E>(
  id: string,
  n1: JevNode<A, B>,
  n2: JevNode<B, C>,
  n3: JevNode<C, D>,
  n4: JevNode<D, E>,
): ChainNode<A, E>;
export function chain<A, B, C, D, E, F>(
  id: string,
  n1: JevNode<A, B>,
  n2: JevNode<B, C>,
  n3: JevNode<C, D>,
  n4: JevNode<D, E>,
  n5: JevNode<E, F>,
): ChainNode<A, F>;
export function chain<A, B, C, D, E, F, G>(
  id: string,
  n1: JevNode<A, B>,
  n2: JevNode<B, C>,
  n3: JevNode<C, D>,
  n4: JevNode<D, E>,
  n5: JevNode<E, F>,
  n6: JevNode<F, G>,
): ChainNode<A, G>;
export function chain<A, B, C, D, E, F, G, H>(
  id: string,
  n1: JevNode<A, B>,
  n2: JevNode<B, C>,
  n3: JevNode<C, D>,
  n4: JevNode<D, E>,
  n5: JevNode<E, F>,
  n6: JevNode<F, G>,
  n7: JevNode<G, H>,
): ChainNode<A, H>;
// Longer than seven? Nest chains; it reads better anyway.
export function chain(id: string, ...steps: AnyNode[]): ChainNode {
  if (steps.length === 0) throw new TypeError(`chain("${id}"): needs at least one node`);
  return { kind: "chain", id, steps };
}

/** Return a copy of any node with a title/description for UIs. */
export function describe<N extends AnyNode>(node: N, meta: Meta): N {
  return { ...node, ...meta };
}

// ---------------------------------------------------------------------------
// Tree utilities
// ---------------------------------------------------------------------------

/** A child of a node, with the edge label that leads to it. */
export interface Child {
  /** Edge key: a route label, "then"/"otherwise"/"unsure", a parallel branch, a step index, "fallback"... */
  readonly edge: string;
  readonly node: AnyNode;
}

export function childrenOf(node: AnyNode): Child[] {
  const n = node as AnyJevNode;
  switch (n.kind) {
    case "route": {
      const out: Child[] = Object.entries(n.branches).map(([edge, child]) => ({ edge, node: child }));
      if (n.lowConfidence) out.push({ edge: "lowConfidence", node: n.lowConfidence.then });
      return out;
    }
    case "gate": {
      const out: Child[] = [{ edge: "then", node: n.then }];
      if (n.otherwise) out.push({ edge: "otherwise", node: n.otherwise });
      if (n.unsure) out.push({ edge: "unsure", node: n.unsure.then });
      return out;
    }
    case "parallel":
      return Object.entries(n.branches).map(([edge, child]) => ({ edge, node: child }));
    case "cascade":
      return [{ edge: "fallback", node: n.fallback }];
    case "chain":
      return n.steps.map((child, i) => ({ edge: String(i), node: child }));
    default:
      return [];
  }
}

/**
 * Every node has a *path*: the edges from the root, e.g. `$/triage/bug/then`.
 * Ids are for humans and needn't be unique (reusing a node is fine); paths are
 * unique, so traces and graphs key on them.
 */
export const ROOT_PATH = "$";
export function childPath(parentPath: string, edge: string): string {
  return `${parentPath}/${edge}`;
}

/** Depth-first walk over every node in a chain. */
export function walk(
  root: AnyNode,
  visit: (node: AnyNode, info: { parent: AnyNode | null; edge: string | null; path: string; depth: number }) => void,
): void {
  const go = (node: AnyNode, parent: AnyNode | null, edge: string | null, path: string, depth: number) => {
    visit(node, { parent, edge, path, depth });
    for (const c of childrenOf(node)) go(c.node, node, c.edge, childPath(path, c.edge), depth + 1);
  };
  go(root, null, null, ROOT_PATH, 0);
}

/** Find a node by id. */
export function findNode(root: AnyNode, id: string): AnyNode | undefined {
  let found: AnyNode | undefined;
  walk(root, (n) => {
    if (!found && n.id === id) found = n;
  });
  return found;
}
