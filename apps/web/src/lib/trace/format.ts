/**
 * Number formatting for traces. Everything here is pure and tiny on purpose:
 * the studio, docs and gallery all print the same numbers the same way.
 */
import type { Answer, Decision, Entry, Question } from "jevchain";

/** 38 → "38ms", 1234 → "1.23s", 61_000 → "1m 1s". */
export function fmtMs(ms: number | undefined | null): string {
  if (ms === undefined || ms === null || !Number.isFinite(ms)) return "—";
  if (ms === 0) return "0ms";
  if (ms < 1) return `${ms.toFixed(2)}ms`;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`;
  const m = Math.floor(ms / 60_000);
  return `${m}m ${Math.round((ms - m * 60_000) / 1000)}s`;
}

/**
 * Dollars with enough precision to be honest about tiny numbers:
 * 0 → "$0", 0.000049 → "$0.000049", 0.0123 → "$0.0123", 1.5 → "$1.50".
 */
export function fmtUsd(usd: number | undefined | null): string {
  if (usd === undefined || usd === null || !Number.isFinite(usd)) return "—";
  if (usd === 0) return "$0";
  const abs = Math.abs(usd);
  if (abs >= 0.1) return `$${usd.toFixed(2)}`;
  // two significant figures, trailing zeros trimmed
  const digits = Math.min(10, Math.max(2, 1 - Math.floor(Math.log10(abs))));
  return `$${usd.toFixed(digits).replace(/(\.\d*?[1-9])0+$/, "$1")}`;
}

/** 1234 → "1,234", 12_345 → "12.3k". Fractional token shares round. */
export function fmtTokens(n: number | undefined | null): string {
  if (n === undefined || n === null || !Number.isFinite(n)) return "—";
  const r = Math.round(n);
  if (r >= 10_000) return `${(r / 1000).toFixed(1)}k`;
  return r.toLocaleString("en-US");
}

/** 0.712 → "71%"; tiny non-zero values say "<1%". */
export function fmtPct(p: number): string {
  if (p > 0 && p < 0.005) return "<1%";
  return `${Math.round(p * 100)}%`;
}

/** Fixed two decimals, no leading zero drama: 0.84 → "0.84". */
export function fmtNum(v: number, digits = 2): string {
  return Number.isFinite(v) ? v.toFixed(digits) : "—";
}

/** The deciding number on an edge, compact: "71%", "p 0.84", "conf 0.52", "2.26". */
export function fmtMetric(metric: Decision["metric"] | undefined, value: number | null | undefined): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  switch (metric) {
    case "probability":
      return fmtPct(value);
    case "noul":
      return `p ${fmtNum(value)}`;
    case "confidence":
      return `conf ${fmtNum(value)}`;
    case "score":
      return fmtNum(value);
    default:
      return fmtNum(value);
  }
}

/** A threshold as a comparison: { min: 0.7 } → "≥ 0.70", { max: 0.5 } → "≤ 0.50". */
export function fmtThreshold(t: { min?: number; max?: number } | undefined): string | null {
  if (!t) return null;
  if (t.min !== undefined && t.max !== undefined) return `${fmtNum(t.min)}–${fmtNum(t.max)}`;
  if (t.min !== undefined) return `≥ ${fmtNum(t.min)}`;
  if (t.max !== undefined) return `≤ ${fmtNum(t.max)}`;
  return null;
}

/** Plain text for an Entry (instructions / criteria / state): strings as-is, JSON compact. */
export function entryText(e: Entry | undefined): string {
  if (e === undefined || e === null) return "";
  if (typeof e === "string") return e;
  return JSON.stringify(e);
}

/** Labels a question can answer with, for chips on graph nodes. */
export function questionLabels(q: Question | undefined): string[] {
  if (!q) return [];
  switch (q.type) {
    case "choice":
      return Object.keys(q.criteria);
    case "score":
      return q.criteria.map((_, i) => String(i));
    case "noul":
      return ["yes", "no"];
  }
}

/** One-word name of the measured quantity for a gate: "p(yes)", "score", "p(label)", "conf". */
export function gateMeasure(q: Question | undefined, label?: string): string {
  if (!q) return "value";
  if (q.type === "noul") return "p(yes)";
  if (q.type === "score") return "score";
  return label ? `p(${label})` : "conf";
}

/** Relative time for lists: "just now", "4m ago", "2h ago", "3d ago", else a date. */
export function fmtAgo(iso: string, now = Date.now()): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.round((now - t) / 1000));
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86_400) return `${Math.round(s / 3600)}h ago`;
  if (s < 7 * 86_400) return `${Math.round(s / 86_400)}d ago`;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * The gist of one answer, short enough for a chip:
 * choice → "plans 64%", score → "2.26 / 3", noul → "p .12".
 */
export function answerBrief(a: Answer | undefined): string {
  if (!a) return "";
  switch (a.type) {
    case "choice":
      return `${a.choice} ${fmtPct(a.probabilities[a.choice] ?? 0)}`;
    case "score":
      return `${fmtNum(a.score)} / ${Math.max(0, Object.keys(a.probabilities).length - 1)}`;
    case "noul":
      return `p ${fmtNum(a.noul)}`;
  }
}

/** One-line preview of any JSON input, truncated. */
export function previewJson(value: unknown, max = 80): string {
  let s: string;
  if (typeof value === "string") s = value;
  else {
    try {
      s = JSON.stringify(value) ?? "";
    } catch {
      s = String(value);
    }
  }
  s = s.replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
