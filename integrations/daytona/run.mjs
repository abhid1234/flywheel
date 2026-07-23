#!/usr/bin/env node
// flywheel × Daytona — the statistical arm's execution substrate (Play A).
//
// WHY THIS EXISTS
// flywheel's one honest wall (KC-6) is that proving a fix moves the OUTCOME needs
// gold-labeled trials at volume (n>=60), and the agent factory can't supply them
// because it never recorded the episode->outcome link at decision time. This
// harness records that link BY CONSTRUCTION: it sets up a controlled task in a
// fresh isolated Daytona sandbox, runs both arms (control vs. fix), and reads the
// outcome from a deterministic oracle. Every trial is born gold.
//
// It reuses flywheel's REAL scorer (src/measure/runner.js#scoreTrialResults) — the
// same paired-bootstrap verdict the rest of the tool uses — so a result here is a
// result there. No parallel statistics.
//
// USAGE
//   node run.mjs --task env-yaml --n 12 [--out ~/.flywheel/daytona]
// Backend auto-selects: real Daytona if DAYTONA_API_KEY is set, else the offline
// mock (FLYWHEEL_DAYTONA_BACKEND=mock forces it). Load the key first, e.g.
//   set -a; . ~/.flywheel/daytona.env; set +a

import { resolveBackend } from "./lib/client.mjs";
import { scoreTrialResults } from "../../src/measure/runner.js";
import { writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

function parseArgs(argv) {
  // Default concurrency 8 keeps us under the common 10-vCPU tier cap (1 vCPU/sandbox).
  const out = { task: "billing-invoice", n: 12, concurrency: 8, out: path.join(homedir(), ".flywheel", "daytona") };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--task") out.task = argv[++i];
    else if (a === "--n") out.n = Number(argv[++i]);
    else if (a === "--concurrency") out.concurrency = Number(argv[++i]);
    else if (a === "--out") out.out = argv[++i];
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

async function loadTask(name) {
  const mod = await import(`./tasks/${name}.mjs`).catch(() => null);
  if (!mod?.task) throw new Error(`unknown task: ${name} (expected integrations/daytona/tasks/${name}.mjs exporting { task })`);
  return mod.task;
}

// Run a bounded pool of async thunks, preserving order. Keeps sandbox count under
// control so we don't fan out 120 sandboxes at once.
async function pool(items, size, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(size, items.length)) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write("usage: node run.mjs --task <name> --n <trials-per-arm> [--concurrency N] [--out DIR]\n");
    return;
  }
  if (!Number.isInteger(args.n) || args.n < 1) throw new Error("--n must be a positive integer");

  const task = await loadTask(args.task);
  const backend = resolveBackend();
  process.stdout.write(`flywheel × daytona\n  task:    ${task.id}  (${task.signature})\n  backend: ${backend.kind}${backend.kind === "mock" ? "  ⚠ offline mock — set DAYTONA_API_KEY for real sandboxes" : ""}\n  trials:  ${args.n} per arm (${args.n * 2} sandboxes)\n\n`);

  // Build the trial plan: n repeats × {before, after}. One sandbox per entry.
  const plan = [];
  for (let repeat = 0; repeat < args.n; repeat += 1) {
    for (const arm of ["before", "after"]) plan.push({ arm, repeat, trialId: `${task.id}#${repeat}` });
  }

  const started = Date.now();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // Retry transient capacity errors (tier CPU cap, rate limits) with backoff+jitter
  // so one throttled sandbox doesn't abort the whole run. Non-transient errors
  // surface after the last attempt and mark the trial as not-completed (honest —
  // the scorer counts an incomplete trial, never silently drops it).
  const isTransient = (msg) => /CPU limit|rate limit|429|too many|capacity|temporarily/i.test(String(msg));
  const runArm = async (item) => {
    let lastErr;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const result = await backend.run(task.steps(item.arm), { timeoutMs: 120_000 });
        const reproduced = task.reproducedFailure(result);
        // Shape it exactly as flywheel's scorer expects: a "pass" is a completed
        // trial whose output does NOT contain the failure signature.
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
  };
  const raw = await pool(plan, args.concurrency, runArm);

  // A/A NOISE FLOOR (anti-self-fooling). Before we let the harness call anything
  // "helped", we measure the run-to-run noise by racing the CONTROL arm against
  // ITSELF. The 95th-percentile of the paired A/A deltas is the band a real effect
  // must clear. Without this, the scorer correctly stays "inconclusive" — it will
  // not certify an improvement it can't distinguish from noise.
  const aaN = Math.min(args.n, 20);
  const aaPlan = [];
  for (let r = 0; r < aaN; r += 1) aaPlan.push({ arm: "before", repeat: r, trialId: `${task.id}#aa${r}` });
  const aaA = await pool(aaPlan, args.concurrency, runArm);
  const aaB = await pool(aaPlan, args.concurrency, (it) => runArm({ ...it, trialId: it.trialId }));
  const aaDeltas = aaA
    .map((a, i) => ({ a, b: aaB[i] }))
    .filter(({ a, b }) => a.completed && b.completed) // only completed A/A pairs count
    .map(({ a, b }) => Math.abs((b.reproduced ? 0 : 1) - (a.reproduced ? 0 : 1)))
    .sort((x, y) => x - y);
  const band95 = aaDeltas.length ? aaDeltas[Math.min(aaDeltas.length - 1, Math.ceil(0.95 * aaDeltas.length) - 1)] : 0;
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  // Score with flywheel's REAL paired-bootstrap verdict, now with a measured band.
  const score = scoreTrialResults(raw, { signature: task.signature }, { seed: 42, noiseBand: band95 });

  const armRate = (arm) => {
    const rows = raw.filter((r) => r.arm === arm && r.completed); // incomplete trials excluded
    const reproduced = rows.filter((r) => r.reproduced).length;
    return { reproduced, n: rows.length, failRate: rows.length ? reproduced / rows.length : 0 };
  };
  const incomplete = raw.filter((r) => !r.completed).length;
  const before = armRate("before");
  const after = armRate("after");

  // Emit gold episodes — the KC-6-unblocking artifact. Each trial is an
  // episode->outcome tuple recorded at decision time, tier "gold" because the
  // oracle is deterministic and known.
  mkdirSync(args.out, { recursive: true });
  const stamp = new Date().toISOString();
  const goldPath = path.join(args.out, "daytona-episodes.jsonl");
  for (const r of raw) {
    const episode = {
      schema: "flywheel/episode@1",
      source: "daytona-controlled-trial",
      task: task.id,
      arm: r.arm,
      trial_id: r.trialId,
      cwd: `daytona:${task.id}`,
      failure: { signature: task.signature, reproduced: r.reproduced },
      outcome: {
        label: r.reproduced ? "fail" : "pass",
        tier: "gold",
        method: "controlled_trial",
        evidence: [`exit_code=${r.exitCode}`, `arm=${r.arm}`],
      },
      recorded_at: stamp,
    };
    appendFileSync(goldPath, `${JSON.stringify(episode)}\n`);
  }

  const report = {
    ts: stamp, task: task.id, signature: task.signature, backend: backend.kind,
    n_per_arm: args.n, sandboxes: plan.length + aaPlan.length * 2, elapsed_s: Number(elapsed),
    aa_noise_band95: band95,
    before_fail_rate: before.failRate, after_fail_rate: after.failRate,
    verdict: score.verdict, delta: score.delta, ci95: score.ci95, powered: score.powered,
    gold_episodes_written: raw.length, gold_path: goldPath,
  };
  writeFileSync(path.join(args.out, "last-run.json"), `${JSON.stringify(report, null, 2)}\n`);

  process.stdout.write(
    `before (control): ${before.reproduced}/${before.n} reproduced the failure  (${(before.failRate * 100).toFixed(0)}%)\n` +
    `after  (fix):     ${after.reproduced}/${after.n} reproduced the failure  (${(after.failRate * 100).toFixed(0)}%)\n\n` +
    `A/A noise floor (band95): ${band95.toFixed(3)}   ${aaN < 20 ? "(small A/A; scale n for a tighter floor)" : ""}\n` +
    `delta (improvement): ${(score.delta).toFixed(3)}\n` +
    `CI95: [${score.ci95.lo.toFixed(3)}, ${score.ci95.hi.toFixed(3)}]\n` +
    `powered: ${score.powered ? "yes" : "no"}\n` +
    `verdict: ${score.verdict}${score.verdict === "helped" ? "  ✓ effect clears the measured noise floor" : ""}\n\n` +
    `${incomplete ? `⚠ ${incomplete} trial(s) did not complete (excluded from scoring)\n` : ""}` +
    `${raw.length} gold episodes -> ${goldPath}\n` +
    `report -> ${path.join(args.out, "last-run.json")}\n` +
    `elapsed: ${elapsed}s on ${backend.kind} backend\n`
  );
  if (!score.powered) process.stdout.write(`\nnote: n=${args.n} is below the n>=60 floor — no statistical claim yet, this is a plumbing/scale check.\n`);
}

main().catch((error) => { process.stderr.write(`error: ${error.message}\n`); process.exitCode = 1; });
