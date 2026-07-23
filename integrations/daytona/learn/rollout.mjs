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

// Roll out a whole set of tasks (each K times). Returns per-task results + the
// aggregate pass rate with a 95% CI (the held-out measurement).
export async function rolloutSet(backend, agent, tasks, lessons, { K = 5, concurrency = 6, rand = Math.random } = {}) {
  const results = [];
  for (const task of tasks) results.push(await rolloutTask(backend, agent, task, lessons, { K, concurrency, rand }));
  const N = tasks.length * K;
  const totalPass = results.reduce((s, r) => s + r.passes, 0);
  const mean = N ? totalPass / N : 0;
  const half = 1.96 * Math.sqrt(Math.max(mean * (1 - mean), 0.0001) / Math.max(N, 1));
  return { results, mean, lo: Math.max(0, mean - half), hi: Math.min(1, mean + half), N };
}
