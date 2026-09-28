import { CAPS, LIMITS, type RatedQuestion, type Recipe, type RecipeNode, type RecipeOutcome } from "@/lib/recipe/types";
import { gate, outcome, pick, rate, recipe, route, scale, yesNo } from "./build";

/**
 * The biggest recipe the validator lets through, for measuring share links.
 *
 * - 40 nodes, 30 questions and 10 decisions deep: every `LIMITS` cap.
 * - Every string at its `CAPS` length: title, thing, keys, node titles,
 *   questions, `means`, labels and their descriptions, levels, and outcome
 *   stamps and lines. Every rate has `CAPS.bands.max` bands.
 * - Every gate has `means`. One gate has `unsure` and one route has
 *   `lowConfidence`, so both escape hatches are in the tree; the rest of the
 *   node budget goes to route labels, which cost more than an escape hatch.
 *   Routes have 6, 6, 5, 5 and 5 labels.
 *
 * The spine is 5 gates and 5 routes, alternating, and ends at a 6-question
 * rate. Each gate continues on `no` and each route on its first label, which
 * is what the fake Jev's default answers (noul 0.1, the first label at 0.9)
 * pick, so a default run is the deepest and most questioned one: 11 spans,
 * 16 answers. The other 29 children hang off the spine as leaves: 3 more
 * rates and 26 outcomes.
 *
 * The text is pseudo-random words from a fixed seed, so nothing in it repeats
 * and the numbers don't depend on repeated strings compressing well.
 */
export function everyCapRecipe(seed = 63): Recipe {
  const words = new Words(seed);
  const end = (): RecipeOutcome => outcome(words.key(), words.text(CAPS.stamp), words.text(CAPS.line));
  const title = () => ({ title: words.text(CAPS.nodeTitle) });
  const bands = (): [number, RecipeOutcome][] => {
    const n = CAPS.bands.max;
    return Array.from({ length: n }, (_, i) => [(n - 1 - i) / n, end()]);
  };
  const labels = (n: number) => {
    const out: Record<string, string> = {};
    while (Object.keys(out).length < n) out[words.label()] = words.text(CAPS.labelDescription);
    return out;
  };
  const choiceQ = (): RatedQuestion => {
    const l = labels(CAPS.labels.max);
    return pick(words.key(), words.text(CAPS.question), CAPS.maxWeight, l, Object.keys(l).slice(0, 3));
  };
  const scoreQ = (): RatedQuestion =>
    scale(
      words.key(),
      words.text(CAPS.question),
      CAPS.maxWeight,
      Array.from({ length: CAPS.levels.max }, () => words.text(CAPS.level)),
      "high",
    );
  const noulQ = (): RatedQuestion => yesNo(words.key(), words.text(CAPS.question), CAPS.maxWeight, true);
  const rated = (questions: RatedQuestion[]) => rate(words.key(), questions, bands(), title());

  // The spine's end, and the three rates that hang off it.
  const deepest = rated([choiceQ(), choiceQ(), choiceQ(), choiceQ(), scoreQ(), noulQ()]);
  const side = [
    rated([choiceQ(), choiceQ(), choiceQ(), choiceQ(), choiceQ(), scoreQ()]),
    rated([choiceQ(), choiceQ(), choiceQ(), choiceQ(), choiceQ(), choiceQ()]),
    rated([choiceQ(), noulQ()]),
  ];
  const offSpine = (): RecipeNode => side.shift() ?? end();

  // Built from the bottom up. Route sizes, from the bottom: 5, 5, 5, 6, 6.
  // The top gate has `unsure` and the top route `lowConfidence`.
  let node: RecipeNode = deepest;
  for (let i = LIMITS.depth - 1; i >= 0; i--) {
    if (i % 2 === 1) {
      const l = labels(i >= 5 ? CAPS.labels.max - 1 : CAPS.labels.max);
      const [first, ...rest] = Object.keys(l);
      const branches: Record<string, RecipeNode> = { [first!]: node };
      for (const label of rest) branches[label] = offSpine();
      const q = words.text(CAPS.question);
      node = route(words.key(), q, l, branches, { ...title(), ...(i === 1 ? { lowConfidence: offSpine() } : {}) });
    } else {
      const means = { yes: words.text(CAPS.means), no: words.text(CAPS.means) };
      const key = words.key();
      const q = words.text(CAPS.question);
      node = gate(key, q, offSpine(), node, { ...title(), means, ...(i === 0 ? { unsure: offSpine() } : {}) });
    }
  }
  return recipe(words.text(CAPS.title), words.text(CAPS.thing), node);
}

/** Pseudo-random text: made-up words of one to three syllables, seeded. */
export class Words {
  private state: number;
  private used = new Set<string>();

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Exactly `length` characters of words and spaces, with no space at either end. */
  text(length: number): string {
    return this.join(length, " ");
  }

  /** A node or rated-question key, full length and unique. */
  key(): string {
    return this.fresh(() => this.join(CAPS.key, "-"));
  }

  /** A route or choice label, full length and unique. */
  label(): string {
    return this.fresh(() => this.join(CAPS.label, "-"));
  }

  private fresh(make: () => string): string {
    let s = make();
    while (this.used.has(s)) s = make();
    this.used.add(s);
    return s;
  }

  private join(length: number, sep: string): string {
    let s = this.word();
    while (s.length < length) s += sep + this.word();
    s = s.slice(0, length);
    // A cut that ends on the separator would lose a character to trimming.
    return s.endsWith(sep) ? s.slice(0, -1) + "a" : s;
  }

  private word(): string {
    const consonants = "bcdfghjkmnprstvwz";
    const vowels = "aeiou";
    let w = "";
    for (let n = 1 + this.next(3); n > 0; n--) w += consonants[this.next(consonants.length)]! + vowels[this.next(vowels.length)]!;
    return w;
  }

  /** A whole number from 0 to `n - 1` (mulberry32). */
  private next(n: number): number {
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return Math.floor((((t ^ (t >>> 14)) >>> 0) / 2 ** 32) * n);
  }
}
