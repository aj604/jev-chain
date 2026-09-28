import type { JevRequestBody } from "./jev-request";
import { CAPS, LABEL_PATTERN } from "./recipe/types";

export type RecipeRequestCheck = { ok: true } | { ok: false; message: string };

/**
 * The proxy's second check, after the studio's `validateJevRequest`: accept
 * only a body a compiled recipe could send. A gate or route asks one
 * question, a rate leaf asks up to `CAPS.rateQuestions.max`, a gate's noul
 * may describe its two answers, and every string is one `validateRecipe`
 * already capped, so the key can't be borrowed for
 * anything bigger.
 *
 * The message names the first problem, for tests and logs. Visitors see
 * `COPY.notRecipe` instead.
 */
export function validateRecipeRequest(body: JevRequestBody): RecipeRequestCheck {
  const extra = Object.keys(body).find((key) => !BODY_FIELDS.has(key));
  if (extra !== undefined) return fail(`\`${extra}\` is not part of a recipe request`);

  const { state, questions } = body;
  if (typeof state !== "string") return fail("`state` must be text");
  if (!state.trim()) return fail("`state` is empty");
  if (state.length > CAPS.input) return fail(`\`state\` is over ${CAPS.input} characters`);

  const entries = Object.entries(questions);
  const { min, max } = CAPS.rateQuestions;
  if (entries.length < min || entries.length > max) {
    return fail(`needs ${min} to ${max} questions, got ${entries.length}`);
  }

  for (const [name, q] of entries) {
    const problem = questionProblem(q);
    if (problem) return fail(`question \`${name}\`: ${problem}`);
  }
  return { ok: true };
}

const BODY_FIELDS = new Set(["state", "model", "questions"]);
const QUESTION_FIELDS = new Set(["type", "instructions", "criteria"]);

const fail = (message: string): RecipeRequestCheck => ({ ok: false, message });

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Non-empty after trimming and within `cap`, like `validateRecipe`'s strings. */
const fits = (value: unknown, cap: number): boolean =>
  typeof value === "string" && value.trim().length > 0 && value.length <= cap;

const outside = (n: number, { min, max }: { min: number; max: number }) => n < min || n > max;

function questionProblem(q: JevRequestBody["questions"][string]): string | undefined {
  const extra = Object.keys(q).find((key) => !QUESTION_FIELDS.has(key));
  if (extra !== undefined) return `\`${extra}\` is not part of a recipe question`;
  if (!fits(q.instructions, CAPS.question)) {
    return `instructions must be text up to ${CAPS.question} characters`;
  }

  switch (q.type) {
    case "noul": {
      // A gate with `means` sends `{ true, false }`. A rated noul sends none.
      if (!Object.hasOwn(q, "criteria")) return undefined;
      const criteria = q.criteria;
      if (!isObject(criteria)) return "a noul's criteria must be an object with true and false";
      const keys = Object.keys(criteria);
      if (keys.length !== 2 || !Object.hasOwn(criteria, "true") || !Object.hasOwn(criteria, "false")) {
        return "a noul's criteria has exactly true and false";
      }
      if (!fits(criteria.true, CAPS.means) || !fits(criteria.false, CAPS.means)) {
        return `a noul's true and false must be text up to ${CAPS.means} characters`;
      }
      return undefined;
    }

    case "choice": {
      const criteria = q.criteria;
      if (!isObject(criteria)) return "criteria must be an object";
      const labels = Object.entries(criteria);
      if (outside(labels.length, CAPS.labels)) {
        return `needs ${CAPS.labels.min} to ${CAPS.labels.max} labels`;
      }
      for (const [label, description] of labels) {
        if (!LABEL_PATTERN.test(label)) return `label "${label}" does not match the label pattern`;
        if (!fits(description, CAPS.labelDescription)) {
          return `label "${label}" needs a description up to ${CAPS.labelDescription} characters`;
        }
      }
      return undefined;
    }

    case "score": {
      const levels = q.criteria;
      if (!Array.isArray(levels)) return "criteria must be a list";
      if (outside(levels.length, CAPS.levels)) {
        return `needs ${CAPS.levels.min} to ${CAPS.levels.max} levels`;
      }
      const bad = levels.findIndex((level) => !fits(level, CAPS.level));
      return bad === -1 ? undefined : `level ${bad} must be text up to ${CAPS.level} characters`;
    }

    default:
      return `type "${q.type}" is not noul, choice or score`;
  }
}
