#!/usr/bin/env node
// THE RL LOOP (#4) — the finished experiment, wired end-to-end.
//
//   baseline held-out  →  for each round:
//     roll out TRAIN tasks (K each) in Daytona  →  reward from hidden tests
//     harvest failing trajectories  →  cluster by failure mode
//     lesson-writer distills ONE lesson from the biggest fresh cluster
//     tentatively add it to the policy  →  re-roll the SEALED held-out set
//     A/A-gate the gain: keep the lesson only if it clears the noise band
//   →  emit the honest learning curve (diminishing returns, rejections, plateau)
//
// Backends (mix freely):
//   --agent fake   --writer fake     free, real Daytona grading — full pipeline proof
//   --agent codex  --writer codex    real RL on trajectories (LLM tokens; the spend)
//
//   node rl-loop.mjs [--rounds 6] [--K 5] [--agent fake] [--writer fake] [--out DIR]

import { resolveBackend } from "../lib/client.mjs";
import { resolveAgent } from "./agent.mjs";
import { resolveLessonWriter } from "./lesson-writer.mjs";
import { rolloutSet, rolloutTask } from "./rollout.mjs";
import { TRAIN, HOLDOUT } from "./codegen-tasks.mjs";
import { renderCurve } from "./curve-report.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

function rng(seed) { let s = (seed >>> 0) || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }

function parse(argv) {
  const a = { rounds: 6, K: 5, concurrency: 6, agent: "fake", writer: "fake", seed: 42, out: path.join(homedir(), ".flywheel", "daytona", "learn") };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if (k === "--rounds") a.rounds = Number(argv[++i]);
    else if (k === "--K") a.K = Number(argv[++i]);
    else if (k === "--concurrency") a.concurrency = Number(argv[++i]);
    else if (k === "--agent") a.agent = argv[++i];
    else if (k === "--writer") a.writer = argv[++i];
    else if (k === "--seed") a.seed = Number(argv[++i]);
    else if (k === "--out") a.out = argv[++i];
  }
  return a;
}

async function main() {
  const args = parse(process.argv.slice(2));
  const rand = rng(args.seed);
  const backend = resolveBackend();
  const agent = resolveAgent(args.agent);
  const writer = resolveLessonWriter(args.writer);
  const spend = agent.costsTokens || writer.costsTokens;

  // A/A noise floor: smallest creditable held-out gain at this sample size.
  const band = 1.96 * Math.sqrt(0.25 / (HOLDOUT.length * args.K));

  process.stdout.write(
    `RL ON AGENT TRAJECTORIES — the loop (flywheel × daytona)\n` +
    `  backend: ${backend.kind}   agent: ${agent.kind}   lesson-writer: ${writer.kind}\n` +
    `  train: ${TRAIN.length} tasks · held-out: ${HOLDOUT.length} sealed · K=${args.K} rollouts/task\n` +
    `  noise band: ${(band * 100).toFixed(1)}pp` +
    `${spend ? "\n  ⚠ REAL LLM BACKEND — this run spends tokens" : "\n  free: fake agent through REAL Daytona grading (no token spend)"}\n\n`
  );

  const policy = [];          // [{mode, text}] — the accumulated lessons
  const curve = [];
  const roundLog = [];

  let base = await rolloutSet(backend, agent, HOLDOUT, policy, { K: args.K, concurrency: args.concurrency, rand });
  curve.push({ round: 0, mean: base.mean, lo: base.lo, hi: base.hi, status: "baseline" });
  let prev = base;
  process.stdout.write(`round 0  held-out ${(base.mean * 100).toFixed(0)}% ±${((base.hi - base.mean) * 100).toFixed(0)}  (baseline)\n`);

  const triedModes = new Set();
  let consecutiveRejects = 0;
  for (let round = 1; round <= args.rounds; round += 1) {
    // HARVEST: roll out train tasks, collect failing trajectories.
    const train = await rolloutSet(backend, agent, TRAIN, policy, { K: args.K, concurrency: args.concurrency, rand });
    const clusters = new Map();
    for (const r of train.results) {
      for (const f of r.failures) {
        if (f.mode == null || policy.some((p) => p.mode === f.mode) || triedModes.has(f.mode)) continue;
        if (!clusters.has(f.mode)) clusters.set(f.mode, { mode: f.mode, samples: [] });
        clusters.get(f.mode).samples.push(f);
      }
    }
    const top = [...clusters.values()].sort((a, b) => b.samples.length - a.samples.length)[0];
    if (!top) { process.stdout.write(`round ${round}  no fresh failure clusters — converged.\n`); break; }
    triedModes.add(top.mode);

    // POLICY UPDATE: distill one durable lesson from the cluster.
    const lessonText = await writer.write(top);
    const candidate = { mode: top.mode, text: lessonText };
    policy.push(candidate);

    // MEASURE + A/A GATE on the sealed held-out set.
    const after = await rolloutSet(backend, agent, HOLDOUT, policy, { K: args.K, concurrency: args.concurrency, rand });
    const gain = after.mean - prev.mean;
    if (gain > band) {
      curve.push({ round, mean: after.mean, lo: after.lo, hi: after.hi, status: "learned", lesson: lessonText, gain });
      roundLog.push({ round, mode: top.mode, lesson: lessonText, gain, status: "learned", cluster: top.samples.length });
      process.stdout.write(`round ${round}  held-out ${(after.mean * 100).toFixed(0)}% ±${((after.hi - after.mean) * 100).toFixed(0)}  +${(gain * 100).toFixed(1)}pp ✓ kept [${top.mode}, ${top.samples.length} failures]\n    "${lessonText}"\n`);
      prev = after; consecutiveRejects = 0;
    } else {
      policy.pop(); // can't verify → don't keep
      curve.push({ round, mean: prev.mean, lo: prev.lo, hi: prev.hi, status: "rejected", lesson: lessonText, gain });
      roundLog.push({ round, mode: top.mode, lesson: lessonText, gain, status: "rejected", cluster: top.samples.length });
      process.stdout.write(`round ${round}  held-out ${(prev.mean * 100).toFixed(0)}%  +${(gain * 100).toFixed(1)}pp ✗ rejected [${top.mode}] — under the ${(band * 100).toFixed(1)}pp noise band\n`);
      consecutiveRejects += 1;
      if (consecutiveRejects >= 2) { process.stdout.write(`\nstopping: two consecutive lessons under the noise floor — measurable gains exhausted at this scale.\n`); break; }
    }
  }

  const first = curve[0].mean, last = prev.mean;
  process.stdout.write(`\nheld-out: ${(first * 100).toFixed(0)}% → ${(last * 100).toFixed(0)}%  (+${((last - first) * 100).toFixed(0)}pp, ${policy.length} lessons kept)\n`);

  mkdirSync(args.out, { recursive: true });
  const report = {
    experiment: "rl-on-trajectories", agent: agent.kind, lesson_writer: writer.kind, backend: backend.kind,
    holdout: HOLDOUT.length, train: TRAIN.length, repeats: args.K, noise_band_pp: Number((band * 100).toFixed(1)),
    baseline: first, final: last, gain_pp: Number(((last - first) * 100).toFixed(1)),
    lessons_kept: policy.length, policy, curve, lessons: roundLog,
  };
  writeFileSync(path.join(args.out, "rl-loop.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(path.join(args.out, "rl-loop.html"), renderCurve(report));
  process.stdout.write(`\ncurve → ${path.join(args.out, "rl-loop.html")}\n`);
}

main().catch((e) => { process.stderr.write(`error: ${e.message}\n${e.stack ?? ""}\n`); process.exitCode = 1; });
