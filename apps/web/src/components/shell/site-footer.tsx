import Link from "next/link";
import { ChainLinks } from "@/components/brand/chain-links";
import { Logo } from "@/components/brand/logo";
import { GITHUB_URL } from "./site-nav";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-hard-t">
      <div className="mx-auto flex max-w-[88rem] flex-col gap-6 px-4 py-8 sm:flex-row sm:items-end sm:justify-between sm:px-6">
        <div className="space-y-3">
          <Logo />
          <p className="max-w-sm text-[13px] leading-relaxed text-ink-3">
            barely affiliated with itself. built on{" "}
            <a href="https://typesafe.ai" target="_blank" rel="noreferrer noopener" className="text-ink-2 underline decoration-dotted underline-offset-4 hover:text-ink">
              jev by typesafe
            </a>
            .
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:items-end">
          <ul className="flex flex-wrap gap-x-5 gap-y-2 font-mono text-xs lowercase text-ink-3">
            <li><Link className="hover:text-ink" href="/studio">studio</Link></li>
            <li><Link className="hover:text-ink" href="/examples">examples</Link></li>
            <li><Link className="hover:text-ink" href="/docs">docs</Link></li>
            <li><a className="hover:text-ink" href={GITHUB_URL} target="_blank" rel="noreferrer noopener">github ↗</a></li>
          </ul>
          <div className="flex items-center gap-3 font-mono text-[11px] text-ink-3">
            <ChainLinks count={7} progress={1} />
            <span>mit licensed · p(useful) ≈ 0.93</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
