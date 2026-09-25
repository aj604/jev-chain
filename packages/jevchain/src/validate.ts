/**
 * Structural checks that the type system can't make, for chains built in code
 * *and* chains loaded from JSON (where the type system never saw them).
 */
import { questionIssues } from "./questions";
import { walk, type AnyJevNode, type AnyNode } from "./nodes";

/** Question key used for a route/gate/tier's deciding question. */
export const DECISION_KEY = "decision";

export function chainIssues(root: AnyNode): string[] {
  const issues: string[] = [];
  walk(root, (node, { path }) => {
    const n = node as AnyJevNode;
    const at = `${path} (${n.kind} "${n.id}")`;
    if (typeof n.id !== "string" || n.id === "") issues.push(`${path}: every node needs a non-empty string id`);
    switch (n.kind) {
      case "ask":
        if (!n.questions || Object.keys(n.questions).length === 0) issues.push(`${at}: needs at least one question`);
        else for (const [k, q] of Object.entries(n.questions)) issues.push(...questionIssues(q, `${at}.questions.${k}`));
        break;
      case "route": {
        issues.push(...questionIssues(n.ask, `${at}.ask`));
        if (n.ask?.type !== "choice") {
          issues.push(`${at}: a route must ask a choice question`);
          break;
        }
        const labels = Object.keys(n.ask.criteria);
        const branches = Object.keys(n.branches ?? {});
        const missing = labels.filter((l) => !branches.includes(l));
        const extra = branches.filter((b) => !labels.includes(b));
        if (missing.length) issues.push(`${at}: no branch for ${missing.map((m) => `"${m}"`).join(", ")}`);
        if (extra.length) issues.push(`${at}: branches ${extra.map((m) => `"${m}"`).join(", ")} aren't options of the question`);
        if (n.lowConfidence && !inUnit(n.lowConfidence.below)) issues.push(`${at}.lowConfidence.below: expected 0–1`);
        issues.push(...alsoAskIssues(n.alsoAsk, at));
        break;
      }
      case "gate": {
        issues.push(...questionIssues(n.ask, `${at}.ask`));
        const { min, max, label } = n.pass ?? {};
        if (min === undefined && max === undefined) issues.push(`${at}.pass: set min and/or max`);
        if (n.ask?.type === "choice") {
          if (!label) issues.push(`${at}.pass.label: a choice gate needs the label to measure`);
          else if (!(label in n.ask.criteria)) issues.push(`${at}.pass.label: "${label}" isn't an option of the question`);
        }
        if (n.ask?.type !== "score") {
          if (min !== undefined && !inUnit(min)) issues.push(`${at}.pass.min: probabilities are 0–1`);
          if (max !== undefined && !inUnit(max)) issues.push(`${at}.pass.max: probabilities are 0–1`);
        }
        if (n.unsure && n.unsure.margin === undefined && n.unsure.minConfidence === undefined) {
          issues.push(`${at}.unsure: set margin and/or minConfidence`);
        }
        issues.push(...alsoAskIssues(n.alsoAsk, at));
        break;
      }
      case "parallel":
        if (!n.branches || Object.keys(n.branches).length === 0) issues.push(`${at}: needs at least one branch`);
        break;
      case "cascade": {
        if (!n.tiers?.length) issues.push(`${at}: needs at least one tier`);
        const seen = new Set<string>();
        for (const t of n.tiers ?? []) {
          if (!t.id) issues.push(`${at}: every tier needs an id`);
          if (t.id === "fallback") issues.push(`${at}: "fallback" is reserved; rename that tier`);
          if (seen.has(t.id)) issues.push(`${at}: duplicate tier id "${t.id}"`);
          seen.add(t.id);
          if (!inUnit(t.minConfidence)) issues.push(`${at}.tiers.${t.id}.minConfidence: expected 0–1`);
          issues.push(...questionIssues(t.ask, `${at}.tiers.${t.id}.ask`));
        }
        break;
      }
      case "step":
        if (typeof n.run !== "function") issues.push(`${at}: step has no function (missing handler "${n.ref ?? n.id}"?)`);
        break;
      case "chain":
        if (!n.steps?.length) issues.push(`${at}: needs at least one node`);
        break;
      case "emit":
        break;
      default:
        issues.push(`${path}: unknown node kind "${(n as { kind: unknown }).kind}"`);
    }
  });
  return issues;
}

function inUnit(v: unknown): boolean {
  return typeof v === "number" && v >= 0 && v <= 1;
}

function alsoAskIssues(alsoAsk: Record<string, unknown> | undefined, at: string): string[] {
  if (!alsoAsk) return [];
  const issues: string[] = [];
  if (DECISION_KEY in alsoAsk) issues.push(`${at}.alsoAsk: "${DECISION_KEY}" is reserved for the deciding question`);
  for (const [k, q] of Object.entries(alsoAsk)) issues.push(...questionIssues(q, `${at}.alsoAsk.${k}`));
  return issues;
}
