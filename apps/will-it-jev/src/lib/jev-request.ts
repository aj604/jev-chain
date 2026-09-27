/**
 * Minimal shape validation for the body forwarded to TypeSafe's
 * `/v1/systemone`. We don't re-implement their schema — just enough to reject
 * obvious garbage before it costs anyone a request.
 */

export const MAX_BODY_BYTES = 64 * 1024;
export const MAX_QUESTIONS = 64;

/** TypeSafe takes text, a JSON object, or a JSON array as state. */
export type JevState = string | Record<string, unknown> | unknown[];

export interface JevRequestBody {
  state: JevState;
  model: string;
  questions: Record<string, { type: string } & Record<string, unknown>>;
}

export type ValidationResult =
  | { ok: true; body: JevRequestBody }
  | { ok: false; message: string };

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export function validateJevRequest(input: unknown): ValidationResult {
  if (!isPlainObject(input)) {
    return { ok: false, message: "body must be a JSON object." };
  }
  const { state, model, questions } = input;

  const emptyState =
    typeof state === "string"
      ? state.length === 0
      : Array.isArray(state)
        ? state.length === 0
        : isPlainObject(state)
          ? Object.keys(state).length === 0
          : true;
  if (emptyState) {
    return { ok: false, message: "`state` must be non-empty text, a JSON object, or a JSON array." };
  }
  if (typeof model !== "string" || model.length === 0) {
    return { ok: false, message: "`model` must be a non-empty string (try \"jev-latest\")." };
  }
  if (!isPlainObject(questions)) {
    return { ok: false, message: "`questions` must be an object of named questions." };
  }

  const entries = Object.entries(questions);
  if (entries.length === 0) {
    return { ok: false, message: "`questions` is empty. jev needs at least one thing to wonder about." };
  }
  if (entries.length > MAX_QUESTIONS) {
    return {
      ok: false,
      message: `too many questions (${entries.length}). the limit is ${MAX_QUESTIONS} per call.`,
    };
  }
  for (const [name, q] of entries) {
    if (!isPlainObject(q) || typeof q.type !== "string") {
      return { ok: false, message: `question \`${name}\` needs a string \`type\`.` };
    }
  }

  return { ok: true, body: input as unknown as JevRequestBody };
}
