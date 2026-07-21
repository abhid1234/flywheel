import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeAA, summarizeStability } from "../src/measure/calibrate.js";

test("identical A/A runs have zero noise and pass KC-2", () => {
  const result = analyzeAA([[1, 0, 1, 1], [1, 0, 1, 1], [1, 0, 1, 1]]);
  assert.equal(result.mean, 0.75);
  assert.equal(result.sd, 0);
  assert.equal(result.halfwidthPct, 0);
  assert.equal(result.aaClean, true);
  assert.equal(result.kc2Pass, true);
});

test("identical exit codes are stable with zero standard deviation", () => {
  const result = analyzeAA([[1], [1], [1]]);
  assert.equal(result.sd, 0);
  assert.equal(result.aaClean, true);
  assert.equal(result.kc2Pass, true);
});

test("a 15 percentage-point run spread fails KC-2", () => {
  const result = analyzeAA([[0.4], [0.55]]);
  assert.equal(result.kc2Pass, false);
  assert.ok(result.halfwidthPct > 10);
});

test("A/A analysis never throws on malformed input", () => {
  assert.doesNotThrow(() => analyzeAA(null));
  assert.equal(analyzeAA(null).kc2Pass, false);
});

test("summarizeStability reports an all-stable calibration as 100% clean", () => {
  assert.deepEqual(summarizeStability([{ stable: true }, { stable: true }]), { witnesses: 2, stable: 2, unstable: 0, cleanPct: 100 });
});

test("summarizeStability counts a flapping witness as unstable", () => {
  assert.deepEqual(summarizeStability([{ stable: true }, { stable: false }]), { witnesses: 2, stable: 1, unstable: 1, cleanPct: 50 });
});
