function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function mean(values) {
  if (values.length === 0) return 0;
  let total = 0;
  for (const value of values) total += value;
  return total / values.length;
}

export function wilson(successes, n, z = 1.96) {
  if (!finiteNumber(n) || n <= 0 || !finiteNumber(successes) ||
      !finiteNumber(z) || z < 0) {
    return { point: 0, lo: 0, hi: 1 };
  }

  // Keep the result a probability interval even for malformed count inputs.
  const boundedSuccesses = Math.min(n, Math.max(0, successes));
  const point = boundedSuccesses / n;
  const z2 = z * z;
  const denominator = 1 + z2 / n;
  const center = (point + z2 / (2 * n)) / denominator;
  const half = (z / denominator) * Math.sqrt(
    point * (1 - point) / n + z2 / (4 * n * n),
  );

  return {
    point,
    lo: Math.max(0, center - half),
    hi: Math.min(1, center + half),
  };
}

// Abramowitz and Stegun 7.1.26. Writing the negative branch in terms of the
// positive branch also makes normCdf(-x) exactly 1 - normCdf(x).
export function normCdf(x) {
  if (typeof x !== "number" || Number.isNaN(x)) return 0.5;
  if (x === Infinity) return 1;
  if (x === -Infinity) return 0;
  if (x === 0) return 0.5;
  if (x < 0) return 1 - normCdf(-x);

  const scaled = x / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * scaled);
  const polynomial = (((((1.061405429 * t - 1.453152027) * t)
    + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t;
  const erf = 1 - polynomial * Math.exp(-scaled * scaled);
  return 0.5 * (1 + erf);
}

export function twoProportion(aSucc, aN, bSucc, bN) {
  if (![aSucc, aN, bSucc, bN].every(finiteNumber) || aN <= 0 || bN <= 0) {
    return { diff: 0, se: Infinity, z: 0, p: 1 };
  }

  const a = Math.min(aN, Math.max(0, aSucc));
  const b = Math.min(bN, Math.max(0, bSucc));
  const pA = a / aN;
  const pB = b / bN;
  const diff = pB - pA;
  const pooled = (a + b) / (aN + bN);
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / aN + 1 / bN));

  if (se === 0) return { diff, se: 0, z: 0, p: 1 };
  const z = diff / se;
  const p = Math.min(1, 2 * (1 - normCdf(Math.abs(z))));
  return { diff, se, z, p };
}

export function makeRng(seed) {
  let state = finiteNumber(seed) ? Math.trunc(seed) >>> 0 : 0;
  return function rng() {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function percentile(sorted, probability) {
  if (sorted.length === 1) return sorted[0];
  const position = probability * (sorted.length - 1);
  const lower = Math.floor(position);
  const fraction = position - lower;
  return sorted[lower] + fraction * (sorted[Math.ceil(position)] - sorted[lower]);
}

export function bootstrapDiff(deltas, options = {}) {
  if (!Array.isArray(deltas) || deltas.length === 0) {
    return { point: 0, lo: 0, hi: 0, iters: 0 };
  }
  const values = deltas.filter(finiteNumber);
  if (values.length === 0) return { point: 0, lo: 0, hi: 0, iters: 0 };

  const safeOptions = options && typeof options === "object" ? options : {};
  const requestedIters = safeOptions.iters ?? 10000;
  const iters = finiteNumber(requestedIters) && requestedIters > 0
    ? Math.floor(requestedIters)
    : 0;
  const alpha = finiteNumber(safeOptions.alpha) && safeOptions.alpha > 0 && safeOptions.alpha < 1
    ? safeOptions.alpha
    : 0.05;
  const point = mean(values);
  if (iters === 0) return { point, lo: point, hi: point, iters: 0 };

  const rng = makeRng(safeOptions.seed ?? 42);
  const samples = new Array(iters);
  for (let iteration = 0; iteration < iters; iteration += 1) {
    let total = 0;
    for (let draw = 0; draw < values.length; draw += 1) {
      total += values[Math.floor(rng() * values.length)];
    }
    samples[iteration] = total / values.length;
  }
  samples.sort((a, b) => a - b);

  return {
    point,
    lo: percentile(samples, alpha / 2),
    hi: percentile(samples, 1 - alpha / 2),
    iters,
  };
}

export function noiseBand(runs) {
  const values = Array.isArray(runs) ? runs.filter(finiteNumber) : [];
  const average = mean(values);
  if (values.length < 2) return { mean: average, sd: 0, band95: Infinity };

  let squaredDeviations = 0;
  for (const value of values) squaredDeviations += (value - average) ** 2;
  const sd = Math.sqrt(squaredDeviations / (values.length - 1));
  return { mean: average, sd, band95: 1.96 * sd };
}

function entries(value) {
  if (value instanceof Map) return value.entries();
  if (value && typeof value === "object") return Object.entries(value);
  return [][Symbol.iterator]();
}

function has(value, key) {
  if (value instanceof Map) return value.has(key);
  return Boolean(value && typeof value === "object" &&
    Object.prototype.hasOwnProperty.call(value, key));
}

function get(value, key) {
  return value instanceof Map ? value.get(key) : value[key];
}

export function hardRegressions(before, after) {
  const regressedTasks = [];
  const fixedTasks = [];
  for (const [taskId, beforeRate] of entries(before)) {
    if (!has(after, taskId)) continue;
    const afterRate = get(after, taskId);
    if (beforeRate === 1 && afterRate < 1) regressedTasks.push(String(taskId));
    if (beforeRate === 0 && afterRate > 0) fixedTasks.push(String(taskId));
  }
  regressedTasks.sort();
  fixedTasks.sort();
  return {
    regressions: regressedTasks.length,
    fixes: fixedTasks.length,
    regressedTasks,
    fixedTasks,
  };
}
