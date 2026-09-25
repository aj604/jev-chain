import { DocExample } from "@/components/docs/doc-example";
import { A, ApiTable, C, Callout, DocPage, H2, H3, Li, List, P, Snippet } from "@/components/docs/doc-ui";
import { docMetadata } from "@/docs/nav";

export const metadata = docMetadata("gate");

const BASIC = `import { gate, noul, emit } from "jevchain";

const urgent = gate("is-urgent", {
  ask: noul("Is the user blocked right now?"),
  pass: { min: 0.7 },
  then: pageOnCall,
  otherwise: emit("file a ticket"),
});`;

const THRESHOLDS = `// noul: measures p(yes)
gate("safe", { ask: noul("Is anyone in danger?"), pass: { max: 0.5 }, then: carryOn });

// score: measures the probability-weighted level (0 = first level)
gate("needs-a-meeting", {
  ask: score("How much does this need people live?", ["slack", "email", "doc", "call", "meeting"]),
  pass: { min: 2.5 },
  then: keepIt,
});

// choice: measures p(label). The label is required, and typed.
gate("is-billing", {
  ask: choice("What is this?", ["billing", "bug", "vibes"]),
  pass: { label: "billing", min: 0.8 },
  then: toBilling,
});

// min and max together: a window
gate("goldilocks", { ask: noul("Is the porridge hot?"), pass: { min: 0.4, max: 0.6 }, then: eat });`;

const UNSURE = `gate("dress-code", {
  ask: noul("Is this outfit appropriate for a fancy rooftop bar?"),
  pass: { min: 0.6 },
  then: welcome,
  otherwise: turnAway,
  unsure: { margin: 0.1, then: getManager },    // 0.5 < p(yes) < 0.7
});

gate("vibe-check", {
  ask: choice("Tone?", ["friendly", "hostile", "neutral"]),
  pass: { label: "friendly", min: 0.5 },
  then: reply,
  unsure: { minConfidence: 0.3, then: askAHuman }, // flat distributions go to a human
});`;

const HALTED = `const result = await jev.run(bouncer, "Running shorts and one AirPod.");

result.status;        // "halted"
result.output;        // undefined
result.trace.halted;  // {
                      //   path: "$", nodeId: "dress-code",
                      //   summary: "Blocked: p(yes) = 0.12, short of the 0.60 bar easily (by 0.48), so the run stopped here."
                      // }`;

export default function GatePage() {
  return (
    <DocPage slug="gate">
      <H2 id="basics">Basics</H2>
      <P>
        <C>gate</C> asks one question, turns the answer into a single number, and checks it against a bar. Clear it
        and the input flows on to <C>then</C>. Miss it and the input goes to <C>otherwise</C>, or, if you didn&apos;t
        give one, the run stops.
      </P>
      <Snippet code={BASIC} file="is-urgent.ts" />
      <ApiTable
        caption="gate(id, config)"
        rows={[
          { name: "ask", type: "Question", children: <>A choice, score or noul.</> },
          {
            name: "pass",
            type: "{ min?, max?, label? }",
            children: (
              <>
                The bar. Set <code>min</code>, <code>max</code> or both (inclusive). <code>label</code> is required
                for a choice and not allowed otherwise.
              </>
            ),
          },
          { name: "then", type: "JevNode", children: <>Runs when the bar is cleared.</> },
          {
            name: "otherwise",
            type: "JevNode",
            default: "halt",
            children: <>Runs when it isn&apos;t. Omit it to halt the run instead.</>,
          },
          {
            name: "unsure",
            type: "{ margin?, minConfidence?, then }",
            children: <>A third path for close calls. Checked before pass/fail.</>,
          },
          { name: "alsoAsk", type: "Questions", children: <>Extra questions in the same call, recorded in the trace.</> },
          { name: "state / model", type: "…", children: <>As in <A href="/docs/ask#state">ask</A>.</> },
        ]}
      />
      <P>
        Like a route, a gate passes its <em>input</em> through unchanged. Its output type is the union of whichever
        paths you gave it.
      </P>

      <H2 id="thresholds">Thresholds per question type</H2>
      <P>What gets compared to the bar depends on the question:</P>
      <ApiTable
        rows={[
          {
            name: "noul",
            type: "metric: noul",
            children: <>p(yes), 0–1.</>,
          },
          {
            name: "score",
            type: "metric: score",
            children: (
              <>
                The probability-weighted level, where 0 is the first level. A 5-level rubric gives 0–4, so bars
                aren&apos;t limited to 0–1.
              </>
            ),
          },
          {
            name: "choice",
            type: "metric: probability",
            children: (
              <>
                p(<code>pass.label</code>). The label is typed against the question&apos;s labels.
              </>
            ),
          },
        ]}
      />
      <Snippet code={THRESHOLDS} file="thresholds.ts" />
      <P>
        Every gate decision gets a one-sentence <C>summary</C> in the trace, templated from the numbers:
      </P>
      <List>
        <Li>
          <em>Passed: p(yes) = 0.83, clearing the 0.60 bar comfortably (by 0.23).</em>
        </Li>
        <Li>
          <em>
            Blocked: the score came in at 1.40, short of the 2.50 bar easily (by 1.10), so took &ldquo;otherwise&rdquo;.
          </em>
        </Li>
        <Li>
          <em>Passed: p(yes) = 0.04, under the 0.50 ceiling easily (by 0.46).</em>
        </Li>
      </List>
      <Callout tone="note" title="checked twice">
        <p>
          The type checker handles the label. At runtime, <C>chainIssues</C> also rejects a gate with no{" "}
          <C>min</C>/<C>max</C>, a choice gate whose label isn&apos;t an option, and bars outside 0–1 on nouls and
          choices.
        </p>
      </Callout>

      <H2 id="unsure">The unsure band</H2>
      <P>
        A value of 0.61 against a 0.60 bar isn&apos;t a pass. It&apos;s a shrug with a decimal point. <C>unsure</C>
        gives close calls their own path, and it&apos;s checked <em>before</em> pass/fail. There are two triggers, and
        either one is enough:
      </P>
      <List>
        <Li>
          <strong>
            <C>margin</C>
          </strong>
          : unsure when <C>|value − bar| &lt; margin</C>, where the bar is <C>min</C>, or <C>max</C> if there&apos;s
          no min.
        </Li>
        <Li>
          <strong>
            <C>minConfidence</C>
          </strong>
          : unsure when the answer&apos;s confidence is below it. For choice and score answers that&apos;s Jev&apos;s{" "}
          <C>confidence</C>. For a noul it&apos;s <C>|p − 0.5| × 2</C>, the distance from a coin flip (see{" "}
          <A href="/docs/questions#confidence">confidenceOf</A>).
        </Li>
      </List>
      <Snippet code={UNSURE} file="unsure.ts" />
      <P>
        The trace says so plainly: <em>Too close to call: p(yes) = 0.64, right next to the 0.60 bar, so it took the
        &ldquo;unsure&rdquo; path.</em>
      </P>
      <DocExample
        id="meeting-email"
        caption={
          <>
            A score gate at 2.5 on a 0–4 rubric, with a 0.4 margin. Anything strictly between 2.1 and 2.9 gets a
            counter-offer instead of a coin flip.
          </>
        }
      />

      <H2 id="halting">Halting</H2>
      <P>
        Leave out <C>otherwise</C> and a gate becomes a guard: miss the bar and the run stops right there. Halting
        isn&apos;t an error. Nothing threw; the chain decided to stop. <C>run</C> resolves with status{" "}
        <C>&quot;halted&quot;</C>, no output, and a <C>trace.halted</C> saying where and why.
      </P>
      <Snippet code={HALTED} file="halt.ts" />
      <H3 id="halting-in-graphs">In graphs and traces</H3>
      <List>
        <Li>
          <C>graphOf</C> draws a <C>halt</C> vertex hanging off the gate, so the stop is visible before anything runs.
        </Li>
        <Li>
          The gate&apos;s decision has <C>taken: &quot;halt&quot;</C>, and its span, plus any enclosing ones, end with
          status <C>halted</C>. Siblings still running in a <C>parallel</C> are closed too.
        </Li>
        <Li>
          <C>explainTrace</C> ends with <em>Halted at dress-code.</em> followed by the gate&apos;s summary.
        </Li>
      </List>
      <DocExample
        id="docs-bouncer"
        caption={
          <>
            No <C>otherwise</C>: the gym fit halts the run. The smart-ish outfit tends to land in the unsure band and
            get the manager.
          </>
        }
      />
    </DocPage>
  );
}
