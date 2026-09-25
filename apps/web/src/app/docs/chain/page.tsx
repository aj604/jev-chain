import { DocExample } from "@/components/docs/doc-example";
import { A, C, Callout, CompileError, DocPage, H2, Li, List, P, Snippet } from "@/components/docs/doc-ui";
import { docMetadata } from "@/docs/nav";

export const metadata = docMetadata("chain");

const SEQUENCE = `import { chain, step, ask, noul } from "jevchain";

const pipeline = chain(
  "moderate",
  step("clean", (s: string) => s.trim()),                  // string → string
  ask("read", { questions: { rude: noul("Is this rude?") } }), // string → { rude: NoulAnswer }
  step("decide", (a) => (a.rude.noul > 0.7 ? "hide" : "show")), // → "hide" | "show"
);
// ChainNode<string, "hide" | "show">`;

const MISMATCH = `const c = chain(
  "c",
  step("n", () => 1),
  step("s", (x: string) => x),
);`;

const MISMATCH_ERROR = `error TS2345: Argument of type 'StepNode<unknown, number>' is not assignable to parameter of type 'JevNode<unknown, string>'.
  Types of property '[io]' are incompatible.
    …
        Types of property 'out' are incompatible.
          Type 'number' is not assignable to type 'string'.`;

const TYPES = `import type { InputOf, OutputOf } from "jevchain";

type In = InputOf<typeof pipeline>;   // string
type Out = OutputOf<typeof pipeline>; // "hide" | "show"

// Type a step's parameter from whatever feeds it, so it follows along when that changes.
const read = ask("read", { questions: { rude: noul("Is this rude?") } });
const decide = step("decide", (a: OutputOf<typeof read>) => a.rude.noul > 0.7);`;

const NESTING = `// Small chains, named for what they do…
const understand = chain("understand", clean, read);
const respond = chain("respond", decide, format);

// …composed into bigger ones. Same rules, same types.
export const moderate = chain("moderate", understand, respond);

// A chain can be a branch, too.
const desk = route("desk", {
  ask: choice("Which queue?", ["moderation", "support"]),
  branches: { moderation: moderate, support: supportFlow },
});`;

const DESCRIBE = `import { describe } from "jevchain";

// A copy with a title/description for UIs; the original is untouched.
const understand = describe(chain("understand", clean, read), {
  title: "Understand the message",
  description: "Normalize, then ask Jev what it is.",
});`;

export default function ChainPage() {
  return (
    <DocPage slug="chain">
      <H2 id="sequencing">Sequencing</H2>
      <P>
        <C>chain(id, ...nodes)</C> runs nodes one after another, feeding each one&apos;s output into the next
        one&apos;s input. The chain&apos;s input is the first node&apos;s input; its output is the last node&apos;s
        output. That&apos;s the whole contract.
      </P>
      <Snippet code={SEQUENCE} file="moderate.ts" />
      <P>
        Remember the <A href="/docs#mental-model">mental model</A>: <C>route</C> and <C>gate</C> pass their input through
        untouched, so a chain step after a route receives whatever the <em>taken branch</em> produced.
      </P>

      <H2 id="types">Types across the links</H2>
      <P>
        Every node carries phantom input and output types, and <C>chain</C>&apos;s overloads line them up:{" "}
        <C>chain(a, b)</C> only compiles when <C>a</C>&apos;s output fits <C>b</C>&apos;s input. Get it wrong and
        you find out in your editor, not in production at 3am:
      </P>
      <CompileError code={MISMATCH} line={4} error={MISMATCH_ERROR} file="oops.ts" />
      <P>
        The message is long but the last line is the one that matters. (The <C>[io]</C> property is the phantom field
        that carries the types. It&apos;s never set at runtime.)
      </P>
      <P>
        To name a node&apos;s types, use <C>InputOf</C> and <C>OutputOf</C>. <C>OutputOf</C> is the one you&apos;ll
        reach for most: it types a step&apos;s parameter from the node before it, so the step follows along when you add
        a question.
      </P>
      <Snippet code={TYPES} file="types.ts" />

      <H2 id="nesting">Nesting</H2>
      <P>
        A chain is a node, so chains go anywhere nodes go: inside other chains, as <C>route</C> branches, as{" "}
        <C>gate</C> paths, as <C>parallel</C> branches, as a <C>cascade</C> fallback. Nesting is free. A chain has no
        vertex of its own in the graph; its steps are just laid end to end, and in the trace it&apos;s a span whose
        children are its steps (paths like <C>$/moderate/0</C>, <C>$/moderate/1</C>).
      </P>
      <Snippet code={NESTING} file="desk.ts" />
      <P>
        Want a friendlier label in the studio and the graph? <C>describe(node, {"{ title, description }"})</C> returns a
        copy with UI metadata attached.
      </P>
      <Snippet code={DESCRIBE} file="desk.ts" />
      <DocExample
        id="docs-excuse-evaluator"
        caption={
          <>
            A cleanup step, then a nested <C>evaluate</C> chain: one <C>ask</C> with two questions and a <C>step</C> typed
            with <C>OutputOf</C>. Try blaming Dave.
          </>
        }
      />

      <H2 id="limits">Seven links, then nest</H2>
      <P>
        The typed overloads cover one to seven nodes. That&apos;s not a runtime limit; it&apos;s where the type
        signatures stop. Past seven you&apos;ll get an overload error, and the fix is the one you&apos;d want anyway:
      </P>
      <List>
        <Li>Group related links into named sub-chains. Seven anonymous steps in a row is a code smell with a trace.</Li>
        <Li>
          Named sub-chains show up as their own spans, so &ldquo;which part was slow?&rdquo; is answered by looking, not
          by adding logs.
        </Li>
        <Li>They&apos;re reusable: the same sub-chain can sit in two routes. Ids needn&apos;t be unique; paths are.</Li>
      </List>
      <Callout tone="note" title="empty chains">
        <p>
          <C>chain(&quot;id&quot;)</C> with no nodes throws a <C>TypeError</C> immediately, and a chain loaded from JSON
          with no steps is a <C>ChainConfigError</C>. There&apos;s nothing to sequence.
        </p>
      </Callout>
    </DocPage>
  );
}
