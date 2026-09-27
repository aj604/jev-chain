import { toJSON, type AnyNode, type ChainDocument } from "jevchain";
import { tonight as studioTonight } from "jevchain-examples";
import { describe, expect, it } from "vitest";
import { compileRecipe } from "@/lib/recipe/compile";
import { tonight } from "./tonight";

/** A chain's serialized document without its metadata (`name`, `description`, `examples`). */
function doc(root: AnyNode): Partial<ChainDocument> {
  const d: Partial<ChainDocument> = { ...toJSON(root) };
  delete d.name;
  delete d.description;
  delete d.examples;
  return d;
}

describe("the studio's tonight example", () => {
  it("serializes to the same document as the compiled tonight recipe", () => {
    expect(doc(studioTonight)).toStrictEqual(doc(compileRecipe(tonight.recipe)));
  });
});
