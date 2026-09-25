/**
 * Changing a node's kind without throwing away what you built.
 *
 * A node is a few parts wearing a kind: an id and title, questions, a
 * Jev-call config (state, model), child paths, and sometimes a "not sure"
 * path. `convertKind` takes those parts off the old node and puts each one
 * wherever the new kind has room for it:
 *
 *   - the id, title and description always stay, so `{{results.<id>}}`
 *     reads keep pointing at the node;
 *   - questions carry over in order (ask's questions ↔ a route/gate's
 *     question + alsoAsk ↔ a cascade's tiers); a route turns its question
 *     into a choice (a noul becomes yes/no, a score's levels become labels);
 *   - child paths go to the slot with the same name, then the one with the
 *     same meaning (a gate's `then` ↔ a `yes` branch), then in order; empty
 *     slots get a placeholder;
 *   - a route's `lowConfidence`, a gate's `unsure` and a cascade's `fallback`
 *     are the same idea and move into each other;
 *   - turning a node into a chain wraps it (a parallel's branches become the
 *     steps instead), and a node with no children becomes a parallel's only
 *     branch, so nothing is lost.
 *
 * Whatever has nowhere to go is reported in `dropped` (with how many nodes
 * it takes with it), and anything that would make it pick a different path
 * than before is reported in `changed` (a gate's pass rule a route can't
 * express, a parallel that would now run one branch, a read between chain
 * steps that would come up empty), so the UI can say so before anything
 * happens. A change with neither routes every run exactly as before.
 *
 *   const c = convertKind(root, "$/0", "gate");
 *   c.kept     // ["the question", "2 paths"]
 *   c.dropped  // [{ what: 'branch "just-a-draft"', nodes: 1 }]
 *   c.changed  // ['swaps the top pick for p(poltergeist) ≥ 0.50']
 */
import { DECISION_KEY, type Entry } from "jevchain";
import { flowWarnings } from "./data-flow";
import { allIds, childEdges, freshId, getAt, isPlaceholder, PLACEHOLDER, renameNode, subtreeSize, template, updateAt, type BuilderKind, type NodeJson } from "./doc-ops";
import { convertQuestion, freshKey, keyProblem, labelsOf, normalizePass, type QuestionJson, type ThresholdJson } from "./question-ops";

export interface KindChange {
  root: NodeJson;
  /** What to select afterwards: the converted node, or the new wrapper. */
  path: string;
  /** The old node now sits inside a new chain/parallel, untouched. */
  wrapped: boolean;
  /** What came along, for the menu hint: "the question", "3 paths". (Empty for a wrap: everything did.) */
  kept: string[];
  /** What had nowhere to go, and the nodes each takes with it. */
  dropped: { what: string; nodes: number }[];
  /** How it would now pick a path differently, as clauses: "stops halting when it doesn't pass". */
  changed: string[];
}

interface Asked {
  key: string;
  q: QuestionJson;
  /** Only from a cascade tier. */
  minConfidence?: number;
  title?: string;
}

interface Kid {
  label: string;
  node: NodeJson;
  /** What the slot means, when it means something: `then`/`yes` pass, `otherwise`/`no` fail. */
  role?: "pass" | "fail";
}

/** The low-confidence path: route `lowConfidence`, gate `unsure`, cascade `fallback`. */
interface Unsure {
  edge: string;
  node: NodeJson;
  /** The confidence bar it was taken under, when the kind has one. */
  below?: number;
  margin?: number;
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === "object" && v !== null && !Array.isArray(v);
const CALL_KINDS = new Set<string>(["ask", "route", "gate"]);

function questionsOf(n: NodeJson): Asked[] {
  const map = (m: unknown): Asked[] => (isRec(m) ? Object.entries(m).filter(([, q]) => isRec(q)).map(([key, q]) => ({ key, q: q as unknown as QuestionJson })) : []);
  switch (n.kind) {
    case "ask":
      return map(n.questions);
    case "route":
    case "gate":
      return [...(isRec(n.ask) ? [{ key: DECISION_KEY, q: n.ask as unknown as QuestionJson }] : []), ...map(n.alsoAsk)];
    case "cascade":
      return (Array.isArray(n.tiers) ? n.tiers : []).filter(isRec).map((t, i) => ({
        key: typeof t.id === "string" && t.id ? t.id : `tier-${i + 1}`,
        q: t.ask as QuestionJson,
        ...(typeof t.minConfidence === "number" ? { minConfidence: t.minConfidence } : {}),
        ...(typeof t.title === "string" ? { title: t.title } : {}),
      }));
    default:
      return [];
  }
}

function kidsOf(n: NodeJson): Kid[] {
  const edges = childEdges(n);
  switch (n.kind) {
    case "route":
    case "parallel":
      return edges.filter((e) => e.edge !== "lowConfidence").map((e) => ({ label: e.edge, node: e.node, ...roleOfLabel(e.edge) }));
    case "gate":
      return edges.filter((e) => e.edge !== "unsure").map((e) => ({ label: e.edge, node: e.node, role: e.edge === "then" ? "pass" : "fail" }));
    case "chain":
      return edges.map((e) => ({ label: e.node.id, node: e.node }));
    default:
      return [];
  }
}

function roleOfLabel(label: string): { role?: "pass" | "fail" } {
  const l = label.toLowerCase();
  if (l === "yes" || l === "true" || l === "then") return { role: "pass" };
  if (l === "no" || l === "false" || l === "otherwise") return { role: "fail" };
  return {};
}

function unsureOf(n: NodeJson): Unsure | undefined {
  if (n.kind === "route" && isRec(n.lowConfidence) && isRec(n.lowConfidence.then)) {
    const below = n.lowConfidence.below;
    return { edge: "lowConfidence", node: n.lowConfidence.then as NodeJson, ...(typeof below === "number" ? { below } : {}) };
  }
  if (n.kind === "gate" && isRec(n.unsure) && isRec(n.unsure.then)) {
    const { minConfidence, margin } = n.unsure;
    return { edge: "unsure", node: n.unsure.then as NodeJson, ...(typeof minConfidence === "number" ? { below: minConfidence } : {}), ...(typeof margin === "number" ? { margin } : {}) };
  }
  if (n.kind === "cascade" && isRec(n.fallback)) {
    const first = Array.isArray(n.tiers) && isRec(n.tiers[0]) ? n.tiers[0].minConfidence : undefined;
    return { edge: "fallback", node: n.fallback as NodeJson, ...(typeof first === "number" ? { below: first } : {}) };
  }
  return undefined;
}

/** A route's deciding question has to be a choice; keep what translates. */
function asChoice(q: QuestionJson): QuestionJson {
  if (q.type === "choice") return q;
  if (q.type === "noul") {
    const c = isRec(q.criteria) ? q.criteria : {};
    return { type: "choice", instructions: q.instructions ?? null, criteria: { yes: (c.true as Entry) ?? null, no: (c.false as Entry) ?? null } };
  }
  return convertQuestion(q, "choice");
}

const num = (v: number) => String(Math.round(v * 100) / 100);

/** A gate's pass rule in words: `p(yes) ≥ 0.7`, `0.2 ≤ score ≤ 3`. */
function passRule(q: QuestionJson, pass: ThresholdJson): string {
  const metric = q.type === "choice" ? `p(${pass.label ?? "?"})` : q.type === "noul" ? "p(yes)" : "score";
  if (pass.min !== undefined && pass.max !== undefined) return `${num(pass.min)} ≤ ${metric} ≤ ${num(pass.max)}`;
  return pass.max !== undefined ? `${metric} ≤ ${num(pass.max)}` : `${metric} ≥ ${num(pass.min ?? 0.5)}`;
}

/**
 * Where a gate's two paths go on the route it becomes (`labels` are the
 * route's, from `asChoice` of the gate's question): `then` on the label the
 * gate measures (the `no` side for a max-only rule), `otherwise` on its
 * opposite. A route takes the top pick, so that only routes the same way when
 * the gate's bar is the halfway point of a two-way choice; otherwise `rule` says
 * what's lost.
 */
function gatePlacement(gate: NodeJson, labels: string[]): { pass: string; fail: string; rule: string | null } {
  const q = gate.ask as QuestionJson;
  const p = (isRec(gate.pass) ? gate.pass : {}) as ThresholdJson;
  const maxOnly = p.max !== undefined && p.min === undefined;
  const hit = q.type === "choice" ? (p.label && labels.includes(p.label) ? p.label : labels[0]!) : q.type === "noul" ? "yes" : labels[labels.length - 1]!;
  const miss = q.type === "score" ? labels[0]! : labels.find((l) => l !== hit)!;
  const halfway = (p.min === 0.5 && p.max === undefined) || (p.max === 0.5 && p.min === undefined);
  const same = q.type !== "score" && labels.length === 2 && halfway;
  return { pass: maxOnly ? miss : hit, fail: maxOnly ? hit : miss, rule: same ? null : `swaps ${passRule(q, p)} for the top pick` };
}

/** Keys for a keyed map (route labels, parallel branches, question keys, tier ids): valid and distinct. */
function keyFor(base: string, taken: string[], reserved: string[] = []): string {
  const clean = base.trim().replace(/\//g, "-") || "option";
  const key = freshKey(clean, [...taken, ...reserved]);
  return keyProblem(key, taken) ? freshKey("option", [...taken, ...reserved]) : key;
}

const placeholder = (taken: Set<string>): NodeJson => {
  const id = freshId("emit", taken);
  taken.add(id);
  return { kind: "emit", id, value: PLACEHOLDER };
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Put children into named slots: same name first, then same meaning, then in
 * order. Returns the filled slots (missing → undefined) and what's left over.
 */
function assign(kids: Kid[], slots: { name: string; role?: "pass" | "fail" }[]): { placed: (Kid | undefined)[]; rest: Kid[] } {
  const left = [...kids];
  const placed: (Kid | undefined)[] = slots.map(() => undefined);
  const take = (i: number, pick: (k: Kid) => boolean) => {
    if (placed[i]) return;
    const at = left.findIndex(pick);
    if (at >= 0) placed[i] = left.splice(at, 1)[0];
  };
  slots.forEach((s, i) => take(i, (k) => k.label === s.name));
  slots.forEach((s, i) => s.role && take(i, (k) => k.role === s.role));
  slots.forEach((_, i) => take(i, () => true));
  return { placed, rest: left };
}

/** Can `from` turn into `kind`, and what would happen? Pure; nothing is committed. */
export function convertKind(root: NodeJson, path: string, kind: BuilderKind, taken: Set<string> = allIds(root)): KindChange {
  const from = getAt(root, path);
  if (!from) throw new Error(`no node at ${path}`);
  const kids = kidsOf(from);
  const unsure = unsureOf(from);
  const asked = questionsOf(from).filter((a) => isRec(a.q));
  const dropped: KindChange["dropped"] = [];
  const kept: string[] = [];
  const changed: string[] = [];
  const dropKid = (k: Kid) => !isPlaceholder(k.node) && dropped.push({ what: from.kind === "chain" ? `step "${k.node.id}"` : from.kind === "gate" ? `the ${k.label} path` : `branch "${k.label}"`, nodes: subtreeSize(k.node) });
  const dropUnsure = (u: Unsure | undefined) => u && !isPlaceholder(u.node) && dropped.push({ what: u.edge === "fallback" ? "the fallback" : u.edge === "unsure" ? "the unsure path" : "the low-confidence path", nodes: subtreeSize(u.node) });
  const dropQuestions = (qs: Asked[]) => {
    if (!qs.length) return;
    dropped.push({ what: qs.length === 1 ? (from.kind === "route" || from.kind === "gate" ? "the question" : `question "${qs[0]!.key}"`) : plural(qs.length, "question"), nodes: 0 });
  };
  const noteQuestions = (n: number) => n && kept.push(n === 1 ? "the question" : plural(n, "question"));
  const notePaths = (n: number) => n && kept.push(plural(n, "path"));
  const dropJoin = () => from.kind === "parallel" && from.join !== undefined && dropped.push({ what: "the join", nodes: 0 });
  const done = (node: NodeJson, how: "convert" | "wrap" | "fresh" = "convert"): KindChange => {
    let next = updateAt(root, path, node);
    // an id the builder made up for the old kind (`emit-3`) would only mislead on a gate; take one for the new kind (reads follow)
    let renamed: [string, string] | null = null;
    if (how === "convert" && new RegExp(`^${from.kind}-\\d+$`).test(from.id)) {
      const id = freshId(kind, taken);
      taken.add(id);
      next = renameNode(next, path, id);
      renamed = [from.id, id];
    }
    // a read that could find its node before and can't now (steps turned into sibling branches, say) is a change worth saying
    if (how !== "fresh") {
      const deadIn = (r: NodeJson, rename?: [string, string] | null) =>
        new Set(
          flowWarnings(r)
            .filter((w) => w.rule === "dead-read")
            .map((w) => {
              const id = getAt(r, w.path)?.id ?? "";
              return rename && id === rename[0] ? rename[1] : id;
            }),
        );
      const before = deadIn(root, renamed);
      for (const id of deadIn(next)) if (!before.has(id)) changed.push(`leaves reads in “${id}” coming up empty`);
    }
    return { root: next, path, wrapped: how === "wrap", kept, dropped, changed };
  };
  const unsureMargin = () => unsure?.margin !== undefined && changed.push(`loses the unsure margin ±${num(unsure.margin)}`);
  const runsOne = () => {
    if (from.kind === "parallel" && kids.length > 1) changed.push("runs one branch instead of all of them");
    if (from.kind === "chain" && kids.length > 1) changed.push(`runs one step instead of all ${kids.length} in order`);
  };

  // a placeholder has nothing to keep: it's a fresh node of the new kind
  if (isPlaceholder(from)) return done(template(kind, taken), "fresh");

  // ── wrapping: the old node goes inside, untouched ─────────────────────────
  const wrapChain = kind === "chain" && from.kind !== "parallel";
  const wrapParallel = kind === "parallel" && kids.length === 0 && !unsure;
  if (wrapChain || wrapParallel) {
    const id = freshId(kind, taken);
    taken.add(id);
    return done(kind === "chain" ? { kind, id, steps: [from] } : { kind, id, branches: { [keyFor(from.id, [])]: from } }, "wrap");
  }

  const meta: NodeJson = { kind, id: from.id };
  if (from.title !== undefined) meta.title = from.title;
  if (from.description !== undefined) meta.description = from.description;
  const call: Rec = {};
  const src = CALL_KINDS.has(from.kind) ? from : from.kind === "cascade" && Array.isArray(from.tiers) && isRec(from.tiers[0]) ? (from.tiers[0] as Rec) : {};
  if (src.state !== undefined) call.state = src.state;
  if (src.model !== undefined) call.model = src.model;
  const fresh = () => template(kind, taken);

  switch (kind) {
    case "ask": {
      dropJoin();
      kids.forEach(dropKid);
      dropUnsure(unsure);
      if (!asked.length) return done({ ...fresh(), ...meta, ...call });
      const questions: Rec = {};
      for (const a of asked) questions[keyFor(a.key, Object.keys(questions))] = a.q;
      noteQuestions(asked.length);
      return done({ ...meta, ...call, questions });
    }

    case "route":
    case "gate": {
      dropJoin();
      // an ask's questions are all equal, so a route decides on its first choice; anything else decides on the question it decided on
      const mainAt = kind === "route" && from.kind === "ask" ? Math.max(0, asked.findIndex((a) => a.q.type === "choice")) : 0;
      const main = asked[mainAt];
      const also = asked.filter((_, i) => i !== mainAt);
      const base = fresh();
      const ask = main ? (kind === "route" ? asChoice(main.q) : main.q) : (base.ask as QuestionJson);
      const node: Rec = { ...meta, ...call, ask };
      if (also.length) {
        const alsoAsk: Rec = {};
        for (const a of also) alsoAsk[keyFor(a.key, Object.keys(alsoAsk), [DECISION_KEY])] = a.q;
        node.alsoAsk = alsoAsk;
      }
      noteQuestions(asked.length);
      runsOne();
      if (from.kind === "cascade" && asked.length > 1) changed.push("lets only its first tier decide when to fall back");

      if (kind === "route") {
        let labels = labelsOf(ask);
        if (!main) {
          // no question to take labels from: the children name them
          const named: string[] = [];
          for (const k of kids) named.push(keyFor(k.label, named));
          while (named.length < 2) named.push(keyFor(named.length ? "right" : "left", named));
          labels = named;
          node.ask = { ...ask, criteria: Object.fromEntries(labels.map((l) => [l, null])) };
        }
        let placed: (Kid | undefined)[];
        let rest: Kid[];
        if (from.kind === "gate") {
          // then/otherwise go where the gate's rule points, not by name
          const g = gatePlacement(from, labels);
          placed = labels.map((l) => kids.find((k) => (k.label === "then" && l === g.pass) || (k.label === "otherwise" && l === g.fail)));
          rest = kids.filter((k) => !placed.includes(k));
          if (g.rule) changed.push(g.rule);
          if (from.otherwise === undefined) changed.push("stops halting when it doesn't pass");
        } else ({ placed, rest } = assign(kids, labels.map((l) => ({ name: l, ...roleOfLabel(l) }))));
        const branches: Rec = {};
        labels.forEach((l, i) => (branches[l] = placed[i]?.node ?? placeholder(taken)));
        node.branches = branches;
        notePaths(placed.filter(Boolean).length);
        rest.forEach(dropKid);
        if (unsure) {
          node.lowConfidence = { below: unsure.below ?? 0.6, then: unsure.node };
          if (!isPlaceholder(unsure.node)) kept.push(unsure.edge === "lowConfidence" ? "the low-confidence path" : `the ${unsure.edge === "fallback" ? "fallback" : "unsure path"} (as low confidence)`);
          unsureMargin();
          if (unsure.below === undefined) changed.push("takes it below confidence 0.6 instead");
          // a route's low confidence is Jev's confidence in the choice, which isn't a noul's closeness to 0.5 (or a score's)
          else if (main && main.q.type !== "choice") changed.push(`judges low confidence on the choice, not the ${main.q.type}`);
        }
        return done(node as NodeJson);
      }

      const { placed, rest } = assign(kids, [
        { name: "then", role: "pass" },
        { name: "otherwise", role: "fail" },
      ]);
      node.pass = normalizePass(ask, { ...(placed[0] && labelsOf(ask).includes(placed[0].label) ? { label: placed[0].label } : {}) });
      // a gate passes on p(label) ≥ 0.5, which is the top pick only between two labels
      if (from.kind === "route" && kids.length > 2) changed.push(`swaps the top pick for ${passRule(ask, node.pass as ThresholdJson)}`);
      node.then = placed[0]?.node ?? placeholder(taken);
      node.otherwise = placed[1]?.node ?? placeholder(taken);
      notePaths(placed.filter(Boolean).length);
      rest.forEach(dropKid);
      if (unsure) {
        node.unsure = { ...(unsure.margin !== undefined ? { margin: unsure.margin } : {}), ...(unsure.below !== undefined || unsure.margin === undefined ? { minConfidence: unsure.below ?? 0.6 } : {}), then: unsure.node };
        if (!isPlaceholder(unsure.node)) kept.push(unsure.edge === "unsure" ? "the unsure path" : `the ${unsure.edge === "fallback" ? "fallback" : "low-confidence path"} (as unsure)`);
      }
      return done(node as NodeJson);
    }

    case "cascade": {
      dropJoin();
      const tiers = asked.length
        ? asked.reduce<Rec[]>((out, a, i) => {
            const id = keyFor(a.key, out.map((t) => t.id as string), ["fallback"]);
            // the first tier's bar is the old low-confidence bar, so the fallback is taken when it was
            const bar = a.minConfidence ?? (i === 0 ? (unsure?.below ?? 0.8) : 0.5);
            out.push({ id, ...(a.title !== undefined ? { title: a.title } : {}), ask: a.q, minConfidence: bar, ...call });
            return out;
          }, [])
        : (fresh().tiers as Rec[]);
      noteQuestions(asked.length);
      if ((from.kind === "route" || from.kind === "gate") && asked.length > 1) changed.push("lets its other questions settle it before falling back");
      unsureMargin();
      // the fallback is the not-sure path; without one, the first child fills in
      const [first, ...rest] = kids;
      const fallback = unsure?.node ?? first?.node ?? placeholder(taken);
      if (unsure) {
        if (!isPlaceholder(unsure.node)) kept.push(unsure.edge === "fallback" ? "the fallback" : `the ${unsure.edge === "unsure" ? "unsure path" : "low-confidence path"} (as the fallback)`);
        kids.forEach(dropKid);
      } else {
        if (first) {
          const name = from.kind === "gate" ? `the ${first.label} path` : `“${first.label}”`;
          kept.push(`${name} (as the fallback)`);
          changed.push(`runs ${name} only when no tier is sure`);
        }
        rest.forEach(dropKid);
      }
      return done({ ...meta, tiers, fallback } as NodeJson);
    }

    case "parallel": {
      dropQuestions(asked);
      const branches: Rec = {};
      for (const k of kids) branches[keyFor(k.label, Object.keys(branches))] = k.node;
      if (unsure) branches[keyFor(unsure.edge, Object.keys(branches))] = unsure.node;
      notePaths(Object.keys(branches).length);
      if (from.kind === "chain") changed.push("runs the steps side by side, not in order");
      else if (from.kind === "cascade") changed.push("runs the fallback every time");
      else if (Object.keys(branches).length > 1) changed.push("runs every path instead of one");
      return done({ ...meta, branches } as NodeJson);
    }

    case "chain": {
      // only a parallel gets here (everything else wraps): its branches become the steps, in order
      dropJoin();
      notePaths(kids.length);
      if (kids.length > 1) changed.push("runs the branches in order, each fed the one before");
      return done({ ...meta, steps: kids.length ? kids.map((k) => k.node) : [placeholder(taken)] } as NodeJson);
    }

    case "step":
    case "emit": {
      dropJoin();
      dropQuestions(asked);
      kids.forEach(dropKid);
      dropUnsure(unsure);
      const leaf = fresh();
      return done(kind === "step" ? { ...leaf, ...meta, run: { $ref: from.id } } : { ...leaf, ...meta });
    }
  }
}

/** One line for the kind menu: what the change keeps and what it costs. */
export function describeChange(c: KindChange): string {
  if (c.wrapped) return "wraps it as it is";
  const nodes = c.dropped.reduce((n, d) => n + d.nodes, 0);
  const lost = c.dropped.filter((d) => d.nodes === 0).map((d) => d.what);
  const drops = [...(nodes ? [plural(nodes, "node")] : []), ...lost];
  const parts: string[] = [];
  if (c.kept.length) parts.push(`keeps ${c.kept.join(", ")}`);
  if (drops.length) parts.push(`drops ${drops.join(", ")}`);
  parts.push(...c.changed);
  return parts.join(" · ");
}

/**
 * Whether the change is worth a confirm: it loses a subtree, a question or a
 * join, or it would route some run differently. (A leaf's own value doesn't
 * count; nor does a placeholder.)
 */
export function losesWork(c: KindChange): boolean {
  return c.dropped.length > 0 || c.changed.length > 0;
}
