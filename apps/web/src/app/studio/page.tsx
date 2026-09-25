import type { Metadata } from "next";
import { Studio } from "@/components/studio/studio";

export const metadata: Metadata = {
  title: "studio",
  description: "Run a jevchain and watch it decide: the live graph, every probability, the full trace, and the roads not taken.",
};

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function StudioPage({ searchParams }: PageProps<"/studio">) {
  const params = await searchParams;
  const example = first(params.example);
  const input = first(params.input);
  const mode = first(params.mode) === "build" ? "build" : undefined;
  return (
    <Studio
      key={`${example ?? ""}\u0000${input ?? ""}\u0000${mode ?? ""}`}
      {...(example ? { initialSlug: example } : {})}
      {...(input ? { initialInput: input } : {})}
      {...(mode ? { initialMode: mode } : {})}
    />
  );
}
