import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { docChains } from "./chains";
import { DOC_PAGES } from "./nav";
import { getRunnable } from "./runnables";

const appDir = path.resolve(import.meta.dirname, "../app/docs");
const pageFile = (slug: string) => path.join(appDir, slug, "page.tsx");

describe("docs nav", () => {
  for (const page of DOC_PAGES) {
    it(`/docs/${page.slug} exists and its H2s match nav.ts`, () => {
      const file = pageFile(page.slug);
      expect(existsSync(file), `${file} is missing`).toBe(true);
      const src = readFileSync(file, "utf8");
      const ids = [...src.matchAll(/<H2\s+id="([^"]+)"/g)].map((m) => m[1]);
      expect(ids).toEqual(page.headings.map((h) => h.id));
      expect(src).toContain(`<DocPage slug="${page.slug}"`);
    });

    it(`/docs/${page.slug} only references runnable examples that exist`, () => {
      const src = readFileSync(pageFile(page.slug), "utf8");
      for (const [, id] of src.matchAll(/<DocExample[^>]*\bid="([^"]+)"/g)) {
        expect(getRunnable(id!), `unknown DocExample id "${id}"`).toBeDefined();
      }
    });
  }

  it("has unique slugs", () => {
    const slugs = DOC_PAGES.map((p) => p.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });
});

describe("docs chains", () => {
  it("have docs- prefixed, unique ids and at least one input", () => {
    const ids = docChains.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of docChains) {
      expect(c.id).toMatch(/^docs-/);
      expect(c.inputs.length).toBeGreaterThan(0);
    }
  });

  it("each has a #region in chains.ts", () => {
    const src = readFileSync(path.resolve(import.meta.dirname, "chains.ts"), "utf8");
    for (const c of docChains) {
      expect(src).toContain(`// #region ${c.region}\n`);
      expect(src).toContain(`// #endregion ${c.region}`);
    }
  });
});
