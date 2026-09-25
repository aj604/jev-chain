/**
 * Read source files from the monorepo at build time (server components only).
 *
 * Pages that show "the real code" read it from disk rather than pasting a
 * copy, so the docs can't drift from what actually ships. `next build` runs
 * with cwd = apps/web, but we walk up to the repo root so it also works from
 * the root or a test runner.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { GITHUB_BLOB } from "./github";

let cachedRoot: string | undefined;

/** The monorepo root: the nearest ancestor of cwd with a pnpm-workspace.yaml. */
export function repoRoot(): string {
  if (cachedRoot) return cachedRoot;
  let dir = process.cwd();
  for (;;) {
    if (existsSync(path.join(/*turbopackIgnore: true*/ dir, "pnpm-workspace.yaml"))) return (cachedRoot = dir);
    const up = path.dirname(dir);
    if (up === dir) throw new Error(`repo-source: no pnpm-workspace.yaml above ${process.cwd()}`);
    dir = up;
  }
}

/** Read a file by its repo-relative path, e.g. `packages/examples/src/haunted-desk.ts`. */
export function readRepoFile(relPath: string): string {
  return readFileSync(path.join(/*turbopackIgnore: true*/ repoRoot(), relPath), "utf8");
}

/** Source of a gallery example, by its `file` field. */
export function readExampleSource(file: string): string {
  return readRepoFile(`packages/examples/src/${file}`);
}

export function exampleGithubUrl(file: string): string {
  return `${GITHUB_BLOB}/packages/examples/src/${file}`;
}

/**
 * A named region of a file, VitePress-style:
 *
 *   // #region fridge
 *   ...code...
 *   // #endregion fridge
 *
 * Returns the region body, dedented, without the marker lines.
 */
export function readRegion(relPath: string, name: string): string {
  const src = readRepoFile(relPath);
  const start = src.indexOf(`// #region ${name}\n`);
  if (start === -1) throw new Error(`repo-source: no "#region ${name}" in ${relPath}`);
  const bodyStart = start + `// #region ${name}\n`.length;
  const end = src.indexOf(`// #endregion ${name}`, bodyStart);
  if (end === -1) throw new Error(`repo-source: "#region ${name}" in ${relPath} is never closed`);
  return dedent(src.slice(bodyStart, end)).trimEnd();
}

function dedent(text: string): string {
  const lines = text.split("\n");
  const indents = lines.filter((l) => l.trim()).map((l) => l.match(/^ */)![0].length);
  const min = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(min)).join("\n");
}
