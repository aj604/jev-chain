/**
 * Tiny, safe templates for `state` and `emit`: `{{input}}`, `{{input.user.name}}`,
 * `{{input.items.0}}`. No expressions, no eval; just paths.
 *
 * If the whole template is a single hole (`"{{input.chat}}"`) the raw value is
 * returned, so objects and arrays survive as structured state.
 */
import type { Json } from "./questions";

const HOLE = /\{\{\s*([\w$.-]+)\s*\}\}/g;
const WHOLE = /^\{\{\s*([\w$.-]+)\s*\}\}$/;

export function renderTemplate(template: string, scope: Record<string, unknown>): unknown {
  const whole = WHOLE.exec(template);
  if (whole) return lookup(scope, whole[1]!);
  return template.replace(HOLE, (_, path: string) => {
    const v = lookup(scope, path);
    if (v === undefined || v === null) return "";
    return typeof v === "string" ? v : JSON.stringify(v);
  });
}

/** Render every string inside a JSON value. */
export function renderJson(value: Json, scope: Record<string, unknown>): unknown {
  if (typeof value === "string") return renderTemplate(value, scope);
  if (Array.isArray(value)) return value.map((v) => renderJson(v, scope));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, renderJson(v, scope)]));
  }
  return value;
}

/** The paths a template reads, e.g. for docs or validation. */
export function templatePaths(template: string): string[] {
  return [...template.matchAll(HOLE)].map((m) => m[1]!);
}

function lookup(scope: Record<string, unknown>, path: string): unknown {
  let cur: unknown = scope;
  for (const part of path.split(".")) {
    if (cur === null || cur === undefined) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}
