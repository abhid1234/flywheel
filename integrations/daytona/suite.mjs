#!/usr/bin/env node
// flywheel × Daytona — the benchmark. Runs the whole controlled-task suite across
// isolated sandboxes at scale, scores each with flywheel's real A/A-gated verdict,
// writes one combined gold corpus, and renders an HTML results report.
//
//   node suite.mjs --n 60 [--tasks env-yaml,file-missing] [--concurrency 8]
//
// Backend auto-selects: real Daytona if DAYTONA_API_KEY is set, else the mock.

import { resolveBackend } from "./lib/client.mjs";
import { runTask } from "./lib/trial.mjs";
import { TASKS, getTask } from "./tasks/index.mjs";
import { renderReport } from "./lib/report.mjs";
import { writeFileSync, mkdirSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

function parseArgs(argv) {
  const out = { n: 60, concurrency: 8, tasks: null, out: path.join(homedir(), ".flywheel", "daytona") };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--n") out.n = Number(argv[++i]);
    else if (a === "--concurrency") out.concurrency = Number(argv[++i]);
    else if (a === "--tasks") out.tasks = String(argv[++i]).split(",").map((s) => s.trim()).filter(Boolean);
    else if (a === "--out") out.out = argv[++i];
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { process.stdout.write("usage: node suite.mjs --n <trials-per-arm> [--tasks a,b,c] [--concurrency N] [--out DIR]\n"); return; }
  if (!Number.isInteger(args.n) || args.n < 1) throw new Error("--n must be a positive integer");

  const tasks = args.tasks ? args.tasks.map((id) => { const t = getTask(id); if (!t) throw new Error(`unknown task: ${id}`); return t; }) : TASKS;
  const backend = resolveBackend();
  const stamp = new Date().toISOString();
  const totalSandboxes = tasks.length * (args.n * 2 + Math.min(args.n, 20) * 2);

  process.stdout.write(
    `flywheel × daytona — benchmark\n` +
    `  backend: ${backend.kind}${backend.kind === "mock" ? "  ⚠ offline mock" : ""}\n` +
    `  tasks:   ${tasks.length}  (${tasks.map((t) => t.id).join(", ")})\n` +
    `  n:       ${args.n} per arm  →  ~${totalSandboxes} sandboxes total\n\n`
  );

  mkdirSync(args.out, { recursive: true });
  const goldPath = path.join(args.out, "daytona-episodes.jsonl");
  const results = [];
  for (const task of tasks) {
    process.stdout.write(`▶ ${(task.fn || task.id).padEnd(11)} ${task.title.padEnd(30)} … `);
    const r = await runTask(task, { backend, n: args.n, concurrency: args.concurrency, timeoutMs: 120_000, stamp });
    for (const ep of r.episodes) appendFileSync(goldPath, `${JSON.stringify(ep)}\n`);
    const { episodes, ...summary } = r;
    results.push(summary);
    const mark = r.verdict === "helped" ? "✓ fix verified" : r.verdict;
    process.stdout.write(
      `${(r.before.failRate * 100).toFixed(0)}%→${(r.after.failRate * 100).toFixed(0)}%  ` +
      `Δ${r.delta.toFixed(2)} band${r.band95.toFixed(2)}  ${r.powered ? "powered" : "underpowered"}  ${mark}` +
      `${r.incomplete ? `  (${r.incomplete} incomplete)` : ""}  ${r.elapsed_s}s\n`
    );
  }

  const helped = results.filter((r) => r.verdict === "helped").length;
  const goldTotal = results.reduce((s, r) => s + r.n * 2, 0);
  const report = {
    ts: stamp, backend: backend.kind, n_per_arm: args.n,
    tasks_total: results.length, tasks_helped: helped,
    gold_episodes: goldTotal, sandboxes: results.reduce((s, r) => s + r.sandboxes, 0),
    elapsed_s: Number(results.reduce((s, r) => s + r.elapsed_s, 0).toFixed(1)),
    results,
  };
  writeFileSync(path.join(args.out, "benchmark.json"), `${JSON.stringify(report, null, 2)}\n`);
  const html = renderReport(report);
  writeFileSync(path.join(args.out, "benchmark.html"), html);

  process.stdout.write(
    `\n${helped}/${results.length} tasks reached verdict "helped" (A/A-gated, n≥60 powered)\n` +
    `${goldTotal} gold episodes → ${goldPath}\n` +
    `report → ${path.join(args.out, "benchmark.html")}\n`
  );
}

main().catch((error) => { process.stderr.write(`error: ${error.message}\n`); process.exitCode = 1; });
