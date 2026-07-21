export const DEFAULT_WEIGHTS = Object.freeze({ w1: 1, w2: 2, w3: 0.7, w4: 1.5, w5: 1 });

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;

function priority(cluster, weights, totalProjects) {
  const size = Math.max(0, finite(cluster?.size));
  const counts = cluster?.tierCounts ?? {};
  const tierWeight = size > 0
    ? (finite(counts.gold) + 0.7 * finite(counts.strong) + 0.3 * finite(counts.weak) + 0.1 * finite(counts.unknown)) / size
    : 0;
  return weights.w1 * Math.log1p(size)
    + weights.w2 * (size > 0 ? finite(cluster?.cost?.terminal) / size : 0)
    + weights.w3 * Math.log1p(Math.max(0, finite(cluster?.cost?.wastedMs)) / 60000)
    + weights.w4 * (totalProjects > 0 ? finite(cluster?.span?.projects) / totalProjects : 0)
    + weights.w5 * tierWeight;
}

export function rankClusters(clusters, weights = {}) {
  try {
    if (!Array.isArray(clusters)) return [];
    const safeWeights = {};
    for (const key of Object.keys(DEFAULT_WEIGHTS)) safeWeights[key] = finite(weights?.[key], DEFAULT_WEIGHTS[key]);
    const totalProjects = Math.max(0, ...clusters.map((cluster) => finite(cluster?.span?.projects)));
    return clusters.map((cluster) => ({ ...cluster, priority: priority(cluster, safeWeights, totalProjects) }))
      .sort((a, b) => b.priority - a.priority || finite(b.size) - finite(a.size)
        || String(a.signature ?? "").localeCompare(String(b.signature ?? ""))
        || String(a.id ?? "").localeCompare(String(b.id ?? "")));
  } catch {
    return [];
  }
}

// Reviewable clusters have enough recurring, trustworthy evidence for a human
// to consider a patch. They do not need a replayable causal witness.
export function isReviewable(cluster) {
  try {
    const counts = cluster?.tierCounts ?? {};
    return finite(cluster?.size) >= 3
      && finite(counts.gold) + finite(counts.strong) >= 3
      && cluster?.isLongTail !== true;
  } catch {
    return false;
  }
}

// Proposable ⊂ reviewable: only this stricter gate is auto-apply eligible.
export function isProposable(cluster) {
  try {
    return isReviewable(cluster)
      && Array.isArray(cluster?.witnesses)
      && cluster.witnesses.some((witness) => witness?.replayable === true);
  } catch {
    return false;
  }
}
