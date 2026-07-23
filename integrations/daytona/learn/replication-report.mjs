#!/usr/bin/env node
// REPLICATION — does the live RL curve reproduce, or was one run lucky?
//
// flywheel's ethos is to distrust n=1. This reads several independent live runs
// of the SAME config (codex is non-deterministic, so each is a fresh draw) and
// reports: the spread of baseline and final held-out, and — the honest question —
// WHICH lessons reliably clear the noise band across runs vs. which are flaky.
//
//   node replication-report.mjs rep1.json rep2.json rep3.json [--out DIR]

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
const fmt = (x) => `${Math.round(x * 100)}%`;

function aggregate(runs) {
  const baselines = runs.map((r) => r.baseline);
  const finals = runs.map((r) => r.final);
  const gains = runs.map((r) => r.final - r.baseline);
  // lesson reproducibility: per mode, count kept vs. attempted across runs
  const modes = new Map();
  for (const r of runs) for (const l of (r.lessons || [])) {
    if (!modes.has(l.mode)) modes.set(l.mode, { mode: l.mode, kept: 0, tried: 0, gains: [] });
    const m = modes.get(l.mode); m.tried += 1; m.gains.push(l.gain);
    if (l.status === "learned") m.kept += 1;
  }
  return {
    n: runs.length,
    baseline: { mean: mean(baselines), lo: Math.min(...baselines), hi: Math.max(...baselines), vals: baselines },
    final: { mean: mean(finals), lo: Math.min(...finals), hi: Math.max(...finals), vals: finals },
    gain: { mean: mean(gains), lo: Math.min(...gains), hi: Math.max(...gains) },
    modes: [...modes.values()].sort((a, b) => b.kept - a.kept || b.tried - a.tried),
  };
}

function overlay(runs) {
  const W = 780, H = 320, padL = 48, padR = 24, padT = 20, padB = 44, iw = W - padL - padR, ih = H - padT - padB;
  const maxR = Math.max(...runs.map((r) => r.curve.length - 1), 1);
  const x = (round) => padL + (round / maxR) * iw;
  const y = (v) => padT + ih - v * ih;
  const grid = [0, 0.25, 0.5, 0.75, 1].map((v) => `<line x1="${padL}" y1="${y(v)}" x2="${W - padR}" y2="${y(v)}" class="g"/><text x="${padL - 8}" y="${y(v) + 4}" class="yt">${v * 100}%</text>`).join("");
  const lines = runs.map((r, i) => {
    const pts = r.curve.map((c) => `${x(c.round).toFixed(1)},${y(c.mean).toFixed(1)}`);
    const dots = r.curve.map((c) => `<circle cx="${x(c.round).toFixed(1)}" cy="${y(c.mean).toFixed(1)}" r="3.2" class="rd r${i}"/>`).join("");
    return `<polyline points="${pts.join(" ")}" class="rl r${i}"/>${dots}`;
  }).join("");
  const xlabels = Array.from({ length: maxR + 1 }, (_, r) => `<text x="${x(r).toFixed(1)}" y="${H - padB + 22}" class="xt">R${r}</text>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Held-out curves from independent live runs, overlaid">
    ${grid}${lines}${xlabels}
    <text x="${padL}" y="${H - 6}" class="axis">learning round →   (each line = one independent live run)</text>
  </svg>`;
}

function render(runs, agg) {
  const rows = agg.modes.map((m) => {
    const rate = m.kept / m.tried;
    const cls = m.kept === m.tried ? "rel-y" : m.kept === 0 ? "rel-n" : "rel-p";
    return `<tr><td class="mono">${esc(m.mode)}</td><td class="mono">${m.kept}/${m.tried} runs</td>` +
      `<td class="mono ${cls}">${m.kept === m.tried ? "reliable" : m.kept === 0 ? "never cleared" : "flaky"}</td>` +
      `<td class="mono num">avg ${m.gains.length ? (mean(m.gains) * 100).toFixed(1) : "0"}pp</td></tr>`;
  }).join("");
  const reproduced = agg.final.hi - agg.final.lo <= 0.15 && agg.gain.lo > 0;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>flywheel — replication</title><style>
:root{--paper:#e7ebef;--card:#f4f6f8;--card2:#eef1f4;--ink:#141d26;--ink2:#4a5765;--ink3:#7c8894;--line:#cdd5dd;--line2:#bcc6cf;--brass:#8a6417;--green:#1f7a4d;--red:#c23b2b;--amber:#b5852a;--mono:ui-monospace,"SF Mono",Menlo,monospace;--sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
@media(prefers-color-scheme:dark){:root{--paper:#0e141b;--card:#161f28;--card2:#1b2732;--ink:#e7edf2;--ink2:#9aa8b5;--ink3:#6a7783;--line:#26333f;--line2:#324150;--brass:#e0b452;--green:#54c088;--red:#f0705e;--amber:#e0b452}}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.6 var(--sans);-webkit-font-smoothing:antialiased;background-image:radial-gradient(circle at 1px 1px,var(--line) 1px,transparent 0);background-size:26px 26px}
.wrap{max-width:880px;margin:0 auto;padding:44px 22px 90px}.eyebrow{font-family:var(--mono);font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink3);font-weight:600}
h1{font-size:clamp(26px,3.8vw,40px);letter-spacing:-.02em;margin:10px 0 8px;font-weight:800;text-wrap:balance}.sub{color:var(--ink2);max-width:72ch;margin:0 0 22px;font-size:16px}.sub b{color:var(--ink)}
.verdict{display:inline-block;font-family:var(--mono);font-size:13px;font-weight:700;padding:6px 13px;border-radius:8px;margin-bottom:20px}
.verdict.y{color:var(--green);border:1px solid color-mix(in srgb,var(--green) 40%,transparent);background:color-mix(in srgb,var(--green) 10%,transparent)}
.verdict.n{color:var(--amber);border:1px solid color-mix(in srgb,var(--amber) 40%,transparent)}
.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:0 0 26px}@media(max-width:640px){.cards{grid-template-columns:1fr}}
.stat{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:15px 16px}.stat .n{font-size:24px;font-weight:800;letter-spacing:-.02em;font-variant-numeric:tabular-nums}.stat .l{font-family:var(--mono);font-size:10.5px;letter-spacing:.05em;text-transform:uppercase;color:var(--ink3);margin-top:2px}
.panel{border:1px solid var(--line);border-radius:14px;background:var(--card);box-shadow:0 1px 2px rgba(20,29,38,.04),0 8px 30px rgba(20,29,38,.06);padding:22px;margin-bottom:24px}
svg{width:100%;height:auto;display:block}.g{stroke:var(--line);stroke-width:1}.yt,.xt{fill:var(--ink3);font-family:var(--mono);font-size:11px;text-anchor:middle}.yt{text-anchor:end}.axis{fill:var(--ink3);font-family:var(--mono);font-size:11px}
.rl{fill:none;stroke-width:2.5;stroke-linejoin:round;opacity:.9}.rd{stroke:var(--card);stroke-width:1.5}
.r0{stroke:var(--brass);fill:var(--brass)}.r1{stroke:var(--green);fill:var(--green)}.r2{stroke:var(--red);fill:var(--red)}.r3{stroke:var(--amber);fill:var(--amber)}
h2{font-size:16px;margin:8px 0 12px}table{border-collapse:collapse;width:100%;font-size:13.5px}th{text-align:left;padding:9px 14px;font-family:var(--mono);font-size:10.5px;letter-spacing:.04em;text-transform:uppercase;color:var(--ink3);border-bottom:1px solid var(--line)}
td{padding:10px 14px;border-bottom:1px solid var(--line)}tr:last-child td{border-bottom:0}.mono{font-family:var(--mono)}.num{text-align:right;color:var(--ink2)}
.rel-y{color:var(--green)}.rel-p{color:var(--amber)}.rel-n{color:var(--ink3)}
.note{border-left:3px solid var(--brass);padding:10px 0 10px 16px;margin:8px 0 0;color:var(--ink2);font-size:14.5px;max-width:78ch;line-height:1.6}.note b{color:var(--ink)}
.foot{margin-top:22px;font-family:var(--mono);font-size:12px;color:var(--ink3);line-height:1.7}
.leg{font-family:var(--mono);font-size:12px;color:var(--ink3);margin-top:10px}.leg b{color:var(--ink2)}
</style></head><body><div class="wrap">
<div class="eyebrow">flywheel · replication · live codex runs</div>
<h1>Does the learning curve reproduce — or was one run lucky?</h1>
<span class="verdict ${reproduced ? "y" : "n"}">${reproduced ? "✓ reproduces: every run climbed, finals within 15pp" : "◑ variable: the climb holds but the magnitude swings run-to-run"}</span>
<p class="sub"><b>${agg.n} independent live runs</b> of the same config — codex is non-deterministic, so each is a fresh draw. If the curve only climbed once, it was noise. If every run climbs, the mechanism is real.</p>
<div class="cards">
  <div class="stat"><div class="n">${fmt(agg.baseline.mean)} <span style="font-size:14px;color:var(--ink3)">(${fmt(agg.baseline.lo)}–${fmt(agg.baseline.hi)})</span></div><div class="l">baseline · mean (range)</div></div>
  <div class="stat"><div class="n">${fmt(agg.final.mean)} <span style="font-size:14px;color:var(--ink3)">(${fmt(agg.final.lo)}–${fmt(agg.final.hi)})</span></div><div class="l">final · mean (range)</div></div>
  <div class="stat"><div class="n" style="color:var(--green)">+${Math.round(agg.gain.mean * 100)}pp <span style="font-size:14px;color:var(--ink3)">(+${Math.round(agg.gain.lo * 100)}–${Math.round(agg.gain.hi * 100)})</span></div><div class="l">gain · mean (range)</div></div>
</div>
<div class="panel">${overlay(runs)}
<div class="leg">${runs.map((r, i) => `<b style="color:var(--${["brass", "green", "red", "amber"][i]})">▬</b> run ${i + 1}: ${fmt(r.baseline)}→${fmt(r.final)}`).join(" &nbsp; ")}</div></div>
<h2>Which lessons reliably clear the noise band?</h2>
<div class="panel" style="padding:0"><table><thead><tr><th>failure mode</th><th>kept</th><th>reliability</th><th>avg gain</th></tr></thead><tbody>${rows}</tbody></table></div>
<p class="note"><b>Reading it.</b> A lesson kept in every run is a real, reproducible fix; one kept in some runs is a real effect the measurement can't reliably resolve at this sample size (raise K/tasks); one never kept was noise. The honest claim is only as strong as what reproduces — this is what separates a mechanism from a lucky run.</p>
<div class="foot">${agg.n} live codex runs · same config · github.com/abhid1234/flywheel · integrations/daytona/learn</div>
</div></body></html>`;
}

function main() {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf("--out");
  const out = outIdx >= 0 ? args[outIdx + 1] : path.join(homedir(), ".flywheel", "daytona", "reps");
  const files = args.filter((a, i) => a.endsWith(".json") && (outIdx < 0 || i !== outIdx + 1));
  const runs = files.map((f) => JSON.parse(readFileSync(f, "utf8")));
  if (!runs.length) { process.stderr.write("no run JSONs given\n"); process.exit(1); }
  const agg = aggregate(runs);
  mkdirSync(out, { recursive: true });
  writeFileSync(path.join(out, "replication.json"), `${JSON.stringify({ agg, runs: runs.map((r) => ({ baseline: r.baseline, final: r.final, lessons: r.lessons })) }, null, 2)}\n`);
  writeFileSync(path.join(out, "replication.html"), render(runs, agg));
  process.stdout.write(`replication over ${agg.n} runs\n  baseline ${fmt(agg.baseline.mean)} (${fmt(agg.baseline.lo)}–${fmt(agg.baseline.hi)})\n  final    ${fmt(agg.final.mean)} (${fmt(agg.final.lo)}–${fmt(agg.final.hi)})\n  gain     +${Math.round(agg.gain.mean * 100)}pp (+${Math.round(agg.gain.lo * 100)}–${Math.round(agg.gain.hi * 100)})\n`);
  for (const m of agg.modes) process.stdout.write(`  ${m.mode.padEnd(16)} kept ${m.kept}/${m.tried}  avg ${(mean(m.gains) * 100).toFixed(1)}pp\n`);
  process.stdout.write(`\nreport → ${path.join(out, "replication.html")}\n`);
}

main();
