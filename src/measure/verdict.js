import { isPowered } from "./design.js";
import { bootstrapDiff, hardRegressions, noiseBand } from "./stats.js";

const finite = (value) => typeof value === "number" && Number.isFinite(value);
const rates = (value) => Array.isArray(value) ? value.filter(finite).map((item) => Math.max(0, Math.min(1, item))) : [];

function evaluate(beforeInput, afterInput, design) {
  const before = rates(beforeInput);
  const after = rates(afterInput);
  const n = Math.min(before.length, after.length);
  const pairedBefore = before.slice(0, n);
  const pairedAfter = after.slice(0, n);
  const deltas = pairedAfter.map((value, index) => value - pairedBefore[index]);
  const ci = bootstrapDiff(deltas, { seed: Number.isFinite(design?.seed) ? design.seed : 42, iters: design?.iters });
  const regressions = hardRegressions(pairedBefore, pairedAfter);
  const configuredNoise = design?.noiseBand;
  const band = finite(configuredNoise) ? Math.max(0, configuredNoise)
    : noiseBand(Array.isArray(configuredNoise) ? configuredNoise : design?.noiseRuns).band95;
  const mde = finite(design?.mde) && design.mde > 0 ? design.mde : 0.05;
  let verdict = "inconclusive";
  let reason = "effect does not meet a decision threshold";
  if (regressions.regressions > 0) {
    verdict = "regressed";
    reason = "one or more previously passing tasks regressed";
  } else if (isPowered(n) && ci.lo > band) {
    verdict = "helped";
    reason = "CI95 lower bound exceeds the noise band";
  } else if (ci.lo <= 0 && ci.hi >= 0 && ci.hi - ci.lo < 2 * mde) {
    verdict = "no_effect";
    reason = "CI95 contains zero and is narrower than twice the MDE";
  } else if (!isPowered(n)) {
    reason = "fewer than 60 paired tasks; statistical help is not powered";
  }
  return { verdict, delta: ci.point, ci95: { lo: ci.lo, hi: ci.hi }, hardRegressions: regressions, powered: isPowered(n), reason };
}

export function judge(beforeResults, afterResults, design = {}) {
  try {
    const safeDesign = design && typeof design === "object" ? design : {};
    const split = !Array.isArray(beforeResults) && !Array.isArray(afterResults) &&
      beforeResults && afterResults && typeof beforeResults === "object" && typeof afterResults === "object";
    if (split && (beforeResults.dev || beforeResults.heldout || afterResults.dev || afterResults.heldout)) {
      const dev = evaluate(beforeResults.dev, afterResults.dev, safeDesign);
      const heldout = evaluate(beforeResults.heldout, afterResults.heldout, safeDesign);
      if (dev.verdict === "helped" && heldout.verdict !== "helped") {
        return { ...heldout, verdict: "overfit", reason: "helped on dev but not on heldout" };
      }
      return heldout;
    }
    return evaluate(beforeResults, afterResults, safeDesign);
  } catch {
    return { verdict: "inconclusive", delta: 0, ci95: { lo: 0, hi: 0 }, hardRegressions: { regressions: 0, fixes: 0, regressedTasks: [], fixedTasks: [] }, powered: false, reason: "invalid measurement input" };
  }
}
