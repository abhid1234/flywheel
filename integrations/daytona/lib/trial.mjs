// Shared trial engine — one controlled task, N paired trials, an A/A noise floor,
// scored by flywheel's REAL paired-bootstrap verdict. Used by both run.mjs (single
// task) and suite.mjs (the whole benchmark) so the logic is identical everywhere.
import { scoreTrialResults } from "../../../src/measure/runner.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isTransient = (msg) => /CPU limit|rate limit|429|too many|capacity|temporarily/i.test(String(msg));

// Bounded-concurrency pool that preserves order.
async function pool(items, size, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(size, items.length)) }, async () => {
    while (next < items.length) { const i = next++; results[i] = await fn(items[i], i); }
  });
  await Promise.all(workers);
  return results;
}

// Run one arm of one trial in a fresh sandbox, with retry-on-transient-capacity.
// An incomplete trial is marked completed:false (never silently dropped).
async function runArm(backend, task, item, timeoutMs) {
  let lastErr;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const result = await backend.run(task.steps(item.arm), { timeoutMs });
      const reproduced = task.reproducedFailure(result);
      return {
        arm: item.arm, repeat: item.repeat, trialId: item.trialId,
        expectedSignature: task.signature, completed: true,
        output: reproduced ? task.signature : "completed; failure did not reproduce",
        reproduced, exitCode: result?.exitCode ?? null,
      };
    } catch (error) {
      lastErr = error;
      if (!isTransient(error?.message) || attempt === 3) break;
      await sleep(1500 * (attempt + 1) + Math.floor(Math.random() * 500));
    }
  }
  return {
    arm: item.arm, repeat: item.repeat, trialId: item.trialId,
    expectedSignature: task.signature, completed: false,
    output: `trial error: ${lastErr?.message ?? "unknown"}`, reproduced: null, exitCode: null, spawnError: true,
  };
}

// Run one task end-to-end. Returns the measured result plus gold episodes.
export async function runTask(task, { backend, n, concurrency = 8, timeoutMs = 120_000, stamp }) {
  const started = Date.now();
  const plan = [];
  for (let repeat = 0; repeat < n; repeat += 1) {
    for (const arm of ["before", "after"]) plan.push({ arm, repeat, trialId: `${task.id}#${repeat}` });
  }
  const raw = await pool(plan, concurrency, (it) => runArm(backend, task, it, timeoutMs));

  // A/A noise floor: race the control arm against itself; band95 is what a real
  // effect must clear before the scorer will say "helped".
  const aaN = Math.min(n, 20);
  const aaPlan = Array.from({ length: aaN }, (_, r) => ({ arm: "before", repeat: r, trialId: `${task.id}#aa${r}` }));
  const aaA = await pool(aaPlan, concurrency, (it) => runArm(backend, task, it, timeoutMs));
  const aaB = await pool(aaPlan, concurrency, (it) => runArm(backend, task, it, timeoutMs));
  const aaDeltas = aaA
    .map((a, i) => ({ a, b: aaB[i] }))
    .filter(({ a, b }) => a.completed && b.completed)
    .map(({ a, b }) => Math.abs((b.reproduced ? 0 : 1) - (a.reproduced ? 0 : 1)))
    .sort((x, y) => x - y);
  const band95 = aaDeltas.length ? aaDeltas[Math.min(aaDeltas.length - 1, Math.ceil(0.95 * aaDeltas.length) - 1)] : 0;

  const score = scoreTrialResults(raw, { signature: task.signature }, { seed: 42, noiseBand: band95 });

  const rate = (arm) => {
    const rows = raw.filter((r) => r.arm === arm && r.completed);
    const reproduced = rows.filter((r) => r.reproduced).length;
    return { reproduced, n: rows.length, failRate: rows.length ? reproduced / rows.length : 0 };
  };
  const recordedAt = stamp ?? null;
  const episodes = raw.map((r) => ({
    schema: "flywheel/episode@1", source: "daytona-controlled-trial", task: task.id,
    error_class: task.errorClass ?? null, arm: r.arm, trial_id: r.trialId, cwd: `daytona:${task.id}`,
    failure: { signature: task.signature, reproduced: r.reproduced },
    outcome: {
      label: r.completed ? (r.reproduced ? "fail" : "pass") : "unknown",
      tier: r.completed ? "gold" : "unknown", method: "controlled_trial",
      evidence: [`exit_code=${r.exitCode}`, `arm=${r.arm}`],
    },
    recorded_at: recordedAt,
  }));

  return {
    task: task.id, errorClass: task.errorClass ?? null, signature: task.signature,
    n, band95, before: rate("before"), after: rate("after"),
    verdict: score.verdict, delta: score.delta, ci95: score.ci95, powered: score.powered,
    incomplete: raw.filter((r) => !r.completed).length,
    sandboxes: plan.length + aaPlan.length * 2,
    elapsed_s: Number(((Date.now() - started) / 1000).toFixed(1)),
    episodes,
  };
}
