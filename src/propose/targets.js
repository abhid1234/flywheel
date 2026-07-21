export const LAYER_STATUS = Object.freeze({
  context: "active",
  skill: "active",
  scaffolding: "staged",
  weights: "unavailable",
});

const CONTEXT = new Set(["module_not_found", "command_not_found", "file_not_found"]);
const HUMAN_CONTEXT = new Set(["harness_blocked"]);
const SKILL = new Set(["edit_no_match", "test_failure", "git_conflict", "runtime_error", "shell_syntax", "usage_error"]);
const SCAFFOLDING = new Set(["permission", "timeout", "network"]);
const HUMAN_SCAFFOLDING = new Set(["harness_precondition"]);
const NON_AGENT_FAULT = new Set(["user_rejected", "tool_unavailable", "stale_reference"]);

function joinPath(...parts) {
  const absolute = String(parts[0] ?? "").startsWith("/");
  const joined = parts
    .map((part) => String(part).split("/").filter(Boolean))
    .flat()
    .join("/");
  return absolute ? `/${joined}` : joined;
}

function normalizePath(value) {
  const absolute = value.startsWith("/");
  const segments = [];
  for (const segment of value.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length && segments.at(-1) !== "..") segments.pop();
      else if (!absolute) segments.push(segment);
    } else {
      segments.push(segment);
    }
  }
  return absolute ? `/${segments.join("/")}` : segments.join("/");
}

function resolvePath(base, value = "") {
  const target = String(value);
  return normalizePath(target.startsWith("/") ? target : joinPath(base, target));
}

function skillSurface(cluster) {
  const inferred = [cluster?.inferredSkill, cluster?.skillName, cluster?.skill, cluster?.tool]
    .find((value) => typeof value === "string" && value.trim() && !["bash", "shell", "mixed", "unknown"].includes(value.trim().toLowerCase()));
  const name = (inferred ?? "general").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "general";
  return `.claude/skills/${name}/SKILL.md`;
}

export function routeCluster(cluster) {
  const errorClass = cluster?.errorClass;
  // Kept in the public enum for future compatibility, but deliberately unconstructible today.
  if (cluster?.layer === "weights" || errorClass === "weights") throw new Error("weights layer is unavailable");
  if (NON_AGENT_FAULT.has(errorClass)) throw new Error(`${errorClass} is not an agent fault`);
  if (CONTEXT.has(errorClass)) return { layer: "context", surfaces: ["CLAUDE.md"], requires: "auto" };
  if (HUMAN_CONTEXT.has(errorClass)) return { layer: "context", surfaces: ["CLAUDE.md"], requires: "human-gate" };
  if (SKILL.has(errorClass)) return { layer: "skill", surfaces: [skillSurface(cluster)], requires: "auto" };
  if (HUMAN_SCAFFOLDING.has(errorClass)) return { layer: "scaffolding", surfaces: [".claude/settings.json"], requires: "human-gate" };
  if (SCAFFOLDING.has(errorClass)) return { layer: "scaffolding", surfaces: [".claude/settings.json"], requires: "human-gate" };
  return { layer: "context", surfaces: ["CLAUDE.md"], requires: "human-gate" };
}

export function resolveTargetPath(cluster, surface, { homeDir } = {}) {
  const cwd = typeof cluster?.dominantCwd === "string" && cluster.dominantCwd ? cluster.dominantCwd : null;
  const relative = String(surface ?? "");
  if (cwd) return resolvePath(resolvePath(process.cwd(), cwd), relative);
  const home = resolvePath(process.cwd(), String(homeDir ?? ""));
  if (relative === "CLAUDE.md") return resolvePath(home, joinPath(".claude", relative));
  return resolvePath(home, relative);
}
