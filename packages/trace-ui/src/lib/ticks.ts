/** Axis ticks for a 0..total ms range: round steps (1, 2, 5 × 10^n), about `target` of them. */
export function timeTicks(total: number, target = 6): number[] {
  if (!(total > 0)) return [0];
  const raw = total / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= raw) ?? 10 * pow;
  const out: number[] = [];
  for (let t = 0; t <= total + 1e-9; t += step) out.push(Math.round(t * 1000) / 1000);
  return out;
}

/** Depth of a span path relative to the root: "$" → 0, "$/0" → 1, "$/0/bug" → 2. */
export function pathDepth(path: string): number {
  return path.split("/").length - 1;
}
