#!/usr/bin/env node
// CREDIT ASSIGNMENT — real, on Daytona, fork-free (works on any tier).
//
// When a multi-step agent trajectory fails, a single end pass/fail blames every
// step equally. This localizes the ACTUAL mistake: for each checkpoint k, replay
// the trajectory's prefix [0..k] in a fresh sandbox, then re-roll the continuation
// N times and grade each. Where the continuation pass-rate collapses from "some
// recover" to "all doomed" is the step that sank the run — that's where the credit
// (and the lesson) belongs.
//
// The Daytona RL talk uses snapshot+fork to make this cheap (don't replay the
// prefix each time). Forking is gated on this tier ("not supported for this
// sandbox"), so we use the fork-free equivalent: deterministic PREFIX REPLAY. Same
// signal, higher cost — the honest tradeoff the talk itself described.
//
//   --continuation reference  (default) free: scripted good/bad continuations,
//                             real Daytona execution. Proves the mechanism, 0 tokens.
//   --continuation codex      real: a live agent continues from the replayed state.
//
//   node credit-real.mjs [--forks 6] [--concurrency 6]

import { resolveBackend } from "../lib/client.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

// A recorded multi-step trajectory that FAILS at the end. The goal: make
// `python3 /tmp/ctask/run.py` exit 0. run.py imports helper and calls helper.value()
// which must return 42. The CRITICAL MISTAKE is at step 2: the agent writes the
// helper with the wrong value (7), which no later step repairs. Steps after it are
// reasonable but doomed by the poisoned prefix.
const TRAJECTORY = {
  goal: "python3 /tmp/ctask/run.py exits 0 (helper.value() must return 42)",
  criticalStep: 2,
  steps: [
    `mkdir -p /tmp/ctask`,
    `printf 'import helper\\nimport sys\\nsys.exit(0 if helper.value()==42 else 1)\\n' > /tmp/ctask/run.py`,
    `printf 'def value():\\n    return 7\\n' > /tmp/ctask/helper.py`,   // ← the mistake: 7, not 42
    `echo '# added a docstring' >> /tmp/ctask/helper.py`,
    `python3 -c "import ast; ast.parse(open('/tmp/ctask/helper.py').read())"`,  // syntax-checks; passes
  ],
};

// The verifier: does the trajectory's goal hold in the sandbox's current state?
const VERIFY = `cd /tmp/ctask && python3 run.py`;

// Continuation policies: given the state after a replayed prefix, produce follow-up
// steps that ATTEMPT to finish the task. A capable continuation fixes whatever is
// wrong that it can still see; but it cannot un-see a value it never knew was wrong.
function continuationSteps(kind) {
  if (kind === "reference") {
    // A competent "finisher": it ensures the task scaffolding is correct (always
    // (re)writes run.py, which is the spec), but it RESPECTS existing work —
    // helper.py is only written if absent. That single behaviour is what makes the
    // step matter: if the prefix hasn't written helper yet, the finisher writes a
    // correct one and RECOVERS; once the prefix contains the wrong helper (value=7),
    // the finisher trusts it, doesn't overwrite, and stays DOOMED. The poison is
    // upstream and invisible to the continuation — exactly the credit-assignment case.
    return [
      `mkdir -p /tmp/ctask`,
      `printf 'import helper, sys\\nsys.exit(0 if helper.value()==42 else 1)\\n' > /tmp/ctask/run.py`,
      `test -f /tmp/ctask/helper.py || printf 'def value():\\n    return 42\\n' > /tmp/ctask/helper.py`,
    ];
  }
  throw new Error(`continuation '${kind}' not wired in this build (reference only; codex is the gated next step)`);
}

async function pool(items, size, fn) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(size, items.length)) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

// Replay prefix [0..k], run one continuation, verify. Returns pass/fail.
async function replayAndContinue(backend, k, continuation, timeoutMs) {
  const prefix = TRAJECTORY.steps.slice(0, k);
  const steps = [`rm -rf /tmp/ctask`, ...prefix, ...continuation, VERIFY];
  const res = await backend.run(steps, { timeoutMs });
  return (res?.exitCode ?? 1) === 0;
}

async function main() {
  const args = { forks: 6, concurrency: 6, continuation: "reference", out: path.join(homedir(), ".flywheel", "daytona", "learn") };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--forks") args.forks = Number(argv[++i]);
    else if (a === "--concurrency") args.concurrency = Number(argv[++i]);
    else if (a === "--continuation") args.continuation = argv[++i];
    else if (a === "--out") args.out = argv[++i];
  }
  const backend = resolveBackend();
  process.stdout.write(
    `CREDIT ASSIGNMENT (real, fork-free) — flywheel × daytona\n` +
    `  backend: ${backend.kind}   continuation: ${args.continuation}\n` +
    `  trajectory: ${TRAJECTORY.steps.length} steps, failed at the end\n` +
    `  method: replay prefix[0..k] + re-roll ${args.forks} continuations, per checkpoint\n\n`
  );

  const checkpoints = [];
  for (let k = 0; k <= TRAJECTORY.steps.length; k += 1) {
    const cont = continuationSteps(args.continuation);
    const results = await pool(Array.from({ length: args.forks }, (_, i) => i), args.concurrency,
      () => replayAndContinue(backend, k, cont, 60_000));
    const pass = results.filter(Boolean).length;
    checkpoints.push({ checkpoint: k, forks: args.forks, pass, passRate: pass / args.forks });
  }

  // Locate the pivot: the largest drop in continuation pass-rate between consecutive
  // checkpoints — the step that poisoned the prefix.
  let pivot = 1, maxDrop = -Infinity;
  for (let i = 1; i < checkpoints.length; i += 1) {
    const drop = checkpoints[i - 1].passRate - checkpoints[i].passRate;
    if (drop > maxDrop) { maxDrop = drop; pivot = checkpoints[i].checkpoint; }
  }

  for (const c of checkpoints) {
    const bar = "█".repeat(Math.round(c.passRate * 20)).padEnd(20, "·");
    const mark = c.checkpoint === pivot ? "  ← credit collapses here" : "";
    process.stdout.write(`  after step ${String(c.checkpoint).padStart(2)}  ${bar} ${(c.passRate * 100).toFixed(0).padStart(3)}%  (${c.pass}/${c.forks})${mark}\n`);
  }
  const located = pivot - 1; // step index that caused the collapse
  process.stdout.write(`\nlocated the critical mistake at step ${located}  (ground truth: step ${TRAJECTORY.criticalStep})  ${located === TRAJECTORY.criticalStep ? "✓ exact" : `≈ off by ${Math.abs(located - TRAJECTORY.criticalStep)}`}\n`);
  process.stdout.write(`the poisoned decision — writing helper.value()=7 instead of 42 — is now the lesson target, not the whole trajectory.\n`);

  mkdirSync(args.out, { recursive: true });
  const report = { experiment: "credit-assignment-real", backend: backend.kind, continuation: args.continuation,
    steps: TRAJECTORY.steps.length, forks: args.forks, criticalStep: TRAJECTORY.criticalStep, located, checkpoints };
  writeFileSync(path.join(args.out, "credit-real.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`\nreport → ${path.join(args.out, "credit-real.json")}\n`);
}

main().catch((e) => { process.stderr.write(`error: ${e.message}\n`); process.exitCode = 1; });
