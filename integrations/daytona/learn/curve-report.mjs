// Renders the RL-on-trajectories experiment as a self-contained HTML page: the
// held-out learning curve with 95% CI bands, accepted vs. rejected rounds, and an
// honest plateau. Diagnostic-instrument visual language (brass on graphite).

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function chart(curve) {
  const W = 820, H = 340, padL = 52, padR = 60, padT = 22, padB = 46, iw = W - padL - padR, ih = H - padT - padB;
  const n = curve.length;
  const x = (i) => padL + (n === 1 ? iw / 2 : (i / (n - 1)) * iw);
  const y = (v) => padT + ih - v * ih;
  const pts = curve.map((c, i) => [x(i), y(c.mean)]);
  const line = pts.map((p, i) => `${i ? "L" : "M"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  // CI band as a filled envelope
  const top = curve.map((c, i) => `${x(i).toFixed(1)},${y(c.hi).toFixed(1)}`);
  const bot = curve.map((c, i) => `${x(i).toFixed(1)},${y(c.lo).toFixed(1)}`).reverse();
  const bandPath = `M${top.join(" L")} L${bot.join(" L")} Z`;
  const grid = [0, 0.25, 0.5, 0.75, 1].map((v) =>
    `<line x1="${padL}" y1="${y(v).toFixed(1)}" x2="${W - padR}" y2="${y(v).toFixed(1)}" class="g"/>` +
    `<text x="${padL - 9}" y="${(y(v) + 4).toFixed(1)}" class="yt">${v * 100}%</text>`).join("");
  const dots = pts.map((p, i) => {
    const c = curve[i];
    const cls = c.status === "rejected" ? "dr" : "d";
    const label = c.status === "rejected" ? "" : `<text x="${p[0].toFixed(1)}" y="${(p[1] - 12).toFixed(1)}" class="val">${Math.round(c.mean * 100)}%</text>`;
    const rej = c.status === "rejected" ? `<text x="${p[0].toFixed(1)}" y="${(p[1] + 20).toFixed(1)}" class="rej">rejected</text>` : "";
    return `<circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="4.5" class="${cls}"/>${label}${rej}`;
  }).join("");
  const xlabels = curve.map((c, i) => `<text x="${x(i).toFixed(1)}" y="${H - padB + 22}" class="xt">R${c.round}</text>`).join("");
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Held-out success over rounds with CI bands; some lessons rejected; plateau">
    ${grid}
    <path d="${bandPath}" class="band"/>
    <path d="${line}" class="cl"/>
    ${dots}${xlabels}
    <text x="${padL}" y="${H - 6}" class="axis">learning round →   (shaded = 95% CI)</text>
  </svg>`;
}

export function renderCurve(report) {
  const lessons = (report.lessons || []).map((l) => {
    const kept = l.status === "learned";
    return `<li class="${kept ? "" : "rj"}"><span class="rnd">R${l.round}</span><span class="lesson">${esc(l.lesson)}</span>` +
      `<span class="ev ${kept ? "ok" : "no"}">${kept ? `+${(l.gain * 100).toFixed(1)}pp · kept` : `+${(l.gain * 100).toFixed(1)}pp · under noise, rejected`}</span></li>`;
  }).join("\n");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>flywheel — RL on agent trajectories</title>
<style>
:root{--paper:#e7ebef;--card:#f4f6f8;--card2:#eef1f4;--ink:#141d26;--ink2:#4a5765;--ink3:#7c8894;--line:#cdd5dd;--line2:#bcc6cf;--brass:#8a6417;--green:#1f7a4d;--red:#c23b2b;--mono:ui-monospace,"SF Mono","JetBrains Mono",Menlo,monospace;--sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
@media(prefers-color-scheme:dark){:root{--paper:#0e141b;--card:#161f28;--card2:#1b2732;--ink:#e7edf2;--ink2:#9aa8b5;--ink3:#6a7783;--line:#26333f;--line2:#324150;--brass:#e0b452;--green:#54c088;--red:#f0705e}}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.6 var(--sans);-webkit-font-smoothing:antialiased;background-image:radial-gradient(circle at 1px 1px,var(--line) 1px,transparent 0);background-size:26px 26px}
.wrap{max-width:900px;margin:0 auto;padding:44px 22px 90px}
.eyebrow{font-family:var(--mono);font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink3);font-weight:600}
h1{font-size:clamp(26px,3.8vw,40px);letter-spacing:-.02em;margin:10px 0 8px;font-weight:800;text-wrap:balance}
.sub{color:var(--ink2);max-width:72ch;margin:0 0 22px;font-size:16px}.sub b{color:var(--ink)}
.sim{display:inline-block;font-family:var(--mono);font-size:11.5px;color:var(--brass);border:1px solid color-mix(in srgb,var(--brass) 40%,transparent);border-radius:6px;padding:3px 9px;margin-bottom:18px}
.headline{display:flex;gap:20px;align-items:baseline;flex-wrap:wrap;margin:0 0 18px}
.big{font-size:38px;font-weight:800;letter-spacing:-.03em;font-variant-numeric:tabular-nums}.big .arrow{color:var(--ink3);font-weight:400;margin:0 8px}.big .up{color:var(--green)}.big .gain{font-size:18px;color:var(--green);font-weight:700;margin-left:6px}
.panel{border:1px solid var(--line);border-radius:14px;background:var(--card);box-shadow:0 1px 2px rgba(20,29,38,.04),0 8px 30px rgba(20,29,38,.06);padding:22px}
svg{width:100%;height:auto;display:block}.g{stroke:var(--line);stroke-width:1}.yt,.xt{fill:var(--ink3);font-family:var(--mono);font-size:11px;text-anchor:middle}.yt{text-anchor:end}
.axis{fill:var(--ink3);font-family:var(--mono);font-size:11px}
.band{fill:var(--brass);opacity:.14}
.cl{fill:none;stroke:var(--brass);stroke-width:2.5;stroke-linejoin:round;stroke-linecap:round}
.d{fill:var(--brass);stroke:var(--card);stroke-width:2}.dr{fill:var(--card);stroke:var(--ink3);stroke-width:2}
.val{fill:var(--ink);font-family:var(--mono);font-size:11.5px;font-weight:700;text-anchor:middle}
.rej{fill:var(--ink3);font-family:var(--mono);font-size:10px;text-anchor:middle}
h2{font-size:16px;margin:32px 0 12px;letter-spacing:-.01em}
ol.lessons{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
ol.lessons li{display:flex;align-items:center;gap:14px;background:var(--card);border:1px solid var(--line);border-left:3px solid var(--brass);border-radius:10px;padding:11px 15px}
ol.lessons li.rj{border-left-color:var(--ink3);opacity:.72}
.rnd{font-family:var(--mono);font-weight:700;font-size:12px;color:var(--brass);flex-shrink:0;width:26px}
ol.lessons li.rj .rnd{color:var(--ink3)}
.lesson{flex:1;font-size:14.5px;color:var(--ink)}
.ev{font-family:var(--mono);font-size:11.5px;flex-shrink:0}.ev.ok{color:var(--green)}.ev.no{color:var(--ink3)}
.note{border-left:3px solid var(--brass);padding:10px 0 10px 16px;margin:28px 0 0;color:var(--ink2);font-size:14.5px;max-width:80ch;line-height:1.6}.note b{color:var(--ink)}
.foot{margin-top:22px;font-family:var(--mono);font-size:12px;color:var(--ink3);line-height:1.7}
</style></head><body><div class="wrap">
<div class="eyebrow">flywheel · reinforcement learning on agent trajectories</div>
<h1>An agent improving from its own graded runs — RL, at the context layer.</h1>
<span class="sim">◑ simulated agent · faithful model · real Daytona+LLM run gated</span>
<p class="sub">Same loop as reinforcement learning: the agent attempts tasks (rollouts), earns a <b>verifiable reward</b> from hidden tests, and its policy improves from its own trajectories. The one difference from textbook RL — the update is a <b>durable lesson carried in context, not a weight change</b>. Measured on a sealed held-out set, with a 95% CI on every point.</p>
<div class="headline"><div class="big"><span>${Math.round(report.baseline * 100)}%</span><span class="arrow">→</span><span class="up">${Math.round(report.final * 100)}%</span><span class="gain">+${report.gain_pp}pp</span></div>
<div style="font-family:var(--mono);font-size:13px;color:var(--ink3)">${report.lessons_kept} lessons kept · ${report.holdout} held-out tasks · ${report.repeats} rollouts each</div></div>
<div class="panel">${chart(report.curve)}</div>
<h2>What the agent tried, round by round</h2>
<ol class="lessons">${lessons}</ol>
<p class="note"><b>Why this isn't a hockey-stick.</b> The gains are front-loaded — the first lesson fixes the commonest failure, each next one is rarer and worth less (diminishing returns). Two lessons were <b>rejected</b>: their held-out gain fell under the ${report.noise_band_pp}pp noise band, so they weren't credited — you can't keep an improvement you can't distinguish from noise. That's why the curve <b>plateaus below 100%</b>, not because the agent is perfect. To push the plateau higher you lower the noise floor — more held-out tasks and more rollouts, i.e. <b>more Daytona</b>. <b>This run simulates the mechanism;</b> the real experiment rolls out a live agent in Daytona sandboxes and grades its code against hidden tests.</p>
<div class="foot">${report.holdout} sealed held-out tasks · ${report.repeats} rollouts/task/round · noise band ${report.noise_band_pp}pp · seed ${report.seed}<br>github.com/abhid1234/flywheel · integrations/daytona/learn</div>
</div></body></html>`;
}
