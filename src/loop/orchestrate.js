import { isProposable, isReviewable, rankClusters } from "../cluster/rank.js";
import { routeCluster } from "../propose/targets.js";
import { CONTEXT_LINE_BUDGET } from "./policy.js";

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : fallback;

function hasWitness(cluster) {
  return Array.isArray(cluster?.witnesses) && cluster.witnesses.some((witness) => witness?.replayable === true);
}

function contextLines(cluster, opts) {
  try {
    if (typeof opts?.linesAdded === "function") return finite(opts.linesAdded(cluster));
    const keyed = opts?.linesAdded;
    if (keyed && typeof keyed === "object") return finite(keyed[cluster?.id] ?? keyed[cluster?.signature]);
    return finite(cluster?.linesAdded ?? cluster?.estimatedLinesAdded ?? cluster?.contextLines ?? cluster?.patchLines ?? cluster?.blast_radius?.lines_added ??
      cluster?.blast_radius?.lines_changed ?? cluster?.patch?.blast_radius?.lines_changed);
  } catch { return 0; }
}

/** Pure, total autonomy policy. No clocks, I/O, or mutation of caller values. */
export function planLoop(clusters, opts = {}) {
  try {
    const source = Array.isArray(clusters) ? clusters : [];
    const ranked = opts?.ranked === true ? source.map((cluster) => ({ ...cluster })) : rankClusters(source);
    const max = Number.isInteger(Number(opts?.max)) && Number(opts.max) >= 0 ? Number(opts.max) : Infinity;
    const mode = opts?.mode === "review" ? "review" : "auto";
    const actions = [];
    const skipped = [];
    let contextLinesAdded = finite(opts?.contextLinesAdded);
    let contextBudgetExceeded = contextLinesAdded > CONTEXT_LINE_BUDGET;
    for (const cluster of ranked) {
      if (actions.length >= max) break;
      let route;
      try { route = routeCluster(cluster); }
      catch { skipped.push({ cluster, cluster_signature: String(cluster?.signature ?? ""), layer: null, reason: "layer_gated" }); continue; }
      const base = { cluster, clusterId: String(cluster?.id ?? ""), signature: String(cluster?.signature ?? ""), cluster_signature: String(cluster?.signature ?? ""), layer: route.layer };
      const proposable = isProposable(cluster);
      const reviewable = isReviewable(cluster);
      if (mode === "review" && reviewable) {
        actions.push({ ...base, action: "review", target: route.surfaces[0], evalStrategy: null, eval_strategy: null,
          autoApply: false, auto_apply: false, disposition: "human-review", lines_added: 0 });
      } else if (route.layer !== "context" && route.layer !== "skill") {
        skipped.push({ ...base, reason: "layer_gated" });
      } else if (!hasWitness(cluster) && reviewable) {
        skipped.push({ ...base, reason: "no_causal_witness" });
      } else if (!proposable) {
        skipped.push({ ...base, reason: "not_proposable" });
      } else if (!hasWitness(cluster)) {
        skipped.push({ ...base, reason: "no_causal_witness" });
      } else {
        const linesAdded = route.layer === "context" ? contextLines(cluster, opts) : 0;
        if (route.layer === "context" && (contextBudgetExceeded || contextLinesAdded + linesAdded > CONTEXT_LINE_BUDGET)) {
          contextBudgetExceeded = true;
          skipped.push({ ...base, eval_strategy: "witness_replay", lines_added: linesAdded, reason: "budget_exceeded" });
        } else {
          if (route.layer === "context") contextLinesAdded += linesAdded;
          actions.push({ ...base, action: "auto_apply", target: route.surfaces[0], evalStrategy: "witness_replay", eval_strategy: "witness_replay", autoApply: true, auto_apply: true, disposition: "auto-eligible", lines_added: linesAdded });
        }
      }
    }
    return { actions, skipped };
  } catch { return { actions: [], skipped: [] }; }
}
