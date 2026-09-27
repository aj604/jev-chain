import { validateRecipe, type RecipeCheck } from "@/lib/recipe/validate";
import { CAPS, type Recipe } from "@/lib/recipe/types";
import { SYSTEM_PROMPT } from "./prompt";

/**
 * The visitor's text, in characters. `decompose` sends whatever it is given;
 * the endpoint checks the length first.
 */
export const MIN_THING = 2;
export const MAX_THING = CAPS.input;

export const DEFAULT_LLM_BASE_URL = "https://openrouter.ai/api/v1";

/** The first request's budget. */
export const FIRST_ATTEMPT_MS = 20_000;
/** The whole call's budget, retry included. The retry gets what is left. */
export const TOTAL_MS = 30_000;

/** Any OpenAI-compatible chat completions endpoint. */
export interface LlmConfig {
  /** No trailing slash. `/chat/completions` is appended. */
  baseUrl: string;
  apiKey: string;
  /** Deliberately unpinned: whatever `LLM_MODEL` names. */
  model: string;
  /** For tests. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /** The caller's. Aborting it stops the call with reason `upstream`. */
  signal?: AbortSignal;
  /** Defaults to `FIRST_ATTEMPT_MS`. Options so tests can shrink them. */
  firstAttemptMs?: number;
  /** Defaults to `TOTAL_MS`. */
  totalMs?: number;
}

/**
 * The decomposer's config from `LLM_BASE_URL`, `LLM_API_KEY` and `LLM_MODEL`,
 * or null when the key or the model is empty after trimming. The base URL
 * defaults to `DEFAULT_LLM_BASE_URL` and loses its trailing slashes.
 */
export function llmConfigFromEnv(env: Record<string, string | undefined> = process.env): LlmConfig | null {
  const apiKey = env.LLM_API_KEY?.trim() ?? "";
  const model = env.LLM_MODEL?.trim() ?? "";
  if (!apiKey || !model) return null;
  const baseUrl = env.LLM_BASE_URL?.trim().replace(/\/+$/, "") || DEFAULT_LLM_BASE_URL;
  return { baseUrl, apiKey, model };
}

/**
 * Reads a recipe out of a model's reply. JSON mode is requested but not relied
 * on, so this takes the outermost object, from the first `{` to the last `}`,
 * which gets past code fences and prose around it. A `}` in prose after the
 * object is inside that span, so it reads as invalid JSON and the retry asks
 * for JSON only.
 */
export function parseRecipeText(text: string): RecipeCheck {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end < start) return { ok: false, message: "recipe: the reply has no JSON object in it" };
  let raw: unknown;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return { ok: false, message: "recipe: the reply is not valid JSON" };
  }
  return validateRecipe(raw);
}

export type DecomposeResult =
  | { ok: true; recipe: Recipe }
  | { ok: false; reason: "invalid" | "upstream"; message: string };

/**
 * Asks the model for a recipe for `thing`. An invalid reply gets one retry
 * that carries the validator's message. Two invalid replies give `invalid`
 * with the last message. A bad status, a network error, a reply with no
 * content, running out of time or the caller's abort give `upstream`.
 *
 * Never throws, and never logs the thing, the prompt or the reply.
 */
export async function decompose(thing: string, config: LlmConfig): Promise<DecomposeResult> {
  try {
    return await run(thing, config);
  } catch {
    // Nothing in `run` should throw. This keeps the promise from rejecting if it does.
    return upstream("llm: the call failed");
  }
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

type Upstream = { ok: false; reason: "upstream"; message: string };
type Reply = { ok: true; content: string } | Upstream;

const upstream = (message: string): Upstream => ({ ok: false, reason: "upstream", message });

async function run(thing: string, config: LlmConfig): Promise<DecomposeResult> {
  const deadline = Date.now() + (config.totalMs ?? TOTAL_MS);
  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: thing },
  ];

  const first = await ask(config, messages, Math.min(config.firstAttemptMs ?? FIRST_ATTEMPT_MS, deadline - Date.now()));
  if (!first.ok) return first;
  const firstCheck = parseRecipeText(first.content);
  if (firstCheck.ok) return firstCheck;

  messages.push(
    { role: "assistant", content: first.content },
    { role: "user", content: retryMessage(firstCheck.message) },
  );
  const second = await ask(config, messages, deadline - Date.now());
  if (!second.ok) return second;
  const secondCheck = parseRecipeText(second.content);
  if (secondCheck.ok) return secondCheck;
  return { ok: false, reason: "invalid", message: secondCheck.message };
}

/** Carries the validator's message verbatim. */
const retryMessage = (problem: string) =>
  `That recipe does not pass the check. The check says: ${problem}\n` +
  "Fix it and send the whole corrected recipe. Reply with the JSON object only.";

/**
 * One request with `ms` to answer, body included. The request is raced
 * against the abort, so a fetch that ignores its signal is cut off too.
 */
async function ask(config: LlmConfig, messages: ChatMessage[], ms: number): Promise<Reply> {
  const caller = config.signal;
  if (caller?.aborted) return upstream("llm: stopped by the caller");
  if (ms <= 0) return upstream("llm: took too long");

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, ms);
  const onCallerAbort = () => controller.abort();
  caller?.addEventListener("abort", onCallerAbort, { once: true });
  const aborted = new Promise<never>((_, reject) => {
    controller.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
  });

  try {
    return await Promise.race([request(config, messages, controller.signal), aborted]);
  } catch {
    if (caller?.aborted) return upstream("llm: stopped by the caller");
    if (timedOut) return upstream("llm: took too long");
    return upstream("llm: could not be reached");
  } finally {
    clearTimeout(timer);
    caller?.removeEventListener("abort", onCallerAbort);
  }
}

async function request(config: LlmConfig, messages: ChatMessage[], signal: AbortSignal): Promise<Reply> {
  const fetchFn = config.fetch ?? fetch;
  const res = await fetchFn(`${config.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${config.apiKey}`,
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      model: config.model,
      messages,
      temperature: 0.7,
      response_format: { type: "json_object" },
    }),
    signal,
    cache: "no-store",
  });
  if (!res.ok) return upstream(`llm: answered ${res.status}`);

  let body: unknown;
  try {
    body = await res.json();
  } catch {
    return upstream("llm: the reply has no content");
  }
  const content = contentOf(body);
  // An empty reply is an upstream failure, not a recipe to correct: some
  // providers refuse an empty assistant message in the retry.
  if (typeof content !== "string" || !content.trim()) return upstream("llm: the reply has no content");
  return { ok: true, content };
}

/** `choices[0].message.content`, if the body has that shape. */
function contentOf(body: unknown): unknown {
  if (typeof body !== "object" || body === null) return undefined;
  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return undefined;
  const first: unknown = choices[0];
  if (typeof first !== "object" || first === null) return undefined;
  const message = (first as { message?: unknown }).message;
  if (typeof message !== "object" || message === null) return undefined;
  return (message as { content?: unknown }).content;
}
