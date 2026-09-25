import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { examples, getExample } from "jevchain-examples";
import { ChainLinks } from "@/components/brand/chain-links";
import { ChainMap, ChainMapLegend } from "@/components/chain-map/chain-map";
import { chainStats } from "@/components/examples/example-card";
import { EXAMPLE_NOTES } from "@/components/examples/example-notes";
import { lineOf, SourceView } from "@/components/examples/source-view";
import { ButtonLink } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Panel, PanelDots } from "@/components/ui/panel";
import { exampleGithubUrl, readExampleSource } from "@/lib/repo-source";
import { previewInput, studioHref } from "@/lib/studio-link";

export const dynamicParams = false;

export function generateStaticParams() {
  return examples.map((e) => ({ slug: e.slug }));
}

export async function generateMetadata({ params }: PageProps<"/examples/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const ex = getExample(slug);
  return ex ? { title: `${ex.title} · examples`, description: `${ex.tagline} ${ex.lesson}` } : {};
}

export default async function ExamplePage({ params }: PageProps<"/examples/[slug]">) {
  const { slug } = await params;
  const ex = getExample(slug);
  if (!ex) notFound();

  const source = readExampleSource(ex.file);
  const github = exampleGithubUrl(ex.file);
  const stats = chainStats(ex.chain);
  const notes = (EXAMPLE_NOTES[slug] ?? []).map((n) => {
    const line = lineOf(source, n.at);
    // Fail the build rather than ship a note pointing at nothing.
    if (!line) throw new Error(`examples/${slug}: note "${n.title}" points at "${n.at}", which isn't in ${ex.file}`);
    return { ...n, line };
  });
  const i = examples.findIndex((e) => e.slug === slug);
  const prev = examples[i - 1];
  const next = examples[i + 1];

  return (
    <>
      {/* ── header ─────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-hard-b">
        <div aria-hidden className="bg-grid pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_bottom,black,transparent_80%)] opacity-50" />
        <div className="relative mx-auto max-w-[88rem] px-4 pt-8 pb-12 sm:px-6 lg:pt-10">
          <nav aria-label="breadcrumb" className="flex items-center gap-2 font-mono text-xs lowercase text-ink-3">
            <Link href="/examples" className="hover:text-ink">
              examples
            </Link>
            <span aria-hidden>/</span>
            <span className="text-ink-2" aria-current="page">
              {ex.slug}
            </span>
          </nav>

          <div className="mt-10 grid grid-cols-1 gap-10 lg:grid-cols-12">
            <div className="lg:col-span-7">
              <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] lowercase">
                <span className="border-hard bg-accent px-2 py-1 leading-none text-accent-ink">{ex.pattern}</span>
                <span className="text-ink-3 tabular-nums">
                  {String(i + 1).padStart(2, "0")} / {String(examples.length).padStart(2, "0")}
                </span>
              </div>
              <h1 className="mt-6 font-display text-[clamp(2.75rem,6.5vw,5rem)] leading-[0.92] tracking-[-0.02em] italic">
                {ex.title}
              </h1>
              <p className="mt-5 max-w-xl text-lg leading-relaxed text-ink-2">{ex.tagline}</p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <ButtonLink href={studioHref(ex.slug, ex.inputs[0]?.value)} variant="accent" size="lg">
                  run in studio <span aria-hidden>→</span>
                </ButtonLink>
                <ButtonLink href={github} variant="outline" size="lg">
                  view on github ↗
                </ButtonLink>
              </div>
            </div>
            <aside className="self-end lg:col-span-5">
              <div className="border-hard bg-paper shadow-[5px_5px_0_0_var(--ink)]">
                <div className="flex items-center gap-2 border-hard-b px-4 py-2 font-mono text-[11px] lowercase text-ink-3">
                  <ChainLinks count={3} progress={3} size={10} />
                  the lesson
                </div>
                <p className="px-4 py-4 text-[15px] leading-relaxed text-ink">{ex.lesson}</p>
                <dl className="grid grid-cols-3 border-hard-t font-mono text-[11px] lowercase">
                  {[
                    ["nodes", stats.nodes],
                    ["decisions", stats.decisions],
                    ["call jev", stats.jev],
                  ].map(([k, v], j) => (
                    <div key={k} className={j > 0 ? "border-soft-l px-4 py-2.5" : "px-4 py-2.5"}>
                      <dt className="text-ink-3">{k}</dt>
                      <dd className="mt-0.5 text-lg text-ink tabular-nums">{v}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </aside>
          </div>
        </div>
      </section>

      {/* ── the map ────────────────────────────────────────────────────────── */}
      <section className="border-hard-b">
        <div className="mx-auto max-w-[88rem] px-4 py-10 sm:px-6">
          <Panel
            title={
              <>
                <PanelDots />
                <span className="ml-1">flow graph · graphOf({ex.chain.id})</span>
              </>
            }
            actions={<span className="hidden text-ink-3 sm:inline">static · run it for the live trace</span>}
          >
            <div className="bg-grid overflow-x-auto bg-paper px-6 py-10">
              <div className="mx-auto flex min-w-[36rem] justify-center">
                <ChainMap chain={ex.chain} detail="full" maxScale={1.3} label={`flow graph of ${ex.title}`} />
              </div>
            </div>
            <div className="border-soft-t px-4 py-2.5">
              <ChainMapLegend />
            </div>
          </Panel>
        </div>
      </section>

      {/* ── source + notes ─────────────────────────────────────────────────── */}
      <section className="border-hard-b">
        <div className="mx-auto grid grid-cols-1 max-w-[88rem] gap-10 px-4 py-10 sm:px-6 lg:grid-cols-12 lg:py-14">
          <div className="min-w-0 lg:col-span-7 xl:col-span-8">
            <Panel
              title={
                <>
                  <PanelDots />
                  <span className="ml-1 truncate">packages/examples/src/{ex.file}</span>
                </>
              }
              actions={
                <>
                  <a href={github} target="_blank" rel="noreferrer noopener" className="text-ink-3 hover:text-ink">
                    github ↗
                  </a>
                  <span aria-hidden className="text-dim">
                    ·
                  </span>
                  <CopyButton text={source} />
                </>
              }
            >
              <SourceView code={source} highlight={notes.map((n) => n.line)} />
            </Panel>
          </div>

          <aside className="space-y-10 lg:col-span-5 xl:col-span-4">
            <div className="lg:sticky lg:top-[calc(var(--nav-h)+1.5rem)] space-y-10">
              <div>
                <h2 className="font-display text-3xl italic">what to notice</h2>
                <ol className="mt-5 space-y-px border-hard bg-line">
                  {notes.map((n, j) => (
                    <li key={n.title} className="bg-paper px-4 py-4">
                      <div className="flex items-baseline justify-between gap-3">
                        <h3 className="flex items-baseline gap-2.5 font-mono text-[13px] text-ink">
                          <span className="grid size-5 shrink-0 place-items-center border-hard bg-accent text-[10px] text-accent-ink">
                            {j + 1}
                          </span>
                          {n.title}
                        </h3>
                        <a
                          href={`#L${n.line}`}
                          className="shrink-0 font-mono text-[11px] text-ink-3 tabular-nums hover:text-accent-strong"
                          aria-label={`jump to line ${n.line}`}
                        >
                          L{n.line}
                        </a>
                      </div>
                      <p className="mt-2 pl-[1.875rem] text-[14px] leading-relaxed text-ink-2">{n.body}</p>
                      {n.docs && (
                        <Link
                          href={n.docs}
                          className="mt-2 ml-[1.875rem] inline-block font-mono text-[11px] lowercase text-ink-3 hover:text-ink"
                        >
                          read the docs →
                        </Link>
                      )}
                    </li>
                  ))}
                </ol>
              </div>

              <div>
                <h2 className="font-display text-3xl italic">sample inputs</h2>
                <ul className="mt-5 space-y-px border-hard bg-line">
                  {ex.inputs.map((input, j) => (
                    <li key={input.label} className="bg-paper">
                      <Link
                        href={studioHref(ex.slug, input.value)}
                        className="group block px-4 py-3 transition-colors duration-(--dur-fast) hover:bg-surface-2"
                      >
                        <span className="flex items-center justify-between gap-3">
                          <span className="font-mono text-[12.5px] text-ink">
                            {input.label}
                            {j === 0 && <span className="ml-2 text-ink-3">(default)</span>}
                          </span>
                          <span className="font-mono text-[11px] lowercase whitespace-nowrap text-ink-3 group-hover:text-accent-strong">
                            run this in studio →
                          </span>
                        </span>
                        <span className="mt-1 block line-clamp-2 text-[13px] leading-relaxed break-words text-ink-3">
                          {previewInput(input.value, 180)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </aside>
        </div>
      </section>

      {/* ── prev / next ────────────────────────────────────────────────────── */}
      <nav aria-label="more examples" className="mx-auto w-full max-w-[88rem] px-4 py-10 sm:px-6">
        <div className="grid grid-cols-1 gap-(--bw) border-hard bg-line sm:grid-cols-2">
          {prev ? (
            <Link href={`/examples/${prev.slug}`} className="group bg-paper px-5 py-4 hover:bg-surface-2">
              <span className="font-mono text-[11px] lowercase text-ink-3">← previous</span>
              <span className="mt-1 block font-display text-2xl italic">{prev.title}</span>
            </Link>
          ) : (
            <Link href="/examples" className="group bg-paper px-5 py-4 hover:bg-surface-2">
              <span className="font-mono text-[11px] lowercase text-ink-3">← back</span>
              <span className="mt-1 block font-display text-2xl italic">all examples</span>
            </Link>
          )}
          {next ? (
            <Link href={`/examples/${next.slug}`} className="group bg-paper px-5 py-4 hover:bg-surface-2 sm:text-right">
              <span className="font-mono text-[11px] lowercase text-ink-3">next →</span>
              <span className="mt-1 block font-display text-2xl italic">{next.title}</span>
            </Link>
          ) : (
            <Link href="/docs" className="group bg-paper px-5 py-4 hover:bg-surface-2 sm:text-right">
              <span className="font-mono text-[11px] lowercase text-ink-3">next →</span>
              <span className="mt-1 block font-display text-2xl italic">read the docs</span>
            </Link>
          )}
        </div>
      </nav>
    </>
  );
}
