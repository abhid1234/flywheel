export const LAYER_STATUS = Object.freeze({
  context: "active",
  skill: "active",
  scaffolding: "staged",
  weights: "unavailable",
});

const CONTEXT = new Set(["module_not_found", "command_not_found", "file_not_found"]);
const SKILL = new Set(["edit_no_match", "test_failure", "harness_precondition", "git_conflict"]);
const SCAFFOLDING = new Set(["permission", "timeout", "network"]);
const NON_AGENT_FAULT = new Set(["user_rejected", "tool_unavailable", "stale_reference"]);

export function routeCluster(cluster) {
  const errorClass = cluster?.errorClass;
  // Kept in the public enum for future compatibility, but deliberately unconstructible today.
  if (cluster?.layer === "weights" || errorClass === "weights") throw new Error("weights layer is unavailable");
  if (NON_AGENT_FAULT.has(errorClass)) throw new Error(`${errorClass} is not an agent fault`);
  if (CONTEXT.has(errorClass)) return { layer: "context", surfaces: ["CLAUDE.md"], requires: "auto" };
  if (SKILL.has(errorClass)) return { layer: "skill", surfaces: ["SKILL.md"], requires: "auto" };
  if (SCAFFOLDING.has(errorClass)) return { layer: "scaffolding", surfaces: ["scaffolding"], requires: "human-gate" };
  return { layer: "context", surfaces: ["CLAUDE.md"], requires: "human-gate" };
}
