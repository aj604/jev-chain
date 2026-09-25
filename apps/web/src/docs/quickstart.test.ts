/**
 * The quickstart, run the way it tells a newcomer to run it.
 *
 * `samples.test.ts` proves the quickstart compiles. This proves it *runs*:
 * the test reads the quickstart's steps off `/docs` in order, replays them in
 * an empty directory, and runs the file with a real `node` process.
 *
 * - `pnpm add jevchain` installs this repo's jevchain (compiled to plain
 *   JavaScript, the way the published package ships), and creates a
 *   package.json if there isn't one, as pnpm does;
 * - `pnpm pkg set type=module` sets that field;
 * - `export NAME=value` goes into the environment;
 * - a sample is written to the file name the page shows;
 * - `node <file>.ts` runs it.
 *
 * A step the test can't replay fails, so the page can't grow an instruction
 * nobody has tried. Only the network is faked: Jev answers every question
 * with the matching answer from the page's own "jev answers" panel, and the
 * request has to reach the real endpoint with the key from the key step.
 *
 * Then the run has to be clean: exit 0, nothing on stderr (Node's notice that
 * type stripping is experimental aside), and stdout exactly the lines the
 * sample's comments say each `console.log` prints.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import ts from "typescript";
import { afterAll, describe, expect, it } from "vitest";

const WEB = path.resolve(import.meta.dirname, "../..");
const PAGE = path.join(WEB, "src/app/docs/page.tsx");
const JEVCHAIN = path.resolve(WEB, "../../packages/jevchain");
const ENDPOINT = "https://api.typesafe.ai/v1/systemone";

// ---------------------------------------------------------------------------
// Reading the steps off the page
// ---------------------------------------------------------------------------

type Instruction = { shell: string } | { file: string; code: string };

interface Quickstart {
  steps: Instruction[];
  /** The page's "jev answers" panel, parsed. */
  answers: Record<string, { type: string; choice?: string; probabilities?: Record<string, number> }>;
}

function literal(node: ts.Expression | undefined): string | undefined {
  if (node && (ts.isNoSubstitutionTemplateLiteral(node) || ts.isStringLiteral(node))) return node.text;
  return undefined;
}

function readQuickstart(): Quickstart {
  const src = ts.createSourceFile(PAGE, fs.readFileSync(PAGE, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const consts = new Map<string, string>();
  for (const s of src.statements) {
    if (!ts.isVariableStatement(s)) continue;
    for (const d of s.declarationList.declarations) {
      const text = ts.isIdentifier(d.name) ? literal(d.initializer) : undefined;
      if (text !== undefined) consts.set((d.name as ts.Identifier).text, text);
    }
  }
  const attr = (el: ts.JsxSelfClosingElement, name: string): string | undefined => {
    for (const a of el.attributes.properties) {
      if (!ts.isJsxAttribute(a) || a.name.getText() !== name || !a.initializer) continue;
      if (ts.isStringLiteral(a.initializer)) return a.initializer.text;
      const e = ts.isJsxExpression(a.initializer) ? a.initializer.expression : undefined;
      if (e && ts.isIdentifier(e)) return consts.get(e.text);
      return literal(e);
    }
    return undefined;
  };

  // The one <Steps> on the page is the quickstart; collect its shell commands and files in reading order.
  const steps: Instruction[] = [];
  let found = 0;
  const collect = (n: ts.Node) => {
    if (ts.isJsxSelfClosingElement(n)) {
      const tag = n.tagName.getText();
      if (tag === "Shell") steps.push({ shell: attr(n, "cmd") ?? "<unreadable>" });
      if (tag === "Snippet") steps.push({ file: attr(n, "file") ?? "<no file>", code: attr(n, "code") ?? "<unreadable>" });
    }
    ts.forEachChild(n, collect);
  };
  const visit = (n: ts.Node) => {
    if (ts.isJsxElement(n) && n.openingElement.tagName.getText() === "Steps") {
      found++;
      collect(n);
    } else ts.forEachChild(n, visit);
  };
  visit(src);
  expect(found, "/docs should have exactly one <Steps>: the quickstart").toBe(1);

  const answers = consts.get("ANSWER");
  expect(answers, "/docs should show Jev's answer in an ANSWER constant").toBeDefined();
  return { steps, answers: JSON.parse(answers!) };
}

/** What each `console.log` in a sample says it prints: a comment on its line, or the comment lines right under it. */
function printedLines(code: string): string[] {
  const lines = code.split("\n");
  const out: string[] = [];
  lines.forEach((line, i) => {
    if (!line.includes("console.log(")) return;
    const same = /\)\s*;?\s*\/\/ ?(.*)$/.exec(line);
    const below: string[] = [];
    for (let j = i + 1; j < lines.length && /^\s*\/\//.test(lines[j]!); j++) below.push(lines[j]!.replace(/^\s*\/\/ ?/, ""));
    const said = same ? [same[1]!] : below;
    expect(said.length, `"${line.trim()}" doesn't say what it prints`).toBeGreaterThan(0);
    out.push(...said);
  });
  return out;
}

// ---------------------------------------------------------------------------
// Replaying them
// ---------------------------------------------------------------------------

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "jevchain-quickstart-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** jevchain's source as plain ES modules: what `pnpm add jevchain` puts in node_modules. */
function installJevchain(project: string) {
  const pkg = JSON.parse(fs.readFileSync(path.join(JEVCHAIN, "package.json"), "utf8")) as { name: string; version: string };
  const dest = path.join(project, "node_modules", pkg.name);
  fs.mkdirSync(dest, { recursive: true });
  for (const f of fs.readdirSync(path.join(JEVCHAIN, "src"))) {
    if (!f.endsWith(".ts")) continue;
    const js = ts
      .transpileModule(fs.readFileSync(path.join(JEVCHAIN, "src", f), "utf8"), {
        fileName: f,
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, verbatimModuleSyntax: true },
      })
      .outputText.replace(/(from\s*["'])(\.\.?\/[^"']+)(["'])/g, "$1$2.js$3");
    fs.writeFileSync(path.join(dest, f.replace(/\.ts$/, ".js")), js);
  }
  fs.writeFileSync(path.join(dest, "package.json"), JSON.stringify({ name: pkg.name, version: pkg.version, type: "module", exports: "./index.js" }));
  return pkg;
}

/** Stands in for the network: answers from the page's panel, and logs every request. */
const FAKE_JEV = `import fs from "node:fs";
const answers = Object.values(JSON.parse(process.env.QUICKSTART_ANSWERS));
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body);
  fs.appendFileSync(process.env.QUICKSTART_LOG, JSON.stringify({ url: String(url), authorization: new Headers(init.headers).get("authorization"), body }) + "\\n");
  const out = {};
  for (const [key, q] of Object.entries(body.questions)) {
    const labels = q.type === "choice" ? (Array.isArray(q.criteria) ? q.criteria : Object.keys(q.criteria)) : [];
    const a = answers.find((a) => a.type === q.type && (q.type !== "choice" || labels.includes(a.choice)));
    if (!a) return new Response(JSON.stringify({ error: { type: "invalid_request", message: "the page shows no answer for " + key } }), { status: 400 });
    out[key] = a;
  }
  return new Response(JSON.stringify({ model: "jev-1.13.0", answers: out, usage: { input_tokens: 24, output_tokens: 0 } }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
};
`;

interface Replay {
  project: string;
  runs: { file: string; status: number | null; stdout: string; stderr: string }[];
  requests: { url: string; authorization: string | null; body: { state: unknown; questions: Record<string, unknown> } }[];
  env: Record<string, string>;
}

function replay(q: Quickstart): Replay {
  const project = path.join(tmp, "my-app");
  fs.mkdirSync(project);
  const fake = path.join(tmp, "fake-jev.mjs");
  const log = path.join(tmp, "requests.jsonl");
  fs.writeFileSync(fake, FAKE_JEV);
  fs.writeFileSync(log, "");

  const pkgFile = path.join(project, "package.json");
  const readPkg = () => (fs.existsSync(pkgFile) ? (JSON.parse(fs.readFileSync(pkgFile, "utf8")) as Record<string, unknown>) : {});
  const writePkg = (p: Record<string, unknown>) => fs.writeFileSync(pkgFile, JSON.stringify(p, null, 2));

  // The newcomer's shell: no key unless a step exports one.
  const env: Record<string, string> = { PATH: process.env.PATH ?? "" };
  const runs: Replay["runs"] = [];

  for (const step of q.steps) {
    if ("file" in step) {
      fs.writeFileSync(path.join(project, step.file), step.code.trim() + "\n");
      continue;
    }
    const cmd = step.shell;
    let m: RegExpExecArray | null;
    if ((m = /^pnpm add (\S+)$/.exec(cmd))) {
      const pkg = installJevchain(project);
      expect(m[1], "the quickstart installs a package that isn't jevchain").toBe(pkg.name);
      const p = readPkg();
      writePkg({ ...p, dependencies: { ...(p.dependencies as object), [pkg.name]: `^${pkg.version}` } });
    } else if ((m = /^pnpm pkg set (\w+)=(\S+)$/.exec(cmd))) {
      writePkg({ ...readPkg(), [m[1]!]: m[2]! });
    } else if ((m = /^export (\w+)=(\S+)$/.exec(cmd))) {
      env[m[1]!] = m[2]!;
    } else if ((m = /^node (\S+\.ts)$/.exec(cmd))) {
      const r = spawnSync(process.execPath, ["--import", pathToFileURL(fake).href, m[1]!], {
        cwd: project,
        // Only what the steps set, plus PATH: nothing from this test's own environment leaks in.
        env: { ...env, QUICKSTART_ANSWERS: JSON.stringify(q.answers), QUICKSTART_LOG: log } as Partial<NodeJS.ProcessEnv> as NodeJS.ProcessEnv,
        encoding: "utf8",
        timeout: 15_000,
      });
      runs.push({ file: m[1]!, status: r.status, stdout: r.stdout, stderr: r.stderr });
    } else {
      throw new Error(`the quickstart says to run \`${cmd}\`, which quickstart.test.ts doesn't know how to replay: teach it, or change the step`);
    }
  }

  const requests = fs
    .readFileSync(log, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Replay["requests"][number]);
  return { project, runs, requests, env };
}

/** Node's own notice that it ran TypeScript, which isn't the sample's doing. */
const NODE_NOTICE = [/ExperimentalWarning: Type Stripping is an experimental feature/, /^\(Use `node --trace-warnings/];

// ---------------------------------------------------------------------------

describe("/docs#quickstart", () => {
  const q = readQuickstart();
  const r = replay(q);
  const samples = q.steps.filter((s): s is { file: string; code: string } => "file" in s);

  it("says how to run what it has you write", () => {
    expect(r.runs.map((run) => run.file), "every file the quickstart has you write needs a step that runs it").toEqual(samples.map((s) => s.file));
  });

  it("runs clean, on this Node", () => {
    const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
    expect(major > 22 || (major === 22 && minor >= 18), `node ${process.versions.node} can't run .ts files; the page asks for 22.18+`).toBe(true);
    for (const run of r.runs) {
      const noise = run.stderr
        .split("\n")
        .filter((l) => l.trim() && !NODE_NOTICE.some((n) => n.test(l)))
        .join("\n");
      expect(noise, `node ${run.file} wrote to stderr`).toBe("");
      expect(run.status, `node ${run.file} exited ${run.status}`).toBe(0);
    }
  });

  it("prints exactly what its comments say", () => {
    for (const [i, run] of r.runs.entries()) {
      expect(run.stdout.trimEnd().split("\n")).toEqual(printedLines(samples[i]!.code));
    }
  });

  it("calls the real endpoint once, with the key from the key step", () => {
    expect(r.requests).toHaveLength(1);
    const [req] = r.requests;
    expect(req!.url).toBe(ENDPOINT);
    expect(r.env.TYPESAFE_API_KEY, "the key step should export TYPESAFE_API_KEY, which createJev() reads").toBeDefined();
    expect(req!.authorization).toBe(`Bearer ${r.env.TYPESAFE_API_KEY}`);
  });
});
