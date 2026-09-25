import { DocExample } from "@/components/docs/doc-example";
import { A, ApiTable, C, Callout, Cell, DocPage, H2, H3, Li, List, P, Snippet, TwoUp } from "@/components/docs/doc-ui";
import { Code } from "@/components/ui/code-block";
import { docMetadata } from "@/docs/nav";

export const metadata = docMetadata("questions");

const CHOICE = `import { choice } from "jevchain";

// labels only: criteria are null
choice("Which team?", ["billing", "bug", "vibes"]);

// labels with descriptions: Jev reads them
choice("Which team?", {
  billing: "money, invoices, refunds",
  bug: "something is broken",
  vibes: "no actionable content, just vibes",
});`;

const CHOICE_ANSWER = `{
  "type": "choice",
  "choice": "billing",
  "probabilities": { "billing": 0.94, "bug": 0.05, "vibes": 0.01 },
  "confidence": 0.81
}`;

const SCORE = `import { score } from "jevchain";

score("How spicy is this take?", [
  "mild",                        // level 0
  "medium",                      // level 1
  "call the fire department",    // level 2
]);`;

const SCORE_ANSWER = `{
  "type": "score",
  "score": 1.62,
  "probabilities": { "0": 0.08, "1": 0.22, "2": 0.70 },
  "legend": { "0": "mild", "1": "medium", "2": "call the fire department" },
  "confidence": 0.37
}`;

const NOUL = `import { noul } from "jevchain";

noul("Is the user blocked right now?");

noul("Is the user blocked right now?", {
  true: "cannot do their job",
  false: "mild inconvenience",
});`;

const NOUL_ANSWER = `{
  "type": "noul",
  "noul": 0.87
}`;

const TYPES = `const read = ask("read", {
  questions: {
    mood: choice("Mood?", ["cursed", "blessed"]),
    spice: score("Spice?", ["mild", "hot"]),
    drama: noul("Is there drama?"),
  },
});

type Out = OutputOf<typeof read>;
// {
//   mood:  ChoiceAnswer<"cursed" | "blessed">;
//   spice: ScoreAnswer;
//   drama: NoulAnswer;
// }

type Mood = Out["mood"]["choice"]; // "cursed" | "blessed"

step("react", (a: Out) => {
  if (a.mood.choice === "cursd") {} // ✗ no overlap with "cursed" | "blessed"
  return a.mood.probabilities.blessed; // number
});`;

const CONFIDENCE = `import { confidenceOf } from "jevchain";

confidenceOf({ type: "choice", choice: "bug", probabilities: { bug: 0.5, billing: 0.5 }, confidence: 0 }); // 0
confidenceOf({ type: "noul", noul: 0.5 });  // 0    (a coin flip)
confidenceOf({ type: "noul", noul: 0.95 }); // 0.9  (|0.95 − 0.5| × 2)
confidenceOf({ type: "noul", noul: 0.02 }); // 0.96 (sure it's a no)`;

export default function QuestionsPage() {
  return (
    <DocPage slug="questions">
      <H2 id="three-types">The three types</H2>
      <P>
        Everything Jev can be asked is one of three shapes. They mirror TypeSafe&apos;s <C>/v1/systemone</C> wire format
        exactly, so a question built with these helpers is sent to the API untouched. The helpers exist to validate
        your input and carry your labels through to the answer types.
      </P>
      <ApiTable
        rows={[
          {
            name: "choice(instructions, labels)",
            type: "ChoiceQuestion<L>",
            children: (
              <>
                Pick exactly one label. 2–255 options. Answers with the winning label, a probability per label and a
                confidence.
              </>
            ),
          },
          {
            name: "score(instructions, levels)",
            type: "ScoreQuestion",
            children: (
              <>
                Rate on an ordered rubric, lowest level first. 2–10 levels. Answers with a probability-weighted level
                that can land between levels.
              </>
            ),
          },
          {
            name: "noul(instructions, criteria?)",
            type: "NoulQuestion",
            children: (
              <>
                Yes or no. Answers with <code>noul</code>: the probability of yes, 0–1.
              </>
            ),
          },
        ]}
      />
      <P>
        <C>instructions</C> is an <C>Entry</C>: a string, a JSON object, a JSON array or <C>null</C>. The same goes for
        each label&apos;s or level&apos;s description. Bad shapes throw a <C>TypeError</C> right away, when the
        question is built, not three nodes into a run.
      </P>

      <H2 id="choice">choice</H2>
      <P>
        Pass an array when the labels speak for themselves, or an object when Jev would benefit from a description.
        Descriptions are the cheapest accuracy you&apos;ll ever buy.
      </P>
      <Snippet code={CHOICE} file="choice.ts" />
      <P>
        The answer&apos;s <C>choice</C> is the highest-probability label, and <C>probabilities</C> covers every label
        and sums to 1:
      </P>
      <Code code={CHOICE_ANSWER} className="my-4 border-soft bg-surface px-4 py-3" />

      <H2 id="score">score</H2>
      <P>
        Levels are ordered, and the index is the level: <C>0</C> is the first one. Instead of picking one, Jev spreads
        probability across the levels, and <C>score</C> is the probability-weighted average. That makes it a smooth
        number you can put a threshold on.
      </P>
      <Snippet code={SCORE} file="score.ts" />
      <Code code={SCORE_ANSWER} className="my-4 border-soft bg-surface px-4 py-3" />
      <P>
        <C>legend</C> maps each level index back to its description, so a trace can be read on its own without the
        chain next to it.
      </P>

      <H2 id="noul">noul</H2>
      <P>
        A yes/no question, answered as p(yes). The optional criteria tell Jev what counts as <C>true</C> and what
        counts as <C>false</C>, which helps a lot on questions that humans would also argue about.
      </P>
      <TwoUp>
        <Cell label="question">
          <Code code={NOUL} className="text-[11.5px]" />
        </Cell>
        <Cell label="answer">
          <Code code={NOUL_ANSWER} className="text-[11.5px]" />
        </Cell>
      </TwoUp>
      <Callout tone="note" title="why “noul”?">
        <p>
          It&apos;s TypeSafe&apos;s name for the type, and we kept it so the wire format and the library read the same.
          You&apos;ll get used to it. Probably 0.91.
        </p>
      </Callout>

      <H2 id="inferred-types">Inferred answer types</H2>
      <P>
        Choice labels are captured as a <C>const</C> type parameter, so answers come back typed with your literal
        labels, not <C>string</C>. Put questions in an <A href="/docs/ask">ask</A> and its output type has one answer
        per key, each typed for its question.
      </P>
      <Snippet code={TYPES} file="types.ts" />
      <List>
        <Li>
          <C>AnswerOf&lt;Q&gt;</C> maps a question type to its answer type. <C>Answers&lt;Qs&gt;</C> does it for a
          whole question object.
        </Li>
        <Li>
          <C>LabelsOf&lt;Q&gt;</C> pulls out a choice&apos;s label union, for when you want it on its own.
        </Li>
      </List>
      <DocExample
        id="docs-plant-check"
        caption={
          <>
            One <C>ask</C> with one question of each type. Jev reads the plant&apos;s complaint once and answers all
            three questions in a single call.
          </>
        }
      />

      <H2 id="confidence">Confidence</H2>
      <P>
        Every answer can say how sure it is on the same 0–1 scale. Choice and score answers carry Jev&apos;s own{" "}
        <C>confidence</C>, where 0 means the distribution was uniform and 1 means all-in on one option. Nouls
        don&apos;t carry one, so <C>confidenceOf</C> measures the distance from a coin flip: 0.5 maps to 0, and 0 or 1
        maps to 1.
      </P>
      <Snippet code={CONFIDENCE} file="confidence.ts" />
      <H3 id="where-its-used">Where confidence is used</H3>
      <List>
        <Li>
          <A href="/docs/route#low-confidence">route&apos;s lowConfidence</A>: take a safe path when the winning label
          isn&apos;t convincing.
        </Li>
        <Li>
          <A href="/docs/gate#unsure">gate&apos;s unsure.minConfidence</A>: call it too close to call.
        </Li>
        <Li>
          <A href="/docs/cascade">cascade</A> tiers: accept a tier&apos;s answer only at or above its{" "}
          <C>minConfidence</C>, otherwise escalate.
        </Li>
      </List>
    </DocPage>
  );
}
