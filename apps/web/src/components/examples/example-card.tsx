import Link from "next/link";
import { graphOf, type AnyNode } from "jevchain";
import type { Example } from "jevchain-examples";
import { ChainMap } from "@/components/chain-map/chain-map";
import { CALLS_JEV, layoutGraph } from "@/lib/chain-layout";

/** Counts for a chain's footer: how big it is and how many nodes call Jev. */
export function chainStats(chain: AnyNode) {
  const g = graphOf(chain);
  const real = g.vertices.filter((v) => v.kind !== "join" && v.kind !== "halt");
  return {
    nodes: real.length,
    decisions: real.filter((v) => v.kind === "route" || v.kind === "gate" || v.kind === "cascade").length,
    jev: real.filter((v) => CALLS_JEV.has(v.kind)).length,
  };
}

export function ExampleCard({ example, index }: { example: Example; index: number }) {
  const stats = chainStats(example.chain);
  const layout = layoutGraph(graphOf(example.chain), "compact");
  return (
    <Link
      href={`/examples/${example.slug}`}
      className="group flex h-full flex-col border-hard bg-paper transition-[transform,box-shadow] duration-(--dur) ease-snap hover:-translate-x-[3px] hover:-translate-y-[3px] hover:shadow-[5px_5px_0_0_var(--ink)] focus-visible:-translate-x-[3px] focus-visible:-translate-y-[3px] focus-visible:shadow-[5px_5px_0_0_var(--accent)] focus-visible:outline-none active:translate-0 active:shadow-none"
    >
      <div className="flex items-center justify-between gap-3 border-hard-b px-4 py-2 font-mono text-[11px] lowercase text-ink-3">
        <span className="tabular-nums">{String(index + 1).padStart(2, "0")}</span>
        <span className="truncate text-ink-2">{example.pattern}</span>
      </div>

      <div className="bg-grid relative flex h-40 items-center justify-center border-hard-b px-5 py-4 transition-colors duration-(--dur) group-hover:bg-accent-wash">
        <ChainMap layout={layout} label={`flow graph of ${example.title}`} />
      </div>

      <div className="flex flex-1 flex-col px-5 pt-5 pb-4">
        <h2 className="font-display text-[1.7rem] leading-[1.05] italic text-ink">{example.title}</h2>
        <p className="mt-2.5 flex-1 text-[14.5px] leading-relaxed text-ink-2">{example.tagline}</p>
        <div className="mt-5 flex items-center justify-between gap-3 border-soft-t pt-3 font-mono text-[11px] lowercase text-ink-3">
          <span className="tabular-nums">
            {stats.nodes} nodes · {stats.decisions} {stats.decisions === 1 ? "decision" : "decisions"} ·{" "}
            <span className="text-accent-strong">{stats.jev} jev</span>
          </span>
          <span className="text-ink-2 transition-transform duration-(--dur) group-hover:translate-x-0.5 group-hover:text-ink">
            open →
          </span>
        </div>
      </div>
    </Link>
  );
}
