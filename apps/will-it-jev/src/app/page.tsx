import { COPY } from "@/lib/copy";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-3 px-4 py-16">
      <h1 className="text-4xl font-semibold tracking-tight">{COPY.siteTitle}</h1>
      <p className="border-t border-rule pt-3 text-ink-2">{COPY.tagline}</p>
    </main>
  );
}
