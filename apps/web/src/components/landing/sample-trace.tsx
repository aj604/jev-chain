import { ChainLinks } from "@/components/brand/chain-links";
import { Badge } from "@/components/ui/badge";
import { Panel } from "@/components/ui/panel";
import { cn } from "@/lib/cn";

/**
 * A static, illustrative trace of the landing-page `triage` chain. It shows
 * the *shape* of what jevchain records; the studio renders real ones.
 */

const INPUT = "the app crashes every time i open an invoice and i have a demo in 10 minutes";

function Dist({ rows }: { rows: Array<{ label: string; p: number; taken?: boolean }> }) {
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[4.5rem_1fr_2.5rem] items-center gap-2 font-mono text-[11px]">
          <span className={r.taken ? "text-ink" : "text-ink-3"}>{r.label}</span>
          <span className="relative h-2 border-soft bg-surface-2">
            <span
              className={cn("absolute inset-y-0 left-0", r.taken ? "bg-accent" : "bg-dim")}
              style={{ width: `${Math.max(2, r.p * 100)}%` }}
            />
          </span>
          <span className={cn("text-right tabular-nums", r.taken ? "text-ink" : "text-ink-3")}>{r.p.toFixed(2)}</span>
        </li>
      ))}
    </ul>
  );
}

function Step({
  n,
  kind,
  name,
  ms,
  children,
  last,
}: {
  n: string;
  kind: string;
  name: string;
  ms?: number;
  children?: React.ReactNode;
  last?: boolean;
}) {
  return (
    <li className="relative grid grid-cols-[1.75rem_1fr] gap-3">
      <div className="flex flex-col items-center">
        <span className="grid size-6 place-items-center border-hard bg-accent font-mono text-[10px] text-accent-ink">{n}</span>
        {!last && <span aria-hidden className="w-(--bw) flex-1 bg-ink" />}
      </div>
      <div className={cn("min-w-0 space-y-2.5", !last && "pb-5")}>
        <div className="flex flex-wrap items-center gap-2 pt-0.5">
          <Badge tone="ink">{kind}</Badge>
          <span className="font-mono text-xs text-ink">{name}</span>
          {ms !== undefined && <span className="ml-auto font-mono text-[11px] tabular-nums text-ink-3">{ms}ms</span>}
        </div>
        {children}
      </div>
    </li>
  );
}

export function SampleTrace({ className }: { className?: string }) {
  return (
    <Panel
      className={className}
      title={
        <>
          <span aria-hidden className="size-2 bg-pass" />
          <span>trace · run_7f3a</span>
        </>
      }
      actions={<span className="text-ink-3">illustrative</span>}
    >
      <div className="border-soft-b px-4 py-3">
        <div className="mb-1 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">input</div>
        <p className="font-mono text-xs leading-relaxed text-ink-2">&ldquo;{INPUT}&rdquo;</p>
      </div>
      <ol className="px-4 pt-4 pb-2">
        <Step n="01" kind="route" name="triage" ms={38}>
          <p className="font-mono text-[11px] text-ink-3">
            ask <span className="text-ink-2">vibe</span> · choice
          </p>
          <Dist
            rows={[
              { label: "bug", p: 0.81, taken: true },
              { label: "billing", p: 0.16 },
              { label: "vibes", p: 0.03 },
            ]}
          />
        </Step>
        <Step n="02" kind="gate" name="is-urgent" ms={41}>
          <div className="flex flex-wrap items-center gap-2 font-mono text-[11px]">
            <span className="text-ink-3">noul</span>
            <span className="text-ink">p(blocked) = 0.92</span>
            <span className="text-ink-3">≥ 0.70</span>
            <Badge tone="pass" dot>pass</Badge>
          </div>
        </Step>
        <Step n="03" kind="emit" name="page on-call" last />
      </ol>
      <div className="flex flex-wrap items-center justify-between gap-2 border-soft-t bg-surface-2 px-4 py-2.5 font-mono text-[11px] text-ink-3">
        <span className="flex items-center gap-2">
          <ChainLinks count={5} progress={5} size={10} />
          79ms · 2 calls
        </span>
        <span>
          not taken: <span className="line-through decoration-dim">billing</span> ·{" "}
          <span className="line-through decoration-dim">vibes</span> ·{" "}
          <span className="line-through decoration-dim">file a ticket</span>
        </span>
      </div>
    </Panel>
  );
}
