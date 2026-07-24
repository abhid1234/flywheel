#!/usr/bin/env node
// CREDIT ASSIGNMENT with a LIVE agent continuation — real, on Daytona.
//
// credit-real.mjs proves the mechanism with a scripted "finisher". This proves it
// with an actual agent: at each checkpoint we replay the trajectory prefix, show a
// LIVE codex agent the goal and the current sandbox state, and let it write the
// commands to finish. Where the agent stops being able to recover is the step that
// sank the run.
//
// The honesty problem with a real agent: a competent model that can SEE a bug will
// just fix it, and the collapse never happens. So the critical mistake here is
// genuinely UNRECOVERABLE — step 2 deletes the source data. A fork taken before it
// still has the data and the agent recovers; a fork taken after it cannot, because
// the data is truly gone. No amount of intelligence brings back a deleted file.
//
//   node credit-codex.mjs [--forks 4] [--concurrency 4]   (spends codex tokens)

import { resolveBackend } from "../lib/client.mjs";
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const DIR = "/tmp/ctask";
// Goal (given to the agent). It deliberately does NOT reveal the source content —
// so once src.txt is deleted, the checksum is unrecoverable by any means.
const GOAL = `${DIR}/out.txt must contain the MD5 checksum (hex, no filename) of the original ${DIR}/src.txt.`;

// A recorded trajectory that fails at the end. Step 2 deletes the source file it
// still needs — the unrecoverable mistake. Later steps flail without it.
const TRAJECTORY = {
  criticalStep: 2,
  steps: [
    `mkdir -p ${DIR} && printf 'hello world\\n' > ${DIR}/src.txt`,
    `echo 'processing' > ${DIR}/log.txt`,
    `rm -f ${DIR}/src.txt`,                                  // ← critical: source gone
    `echo 'computing' >> ${DIR}/log.txt`,
    `touch ${DIR}/out.txt`,
  ],
};
// Hidden oracle: out.txt must equal the md5 of the ORIGINAL content. The verifier
// knows the content; the agent never does.
const VERIFY = `test -f ${DIR}/out.txt && [ "$(cat ${DIR}/out.txt)" = "$(printf 'hello world\\n' | md5sum | cut -d' ' -f1)" ]`;
const STATE_CAPTURE = `echo "=== ls ${DIR} ==="; ls -la ${DIR} 2>/dev/null; for f in ${DIR}/*; do echo "--- $f ---"; cat "$f" 2>/dev/null; done`;

async function runCLI(cmd, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("codex timed out")); }, timeoutMs);
    child.stdout.on("data", (d) => (out += d)); child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => { clearTimeout(timer); reject(e); });
    child.on("close", () => { clearTimeout(timer); resolve(out || err); });
    child.stdin.end();
  });
}

// Ask codex to write bash to finish the task from the observed state.
async function codexContinuation(state) {
  const prompt = `You are finishing a task in a Linux sandbox. Output ONLY bash commands (no prose, no markdown fences).\n\nGOAL: ${GOAL}\n\nCurrent state of ${DIR}:\n${state}\n\nWrite the bash commands to accomplish the goal from this exact state.`;
  const out = await runCLI("codex", ["exec", "--sandbox", "read-only", "--skip-git-repo-check", "-m", "gpt-5.6-sol", prompt], 120_000);
  const fence = out.match(/```(?:bash|sh)?\s*([\s\S]*?)```/i);
  return (fence ? fence[1] : out).trim();
}

async function pool(items, size, fn) {
  const out = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.max(1, Math.min(size, items.length)) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i], i); }
  }));
  return out;
}

// One fork from checkpoint k: replay prefix → capture state → codex writes finisher
// → replay prefix + run finisher + verify. (Prefix is deterministic, so replaying
// it twice yields the identical state the agent saw.)
async function forkFromCheckpoint(backend, k) {
  const prefix = TRAJECTORY.steps.slice(0, k);
  const stateRes = await backend.run([`rm -rf ${DIR}`, ...prefix, STATE_CAPTURE], { timeoutMs: 60_000 });
  const state = `${stateRes?.stdout ?? ""}`.trim() || "(empty)";
  const finisher = await codexContinuation(state);
  const finisherLines = finisher.split("\n").filter((l) => l.trim() && !l.trim().startsWith("#"));
  const res = await backend.run([`rm -rf ${DIR}`, ...prefix, ...finisherLines, VERIFY], { timeoutMs: 90_000 });
  return (res?.exitCode ?? 1) === 0;
}

async function main() {
  const args = { forks: 4, concurrency: 4, out: path.join(homedir(), ".flywheel", "daytona", "learn") };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--forks") args.forks = Number(argv[++i]);
    else if (a === "--concurrency") args.concurrency = Number(argv[++i]);
    else if (a === "--out") args.out = argv[++i];
  }
  const backend = resolveBackend();
  process.stdout.write(
    `CREDIT ASSIGNMENT · live codex continuation — flywheel × daytona\n` +
    `  backend: ${backend.kind}   agent: codex (real, spends tokens)\n` +
    `  trajectory: ${TRAJECTORY.steps.length} steps; step 2 deletes the source (unrecoverable)\n` +
    `  method: replay prefix[0..k] → codex continues from the observed state, per checkpoint\n\n`
  );

  const checkpoints = [];
  for (let k = 0; k <= TRAJECTORY.steps.length; k += 1) {
    const results = await pool(Array.from({ length: args.forks }, (_, i) => i), args.concurrency, () => forkFromCheckpoint(backend, k));
    const pass = results.filter(Boolean).length;
    checkpoints.push({ checkpoint: k, forks: args.forks, pass, passRate: pass / args.forks });
    const bar = "█".repeat(Math.round(pass / args.forks * 20)).padEnd(20, "·");
    process.stdout.write(`  after step ${String(k).padStart(2)}  ${bar} ${(pass / args.forks * 100).toFixed(0).padStart(3)}%  (${pass}/${args.forks})\n`);
  }

  let pivot = 1, maxDrop = -Infinity;
  for (let i = 1; i < checkpoints.length; i += 1) {
    const drop = checkpoints[i - 1].passRate - checkpoints[i].passRate;
    if (drop > maxDrop) { maxDrop = drop; pivot = checkpoints[i].checkpoint; }
  }
  const located = pivot - 1;
  process.stdout.write(`\nlocated the critical mistake at step ${located}  (ground truth: step ${TRAJECTORY.criticalStep})  ${located === TRAJECTORY.criticalStep ? "✓ exact" : `≈ off by ${Math.abs(located - TRAJECTORY.criticalStep)}`}\n`);
  process.stdout.write(`even a live agent cannot recover a fork taken after step ${TRAJECTORY.criticalStep} — the source was deleted. That is where the credit belongs.\n`);

  mkdirSync(args.out, { recursive: true });
  writeFileSync(path.join(args.out, "credit-codex.json"), `${JSON.stringify({ experiment: "credit-assignment-codex", backend: backend.kind, agent: "codex", steps: TRAJECTORY.steps.length, forks: args.forks, criticalStep: TRAJECTORY.criticalStep, located, checkpoints }, null, 2)}\n`);
  process.stdout.write(`\nreport → ${path.join(args.out, "credit-codex.json")}\n`);
}

main().catch((e) => { process.stderr.write(`error: ${e.message}\n`); process.exitCode = 1; });
