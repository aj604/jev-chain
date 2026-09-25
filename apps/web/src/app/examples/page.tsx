import type { Metadata } from "next";
import Link from "next/link";
import { examples } from "jevchain-examples";
import { ChainDivider, ChainLinks } from "@/components/brand/chain-links";
import { ChainMapLegend } from "@/components/chain-map/chain-map";
import { ExampleCard } from "@/components/examples/example-card";

export const metadata: Metadata = {
  title: "examples",
  description: "Five silly chains that teach serious patterns: routing, gating, fan-out, cascades and composite scoring.",
};

export default function ExamplesPage() {
  return (
    <>
      <section className="relative overflow-hidden border-hard-b">
        <div
          aria-hidden
          className="bg-grid pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_bottom,black,transparent_80%)] opacity-60"
        />
        <div className="relative mx-auto grid grid-cols-1 max-w-[88rem] gap-8 px-4 pt-14 pb-12 sm:px-6 lg:grid-cols-12 lg:pt-20">
          <div className="lg:col-span-8">
            <div className="flex items-center gap-3 font-mono text-xs lowercase text-ink-3">
              <ChainLinks count={5} progress={2} className="text-ink" />
              <span>~/examples · {examples.length} chains</span>
            </div>
            <h1 className="mt-7 font-display text-[clamp(2.75rem,7vw,5.5rem)] leading-[0.9] tracking-[-0.02em] italic">
              silly chains,
              <br />
              serious patterns<span className="text-accent">.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink-2">
              every example is a real, typed jevchain program about something deeply unserious. each one teaches exactly
              one composition pattern you&apos;d use in production. read the source, then run it in the studio.
            </p>
          </div>
          <div className="flex items-end lg:col-span-4 lg:justify-end">
            <div className="border-hard bg-paper px-4 py-3">
              <div className="mb-2 font-mono text-[11px] lowercase text-ink-3">reading the maps</div>
              <ChainMapLegend />
            </div>
          </div>
        </div>
      </section>

      <section className="border-hard-b">
        <div className="mx-auto max-w-[88rem] px-4 py-12 sm:px-6 lg:py-16">
          <ul className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {examples.map((e, i) => (
              <li key={e.slug}>
                <ExampleCard example={e} index={i} />
              </li>
            ))}
            <li>
              <Link
                href="/studio"
                className="group flex h-full min-h-72 flex-col justify-between border-(length:--bw) border-dashed border-ink-3 p-6 transition-colors duration-(--dur) hover:border-ink hover:bg-surface-2 focus-visible:border-ink"
              >
                <ChainLinks variant="loading" count={7} size={14} label="a chain, forming" className="text-ink-3 group-hover:text-ink" />
                <div>
                  <p className="font-display text-[1.7rem] leading-[1.05] italic text-ink">your chain here.</p>
                  <p className="mt-2.5 text-[14.5px] leading-relaxed text-ink-2">
                    start from any example, change a question, watch the trace move.
                  </p>
                  <span className="mt-5 inline-block font-mono text-[11px] lowercase text-ink-2 group-hover:text-ink">
                    open the studio →
                  </span>
                </div>
              </Link>
            </li>
          </ul>
        </div>
      </section>

      <section className="border-hard-b">
        <div className="mx-auto max-w-[88rem] px-4 py-12 sm:px-6 lg:py-16">
          <ChainDivider label="pattern index" />
          <div className="mt-8 overflow-x-auto border-hard">
            <table className="w-full min-w-[40rem] border-collapse text-left">
              <thead>
                <tr className="border-hard-b bg-paper font-mono text-[11px] lowercase text-ink-3">
                  <th className="px-4 py-2.5 font-normal">pattern</th>
                  <th className="px-4 py-2.5 font-normal">why it matters</th>
                  <th className="px-4 py-2.5 font-normal">taught by</th>
                </tr>
              </thead>
              <tbody>
                {examples.map((e) => (
                  <tr key={e.slug} className="border-soft-b align-top last:border-b-0">
                    <td className="px-4 py-4 font-mono text-[13px] text-ink">{e.pattern}</td>
                    <td className="max-w-xl px-4 py-4 text-[14px] leading-relaxed text-ink-2">{e.lesson}</td>
                    <td className="px-4 py-4">
                      <Link
                        href={`/examples/${e.slug}`}
                        className="font-mono text-[13px] whitespace-nowrap text-ink underline decoration-accent decoration-[1.5px] underline-offset-[3px] hover:bg-accent-wash"
                      >
                        {e.slug}
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </>
  );
}
