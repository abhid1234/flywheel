// The rollout engine (#1) — the RL "sampling" step. For a task, draw K rollouts:
// the agent writes code (K times), each candidate is graded in its own isolated
// Daytona sandbox against the hidden tests. Returns the pass count and the failing
// trajectories (spec + code + test output) for the harvester to cluster.
//
// This is exactly the many-rollouts-per-task pattern from the Daytona RL talk, and
// the reason the sandboxes must be parallel and disposable.

import { grade } from "./grader.mjs";

// bounded-concurrency pool, order-preserving
async function pool(items, size, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(size, items.length)) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

// Roll out one task K times. `lessons` is the current policy (array of {mode,text}).
export async function rolloutTask(backend, agent, task, lessons, { K = 5, concurrency = 6, rand = Math.random } = {}) {
  const attempts = await pool(Array.from({ length: K }, (_, i) => i), concurrency, async () => {
    const code = await agent.generate(task, lessons, rand);
    const res = await grade(backend, task, code, { timeoutMs: 60_000 });
    return { passed: res.passed, code, output: res.output };
  });
  const passes = attempts.filter((a) => a.passed).length;
  const failures = attempts.filter((a) => !a.passed).map((a) => ({ spec: task.spec, mode: task.mode, code: a.code, output: a.output }));
  return { task: task.id, mode: task.mode, K, passes, passRate: passes / K, failures };
}

// Roll out a whole set of tasks (each K times). All (task, rollout) units share
// ONE bounded pool, so tasks overlap instead of running one-at-a-time — the whole
// set finishes in the time of the slowest ~concurrency units, not the sum of
// per-task times. `concurrency` still caps concurrent sandboxes (keep it under the
// Daytona vCPU tier limit). Returns per-task results + aggregate mean with 95% CI.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isRateLimit = (msg) => /rate.?limit|quota|429|usage limit|overloaded|too many|capacity|try again/i.test(String(msg));

// One rollout unit, hardened for long overnight runs: retry the agent on
// rate-limit with escalating backoff (rate limits need tens of seconds, not
// milliseconds). If the agent ultimately can't respond, the unit is EXCLUDED
// (excluded:true) — never scored as a wrong answer, which would corrupt the run.
async function rolloutUnit(backend, agent, task, lessons, rand) {
  let lastErr;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      const code = await agent.generate(task, lessons, rand);
      const res = await grade(backend, task, code, { timeoutMs: 60_000 });
      return { taskId: task.id, mode: task.mode, spec: task.spec, passed: res.passed, code, output: res.output, excluded: false };
    } catch (error) {
      lastErr = error;
      if (attempt === 5) break;
      if (isRateLimit(error?.message)) await sleep(15_000 * (attempt + 1) + Math.floor(Math.random() * 4000));
      else await sleep(1500 * (attempt + 1) + Math.floor(Math.random() * 500));
    }
  }
  return { taskId: task.id, mode: task.mode, spec: task.spec, passed: false, excluded: true, error: lastErr?.message ?? "unknown" };
}

export async function rolloutSet(backend, agent, tasks, lessons, { K = 5, concurrency = 6, rand = Math.random } = {}) {
  const units = [];
  for (const task of tasks) for (let k = 0; k < K; k += 1) units.push(task);
  const graded = await pool(units, concurrency, (task) => rolloutUnit(backend, agent, task, lessons, rand));
  const byTask = new Map();
  for (const task of tasks) byTask.set(task.id, { task: task.id, mode: task.mode, attempts: 0, passes: 0, failures: [] });
  let excluded = 0;
  for (const g of graded) {
    if (g.excluded) { excluded += 1; continue; }        // rate-limited unit: not counted either way
    const t = byTask.get(g.taskId);
    t.attempts += 1;
    if (g.passed) t.passes += 1;
    else t.failures.push({ spec: g.spec, mode: g.mode, code: g.code, output: g.output });
  }
  const results = [...byTask.values()].map((t) => ({ ...t, passRate: t.attempts ? t.passes / t.attempts : 0 }));
  const N = graded.length - excluded;                    // denominator excludes rate-limited units
  const totalPass = results.reduce((s, r) => s + r.passes, 0);
  const mean = N ? totalPass / N : 0;
  const half = 1.96 * Math.sqrt(Math.max(mean * (1 - mean), 0.0001) / Math.max(N, 1));
  return { results, mean, lo: Math.max(0, mean - half), hi: Math.min(1, mean + half), N, excluded };
}
