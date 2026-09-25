/**
 * The landing hero is a real trace of the chain the landing page prints.
 *
 * - The `TRIAGE` code block on `app/page.tsx`, evaluated as written, builds the
 *   same chain the hero runs (compared as `toJSON`), so the code and the trace
 *   beside it can't drift apart.
 * - The hero renders the run it's given: every question, distribution, summary
 *   and branch not taken comes out of the trace. Rendering a different run of
 *   the same chain shows that run instead, so nothing in it is hand-typed.
 */
import fs from "node:fs";
import path from "node:path";
import * as jevchain from "jevchain";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { scriptedClient } from "@/docs/fixtures";
import { SampleTrace } from "./sample-trace";
import { landingTrace, triage, TRIAGE_INPUT } from "./triage";

const PAGE = path.resolve(import.meta.dirname, "../../app/page.tsx");

/** The `TRIAGE` template literal from the landing page, exactly as the page shows it. */
function pageTriageSource(): string {
  const src = ts.createSourceFile(PAGE, fs.readFileSync(PAGE, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  for (const s of src.statements) {
    if (!ts.isVariableStatement(s)) continue;
    for (const d of s.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.name.text === "TRIAGE" && d.initializer && ts.isNoSubstitutionTemplateLiteral(d.initializer)) {
        return d.initializer.text;
      }
    }
  }
  throw new Error("no TRIAGE template literal in app/page.tsx");
}

/** Run the page's sample as a module that imports jevchain, and return its `triage`. */
function evaluate(code: string): jevchain.AnyNode {
  const js = ts.transpileModule(`${code}\nexport { triage };`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod: { exports: Record<string, unknown> } = { exports: {} };
  const require = (id: string) => {
    if (id !== "jevchain") throw new Error(`the landing sample imports "${id}"`);
    return jevchain;
  };
  new Function("module", "exports", "require", js)(mod, mod.exports, require);
  return mod.exports.triage as jevchain.AnyNode;
}

/** Visible text of the hero, tags stripped and entities decoded. */
function textOf(trace: jevchain.Trace): string {
  const html = renderToStaticMarkup(createElement(SampleTrace, { trace, chain: triage }));
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");
}

describe("the landing hero trace", () => {
  it("runs the chain the landing page prints", () => {
    expect(jevchain.toJSON(evaluate(pageTriageSource()))).toEqual(jevchain.toJSON(triage));
  });

  it("shows what the run recorded", async () => {
    const trace = await landingTrace();
    const text = textOf(trace);
    expect(trace.status).toBe("ok");
    expect(text).toContain(trace.runId);
    expect(text).toContain(TRIAGE_INPUT);
    for (const s of trace.spans) {
      expect(text).toContain(s.nodeId);
      for (const c of s.calls) {
        for (const q of Object.values(c.questions)) expect(text).toContain(`“${String(q.instructions)}” · ${q.type}`);
      }
      if (s.decision?.metric === "probability") {
        for (const e of s.decision.edges) expect(text).toMatch(new RegExp(`${e.edge} +${e.value!.toFixed(2)}`));
      }
      if (s.decision) expect(text).toContain(s.decision.summary);
    }
    expect(text).toContain(`${Math.round(trace.durationMs!)}ms · ${trace.usage.calls} calls`);
    // The nodes it never reached, by path.
    expect(text).toMatch(/not taken: billing · bug\/otherwise · vibes/);
  });

  it("shows a different run differently", async () => {
    const hero = await landingTrace();
    const other = (
      await jevchain
        .createJev(scriptedClient({ "What is this message about?": { billing: 0.2, bug: 0.75, vibes: 0.05 }, "Is the user blocked right now?": 0.3 }))
        .run(triage, "the export button is a bit slow", { runId: "run_other" })
    ).trace;
    const text = textOf(other);
    for (const s of other.spans) if (s.decision) expect(text).toContain(s.decision.summary);
    for (const s of hero.spans) if (s.decision) expect(text).not.toContain(s.decision.summary);
    expect(text).toContain("run_other");
    expect(text).toMatch(/not taken: billing · bug\/then · vibes/);
  });
});
