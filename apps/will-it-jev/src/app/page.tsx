import { Jevver } from "@/components/jevver";
import { COPY } from "@/lib/copy";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-10 px-4 py-12 sm:py-16">
      <header className="flex flex-col gap-3">
        <h1 className="text-4xl font-semibold tracking-tight">{COPY.siteTitle}</h1>
        <p className="border-t border-rule pt-3 text-ink-2">{COPY.tagline}</p>
      </header>
      <Jevver />
    </main>
  );
}
