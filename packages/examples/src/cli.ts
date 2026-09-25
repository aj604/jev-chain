/**
 * Run an example from the terminal:
 *   pnpm --filter jevchain-examples start haunted-desk "my kettle is screaming in latin"
 */
import { createJev, explainTrace } from "jevchain";
import { examples, getExample } from "./index";

const [slug, ...rest] = process.argv.slice(2);
const ex = slug ? getExample(slug) : undefined;
if (!ex) {
  console.log(`usage: start <example> [input]\n\nexamples:\n${examples.map((e) => `  ${e.slug.padEnd(18)} ${e.tagline}`).join("\n")}`);
  process.exit(slug ? 1 : 0);
}
const raw = rest.join(" ");
const input = raw ? (raw.trim().startsWith("{") ? JSON.parse(raw) : raw) : ex.inputs[0]!.value;

const jev = createJev();
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const pink = (s: string) => `\x1b[38;5;205m${s}\x1b[0m`;

const s = jev.stream(ex.chain, input);
for await (const e of s) {
  if (e.type === "span:start") console.log(dim(`${"  ".repeat(e.span.path.split("/").length - 1)}→ ${e.span.nodeId}`));
  if (e.type === "decision") console.log(pink(`  ${e.decision.summary}`));
}
const r = await s.result;
console.log();
for (const line of explainTrace(r.trace)) console.log(dim(`· ${line}`));
console.log(`\n${r.status === "ok" ? JSON.stringify(r.output, null, 2) : `${r.status}: ${r.error?.message ?? r.trace.halted?.summary}`}`);
console.log(dim(`\n${r.trace.usage.requests} request(s), ${r.trace.usage.inputTokens} tokens, $${r.trace.usage.costUsd.toFixed(6)}, ${Math.round(r.trace.durationMs ?? 0)}ms`));
