import { bootstrapDiff, noiseBand } from "./stats.js";

function finite(value) { return typeof value === "number" && Number.isFinite(value); }
function average(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0; }

export function analyzeAA(runs) {
  try {
    const cleanRuns = (Array.isArray(runs) ? runs : []).map((run) =>
      (Array.isArray(run) ? run : []).filter(finite)).filter((run) => run.length > 0);
    if (cleanRuns.length === 0) return { mean: 0, sd: 0, halfwidthPct: Infinity, aaClean: false, kc2Pass: false, reason: "no valid runs" };
    const rates = cleanRuns.map(average);
    const noise = noiseBand(rates);
    const deltas = [];
    for (let index = 1; index < rates.length; index += 1) deltas.push(rates[index] - rates[index - 1]);
    if (deltas.length === 0) deltas.push(0);
    const ci = bootstrapDiff(deltas);
    const aaClean = ci.lo <= 0 && ci.hi >= 0;
    const halfwidthPct = noise.sd === 0 ? 0 : noise.band95 * 100;
    const kc2Pass = halfwidthPct <= 10;
    const reason = !aaClean ? "paired A/A CI excludes zero" : (!kc2Pass ? "KC-2 failed: CI half-width exceeds 10%" : "calibration clean");
    return { mean: noise.mean, sd: noise.sd, halfwidthPct, aaClean, kc2Pass, reason };
  } catch {
    return { mean: 0, sd: 0, halfwidthPct: Infinity, aaClean: false, kc2Pass: false, reason: "invalid runs" };
  }
}

export function summarizeStability(perWitness) {
  const entries = Array.isArray(perWitness) ? perWitness : [];
  const witnesses = entries.length;
  const stable = entries.filter((entry) => entry?.stable === true).length;
  const unstable = witnesses - stable;
  return { witnesses, stable, unstable, cleanPct: witnesses ? (stable / witnesses) * 100 : 0 };
}
