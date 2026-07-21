import { signatureParts } from "../cluster/key.js";
import { isProposable } from "../cluster/rank.js";
import { buildTrend } from "./trend.js";

const TIERS = ["gold", "strong", "weak", "unknown"];
const CAVEATS = [
  "labels are transcript-derived proxies (strong/weak), not adjudicated gold",
  "the failure-rate counts weak proxy signals; the 'by error class' chart shows only WITNESSED failures (episodes with a recorded failing command)",
  "witness replay validates environmental fixes; behavioural fixes need the (blocked) statistical arm",
  "failure counts exclude benign non-zero exits and non-agent-faults (user rejections, missing tools)",
];
const object = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : 0;
const text = (value, fallback = "") => typeof value === "string" ? value : fallback;
const ratio = (part, whole) => whole > 0 ? part / whole : 0;

function redactString(value) {
  return value
    .replace(/\$HOME\b/gi, "<HOME>")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "<EMAIL>")
    .replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|hf_[A-Za-z0-9_-]{8,})\b/g, "<SECRET>")
    .replace(/\b(?=[A-Fa-f0-9]{32,}\b)(?=[A-Fa-f0-9]*[A-Fa-f])(?=[A-Fa-f0-9]*\d)[A-Fa-f0-9]+\b/g, "<SECRET>")
    .replace(/\b(?=[A-Za-z0-9+/]{40,}={0,2}\b)(?=[A-Za-z0-9+/]*[A-Z])(?=[A-Za-z0-9+/]*[a-z])(?=[A-Za-z0-9+/]*\d)[A-Za-z0-9+/]+={0,2}\b/g, "<SECRET>")
    .replace(/(?:^|(?<=\s|["'=(]))\/(?:[^\s"'`,;:)]+\/?)+/g, "<PATH>");
}

function truncate(value, limit = 240) {
  const safe = redactString(text(value).replace(/\s+/g, " ").trim());
  return safe.length <= limit ? safe : `${safe.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function requestText(episode) {
  return typeof episode?.request === "string" ? episode.request : text(episode?.request?.text);
}

function errorText(episode) {
  const direct = episode?.failure?.errorText ?? episode?.failure?.error_text;
  if (typeof direct === "string") return direct;
  const failed = (Array.isArray(episode?.steps) ? episode.steps : []).filter((step) => step?.ok === false).at(-1);
  return text(failed?.errorText ?? failed?.error_text ?? episode?.outcome?.reason);
}

function failureParts(episode) {
  const signature = text(episode?.failure?.signature);
  const parts = signatureParts(signature);
  return {
    tool: text(parts?.tool, text(episode?.failure?.tool, "unknown")) || "unknown",
    errorClass: text(episode?.failure?.mode, text(parts?.errorClass, "unknown")) || "unknown",
  };
}

function countRows(map, total, key, countKey = "count") {
  return [...map].map(([name, count]) => ({ [key]: name, [countKey]: count, pct: ratio(count, total) }))
    .sort((a, b) => b[countKey] - a[countKey] || String(a[key]).localeCompare(String(b[key])));
}

export function buildAtlas(episodes, clusters, opts = {}) {
  try {
    const source = Array.isArray(episodes) ? episodes.filter(object) : [];
    const modes = Array.isArray(clusters) ? clusters.filter(object) : [];
    const labels = { fail: 0, pass: 0, unknown: 0 };
    const tierBreakdown = { gold: 0, strong: 0, weak: 0, unknown: 0 };
    const projects = new Set();
    const sessions = new Set();
    const classes = new Map();
    const tools = new Map();
    const projectRows = new Map();
    const days = new Map();
    let replayableWitnesses = 0;
    let witnessedFailures = 0;
    let weakSignalFailures = 0;
    const weakSignals = { api_error: 0, interrupted: 0, stuck_retry: 0, other: 0 };

    for (const episode of source) {
      const label = episode?.outcome?.label === "fail" || episode?.outcome?.label === "pass" ? episode.outcome.label : "unknown";
      const tier = TIERS.includes(episode?.outcome?.tier) ? episode.outcome.tier : "unknown";
      labels[label] += 1;
      tierBreakdown[tier] += 1;
      const project = text(episode?.project, "unknown") || "unknown";
      const session = text(episode?.session_id, "unknown") || "unknown";
      projects.add(project);
      sessions.add(session);
      if (!projectRows.has(project)) projectRows.set(project, { episodes: 0, failures: 0 });
      const projectRow = projectRows.get(project);
      projectRow.episodes += 1;
      if (label === "fail") projectRow.failures += 1;
      const parsed = Date.parse(text(episode?.started));
      if (Number.isFinite(parsed)) {
        const date = new Date(parsed).toISOString().slice(0, 10);
        if (!days.has(date)) days.set(date, { episodes: 0, failures: 0 });
        days.get(date).episodes += 1;
        if (label === "fail") days.get(date).failures += 1;
      }
      if (object(episode?.failure)) {
        witnessedFailures += 1;
        if (episode.failure?.witness?.replayable === true) replayableWitnesses += 1;
        const parts = failureParts(episode);
        classes.set(parts.errorClass, (classes.get(parts.errorClass) ?? 0) + 1);
        tools.set(parts.tool, (tools.get(parts.tool) ?? 0) + 1);
      } else if (label === "fail") {
        weakSignalFailures += 1;
        const signals = object(episode?.signals) ? episode.signals : {};
        if (Number(signals.api_errors) > 0) weakSignals.api_error += 1;
        else if (signals.interrupted === true) weakSignals.interrupted += 1;
        else if (Number(signals.repeat_command_max) >= 3) weakSignals.stuck_retry += 1;
        else weakSignals.other += 1;
      }
    }

    const byId = new Map(source.map((episode) => [text(episode?.id), episode]));
    const ranked = [...modes].sort((a, b) => finite(b?.priority) - finite(a?.priority)
      || finite(b?.size) - finite(a?.size)
      || text(a?.signature).localeCompare(text(b?.signature))
      || text(a?.id).localeCompare(text(b?.id)));
    const exemplarLimit = opts?.exemplarsPerCluster === undefined ? 2 : Math.max(0, Math.floor(finite(opts.exemplarsPerCluster)));
    const topClusters = ranked.slice(0, 15).map((cluster) => {
      const members = Array.isArray(cluster?.members) ? cluster.members : [];
      const relevant = members.map((id) => byId.get(text(id))).filter(Boolean);
      const witnesses = Array.isArray(cluster?.witnesses) ? cluster.witnesses.filter((item) => item?.replayable === true).length : 0;
      const goldStrong = finite(cluster?.tierCounts?.gold) + finite(cluster?.tierCounts?.strong);
      return {
        signature: text(cluster?.signature), size: Math.max(0, finite(cluster?.size)),
        errorClass: text(cluster?.errorClass, "unknown") || "unknown", goldStrong, witnesses,
        proposable: isProposable(cluster), mode: text(cluster?.mode, text(cluster?.errorClass, "unknown")) || "unknown",
        exemplars: relevant.slice(0, exemplarLimit).map((episode) => ({ request: truncate(requestText(episode)), error: truncate(errorText(episode)) })),
      };
    });
    const labeled = labels.fail + labels.pass;
    const historyProvided = Array.isArray(opts?.historyRows);
    const trend = historyProvided ? buildTrend(opts.historyRows, opts?.trend) : undefined;
    return {
      generatedAtNote: "(stamped by CLI)",
      totals: { episodes: source.length, failures: witnessedFailures + weakSignalFailures, witnessedFailures, weakSignalFailures, passes: labels.pass, unknown: labels.unknown, replayableWitnesses, projects: projects.size, sessions: sessions.size },
      tierBreakdown,
      failureRate: ratio(labels.fail, labeled),
      byErrorClass: countRows(classes, witnessedFailures, "errorClass"),
      byTool: countRows(tools, witnessedFailures, "tool", "failures"),
      weakSignalBreakdown: Object.entries(weakSignals).filter(([signal, count]) => signal !== "other" || count > 0)
        .map(([signal, count]) => ({ signal, count })),
      topClusters,
      byProject: [...projectRows].map(([project, value]) => ({ project, ...value, rate: ratio(value.failures, value.episodes) }))
        .sort((a, b) => b.failures - a.failures || b.episodes - a.episodes || a.project.localeCompare(b.project)),
      timeline: [...days].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, ...value })),
      honesty: { goldLabels: tierBreakdown.gold, statisticalArmBlocked: true, caveats: [...CAVEATS] },
      ...(historyProvided && trend.points.length ? { trend } : {}),
    };
  } catch {
    return buildAtlas([], [], {});
  }
}

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const percent = (value) => `${(Math.max(0, finite(value)) * 100).toFixed(1)}%`;

export function renderAtlasHtml(atlas) {
  try {
    const data = object(atlas) ? atlas : buildAtlas([], [], {});
    const totals = object(data.totals) ? data.totals : {};
    const clusters = Array.isArray(data.topClusters) ? data.topClusters : [];
    const caveats = Array.isArray(data?.honesty?.caveats) ? data.honesty.caveats : CAVEATS;
    const proposable = clusters.filter((cluster) => cluster?.proposable === true).length;
    const weakSignals = Array.isArray(data.weakSignalBreakdown) ? data.weakSignalBreakdown : [];
    const weakSignalLine = weakSignals.map((item) => `${escapeHtml(item?.signal)}: ${finite(item?.count)}`).join(" · ");
    const rows = clusters.map((cluster) => `<tr><td><code>${escapeHtml(cluster?.signature)}</code></td><td>${finite(cluster?.size)}</td><td>${escapeHtml(cluster?.errorClass)}</td><td>${cluster?.proposable ? '<span class="badge">proposable</span>' : '<span class="muted">not yet</span>'}</td><td>${escapeHtml(cluster?.exemplars?.[0]?.request || cluster?.exemplars?.[0]?.error || "—")}</td></tr>`).join("");
    const errorBars = (Array.isArray(data.byErrorClass) ? data.byErrorClass : []).map((item) => `<li><div class="bar-label"><span>${escapeHtml(item?.errorClass)}</span><span>${finite(item?.count)} · ${percent(item?.pct)}</span></div><div class="track"><span style="width:${Math.min(100, Math.max(0, finite(item?.pct) * 100))}%"></span></div></li>`).join("") || '<li class="muted">No witnessed failures.</li>';
    const projects = (Array.isArray(data.byProject) ? data.byProject : []).map((item) => `<tr><td>${escapeHtml(item?.project)}</td><td>${finite(item?.episodes)}</td><td>${finite(item?.failures)}</td><td>${percent(item?.rate)}</td></tr>`).join("") || '<tr><td colspan="4" class="muted">No project data.</td></tr>';
    const timeline = (Array.isArray(data.timeline) ? data.timeline : []).map((item) => `<tr><td>${escapeHtml(item?.date)}</td><td>${finite(item?.episodes)}</td><td>${finite(item?.failures)}</td></tr>`).join("") || '<tr><td colspan="3" class="muted">No dated episodes.</td></tr>';
    const trend = object(data.trend) && Array.isArray(data.trend.points) ? data.trend : null;
    const trendMax = trend ? Math.max(0, ...trend.points.map((point) => finite(point?.newEpisodes))) : 0;
    const trendBars = trend?.points.map((point) => `<span class="trend-bar" title="${escapeHtml(point?.date)}: ${finite(point?.newEpisodes)} new episodes" style="height:${trendMax > 0 ? Math.max(4, finite(point?.newEpisodes) / trendMax * 100) : 4}%"></span>`).join("") ?? "";
    const trendSection = trend ? `<section><h2>Corpus over time</h2><p class="sparkline" aria-label="New episodes per day">${escapeHtml(trend.summary?.sparkline)}</p><p class="muted">${finite(trend.summary?.spanDays).toFixed(1)} days · +${finite(trend.summary?.netNewEpisodes)} net-new episodes</p><div class="trend-bars" aria-label="New episodes per day">${trendBars}</div></section>` : "";
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Failure Atlas</title>
<style>:root{--paper:#fbf8f2;--ink:#28251f;--muted:#746f66;--line:#ded7ca;--accent:#a54f32;--wash:#f1e8dc}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.5}main,footer{max-width:1080px;margin:auto;padding:64px 28px}header{margin-bottom:40px}h1{font-family:ui-serif,Georgia,serif;font-size:clamp(2.8rem,8vw,5.4rem);font-weight:500;letter-spacing:-.04em;line-height:1;margin:0 0 12px}h2{font-family:ui-serif,Georgia,serif;font-weight:500;font-size:1.8rem;margin:0 0 20px}p{margin:0}.eyebrow{color:var(--accent);font-size:.78rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase}.honesty{background:var(--wash);border-left:4px solid var(--accent);padding:24px 28px;margin:36px 0}.honesty ul{margin:10px 0 0;padding-left:20px}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin:36px 0 64px}.stat{border-top:1px solid var(--line);padding:18px 0}.stat strong{display:block;font-family:ui-serif,Georgia,serif;font-size:2.25rem;font-weight:500}.stat span,.muted{color:var(--muted)}section{margin:64px 0}.bars{list-style:none;padding:0;margin:0;max-width:760px}.bars li{margin:0 0 18px}.bar-label{display:flex;justify-content:space-between;gap:20px;margin-bottom:6px}.track{height:8px;background:var(--wash);overflow:hidden}.track span{display:block;height:100%;background:var(--accent)}.sparkline{font:1.7rem ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--accent);letter-spacing:.08em}.trend-bars{height:72px;display:flex;align-items:flex-end;gap:3px;margin-top:16px;border-bottom:1px solid var(--line)}.trend-bar{display:block;flex:1;max-width:28px;background:var(--accent);min-height:3px}table{width:100%;border-collapse:collapse;font-size:.9rem}th{text-align:left;color:var(--muted);font-weight:600}th,td{padding:12px 10px;border-bottom:1px solid var(--line);vertical-align:top}code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.82em;overflow-wrap:anywhere}.badge{display:inline-block;background:var(--accent);color:white;border-radius:99px;padding:2px 8px;font-size:.72rem}.breakdowns{display:grid;grid-template-columns:1fr 1fr;gap:42px}footer{padding-top:0;color:var(--muted);font-size:.88rem}@media(max-width:760px){main{padding-top:38px}.stats{grid-template-columns:1fr 1fr}.breakdowns{grid-template-columns:1fr}.table-wrap{overflow-x:auto}th,td{min-width:76px}}</style></head>
<body><main><header><p class="eyebrow">A transcript-derived field guide</p><h1>Failure Atlas</h1><p class="muted">${escapeHtml(data.generatedAtNote)}</p></header>
<aside class="honesty" aria-labelledby="honesty-title"><strong id="honesty-title">Read this atlas honestly</strong><ul>${caveats.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul></aside>
<div class="stats"><div class="stat"><strong>${finite(totals.episodes)}</strong><span>episodes</span></div><div class="stat"><strong>${percent(data.failureRate)}</strong><span>failure rate among labeled episodes</span></div><div class="stat"><strong>${finite(totals.witnessedFailures)}</strong><span>witnessed failures</span></div><div class="stat"><strong>${finite(totals.replayableWitnesses)}</strong><span>replayable witnesses</span></div><div class="stat"><strong>${proposable}</strong><span>proposable clusters</span></div></div>
${trendSection}
<section><h2>Failures by error class</h2><p class="muted">${finite(totals.weakSignalFailures)} weak-signal failures (not shown in chart) · ${weakSignalLine}</p><ul class="bars">${errorBars}</ul></section>
<section><h2>Top failure modes</h2><div class="table-wrap"><table><thead><tr><th>Signature</th><th>Size</th><th>Class</th><th>Status</th><th>One exemplar</th></tr></thead><tbody>${rows || '<tr><td colspan="5" class="muted">No clusters yet.</td></tr>'}</tbody></table></div></section>
<section class="breakdowns"><div><h2>By project</h2><table><thead><tr><th>Project</th><th>Episodes</th><th>Failures</th><th>Rate</th></tr></thead><tbody>${projects}</tbody></table></div><div><h2>By day</h2><table><thead><tr><th>Date</th><th>Episodes</th><th>Failures</th></tr></thead><tbody>${timeline}</tbody></table></div></section>
</main><footer>Generated by flywheel from the owner’s own transcripts · ${finite(totals.episodes)} episodes</footer></body></html>`;
  } catch {
    return renderAtlasHtml(buildAtlas([], [], {}));
  }
}
