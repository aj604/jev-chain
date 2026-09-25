import { DocExample } from "@/components/docs/doc-example";
import { A, ApiTable, C, Callout, DocPage, H2, Li, List, P, Snippet } from "@/components/docs/doc-ui";
import { claims } from "@/docs/claims";
import { docMetadata } from "@/docs/nav";

export const metadata = docMetadata("cascade");

const BASICS = `import { cascade, tier, choice, step } from "jevchain";

const verdict = choice("Should the recipient reply to this text message?", {
  reply: "Replying is kind, safe and likely to lead somewhere good.",
  "leave-on-read": "Replying would restart something unhealthy, or the message doesn't need a reply.",
});

const decide = cascade("should-i-reply", {
  tiers: [
    // Cheap: only the message itself.
    tier("gut-check", { ask: verdict, minConfidence: 0.7, state: "{{input.message}}" }),
    // Thorough: the whole input, history and receipts included.
    tier("full-context", { ask: verdict, minConfidence: 0.5 }),
  ],
  // Nobody was sure. Hand off to something that isn't Jev.
  fallback: step("ask-the-group-chat", () => "Screenshot it and send it to the group chat."),
});`;

const FALLBACK_LLM = `const decide = cascade("refund-policy", {
  tiers: [tier("quick", { ask: isRefundable, minConfidence: 0.8 })],
  fallback: step("ask-an-llm", async (ticket: Ticket, ctx) => {
    ctx.log("escalating to the expensive model");
    return llm.complete({ prompt: render(ticket), signal: ctx.signal });
  }, { timeoutMs: 20_000, retries: 1 }),
});`;

const RESULT = `const next = step("verdict", (r: OutputOf<typeof decide>) => {
  if (r.resolvedBy === "fallback") return r.output;   // whatever the fallback returned
  // r.tier: which rung answered ("gut-check" | "full-context", as a string)
  // r.answer: the typed answer, ChoiceAnswer<"reply" | "leave-on-read">
  return r.answer.choice === "reply" ? "Reply." : "Leave them on read.";
});`;

const RESULT_TYPE = `type CascadeResult<Tiers, F> =
  | { resolvedBy: "tier"; tier: string; answer: AnswerOf<Tiers[number]["ask"]> }
  | { resolvedBy: "fallback"; output: F };`;

export default function CascadePage() {
  return (
    <DocPage slug="cascade">
      <H2 id="basics">Basics</H2>
      <P>
        Most inputs are easy. A cascade asks the cheap question first and only climbs to a more expensive one when Jev
        isn&apos;t confident enough. When no rung is sure, it hands off to a <strong>fallback</strong>, which can be any
        node at all: an LLM, a human queue, a coin.
      </P>
      <Snippet code={BASICS} file="text-them-back.ts" />
      <P>
        Tiers run in order, one Jev call each. The first tier whose confidence clears its <C>minConfidence</C> answers,
        and the rest never run. So on easy inputs you pay for one small call; on hard ones you pay for exactly as much
        thinking as it took.
      </P>
      <DocExample
        id="text-them-back"
        caption={
          <>
            Tier one reads only the message. If that&apos;s not enough, tier two reads the full context. If that&apos;s{" "}
            <em>still</em> a coin flip, the group chat decides. Try &ldquo;u up?&rdquo; versus &ldquo;the ex, again&rdquo;.
          </>
        }
      />

      <H2 id="tiers">Tiers</H2>
      <P>
        Build each rung with <C>tier(id, config)</C>. A tier asks exactly one question of any type, and its confidence is{" "}
        <A href="/docs/questions#confidence">
          <C>confidenceOf(answer)</C>
        </A>
        : Jev&apos;s own confidence for choice and score, distance from a coin flip for noul. It accepts when that number
        is <strong>at least</strong> <C>minConfidence</C>; otherwise it escalates.
      </P>
      <ApiTable
        caption="tier(id, config)"
        rows={[
          { name: "id", type: "string", children: <>Names the rung in the result and the trace. <code>&quot;fallback&quot;</code> is reserved.</> },
          { name: "ask", type: "Question", children: "The question this rung asks. Rungs can ask the same question or different ones." },
          { name: "minConfidence", type: "number (0–1)", children: "Accept this rung's answer at or above this confidence." },
          {
            name: "state",
            type: "string | (input) => Entry",
            default: "the input",
            children: (
              <>
                What this rung shows Jev. The trick of a good cascade: give early rungs <em>less</em> (a template like{" "}
                <code>{"\"{{input.message}}\""}</code>), later rungs more.
              </>
            ),
          },
          { name: "model", type: "string", default: "client's", children: <>Pin a model for this rung, e.g. <code>jev-1.13.0</code>.</> },
          { name: "title", type: "string", children: "Label for UIs." },
        ]}
      />
      <Callout tone="note" title="the rules, checked at load time">
        <p>
          A cascade needs at least one tier, tier ids must be unique, and every <C>minConfidence</C> is 0–1.{" "}
          <C>cascade()</C> throws on zero tiers; the rest are reported as a <C>ChainConfigError</C> before anything
          runs.
        </p>
      </Callout>

      <H2 id="fallback">The fallback</H2>
      <P>
        The fallback is a node. It runs with the cascade&apos;s <strong>input</strong> (not the tiers&apos; answers) and
        its output lands in the result. A <C>step</C> is the usual choice, because that&apos;s where your code, and your
        more expensive model, lives:
      </P>
      <Snippet code={FALLBACK_LLM} file="refunds.ts" />
      <P>
        It could just as well be an <C>emit</C> (&ldquo;a human will get back to you&rdquo;), a <C>route</C> or a whole
        chain. In the graph, tiers are drawn as a ladder: dotted <strong>escalate</strong> edges climb from rung to rung
        and finally to the fallback.
      </P>

      <H2 id="result">Reading the result</H2>
      <P>
        A cascade outputs a tagged union, so you can&apos;t read an answer without first checking who gave it:
      </P>
      <Snippet code={RESULT_TYPE} file="nodes.ts" />
      <Snippet code={RESULT} file="text-them-back.ts" />
      <P>The decision in the trace records the climb:</P>
      <List>
        <Li>
          <C>metric</C> is <C>&quot;confidence&quot;</C>, and every tier is an edge whose <C>value</C> is the confidence
          it reached (<C>null</C> for rungs that never ran).
        </Li>
        <Li>
          <C>taken</C> is the tier id that answered, or <C>&quot;fallback&quot;</C>.
        </Li>
        <Li>
          <C>tierBars</C> records every rung&apos;s <C>minConfidence</C> by tier id, so you can see how close each one
          came.
        </Li>
        <Li>
          <C>summary</C> spells it out, e.g. <em>{claims.cascadeSummary}</em>
        </Li>
      </List>
      <Callout tone="tip" title="tuning the bars">
        <p>
          Run a sample of real inputs and look at where they resolved. If everything falls through to the fallback, the
          bars are too high. If the cheap rung answers everything, including cases it gets wrong, they&apos;re too low.{" "}
          <A href="/docs/traces#diff">diffTraces</A> helps compare runs.
        </p>
      </Callout>
    </DocPage>
  );
}
