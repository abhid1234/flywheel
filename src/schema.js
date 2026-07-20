export const LABEL_TIERS = ["gold", "strong", "weak", "unknown"];
export const OUTCOME_LABELS = ["pass", "fail", "unknown"];
export const ERROR_CODES = ["not_object", "required", "type", "enum", "empty", "format", "mismatch", "unknown_field"];

const ROOT_KEYS = new Set(["id", "schema", "session_id", "prompt_id", "agent_id", "project", "cwd", "git_branch", "started", "ended", "duration_ms", "is_sidechain", "request", "steps", "artifacts", "signals", "outcome", "failure", "meta"]);
const OUTCOME_KEYS = new Set(["label", "tier", "confidence", "reason", "source", "method", "evidence"]);
const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const absent = (v) => v === undefined || v === null;
const add = (a, path, code, message) => a.push({ path, code, message });

function requiredString(errors, obj, key) {
  const value = obj[key];
  if (absent(value)) add(errors, key, "required", `\`${key}\` is required`);
  else if (typeof value !== "string") add(errors, key, "type", `\`${key}\` must be a string`);
  else if (!value.trim()) add(errors, key, "empty", `\`${key}\` must not be empty`);
}

function requiredObject(errors, obj, key) {
  if (absent(obj[key])) add(errors, key, "required", `\`${key}\` is required`);
  else if (!isObject(obj[key])) add(errors, key, "type", `\`${key}\` must be an object`);
}

export function validateEpisode(ep) {
  const errors = [];
  if (!isObject(ep)) {
    add(errors, "", "not_object", "episode must be a plain object");
    return { valid: false, errors };
  }
  for (const key of ["id", "schema", "session_id", "prompt_id", "agent_id", "cwd", "started"]) requiredString(errors, ep, key);
  if (!absent(ep.started) && typeof ep.started === "string" && ep.started.trim() && Number.isNaN(Date.parse(ep.started))) {
    add(errors, "started", "format", "`started` must be an ISO-8601 timestamp");
  }
  if (absent(ep.steps)) add(errors, "steps", "required", "`steps` is required");
  else if (!Array.isArray(ep.steps)) add(errors, "steps", "type", "`steps` must be an array");
  requiredObject(errors, ep, "signals");
  requiredObject(errors, ep, "outcome");
  if (isObject(ep.outcome)) {
    for (const [key, allowed] of [["label", OUTCOME_LABELS], ["tier", LABEL_TIERS]]) {
      const value = ep.outcome[key];
      const path = `outcome.${key}`;
      if (absent(value)) add(errors, path, "required", `\`${path}\` is required`);
      else if (typeof value !== "string") add(errors, path, "type", `\`${path}\` must be a string`);
      else if (!allowed.includes(value)) add(errors, path, "enum", `\`${path}\` must be one of: ${allowed.join(", ")}`);
    }
    for (const key of Object.keys(ep.outcome)) if (!OUTCOME_KEYS.has(key)) add(errors, `outcome.${key}`, "unknown_field", `unknown field \`outcome.${key}\``);
  }
  for (const key of Object.keys(ep)) if (!ROOT_KEYS.has(key)) add(errors, key, "unknown_field", `unknown field \`${key}\``);
  return { valid: errors.length === 0, errors };
}
