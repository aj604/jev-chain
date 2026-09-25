"use client";

/**
 * Editing one question (choice / score / noul), and a keyed map of them
 * (`ask.questions`, `alsoAsk`). Pure view: every change goes out through
 * `onChange(next, meta)`; the caller decides what else must follow (a route
 * re-syncs its branches, a gate re-points its threshold).
 */
import type { Entry } from "jevchain";
import { DECISION_KEY } from "jevchain";
import {
  addLabel,
  addLevel,
  convertQuestion,
  freshKey,
  labelsOf,
  levelsOf,
  MAX_LEVELS,
  MIN_LABELS,
  MIN_LEVELS,
  moveLevel,
  newQuestion,
  removeKey,
  removeLabel,
  removeLevel,
  renameKey,
  renameLabel,
  setChoiceDescription,
  setLevel,
  setNoulSide,
  type QuestionJson,
  type QuestionType,
} from "@/lib/builder/question-ops";
import { AddRow, EntryField, KeyInput, Label, RowButton, Segmented, TextInput } from "./fields";

export interface QuestionChange {
  /** A choice label was renamed in place. */
  renamed?: { from: string; to: string };
  /** Coalescing key for undo. */
  key?: string;
}

const TYPE_HINT: Record<QuestionType, string> = {
  choice: "pick one label. you get a probability for each.",
  score: "rate on an ordered rubric, lowest first. 2–10 levels.",
  noul: "yes or no. you get p(yes).",
};

export function QuestionEditor({
  question,
  onChange,
  types = ["choice", "score", "noul"],
  keyPrefix,
  instructionsPlaceholder = "what should jev decide?",
}: {
  question: QuestionJson;
  onChange: (next: QuestionJson, meta?: QuestionChange) => void;
  /** Which types are allowed (a route only takes choices). */
  types?: QuestionType[];
  /** Undo-coalescing prefix, unique per question. */
  keyPrefix: string;
  instructionsPlaceholder?: string;
}) {
  const labels = labelsOf(question);
  const levels = levelsOf(question);
  const criteria = (question.criteria ?? {}) as Record<string, Entry>;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Label>type</Label>
        {types.length > 1 ? (
          <Segmented
            label="question type"
            className="ml-auto"
            options={types.map((t) => ({ value: t, label: t }))}
            value={question.type}
            onChange={(t) => onChange(convertQuestion(question, t))}
          />
        ) : (
          <span className="ml-auto font-mono text-[11px] text-ink-2">{question.type}</span>
        )}
      </div>
      <p className="-mt-1.5 font-mono text-[10.5px] leading-relaxed text-ink-3">{TYPE_HINT[question.type]}</p>

      <EntryField
        label="instructions"
        value={question.instructions ?? null}
        onChange={(v) => onChange({ ...question, instructions: v ?? null }, { key: `${keyPrefix}.instructions` })}
        placeholder={instructionsPlaceholder}
        rows={2}
      />

      {question.type === "choice" && (
        <div className="space-y-1.5">
          <div className="flex items-center">
            <Label>labels</Label>
            <span className="ml-auto font-mono text-[10px] text-ink-3">label · optional description</span>
          </div>
          <ul className="space-y-1.5">
            {labels.map((label, i) => (
              // Keyed by position so renaming a label doesn't remount (and blur) its input.
              <li key={i} className="grid grid-cols-[minmax(0,5fr)_minmax(0,7fr)_auto] items-center gap-1">
                <KeyInput
                  label={`label ${label}`}
                  value={label}
                  keys={labels}
                  onCommit={(to) => onChange(renameLabel(question, label, to), { renamed: { from: label, to }, key: `${keyPrefix}.label.${i}` })}
                />
                {criteria[label] === null || criteria[label] === undefined || typeof criteria[label] === "string" ? (
                  <TextInput
                    aria-label={`description for ${label}`}
                    value={(criteria[label] as string | null) ?? ""}
                    placeholder="—"
                    onChange={(v) => onChange(setChoiceDescription(question, label, v === "" ? null : v), { key: `${keyPrefix}.desc.${label}` })}
                    className="text-ink-2"
                  />
                ) : (
                  <span className="truncate border-soft px-1.5 font-mono text-[10.5px] leading-6 text-ink-3" title={JSON.stringify(criteria[label])}>
                    {"{…}"} json
                  </span>
                )}
                <RowButton label={`remove ${label}`} tone="danger" disabled={labels.length <= MIN_LABELS} onClick={() => onChange(removeLabel(question, label))}>
                  ×
                </RowButton>
              </li>
            ))}
          </ul>
          <AddRow onClick={() => onChange(addLabel(question))} disabled={labels.length >= 255}>
            add a label
          </AddRow>
        </div>
      )}

      {question.type === "score" && (
        <div className="space-y-1.5">
          <div className="flex items-center">
            <Label>levels · lowest first</Label>
            <span className="ml-auto font-mono text-[10px] tabular-nums text-ink-3">
              {levels.length}/{MAX_LEVELS}
            </span>
          </div>
          <ol className="space-y-1.5">
            {levels.map((lvl, i) => (
              <li key={i} className="flex items-center gap-1">
                <span className="grid h-7 w-6 shrink-0 place-items-center border-soft bg-surface-2 font-mono text-[10px] tabular-nums text-ink-3">{i}</span>
                {lvl === null || typeof lvl === "string" ? (
                  <TextInput
                    aria-label={`level ${i}`}
                    value={lvl ?? ""}
                    onChange={(v) => onChange(setLevel(question, i, v === "" ? null : v), { key: `${keyPrefix}.level.${i}` })}
                  />
                ) : (
                  <span className="h-7 flex-1 truncate border-soft px-1.5 font-mono text-[10.5px] leading-7 text-ink-3">{JSON.stringify(lvl)}</span>
                )}
                <RowButton label={`move level ${i} up`} disabled={i === 0} onClick={() => onChange(moveLevel(question, i, i - 1))}>
                  ↑
                </RowButton>
                <RowButton label={`move level ${i} down`} disabled={i === levels.length - 1} onClick={() => onChange(moveLevel(question, i, i + 1))}>
                  ↓
                </RowButton>
                <RowButton label={`remove level ${i}`} tone="danger" disabled={levels.length <= MIN_LEVELS} onClick={() => onChange(removeLevel(question, i))}>
                  ×
                </RowButton>
              </li>
            ))}
          </ol>
          <AddRow onClick={() => onChange(addLevel(question))} disabled={levels.length >= MAX_LEVELS}>
            add a level
          </AddRow>
        </div>
      )}

      {question.type === "noul" && (
        <div className="grid grid-cols-2 gap-2">
          {(["true", "false"] as const).map((side) => {
            const v = (criteria as Record<string, Entry | undefined>)[side];
            return (
              <div key={side} className="space-y-1">
                <Label>{side === "true" ? "yes means…" : "no means…"}</Label>
                <TextInput
                  aria-label={`what ${side === "true" ? "yes" : "no"} means`}
                  value={typeof v === "string" ? v : v ? JSON.stringify(v) : ""}
                  placeholder="optional"
                  onChange={(t) => onChange(setNoulSide(question, side, t), { key: `${keyPrefix}.${side}` })}
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** A keyed map of questions: `questions` on an ask, `alsoAsk` on a route/gate. */
export function QuestionsEditor({
  questions,
  onChange,
  keyPrefix,
  reserved = [],
  emptyText,
  minCount = 0,
}: {
  questions: Record<string, QuestionJson>;
  onChange: (next: Record<string, QuestionJson>, key?: string) => void;
  keyPrefix: string;
  /** Keys that can't be used (e.g. "decision" in alsoAsk). */
  reserved?: string[];
  emptyText?: string;
  minCount?: number;
}) {
  const keys = Object.keys(questions);
  return (
    <div className="space-y-2.5">
      {keys.length === 0 && emptyText && <p className="font-mono text-[10.5px] leading-relaxed text-ink-3">{emptyText}</p>}
      {keys.map((k, i) => (
        <div key={i} className="border-soft bg-surface">
          <div className="flex items-center gap-1.5 border-soft-b bg-surface-2 px-2 py-1.5">
            <span className="font-mono text-[10px] text-ink-3">key</span>
            <KeyInput
              label={`question key ${k}`}
              value={k}
              keys={[...keys, ...reserved]}
              className="flex-1"
              onCommit={(to) => onChange(renameKey(questions, k, to), `${keyPrefix}.key.${i}`)}
            />
            <RowButton label={`remove question ${k}`} tone="danger" disabled={keys.length <= minCount} onClick={() => onChange(removeKey(questions, k))}>
              ×
            </RowButton>
          </div>
          <div className="px-2.5 py-2.5">
            <QuestionEditor
              question={questions[k]!}
              keyPrefix={`${keyPrefix}.${k}`}
              onChange={(q, meta) => onChange({ ...questions, [k]: q }, meta?.key)}
            />
          </div>
        </div>
      ))}
      <AddRow onClick={() => onChange({ ...questions, [freshKey("question", [...keys, ...reserved])]: newQuestion("noul", "") })}>add a question</AddRow>
    </div>
  );
}

export const RESERVED_ALSO_ASK = [DECISION_KEY];

