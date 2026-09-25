"use client";

/**
 * The builder's right-hand panel: every property of the selected node, as a
 * compact form. One component per kind, plus the bits they share (id/title,
 * state template, model). Edits go out as whole-node updaters so the caller
 * can route them through undo history.
 */
import { useId, type ReactNode } from "react";
import { DEFAULT_MODEL, type Entry, type Handler, type Json } from "jevchain";
import { KindTag } from "@/components/trace/kinds";
import { cn } from "@/lib/cn";
import { describeShape, inputFields, producerName, type FlowFix, type FlowWarning, type Input } from "@/lib/builder/data-flow";
import { childEdges, isPlaceholder, syncRouteBranches, template, type NodeJson } from "@/lib/builder/doc-ops";
import {
  followLabel,
  freshKey,
  labelsOf,
  levelsOf,
  moveItem,
  newQuestion,
  normalizePass,
  passScale,
  removeKey,
  renameKey,
  type QuestionJson,
  type ThresholdJson,
} from "@/lib/builder/question-ops";
import { AddRow, EntryField, Field, KeyInput, Label, NumberSlider, RowButton, Section, TextArea, TextInput, Toggle } from "./fields";
import { FixButton } from "./issues-panel";
import { QuestionEditor, QuestionsEditor, RESERVED_ALSO_ASK } from "./question-editor";

export type Update = (fn: (n: NodeJson) => NodeJson, key?: string) => void;

export interface PropertyEditorProps {
  node: NodeJson;
  path: string;
  /** For a cascade: the tier that was clicked. */
  tier?: string;
  /** Every id in the document, for the duplicate-id warning. */
  ids: Map<string, number>;
  handlers: Record<string, Handler>;
  update: Update;
  /** Give the node a new id; `{{results.<id>}}` reads elsewhere follow it (see `renameNode`). */
  rename: (id: string) => void;
  /** Fresh-id pool for new placeholder leaves. */
  taken: () => Set<string>;
  onSelect: (path: string, tier?: string) => void;
  /** Ask before removing a subtree (a child slot being switched off). */
  confirmRemove: (what: string, child: NodeJson | undefined, go: () => void) => void;
  actions: ReactNode;
  /** What this node receives, and the data-flow warnings about it (see `lib/builder/data-flow`). */
  flow?: NodeFlow;
}

export interface NodeFlow {
  input: Input;
  warnings: FlowWarning[];
  onFix: (warning: FlowWarning, fix: FlowFix) => void;
}

export function PropertyEditor(props: PropertyEditorProps) {
  const { node, path, update, actions } = props;
  const k = (field: string) => `${path}:${field}`;
  const idCount = props.ids.get(node.id) ?? 0;
  // what the node receives is shown with its inputs; an output nothing reads goes up top
  const unused = props.flow?.warnings.filter((w) => w.rule === "unused-output") ?? [];
  const kindProps = props.flow && unused.length ? { ...props, flow: { ...props.flow, warnings: props.flow.warnings.filter((w) => w.rule !== "unused-output") } } : props;

  return (
    <div className="fade-up min-w-0" key={path}>
      <header className="space-y-2 border-soft-b px-4 py-3">
        <div className="flex items-center gap-2">
          <KindTag kind={node.kind} tone="lit" />
          <span className="truncate font-mono text-[10.5px] text-ink-3" title={path}>
            {path}
          </span>
        </div>
        <h2 className="truncate text-base leading-snug font-medium text-ink">{node.title || node.id || "unnamed"}</h2>
        {actions}
      </header>

      {props.flow && unused.length > 0 && (
        <Section title="output">
          <FlowWarnings warnings={unused} onFix={props.flow.onFix} />
        </Section>
      )}

      <Section title="node">
        <Field
          label="id"
          error={!node.id ? "every node needs an id" : null}
          warn={idCount > 1 ? `${idCount} nodes share this id; traces key on paths so it runs, but results[id] will collide` : null}
        >
          {(id) => <KeyInput id={id} label="id" value={node.id} keys={[...props.ids.keys()]} onCommit={props.rename} />}
        </Field>
        <Field label="title" hint="shown on the graph. defaults to the id.">
          {(id) => (
            <TextInput
              id={id}
              value={node.title ?? ""}
              placeholder={node.id}
              onChange={(v) => update((n) => withOptional(n, "title", v || undefined), k("title"))}
            />
          )}
        </Field>
        <Field label="description">
          {(id) => (
            <TextArea
              id={id}
              value={(node.description as string | undefined) ?? ""}
              placeholder="what is this for?"
              onChange={(v) => update((n) => withOptional(n, "description", v || undefined), k("description"))}
            />
          )}
        </Field>
      </Section>

      <KindEditor {...kindProps} />
    </div>
  );
}

function KindEditor(props: PropertyEditorProps) {
  switch (props.node.kind) {
    case "ask":
      return <AskEditor {...props} />;
    case "route":
      return <RouteEditor {...props} />;
    case "gate":
      return <GateEditor {...props} />;
    case "parallel":
      return <ParallelEditor {...props} />;
    case "cascade":
      return <CascadeEditor {...props} />;
    case "step":
      return <StepEditor {...props} />;
    case "emit":
      return <EmitEditor {...props} />;
    case "chain":
      return <ChainEditor {...props} />;
  }
}

// ---------------------------------------------------------------------------
// shared bits
// ---------------------------------------------------------------------------

function withOptional(n: NodeJson, key: string, value: unknown): NodeJson {
  const next = { ...n } as Record<string, unknown>;
  if (value === undefined) delete next[key];
  else next[key] = value;
  return next as NodeJson;
}

function refName(v: unknown): string | undefined {
  return v && typeof v === "object" && typeof (v as { $ref?: unknown }).$ref === "string" ? (v as { $ref: string }).$ref : undefined;
}

function Bound({ name, handlers }: { name: string; handlers: Record<string, Handler> }) {
  const bound = typeof handlers[name] === "function";
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center gap-1 px-1.5 font-mono text-[10.5px] leading-none lowercase",
        bound ? "border-(length:--bw) border-pass bg-pass-wash text-pass" : "border-(length:--bw) border-dashed border-warn text-warn",
      )}
    >
      <span aria-hidden>{bound ? "●" : "○"}</span>
      {bound ? "bound" : "not bound"}
    </span>
  );
}

/** Where Jev's `state` comes from: a template, the whole input, or (from code) a bound function. */
function StateField({ value, onChange, handlers, label = "state" }: { value: unknown; onChange: (v: string | undefined, key?: string) => void; handlers: Record<string, Handler>; label?: string }) {
  const ref = refName(value);
  if (ref) {
    return (
      <Field label={label} hint={typeof handlers[ref] === "function" ? "computed by the forked example's code." : "no function bound, so the chain won't load. swap it for a template."}>
        {() => (
          <div className="flex items-center gap-2 border-soft bg-surface-2 px-2 py-1.5">
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink">
              code · <span className="text-ink-2">{ref}</span>
            </span>
            <Bound name={ref} handlers={handlers} />
            <button type="button" onClick={() => onChange(undefined)} className="font-mono text-[10.5px] lowercase text-ink-3 underline decoration-dotted underline-offset-2 hover:text-ink">
              use a template
            </button>
          </div>
        )}
      </Field>
    );
  }
  return (
    <Field
      label={label}
      hint={
        <>
          a template over the input, e.g. <span className="text-ink-2">{"{{input.message}}"}</span>. empty = send the whole input.
        </>
      }
    >
      {(id) => <TextInput id={id} value={typeof value === "string" ? value : ""} placeholder="whole input" onChange={(v) => onChange(v || undefined, "state")} />}
    </Field>
  );
}

function JevCallSection({ node, update, handlers, path, flow, onSelect }: { node: NodeJson; update: Update; handlers: Record<string, Handler>; path: string; flow?: NodeFlow; onSelect: (p: string) => void }) {
  return (
    <Section title="jev call">
      <Receives flow={flow} onSelect={onSelect} />
      <StateField value={node.state} handlers={handlers} onChange={(v, key) => update((n) => withOptional(n, "state", v), key ? `${path}:${key}` : undefined)} />
      <Field label="model" hint="pin a model for just this node. empty = the client's default.">
        {(id) => (
          <TextInput id={id} value={(node.model as string | undefined) ?? ""} placeholder={DEFAULT_MODEL} onChange={(v) => update((n) => withOptional(n, "model", v.trim() || undefined), `${path}:model`)} />
        )}
      </Field>
    </Section>
  );
}

/**
 * What arrives as `input` here: the run input, or the output of the chain
 * step before (which is what `state` and `{{input.…}}` read by default).
 */
function Receives({ flow, onSelect }: { flow: NodeFlow | undefined; onSelect: (p: string) => void }) {
  if (!flow) return null;
  const { input } = flow;
  const fields = input.from === "node" ? inputFields(input.shape, 3) : [];
  return (
    <div className="space-y-1" aria-label="input">
      <Label>input</Label>
      {input.from === "run" ? (
        <p className="font-mono text-[11px] leading-relaxed text-ink-2">
          the run input, as the chain was called. <span className="text-ink-3">here {"{{input}}"} and {"{{run}}"} are the same thing.</span>
        </p>
      ) : (
        <>
          <p className="font-mono text-[11px] leading-relaxed text-ink-2">
            the output of{" "}
            <button
              type="button"
              onClick={() => onSelect(input.node.path)}
              className="inline-flex max-w-full items-center gap-1 align-bottom text-ink underline decoration-dotted underline-offset-2 hover:decoration-solid"
            >
              <KindTag kind={input.node.kind} />
              <span className="truncate">{producerName(input.node)}</span>
            </button>
            , the step before: <span className="text-ink">{describeShape(input.shape)}</span>
          </p>
          <p className="font-mono text-[10.5px] leading-relaxed text-ink-3">
            {fields.length > 0 && <>read it with {fields.map((f, i) => <span key={f} className="text-ink-2">{`${i ? ", " : ""}{{${f}}}`}</span>)}. </>}
            the run input is still <span className="text-ink-2">{"{{run}}"}</span>.
          </p>
        </>
      )}
      <FlowWarnings warnings={flow.warnings} onFix={flow.onFix} />
    </div>
  );
}

function FlowWarnings({ warnings, onFix }: { warnings: FlowWarning[]; onFix: NodeFlow["onFix"] }) {
  if (!warnings.length) return null;
  return (
    <ul className="space-y-1.5">
      {warnings.map((w) => (
        <li key={w.rule} role="alert" className="space-y-1.5 border-(length:--bw) border-warn bg-warn-wash px-2 py-1.5">
          <p className="font-mono text-[10.5px] leading-relaxed text-ink">
            <span aria-hidden className="text-warn">! </span>
            {w.message}
          </p>
          <div className="flex flex-wrap gap-1">
            {w.fixes.map((f) => (
              <FixButton key={f.label} fix={f} onClick={() => onFix(w, f)} />
            ))}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** A child slot: shows what's there and jumps to it. */
function ChildLink({ label, child, childPath, onSelect }: { label: string; child: NodeJson | undefined; childPath: string; onSelect: (p: string) => void }) {
  if (!child) return null;
  const empty = isPlaceholder(child);
  return (
    <button
      type="button"
      onClick={() => onSelect(firstVertexPath(child, childPath))}
      className={cn(
        "group/cl flex w-full items-center gap-2 px-2 py-1.5 text-left transition-colors duration-(--dur-fast)",
        empty ? "border-(length:--bw) border-dashed border-accent bg-accent-wash hover:bg-accent/20" : "border-soft hover:border-(--line) hover:bg-surface-2",
      )}
    >
      <span className="w-16 shrink-0 truncate font-mono text-[10px] text-ink-3">{label}</span>
      {empty ? (
        <span className="font-mono text-[11px] text-accent-strong">+ something goes here</span>
      ) : (
        <>
          <KindTag kind={child.kind} />
          <span className="min-w-0 truncate text-[12px] text-ink">{child.title || child.id}</span>
        </>
      )}
      <span aria-hidden className="ml-auto font-mono text-[11px] text-ink-3 group-hover/cl:text-ink">
        →
      </span>
    </button>
  );
}

/** Chains have no vertex of their own; their first step stands in. */
function firstVertexPath(node: NodeJson, path: string): string {
  if (node.kind !== "chain") return path;
  const first = childEdges(node)[0];
  return first ? firstVertexPath(first.node, `${path}/${first.edge}`) : path;
}

// ---------------------------------------------------------------------------
// kinds
// ---------------------------------------------------------------------------

function AskEditor({ node, update, handlers, path, flow, onSelect }: PropertyEditorProps) {
  const questions = (node.questions ?? {}) as Record<string, QuestionJson>;
  return (
    <>
      <Section title={`questions · ${Object.keys(questions).length}`}>
        <p className="-mt-1 font-mono text-[10.5px] leading-relaxed text-ink-3">asked together in one call. answers come back under these keys.</p>
        <QuestionsEditor
          questions={questions}
          keyPrefix={`${path}:q`}
          minCount={1}
          onChange={(next, key) => update((n) => ({ ...n, questions: next }), key)}
        />
      </Section>
      <JevCallSection node={node} update={update} handlers={handlers} path={path} flow={flow} onSelect={onSelect} />
    </>
  );
}

function RouteEditor({ node, update, handlers, path, taken, onSelect, confirmRemove, flow }: PropertyEditorProps) {
  const ask = node.ask as QuestionJson;
  const branches = (node.branches ?? {}) as Record<string, NodeJson>;
  const lc = node.lowConfidence as { below: number; then: NodeJson } | undefined;
  const alsoAsk = node.alsoAsk as Record<string, QuestionJson> | undefined;
  return (
    <>
      <Section title="deciding question">
        <QuestionEditor
          question={ask}
          types={["choice"]}
          keyPrefix={`${path}:ask`}
          instructionsPlaceholder="which way should this go?"
          onChange={(q, meta) =>
            update((n) => {
              const prev = labelsOf(n.ask as QuestionJson);
              const next = labelsOf(q);
              const synced = prev.join("\u0000") === next.join("\u0000") ? n : syncRouteBranches(n, prev, next, taken());
              return { ...synced, ask: q };
            }, meta?.key)
          }
        />
      </Section>
      <Section title={`branches · ${Object.keys(branches).length}`}>
        <p className="-mt-1 font-mono text-[10.5px] leading-relaxed text-ink-3">one per label, kept in sync as you edit the labels.</p>
        <div className="space-y-1">
          {Object.entries(branches).map(([label, child]) => (
            <ChildLink key={label} label={label} child={child} childPath={`${path}/${label}`} onSelect={onSelect} />
          ))}
        </div>
      </Section>
      <Section title="low confidence">
        <Toggle
          checked={Boolean(lc)}
          onChange={(on) => {
            if (on) update((n) => ({ ...n, lowConfidence: { below: 0.5, then: template("emit", taken()) } }));
            else confirmRemove("the low-confidence path", lc?.then, () => update((n) => withOptional(n, "lowConfidence", undefined)));
          }}
          hint="when jev isn't sure enough, take a different path instead of the winning label."
        >
          escape hatch for shrugs
        </Toggle>
        {lc && (
          <>
            <Field label="when confidence is below">
              {() => (
                <NumberSlider
                  label="low confidence threshold"
                  value={lc.below}
                  onChange={(v) => update((n) => ({ ...n, lowConfidence: { ...(n.lowConfidence as object), below: v } }), `${path}:below`)}
                />
              )}
            </Field>
            <ChildLink label="then" child={lc.then} childPath={`${path}/lowConfidence`} onSelect={onSelect} />
          </>
        )}
      </Section>
      <AlsoAskSection alsoAsk={alsoAsk} path={path} update={update} />
      <JevCallSection node={node} update={update} handlers={handlers} path={path} flow={flow} onSelect={onSelect} />
    </>
  );
}

function AlsoAskSection({ alsoAsk, path, update }: { alsoAsk: Record<string, QuestionJson> | undefined; path: string; update: Update }) {
  return (
    <Section title={`also ask${alsoAsk ? ` · ${Object.keys(alsoAsk).length}` : ""}`}>
      <QuestionsEditor
        questions={alsoAsk ?? {}}
        keyPrefix={`${path}:also`}
        reserved={RESERVED_ALSO_ASK}
        emptyText="ride-along questions, asked in the same call and recorded in the trace. free speculation."
        onChange={(next, key) => update((n) => withOptional(n, "alsoAsk", Object.keys(next).length ? next : undefined), key)}
      />
    </Section>
  );
}

function GateEditor({ node, update, handlers, path, taken, onSelect, confirmRemove, flow }: PropertyEditorProps) {
  const ask = node.ask as QuestionJson;
  const pass = (node.pass ?? {}) as ThresholdJson;
  const unsure = node.unsure as { margin?: number; minConfidence?: number; then: NodeJson } | undefined;
  const otherwise = node.otherwise as NodeJson | undefined;
  const scale = passScale(ask);
  const measure = ask.type === "noul" ? "p(yes)" : ask.type === "score" ? "score" : `p(${pass.label ?? "label"})`;
  const setPass = (next: ThresholdJson, key?: string) => update((n) => ({ ...n, pass: normalizePass(n.ask as QuestionJson, next) }), key);
  const fmt = (v: number) => (ask.type === "score" ? v.toFixed(1) : v.toFixed(2));

  return (
    <>
      <Section title="question">
        <QuestionEditor
          question={ask}
          keyPrefix={`${path}:ask`}
          instructionsPlaceholder="should this get through?"
          onChange={(q, meta) =>
            update((n) => {
              const p = meta?.renamed ? followLabel(n.pass as ThresholdJson, meta.renamed.from, meta.renamed.to) : (n.pass as ThresholdJson);
              const typeChanged = (n.ask as QuestionJson).type !== q.type;
              return { ...n, ask: q, pass: normalizePass(q, typeChanged ? {} : p) };
            }, meta?.key)
          }
        />
      </Section>
      <Section title="pass when">
        {ask.type === "choice" && (
          <Field label="measure the probability of">
            {(id) => (
              <select
                id={id}
                value={pass.label ?? ""}
                onChange={(e) => setPass({ ...pass, label: e.target.value })}
                className="block h-7 w-full border-hard bg-surface px-1.5 font-mono text-[12px] text-ink outline-none focus-visible:outline-2 focus-visible:outline-accent"
              >
                {labelsOf(ask).map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            )}
          </Field>
        )}
        {(["min", "max"] as const).map((bound) => {
          const v = pass[bound];
          const other = bound === "min" ? pass.max : pass.min;
          return (
            <div key={bound} className="space-y-1.5">
              <Toggle
                checked={v !== undefined}
                disabled={v !== undefined && other === undefined}
                onChange={(on) => setPass({ ...pass, [bound]: on ? (bound === "min" ? scale.max * 0.7 : scale.max * 0.3) : undefined })}
              >
                {measure} {bound === "min" ? "≥" : "≤"} {v !== undefined ? fmt(v) : "…"}
              </Toggle>
              {v !== undefined && (
                <NumberSlider label={`${bound} threshold`} value={v} min={scale.min} max={scale.max} step={scale.step} format={fmt} onChange={(x) => setPass({ ...pass, [bound]: x }, `${path}:pass.${bound}`)} />
              )}
            </div>
          );
        })}
        {ask.type === "score" && (
          <p className="font-mono text-[10.5px] leading-relaxed text-ink-3">
            score is probability-weighted: 0 = “{String(levelsOf(ask)[0] ?? "first level")}”, {scale.max} = “{String(levelsOf(ask)[scale.max] ?? "last level")}”.
          </p>
        )}
      </Section>
      <Section title="paths">
        <ChildLink label="then" child={node.then as NodeJson} childPath={`${path}/then`} onSelect={onSelect} />
        <Toggle
          checked={Boolean(otherwise)}
          onChange={(on) => {
            if (on) update((n) => ({ ...n, otherwise: template("emit", taken()) }));
            else confirmRemove("the otherwise path", otherwise, () => update((n) => withOptional(n, "otherwise", undefined)));
          }}
          hint={otherwise ? "taken when the bar isn't cleared." : "off: a failed gate halts the run (shown as ■ halt)."}
        >
          otherwise
        </Toggle>
        {otherwise && <ChildLink label="otherwise" child={otherwise} childPath={`${path}/otherwise`} onSelect={onSelect} />}
        <Toggle
          checked={Boolean(unsure)}
          onChange={(on) => {
            if (on) update((n) => ({ ...n, unsure: { margin: 0.1, then: template("emit", taken()) } }));
            else confirmRemove("the unsure path", unsure?.then, () => update((n) => withOptional(n, "unsure", undefined)));
          }}
          hint="a third path for “too close to call”."
        >
          unsure
        </Toggle>
        {unsure && (
          <div className="space-y-2.5 border-l-2 border-line-soft pl-3">
            <UnsureBound
              label="within this margin of the bar"
              value={unsure.margin}
              other={unsure.minConfidence}
              max={ask.type === "score" ? scale.max : 0.5}
              fallback={0.1}
              onChange={(v, key) => update((n) => ({ ...n, unsure: withOptional(n.unsure as NodeJson, "margin", v) }), key && `${path}:${key}`)}
              k="margin"
            />
            <UnsureBound
              label="when confidence is below"
              value={unsure.minConfidence}
              other={unsure.margin}
              max={1}
              fallback={0.4}
              onChange={(v, key) => update((n) => ({ ...n, unsure: withOptional(n.unsure as NodeJson, "minConfidence", v) }), key && `${path}:${key}`)}
              k="minConfidence"
            />
            <ChildLink label="unsure" child={unsure.then} childPath={`${path}/unsure`} onSelect={onSelect} />
          </div>
        )}
      </Section>
      <AlsoAskSection alsoAsk={node.alsoAsk as Record<string, QuestionJson> | undefined} path={path} update={update} />
      <JevCallSection node={node} update={update} handlers={handlers} path={path} flow={flow} onSelect={onSelect} />
    </>
  );
}

function UnsureBound({
  label,
  value,
  other,
  max,
  fallback,
  onChange,
  k,
}: {
  label: string;
  value: number | undefined;
  other: number | undefined;
  max: number;
  fallback: number;
  onChange: (v: number | undefined, key?: string) => void;
  k: string;
}) {
  return (
    <div className="space-y-1.5">
      <Toggle checked={value !== undefined} disabled={value !== undefined && other === undefined} onChange={(on) => onChange(on ? fallback : undefined)}>
        {label}
      </Toggle>
      {value !== undefined && <NumberSlider label={label} value={value} max={max} onChange={(v) => onChange(v, k)} />}
    </div>
  );
}

function ParallelEditor({ node, update, path, taken, onSelect, handlers, confirmRemove }: PropertyEditorProps) {
  const branches = (node.branches ?? {}) as Record<string, NodeJson>;
  const keys = Object.keys(branches);
  const join = refName(node.join);
  return (
    <>
      <Section title={`branches · ${keys.length}`}>
        <p className="-mt-1 font-mono text-[10.5px] leading-relaxed text-ink-3">run at the same time. asks on the same state share one request.</p>
        <ul className="space-y-1.5">
          {keys.map((key, i) => (
            <li key={i} className="flex items-center gap-1">
              <KeyInput label={`branch ${key}`} value={key} keys={keys} className="w-28 shrink-0" onCommit={(to) => update((n) => ({ ...n, branches: renameKey(n.branches as Record<string, NodeJson>, key, to) }), `${path}:branch.${i}`)} />
              <div className="min-w-0 flex-1">
                <ChildLink label="" child={branches[key]} childPath={`${path}/${key}`} onSelect={onSelect} />
              </div>
              <RowButton
                label={`remove branch ${key}`}
                tone="danger"
                disabled={keys.length <= 1}
                onClick={() => confirmRemove(`branch “${key}”`, branches[key], () => update((n) => ({ ...n, branches: removeKey(n.branches as Record<string, NodeJson>, key) })))}
              >
                ×
              </RowButton>
            </li>
          ))}
        </ul>
        <AddRow onClick={() => update((n) => ({ ...n, branches: { ...(n.branches as object), [freshKey("branch", keys)]: template("ask", taken()) } }))}>add a branch</AddRow>
      </Section>
      <Section title="join">
        {join ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2 border-soft bg-surface-2 px-2 py-1.5">
              <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink">
                join · <span className="text-ink-2">{join}</span>
              </span>
              <Bound name={join} handlers={handlers} />
            </div>
            <button
              type="button"
              onClick={() => update((n) => withOptional(n, "join", undefined))}
              className="font-mono text-[10.5px] lowercase text-ink-3 underline decoration-dotted underline-offset-2 hover:text-ink"
            >
              drop the code, just collect
            </button>
          </div>
        ) : (
          <p className="font-mono text-[11px] leading-relaxed text-ink-2">
            collect · outputs come back as <span className="text-ink">{`{ ${keys.slice(0, 3).join(", ")}${keys.length > 3 ? ", …" : ""} }`}</span>. custom joins are code; write them in typescript.
          </p>
        )}
      </Section>
    </>
  );
}

function CascadeEditor({ node, update, path, tier: focusTier, onSelect, handlers, flow }: PropertyEditorProps) {
  type TierJson = { id: string; title?: string; ask: QuestionJson; minConfidence: number; state?: unknown; model?: string };
  const tiers = (node.tiers ?? []) as TierJson[];
  const ids = tiers.map((t) => t.id);
  const setTiers = (fn: (ts: TierJson[]) => TierJson[], key?: string) => update((n) => ({ ...n, tiers: fn(n.tiers as TierJson[]) }), key);
  const setTier = (i: number, fn: (t: TierJson) => TierJson, key?: string) => setTiers((ts) => ts.map((t, j) => (j === i ? fn(t) : t)), key);

  return (
    <>
      <Section title={`tiers · ${tiers.length}`}>
        <p className="-mt-1 font-mono text-[10.5px] leading-relaxed text-ink-3">cheapest first. each tier answers if it&apos;s confident enough, otherwise escalates.</p>
        <Receives flow={flow && { ...flow, warnings: flow.warnings.filter((w) => !w.tier) }} onSelect={onSelect} />
        <ol className="space-y-2.5">
          {tiers.map((t, i) => (
            <li key={i} className={cn("border-soft bg-surface", focusTier === t.id && "border-hard shadow-[3px_3px_0_0_var(--accent)]")}>
              <div className="flex items-center gap-1 border-soft-b bg-surface-2 px-2 py-1.5">
                <span className="grid h-6 w-5 shrink-0 place-items-center font-mono text-[10px] text-ink-3">{i + 1}</span>
                <KeyInput
                  label={`tier ${t.id} id`}
                  value={t.id}
                  keys={[...ids, "fallback"]}
                  className="flex-1"
                  onCommit={(to) => {
                    setTier(i, (x) => ({ ...x, id: to }), `${path}:tier.${i}.id`);
                    if (focusTier === t.id) onSelect(path, to);
                  }}
                />
                <RowButton label={`move tier ${t.id} up`} disabled={i === 0} onClick={() => setTiers((ts) => moveItem(ts, i, i - 1))}>
                  ↑
                </RowButton>
                <RowButton label={`move tier ${t.id} down`} disabled={i === tiers.length - 1} onClick={() => setTiers((ts) => moveItem(ts, i, i + 1))}>
                  ↓
                </RowButton>
                <RowButton label={`remove tier ${t.id}`} tone="danger" disabled={tiers.length <= 1} onClick={() => setTiers((ts) => ts.filter((_, j) => j !== i))}>
                  ×
                </RowButton>
              </div>
              <div className="space-y-3 px-2.5 py-2.5">
                <Field label="title">
                  {(id) => <TextInput id={id} value={t.title ?? ""} placeholder={t.id} onChange={(v) => setTier(i, (x) => withOptional(x as unknown as NodeJson, "title", v || undefined) as unknown as TierJson, `${path}:tier.${i}.title`)} />}
                </Field>
                <Field label="accept when confidence ≥">
                  {() => <NumberSlider label={`tier ${t.id} min confidence`} value={t.minConfidence} onChange={(v) => setTier(i, (x) => ({ ...x, minConfidence: v }), `${path}:tier.${i}.conf`)} />}
                </Field>
                <QuestionEditor question={t.ask} keyPrefix={`${path}:tier.${i}`} onChange={(q, meta) => setTier(i, (x) => ({ ...x, ask: q }), meta?.key)} />
                <StateField
                  value={t.state}
                  handlers={handlers}
                  onChange={(v, key) => setTier(i, (x) => withOptional(x as unknown as NodeJson, "state", v) as unknown as TierJson, key && `${path}:tier.${i}.state`)}
                />
                {flow && <FlowWarnings warnings={flow.warnings.filter((w) => w.tier === t.id)} onFix={flow.onFix} />}
                <Field label="model">
                  {(id) => (
                    <TextInput
                      id={id}
                      value={t.model ?? ""}
                      placeholder={DEFAULT_MODEL}
                      onChange={(v) => setTier(i, (x) => withOptional(x as unknown as NodeJson, "model", v.trim() || undefined) as unknown as TierJson, `${path}:tier.${i}.model`)}
                    />
                  )}
                </Field>
              </div>
            </li>
          ))}
        </ol>
        <AddRow
          onClick={() =>
            setTiers((ts) => [...ts, { id: freshKey("tier", [...ts.map((x) => x.id), "fallback"]), ask: newQuestion("noul", "Considering everything, is this fine?"), minConfidence: 0.5 }])
          }
        >
          add a tier
        </AddRow>
      </Section>
      <Section title="fallback">
        <p className="-mt-1 font-mono text-[10.5px] leading-relaxed text-ink-3">when no tier is sure: an llm, a human, a coin. it&apos;s a node, so it can be anything.</p>
        <ChildLink label="fallback" child={node.fallback as NodeJson} childPath={`${path}/fallback`} onSelect={onSelect} />
      </Section>
    </>
  );
}

function StepEditor({ node, update, path, handlers }: PropertyEditorProps) {
  const ref = refName(node.run) ?? node.id;
  const listId = useId();
  const names = Object.keys(handlers).filter((n) => !n.includes("."));
  const bound = typeof handlers[ref] === "function";
  return (
    <Section title="code">
      <Field
        label="handler ($ref)"
        error={!ref.trim() ? "needs a name" : null}
        hint={
          bound
            ? "bound to the forked example's function. it runs for real."
            : names.length
              ? "no function by this name. pick one of the example's, or it passes its input through."
              : "JSON holds no code: this step passes its input through here. export to typescript to write it."
        }
        aside={<Bound name={ref} handlers={handlers} />}
      >
        {(id) => (
          <>
            <TextInput id={id} list={names.length ? listId : undefined} value={ref} onChange={(v) => update((n) => ({ ...n, run: { $ref: v } }), `${path}:ref`)} />
            {names.length > 0 && (
              <datalist id={listId}>
                {names.map((n) => (
                  <option key={n} value={n} />
                ))}
              </datalist>
            )}
          </>
        )}
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="timeout ms">
          {(id) => (
            <TextInput
              id={id}
              inputMode="numeric"
              value={node.timeoutMs !== undefined ? String(node.timeoutMs) : ""}
              placeholder="none"
              onChange={(v) => update((n) => withOptional(n, "timeoutMs", toInt(v)), `${path}:timeout`)}
            />
          )}
        </Field>
        <Field label="retries">
          {(id) => (
            <TextInput
              id={id}
              inputMode="numeric"
              value={node.retries !== undefined ? String(node.retries) : ""}
              placeholder="0"
              onChange={(v) => update((n) => withOptional(n, "retries", toInt(v)), `${path}:retries`)}
            />
          )}
        </Field>
      </div>
    </Section>
  );
}

function toInt(v: string): number | undefined {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function EmitEditor({ node, update, path, flow, onSelect }: PropertyEditorProps) {
  return (
    <Section title="output">
      <Receives flow={flow} onSelect={onSelect} />
      <EntryField
        label="value"
        value={node.value as Entry}
        anyJson
        emptyAs=""
        rows={3}
        placeholder="the chain returns this"
        onChange={(v) => update((n) => ({ ...n, value: (v ?? "") as Json }), `${path}:value`)}
        hint={
          <>
            strings are templates: <span className="text-ink-2">{"{{input.name}}"}</span> fills from this node&apos;s input, <span className="text-ink-2">{"{{input}}"}</span> is all of it.
          </>
        }
      />
    </Section>
  );
}

function ChainEditor({ node, onSelect, path }: PropertyEditorProps) {
  return (
    <Section title="steps">
      <div className="space-y-1">
        {childEdges(node).map((c) => (
          <ChildLink key={c.edge} label={`step ${Number(c.edge) + 1}`} child={c.node} childPath={`${path}/${c.edge}`} onSelect={onSelect} />
        ))}
      </div>
    </Section>
  );
}

/** Shown when nothing is selected: the document itself. */
export function DocumentEditor({
  name,
  description,
  examples,
  onName,
  onDescription,
  onRemoveExample,
  children,
}: {
  name: string;
  description: string;
  examples: Json[];
  onName: (v: string) => void;
  onDescription: (v: string) => void;
  onRemoveExample: (i: number) => void;
  children?: ReactNode;
}) {
  return (
    <div className="fade-up min-w-0">
      <header className="space-y-1 border-soft-b px-4 py-3">
        <Label>document</Label>
        <h2 className="truncate text-base leading-snug font-medium text-ink">{name || "untitled chain"}</h2>
        <p className="font-mono text-[10.5px] leading-relaxed text-ink-3">click a node on the canvas to edit it. right-click for more.</p>
      </header>
      <Section title="chain">
        <Field label="name">{(id) => <TextInput id={id} value={name} placeholder="untitled chain" onChange={onName} />}</Field>
        <Field label="description">{(id) => <TextArea id={id} value={description} placeholder="what does it decide?" onChange={onDescription} />}</Field>
      </Section>
      <Section title={`sample inputs · ${examples.length}`}>
        {examples.length === 0 ? (
          <p className="font-mono text-[10.5px] leading-relaxed text-ink-3">none yet. type an input on the left and save it as a sample; they travel with the json.</p>
        ) : (
          <ul className="space-y-1">
            {examples.map((ex, i) => (
              <li key={i} className="flex items-center gap-1 border-soft px-2 py-1">
                <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink-2">{typeof ex === "string" ? ex : JSON.stringify(ex)}</span>
                <RowButton label={`remove sample ${i + 1}`} tone="danger" onClick={() => onRemoveExample(i)}>
                  ×
                </RowButton>
              </li>
            ))}
          </ul>
        )}
      </Section>
      {children}
    </div>
  );
}

