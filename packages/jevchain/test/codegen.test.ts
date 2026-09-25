/**
 * Generated code is held to what it promises: it type-checks, and running it
 * rebuilds the document it was generated from.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import ts from "typescript";
import { afterAll, describe, expect, it } from "vitest";
import { examples } from "../../examples/src/index";
import {
  ask,
  cascade,
  chain,
  choice,
  describe as titled,
  emit,
  gate,
  noul,
  parallel,
  route,
  score,
  step,
  tier,
  toJSON,
  toTypeScript,
  type AnyNode,
  type ChainDocument,
} from "../src/index.js";

const SRC = resolve(__dirname, "../src/index");
const dir = mkdtempSync(join(tmpdir(), "jevchain-codegen-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Write each document's generated code to disk: name -> file. */
function generate(docs: Record<string, ChainDocument>): Record<string, string> {
  const files: Record<string, string> = {};
  for (const [name, doc] of Object.entries(docs)) {
    const file = join(dir, `${name}.ts`);
    writeFileSync(file, toTypeScript(doc, { importFrom: SRC }));
    files[name] = file;
  }
  return files;
}

/** Type-check files with the package's own compiler settings. */
function typeErrors(files: string[]): string[] {
  const config = ts.readConfigFile(resolve(__dirname, "../tsconfig.json"), ts.sys.readFile).config;
  const { options } = ts.parseJsonConfigFileContent(config, ts.sys, resolve(__dirname, ".."));
  const program = ts.createProgram(files, { ...options, noEmit: true });
  return ts
    .getPreEmitDiagnostics(program)
    .filter((d) => d.file && files.includes(resolve(d.file.fileName)))
    .map((d) => `${d.file!.fileName.split("/").pop()}: ${ts.flattenDiagnosticMessageText(d.messageText, "\n")}`);
}

/** Run a generated module and serialize what it exports. */
async function rebuild(file: string, doc: ChainDocument): Promise<ChainDocument> {
  const mod = (await import(file)) as Record<string, AnyNode>;
  const exported = Object.values(mod);
  expect(exported).toHaveLength(1);
  return toJSON(exported[0]!, { ...(doc.name ? { name: doc.name } : {}), ...(doc.description ? { description: doc.description } : {}) });
}

const inc = (id: string) => step(id, (n: number) => n + 1);

/** Every field a node can carry, in a chain longer than chain()'s typed overloads used to go. */
const kitchenSink = titled(
  chain(
    "kitchen-sink",
    step("parse", (s: string) => s.length, { title: "Parse it", description: "Count the characters.", timeoutMs: 500, retries: 0, ref: "parser" }),
    inc("a"),
    inc("b"),
    inc("c"),
    inc("d"),
    step("text", (n: number) => ({ text: String(n) })),
    ask("read", { questions: { heat: score("How heated?", ["chill", "tense"]) }, state: "{{input.text}}", model: "jev-1.13.0", title: "Read the room", description: "One call." }),
    route("triage", {
      ask: choice("What now?", { escalate: "a human should see this", "not now": null }),
      alsoAsk: { spam: noul("Spam?", { true: "junk", false: "real" }) },
      state: (x: unknown) => JSON.stringify(x),
      title: "Triage",
      description: "Pick a road.",
      lowConfidence: { below: 0.6, then: emit("unsure", { id: "shrug", title: "Shrug", description: "Nobody knows." }) },
      branches: {
        escalate: gate("sure", {
          ask: choice("Really?", ["yes", "no"]),
          pass: { label: "yes", min: 0.4, max: 0.9 },
          then: emit({ action: "escalate" }, { title: "Escalate" }),
          otherwise: emit({ action: "drop" }, { id: "drop" }),
          unsure: { minConfidence: 0.3, then: emit({ action: "ask" }, { id: "ask-again" }) },
          alsoAsk: { rude: noul("Rude?") },
          title: "Are we sure?",
        }),
        "not now": parallel("fan", {
          branches: {
            quick: cascade("double-check", {
              tiers: [
                tier("gut", { ask: noul("Safe to ignore?"), minConfidence: 0.8, title: "Gut check", model: "jev-1.13.0" }),
                tier("deep", { ask: noul("Considering everything, safe?"), minConfidence: 0.5, state: (x: unknown) => String(x) }),
              ],
              fallback: step("human", (_: unknown) => "queued", { title: "Ask a human" }),
              title: "Double check",
            }),
            loud: emit("{{input}}!", { id: "loud" }),
          },
          join: (r) => r,
          title: "Fan out",
          description: "Both at once.",
        }),
      },
    }),
  ),
  { title: "Everything, once", description: "Covers every field codegen has to carry." },
);

describe("toTypeScript output", () => {
  it("type-checks and rebuilds the document, for every example and a chain with every field", async () => {
    const docs: Record<string, ChainDocument> = {
      "kitchen-sink": toJSON(kitchenSink, { name: "Kitchen sink", description: "Comments can't end early: */ still inside." }),
    };
    for (const e of examples) docs[e.slug] = toJSON(e.chain, { name: e.title });
    const files = generate(docs);

    expect(typeErrors(Object.values(files))).toEqual([]);
    for (const [name, file] of Object.entries(files)) {
      const doc = docs[name]!;
      expect(await rebuild(file, doc), name).toEqual(doc);
    }
  }, 60_000);

  it("keeps generated code valid for awkward names and half-built documents", () => {
    const root = gate("gate", { ask: noul("Go?"), pass: { min: 0.5 }, then: emit(1), unsure: { then: emit(2) } });
    const doc = toJSON(root);
    const files = generate({ awkward: { ...doc, description: "line one\nline two */ not code" } });
    const code = toTypeScript(doc);
    expect(code).toContain("export const gateChain = gate(");
    expect(code).toContain("unsure: { then: emit(2) }");
    expect(typeErrors(Object.values(files))).toEqual([]);
  }, 60_000);
});
