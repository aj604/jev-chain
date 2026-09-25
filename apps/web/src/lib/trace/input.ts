/**
 * The studio's input box: plain text or JSON. Pure helpers so the parsing
 * rules are tested and shared (compare mode has two of these).
 */
import type { Json } from "jevchain";

export type InputMode = "text" | "json";

export type ParsedInput = { ok: true; value: Json } | { ok: false; error: string; line?: number };

export function parseInput(text: string, mode: InputMode): ParsedInput {
  if (mode === "text") {
    return text.trim() ? { ok: true, value: text } : { ok: false, error: "type something for jev to read" };
  }
  if (!text.trim()) return { ok: false, error: "empty. try {} or switch to text" };
  try {
    return { ok: true, value: JSON.parse(text) as Json };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const line = lineOf(text, message);
    return { ok: false, error: tidyJsonError(message), ...(line ? { line } : {}) };
  }
}

/** Text + mode for showing a value in the editor. */
export function toEditor(value: Json): { text: string; mode: InputMode } {
  return typeof value === "string" ? { text: value, mode: "text" } : { text: JSON.stringify(value, null, 2), mode: "json" };
}

function lineOf(text: string, message: string): number | undefined {
  const line = /line (\d+)/i.exec(message);
  if (line) return Number(line[1]);
  const pos = /position (\d+)/i.exec(message);
  if (!pos) return undefined;
  return text.slice(0, Number(pos[1])).split("\n").length;
}

function tidyJsonError(message: string): string {
  return message
    .replace(/^JSON\.parse: /, "")
    .replace(/ in JSON at position \d+.*$/, "")
    .replace(/\s*\(line \d+ column \d+\)$/, "")
    .toLowerCase();
}
