import { ChainLinks } from "@/components/brand/chain-links";
import { ButtonLink } from "@/components/ui/button";
import { KbdCombo } from "@/components/ui/kbd";

/** On-brand placeholder for pages other agents are still forging. */
export function UnderConstruction({
  eyebrow,
  title,
  children,
  hotkey,
}: {
  eyebrow: string;
  title: string;
  children: React.ReactNode;
  hotkey?: string;
}) {
  return (
    <div className="bg-grid flex flex-1 items-center justify-center px-4 py-20 sm:px-6">
      <div className="w-full max-w-xl border-hard bg-paper shadow-[6px_6px_0_0_var(--ink)]">
        <div className="flex items-center justify-between border-hard-b px-4 py-2 font-mono text-[11px] lowercase text-ink-3">
          <span>{eyebrow}</span>
          {hotkey && <KbdCombo combo={hotkey} />}
        </div>
        <div className="space-y-6 px-6 py-10 sm:px-10">
          <ChainLinks variant="loading" count={9} size={16} label="under construction" className="text-ink" />
          <h1 className="font-display text-5xl leading-[0.95] tracking-tight italic sm:text-6xl">{title}</h1>
          <div className="space-y-3 text-[15px] leading-relaxed text-ink-2">{children}</div>
          <div className="flex flex-wrap gap-3 pt-2">
            <ButtonLink href="/" variant="outline">← back home</ButtonLink>
            <ButtonLink href="/examples" variant="ghost">peek at examples</ButtonLink>
          </div>
        </div>
      </div>
    </div>
  );
}
