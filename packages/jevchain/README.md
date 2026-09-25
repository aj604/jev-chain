# jevchain

Chains of decisions for [Jev](https://docs.typesafe.ai), TypeSafe's classification model.

Jev doesn't generate text. You give it some state and typed questions, and it answers with calibrated probabilities in tens of milliseconds. `jevchain` composes those answers into graphs: route on a choice, gate on a probability, fan out in parallel, cascade from cheap to thorough. Every run leaves a complete, serializable trace of every decision it made.

```sh
npm install jevchain
export TYPESAFE_API_KEY=...
```

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

const jev = createJev();
const { output, trace } = await jev.run(desk, "My toaster whispers my name at 3am.");
// output: "booked: one (1) exorcist"
// trace.spans[0].decision.summary:
//   'Went to "paranormal" with 98%, a landslide over "repair" at 2% (confidence 0.97).'
```

## Primitives

| Builder | What it does | Output type |
| --- | --- | --- |
| `ask(id, { questions })` | One Jev call, any number of typed questions | `{ [key]: Answer }`, with choice labels as literal unions |
| `route(id, { ask: choice(...), branches })` | Branch on a choice. Every label needs a branch, checked at compile time | union of branch outputs |
| `gate(id, { ask, pass, then, otherwise?, unsure? })` | Continue if a probability or score clears a bar. No `otherwise` means halt | union of taken paths |
| `parallel(id, { branches, join? })` | Run branches concurrently, then join | `{ [branch]: output }` or your join's result |
| `cascade(id, { tiers, fallback })` | Try cheap tiers first, escalate on low confidence, then fall back to anything (an LLM, a human) | `{ resolvedBy, tier, answer } \| { resolvedBy: "fallback", output }` |
| `step(id, fn)` | Your code: transform, fetch, call a tool | whatever `fn` returns |
| `emit(value)` | A constant or `{{input.x}}` template. Good leaves | the value |
| `chain(id, ...nodes)` | Sequence, each output feeding the next input | last node's output |

Questions are TypeSafe's three primitives: `choice(instructions, labels)`, `score(instructions, levels)`, and `noul(instructions)` (a yes/no that returns p(yes)).

### Types do the boring checking

```ts
const read = ask("read", { questions: { mood: choice("Mood?", ["cursed", "blessed"]) } });
type Mood = OutputOf<typeof read>["mood"]["choice"]; // "cursed" | "blessed"

route("r", {
  ask: choice("?", ["billing", "bug", "vibes"]),
  branches: { billing: a, bug: b }, // ✗ Property 'vibes' is missing
});

chain("c", step("n", () => 1), step("s", (x: string) => x)); // ✗ number isn't string
```

### Templates

`state` strings and `emit` values are templates: `{{input.x}}` is the node's input, `{{run.x}}` the run's input, `{{results.<id>.x}}` the output of a node that has already finished. A hole that can never fill fails before anything runs, with a `ChainConfigError` (and in `fromJSON`):

```ts
chain("c", ask("first", { questions }), ask("second", { questions, state: "{{results.frist.x}}" }));
// ✗ $/1 (ask "second").state: "{{results.frist.x}}" reads results of "frist", but no node has that id (did you mean "first"?)
```

That covers unknown roots (`{{inptu}}`) and `results.<id>` of a missing id, of an ancestor or the node itself (results are set when a node finishes), of a later step, or of a `parallel` sibling (which may not have finished). A hole that comes up empty at runtime, like `{{input.mesage}}`, renders as `""` and leaves a note on its span's `logs`, so a blank state is never a mystery.

## Running

```ts
const jev = createJev({
  apiKey,                // default: process.env.TYPESAFE_API_KEY
  model: "jev-latest",   // or pin "jev-1.13.0"
  timeoutMs: 10_000,     // per attempt
  retry: { maxRetries: 2 },  // 408/409/429/5xx/529, exponential backoff, honors retry-after
  maxConcurrency: 8,     // in-flight HTTP requests
  batch: true,           // merge same-state asks issued in the same tick into one request
});

const result = await jev.run(chain, input, { signal, timeoutMs: 5_000 });
// result.status: "ok" | "halted" | "error" | "aborted"; run() doesn't throw for runtime failures
```

### Streaming

```ts
const s = jev.stream(chain, input);
for await (const event of s) ui.apply(event); // run:start, span:start, jev:call, decision, retry, log, span:end, run:end
const { trace } = await s.result;
```

`reduceTrace(trace, event)` folds events into a trace. The runtime builds its own trace with this same function, so a live UI and the final trace always agree.

### Traces

A trace is plain JSON, with a span per node visited:

- inputs and outputs
- every Jev call: state, questions, full probability distributions, model, tokens, cost, latency, attempts, request id, batch info
- the decision, with every candidate edge and its deciding number (taken or not), the threshold, confidence, and a templated plain-English `summary`
- retries, logs, errors

Helpers: `explainTrace`, `diffTraces` (where did two runs diverge?), `graphOf` + `overlayTrace` (draw it).

### JSON

```ts
const doc = toJSON(chain, { name: "Haunted desk" });          // functions become { $ref }
const again = fromJSON(doc, { handlers: { lookup: myLookupFn } });
const code = toTypeScript(doc);                                 // back to builder code
```

## Errors

Everything extends `JevChainError` with a stable `code`: `JevAuthError`, `JevValidationError`, `JevRateLimitError` (`retryAfterMs`), `JevServerError`, `JevTimeoutError`, `JevConnectionError`, `JevAbortError`, `JevResponseError`, `ChainConfigError` (with a list of `issues`), `NodeError` (with the failing `nodeId` and its span `path`), and `CancelledError`.

When a run fails, the trace says who broke and who was just caught up in it:

- `trace.error.path` is the span where the failure started. Every errored span's `error.path` points there too, so ancestors link down to the culprit.
- When one `parallel` branch fails, its siblings are aborted and their spans close with `code: "cancelled"` (`Cancelled because "boom" failed at $/boom`), not with a copy of the sibling's error.
- A caller's abort or the run deadline stays `aborted` / `timeout` on the spans it interrupted; a halting branch still halts.

## License

MIT
