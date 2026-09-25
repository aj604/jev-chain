/**
 * The order things happened in, as selectable graph ids. Drives `[` / `]`
 * stepping and the numbered "why" story.
 */
import type { FlowGraph, Trace } from "jevchain";

export function visitOrder(graph: FlowGraph, trace: Trace | undefined): string[] {
  if (!trace) return [];
  const ids = new Set(graph.vertices.map((v) => v.id));
  const out: string[] = [];
  const push = (id: string) => {
    if (ids.has(id) && !out.includes(id)) out.push(id);
  };
  const joins = graph.vertices.filter((v) => v.kind === "join");

  for (const span of trace.spans) {
    // Chains have no vertex of their own; their steps do.
    push(span.path);
    if (span.kind === "cascade") {
      for (const call of span.calls) if (call.tier) push(`${span.path}/${call.tier}`);
    }
  }
  // Joins land after the last span inside their parallel.
  for (const j of joins) {
    const span = trace.spans.find((s) => s.path === j.spanPath);
    if (!span || span.status === "running") continue;
    const inside = out.filter((id) => id.startsWith(`${j.spanPath}/`));
    const last = inside.at(-1);
    const at = last ? out.indexOf(last) + 1 : out.indexOf(j.spanPath) + 1;
    out.splice(at, 0, j.id);
  }
  if (trace.halted) {
    const halt = graph.vertices.find((v) => v.kind === "halt" && v.spanPath === trace.halted!.path);
    if (halt) push(halt.id);
  }
  return out;
}

/** Selection after pressing `]` (dir 1) or `[` (dir -1). */
export function stepSelection(order: string[], current: string | null, dir: 1 | -1): string | null {
  if (order.length === 0) return current;
  const i = current ? order.indexOf(current) : -1;
  if (i === -1) return dir === 1 ? order[0]! : order.at(-1)!;
  return order[Math.max(0, Math.min(order.length - 1, i + dir))]!;
}
