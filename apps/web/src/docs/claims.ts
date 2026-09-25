/**
 * Things the docs say the framework *prints*: decision summaries, trace JSON,
 * error messages, rendered templates. Pages render these constants instead of
 * typing the text inline, and `claims.test.ts` runs the real framework (with a
 * fake Jev client) and checks every one of them against what it actually
 * produces.
 *
 * So when jevchain changes a sentence, the test fails and names the page to
 * fix. A claim with no proof in the test is a type error there, and a test
 * failure too, so nothing lands here unchecked.
 *
 * Only put output in here. Prose about behaviour ("alsoAsk answers are
 * readable downstream") is pinned by a `describe("/docs/<page>#<anchor>")`
 * block in the same test file.
 */

export const claims = {
  // /docs/gate#thresholds
  gatePassed: "Passed: p(yes) = 0.83, clearing the 0.60 bar comfortably (by 0.23).",
  gateBlockedScore: 'Blocked: the score came in at 1.40, short of the 2.50 bar easily (by 1.10), so took "otherwise".',
  gateUnderCeiling: "Passed: p(yes) = 0.04, under the 0.50 ceiling easily (by 0.46).",

  // /docs/gate#unsure: the dress code at p(yes) = 0.64
  gateUnsure: 'Too close to call: p(yes) = 0.64, 0.04 over the 0.60 bar, inside the 0.10 margin, so it took the "unsure" path.',
  // /docs/gate#unsure: goldilocks { min: 0.4, max: 0.6 } with a 0.1 margin, at p(yes) = 0.55
  gateWindowUnsure:
    'Too close to call: p(yes) = 0.55, 0.05 under the 0.60 ceiling of the 0.40–0.60 window, inside the 0.10 margin, so it took the "unsure" path.',

  // /docs/gate#halting: the bouncer at p(yes) = 0.12
  gateHalted:
    "Blocked: p(yes) = 0.12, 0.48 short of the 0.60 bar and clear of its 0.10 unsure margin easily (by 0.38), so the run stopped here.",

  // /docs/route#low-confidence: the front desk's decision (compared as JSON, so the page can align it)
  routeDecision: `{
  "kind": "route",
  "question": "decision",
  "taken": "paranormal",
  "edges": [
    { "edge": "repair",        "value": 0.02,  "taken": false },
    { "edge": "billing",       "value": 0.004, "taken": false },
    { "edge": "paranormal",    "value": 0.976, "taken": true  },
    { "edge": "lowConfidence", "value": 0.887, "taken": false }
  ],
  "metric": "probability",
  "value": 0.976,
  "confidence": 0.887,
  "lowConfidence": { "below": 0.4 },
  "summary": "Went to \\"paranormal\\" with 98%, a landslide over \\"repair\\" at 2% (confidence 0.89, 0.49 over the 0.40 low-confidence bar)."
}`,
  routeLowConfidence:
    'Jev leaned "repair" but only at 0.31 confidence, under the 0.40 bar, so it took the low-confidence path instead of guessing.',

  // /docs/route#exhaustive: a JSON triage route with a missing and an extra branch
  routeIssues: ['$ (route "triage"): no branch for "vibes"', `$ (route "triage"): branches "refunds" aren't options of the question`],

  // /docs/cascade#result: gut-check at 0.41, full-context at 0.78
  cascadeSummary: 'Escalated past "gut-check" (0.41, needed 0.70); "full-context" answered at 0.78 confidence (needed 0.50).',

  // /docs/step-and-emit#templates: emit(template) over TEMPLATE_INPUT
  templateInput: { name: "Mo", tags: ["karaoke", "chaos"], user: { plan: "pro" } },
  templates: [
    { template: "hi {{input.name}}", output: "hi Mo" },
    { template: "{{input.tags.0}} fan", output: "karaoke fan" },
    { template: "plan: {{input.user}}", output: 'plan: {"plan":"pro"}' },
    { template: "{{input.user}}", output: { plan: "pro" } },
    { template: "{{input.nope}}!", output: "!" },
  ],
  // /docs/step-and-emit#templates: what the empty hole above leaves in the span's logs
  templateEmptyLog: 'Template hole "{{input.nope}}" was empty',
  // /docs/step-and-emit#template-checks: emit("Hi {{inptu.name}}") as the first step of a chain
  templateTypo:
    '$/0 (emit "greet").value: "{{inptu.name}}" reads "inptu", which templates don\'t have; start with input, run, results, answers (did you mean "input"?)',
  // …and emit("{{results.lookup}}") before the step "lookup" runs
  templateTooEarly: '$/0 (emit "greet").value: "{{results.lookup}}" reads results of "lookup", which is at $/1 and never finishes before this node runs',

  // /docs/errors#chain-errors: a 429 at the front desk, retries off
  errorTrace: {
    run: {
      name: "NodeError",
      code: "rate_limited",
      nodeId: "front-desk",
      path: "$",
      message: 'Node "front-desk" failed: Rate limited by TypeSafe (retry after 2000ms)',
    },
    span: { name: "JevRateLimitError", code: "rate_limited", status: 429, path: "$", message: "Rate limited by TypeSafe (retry after 2000ms)" },
  },
  // /docs/errors#chain-errors: the fridge from JSON, with a "compost" option added to its question
  errorConfig: ['$ (route "fridge-verdict"): no branch for "compost"'],
} as const;

export type ClaimId = keyof typeof claims;
