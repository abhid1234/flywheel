export const CONTEXT_LINE_BUDGET = 20;

export function withinBudget(cumulativeLinesAdded, patchLines) {
  return Number.isFinite(cumulativeLinesAdded) && cumulativeLinesAdded >= 0 &&
    Number.isFinite(patchLines) && patchLines >= 0 &&
    cumulativeLinesAdded + patchLines <= CONTEXT_LINE_BUDGET;
}

export function flywheelPolicy() {
  return {
    protected_surfaces: [
      "**/.env", "**/*.key", "**/id_*", "**/.ssh/**", "**/credentials*",
      "**/settings.json", "**/package.json", "**/.git/**",
    ],
    blast_radius_limits: {
      max_surfaces: 1,
      max_files_changed: 1,
      max_lines_changed: CONTEXT_LINE_BUDGET,
    },
    approvals: [
      { layer: "context", requires: "auto" },
      { layer: "skill", requires: "auto" },
      { layer: "scaffolding", requires: "human-gate" },
      { layer: "weights", requires: "forbidden" },
    ],
    default_requires: "human-gate",
    meta: { source: "flywheel", version: "0.1" },
  };
}
