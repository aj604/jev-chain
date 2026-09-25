/**
 * Every TypeScript sample on the site, compiled against jevchain.
 *
 * The test reads the pages themselves (the landing page and every docs page),
 * finds each sample they render as TypeScript, and typechecks it exactly as
 * printed, with only what `samples.ts` says it leans on in scope. Then:
 *
 * - a plain sample must compile clean;
 * - a line marked `✗` must fail, and only those lines may (a 'quoted' part of
 *   the ✗ comment must appear in the compiler's message);
 * - a `CompileError` must fail on its underlined line with the message it prints;
 * - `type X = …; // T` must really be T;
 * - a sample quoted from jevchain's source must still be in that source.
 *
 * A sample the test can't read, a block that reads as TypeScript (imports
 * from jevchain or calls a builder) but isn't marked as TypeScript, or a
 * context in `samples.ts` that no sample uses, fails too, so nothing drifts
 * out of coverage quietly.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { SAMPLES, type SampleContext } from "./samples";

const WEB = path.resolve(import.meta.dirname, "../..");
const JEVCHAIN_SRC = path.resolve(WEB, "../../packages/jevchain/src");
const JEVCHAIN = path.join(JEVCHAIN_SRC, "index.ts");

// ---------------------------------------------------------------------------
// Finding the samples
// ---------------------------------------------------------------------------

interface Found {
  /** "<route> <const>" (or "<route> <file>" for an inline string): the key into SAMPLES. */
  key: string;
  route: string;
  file: string;
  /** The sample as the page shows it, or undefined when the test can't read it statically. */
  code: string | undefined;
  /** For a CompileError: the underlined line and the printed diagnostic. */
  expect?: { line: number; error: string };
  /** Reads as TypeScript but the page shows it without a .ts file name (e.g. a bare `<Code>`). */
  bare?: true;
}

/** Code that imports from jevchain or calls one of its builders is TypeScript, whatever block shows it. */
const BUILDERS = /\b(?:ask|route|gate|parallel|cascade|tier|step|emit|chain|choice|score|noul|createJev|toJSON|fromJSON)\(/;
function looksLikeTypeScript(code: string): boolean {
  return /from "jevchain"/.test(code) || BUILDERS.test(code);
}

function pageFiles(): string[] {
  const out = [path.join(WEB, "src/app/page.tsx")];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === "page.tsx") out.push(p);
    }
  };
  walk(path.join(WEB, "src/app/docs"));
  return out.sort();
}

function routeOf(file: string): string {
  const dir = path.relative(path.join(WEB, "src/app"), path.dirname(file));
  return "/" + dir.split(path.sep).join("/");
}

/**
 * A string the page builds from literals. Interpolations only ever appear in
 * comments (claims printed as expected output), so each becomes its source text.
 */
function literal(node: ts.Expression | undefined): string | undefined {
  if (!node) return undefined;
  if (ts.isNoSubstitutionTemplateLiteral(node) || ts.isStringLiteral(node)) return node.text;
  if (ts.isTemplateExpression(node)) {
    return node.head.text + node.templateSpans.map((s) => `<${s.expression.getText()}>` + s.literal.text).join("");
  }
  return undefined;
}

/**
 * Samples are found by shape: a JSX element (or an object literal, like the
 * landing page's feature cards) with a `code` and a `file`/`filename` ending in
 * `.ts`, plus every `<CompileError>`.
 */
function findSamples(file: string): Found[] {
  const src = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const route = routeOf(file);
  const consts = new Map<string, ts.Expression>();
  for (const s of src.statements) {
    if (!ts.isVariableStatement(s)) continue;
    for (const d of s.declarationList.declarations) if (ts.isIdentifier(d.name) && d.initializer) consts.set(d.name.text, d.initializer);
  }

  const found: Found[] = [];
  const add = (tag: string, props: Map<string, ts.Expression>, label?: string) => {
    const compileError = tag === "CompileError";
    const codeExpr = props.get("code");
    if (!codeExpr) return;
    const resolve = (e: ts.Expression | undefined) => (e && ts.isIdentifier(e) ? literal(consts.get(e.text)) : literal(e));
    const code = resolve(codeExpr)?.trim();
    let fileName = literal(props.get("file") ?? props.get("filename")) ?? (compileError ? "chain.ts" : undefined);
    // A block with no .ts file name that still reads as TypeScript is found anyway, flagged `bare`.
    const bare = !compileError && !(fileName && /\.tsx?$/.test(fileName)) && code !== undefined && looksLikeTypeScript(code);
    if (bare) fileName = `${ts.isIdentifier(codeExpr) ? codeExpr.text : "inline"}.ts`;
    if (!fileName || (!compileError && !bare && !/\.tsx?$/.test(fileName))) return;
    const name = ts.isIdentifier(codeExpr) ? codeExpr.text : (label ?? fileName);
    found.push({
      key: `${route} ${name}`,
      route,
      file: fileName,
      code,
      ...(bare ? { bare } : {}),
      ...(compileError ? { expect: { line: numberOf(props.get("line")), error: resolve(props.get("error"))?.trim() ?? "" } } : {}),
    });
  };

  const visit = (n: ts.Node) => {
    if (ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) {
      const props = new Map<string, ts.Expression>();
      for (const a of n.attributes.properties) {
        if (!ts.isJsxAttribute(a) || !a.initializer) continue;
        const init = a.initializer;
        const v = ts.isStringLiteral(init) ? init : ts.isJsxExpression(init) ? init.expression : undefined;
        if (v) props.set(a.name.getText(), v);
      }
      add(n.tagName.getText(), props);
    } else if (ts.isObjectLiteralExpression(n)) {
      const props = new Map<string, ts.Expression>();
      for (const p of n.properties) if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)) props.set(p.name.text, p.initializer);
      // Object samples (the landing page's feature cards) are named by their title.
      if (props.has("code") && props.has("file")) add("object", props, literal(props.get("title")));
    }
    ts.forEachChild(n, visit);
  };
  visit(src);
  return found;
}

function numberOf(e: ts.Expression | undefined): number {
  return e && ts.isNumericLiteral(e) ? Number(e.text) : NaN;
}

// ---------------------------------------------------------------------------
// Compiling them
// ---------------------------------------------------------------------------

/** jevchain's public exports, split into values and types. */
function jevchainExports(): { values: string[]; types: string[] } {
  const src = ts.createSourceFile(JEVCHAIN, fs.readFileSync(JEVCHAIN, "utf8"), ts.ScriptTarget.Latest, true);
  const values: string[] = [];
  const types: string[] = [];
  for (const s of src.statements) {
    if (!ts.isExportDeclaration(s) || !s.exportClause || !ts.isNamedExports(s.exportClause)) continue;
    for (const el of s.exportClause.elements) (s.isTypeOnly || el.isTypeOnly ? types : values).push(el.name.text);
  }
  return { values, types };
}

/** Names a snippet of code declares at its top level (with or without the ones it imports). */
function declaredNames(code: string, withImports = true): Set<string> {
  const src = ts.createSourceFile("x.ts", code, ts.ScriptTarget.Latest, true);
  const names = new Set<string>();
  for (const s of src.statements) {
    if (ts.isVariableStatement(s)) {
      for (const d of s.declarationList.declarations) if (ts.isIdentifier(d.name)) names.add(d.name.text);
    } else if (
      (ts.isFunctionDeclaration(s) || ts.isClassDeclaration(s) || ts.isInterfaceDeclaration(s) || ts.isTypeAliasDeclaration(s) || ts.isEnumDeclaration(s)) &&
      s.name
    ) {
      names.add(s.name.text);
    } else if (withImports && ts.isImportDeclaration(s) && s.importClause) {
      const b = s.importClause.namedBindings;
      if (s.importClause.name) names.add(s.importClause.name.text);
      if (b && ts.isNamedImports(b)) b.elements.forEach((el) => names.add(el.name.text));
    }
  }
  return names;
}

interface Compiled {
  sample: Found & { code: string };
  ctx: SampleContext;
  file: string;
  /** Lines of the virtual file before the sample's first line. */
  offset: number;
}

const OPTIONS: ts.CompilerOptions = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ESNext,
  moduleResolution: ts.ModuleResolutionKind.Bundler,
  strict: true,
  noEmit: true,
  skipLibCheck: true,
  lib: ["lib.es2022.d.ts", "lib.dom.d.ts", "lib.dom.iterable.d.ts"],
  types: ["node"],
  typeRoots: [path.join(WEB, "node_modules/@types")],
  baseUrl: WEB,
  paths: { jevchain: [JEVCHAIN], "@/*": ["src/*"] },
};

/**
 * Lay every sample out as a virtual module (with its context in a sibling
 * module) and typecheck them all in one program.
 *
 * A sample that imports from "jevchain" is a complete file: its imports must
 * be enough. One that doesn't is an excerpt, and gets jevchain's exports.
 */
function compile(samples: Compiled["sample"][]) {
  const { values, types } = jevchainExports();
  const files = new Map<string, string>();
  const compiled: Compiled[] = [];
  const byKey = new Map(samples.map((s) => [s.key, s]));
  const importLine = (skip: Set<string>) => {
    const v = values.filter((n) => !skip.has(n));
    const t = types.filter((n) => !skip.has(n));
    return `import { ${v.join(", ")} } from "jevchain"; import type { ${t.join(", ")} } from "jevchain";`;
  };

  samples.forEach((sample, i) => {
    const ctx = SAMPLES[sample.key] ?? {};
    const dir = path.join(WEB, `.samples/${i}`);
    const own = declaredNames(sample.code);
    // A sample that continues another sees everything that one declared.
    const earlier = ctx.continues ? byKey.get(`${sample.route} ${ctx.continues}`)?.code.replace(/^export /gm, "") : "";
    if (ctx.continues && earlier === undefined) throw new Error(`${sample.key} continues ${ctx.continues}, which isn't a sample on ${sample.route}`);
    const given = [earlier, ctx.given].filter(Boolean).join("\n");
    // The context exports what it declares, not what it imported: a sample needs its own imports.
    const givenNames = [...declaredNames(given, false)];
    if (given) {
      files.set(path.join(dir, "given.ts"), `${importLine(declaredNames(given))}\n${given}\nexport { ${givenNames.join(", ")} };\n`);
    }
    const complete = /from "jevchain"/.test(sample.code);
    // In a function-body sample, imports still belong at the top of the file: lift them, keeping line numbers.
    const imports = ctx.body ? sample.code.split("\n").filter((l) => l.startsWith("import ")) : [];
    const code = ctx.body ? sample.code.replace(/^import .*$/gm, "") : sample.code;
    const prelude = [
      ...imports,
      given ? `import { ${givenNames.filter((n) => !own.has(n)).join(", ")} } from "./given";` : "",
      complete ? "" : importLine(new Set([...own, ...givenNames])),
      ctx.body ? "export async function __sample() {" : "",
    ].join(" ");
    const file = path.join(dir, sample.file.replace(/[^\w.-]/g, "_").replace(/\.tsx?$/, "") + ".ts");
    files.set(file, `${prelude}\n${code}\n${ctx.body ? "}" : ""}\nexport {};\n`);
    compiled.push({ sample, ctx, file, offset: 1 });
  });

  const host = ts.createCompilerHost(OPTIONS);
  const { getSourceFile, fileExists, readFile } = host;
  host.getSourceFile = (f, lang, ...rest) => (files.has(f) ? ts.createSourceFile(f, files.get(f)!, lang, true) : getSourceFile(f, lang, ...rest));
  host.fileExists = (f) => files.has(f) || fileExists(f);
  const dirs = new Set([...files.keys()].map((f) => path.dirname(f)));
  const { directoryExists } = host;
  host.directoryExists = (d) => dirs.has(d) || (directoryExists?.(d) ?? true);
  host.readFile = (f) => files.get(f) ?? readFile(f);
  const program = ts.createProgram([...files.keys()], OPTIONS, host);
  return { program, compiled };
}

interface Problem {
  line: number;
  code: number;
  message: string;
}

function problems(program: ts.Program, c: Compiled): Problem[] {
  const sf = program.getSourceFile(c.file)!;
  const diags = [...program.getSyntacticDiagnostics(sf), ...program.getSemanticDiagnostics(sf)];
  // A broken context shows up here too, blamed on line 0.
  const givenSf = program.getSourceFile(path.join(path.dirname(c.file), "given.ts"));
  if (givenSf) diags.push(...program.getSemanticDiagnostics(givenSf).map((d) => ({ ...d, start: undefined })));
  return diags.map((d) => ({
    line: d.file === sf && d.start !== undefined ? sf.getLineAndCharacterOfPosition(d.start).line + 1 - c.offset : 0,
    code: d.code,
    message: ts.flattenDiagnosticMessageText(d.messageText, "\n"),
  }));
}

/** `type X = …; // T` lines, and what the compiler says X is. */
function typeClaims(program: ts.Program, c: Compiled): { line: number; claimed: string; actual: string }[] {
  const sf = program.getSourceFile(c.file)!;
  const checker = program.getTypeChecker();
  const out: { line: number; claimed: string; actual: string }[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isTypeAliasDeclaration(n) && !n.typeParameters) {
      const end = sf.getLineAndCharacterOfPosition(n.getEnd());
      const rest = sf.text.split("\n")[end.line]!.slice(end.character);
      const m = /^\s*\/\/\s*(.+?)\s*$/.exec(rest);
      if (m) {
        const actual = checker.typeToString(checker.getTypeAtLocation(n.name), undefined, ts.TypeFormatFlags.NoTruncation);
        out.push({ line: end.line + 1 - c.offset, claimed: m[1]!, actual });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/** The printed diagnostic, with `…` standing for anything the page elided. */
function matchesPrinted(printed: string, p: Problem): boolean {
  const actual = `error TS${p.code}: ${p.message}`;
  const pattern = printed
    .split("…")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[\\s\\S]*?");
  return new RegExp(`^${pattern}$`).test(actual);
}

const show = (ps: Problem[]) => ps.map((p) => `  line ${p.line}: TS${p.code} ${p.message.split("\n")[0]}`).join("\n");

// ---------------------------------------------------------------------------
// The checks
// ---------------------------------------------------------------------------

const found = pageFiles().flatMap(findSamples);

describe("every TypeScript sample the site shows", () => {
  it("is readable by this test", () => {
    const unreadable = found.filter((s) => s.code === undefined && !SAMPLES[s.key]?.generated).map((s) => s.key);
    expect(unreadable, "build these from literals, or give them a `generated` entry in samples.ts").toEqual([]);
  });

  it("is marked as TypeScript wherever the page shows it", () => {
    const bare = found.filter((s) => s.bare && !SAMPLES[s.key]?.bare).map((s) => s.key);
    expect(bare, "these read as TypeScript but have no .ts file name; give them one, or `bare: true` in samples.ts").toEqual([]);
  });

  it("has a context in samples.ts only if it exists", () => {
    const keys = new Set(found.map((s) => s.key));
    expect(Object.keys(SAMPLES).filter((k) => !keys.has(k))).toEqual([]);
  });

  it("keys uniquely", () => {
    const seen = found.map((s) => s.key);
    expect(seen.filter((k, i) => seen.indexOf(k) !== i)).toEqual([]);
  });

  const readable = found
    .map((s) => ({ ...s, code: SAMPLES[s.key]?.generated?.() ?? s.code }))
    .filter((s): s is Found & { code: string } => s.code !== undefined);
  const { program, compiled } = compile(readable);

  for (const c of compiled) {
    const { sample, ctx } = c;
    it(`${sample.key} (${sample.file})`, () => {
      if (ctx.quotes) {
        const source = fs.readFileSync(path.join(JEVCHAIN_SRC, ctx.quotes), "utf8");
        expect(source.includes(sample.code), `no longer a verbatim quote of packages/jevchain/src/${ctx.quotes}`).toBe(true);
        return;
      }

      const ps = problems(program, c);
      const lines = sample.code.split("\n");
      const marked = lines.flatMap((l, i) => (/\/\/.*✗/.test(l) ? [i + 1] : []));

      if (sample.expect) {
        const { line, error } = sample.expect;
        const onLine = ps.filter((p) => p.line === line);
        expect(onLine.length, `expected a compile error on line ${line}; got:\n${show(ps)}`).toBeGreaterThan(0);
        expect(
          onLine.some((p) => matchesPrinted(error, p)),
          `line ${line} fails, but not with the message the page prints. tsc says:\n${onLine.map((p) => `error TS${p.code}: ${p.message}`).join("\n")}`,
        ).toBe(true);
        expect(ps.filter((p) => p.line !== line), `errors besides the one on the page`).toEqual([]);
      } else {
        expect(show(ps.filter((p) => !marked.includes(p.line))), "compile errors").toBe("");
        for (const l of marked) {
          const onLine = ps.filter((p) => p.line === l);
          expect(onLine.length, `line ${l} is marked ✗ but compiles`).toBeGreaterThan(0);
          const quoted = /✗.*?('[^']+')/.exec(lines[l - 1]!)?.[1];
          if (quoted) expect(onLine.map((p) => p.message).join("\n"), `line ${l}'s ✗ says ${quoted}`).toContain(quoted);
        }
      }

      for (const t of typeClaims(program, c)) expect(t.actual, `line ${t.line} says the type is ${t.claimed}`).toBe(t.claimed);
    });
  }
});
