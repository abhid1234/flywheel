#!/usr/bin/env node
// RL ON AGENT TRAJECTORIES — at the context layer.  (flywheel × Daytona)
//
// The same loop as reinforcement learning: the agent attempts tasks (rollouts),
// gets a VERIFIABLE REWARD (hidden tests pass/fail), and its policy improves from
// its own graded trajectories. The one difference from textbook RL is where the
// update lands: in accumulated LESSONS the agent carries into its context, not in
// model weights. No gradients — "experience" replayed as durable instructions.
//
//   rollout → reward → harvest failing trajectories → distill a lesson → repeat
//
// This is deliberately NOT a rosy demo. It models what a real run looks like:
//   · diminishing returns — the first lessons fix the commonest failures; the
//     tail is rarer and worth less each time
//   · measurement noise — every held-out number is an estimate with a CI
//   · REJECTED lessons — a proposed lesson whose held-out gain doesn't clear the
//     A/A noise band is NOT kept (you can't credit what you can't distinguish
//     from noise). That is why the curve PLATEAUS below 100%.
//   · an irreducible floor — some tasks the model just can't do reliably
//
//   --agent simulated  (default) a faithful model of the above. Free, seeded.
//   --agent daytona     real: live agent rolls out in Daytona, code graded by
//                       hidden tests, LLM distills the lesson. Gated (LLM tokens).
//
//   node experiment.mjs [--rounds 8] [--repeats 10] [--seed 42]

import { writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { renderCurve } from "./curve-report.mjs";

function rng(seed) { let s = (seed >>> 0) || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }

// ---- the task pool -----------------------------------------------------------
// Held-out problems, each with a recurring failure mode. Modes follow a realistic
// long tail: a few modes cause most failures, then a rare tail. Some problems are
// "irreducible" (the model can't do them reliably no matter the lesson), which is
// why no amount of learning reaches 100%.
const MODES = [
  { key: "null-handling",  problems: 7 },  // commonest → biggest, first-learned gain
  { key: "type-coercion",  problems: 5 },
  { key: "edge-boundaries",problems: 4 },
  { key: "precision",      problems: 2 },  // rare → gain will fall under the noise band
  { key: "ordering",       problems: 1 },
];
const LESSON_TEXT = {
  "null-handling": "Treat missing or null fields as expected input — default them, don't crash.",
  "type-coercion": "Parse and validate input types explicitly; never assume a string is a number.",
  "edge-boundaries": "Handle empty input and boundary indices before the main logic.",
  "precision": "Use integer/rounded arithmetic for money; never compare floats for equality.",
  "ordering": "Preserve first-seen order when de-duplicating; don't rely on set() ordering.",
};
const BASE_GATED = 0.30;   // a gated problem, cold, passes ~30% of rollouts
const WITH_LESSON = 0.80;  // once the lesson is learned, ~80% (never perfect)
const EASY_BASE = 0.85;    // problems the model already handles
const IRREDUCIBLE = 0.32;  // the hard floor — lessons don't move these

function buildHoldout() {
  const pool = [];
  let id = 0;
  for (let i = 0; i < 5; i += 1) pool.push({ id: id++, kind: "easy" });
  for (let i = 0; i < 6; i += 1) pool.push({ id: id++, kind: "irreducible" });
  for (const m of MODES) for (let i = 0; i < m.problems; i += 1) pool.push({ id: id++, kind: "gated", mode: m.key });
  return pool; // 30 problems
}

function passProb(problem, learned) {
  if (problem.kind === "easy") return EASY_BASE;
  if (problem.kind === "irreducible") return IRREDUCIBLE;
  return learned.has(problem.mode) ? WITH_LESSON : BASE_GATED;
}

// Measure held-out success over `repeats` rollouts/problem. Returns the observed
// mean (true rate + realistic sampling wiggle) and a 95% CI. More rollouts → a
// tighter CI → a lower noise floor → smaller real gains become creditable. That
// tradeoff is the whole reason to scale rollouts in Daytona.
function measure(pool, learned, repeats, rand) {
  let sum = 0; for (const p of pool) sum += passProb(p, learned);
  const trueMean = sum / pool.length;
  const N = pool.length * repeats;
  const se = Math.sqrt(Math.max(trueMean * (1 - trueMean), 0.0001) / N);
  const observed = Math.max(0, Math.min(1, trueMean + (rand() - 0.5) * 1.2 * se)); // sampling wiggle
  const half = 1.96 * se;
  return { mean: observed, lo: Math.max(0, observed - half), hi: Math.min(1, observed + half), N };
}

function main() {
  const args = { rounds: 8, repeats: 20, seed: 42, out: path.join(homedir(), ".flywheel", "daytona", "learn") };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--rounds") args.rounds = Number(argv[++i]);
    else if (a === "--repeats") args.repeats = Number(argv[++i]);
    else if (a === "--seed") args.seed = Number(argv[++i]);
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--agent") args.agent = argv[++i];
  }
  const rand = rng(args.seed);
  const holdout = buildHoldout();
  // A/A noise band: the smallest held-out change we can tell apart from noise,
  // given this measurement's sample size. Lessons below it can't be credited.
  const band = 1.96 * Math.sqrt(0.25 / (holdout.length * args.repeats));

  process.stdout.write(
    `RL ON AGENT TRAJECTORIES (context layer) — flywheel × daytona\n` +
    `  agent:    simulated  (faithful model — real Daytona+LLM run is gated)\n` +
    `  held-out: ${holdout.length} tasks, sealed · ${args.repeats} rollouts/task/round\n` +
    `  noise band (min creditable gain): ${(band * 100).toFixed(1)}pp\n\n`
  );

  const learned = new Set();
  const curve = [];
  const roundLog = [];
  let prev = measure(holdout, learned, args.repeats, rand);
  curve.push({ round: 0, ...prev, status: "baseline" });
  process.stdout.write(`round 0  held-out ${(prev.mean * 100).toFixed(0)}% ±${((prev.hi - prev.mean) * 100).toFixed(0)}  (baseline)\n`);

  const tried = new Set();
  let consecutiveRejects = 0;
  for (let round = 1; round <= args.rounds; round += 1) {
    // Pick the largest un-learned, un-tried failure cluster (harvested from the
    // training rollouts — modelled here by known prevalence).
    const candidate = MODES.filter((m) => !learned.has(m.key) && !tried.has(m.key))
      .sort((a, b) => b.problems - a.problems)[0];
    if (!candidate) { process.stdout.write(`round ${round}  no untried failure clusters left.\n`); break; }
    tried.add(candidate.key);

    // Tentatively learn the lesson, re-measure held-out, and A/A-gate the gain.
    learned.add(candidate.key);
    const after = measure(holdout, learned, args.repeats, rand);
    const gain = after.mean - prev.mean;
    const credited = gain > band;
    if (credited) {
      curve.push({ round, ...after, status: "learned", lesson: LESSON_TEXT[candidate.key], gain });
      roundLog.push({ round, mode: candidate.key, lesson: LESSON_TEXT[candidate.key], gain, status: "learned" });
      process.stdout.write(`round ${round}  held-out ${(after.mean * 100).toFixed(0)}% ±${((after.hi - after.mean) * 100).toFixed(0)}  +${(gain * 100).toFixed(1)}pp ✓ kept: "${LESSON_TEXT[candidate.key]}"\n`);
      prev = after; consecutiveRejects = 0;
    } else {
      learned.delete(candidate.key); // can't verify it → don't keep it
      curve.push({ round, ...prev, status: "rejected", lesson: LESSON_TEXT[candidate.key], gain });
      roundLog.push({ round, mode: candidate.key, lesson: LESSON_TEXT[candidate.key], gain, status: "rejected" });
      process.stdout.write(`round ${round}  held-out ${(prev.mean * 100).toFixed(0)}%  +${(gain * 100).toFixed(1)}pp ✗ REJECTED — under the ${(band * 100).toFixed(1)}pp noise band, not kept\n`);
      consecutiveRejects += 1;
      if (consecutiveRejects >= 2) { process.stdout.write(`\nstopping: two consecutive lessons fell under the noise floor — the measurable gains are exhausted at this scale.\n`); break; }
    }
  }

  const first = curve[0].mean, last = prev.mean;
  process.stdout.write(
    `\nheld-out: ${(first * 100).toFixed(0)}% → ${(last * 100).toFixed(0)}%  (+${((last - first) * 100).toFixed(0)}pp, ${learned.size} lessons kept)\n` +
    `plateau: further lessons exist but their gains are below the ${(band * 100).toFixed(1)}pp noise floor.\n` +
    `to keep learning, LOWER the floor: more held-out tasks + more rollouts — i.e. more Daytona.\n`
  );

  mkdirSync(args.out, { recursive: true });
  const report = {
    experiment: "rl-on-trajectories", agent: "simulated", seed: args.seed,
    holdout: holdout.length, repeats: args.repeats, noise_band_pp: Number((band * 100).toFixed(1)),
    baseline: first, final: last, gain_pp: Number(((last - first) * 100).toFixed(1)),
    lessons_kept: learned.size, curve, lessons: roundLog,
  };
  writeFileSync(path.join(args.out, "learning-curve.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(path.join(args.out, "learning-curve.html"), renderCurve(report));
  process.stdout.write(`\ncurve → ${path.join(args.out, "learning-curve.html")}\n`);
}

main();
