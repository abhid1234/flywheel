import { contentId } from "../hash.js";
import { routeCluster } from "./targets.js";

function changedLines(before, after) {
  const left = before.split("\n");
  const right = after.split("\n");
  let prefix = 0;
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < left.length - prefix && suffix < right.length - prefix && left.at(-1 - suffix) === right.at(-1 - suffix)) suffix += 1;
  return (left.length - prefix - suffix) + (right.length - prefix - suffix);
}

const strictest = (left, right) => left === "human-gate" || right === "human-gate" ? "human-gate" : "auto";

export function toSelfPatch(candidate, contractResult, cluster, meta = {}) {
  const route = routeCluster(cluster);
  const before = String(candidate?.edit?.before ?? "");
  const after = String(candidate?.edit?.after ?? "");
  const flywheel = {
    clusterId: cluster?.id ?? "",
    evalStrategy: contractResult?.strategy ?? "",
    evalStrength: contractResult?.strength ?? "",
    baselineRecurrence: cluster?.recurrenceRate ?? null,
    memberEpisodes: Array.isArray(cluster?.members) ? [...cluster.members] : [],
    checks: Array.isArray(contractResult?.checks) ? [...contractResult.checks] : [],
  };
  const identity = { clusterId: flywheel.clusterId, layer: candidate?.layer, target: candidate?.target, before, after };
  return {
    id: typeof meta?.id === "string" ? meta.id : contentId("sp", identity),
    created: null,
    author: typeof meta?.author === "string" ? meta.author : "flywheel",
    layer: candidate?.layer,
    target: candidate?.target,
    diff: { format: "before_after", before, after },
    rationale: candidate?.rationale ?? "",
    eval_contract: contractResult?.evalContract,
    blast_radius: { surfaces: [...route.surfaces], files_changed: before === after ? 0 : 1, lines_changed: changedLines(before, after) },
    requires: meta?.creates_file === true ? "human-gate" : strictest(route.requires, contractResult?.requires),
    meta: { ...meta, eval_strength: contractResult?.strength ?? "", flywheel },
  };
}
