import { normCdf } from "./stats.js";

export function repeatsNeeded(sigma, halfwidth, z = 1.96) {
  if (![sigma, halfwidth, z].every(Number.isFinite) || halfwidth <= 0 || z < 0) {
    return Infinity;
  }
  if (sigma <= 0 || z === 0) return 0;
  return Math.ceil(2 * (z * sigma / halfwidth) ** 2);
}

// Inverse standard-normal CDF. Bisection is compact, deterministic, and more
// than precise enough for experimental-design sample sizes.
export function zFor(p) {
  if (typeof p !== "number" || Number.isNaN(p)) return 0;
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  if (p === 0.5) return 0;

  let lo = -8;
  let hi = 8;
  for (let iteration = 0; iteration < 80; iteration += 1) {
    const midpoint = (lo + hi) / 2;
    if (normCdf(midpoint) < p) lo = midpoint;
    else hi = midpoint;
  }
  return (lo + hi) / 2;
}

/**
 * Number of tasks per arm for an UNPAIRED two-proportion design with k=1:
 * each task is assigned to only one arm, so the two Bernoulli variances add.
 * For p0=0.5 and mde=0.05 (alpha=0.05, power=0.8, one-sided), n=1231.
 * That is about 8x the paired answer of n=155 for sigmaDelta=0.25.
 * Flywheel uses the PAIRED variant below because its measurement design pairs
 * arms by task and runs k=12 repeats; use this function only for unpaired k=1.
 */
export function trialsNeeded(p0, mde, options = {}) {
  if (!Number.isFinite(p0) || !Number.isFinite(mde) || mde <= 0) return Infinity;
  const safeOptions = options && typeof options === "object" ? options : {};
  const alpha = safeOptions.alpha ?? 0.05;
  const power = safeOptions.power ?? 0.8;
  const oneSided = safeOptions.oneSided ?? true;
  const p1 = p0 + mde;
  if (p0 < 0 || p0 > 1 || p1 < 0 || p1 > 1 ||
      !Number.isFinite(alpha) || alpha <= 0 || alpha >= 1 ||
      !Number.isFinite(power) || power <= 0 || power >= 1) {
    return Infinity;
  }

  const zAlpha = zFor(1 - alpha / (oneSided ? 1 : 2));
  const zBeta = zFor(power);
  const variance = p0 * (1 - p0) + p1 * (1 - p1);
  return Math.ceil((zAlpha + zBeta) ** 2 * variance / (mde * mde));
}

/**
 * Number of tasks for a PAIRED design: both arms run on every task, with k
 * repeats per arm, and sigmaDelta is the SD of the resulting per-task deltas.
 * With sigmaDelta=0.25 and mde=0.05, n=ceil(154.6)=155, about 8x fewer
 * tasks than the unpaired k=1 result of 1231 at p0=0.5 and the same mde.
 * Flywheel uses this PAIRED variant because it pairs arms by task and runs
 * k=12 repeats (for example, deltaSd(0.5, 12, 0.15) is about 0.25).
 */
export function trialsNeededPaired(sigmaDelta, mde, options = {}) {
  if (!Number.isFinite(sigmaDelta) || sigmaDelta <= 0 ||
      !Number.isFinite(mde) || mde <= 0) {
    return Infinity;
  }
  const safeOptions = options && typeof options === "object" ? options : {};
  const alpha = safeOptions.alpha ?? 0.05;
  const power = safeOptions.power ?? 0.8;
  const oneSided = safeOptions.oneSided ?? true;
  if (!Number.isFinite(alpha) || alpha <= 0 || alpha >= 1 ||
      !Number.isFinite(power) || power <= 0 || power >= 1) {
    return Infinity;
  }

  const zAlpha = zFor(1 - alpha / (oneSided ? 1 : 2));
  const zBeta = zFor(power);
  return Math.ceil((zAlpha + zBeta) ** 2 * sigmaDelta ** 2 / mde ** 2);
}

export function deltaSd(sigmaRun, k, heterogeneity = 0.15) {
  if (!Number.isFinite(sigmaRun) || sigmaRun <= 0 ||
      !Number.isFinite(k) || k <= 0 ||
      !Number.isFinite(heterogeneity) || heterogeneity < 0) {
    return Infinity;
  }
  const samplingSd = Math.sqrt(2 * sigmaRun ** 2 / k);
  return Math.sqrt(samplingSd ** 2 + heterogeneity ** 2);
}

export const POWER_FLOOR = 60;

// This is a hard gate, not advice: callers are expected to exit non-zero.
export function isPowered(n) {
  return Number.isFinite(n) && n >= POWER_FLOOR;
}
