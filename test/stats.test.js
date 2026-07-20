import { test } from "node:test";
import assert from "node:assert/strict";

import {
  bootstrapDiff,
  hardRegressions,
  makeRng,
  noiseBand,
  normCdf,
  twoProportion,
  wilson,
} from "../src/measure/stats.js";

test("Wilson interval matches the hand-computed example", () => {
  const result = wilson(8, 10);
  assert.equal(result.point, 0.8);
  assert.equal(result.lo.toFixed(4), "0.4902");
  assert.equal(result.hi.toFixed(4), "0.9433");
});

test("Wilson intervals stay within probability bounds", () => {
  for (const [successes, n] of [[0, 10], [10, 10], [-1, 10], [11, 10]]) {
    const result = wilson(successes, n);
    assert.ok(result.lo >= 0);
    assert.ok(result.hi <= 1);
  }
  assert.deepEqual(wilson(0, 0), { point: 0, lo: 0, hi: 1 });
});

test("normal CDF has known values and exact implemented symmetry", () => {
  assert.equal(normCdf(0), 0.5);
  assert.ok(Math.abs(normCdf(1.96) - 0.975) < 1e-4);
  for (const x of [0.1, 1, 1.96, 4]) {
    assert.ok(Math.abs(normCdf(-x) - (1 - normCdf(x))) < 1e-9);
  }
});

test("two-proportion test uses B minus A and a two-sided p-value", () => {
  const result = twoProportion(40, 100, 55, 100);
  assert.ok(Math.abs(result.diff - 0.15) < 1e-12);
  assert.ok(result.se > 0);
  assert.ok(result.z > 0);
  assert.ok(result.p > 0 && result.p < 0.05);
  assert.deepEqual(twoProportion(0, 0, 0, 0), {
    diff: 0, se: Infinity, z: 0, p: 1,
  });
});

test("mulberry32 is deterministic and stays in [0, 1)", () => {
  const first = makeRng(42);
  const second = makeRng(42);
  const a = Array.from({ length: 20 }, () => first());
  const b = Array.from({ length: 20 }, () => second());
  assert.deepEqual(a, b);
  assert.ok(a.every((value) => value >= 0 && value < 1));
});

test("paired bootstrap is reproducible and seed-sensitive", () => {
  const deltas = [-0.71, -0.18, 0.04, 0.16, 0.29, 0.82];
  const first = bootstrapDiff(deltas, { iters: 317, seed: 7 });
  const repeated = bootstrapDiff(deltas, { iters: 317, seed: 7 });
  const otherSeed = bootstrapDiff(deltas, { iters: 317, seed: 8 });
  assert.deepEqual(first, repeated);
  assert.notDeepEqual({ lo: first.lo, hi: first.hi }, { lo: otherSeed.lo, hi: otherSeed.hi });
  for (const result of [first, otherSeed]) {
    assert.ok(result.lo <= result.point && result.point <= result.hi);
  }
});

test("paired bootstrap distinguishes positive lift and uncertainty around zero", () => {
  const positive = bootstrapDiff([0.4, 0.5, 0.6, 0.5, 0.45]);
  assert.ok(positive.lo > 0);
  const symmetric = bootstrapDiff([-0.3, 0.3, -0.2, 0.2, 0]);
  assert.ok(symmetric.lo <= 0 && symmetric.hi >= 0);
  assert.deepEqual(bootstrapDiff([]), { point: 0, lo: 0, hi: 0, iters: 0 });
});

test("noise band uses sample SD and is conservative with fewer than two runs", () => {
  assert.deepEqual(noiseBand([]), { mean: 0, sd: 0, band95: Infinity });
  assert.deepEqual(noiseBand([0.5]), { mean: 0.5, sd: 0, band95: Infinity });
  const result = noiseBand([0.4, 0.5, 0.6]);
  assert.ok(Math.abs(result.mean - 0.5) < 1e-12);
  assert.ok(Math.abs(result.sd - 0.1) < 1e-12);
  assert.ok(Math.abs(result.band95 - 0.196) < 1e-12);
});

test("hard regression tripwire supports objects and ignores missing tasks", () => {
  const result = hardRegressions(
    { regressed: 1, fixed: 0, stable: 1, beforeOnly: 1 },
    { regressed: 0.92, fixed: 0.1, stable: 1, afterOnly: 0 },
  );
  assert.deepEqual(result, {
    regressions: 1,
    fixes: 1,
    regressedTasks: ["regressed"],
    fixedTasks: ["fixed"],
  });
});

test("hard regression tripwire supports Maps and sorts task ids", () => {
  const result = hardRegressions(
    new Map([["z", 1], ["a", 1], ["f", 0]]),
    new Map([["z", 0.9], ["a", 0.8], ["f", 0.2]]),
  );
  assert.deepEqual(result.regressedTasks, ["a", "z"]);
  assert.deepEqual(result.fixedTasks, ["f"]);
});

test("statistics exports do not throw on null and NaN edge inputs", () => {
  assert.doesNotThrow(() => wilson(NaN, NaN));
  assert.doesNotThrow(() => twoProportion(null, 0, NaN, 0));
  assert.doesNotThrow(() => normCdf(NaN));
  assert.doesNotThrow(() => makeRng(NaN)());
  assert.doesNotThrow(() => bootstrapDiff(null));
  assert.doesNotThrow(() => bootstrapDiff([NaN], null));
  assert.doesNotThrow(() => noiseBand(null));
  assert.doesNotThrow(() => hardRegressions(null, null));
});
