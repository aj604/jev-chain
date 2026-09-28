import type { CircuitRow, DecisionRow, RateItem, RateRow } from "@/lib/circuit";
import { COPY } from "@/lib/copy";
import { tierOf } from "@/lib/recipe/verdict";

/**
 * The circuit: one row per gate, route and rating, as `circuitRows` gives
 * them. It renders what it is given, so pacing is the caller's (`useReveal`).
 * No state, so it works on the server and in client pages alike.
 */
export function Circuit({ rows }: { rows: CircuitRow[] }) {
  const labels = rowLabels(rows);
  return (
    <ol className="flex min-w-0 flex-col border-t border-rule">
      {rows.map((row, i) => (
        <li key={row.path} className="min-w-0 border-b border-rule py-3">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-3">{labels[i]}</p>
          {row.kind === "rate" ? <Rating row={row} /> : <Decision row={row} />}
        </li>
      ))}
    </ol>
  );
}

/** "Gate 1", "Gate 2"… for decision rows, counted in row order, and "Rating" for rate rows. */
function rowLabels(rows: CircuitRow[]): string[] {
  let gates = 0;
  return rows.map((row) => (row.kind === "rate" ? COPY.rating : COPY.gateLabel(++gates)));
}

function Decision({ row }: { row: DecisionRow }) {
  return (
    <>
      <p className="mt-1 wrap-break-word text-ink">{row.question}</p>
      <p className="mt-1 wrap-break-word text-ink-2">
        {row.status === "thinking" ? (
          <Thinking />
        ) : (
          <>
            <strong className="font-semibold text-ink">{row.answer}</strong>
            {row.pct !== undefined && <span className="tabular-nums">, {row.pct}%</span>}
            {row.other !== undefined && (
              <>
                {" "}
                {/* <del>, so assistive tech can say it is the answer that lost. */}
                <del className="text-ink-3">{row.other}</del>
              </>
            )}
          </>
        )}
      </p>
    </>
  );
}

function Rating({ row }: { row: RateRow }) {
  if (row.status === "thinking") {
    return (
      <p className="mt-1 text-ink-2">
        <Thinking />
      </p>
    );
  }
  return (
    <ul className="mt-2 flex flex-col gap-3">
      {row.items.map((item, i) => (
        <RatedItem key={i} item={item} />
      ))}
    </ul>
  );
}

const BAR: Record<ReturnType<typeof tierOf>, string> = { jevs: "bg-yes", kinda: "bg-ink-3", nope: "bg-no" };

function RatedItem({ item }: { item: RateItem }) {
  const g = Number.isFinite(item.goodness) ? Math.min(1, Math.max(0, item.goodness)) : 0;
  const pct = Math.round(g * 100);
  return (
    <li className="min-w-0">
      <p className="wrap-break-word text-ink">{item.question}</p>
      <div
        role="meter"
        aria-label={item.question}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-rule"
      >
        <div className={`h-full rounded-full ${BAR[tierOf(g)]}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-1 wrap-break-word text-sm text-ink-2">{item.answer}</p>
    </li>
  );
}

/** "…", with a dot that pulses unless the visitor prefers reduced motion. */
function Thinking() {
  return (
    <span className="inline-flex items-center gap-2 text-ink-3">
      <span aria-hidden="true" className="inline-block size-2 animate-pulse rounded-full bg-ink-3 motion-reduce:animate-none" />
      …
    </span>
  );
}
