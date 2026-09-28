import type { Recipe, RecipeNode } from "@/lib/recipe/types";
import { bands3, gate, outcome, pick, rate, recipe, route, scale, yesNo } from "./build";

/**
 * `depth` nested gates keyed g1..gN. Each continues on `yes` when `on` is
 * "yes" (on `no` otherwise) and the other side ends at outcome `stop-N`. The
 * innermost child is outcome `through`.
 */
export function ladder(depth: number, on: "yes" | "no" = "no"): Recipe {
  let node: RecipeNode = outcome("through", "Cleared", "Cleared every gate on the ladder.");
  for (let n = depth; n >= 1; n--) {
    const stop = outcome(`stop-${n}`, `Held at gate ${n}`, `Held at gate ${n} pending review.`);
    node = on === "yes" ? gate(`g${n}`, `Does it stop at gate ${n}?`, node, stop) : gate(`g${n}`, `Does it stop at gate ${n}?`, stop, node);
  }
  return recipe("The Ladder Desk", "the ladder", node);
}

/**
 * A small dispatch desk with every node kind and both escape hatches:
 *
 * - `kind` (route): ghost / bill / other, low confidence to `ask-dave`.
 * - `ghost` → `danger` (gate with means and unsure): yes `evacuate`, no
 *   `exorcist`, unsure `priest`.
 * - `bill` → `refund` (rate with three bands).
 * - `other` → `drafty` (outcome).
 */
export function desk(): Recipe {
  return recipe(
    "The Appliance Dispatch Desk",
    "your appliance ticket",
    route(
      "kind",
      "Which team should handle this ticket?",
      {
        ghost: "Behaviour no appliance can do.",
        bill: "Payments, refunds or invoices.",
        other: "An ordinary fault.",
      },
      {
        ghost: gate(
          "danger",
          "Is anyone in physical danger?",
          outcome("evacuate", "Evacuation ordered", "Leave the building. A priest is on the way."),
          outcome("exorcist", "Exorcist booked", "Booked: one (1) exorcist. Please remove fragile items."),
          {
            title: "Anyone in danger?",
            means: { yes: "fire, smoke or injury", no: "spooky but harmless" },
            unsure: outcome("priest", "Priest consulted", "A priest will review the file at their leisure."),
          },
        ),
        bill: rate(
          "refund",
          [
            yesNo("charged-twice", "Were they charged twice?", 2, true),
            scale("anger", "How angry are they?", 1, ["calm", "cross", "furious"], "low"),
            pick("channel", "How did they pay?", 1, { card: "By card", cash: "In cash" }, ["card"]),
          ],
          [
            [0.66, outcome("refund-full", "Refund issued", "A full refund has been issued.")],
            [0.4, outcome("refund-half", "Half refunded", "Half a refund has been issued, pending the other half.")],
            [0, outcome("refund-none", "Refund declined", "No refund. Please keep the receipt anyway.")],
          ],
          { title: "Refund owed?" },
        ),
        other: outcome("drafty", "Window closed", "Closed a window for you, spiritually."),
      },
      { title: "Front desk", lowConfidence: outcome("ask-dave", "Sent to Dave", "A human will read this. Probably Dave.") },
    ),
  );
}

/** A gate on "Is it ok?" in front of a one-question rate keyed `vibes`, or `stopped` on no. */
export function gatedRate(): Recipe {
  return recipe(
    "The Vibes Desk",
    "the vibes",
    gate(
      "ok",
      "Is it ok?",
      rate("vibes", [yesNo("good", "Is it good?", 1, true)], bands3("vibes")),
      outcome("stopped", "Stopped", "It stopped at the first gate."),
    ),
  );
}
