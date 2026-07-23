// Renders a benchmark report object into a self-contained HTML results page,
// framed for a business reader: each row is a scenario an AI agent runs into,
// what went wrong, and whether the fix provably worked. Diagnostic-instrument
// visual language (brass on graphite). No dependencies, no external assets.

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const pct = (x) => `${Math.round(x * 100)}%`;

export function renderReport(report) {
  const cards = (report.results || []).map((r) => {
    const helped = r.verdict === "helped";
    const verdict = helped ? `<span class="v helped">✓ fix verified</span>`
      : r.verdict === "no_effect" ? `<span class="v none">no measurable change</span>`
      : `<span class="v inc">${esc(r.verdict)}</span>`;
    return `<article class="case">
      <div class="case-head">
        <div><div class="fn">${esc(r.fn || "")}</div><h3>${esc(r.title || r.task)}</h3></div>
        ${verdict}
      </div>
      <p class="scen">${esc(r.scenario || "")}</p>
      <div class="ba">
        <div class="col"><div class="lbl">Before</div><div class="wrong"><span class="x">✕</span> ${esc(r.wentWrong || "")}</div>
          <div class="meter"><span class="rail"><i class="fill red" style="width:${pct(r.before.failRate)}"></i></span><b class="mono">${pct(r.before.failRate)} failed</b></div></div>
        <div class="arrow">→</div>
        <div class="col"><div class="lbl">After the fix</div><div class="right"><span class="c">✓</span> ${esc(r.theFix || "")}</div>
          <div class="meter"><span class="rail"><i class="fill ${r.after.failRate === 0 ? "green" : "amber"}" style="width:${pct(Math.max(r.after.failRate, 0.02))}"></i></span><b class="mono">${pct(r.after.failRate)} failed</b></div></div>
      </div>
    </article>`;
  }).join("\n");

  const helped = report.tasks_helped ?? 0;
  const total = report.tasks_total ?? (report.results || []).length;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>flywheel × daytona — agent reliability benchmark</title>
<style>
:root{--paper:#e7ebef;--card:#f4f6f8;--card2:#eef1f4;--ink:#141d26;--ink2:#4a5765;--ink3:#7c8894;--line:#cdd5dd;--line2:#bcc6cf;--brass:#8a6417;--brass2:#a67c22;--red:#c23b2b;--green:#1f7a4d;--amber:#b5852a;--mono:ui-monospace,"SF Mono","JetBrains Mono",Menlo,monospace;--sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
@media(prefers-color-scheme:dark){:root{--paper:#0e141b;--card:#161f28;--card2:#1b2732;--ink:#e7edf2;--ink2:#9aa8b5;--ink3:#6a7783;--line:#26333f;--line2:#324150;--brass:#e0b452;--brass2:#eec66d;--red:#f0705e;--green:#54c088;--amber:#e0b452}}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.6 var(--sans);-webkit-font-smoothing:antialiased;background-image:radial-gradient(circle at 1px 1px,var(--line) 1px,transparent 0);background-size:26px 26px}
.wrap{max-width:1000px;margin:0 auto;padding:44px 22px 90px}
.eyebrow{font-family:var(--mono);font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink3);font-weight:600}
h1{font-size:clamp(28px,4.4vw,44px);letter-spacing:-.02em;margin:10px 0 8px;font-weight:800;text-wrap:balance}
.sub{color:var(--ink2);max-width:70ch;margin:0 0 28px;font-size:17px}
.sub b{color:var(--ink)}
.cards{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:0 0 30px}
@media(max-width:640px){.cards{grid-template-columns:repeat(2,1fr)}}
.stat{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:15px 16px}
.stat .n{font-size:27px;font-weight:800;letter-spacing:-.03em;font-variant-numeric:tabular-nums}
.stat .n .of{font-size:16px;color:var(--ink3)}
.stat .l{font-family:var(--mono);font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink3);margin-top:2px}
.grid{display:grid;gap:14px}
.case{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:20px 22px;box-shadow:0 1px 2px rgba(20,29,38,.04),0 6px 22px rgba(20,29,38,.05)}
.case-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px}
.fn{font-family:var(--mono);font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--brass);font-weight:700}
.case h3{margin:2px 0 0;font-size:19px;letter-spacing:-.01em}
.scen{color:var(--ink2);margin:8px 0 16px;font-size:15px}
.ba{display:grid;grid-template-columns:1fr auto 1fr;gap:16px;align-items:stretch}
@media(max-width:640px){.ba{grid-template-columns:1fr;gap:10px}.arrow{display:none}}
.col{background:var(--card2);border:1px solid var(--line);border-radius:10px;padding:13px 15px;display:flex;flex-direction:column;gap:8px}
.lbl{font-family:var(--mono);font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink3)}
.wrong,.right{font-size:14px;line-height:1.45;flex:1}
.wrong .x{color:var(--red);font-weight:700;margin-right:4px}
.right .c{color:var(--green);font-weight:700;margin-right:4px}
.arrow{align-self:center;color:var(--brass);font-size:22px;font-weight:700}
.meter{display:flex;align-items:center;gap:9px;margin-top:2px}
.rail{flex:1;height:16px;border-radius:5px;background:var(--paper);border:1px solid var(--line);overflow:hidden}
.fill{display:block;height:100%}.fill.red{background:color-mix(in srgb,var(--red) 80%,transparent)}.fill.green{background:color-mix(in srgb,var(--green) 80%,transparent)}.fill.amber{background:color-mix(in srgb,var(--amber) 80%,transparent)}
.meter b{font-size:12px;color:var(--ink2);font-variant-numeric:tabular-nums;white-space:nowrap}
.mono{font-family:var(--mono)}
.v{font-family:var(--mono);font-size:12px;font-weight:700;padding:5px 11px;border-radius:7px;white-space:nowrap;flex-shrink:0}
.v.helped{color:var(--green);border:1px solid color-mix(in srgb,var(--green) 40%,transparent);background:color-mix(in srgb,var(--green) 10%,transparent)}
.v.none{color:var(--ink2);border:1px solid var(--line2)}
.v.inc{color:var(--amber);border:1px solid color-mix(in srgb,var(--amber) 40%,transparent)}
.note{border-left:3px solid var(--brass);padding:10px 0 10px 16px;margin:30px 0 0;color:var(--ink2);font-size:15px;max-width:78ch;line-height:1.6}
.note b{color:var(--ink)}
.foot{margin-top:24px;font-family:var(--mono);font-size:12px;color:var(--ink3);line-height:1.7}
</style></head><body><div class="wrap">
<div class="eyebrow">flywheel × daytona · agent reliability benchmark</div>
<h1>When an AI agent keeps making the same mistake — can you prove the fix worked?</h1>
<p class="sub">Six business tasks an AI agent runs into. Each is run <b>${report.n_per_arm ?? 0} times broken and ${report.n_per_arm ?? 0} times fixed</b>, in isolated cloud sandboxes, so the improvement is measured — not guessed. A fix is only marked <b>verified</b> when the improvement is provably bigger than random run-to-run noise.</p>
<div class="cards">
  <div class="stat"><div class="n">${helped}<span class="of"> / ${total}</span></div><div class="l">fixes verified</div></div>
  <div class="stat"><div class="n">${report.gold_episodes ?? 0}</div><div class="l">outcomes recorded</div></div>
  <div class="stat"><div class="n">${report.sandboxes ?? 0}</div><div class="l">test runs</div></div>
  <div class="stat"><div class="n">${report.elapsed_s ?? 0}<span class="of">s</span></div><div class="l">total time</div></div>
</div>
<div class="grid">${cards}</div>
<p class="note"><b>Why this matters.</b> Teams deploying AI agents hit the same wall: an agent keeps making a mistake, someone tweaks a prompt or a setting, and everyone <i>hopes</i> it's better. This measures it. Each fix is run against the broken version hundreds of times, and the system refuses to say <b>verified</b> unless the improvement clearly beats the background noise. That's the honest bar most "our agent got smarter" claims never clear.</p>
<div class="foot">
  backend ${esc(report.backend || "—")} · ${report.sandboxes ?? 0} isolated sandboxes · ${report.elapsed_s ?? 0}s · ${report.gold_episodes ?? 0} outcomes recorded at decision time<br>
  github.com/abhid1234/flywheel · integrations/daytona
</div>
</div></body></html>`;
}
