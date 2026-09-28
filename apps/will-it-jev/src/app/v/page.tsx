import type { Metadata } from "next";
import Link from "next/link";
import { COPY } from "@/lib/copy";
import { parseShareQuery } from "@/lib/share";
import { shareMetadata } from "@/lib/share-metadata";

/**
 * The verdict page. For now it serves only the share preview's metadata,
 * built from the bounded query. The run is in the hash, which never reaches
 * the server and is not read here.
 */
export async function generateMetadata({ searchParams }: PageProps<"/v">): Promise<Metadata> {
  return shareMetadata(parseShareQuery(await searchParams));
}

export default function VerdictPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-3 px-4 py-16">
      <h1 className="text-4xl font-semibold tracking-tight">
        <Link href="/">{COPY.siteTitle}</Link>
      </h1>
      <p className="border-t border-rule pt-3 text-ink-2">
        <Link href="/" className="underline underline-offset-4">
          {COPY.jevSomething}
        </Link>
      </p>
    </main>
  );
}
