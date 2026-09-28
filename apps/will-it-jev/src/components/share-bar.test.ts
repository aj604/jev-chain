import { run } from "jevchain";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { COPY } from "@/lib/copy";
import { compileRecipe } from "@/lib/recipe/compile";
import type { Recipe } from "@/lib/recipe/types";
import { verdictOf } from "@/lib/recipe/verdict";
import { readVerdictPayload } from "@/lib/share";
import { tonight } from "@/recipes";
import { fakeJev } from "@/test/fake-jev";
import { buildShareLinks, copyText, recipeCode } from "./share-actions";
import { ShareBar, type ShareBarProps } from "./share-bar";

afterEach(() => {
  vi.unstubAllGlobals();
});

const INPUT = tonight.samples[0].input;

async function props(recipe: Recipe = tonight.recipe, input = INPUT): Promise<ShareBarProps> {
  const { client } = fakeJev();
  const result = await run(compileRecipe(recipe), input, { jev: client });
  const verdict = verdictOf(recipe, {
    status: result.status,
    output: result.status === "ok" ? result.output : undefined,
    trace: result.trace,
  });
  if (!verdict) throw new Error("the run has no verdict");
  return { recipe, input, trace: result.trace, verdict, slug: "tonight" };
}

const render = (p: ShareBarProps) => renderToStaticMarkup(createElement(ShareBar, p));

describe("ShareBar", () => {
  it("shows copy link, the studio link and the code toggle", async () => {
    const html = render(await props());
    expect(html).toContain(`>${COPY.share}<`);
    expect(html).toContain(`>${COPY.openInStudio}</a>`);
    expect(html).toContain(`>${COPY.showCode}</button>`);
    expect(html).not.toContain(COPY.openInStudioTrimmed);
  });

  it("says the studio gets trimmed input when trimmedInput is set", async () => {
    const html = render({ ...(await props()), trimmedInput: true });
    expect(html).toContain(`>${COPY.openInStudioTrimmed}</a>`);
  });

  it("opens the studio in a new tab", async () => {
    expect(render(await props())).toMatch(/<a [^>]*target="_blank" rel="noopener noreferrer"/);
  });

  it("keeps the links inert and the code closed until the browser builds them", async () => {
    const html = render(await props());
    expect(html).toMatch(/<button [^>]*disabled=""/);
    expect(html).toMatch(/<a [^>]*aria-disabled="true"/);
    expect(html).not.toMatch(/<a [^>]*href=/);
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain(COPY.codeNote);
  });
});

describe("buildShareLinks", () => {
  it("builds an absolute verdict link and a studio link for the run", async () => {
    const p = await props();
    const links = await buildShareLinks(p, "https://will-it-jev.test");
    expect(links.share).toMatch(/^https:\/\/will-it-jev\.test\/v\?t=\w+&g=\d+&d=\d+&r=tonight#[\w-]+$/);
    expect(links.studio).toMatch(/\/studio\/share#[\w-]+$/);

    const decoded = await readVerdictPayload(new URL(links.share).hash);
    expect(decoded.input).toBe(p.input);
    expect(decoded.recipe).toEqual(p.recipe);
  });

  it("drops a slug that is not curated", async () => {
    const links = await buildShareLinks({ ...(await props()), slug: "nope" }, "https://will-it-jev.test");
    expect(links.share).not.toContain("r=");
  });
});

describe("recipeCode", () => {
  it("is the circuit as jevchain TypeScript", () => {
    const code = recipeCode(tonight.recipe);
    expect(code).toContain("gate(");
    expect(code).toContain("noul(");
    expect(code).toContain('from "jevchain"');
  });
});

describe("copyText", () => {
  it("writes to the clipboard", async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await expect(copyText("https://x.test/v")).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith("https://x.test/v");
  });

  it("gives false, without throwing, with no clipboard", async () => {
    vi.stubGlobal("navigator", {});
    await expect(copyText("x")).resolves.toBe(false);
    vi.stubGlobal("navigator", undefined);
    await expect(copyText("x")).resolves.toBe(false);
  });

  it("gives false, without throwing, when the clipboard is denied", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: () => Promise.reject(new DOMException("denied", "NotAllowedError")) } });
    await expect(copyText("x")).resolves.toBe(false);
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: () => {
          throw new Error("sync");
        },
      },
    });
    await expect(copyText("x")).resolves.toBe(false);
  });
});
