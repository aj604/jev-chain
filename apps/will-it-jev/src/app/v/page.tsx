import type { Metadata } from "next";
import Link from "next/link";
import { SharedVerdict } from "@/components/shared-verdict";
import { COPY } from "@/lib/copy";
import { parseShareQuery } from "@/lib/share";
import { shareMetadata } from "@/lib/share-metadata";

/**
 * The verdict page. The server builds only the share preview's metadata,
 * from the bounded query. The run is in the hash, which never reaches the
 * server: `SharedVerdict` reads it in the browser.
 */
export async function generateMetadata({ searchParams }: PageProps<"/v">): Promise<Metadata> {
  return shareMetadata(parseShareQuery(await searchParams));
}

export default function VerdictPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-4 py-12 sm:py-16">
      <h1 className="text-4xl font-semibold tracking-tight">
        <Link href="/">{COPY.siteTitle}</Link>
      </h1>
      <SharedVerdict />
    </main>
  );
}
