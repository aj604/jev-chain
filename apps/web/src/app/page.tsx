import { ChainDivider, ChainLinks } from "@/components/brand/chain-links";
import { SampleTrace } from "@/components/landing/sample-trace";
import { ButtonLink } from "@/components/ui/button";
import { Code, CodeBlock } from "@/components/ui/code-block";
import { CopyButton } from "@/components/ui/copy-button";
import { KbdCombo } from "@/components/ui/kbd";

const TRIAGE = `import { route, gate, choice, noul, emit } from "jevchain";

const triage = route("triage", {
  ask: choice("What is this message about?", {
    billing: "money, invoices, refunds",
    bug: "something is broken",
    vibes: "no actionable content, just vibes",
  }),
  branches: {
    billing: emit("→ billing"),
    bug: gate("is-urgent", {
      ask: noul("Is the user blocked right now?"),
      pass: { min: 0.7 },
      then: emit("page on-call"),
      otherwise: emit("file a ticket"),
    }),
    vibes: emit("reply with a gif"),
  },
});`;

const FEATURES: Array<{ title: string; body: string; code: string }> = [
  {
    title: "typed answers",
    body: "choice options come back as a literal union, not string. your editor knows what jev can say before jev does.",
    code: `answers.vibe.choice // "billing" | "bug" | "vibes"`,
  },
  {
    title: "exhaustive routing",
    body: "add a fourth option and forget its branch, and tsc tells you before production does.",
    code: `// ✗ property 'refund' is missing in branches`,
  },
  {
    title: "streaming traces",
    body: "every run emits events as it happens: node entered, question asked, distribution received, branch taken.",
    code: `for await (const e of run.events) draw(e)`,
  },
  {
    title: "parallel + batching",
    body: "fan out asks concurrently. questions about the same input fold into a single jev call.",
    code: `parallel({ tone, topic, urgency }, merge)`,
  },
  {
    title: "serializable chains",
    body: "chains are data. json in, json out — the studio and your code share one definition.",
    code: `fromJSON(toJSON(triage)) // same chain`,
  },
  {
    title: "zero dependencies",
    body: "typescript and fetch. no four-hundred-package tree, no ‘agent’ that is secretly a while loop.",
    code: `dependencies: {}`,
  },
];

export default function Home() {
  return (
    <>
      {/* ── hero ─────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden border-hard-b">
        <div aria-hidden className="bg-grid pointer-events-none absolute inset-0 [mask-image:linear-gradient(to_bottom,black,transparent_85%)] opacity-60" />
        <div className="relative mx-auto grid max-w-[88rem] gap-12 px-4 pt-14 pb-16 sm:px-6 lg:grid-cols-12 lg:gap-10 lg:pt-20 lg:pb-24">
          <div className="lg:col-span-7">
            <div className="flex flex-wrap items-center gap-3 font-mono text-xs lowercase text-ink-3">
              <ChainLinks count={5} progress={1} className="text-ink" />
              <span>v0.1 · decision graphs that show their work</span>
            </div>

            <h1 className="mt-8 font-display text-[clamp(3.25rem,9vw,7.5rem)] leading-[0.88] tracking-[-0.02em] italic">
              chains of thought,
              <br />
              <span className="relative inline-block">
                minus the thought
                <span aria-hidden className="absolute -bottom-1 left-0 h-[0.09em] w-full bg-accent" />
              </span>
              <span className="text-accent">.</span>
            </h1>

            <p className="mt-8 max-w-xl text-lg leading-relaxed text-ink-2">
              jevchain composes calls to <strong className="font-medium text-ink">jev</strong>, typesafe&apos;s
              classification model, into typed decision graphs. jev doesn&apos;t write essays — it answers your questions
              with probabilities, in milliseconds, and jevchain routes on them. every run leaves a full trace: each
              question, each distribution, every branch not taken.
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-3">
              <ButtonLink href="/studio" variant="accent" size="lg">
                open the studio <span aria-hidden>→</span>
              </ButtonLink>
              <ButtonLink href="/examples" variant="outline" size="lg">
                browse examples
              </ButtonLink>
              <div className="flex h-11 items-center gap-3 border-soft bg-surface px-4 font-mono text-[13px]">
                <span className="text-ink-3">$</span>
                <span>pnpm add jevchain</span>
                <CopyButton text="pnpm add jevchain" className="ml-2" />
              </div>
            </div>

            <p className="mt-6 hidden items-center gap-2 font-mono text-[11px] text-ink-3 md:flex">
              press <KbdCombo combo="?" /> for shortcuts · <KbdCombo combo="g s" /> jumps to the studio
            </p>
          </div>

          <div className="lg:col-span-5 lg:pt-3">
            <SampleTrace className="shadow-[6px_6px_0_0_var(--ink)]" />
          </div>
        </div>
      </section>

      {/* ── the pitch ────────────────────────────────────────────────────── */}
      <section className="border-hard-b">
        <div className="mx-auto max-w-[88rem] px-4 py-16 sm:px-6 lg:py-20">
          <ChainDivider label="the pitch" />
          <div className="mt-10 grid gap-10 lg:grid-cols-12">
            <h2 className="font-display text-4xl leading-[1.02] italic sm:text-5xl lg:col-span-4">
              you asked a yes-or-no question.
              <span className="text-ink-3"> you deserve a number.</span>
            </h2>
            <div className="grid gap-(--bw) border-hard bg-line sm:grid-cols-2 lg:col-span-8">
              <figure className="bg-paper p-5">
                <figcaption className="mb-4 flex items-center justify-between font-mono text-[11px] lowercase text-ink-3">
                  <span>a chatty llm</span>
                  <span className="tabular-nums">2,341ms · 187 tokens</span>
                </figcaption>
                <p className="text-[15px] leading-relaxed text-ink-3">
                  &ldquo;Great question! Based on the content of the message, it appears the user may be experiencing an
                  issue that could potentially relate to billing, although it&apos;s also possible that it&hellip;&rdquo;
                </p>
              </figure>
              <figure className="bg-paper p-5">
                <figcaption className="mb-4 flex items-center justify-between font-mono text-[11px] lowercase text-ink-3">
                  <span className="text-ink">jev</span>
                  <span className="tabular-nums">38ms · one call</span>
                </figcaption>
                <Code
                  code={`{ billing: 0.92, bug: 0.06, vibes: 0.02 }`}
                  className="text-sm"
                />
                <p className="mt-4 text-[15px] leading-relaxed text-ink-2">
                  a distribution you can threshold, route on, log, and diff. jevchain turns a pile of these into a
                  program.
                </p>
              </figure>
            </div>
          </div>
        </div>
      </section>

      {/* ── the api ──────────────────────────────────────────────────────── */}
      <section className="border-hard-b">
        <div className="mx-auto grid max-w-[88rem] gap-10 px-4 py-16 sm:px-6 lg:grid-cols-12 lg:py-20">
          <div className="lg:col-span-4">
            <ChainDivider label="the api" count={3} />
            <h2 className="mt-8 font-display text-4xl leading-[1.02] italic sm:text-5xl">
              decisions, composed like functions.
            </h2>
            <p className="mt-5 text-[15px] leading-relaxed text-ink-2">
              <code className="font-mono text-[13px] text-ink">route</code> branches on a choice.{" "}
              <code className="font-mono text-[13px] text-ink">gate</code> continues only when a probability clears the
              bar. nest them, reuse them, serialize them. the types follow the chain all the way down, so every branch
              you forgot is a compile error instead of a 3am page.
            </p>
            <ul className="mt-6 space-y-2 font-mono text-[13px] text-ink-2">
              {["ask", "route", "gate", "parallel", "cascade", "step"].map((p) => (
                <li key={p} className="flex items-center gap-3">
                  <span aria-hidden className="size-1.5 bg-accent" />
                  {p}
                </li>
              ))}
            </ul>
          </div>
          <CodeBlock code={TRIAGE} filename="triage.ts" className="min-w-0 lg:col-span-8" />
        </div>
      </section>

      {/* ── features ─────────────────────────────────────────────────────── */}
      <section className="border-hard-b">
        <div className="mx-auto max-w-[88rem] px-4 py-16 sm:px-6 lg:py-20">
          <ChainDivider label="what's in the box" />
          <ul className="mt-10 grid gap-(--bw) border-hard bg-line sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f, i) => (
              <li key={f.title} className="group flex flex-col bg-paper p-6 transition-colors duration-(--dur) hover:bg-surface-2">
                <div className="flex items-center justify-between font-mono text-[11px] text-ink-3">
                  <span>{String(i + 1).padStart(2, "0")}</span>
                  <ChainLinks
                    count={5}
                    progress={i % 2 === 0 ? 1 : 0}
                    size={10}
                    className="text-ink-3 transition-colors duration-(--dur) group-hover:text-ink"
                  />
                </div>
                <h3 className="mt-6 font-mono text-[15px] lowercase text-ink">{f.title}</h3>
                <p className="mt-2 flex-1 text-[14px] leading-relaxed text-ink-2">{f.body}</p>
                <Code code={f.code} className="mt-5 border-soft-t pt-4 text-[12px] whitespace-pre-wrap" />
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ── cta ──────────────────────────────────────────────────────────── */}
      <section className="bg-ink text-paper [--chain-bg:var(--ink)]">
        <div className="mx-auto flex max-w-[88rem] flex-col gap-10 px-4 py-20 sm:px-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <ChainLinks variant="loading" count={11} size={14} label="chain forming" />
            <h2 className="mt-8 font-display text-5xl leading-[0.95] italic sm:text-7xl">
              stop generating.
              <br />
              start deciding<span className="text-accent">.</span>
            </h2>
          </div>
          <div className="flex flex-wrap gap-3">
            <ButtonLink href="/studio" variant="accent" size="lg" className="hover:shadow-[2px_2px_0_0_var(--paper)]">
              build a chain <span aria-hidden>→</span>
            </ButtonLink>
            <ButtonLink
              href="/docs"
              variant="ghost"
              size="lg"
              className="border-(length:--bw) border-paper text-paper hover:bg-paper hover:text-ink"
            >
              read the docs
            </ButtonLink>
          </div>
        </div>
      </section>
    </>
  );
}
