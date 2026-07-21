import { repeatsNeeded } from "./design.js";
import { clusterToTrialSuite, splitHeldout } from "./suite.js";
import { judge } from "./verdict.js";

const finite = (value) => typeof value === "number" && Number.isFinite(value);

export function planTrials(cluster, episodes, patch, opts = {}) {
  const safe = opts && typeof opts === "object" ? opts : {};
  const suite = clusterToTrialSuite(cluster, episodes, { cwd: safe.cwd });
  const salt = typeof safe.salt === "string"
    ? safe.salt
    : `flywheel:heldout:v1:${String(cluster?.id ?? cluster?.signature ?? "")}`;
  const { heldout, dev } = splitHeldout(suite, { salt, heldoutPct: safe.heldoutPct });
  const designed = repeatsNeeded(0.06, 0.05);
  const requested = Number(safe.repeats ?? designed);
  const repeats = Math.max(5, Number.isInteger(requested) && requested > 0 ? requested : designed);
  const timeoutMs = Math.max(1, Number.isFinite(Number(safe.timeoutMs)) ? Math.floor(Number(safe.timeoutMs)) : 60_000);
  const maxTrials = Math.max(0, Number.isFinite(Number(safe.maxTrials)) ? Math.floor(Number(safe.maxTrials)) : 40);
  const budgetUsd = Math.max(0, Number.isFinite(Number(safe.budgetUsd)) ? Number(safe.budgetUsd) : 2);
  const order = [];
  for (const trial of suite) {
    for (let repeat = 0; repeat < repeats; repeat += 1) {
      for (const arm of ["before", "after"]) order.push({ arm, repeat, trial });
    }
  }
  return { suite, heldout, dev, repeats, arms: ["before", "after"], timeoutMs, maxTrials, budgetUsd, order,
    ...(patch === undefined ? {} : { patch }) };
}

function transcript(result) {
  return [result?.output, result?.stdout, result?.stderr, result?.transcript]
    .filter((value) => typeof value === "string").join("\n");
}

export function scoreTrialResults(results, cluster, design = {}) {
  try {
    const signature = String(cluster?.expectedSignature ?? cluster?.signature ?? "");
    const tasks = new Map();
    for (const result of Array.isArray(results) ? results : []) {
      if (result?.arm !== "before" && result?.arm !== "after") continue;
      const id = String(result?.trialId ?? result?.trial?.id ?? result?.id ?? "");
      if (!id) continue;
      if (!tasks.has(id)) tasks.set(id, { id, before: [], after: [] });
      const expected = String(result?.expectedSignature ?? result?.trial?.expectedSignature ?? signature);
      const completed = result?.completed === true || (result?.completed !== false && result?.timedOut !== true && result?.spawnError !== true);
      const pass = completed && (!expected || !transcript(result).includes(expected));
      tasks.get(id)[result.arm].push(pass ? 1 : 0);
    }
    const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    const perTask = [...tasks.values()].filter((task) => task.before.length && task.after.length)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((task) => ({ id: task.id, before: mean(task.before), after: mean(task.after),
        beforeN: task.before.length, afterN: task.after.length }));
    const judged = judge(perTask.map((task) => task.before), perTask.map((task) => task.after), design);
    return { verdict: judged.powered ? judged.verdict : "inconclusive", delta: judged.delta,
      ci95: judged.ci95, powered: judged.powered, perTask };
  } catch {
    return { verdict: "inconclusive", delta: 0, ci95: { lo: 0, hi: 0 }, powered: false, perTask: [] };
  }
}
