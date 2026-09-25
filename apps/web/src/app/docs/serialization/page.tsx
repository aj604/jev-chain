import { CHAIN_FORMAT, toJSON, toTypeScript } from "jevchain";
import { DocExample } from "@/components/docs/doc-example";
import { A, ApiTable, C, Callout, DocPage, H2, Li, List, P, Snippet } from "@/components/docs/doc-ui";
import { getDocChain } from "@/docs/chains";
import { docMetadata } from "@/docs/nav";

export const metadata = docMetadata("serialization");

const LOAD = `import { fromJSON } from "jevchain";

const nameTag = fromJSON(doc, {
  handlers: {
    normalize: (raw: string) => ({ name: raw.trim().split(/\\s+/)[0], bio: raw.trim() }),
    print: (tag: string, ctx) => ({ tag, original: ctx.runInput }),
  },
});

await jev.run(nameTag, "Harriet. Enjoys well-labelled spreadsheets.");`;

const PREVIEW = `// Load a document without its code, e.g. to draw it or dry-run the decisions.
const preview = fromJSON(doc, { missingHandlers: "passthrough" });
// Each unbound step returns its input unchanged and logs:
//   no handler bound for "normalize", passed input through`;

export default function SerializationPage() {
  const fridge = getDocChain("docs-fridge")!;
  const nameTag = getDocChain("docs-name-tag")!;
  const fridgeDoc = toJSON(fridge.chain, { name: "Fridge verdict" });
  const nameTagDoc = toJSON(nameTag.chain);
  const fridgeTs = toTypeScript(fridgeDoc);
  const nameTagTs = toTypeScript(nameTagDoc);

  return (
    <DocPage slug="serialization">
      <P>
        A node is already a plain object: the same shape you&apos;d write by hand in JSON, plus inline functions where
        you supplied code. So serializing is nearly the identity function, and one definition can drive your code, the
        studio and the diagrams on this site. Every block of JSON and TypeScript below was generated at build time from
        the real chains.
      </P>

      <H2 id="to-json">toJSON</H2>
      <P>
        <C>toJSON(chain, meta?)</C> returns a <C>ChainDocument</C>. Questions, thresholds, templates, titles: all of it
        round-trips exactly. Here&apos;s the <A href="/docs/route">fridge route</A>, in full:
      </P>
      <Snippet code={`const doc = toJSON(fridge, { name: "Fridge verdict" });`} file="save.ts" />
      <Snippet code={JSON.stringify(fridgeDoc, null, 2)} file="fridge.chain.json" />
      <DocExample
        id="docs-fridge"
        caption={
          <>
            The chain behind that document. No functions anywhere, so <C>refs</C> is empty and it loads with no handlers
            at all.
          </>
        }
      />

      <H2 id="from-json">fromJSON and handlers</H2>
      <P>
        Code can&apos;t be JSON, so functions become <C>{`{ "$ref": "name" }`}</C> and the document lists every name it
        needs in <C>refs</C>. The <A href="/docs/step-and-emit">name tag printer</A> has two steps:
      </P>
      <Snippet code={JSON.stringify(nameTagDoc, null, 2)} file="name-tag.chain.json" />
      <P>
        <C>fromJSON(doc, options)</C> (a document or a JSON string) puts the functions back from a <C>handlers</C> map,
        then validates the result with the same checks <C>run</C> uses.
      </P>
      <Snippet code={LOAD} file="load.ts" />
      <ApiTable
        caption="where $refs come from, and the handler key to bind"
        rows={[
          { name: "step run", type: "ref ?? id", children: <>The step&apos;s <code>ref</code> option if you set one, else its id. Set <code>ref</code> when two steps share one function.</> },
          { name: "function state", type: "<nodeId>.state", children: <>An ask, route or gate whose <code>state</code> is a function. Template strings stay strings and need nothing.</> },
          { name: "parallel join", type: "<nodeId>.join", children: "A parallel's join function." },
          { name: "tier state", type: "<cascadeId>.<tierId>.state", children: "A cascade tier with a function state." },
        ]}
      />
      <ApiTable
        caption="fromJSON options"
        rows={[
          { name: "handlers", type: "Record<string, Handler>", children: "A function for every name in refs." },
          { name: "missingHandlers", type: '"throw" | "passthrough"', default: '"throw"', children: <><code>throw</code>: a <code>ChainConfigError</code> listing every missing name. <code>passthrough</code>: steps without a handler return their input and log a note, handy for previews.</> },
        ]}
      />
      <Snippet code={PREVIEW} file="preview.ts" />
      <Callout tone="warn" title="types stop at the JSON border">
        <p>
          A loaded chain is <C>JevNode&lt;unknown, unknown&gt;</C> unless you say otherwise
          (<C>fromJSON&lt;Input, Output&gt;(doc)</C>), and the compiler never saw its routes. That&apos;s why{" "}
          <C>fromJSON</C> re-checks the structure at runtime: missing branches, bad thresholds, reserved keys, unknown
          node kinds.
        </p>
      </Callout>

      <H2 id="format">The jevchain/v1 format</H2>
      <P>
        One small envelope around the root node. It&apos;s the format the library, the studio and this site share.
      </P>
      <ApiTable
        caption="ChainDocument"
        rows={[
          { name: "format", type: `"${CHAIN_FORMAT}"`, children: <><code>fromJSON</code> refuses anything else.</> },
          { name: "name, description", type: "string?", children: "For humans and UIs." },
          { name: "examples", type: "Json[]?", children: "Sample inputs, for UIs and docs." },
          { name: "root", type: "Json", children: <>The chain itself. Each node has <code>kind</code> and <code>id</code>, plus its kind&apos;s fields exactly as the builders take them.</> },
          { name: "refs", type: "string[]", children: "Every handler name the document needs, sorted." },
        ]}
      />
      <List>
        <Li>
          Nodes nest where they do in code: <C>branches</C>, <C>then</C>/<C>otherwise</C>, <C>unsure.then</C>,{" "}
          <C>lowConfidence.then</C>, <C>tiers</C> and <C>fallback</C>, <C>steps</C>.
        </Li>
        <Li>
          Questions use TypeSafe&apos;s wire format unchanged: <C>type</C>, <C>instructions</C>, <C>criteria</C>. A choice
          built from an array of labels has <C>null</C> criteria.
        </Li>
      </List>

      <H2 id="codegen">toTypeScript</H2>
      <P>
        <C>toTypeScript(doc, options?)</C> goes the other way: from a document back to builder code that reads like you
        wrote it. It&apos;s the studio&apos;s &ldquo;export to code&rdquo; button. The fridge document from above comes back
        as:
      </P>
      <Snippet code={fridgeTs} file="fridge.ts" />
      <P>
        Functions can&apos;t be recovered from a name, so each <C>$ref</C> becomes a clearly marked stub for you to fill in:
      </P>
      <Snippet code={nameTagTs} file="name-tag.ts" />
      <P>
        Both files compile as printed, stubs and all: this site&apos;s tests typecheck them against jevchain on every
        change. Until you fill one in, a stub step returns its input unchanged.
      </P>
      <ApiTable
        caption="toTypeScript options"
        rows={[
          { name: "exportName", type: "string", default: "camelCase(root id)", children: "Name of the exported constant." },
          { name: "importFrom", type: "string", default: '"jevchain"', children: "Module the builders are imported from." },
        ]}
      />
    </DocPage>
  );
}
