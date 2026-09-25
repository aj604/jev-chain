import { ChainLinks } from "@/components/brand/chain-links";
import { ButtonLink } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-24 sm:px-6">
      <div className="max-w-lg space-y-6 text-center">
        <div className="flex items-center justify-center gap-3 text-ink-3">
          <ChainLinks count={3} />
          <span className="font-mono text-xs">404</span>
          <ChainLinks count={3} />
        </div>
        <h1 className="font-display text-5xl leading-none italic sm:text-6xl">a link is missing.</h1>
        <p className="text-ink-2">
          we asked jev whether this page exists. <span className="font-mono text-sm text-ink">p(exists) = 0.00</span>.
          it was very sure.
        </p>
        <ButtonLink href="/" variant="solid">take me home</ButtonLink>
      </div>
    </div>
  );
}
