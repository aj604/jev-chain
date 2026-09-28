# Will it jev?

**Every computer is AND gates. Every decision is jev gates.**

Paste anything and Jev routes it through a small, serious bureaucracy: a desk of yes/no gates, routes and ratings that ends at one specific outcome ("Couch placed in escrow"). The desk is drawn with the studio's own trace graph, the run lights its path live against [Jev](https://docs.typesafe.ai), and the why panel and inspector show every decision with its real numbers. A run that reaches an outcome is stamped *It jevs.*: the text became gates and Jev decided every one. Every run can be shared as a link that replays it, with nothing stored on the server.

## Run it

```bash
pnpm install
pnpm --filter will-it-jev dev     # http://localhost:3001
# or, from the repo root:
pnpm will-it-jev
```

The curated examples need only `TYPESAFE_API_KEY`. Free text also needs `LLM_API_KEY` and `LLM_MODEL`; without them the page says free-form jevving is off and the examples still work.

## Test it

```bash
pnpm --filter will-it-jev test        # vitest: no network, Jev and the LLM are faked
pnpm --filter will-it-jev typecheck
pnpm --filter will-it-jev lint
pnpm --filter will-it-jev build
```

## Environment

Like the studio, the app reads the repo-root `.env` (and `.env.local`, `.env.development` and so on, with Next's precedence). Real environment variables and `apps/will-it-jev/.env*` files win over it.

| Variable | Default | What it does |
|---|---|---|
| `TYPESAFE_API_KEY` | none | The Jev key. Used only by the `/api/jev` proxy, server-side. Without it every run fails with "This server has no TYPESAFE_API_KEY". |
| `LLM_API_KEY` | none | The decomposer's key. Free text is off unless this and `LLM_MODEL` are both set. |
| `LLM_MODEL` | none | The decomposer's model id, as the provider names it. |
| `LLM_BASE_URL` | `https://openrouter.ai/api/v1` | Any OpenAI-compatible chat completions endpoint. `/chat/completions` is appended. |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3001` | The site's absolute origin, for share previews and their images. Set it in production. |
| `NEXT_PUBLIC_STUDIO_URL` | `https://jev-chain.com` | Where "Open in the studio" goes. The link is `<this>/studio/share#<run>`. |
| `PAUSED` | unset | Any non-empty value stops both `/api/jev` and `/api/decompose` with a 503 before they reach a provider. |

The two `NEXT_PUBLIC_` values are built into the browser bundle, so they never hold a secret.

## How it works

- **Recipe (a desk).** Every jevvable thing is a recipe (`src/lib/recipe/types.ts`, `v: 2`): a small JSON decision tree of gates (yes/no, with optional descriptions of what each answer means), routes (pick one label) and leaves. A leaf is an outcome (`{ key, stamp, line }`) or a rating of a few weighted questions whose score picks one of its outcome bands. Gates can have an `unsure` branch and routes a `lowConfidence` one, for when Jev can't call it. There is no pass or fail. Curated recipes, model output and share links all use this one shape.
- **Compiler.** `compileRecipe` turns a recipe into a plain jevchain chain: a gate is a `gate` asking a noul, a route is a `route` asking a choice, a rating is one ask, an outcome emits itself. The browser runs it through the same-origin `/api/jev` proxy, which adds the key and forwards only requests a compiled recipe could make. The result (outcome, score, stats) is worked out afterwards from the recipe and the trace.
- **The runner.** The page draws the compiled chain with `jevchain-trace-ui` (`packages/trace-ui`), the studio's graph, why panel and inspector, shared by both apps. Spans are paced out one step at a time so a half-second run can be followed.
- **Curated desks.** Eleven hand-written desks in `src/recipes`, each with sample inputs that land on different outcomes. They run without the decomposer and pass the same validator as model output.
- **Decomposer.** Free text goes to `/api/decompose`, which asks the configured LLM for a recipe. An invalid reply gets one retry carrying the validator's message.
- **Validation, including tone.** `validateRecipe` checks every untrusted recipe: shape, sizes, depth, unique keys, and the site's flat tone (no exclamation marks, no emoji, no "lol").
- **Share links.** `/v?g=2&d=2&r=breakup-text&o=couch-escrow#<run>`. The hash holds the whole run: the recipe, the input (cut to 500 characters) and a slimmed trace, deflate-compressed, up to 64 KB. The query holds only the counts and, for a curated desk, its slug and outcome key, for link previews, never any text. The verdict page decodes and checks the hash in the browser, recomputes the result from it, and makes no requests. Nothing is stored.

## Running it in public

The rate limits in `/api/jev` and `/api/decompose` are in memory and per server instance. They keep one tab from hogging a key; they are not a budget. Set spend caps on the TypeSafe key and on the LLM key with their providers, and set `PAUSED` to stop spending without a redeploy.

## Privacy

Free text is sent to the configured LLM provider to be broken down into a recipe, and then to Jev as the state it is judged on. The site never logs or stores it. A share link carries the input in its hash, which browsers do not send to the server.
