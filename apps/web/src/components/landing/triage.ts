/**
 * The landing page's `triage` chain, run once at build time for the hero trace.
 *
 * The chain is the one the page prints as `TRIAGE` in `app/page.tsx`
 * (`sample-trace.test.ts` evaluates that string and checks it builds this very
 * chain). It runs on the real runtime against the docs' scripted Jev client, so
 * the spans, decisions and summaries in the hero are exactly what `jev.run`
 * returns; only the probabilities are hand-picked.
 */
import { choice, createJev, emit, gate, noul, route, type Trace } from "jevchain";
import { scriptedClient } from "@/docs/fixtures";

export const triage = route("triage", {
  ask: choice("What is this message about?", {
    billing: "money, invoices, refunds",
    bug: "something is broken",
    vibes: "no actionable content, just vibes",
  }),
  branches: {
    billing: emit("→ billing"),
    bug: gate("is-urgent", {
      ask: noul("Is the user blocked right now?"),
      pass: { min: 0.7 },
      then: emit("page on-call"),
      otherwise: emit("file a ticket"),
    }),
    vibes: emit("reply with a gif"),
  },
});

export const TRIAGE_INPUT = "the app crashes every time i open an invoice and i have a demo in 10 minutes";

/** What Jev "says" about the hero's message, keyed by question instructions (see `scriptedClient`). */
export const TRIAGE_SCRIPT = {
  "What is this message about?": { billing: 0.07, bug: 0.91, vibes: 0.02 },
  "Is the user blocked right now?": 0.92,
};

let cached: Promise<Trace> | undefined;

/** The hero's run: memoized, so a build runs it once. */
export function landingTrace(): Promise<Trace> {
  cached ??= createJev(scriptedClient(TRIAGE_SCRIPT))
    .run(triage, TRIAGE_INPUT, { runId: "run_7f3a" })
    .then((r) => r.trace);
  return cached;
}
