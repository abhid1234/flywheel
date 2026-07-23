#!/usr/bin/env node
// CREDIT ASSIGNMENT via snapshot + fork — flywheel × Daytona.
//
// Straight from the Daytona RL talk (7-21): when a long agent trajectory fails,
// a single pass/fail at the end is a terrible learning signal — it blames every
// action equally, including the good ones. The fix uses Daytona's differentiating
// primitive: SNAPSHOT the sandbox at each step, then FORK many continuations from
// each checkpoint. The step where forked continuations collapse from "some pass"
// to "all fail" localizes the critical mistake — that's where the credit (and the
// lesson) belongs.
//
// This upgrades flywheel's learning loop from "the agent failed this task" to
// "the agent's decision at step K sank it" — a far sharper lesson to learn.
//
//   --agent simulated  (default) faithful model of a T-step trajectory with a
//                       hidden critical step; forks are modelled, free, seeded.
//   --agent daytona     real: snapshot per step (Daytona snapshots) + fork via
//                       the SDK's _experimental_fork; each fork re-rolls a live
//                       agent from that exact state. Gated — costs LLM tokens.
//
//   node credit-assignment.mjs [--steps 12] [--forks 8] [--seed 7]

import { writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

function rng(seed) { let s = (seed >>> 0) || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }

// Model: a trajectory of `steps` actions with a hidden CRITICAL step. Forking R
// continuations from checkpoint k, each still-recoverable path passes with a
// probability that stays healthy BEFORE the critical step and collapses AT/AFTER
// it (the mistake is baked into the shared prefix). Plus run-to-run noise.
function forkFromCheckpoint(k, critical, forks, rand) {
  const RECOVERABLE = 0.62;   // before the mistake, a fresh roll often recovers
  const DOOMED = 0.06;        // after the mistake is in the prefix, almost never
  const p = k < critical ? RECOVERABLE : DOOMED;
  let pass = 0;
  for (let i = 0; i < forks; i += 1) {
    const noisy = Math.max(0, Math.min(1, p + (rand() - 0.5) * 0.1));
    if (rand() < noisy) pass += 1;
  }
  return { checkpoint: k, forks, pass, passRate: pass / forks };
}

function main() {
  const args = { steps: 12, forks: 8, seed: 7, out: path.join(homedir(), ".flywheel", "daytona", "learn") };
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--steps") args.steps = Number(argv[++i]);
    else if (a === "--forks") args.forks = Number(argv[++i]);
    else if (a === "--seed") args.seed = Number(argv[++i]);
    else if (a === "--out") args.out = argv[++i];
    else if (a === "--agent") args.agent = argv[++i];
  }
  const rand = rng(args.seed);
  // The hidden critical step this run will try to LOCATE (unknown to the method).
  const critical = 3 + Math.floor(rand() * (args.steps - 5));

  process.stdout.write(
    `CREDIT ASSIGNMENT via snapshot + fork  (flywheel × daytona)\n` +
    `  agent:  simulated  (mechanism demonstration — real snapshot/fork is gated)\n` +
    `  task:   a ${args.steps}-step trajectory that FAILED at the end\n` +
    `  method: fork ${args.forks} continuations from each checkpoint, watch the pass-rate\n\n`
  );

  const checkpoints = [];
  for (let k = 1; k <= args.steps; k += 1) checkpoints.push(forkFromCheckpoint(k, critical, args.forks, rand));

  // Locate the pivot: the last checkpoint whose forks still recovered materially,
  // i.e. the largest drop in pass-rate between consecutive checkpoints.
  let pivot = 1, maxDrop = -1;
  for (let i = 1; i < checkpoints.length; i += 1) {
    const drop = checkpoints[i - 1].passRate - checkpoints[i].passRate;
    if (drop > maxDrop) { maxDrop = drop; pivot = checkpoints[i].checkpoint; }
  }

  for (const c of checkpoints) {
    const bar = "█".repeat(Math.round(c.passRate * 20)).padEnd(20, "·");
    const mark = c.checkpoint === pivot ? "  ← credit collapses here" : "";
    process.stdout.write(`  step ${String(c.checkpoint).padStart(2)}  ${bar} ${(c.passRate * 100).toFixed(0).padStart(3)}%  (${c.pass}/${c.forks} forks passed)${mark}\n`);
  }
  process.stdout.write(`\nlocated the critical mistake at step ${pivot}  (ground truth: step ${critical})  ${pivot === critical ? "✓ exact" : `≈ within ${Math.abs(pivot - critical)}`}\n`);
  process.stdout.write(`\nlesson target: the agent's decision at step ${pivot} is what sank the run — cluster + learn THAT, not the whole trajectory.\n`);

  mkdirSync(args.out, { recursive: true });
  const report = { experiment: "credit-assignment", agent: "simulated", seed: args.seed, steps: args.steps, forks: args.forks, critical, pivot, checkpoints };
  writeFileSync(path.join(args.out, "credit-assignment.json"), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(path.join(args.out, "credit-assignment.html"), render(report));
  process.stdout.write(`\nchart → ${path.join(args.out, "credit-assignment.html")}\n`);
}

function render(r) {
  const W = 780, H = 300, padL = 46, padR = 20, padT = 20, padB = 42, iw = W - padL - padR, ih = H - padT - padB;
  const n = r.checkpoints.length;
  const x = (i) => padL + (i / (n - 1)) * iw, y = (v) => padT + ih - v * ih;
  const pts = r.checkpoints.map((c, i) => [x(i), y(c.passRate)]);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const grid = [0, 0.25, 0.5, 0.75, 1].map((v) => `<line x1="${padL}" y1="${y(v).toFixed(1)}" x2="${W - padR}" y2="${y(v).toFixed(1)}" class="g"/><text x="${padL - 8}" y="${(y(v) + 4).toFixed(1)}" class="yt">${v * 100}%</text>`).join("");
  const pivotIdx = r.checkpoints.findIndex((c) => c.checkpoint === r.pivot);
  const pivotX = x(pivotIdx);
  const dots = pts.map((p, i) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="4" class="${r.checkpoints[i].checkpoint === r.pivot ? "dp" : "d"}"/>`).join("");
  const xlabels = r.checkpoints.map((c, i) => `<text x="${x(i).toFixed(1)}" y="${H - padB + 20}" class="xt">${c.checkpoint}</text>`).join("");
  const esc = (s) => String(s);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>flywheel — credit assignment</title><style>
:root{--paper:#e7ebef;--card:#f4f6f8;--card2:#eef1f4;--ink:#141d26;--ink2:#4a5765;--ink3:#7c8894;--line:#cdd5dd;--brass:#8a6417;--red:#c23b2b;--green:#1f7a4d;--mono:ui-monospace,"SF Mono",Menlo,monospace;--sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
@media(prefers-color-scheme:dark){:root{--paper:#0e141b;--card:#161f28;--card2:#1b2732;--ink:#e7edf2;--ink2:#9aa8b5;--ink3:#6a7783;--line:#26333f;--brass:#e0b452;--red:#f0705e;--green:#54c088}}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.6 var(--sans);-webkit-font-smoothing:antialiased;background-image:radial-gradient(circle at 1px 1px,var(--line) 1px,transparent 0);background-size:26px 26px}
.wrap{max-width:860px;margin:0 auto;padding:44px 22px 80px}.eyebrow{font-family:var(--mono);font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink3);font-weight:600}
h1{font-size:clamp(26px,3.8vw,38px);letter-spacing:-.02em;margin:10px 0 8px;font-weight:800;text-wrap:balance}.sub{color:var(--ink2);max-width:70ch;margin:0 0 22px;font-size:16px}.sub b{color:var(--ink)}
.sim{display:inline-block;font-family:var(--mono);font-size:11.5px;color:var(--brass);border:1px solid color-mix(in srgb,var(--brass) 40%,transparent);border-radius:6px;padding:3px 9px;margin-bottom:18px}
.panel{border:1px solid var(--line);border-radius:14px;background:var(--card);box-shadow:0 1px 2px rgba(20,29,38,.04),0 8px 30px rgba(20,29,38,.06);padding:22px}
svg{width:100%;height:auto;display:block}.g{stroke:var(--line);stroke-width:1}.yt,.xt{fill:var(--ink3);font-family:var(--mono);font-size:11px;text-anchor:middle}.yt{text-anchor:end}
.cl{fill:none;stroke:var(--brass);stroke-width:2.5;stroke-linejoin:round}.d{fill:var(--brass);stroke:var(--card);stroke-width:1.5}.dp{fill:var(--red);stroke:var(--card);stroke-width:2}
.pivot{stroke:var(--red);stroke-width:1.5;stroke-dasharray:4 3}.pl{fill:var(--red);font-family:var(--mono);font-size:11px;font-weight:700}
.axis{fill:var(--ink3);font-family:var(--mono);font-size:11px}
.read{display:flex;gap:14px;align-items:baseline;margin:22px 0 0}.big{font-size:20px;font-weight:800;color:var(--red)}
.note{border-left:3px solid var(--brass);padding:10px 0 10px 16px;margin:24px 0 0;color:var(--ink2);font-size:14.5px;max-width:76ch;line-height:1.6}.note b{color:var(--ink)}
.foot{margin-top:22px;font-family:var(--mono);font-size:12px;color:var(--ink3);line-height:1.7}</style></head><body><div class="wrap">
<div class="eyebrow">flywheel × daytona · credit assignment</div>
<h1>The run failed at the end. Which step actually caused it?</h1>
<span class="sim">◑ simulated agent · mechanism demonstration · real snapshot/fork gated</span>
<p class="sub">A single pass/fail blames every action equally. Instead, we <b>snapshot the sandbox at each step and fork ${r.forks} fresh continuations from each one</b>. Where the forks collapse from "some recover" to "all doomed" is where the real mistake lives — that's the step worth learning from.</p>
<div class="panel"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Fork pass-rate per checkpoint, collapsing at the critical step">
${grid}
<line x1="${pivotX.toFixed(1)}" y1="${padT}" x2="${pivotX.toFixed(1)}" y2="${(H - padB).toFixed(1)}" class="pivot"/>
<text x="${(pivotX + 6).toFixed(1)}" y="${padT + 12}" class="pl">critical step</text>
<path d="${line}" class="cl"/>${dots}${xlabels}
<text x="${padL}" y="${H - 6}" class="axis">fork continuations from checkpoint (step) →</text>
</svg></div>
<div class="read"><span>Located the critical mistake at</span><span class="big">step ${r.pivot}</span><span style="color:var(--ink3);font-family:var(--mono);font-size:13px">— forks before it recover ~60%, forks after it fail ~95%</span></div>
<p class="note"><b>Why this makes flywheel sharper.</b> Today the loop learns from "task failed." With credit assignment it learns from "the decision at step ${r.pivot} sank it" — a precise, high-signal lesson instead of a diffuse one. It's only affordable because Daytona can snapshot an exact state and fork from it cheaply, instead of replaying the whole trajectory. <b>This run simulates the mechanism;</b> the real version snapshots a live agent per step and re-rolls with the SDK's fork primitive.</p>
<div class="foot">${r.steps} steps · ${r.forks} forks/checkpoint · seed ${r.seed} · idea from the Daytona RL talk, 2026-07-21<br>github.com/abhid1234/flywheel · integrations/daytona/learn</div>
</div></body></html>`;
}

main();
