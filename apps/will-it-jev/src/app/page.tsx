import { Jevver } from "@/components/jevver";
import { COPY } from "@/lib/copy";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-4 py-12 sm:px-6 sm:py-16">
      <header className="flex max-w-3xl flex-col gap-4">
        <h1 className="font-display text-6xl leading-[0.95] tracking-tight italic sm:text-8xl">{COPY.siteTitle}</h1>
        <p className="max-w-[52ch] text-lg leading-relaxed text-ink-2">{COPY.tagline}</p>
      </header>
      <Jevver />
      <footer className="mt-auto border-soft-t pt-6 font-mono text-[12px] text-ink-3">{COPY.motto}</footer>
    </main>
  );
}
