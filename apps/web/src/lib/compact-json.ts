/**
 * JSON.stringify, but small objects and arrays stay on one line — the way a
 * human would format a trace excerpt for reading.
 */
export function compactJson(value: unknown, width = 76, depth = 0): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  const pad = "  ".repeat(depth + 1);
  const end = "  ".repeat(depth);
  const isArr = Array.isArray(value);
  const parts = isArr
    ? (value as unknown[]).map((v) => compactJson(v, width, depth + 1))
    : Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .map(([k, v]) => `${JSON.stringify(k)}: ${compactJson(v, width, depth + 1)}`);
  const [open, close] = isArr ? ["[", "]"] : ["{", "}"];
  if (!parts.length) return open + close;
  const one = isArr ? `[${parts.join(", ")}]` : `{ ${parts.join(", ")} }`;
  if (!one.includes("\n") && one.length + depth * 2 <= width) return one;
  return `${open}\n${pad}${parts.join(`,\n${pad}`)}\n${end}${close}`;
}
