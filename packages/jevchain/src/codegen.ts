/**
 * JSON -> TypeScript. The web builder's "export to code" button.
 *
 * The output is idiomatic JevChain: builder calls, not a JSON blob, so it
 * reads like something you'd have written by hand (and type-checks).
 */
import type { ChainDocument } from "./serialize";

type Obj = Record<string, unknown>;

const IDENT = /^[A-Za-z_$][\w$]*$/;
/** Words that can't name a `const`. */
const RESERVED = new Set(
  "arguments await break case catch class const continue debugger default delete do else enum eval export extends false finally for function if implements import in instanceof interface let new null package private protected public return static super switch this throw true try typeof var void while with yield".split(" "),
);

export interface CodegenOptions {
  /** Name of the exported constant. Defaults to a camelCase of the root id. */
  exportName?: string;
  /** Module to import from. Default "jevchain". */
  importFrom?: string;
}

export function toTypeScript(doc: ChainDocument, options: CodegenOptions = {}): string {
  const used = new Set<string>();
  const stubs: string[] = [];
  const root = doc.root as Obj;
  const indent = (s: string, n = 1) => s.replace(/\n/g, `\n${"  ".repeat(n)}`);

  const question = (q: unknown): string => {
    const x = q as Obj;
    const ins = literal(x.instructions ?? null);
    if (x.type === "choice") {
      used.add("choice");
      const crit = x.criteria as Obj;
      const allNull = Object.values(crit).every((v) => v === null);
      return `choice(${ins}, ${allNull ? literal(Object.keys(crit)) : literal(crit)})`;
    }
    if (x.type === "score") {
      used.add("score");
      return `score(${ins}, ${literal(x.criteria)})`;
    }
    used.add("noul");
    return x.criteria ? `noul(${ins}, ${literal(x.criteria)})` : `noul(${ins})`;
  };

  const questions = (qs: unknown): string => {
    const entries = Object.entries(qs as Obj).map(([k, q]) => `${key(k)}: ${question(q)},`);
    return `{\n  ${entries.join("\n  ")}\n}`;
  };

  const state = (s: unknown, where: string): string | undefined => {
    if (s === undefined) return undefined;
    if (s && typeof s === "object" && "$ref" in (s as Obj)) {
      stubs.push(`// TODO: state for ${comment(where)} (was handler ${literal((s as Obj).$ref)})`);
      return `(input: any) => input`;
    }
    return literal(s);
  };

  /** `title`/`description` entries, for any node kind (and `title` for tiers). */
  const meta = (n: Obj): string[] => {
    const out: string[] = [];
    if (n.title !== undefined) out.push(`title: ${literal(n.title)}`);
    if (n.description !== undefined) out.push(`description: ${literal(n.description)}`);
    return out;
  };

  const common = (n: Obj, out: string[]) => {
    const st = state(n.state, String(n.id));
    if (st) out.push(`state: ${st},`);
    if (n.model) out.push(`model: ${literal(n.model)},`);
    for (const m of meta(n)) out.push(`${m},`);
  };

  const block = (lines: string[]) => `{\n  ${lines.map((l) => indent(l)).join("\n  ")}\n}`;

  const node = (raw: unknown): string => {
    const n = raw as Obj;
    const id = literal(n.id);
    used.add(n.kind as string);
    switch (n.kind) {
      case "emit": {
        const opts = [...(n.id === "emit" ? [] : [`id: ${id}`]), ...meta(n)];
        return `emit(${literal(n.value)}${opts.length ? `, { ${opts.join(", ")} }` : ""})`;
      }
      case "step": {
        const name = (n.run as Obj | undefined)?.$ref ?? n.id;
        const opts: string[] = [];
        if (n.timeoutMs !== undefined) opts.push(`timeoutMs: ${n.timeoutMs}`);
        if (n.retries !== undefined) opts.push(`retries: ${n.retries}`);
        if (name !== n.id) opts.push(`ref: ${literal(name)}`);
        opts.push(...meta(n));
        return `step(${id}, async (input: any, ctx) => {\n  // TODO: implement ${literal(name)}\n  return input;\n}${opts.length ? `, { ${opts.join(", ")} }` : ""})`;
      }
      case "ask": {
        const lines = [`questions: ${indent(questions(n.questions))},`];
        common(n, lines);
        return `ask(${id}, ${block(lines)})`;
      }
      case "route": {
        const lines = [`ask: ${question(n.ask)},`];
        if (n.alsoAsk) lines.push(`alsoAsk: ${indent(questions(n.alsoAsk))},`);
        const branches = Object.entries(n.branches as Obj).map(([k, b]) => `${key(k)}: ${indent(node(b))},`);
        lines.push(`branches: {\n  ${branches.join("\n  ")}\n},`);
        if (n.lowConfidence) {
          const lc = n.lowConfidence as Obj;
          lines.push(`lowConfidence: { below: ${lc.below}, then: ${indent(node(lc.then))} },`);
        }
        common(n, lines);
        return `route(${id}, ${block(lines)})`;
      }
      case "gate": {
        const lines = [`ask: ${question(n.ask)},`, `pass: ${literal(n.pass)},`, `then: ${indent(node(n.then))},`];
        if (n.otherwise) lines.push(`otherwise: ${indent(node(n.otherwise))},`);
        if (n.unsure) {
          const u = n.unsure as Obj;
          const parts = [u.margin !== undefined ? `margin: ${u.margin}` : "", u.minConfidence !== undefined ? `minConfidence: ${u.minConfidence}` : ""].filter(Boolean);
          parts.push(`then: ${indent(node(u.then))}`);
          lines.push(`unsure: { ${parts.join(", ")} },`);
        }
        if (n.alsoAsk) lines.push(`alsoAsk: ${indent(questions(n.alsoAsk))},`);
        common(n, lines);
        return `gate(${id}, ${block(lines)})`;
      }
      case "parallel": {
        const branches = Object.entries(n.branches as Obj).map(([k, b]) => `${key(k)}: ${indent(node(b))},`);
        const lines = [`branches: {\n  ${branches.join("\n  ")}\n},`];
        if (n.join) lines.push(`join: (results) => results, // TODO: was handler ${literal((n.join as Obj).$ref)}`);
        common(n, lines);
        return `parallel(${id}, ${block(lines)})`;
      }
      case "cascade": {
        used.add("tier");
        const tiers = (n.tiers as Obj[]).map((t) => {
          const parts = [`ask: ${question(t.ask)}`, `minConfidence: ${t.minConfidence}`];
          const st = state(t.state, `${n.id}.${t.id}`);
          if (st) parts.push(`state: ${st}`);
          if (t.model) parts.push(`model: ${literal(t.model)}`);
          if (t.title !== undefined) parts.push(`title: ${literal(t.title)}`);
          return `tier(${literal(t.id)}, { ${parts.join(", ")} }),`;
        });
        const lines = [`tiers: [\n  ${tiers.join("\n  ")}\n],`, `fallback: ${indent(node(n.fallback))},`];
        common(n, lines);
        return `cascade(${id}, ${block(lines)})`;
      }
      case "chain": {
        const steps = (n.steps as unknown[]).map((s) => `${indent(node(s))},`);
        const code = `chain(\n  ${id},\n  ${steps.join("\n  ")}\n)`;
        // chain() takes no options, so a titled chain goes through describe().
        const m = meta(n);
        if (!m.length) return code;
        used.add("describe");
        return `describe(${code}, { ${m.join(", ")} })`;
      }
      default:
        return `/* unknown node kind ${comment(String(n.kind))} */ undefined as never`;
    }
  };

  const body = node(root);
  const imports = [...used].sort();
  let exportName = options.exportName ?? camel(String(root.id ?? "chain"));
  // A root called "route" mustn't shadow the route() it's built with.
  if (!options.exportName && (used.has(exportName) || RESERVED.has(exportName))) exportName += "Chain";
  const about = doc.description || doc.name;
  const header = [
    `import { ${imports.join(", ")} } from ${literal(options.importFrom ?? "jevchain")};`,
    "",
    ...(about ? [`/** ${comment(String(about))} */`] : []),
  ];
  return [...header, ...stubs, `export const ${exportName} = ${body};`, ""].join("\n");
}

/** Text that's safe inside a line or block comment: one line, no `*\/`. */
function comment(s: string): string {
  return s.replace(/[\r\n\u2028\u2029]+/g, " ").replace(/\*\//g, "*\\/");
}

function key(k: string): string {
  return IDENT.test(k) ? k : JSON.stringify(k);
}

function camel(s: string): string {
  const c = s.replace(/[^A-Za-z0-9]+(.)?/g, (_, ch: string | undefined) => (ch ? ch.toUpperCase() : "")).replace(/^[^A-Za-z_$]+/, "");
  return c ? c[0]!.toLowerCase() + c.slice(1) : "chain";
}

/** Pretty TS literal for JSON-ish values: unquoted keys, short things on one line. */
export function literal(v: unknown, depth = 0): string {
  if (v === null) return "null";
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v !== "object") return String(v);
  const pad = "  ".repeat(depth + 1);
  const end = "  ".repeat(depth);
  if (Array.isArray(v)) {
    const items = v.map((x) => literal(x, depth + 1));
    const one = `[${items.join(", ")}]`;
    return one.length <= 72 && !one.includes("\n") ? one : `[\n${pad}${items.join(`,\n${pad}`)},\n${end}]`;
  }
  const entries = Object.entries(v as Obj)
    .filter(([, x]) => x !== undefined)
    .map(([k, x]) => `${key(k)}: ${literal(x, depth + 1)}`);
  if (!entries.length) return "{}";
  const one = `{ ${entries.join(", ")} }`;
  return one.length <= 72 && !one.includes("\n") ? one : `{\n${pad}${entries.join(`,\n${pad}`)},\n${end}}`;
}
