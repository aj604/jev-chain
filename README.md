<div align="center">

# jevchain

**chains of thought, minus the thought.**

A typed TypeScript framework for composing calls to [Jev](https://docs.typesafe.ai), TypeSafe's classification model, into decision graphs, plus a studio for building those graphs and watching them decide.

</div>

---

Jev doesn't write prose. You give it state and typed questions (*pick one of these*, *rate this 0–4*, *is this true?*) and it returns calibrated probabilities in tens of milliseconds. So a chain of Jev calls isn't a pipeline of prompts. It's a **graph of decisions**: each node asks something, and the answers pick the path.

JevChain is that idea taken seriously:

- **Typed end to end.** `choice("?", ["billing", "bug", "vibes"])` answers with `"billing" | "bug" | "vibes"`, not `string`. Routes must handle every label, checked at compile time. `chain(a, b)` only compiles if `a`'s output fits `b`'s input.
- **Every run leaves a trace.** It records every node visited, the questions asked, the full probability distributions, the branch taken *and the branches not taken* with the numbers that decided them, latency, tokens, cost, retries and errors. It's all plain JSON, streamed live as events.
- **Cheap by construction.** Asks against the same state in parallel branches are merged into one HTTP request automatically, since Jev reads the state once and answers every question in parallel. Cascades only escalate when confidence is low.
- **Zero runtime dependencies.** The framework is ~3k lines of commented TypeScript on top of `fetch`.
- **A studio** to run chains against the real API, watch the path light up live, click any node to see its distributions, read a plain-English "why did it go here?", compare two inputs, share a run as a link, and build chains visually with a round-trip to TypeScript.

```ts
import { createJev, route, gate, choice, noul, emit } from "jevchain";

const desk = route("front-desk", {
  ask: choice("Which team should handle this ticket?", {
    repair: "an ordinary mechanical or electrical fault",
    billing: "payments, refunds, warranties",
    paranormal: "behaviour no appliance can do",
  }),
  lowConfidence: { below: 0.4, then: emit("a human will read this. probably dave.") },
  branches: {
    repair: emit("technician booked"),
    billing: emit("forwarded to billing"),
    paranormal: gate("anyone-in-danger", {
      ask: noul("Is anyone in physical danger right now?"),
      pass: { min: 0.5 },
      then: emit("leave the house. sending a priest."),
      otherwise: emit("booked: one (1) exorcist"),
    }),
  },
});

const { output, trace } = await createJev().run(desk, "My toaster whispers my name at 3am.");
trace.spans[0].decision.summary;
// 'Went to "paranormal" with 98%, a landslide over "repair" at 2% (confidence 0.97).'
```

## Quick start

```sh
pnpm install
echo "TYPESAFE_API_KEY=..." > .env      # get one at typesafe.ai

pnpm dev                                 # studio at http://localhost:3000
pnpm example haunted-desk "my kettle is screaming in latin"   # run an example in the terminal
pnpm test                                # framework + web unit tests (live API tests run when the key is set)
```

## Repo layout

```
packages/jevchain     the framework (published as `jevchain`): zero dependencies
packages/examples     five silly chains that each teach a real composition pattern, plus a CLI
apps/web              Next.js studio, examples gallery, docs, and the API proxy
```

## Architecture

```
            ┌──────────── packages/jevchain ─────────────────────────────────────┐
 builders   │ ask route gate parallel cascade step emit chain  →  plain node objects │
            │        │                     │                                     │
            │   toJSON/fromJSON       graphOf ──► FlowGraph (DAG for drawing)     │
            │   toTypeScript               ▲                                      │
            │        │                     │ overlayTrace                         │
 runtime    │  run/stream ──► TraceEvents ─┴─► reduceTrace ──► Trace (JSON)       │
            │        │                                                           │
 client     │  JevClient: retries · timeouts · concurrency · same-tick batching  │
            └────────┼───────────────────────────────────────────────────────────┘
                     ▼
    browser ──► /api/jev (Next route: key stays server-side, per-IP rate limit, BYOK)
                     ▼
            POST https://api.typesafe.ai/v1/systemone
```

### Design decisions

**Functional builders over a fluent API.** Chains are trees of decisions, not pipelines, and a fluent `.pipe().route()` API is good at pipelines and awkward at trees (where does `.then()` attach inside a route branch?). Plain functions that return plain objects nest the way the graph does, compose with ordinary variables (`const paranormal = chain(...)` and reuse it), and let TypeScript infer types through each call. Every builder takes an `id` first because the id is what you'll see in traces, graphs and logs.

**A node is its own JSON.** A node object *is* the serialized shape plus inline functions where you wrote code. So there's no separate IR: the runtime, the serializer, the code generator, the graph compiler and the web builder all read the same objects. `toJSON` only has to swap functions for `{ "$ref": "name" }`, and `fromJSON` re-attaches them from a `handlers` map. `handlersOf(chain)` collects them, which is how the web builder can fork a coded example, edit its structure, and keep its step code running.

**Decisions pick the path; data flows through.** A `route` or `gate` doesn't consume its input. The branches receive the same input the decision saw. That keeps branches reusable and makes the graph honest: edges are control flow, not data transforms. When you do want the answers as data, use `ask` (which outputs typed answers) and a `step`.

**The trace is the product.** The runtime never builds the trace directly. It emits events and folds them with `reduceTrace`, the same pure function the UI uses. So the live animation and the final saved trace can't drift apart. Each decision records *every* candidate edge with its deciding number, so the UI can show untaken branches with the probability they lost with, not just the path taken.

**Graph compilation is separate from execution.** `graphOf` turns the tree into the DAG it actually executes as: chains laid end to end, merges after branches, parallel fork/join, cascade escalation ladders, a halt vertex for gates without an `otherwise`. `overlayTrace` paints any trace, including a half-finished one, onto it. The studio is mostly a renderer of those two functions.

**`run()` doesn't throw for runtime failures.** It returns `{ status: "ok" | "halted" | "error" | "aborted", output, trace, error }`. You almost always want the trace of a failed run, and "halted" (a gate said no) isn't an error. Invalid chains do throw (`ChainConfigError`) before any API call.

**Batching is automatic and honest about cost.** The client merges same-state asks issued in the same tick into one request (question keys are namespaced; keys aren't seen by the model), splits usage evenly across the callers, and marks each call with its batch. The trace counts `calls` and `requests` separately, so you can see what batching saved.

**Confidence is a second axis.** Choice and score answers carry Jev's own confidence. For nouls, `confidenceOf` uses distance from a coin flip. Routes can divert to `lowConfidence`, gates have an `unsure` band, and cascades escalate on it. The docs' [confidence-gated routing](https://docs.typesafe.ai/patterns/confidence-routing) pattern, as primitives.

**The API key never touches the browser.** The web app runs chains client-side (so traces stream with no server round-trips) through a thin `/api/jev` proxy that injects the server key, validates and size-limits requests, and rate-limits per IP. Users can bring their own key, which is forwarded per-request and never stored server-side.

**Share links need no backend.** A shared run is `{chain, input, trace}` deflate-compressed into the URL hash. The recipient sees the exact same trace without re-running anything.

### Framework API at a glance

| | |
|---|---|
| Questions | `choice`, `score`, `noul`, `confidenceOf` |
| Nodes | `ask`, `route`, `gate`, `parallel`, `cascade` + `tier`, `step`, `emit`, `chain` |
| Running | `createJev(options)` → `.run`, `.stream`; `run`, `stream`, `reduceTrace` |
| Traces | `explainDecision`, `explainTrace`, `diffTraces`, `graphOf`, `overlayTrace` |
| Serialization | `toJSON`, `fromJSON`, `handlersOf`, `toTypeScript` |
| Errors | `JevChainError` → `JevAuthError`, `JevValidationError`, `JevRateLimitError`, `JevServerError`, `JevTimeoutError`, `JevConnectionError`, `JevAbortError`, `JevResponseError`, `ChainConfigError`, `NodeError` |

Full reference in [`packages/jevchain/README.md`](packages/jevchain/README.md) and the docs site (`/docs`).

## The examples

Each one is silly and each one teaches a real composition pattern:

| Example | Pattern |
|---|---|
| [Haunted Appliance Support Desk](packages/examples/src/haunted-desk.ts) | intent routing + low-confidence fallback + nested decisions |
| [Group Chat Drama Triage](packages/examples/src/group-chat-drama.ts) | speculative fan-out (4 asks → 1 request) + composite scoring in code |
| [Should I Text Them Back?](packages/examples/src/text-them-back.ts) | cascade: cheap tier → full-context tier → fallback |
| [Could This Meeting Be An Email?](packages/examples/src/meeting-email.ts) | threshold gate on a score + "unsure" band |
| [Pull Request Horoscope](packages/examples/src/pr-horoscope.ts) | one multi-question ask + weighted scoring |

## Testing

- `packages/jevchain`: unit tests against a fixture `fetch` that speaks TypeSafe's wire format (retries, timeouts, batching, aborts, every node kind, serialization, codegen, graph overlay), **type-level tests** for inference and exhaustiveness (`@ts-expect-error` for the things that must not compile), and live tests against the real API that run when `TYPESAFE_API_KEY` is set.
- `apps/web`: unit tests for the proxy's validation and rate limiter, hotkeys, share-link encoding, graph layout and builder edit operations.
- CI runs typecheck, tests, lint and builds for every package.

## What I'd build next

1. **Calibration dashboard.** Log traces, attach ground-truth labels later, and plot reliability curves per decision node, so you can tune `minConfidence` and thresholds from data instead of vibes.
2. **Trace-driven regression tests.** `expectTrace(chain, input).toTake("paranormal")` plus snapshot diffs of decisions across model versions (`jev-latest` moves; pinned ids don't).
3. **Durable, shared runs.** Store traces server-side (Postgres + short ids) for permanent share links, team history, and search over decisions. The URL-hash links are great until the trace is huge.
4. **LLM leaves as first-class nodes.** A `generate()` node for cascades that bottom out in an LLM, with the prompt and completion in the trace, so the cost comparison between "Jev decided" and "we had to ask the big model" is right there.
5. **Distributed rate limiting** for the proxy (Upstash/Redis), since the in-memory limiter is per instance.
6. **Chain-level caching + `explain` diffs**: cache answers by (model, state, question) and show "what would have changed" when you edit a question in the builder.
7. **Publish `jevchain` to npm** with a changelog, and ship the builder's JSON format as a JSON Schema.

## License

MIT. Jev and TypeSafe are TypeSafe AI's; this is an independent project built on their public API.
