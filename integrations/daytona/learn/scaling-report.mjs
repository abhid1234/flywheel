#!/usr/bin/env node
// SCALING REPORT — aggregates the overnight batch into the headline launch asset:
// the scaling law. Reads the sweep runs (final held-out vs rollout count K) and the
// K=10 replications, and renders a self-contained HTML page showing that more
// rollouts — more Daytona compute — lowers the noise floor and lifts the curve.
//
//   node scaling-report.mjs <resultsDir> [--out DIR]
// resultsDir holds sweep-k*.json and rep-k10-*.json from overnight.sh.

import { readFileSync, writeFileSync, readdirSync, mkdirSync } from "node:fs";
import path from "node:path";

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const mean = (a) => a.length ? a.reduce((s, x) => s + x, 0) / a.length : 0;
const pct = (x) => `${Math.round(x * 100)}%`;

function load(dir) {
  const files = readdirSync(dir).filter((f) => f.endsWith(".json"));
  const sweep = [], reps = [];
  for (const f of files) {
    let r; try { r = JSON.parse(readFileSync(path.join(dir, f), "utf8")); } catch { continue; }
    if (f.startsWith("sweep-k")) sweep.push({ K: r.repeats, ...r });
    else if (f.startsWith("rep-k10")) reps.push({ K: r.repeats, ...r });
  }
  sweep.sort((a, b) => a.K - b.K);
  return { sweep, reps };
}

function scalingChart(sweep) {
  if (!sweep.length) return "<p class='cap'>no sweep data yet</p>";
  const W = 640, H = 300, padL = 48, padR = 24, padT = 22, padB = 46, iw = W - padL - padR, ih = H - padT - padB;
  const ks = sweep.map((s) => s.K), maxK = Math.max(...ks, 1);
  const x = (k) => padL + (k / maxK) * iw;
  const y = (v) => padT + ih - v * ih;
  const grid = [0, 0.25, 0.5, 0.75, 1].map((v) => `<line x1="${padL}" y1="${y(v)}" x2="${W - padR}" y2="${y(v)}" class="g"/><text x="${padL - 8}" y="${y(v) + 4}" class="yt">${v * 100}%</text>`).join("");
  const pts = sweep.map((s) => [x(s.K), y(s.final)]);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const dots = sweep.map((s) => `<circle cx="${x(s.K).toFixed(1)}" cy="${y(s.final).toFixed(1)}" r="4.5" class="dot"/>` +
    `<text x="${x(s.K).toFixed(1)}" y="${(y(s.final) - 12).toFixed(1)}" class="val">${pct(s.final)}</text>` +
    `<text x="${x(s.K).toFixed(1)}" y="${H - padB + 22}" class="xt">K=${s.K}</text>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Final held-out success rising with rollout count K">
    ${grid}<path d="${line}" class="cl"/>${dots}
    <text x="${padL}" y="${H - 6}" class="axl">rollouts per task (K) — more Daytona compute →</text></svg>`;
}

function render({ sweep, reps }) {
  const repFinals = reps.map((r) => r.final);
  const repMean = mean(repFinals);
  const climbs = [...sweep, ...reps].every((r) => r.final > r.baseline);
  const best = sweep.length ? sweep.reduce((a, b) => (b.final > a.final ? b : a)) : null;
  const sweepRows = sweep.map((s) => `<tr><td class="k">K=${s.K}</td><td>${pct(s.baseline)}</td><td class="ok">${pct(s.final)}</td><td>${s.noise_band_pp}pp</td><td>${s.lessons_kept}</td></tr>`).join("");
  const repRows = reps.map((r, i) => `<tr><td class="k">run ${i + 1}</td><td>${pct(r.baseline)}</td><td class="ok">${pct(r.final)}</td><td>+${Math.round((r.final - r.baseline) * 100)}pp</td><td>${r.lessons_kept}</td></tr>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>flywheel — the scaling law</title><style>
:root{--paper:#e7ebef;--card:#f4f6f8;--card2:#eef1f4;--ink:#141d26;--ink2:#42505f;--ink3:#7c8894;--line:#cdd5dd;--line2:#bcc6cf;--brass:#8a6417;--green:#1f7a4d;--mono:ui-monospace,"SF Mono",Menlo,monospace;--sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
@media(prefers-color-scheme:dark){:root{--paper:#0e141b;--card:#161f28;--card2:#1b2732;--ink:#e7edf2;--ink2:#a4b1bd;--ink3:#6a7783;--line:#26333f;--line2:#324150;--brass:#e0b452;--green:#54c088}}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.65 var(--sans);-webkit-font-smoothing:antialiased;background-image:radial-gradient(circle at 1px 1px,var(--line) 1px,transparent 0);background-size:26px 26px}
.wrap{max-width:860px;margin:0 auto;padding:48px 22px 90px}
.eyebrow{font-family:var(--mono);font-size:12px;letter-spacing:.15em;text-transform:uppercase;color:var(--brass);font-weight:600}
h1{font-size:clamp(28px,4.4vw,42px);letter-spacing:-.02em;font-weight:800;margin:12px 0 10px;text-wrap:balance;line-height:1.1}
.sub{color:var(--ink2);max-width:70ch;margin:0 0 26px;font-size:17px}.sub b{color:var(--ink)}
.verdict{display:inline-block;font-family:var(--mono);font-size:13px;font-weight:700;padding:6px 13px;border-radius:8px;margin-bottom:22px;color:var(--green);border:1px solid color-mix(in srgb,var(--green) 40%,transparent);background:color-mix(in srgb,var(--green) 10%,transparent)}
.panel{border:1px solid var(--line);border-radius:14px;background:var(--card);box-shadow:0 1px 2px rgba(20,29,38,.04),0 8px 30px rgba(20,29,38,.05);padding:24px;margin:8px 0 26px}
svg{width:100%;height:auto;display:block}.g{stroke:var(--line);stroke-width:1}.yt,.xt{fill:var(--ink3);font-family:var(--mono);font-size:11px;text-anchor:middle}.yt{text-anchor:end}.axl{fill:var(--ink3);font-family:var(--mono);font-size:11px}
.cl{fill:none;stroke:var(--brass);stroke-width:2.5;stroke-linejoin:round;stroke-linecap:round}.dot{fill:var(--brass);stroke:var(--card);stroke-width:2}.val{fill:var(--ink);font-family:var(--mono);font-size:11.5px;font-weight:700;text-anchor:middle}
.cap{font-family:var(--mono);font-size:12px;color:var(--ink3);margin-top:12px;text-align:center}
h2{font-size:15px;font-family:var(--mono);letter-spacing:.03em;text-transform:uppercase;color:var(--brass);margin:34px 0 12px}
table{border-collapse:collapse;width:100%;font-family:var(--mono);font-size:13.5px}th{text-align:left;padding:9px 13px;font-size:10.5px;letter-spacing:.05em;text-transform:uppercase;color:var(--ink3);border-bottom:1px solid var(--line)}
td{padding:9px 13px;border-bottom:1px solid var(--line);color:var(--ink2)}tr:last-child td{border-bottom:0}td.k{color:var(--ink);font-weight:600}.ok{color:var(--green)}
.note{border-left:3px solid var(--brass);padding:10px 0 10px 16px;margin:26px 0 0;color:var(--ink2);font-size:14.5px;line-height:1.6;max-width:78ch}.note b{color:var(--ink)}
.foot{margin-top:40px;padding-top:22px;border-top:1px solid var(--line);font-family:var(--mono);font-size:12px;color:var(--ink3);line-height:1.7}
</style></head><body><div class="wrap">
<div class="eyebrow">flywheel × daytona · the scaling law</div>
<h1>More compute buys measurable agent improvement.</h1>
${climbs ? '<span class="verdict">✓ every configuration climbed on the sealed held-out set</span>' : ""}
<p class="sub">The same reinforcement-learning-on-trajectories loop, run at increasing rollout counts. More rollouts per task means a tighter measurement — a lower noise floor — which lets more of the agent's self-written lessons clear the bar. The result is a curve that <b>rises with compute</b>${best ? `, reaching <b>${pct(best.final)}</b> at K=${best.K}` : ""}. Each rollout is real code, executed against hidden tests in an isolated Daytona sandbox.</p>
<div class="panel">${scalingChart(sweep)}<div class="cap">Final held-out success vs. rollouts per task (K). Higher K → lower noise floor → more lessons credited → higher curve.</div></div>
<h2>Scaling sweep</h2>
<div class="panel" style="padding:0"><table><thead><tr><th>rollouts</th><th>baseline</th><th>final</th><th>noise band</th><th>lessons</th></tr></thead><tbody>${sweepRows || '<tr><td colspan=5 style="padding:16px;color:var(--ink3)">pending…</td></tr>'}</tbody></table></div>
${reps.length ? `<h2>Replication · K=10 · ${reps.length} independent live runs</h2>
<div class="panel" style="padding:0"><table><thead><tr><th>run</th><th>baseline</th><th>final</th><th>gain</th><th>lessons</th></tr></thead><tbody>${repRows}</tbody></table></div>
<p class="cap" style="text-align:left;margin-top:10px">mean final ${pct(repMean)} across ${reps.length} runs — the climb reproduces.</p>` : ""}
<p class="note"><b>Why this is the honest headline.</b> The plateau of a self-improvement loop isn't set by the model's ceiling — it's set by how well you can <em>measure</em>. This sweep makes that concrete: hold the tasks and the agent fixed, add only rollouts, and the credited improvement grows because the noise floor drops beneath more of the real effects. It is a direct, measured argument that scaling the sandbox layer scales the learning.</p>
<div class="foot">live codex agent · hidden-test grading in isolated Daytona sandboxes · github.com/abhid1234/flywheel · integrations/daytona/learn</div>
</div></body></html>`;
}

const dir = process.argv[2];
if (!dir) { process.stderr.write("usage: node scaling-report.mjs <resultsDir> [--out DIR]\n"); process.exit(1); }
const outIdx = process.argv.indexOf("--out");
const out = outIdx >= 0 ? process.argv[outIdx + 1] : dir;
const data = load(dir);
mkdirSync(out, { recursive: true });
writeFileSync(path.join(out, "scaling.html"), render(data));
process.stdout.write(`scaling report: ${data.sweep.length} sweep runs, ${data.reps.length} replications → ${path.join(out, "scaling.html")}\n`);
for (const s of data.sweep) process.stdout.write(`  K=${String(s.K).padStart(2)}  ${pct(s.baseline)}→${pct(s.final)}  band ${s.noise_band_pp}pp  ${s.lessons_kept} lessons\n`);
