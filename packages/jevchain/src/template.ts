/**
 * Tiny, safe templates for `state` and `emit`: `{{input}}`, `{{input.user.name}}`,
 * `{{input.items.0}}`. No expressions, no eval; just paths.
 *
 * If the whole template is a single hole (`"{{input.chat}}"`) the raw value is
 * returned, so objects and arrays survive as structured state.
 *
 * A hole's root must be `input`, `run` or `results`. `chainIssues` checks that
 * (and that `results.<id>` names a node that has finished by then) before a run;
 * a hole that still comes up empty at runtime is reported through `onMissing`.
 */
import type { Json } from "./questions";

const HOLE = /\{\{\s*([\w$.-]+)\s*\}\}/g;
const WHOLE = /^\{\{\s*([\w$.-]+)\s*\}\}$/;

/** What a template can read: the node's input, the run's input, and finished nodes' outputs by id. */
export const TEMPLATE_ROOTS = ["input", "run", "results"] as const;

/** Called with a hole's path when there's nothing there, e.g. `"input.mesage"`. An explicit `null` isn't missing. */
export type OnMissing = (path: string) => void;

export function renderTemplate(template: string, scope: Record<string, unknown>, onMissing?: OnMissing): unknown {
  const whole = WHOLE.exec(template);
  if (whole) return lookup(scope, whole[1]!, onMissing);
  return template.replace(HOLE, (_, path: string) => {
    const v = lookup(scope, path, onMissing);
    if (v === undefined || v === null) return "";
    return typeof v === "string" ? v : JSON.stringify(v);
  });
}

/** Render every string inside a JSON value. */
export function renderJson(value: Json, scope: Record<string, unknown>, onMissing?: OnMissing): unknown {
  if (typeof value === "string") return renderTemplate(value, scope, onMissing);
  if (Array.isArray(value)) return value.map((v) => renderJson(v, scope, onMissing));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, renderJson(v, scope, onMissing)]));
  }
  return value;
}

/** The paths a template reads, e.g. for docs or validation. */
export function templatePaths(template: string): string[] {
  return [...template.matchAll(HOLE)].map((m) => m[1]!);
}

function lookup(scope: Record<string, unknown>, path: string, onMissing?: OnMissing): unknown {
  let cur: unknown = scope;
  for (const part of path.split(".")) {
    if (cur === null || cur === undefined) {
      cur = undefined;
      break;
    }
    cur = (cur as Record<string, unknown>)[part];
  }
  if (cur === undefined) onMissing?.(path);
  return cur;
}
