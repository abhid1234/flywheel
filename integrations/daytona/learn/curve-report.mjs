// Renders the learning-curve experiment into a self-contained HTML page with an
// SVG chart of held-out success climbing over rounds, plus the lesson learned at
// each step. Diagnostic-instrument visual language (brass on graphite).

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function chart(curve) {
  const W = 760, H = 320, padL = 52, padR = 24, padT = 24, padB = 44;
  const iw = W - padL - padR, ih = H - padT - padB;
  const n = curve.length;
  const x = (i) => padL + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v) => padT + ih - v * ih; // v in [0,1]
  const pts = curve.map((c, i) => [x(i), y(c.holdout)]);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const area = `${line} L${pts.at(-1)[0].toFixed(1)},${y(0).toFixed(1)} L${pts[0][0].toFixed(1)},${y(0).toFixed(1)} Z`;
  const grid = [0, 0.25, 0.5, 0.75, 1].map((v) =>
    `<line x1="${padL}" y1="${y(v).toFixed(1)}" x2="${W - padR}" y2="${y(v).toFixed(1)}" class="grid"/>` +
    `<text x="${padL - 10}" y="${(y(v) + 4).toFixed(1)}" class="ytick">${v * 100}%</text>`).join("");
  const xlabels = curve.map((c, i) => `<text x="${x(i).toFixed(1)}" y="${H - padB + 22}" class="xtick">R${c.round}</text>`).join("");
  const dots = pts.map((p, i) => `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="4.5" class="dot"/>` +
    `<text x="${p[0].toFixed(1)}" y="${(p[1] - 12).toFixed(1)}" class="val">${Math.round(curve[i].holdout * 100)}%</text>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Held-out success rate climbing over learning rounds">
    <defs><linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="var(--brass)" stop-opacity="0.28"/><stop offset="1" stop-color="var(--brass)" stop-opacity="0"/>
    </linearGradient></defs>
    ${grid}
    <path d="${area}" fill="url(#fill)"/>
    <path d="${line}" class="curveline"/>
    ${dots}${xlabels}
    <text x="${padL}" y="${H - 6}" class="axis">learning round →</text>
  </svg>`;
}

export function renderCurve(report) {
  const lessons = (report.lessons || []).map((l) =>
    `<li><span class="rnd">R${l.round}</span><span class="lesson">${esc(l.lesson)}</span><span class="ev">${Math.round(l.holdout * 100)}% held-out</span></li>`).join("\n");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>flywheel — the learning curve</title>
<style>
:root{--paper:#e7ebef;--card:#f4f6f8;--card2:#eef1f4;--ink:#141d26;--ink2:#4a5765;--ink3:#7c8894;--line:#cdd5dd;--line2:#bcc6cf;--brass:#8a6417;--green:#1f7a4d;--mono:ui-monospace,"SF Mono","JetBrains Mono",Menlo,monospace;--sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
@media(prefers-color-scheme:dark){:root{--paper:#0e141b;--card:#161f28;--card2:#1b2732;--ink:#e7edf2;--ink2:#9aa8b5;--ink3:#6a7783;--line:#26333f;--line2:#324150;--brass:#e0b452;--green:#54c088}}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.6 var(--sans);-webkit-font-smoothing:antialiased;background-image:radial-gradient(circle at 1px 1px,var(--line) 1px,transparent 0);background-size:26px 26px}
.wrap{max-width:900px;margin:0 auto;padding:44px 22px 90px}
.eyebrow{font-family:var(--mono);font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink3);font-weight:600}
h1{font-size:clamp(28px,4.2vw,42px);letter-spacing:-.02em;margin:10px 0 8px;font-weight:800;text-wrap:balance}
.sub{color:var(--ink2);max-width:70ch;margin:0 0 26px;font-size:17px}.sub b{color:var(--ink)}
.sim{display:inline-block;font-family:var(--mono);font-size:11.5px;color:var(--brass);border:1px solid color-mix(in srgb,var(--brass) 40%,transparent);border-radius:6px;padding:3px 9px;margin-bottom:18px}
.headline{display:flex;gap:26px;align-items:baseline;flex-wrap:wrap;margin:0 0 20px}
.big{font-size:44px;font-weight:800;letter-spacing:-.03em;font-variant-numeric:tabular-nums}
.big .arrow{color:var(--ink3);font-weight:400;margin:0 8px}.big .up{color:var(--green)}
.big .gain{font-size:20px;color:var(--green);font-weight:700;margin-left:6px}
.panel{border:1px solid var(--line);border-radius:14px;background:var(--card);box-shadow:0 1px 2px rgba(20,29,38,.04),0 8px 30px rgba(20,29,38,.06);padding:22px}
.chart{width:100%;height:auto;display:block}
.grid{stroke:var(--line);stroke-width:1}
.ytick,.xtick{fill:var(--ink3);font-family:var(--mono);font-size:11px;text-anchor:middle}.ytick{text-anchor:end}
.axis{fill:var(--ink3);font-family:var(--mono);font-size:11px}
.curveline{fill:none;stroke:var(--brass);stroke-width:2.5;stroke-linejoin:round;stroke-linecap:round}
.dot{fill:var(--brass);stroke:var(--card);stroke-width:2}
.val{fill:var(--ink);font-family:var(--mono);font-size:11.5px;font-weight:700;text-anchor:middle}
h2{font-size:16px;margin:34px 0 12px;letter-spacing:-.01em}
ol.lessons{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
ol.lessons li{display:flex;align-items:center;gap:14px;background:var(--card);border:1px solid var(--line);border-left:3px solid var(--brass);border-radius:10px;padding:11px 15px}
.rnd{font-family:var(--mono);font-weight:700;font-size:12px;color:var(--brass);flex-shrink:0;width:28px}
.lesson{flex:1;font-size:14.5px;color:var(--ink)}
.ev{font-family:var(--mono);font-size:12px;color:var(--green);flex-shrink:0}
.note{border-left:3px solid var(--brass);padding:10px 0 10px 16px;margin:30px 0 0;color:var(--ink2);font-size:15px;max-width:78ch;line-height:1.6}.note b{color:var(--ink)}
.foot{margin-top:24px;font-family:var(--mono);font-size:12px;color:var(--ink3);line-height:1.7}
</style></head><body><div class="wrap">
<div class="eyebrow">flywheel · continual learning</div>
<h1>An agent that gets better at its job — by learning from its own mistakes.</h1>
<span class="sim">◑ simulated agent · mechanism demonstration · real-LLM run pending</span>
<p class="sub">No human wrote the fixes. Each round, the system finds what the agent keeps getting wrong, distills a <b>durable lesson</b>, and adds it to the agent's standing instructions. Success is measured on a <b>sealed held-out set the agent never learns from</b> — so the climb is real generalization, not memorization.</p>
<div class="headline">
  <div class="big"><span>${Math.round(report.baseline * 100)}%</span><span class="arrow">→</span><span class="up">${Math.round(report.final * 100)}%</span><span class="gain">+${report.gain_pp}pp</span></div>
</div>
<div class="panel">${chart(report.curve)}</div>
<h2>What the agent learned, round by round</h2>
<ol class="lessons">${lessons}</ol>
<p class="note"><b>This is the flywheel.</b> The loop closes on its own: work → failures → clustered patterns → a proposed lesson → a better agent → repeat. The improvement <i>compounds</i> — each lesson stacks on the last. The honest guardrails hold: the held-out set is sealed, the lesson-writer never sees the test, and only held-out gains count. <b>This run uses a simulated agent to demonstrate the mechanism and the measurement;</b> the real experiment swaps in live coding agents whose code is executed and graded inside Daytona sandboxes.</p>
<div class="foot">${report.problems} problems (${report.train} train / ${report.holdout} sealed held-out) · ${report.rounds} rounds · seed ${report.seed}<br>github.com/abhid1234/flywheel · integrations/daytona/learn</div>
</div></body></html>`;
}
