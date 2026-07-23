// The controlled-task registry. Every task is gold-by-construction: a known
// failure, a known fix, and a deterministic oracle. Spread across distinct
// flywheel error classes so the benchmark demonstrates BREADTH, not one failure
// mode measured many times.
import { task as envYaml } from "./env-yaml.mjs";
import { task as nodeLodash } from "./node-lodash.mjs";
import { task as fileMissing } from "./file-missing.mjs";
import { task as cliCowsay } from "./cli-cowsay.mjs";
import { task as assertFail } from "./assert-fail.mjs";

export const TASKS = [envYaml, nodeLodash, fileMissing, cliCowsay, assertFail];

export function getTask(id) {
  return TASKS.find((t) => t.id === id) ?? null;
}
