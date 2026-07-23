#!/usr/bin/env node
// THE LEARNING CURVE — a continual-learning experiment for flywheel.
//
// This is the flywheel thesis made measurable: an agent attempts real tasks,
// some fail, the system harvests the failures, proposes a DURABLE LESSON, the
// agent absorbs it, and its success on a SEALED held-out set climbs round over
// round. The curve that climbs IS the continual learning.
//
// Two backends, one loop:
//   --agent simulated  (default) a faithful MODEL of how an agent improves as
//                       relevant lessons enter its instructions. Free, offline,
//                       reproducible. Proves the loop + the visualization.
//   --agent daytona     the REAL thing: each attempt runs a live coding agent in
//                       an isolated Daytona sandbox, its code graded by a hidden
//                       test suite. Costs LLM tokens (not just sandbox compute).
//                       Wired but gated — see learn.realAttempt() / README.
//
// The honesty guardrails from the core project hold here:
//   · the held-out set is SEALED — never seen during learning
//   · the LLM writes the lesson; the SUCCESS CRITERION is the held-out tests
//   · improvement is only credited on held-out, never on the training set
//
//   node experiment.mjs [--rounds 6] [--repeats 8] [--seed 42] [--out DIR]

import { writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { renderCurve } from "./curve-report.mjs";

// ---- deterministic PRNG (seeded, so the demo is reproducible) ----------------
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }

// ---- the task pool -----------------------------------------------------------
// A coding-agent benchmark: write code to a spec, graded by a hidden test suite.
// Each problem has a FAILURE MODE — the recurring mistake that sinks it — which a
// single durable lesson repairs. This is what makes failures cluster into lessons.
const FAILURE_MODES = [
  { key: "edge-empty", lesson: "Always handle the empty-input case explicitly before the main logic." },
  { key: "off-by-one", lesson: "Re-check loop and slice bounds for off-by-one errors; verify the last element is included." },
  { key: "type-coercion", lesson: "Parse and validate input types; never assume a string is already a number." },
  { key: "null-fields", lesson: "Treat missing/null fields as expected input; default them, don't crash." },
  { key: "precision", lesson: "Use integer cents or rounding for money; never compare floats for equality." },
];

// 40 problems: some "easy" (a competent agent passes regardless), the rest each
// gated by one failure mode. Split 50/50 into a training pool and a SEALED
// held-out set. Distribution mirrors real life: a long tail of recurring mistakes.
function buildPool(rand) {
  const pool = [];
  for (let i = 0; i < 40; i += 1) {
    const easy = i % 5 === 0; // ~20% are easy
    const mode = easy ? null : FAILURE_MODES[i % FAILURE_MODES.length].key;
    pool.push({ id: `prob-${i}`, split: i % 2 === 0 ? "train" : "holdout", easy, mode });
  }
  return pool;
}

// ---- the simulated agent -----------------------------------------------------
// Faithful model, NOT canned results: an attempt succeeds with a probability that
// depends on whether the lesson for this problem's failure mode is in the agent's
// current instructions. Easy problems: high base skill. Gated problems: usually
// fail UNTIL the lesson is learned, then usually pass. Plus run-to-run noise —
// which is exactly why the A/A noise floor and held-out sealing matter.
function attempt(problem, learnedLessons, rand) {
  const BASE_EASY = 0.92;        // competent on easy problems
  const BASE_GATED = 0.18;       // usually fails a gated problem cold
  const WITH_LESSON = 0.9;       // usually passes once the lesson is learned
  let p;
  if (problem.easy) p = BASE_EASY;
  else p = learnedLessons.has(problem.mode) ? WITH_LESSON : BASE_GATED;
  // small per-attempt noise band (~±4pp) — the real world is never clean
  p = Math.max(0, Math.min(1, p + (rand() - 0.5) * 0.08));
  return rand() < p;
}

// Measure success rate on a set of problems, averaged over `repeats` attempts.
function measure(problems, learned, repeats, rand) {
  let pass = 0, total = 0;
  for (const prob of problems) {
    for (let r = 0; r < repeats; r += 1) { total += 1; if (attempt(prob, learned, rand)) pass += 1; }
  }
  return total ? pass / total : 0;
}

// ---- the learning loop -------------------------------------------------------
async function main() {
  const args = { rounds: 6, repeats: 8, seed: 42, out: path.join(homedir(), ".flywheel", "daytona", "learn") };
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
  const pool = buildPool(rand);
  const train = pool.filter((p) => p.split === "train");
  const holdout = pool.filter((p) => p.split === "holdout"); // SEALED

  const learned = new Set();       // the agent's accumulated lessons (its memory)
  const curve = [];                // held-out success per round
  const roundLog = [];

  process.stdout.write(
    `THE LEARNING CURVE — flywheel continual-learning experiment\n` +
    `  agent:    simulated  (mechanism demonstration — real-LLM run is gated, see README)\n` +
    `  problems: ${pool.length}  (${train.length} train / ${holdout.length} sealed held-out)\n` +
    `  rounds:   ${args.rounds}   repeats: ${args.repeats}\n\n`
  );

  // Round 0 — baseline on the sealed held-out set, before any learning.
  let holdoutRate = measure(holdout, learned, args.repeats, rand);
  curve.push({ round: 0, holdout: holdoutRate, lessons: 0 });
  process.stdout.write(`round 0  held-out ${(holdoutRate * 100).toFixed(0)}%   (baseline, 0 lessons)\n`);

  for (let round = 1; round <= args.rounds; round += 1) {
    // 1. HARVEST: run the training pool; record which failure modes are sinking it.
    const failCounts = new Map();
    for (const prob of train) {
      for (let r = 0; r < args.repeats; r += 1) {
        if (!attempt(prob, learned, rand) && prob.mode && !learned.has(prob.mode)) {
          failCounts.set(prob.mode, (failCounts.get(prob.mode) ?? 0) + 1);
        }
      }
    }
    // 2. CLUSTER + PROPOSE: take the biggest un-learned failure cluster, and
    //    propose its durable lesson. (Real backend: the LLM writes this lesson
    //    from the clustered failing transcripts.)
    const top = [...failCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!top) { process.stdout.write(`round ${round}  no new failure cluster — converged.\n`); break; }
    const mode = FAILURE_MODES.find((m) => m.key === top[0]);
    // 3. APPLY: the lesson enters the agent's standing instructions (its memory).
    learned.add(mode.key);
    // 4. RE-MEASURE on the sealed held-out set.
    holdoutRate = measure(holdout, learned, args.repeats, rand);
    curve.push({ round, holdout: holdoutRate, lessons: learned.size });
    roundLog.push({ round, learned: mode.key, lesson: mode.lesson, failures_clustered: top[1], holdout: holdoutRate });
    process.stdout.write(`round ${round}  held-out ${(holdoutRate * 100).toFixed(0)}%   +lesson: "${mode.lesson}"\n`);
  }

  const first = curve[0].holdout, last = curve.at(-1).holdout;
  process.stdout.write(`\nheld-out success: ${(first * 100).toFixed(0)}% → ${(last * 100).toFixed(0)}%  (+${((last - first) * 100).toFixed(0)}pp over ${curve.length - 1} rounds, ${learned.size} lessons learned)\n`);

  mkdirSync(args.out, { recursive: true });
  const report = {
    experiment: "learning-curve", agent: "simulated", seed: args.seed,
    problems: pool.length, train: train.length, holdout: holdout.length,
    rounds: curve.length - 1, repeats: args.repeats,
    baseline: first, final: last, gain_pp: Number(((last - first) * 100).toFixed(1)),
    curve, lessons: roundLog,
  };
  writeFileSync(path.join(args.out, "learning-curve.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(path.join(args.out, "learning-curve.html"), renderCurve(report));
  process.stdout.write(`\ncurve → ${path.join(args.out, "learning-curve.html")}\n`);
}

main().catch((e) => { process.stderr.write(`error: ${e.message}\n`); process.exitCode = 1; });
