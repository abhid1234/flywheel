export const TIER_RANK = Object.freeze({ gold: 3, strong: 2, weak: 1, unknown: 0 });

const LABELS = new Set(["pass", "fail", "unknown"]);
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const unknown = () => ({ label: "unknown", tier: "unknown", confidence: 0, method: "merge.insufficient", evidence: [] });

function valid(outcome) {
  return object(outcome) && LABELS.has(outcome.label) && Object.hasOwn(TIER_RANK, outcome.tier);
}

function confidence(outcome) {
  return Number.isFinite(outcome?.confidence) ? outcome.confidence : 0;
}

function compareMethod(a, b) {
  const left = String(a?.method ?? "");
  const right = String(b?.method ?? "");
  return left < right ? -1 : left > right ? 1 : 0;
}

export function mergeOutcomes(outcomes) {
  try {
    if (!Array.isArray(outcomes)) return unknown();
    const candidates = outcomes.filter(valid);
    if (candidates.length === 0) return unknown();
    return candidates.slice().sort((a, b) =>
      TIER_RANK[b.tier] - TIER_RANK[a.tier]
      || confidence(b) - confidence(a)
      || compareMethod(a, b))[0];
  } catch {
    return unknown();
  }
}

export function capTierForSidechain(outcome) {
  try {
    if (!valid(outcome)) return unknown();
    // A subagent's success does not establish parent success, while its failure
    // does not mark the parent failed because the parent may recover.
    return outcome.tier === "gold" ? { ...outcome, tier: "strong" } : outcome;
  } catch {
    return unknown();
  }
}
